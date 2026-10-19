import { orgLocalStorage, organizationDbName, setOrgCsrfToken } from "../config/organization";
import { setLastSuccessfulSyncAt, storeOfflineLeaseFromResponse } from "./offlineSession";

const SYNC_LOCK_KEY = "offlineSyncLock";
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const SYNC_LOCK_TTL_MS = 2 * 60 * 1000;

let coordinatorStarted = false;
let running = false;

function openDb(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      try { upgrade(request.result); } catch {}
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openServicingDb() {
  return openDb(organizationDbName("maintenix"), 2, (db) => {
    if (!db.objectStoreNames.contains("servicingCache")) {
      db.createObjectStore("servicingCache", { keyPath: "key" });
    }
    if (!db.objectStoreNames.contains("servicingJobs")) {
      const store = db.createObjectStore("servicingJobs", { keyPath: "id" });
      store.createIndex("status", "status", { unique: false });
      store.createIndex("createdAt", "createdAt", { unique: false });
    }
    if (!db.objectStoreNames.contains("calloutCache")) {
      db.createObjectStore("calloutCache", { keyPath: "key" });
    }
    if (!db.objectStoreNames.contains("calloutJobs")) {
      const store = db.createObjectStore("calloutJobs", { keyPath: "id" });
      store.createIndex("status", "status", { unique: false });
      store.createIndex("createdAt", "createdAt", { unique: false });
    }
  });
}

function openCalloutDb() {
  return openDb(organizationDbName("maintenix_callout_v2"), 1, (db) => {
    if (!db.objectStoreNames.contains("calloutCache")) {
      db.createObjectStore("calloutCache", { keyPath: "key" });
    }
    if (!db.objectStoreNames.contains("calloutJobs")) {
      const store = db.createObjectStore("calloutJobs", { keyPath: "id" });
      store.createIndex("status", "status", { unique: false });
      store.createIndex("createdAt", "createdAt", { unique: false });
    }
  });
}

function openFormalDb() {
  return openDb(organizationDbName("maintenix_formal_reports"), 1, (db) => {
    if (!db.objectStoreNames.contains("formalReportDrafts")) {
      db.createObjectStore("formalReportDrafts", { keyPath: "id" });
    }
  });
}

function idbPut(db, store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(store).put(value);
  });
}

function idbDelete(db, store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(store).delete(key);
  });
}

function idbGetAll(db, store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const request = tx.objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function apiJson(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.message || data?.error || `Request failed (HTTP ${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function readSyncLock() {
  try {
    const raw = orgLocalStorage.getItem(SYNC_LOCK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function claimSyncLock() {
  const now = Date.now();
  const current = readSyncLock();
  if (current?.expiresAt && Number(current.expiresAt) > now) return false;

  const id = `sync_${now}_${Math.random().toString(16).slice(2)}`;
  try {
    orgLocalStorage.setItem(SYNC_LOCK_KEY, JSON.stringify({ id, expiresAt: now + SYNC_LOCK_TTL_MS }));
    const confirmed = readSyncLock();
    return confirmed?.id === id ? id : false;
  } catch {
    return id;
  }
}

function releaseSyncLock(id) {
  if (!id) return;
  try {
    const current = readSyncLock();
    if (!current || current.id === id) orgLocalStorage.removeItem(SYNC_LOCK_KEY);
  } catch {}
}

async function refreshReferenceData(servicingDb, calloutDb, formalDb, role) {
  const isAdmin = String(role || "").trim().toUpperCase() === "ADMIN";
  const baseRequests = [
    apiJson("/api/areas"),
    apiJson("/api/servicing/services"),
    apiJson("/api/servicing/checklist?type=substation"),
    apiJson("/api/servicing/checklist?type=conveyor")
  ];

  if (isAdmin) baseRequests.push(apiJson("/api/formal-reports/sections"));

  const results = await Promise.all(baseRequests);
  const [areasData, servicesData, substationData, conveyorData, sectionsData] = results;

  const nowIso = new Date().toISOString();
  const areas = Array.isArray(areasData?.areas) ? areasData.areas : [];
  const services = Array.isArray(servicesData?.services) ? servicesData.services : [];
  const substation = substationData?.checklist && typeof substationData.checklist === "object"
    ? substationData.checklist
    : substationData;
  const conveyor = conveyorData?.checklist && typeof conveyorData.checklist === "object"
    ? conveyorData.checklist
    : conveyorData;

  const writes = [
    idbPut(servicingDb, "servicingCache", { key: "areas", value: areas, updatedAt: nowIso }),
    idbPut(servicingDb, "servicingCache", { key: "services", value: services, updatedAt: nowIso }),
    idbPut(servicingDb, "servicingCache", { key: "checklist_substation", value: substation, updatedAt: nowIso }),
    idbPut(servicingDb, "servicingCache", { key: "checklist_conveyor", value: conveyor, updatedAt: nowIso }),
    idbPut(calloutDb, "calloutCache", { key: "areas", value: areas, updatedAt: nowIso })
  ];

  if (isAdmin) {
    const sections = Array.isArray(sectionsData?.sections) ? sectionsData.sections : [];
    writes.push(idbPut(formalDb, "formalReportDrafts", {
      id: "__reference_sections__",
      type: "formalReference",
      value: sections,
      updatedAt: nowIso
    }));
  }

  await Promise.all(writes);
  return nowIso;
}

async function syncServicingDrafts(db) {
  let records = await idbGetAll(db, "servicingCache");
  const pending = records.filter((rec) => (
    rec &&
    typeof rec.key === "string" &&
    rec.key.startsWith("servicing_draft_") &&
    rec.value &&
    rec.syncStatus !== "synced"
  ));

  for (const rec of pending) {
    try {
      const data = await apiJson("/api/servicing/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: rec.key,
          type: rec.type || "servicingDraft",
          name: rec.name || rec.key,
          createdAt: rec.createdAt || "",
          updatedAt: rec.updatedAt || rec.createdAt || "",
          value: rec.value
        })
      });
      await idbPut(db, "servicingCache", {
        ...rec,
        syncStatus: "synced",
        syncError: "",
        syncedAt: new Date().toISOString(),
        serverUpdatedAt: String(data?.draft?.updatedAt || "")
      });
    } catch (error) {
      await idbPut(db, "servicingCache", {
        ...rec,
        syncStatus: "pending",
        syncError: String(error?.message || "Draft sync failed."),
        lastSyncAttemptAt: new Date().toISOString()
      });
    }
  }

  // Pull new/changed server drafts so another-device work is available offline.
  records = await idbGetAll(db, "servicingCache");
  const localByKey = new Map(
    records
      .filter((rec) => rec?.key?.startsWith?.("servicing_draft_"))
      .map((rec) => [rec.key, rec])
  );
  const list = await apiJson("/api/servicing/drafts");
  const summaries = Array.isArray(list?.drafts) ? list.drafts : [];

  for (const summary of summaries) {
    const key = String(summary?.key || "");
    if (!key) continue;
    const local = localByKey.get(key);
    if (local && local.syncStatus !== "synced") continue;

    const localServerAt = String(local?.serverUpdatedAt || local?.updatedAt || "");
    const serverAt = String(summary?.updatedAt || "");
    if (local && localServerAt && serverAt && serverAt <= localServerAt) continue;

    try {
      const detail = await apiJson(`/api/servicing/drafts/${encodeURIComponent(key)}`);
      if (!detail?.draft?.value) continue;
      await idbPut(db, "servicingCache", {
        ...detail.draft,
        syncStatus: "synced",
        syncError: "",
        syncedAt: new Date().toISOString(),
        serverUpdatedAt: String(detail.draft.updatedAt || serverAt)
      });
    } catch {
      // One unavailable server draft must not block the rest of automatic sync.
    }
  }
}

async function syncCalloutDrafts(db) {
  let records = await idbGetAll(db, "calloutCache");
  const pending = records.filter((rec) => (
    rec &&
    typeof rec.key === "string" &&
    rec.key.startsWith("callout_v2_draft_") &&
    rec.type === "calloutV2Draft" &&
    rec.value &&
    rec.syncStatus !== "synced"
  ));

  for (const rec of pending) {
    try {
      const data = await apiJson("/api/callout/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: rec.key,
          type: rec.type,
          name: rec.name || rec.key,
          createdAt: rec.createdAt || "",
          updatedAt: rec.updatedAt || rec.createdAt || "",
          value: rec.value
        })
      });
      await idbPut(db, "calloutCache", {
        ...rec,
        syncStatus: "synced",
        syncError: "",
        syncedAt: new Date().toISOString(),
        serverUpdatedAt: String(data?.draft?.updatedAt || "")
      });
    } catch (error) {
      await idbPut(db, "calloutCache", {
        ...rec,
        syncStatus: "pending",
        syncError: String(error?.message || "Draft sync failed."),
        lastSyncAttemptAt: new Date().toISOString()
      });
    }
  }

  records = await idbGetAll(db, "calloutCache");
  const localByKey = new Map(
    records
      .filter((rec) => rec?.key?.startsWith?.("callout_v2_draft_"))
      .map((rec) => [rec.key, rec])
  );
  const list = await apiJson("/api/callout/drafts");
  const summaries = Array.isArray(list?.drafts) ? list.drafts : [];

  for (const summary of summaries) {
    const key = String(summary?.key || "");
    if (!key) continue;
    const local = localByKey.get(key);
    if (local && local.syncStatus !== "synced") continue;

    const localServerAt = String(local?.serverUpdatedAt || local?.updatedAt || "");
    const serverAt = String(summary?.updatedAt || "");
    if (local && localServerAt && serverAt && serverAt <= localServerAt) continue;

    try {
      const detail = await apiJson(`/api/callout/drafts/${encodeURIComponent(key)}`);
      if (!detail?.draft?.value) continue;
      await idbPut(db, "calloutCache", {
        ...detail.draft,
        syncStatus: "synced",
        syncError: "",
        syncedAt: new Date().toISOString(),
        serverUpdatedAt: String(detail.draft.updatedAt || serverAt)
      });
    } catch {
      // Continue syncing remaining drafts.
    }
  }
}

async function syncFormalDrafts(db) {
  let records = await idbGetAll(db, "formalReportDrafts");
  const drafts = records.filter((rec) => rec?.type === "formalReportDraft");

  for (const rec of drafts) {
    if (rec.deleted) {
      try {
        await apiJson(`/api/formal-reports/drafts/${encodeURIComponent(rec.id)}`, { method: "DELETE" });
        await idbDelete(db, "formalReportDrafts", rec.id);
      } catch (error) {
        if (Number(error?.status || 0) === 404) {
          await idbDelete(db, "formalReportDrafts", rec.id);
        } else {
          await idbPut(db, "formalReportDrafts", {
            ...rec,
            syncStatus: "pending",
            syncError: String(error?.message || "Delete sync failed.")
          });
        }
      }
      continue;
    }

    if (!rec.value || rec.syncStatus === "synced") continue;

    try {
      let data = await apiJson("/api/formal-reports/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rec.value, name: rec.name || "" })
      });

      if (rec.nameDirty) {
        data = await apiJson(`/api/formal-reports/drafts/${encodeURIComponent(rec.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: rec.name || "" })
        });
      }

      await idbPut(db, "formalReportDrafts", {
        ...rec,
        name: rec.nameDirty ? rec.name : String(data?.draft?.name || rec.name || ""),
        nameDirty: false,
        syncStatus: "synced",
        syncError: "",
        syncedAt: new Date().toISOString(),
        serverSavedAt: String(data?.draft?.savedAt || "")
      });
    } catch (error) {
      await idbPut(db, "formalReportDrafts", {
        ...rec,
        syncStatus: "pending",
        syncError: String(error?.message || "Draft sync failed."),
        lastSyncAttemptAt: new Date().toISOString()
      });
    }
  }

  records = await idbGetAll(db, "formalReportDrafts");
  const localById = new Map(
    records
      .filter((rec) => rec?.type === "formalReportDraft")
      .map((rec) => [String(rec.id || ""), rec])
  );
  const list = await apiJson("/api/formal-reports/drafts");
  const summaries = Array.isArray(list?.drafts) ? list.drafts : [];

  for (const summary of summaries) {
    const id = String(summary?.id || "");
    if (!id) continue;
    const local = localById.get(id);
    if (local && (local.deleted || local.syncStatus !== "synced" || local.nameDirty)) continue;

    const localServerAt = String(local?.serverSavedAt || local?.savedAt || "");
    const serverAt = String(summary?.savedAt || "");
    if (local && localServerAt && serverAt && serverAt <= localServerAt) continue;

    try {
      const detail = await apiJson(`/api/formal-reports/drafts/${encodeURIComponent(id)}`);
      if (!detail?.draft) continue;
      await idbPut(db, "formalReportDrafts", {
        id,
        type: "formalReportDraft",
        name: detail.draft.name || summary.name || id,
        nameDirty: false,
        savedAt: detail.draft.savedAt || serverAt || new Date().toISOString(),
        value: detail.draft,
        syncStatus: "synced",
        syncError: "",
        syncedAt: new Date().toISOString(),
        serverSavedAt: detail.draft.savedAt || serverAt || ""
      });
    } catch {
      // Continue syncing remaining drafts.
    }
  }
}

export async function runAutomaticOfflineSync() {
  if (running || typeof navigator === "undefined" || !navigator.onLine) return false;
  if (!orgLocalStorage.getItem("authToken")) return false;

  const lockId = claimSyncLock();
  if (!lockId) return false;
  running = true;

  let servicingDb;
  let calloutDb;
  let formalDb;

  try {
    const profile = await apiJson("/api/profile/me");

    servicingDb = await openServicingDb();
    calloutDb = await openCalloutDb();
    formalDb = await openFormalDb();

    const role = String(profile?.user?.role || "").trim().toUpperCase();
    await refreshReferenceData(servicingDb, calloutDb, formalDb, role);

    const draftSyncs = [
      syncServicingDrafts(servicingDb),
      syncCalloutDrafts(calloutDb)
    ];
    if (role === "ADMIN") draftSyncs.push(syncFormalDrafts(formalDb));
    await Promise.all(draftSyncs);

    setOrgCsrfToken(profile?.csrfToken || "");
    if (profile?.user) {
      orgLocalStorage.setItem("authUser", JSON.stringify(profile.user));
    }

    if (profile?.offlineLease && profile?.user) {
      storeOfflineLeaseFromResponse(profile);
      orgLocalStorage.setItem("authExpiresAt", String(profile.offlineLease.expiresAt || profile.expiresAt || ""));
    } else if (profile?.expiresAt) {
      orgLocalStorage.setItem("authExpiresAt", String(profile.expiresAt));
    }

    setLastSuccessfulSyncAt(Date.now());
    try { window.dispatchEvent(new CustomEvent("maintenixOfflineSync", { detail: { ok: true } })); } catch {}
    return true;
  } catch (error) {
    const status = Number(error?.status || 0);
    if (status === 401 || status === 403) {
      try { window.dispatchEvent(new Event("maintenixSessionInvalid")); } catch {}
    }
    try {
      window.dispatchEvent(new CustomEvent("maintenixOfflineSync", {
        detail: { ok: false, message: String(error?.message || "Automatic sync failed.") }
      }));
    } catch {}
    return false;
  } finally {
    try { if (servicingDb) servicingDb.close(); } catch {}
    try { if (calloutDb) calloutDb.close(); } catch {}
    try { if (formalDb) formalDb.close(); } catch {}
    running = false;
    releaseSyncLock(lockId);
  }
}

export function startOfflineSyncCoordinator() {
  if (coordinatorStarted || typeof window === "undefined") return () => {};
  coordinatorStarted = true;

  const attempt = () => {
    if (navigator.onLine) runAutomaticOfflineSync().catch(() => {});
  };
  const onOnline = () => attempt();
  const onFocus = () => attempt();
  const onVisibility = () => {
    if (document.visibilityState === "visible") attempt();
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onFocus);
  window.addEventListener("authUserUpdated", attempt);
  document.addEventListener("visibilitychange", onVisibility);

  const timer = window.setInterval(attempt, SYNC_INTERVAL_MS);
  window.setTimeout(attempt, 0);

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("authUserUpdated", attempt);
    document.removeEventListener("visibilitychange", onVisibility);
    window.clearInterval(timer);
    coordinatorStarted = false;
  };
}
