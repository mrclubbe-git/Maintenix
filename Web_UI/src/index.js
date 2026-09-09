// =========================================================
// * Volt React Dashboard
// =========================================================

// * Product Page: https://themesberg.com/product/dashboard/volt-react
// * Copyright 2021 Themesberg (https://www.themesberg.com)
// * Official Repository: https://github.com/themesberg/volt-react-dashboard
// * License: MIT License (https://themesberg.com/licensing)

// * Designed and coded by https://themesberg.com

// =========================================================

// * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. Please contact us to request a removal.

import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { HashRouter } from "react-router-dom";

// core styles
import "./scss/volt.scss";

// vendor styles
import "react-datetime/css/react-datetime.css";

import HomePage from "./pages/HomePage";
import ScrollToTop from "./components/ScrollToTop";

// ✅ CRA Workbox service worker helper
import * as serviceWorker from "./serviceWorker";

// ✅ Register CRA build service worker (build/service-worker.js)
serviceWorker.register({
  onUpdate: (registration) => {
    try {
      const ok = window.confirm("A new version is available. Reload now to update?");
      if (!ok) return;

      // Tell the waiting SW to activate immediately
      if (registration && registration.waiting) {
        try {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        } catch {}
      }

      // Reload once the new SW takes control
      let reloaded = false;
      const onControllerChange = () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      };

      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    } catch {}
  }
});

/**
 * --- Global Presence Heartbeat ---
 * Keeps user Online/Last Seen accurate regardless of which page is open.
 *
 * - Sends POST /api/presence/ping on an interval while user is logged in
 * - Uses a cross-tab lock so only ONE tab pings to prevent spam/duplication
 * - Also pings on focus/visibility change and when coming back online
 */
function PresenceHeartbeat() {
  const instanceIdRef = useRef(`presence_${Math.random().toString(16).slice(2)}_${Date.now()}`);
  const leaderRef = useRef(false);
  const runningRef = useRef(false);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    const onOn = () => setOnline(true);
    const onOff = () => setOnline(false);
    window.addEventListener("online", onOn);
    window.addEventListener("offline", onOff);

    // --- Cross-tab leader lock (best-effort) ---
    const LOCK_KEY = "maintenix_presence_lock";
    const LOCK_TTL_MS = 15000;

    const readLock = () => {
      try {
        const raw = localStorage.getItem(LOCK_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object") return null;
        return obj;
      } catch {
        return null;
      }
    };

    const writeLock = (obj) => {
      try {
        localStorage.setItem(LOCK_KEY, JSON.stringify(obj));
      } catch {}
    };

    const isOtherTabLockActive = (cur, now, myId) => {
      if (!cur || !cur.id || cur.id === myId) return false;

      // New-style lock uses expiresAt
      if (cur.expiresAt && Number(cur.expiresAt) > now) return true;

      // Back-compat: old-style lock used ts TTL
      if (cur.ts && now - Number(cur.ts) < LOCK_TTL_MS) return true;

      return false;
    };

    const tryClaimLock = () => {
      const now = Date.now();
      const id = instanceIdRef.current;
      const cur = readLock();

      if (isOtherTabLockActive(cur, now, id)) return false;

      writeLock({ id, ts: now, expiresAt: now + LOCK_TTL_MS });
      return true;
    };

    leaderRef.current = tryClaimLock();

    const onStorage = (e) => {
      if (e.key !== LOCK_KEY) return;
      const now = Date.now();
      const cur = readLock();
      const id = instanceIdRef.current;

      if (isOtherTabLockActive(cur, now, id)) {
        leaderRef.current = false;
      }
    };
    window.addEventListener("storage", onStorage);

    const releaseIfOwned = () => {
      try {
        const cur = readLock();
        const id = instanceIdRef.current;
        if (cur && cur.id === id) localStorage.removeItem(LOCK_KEY);
      } catch {}
    };
    window.addEventListener("beforeunload", releaseIfOwned);

    return () => {
      window.removeEventListener("online", onOn);
      window.removeEventListener("offline", onOff);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("beforeunload", releaseIfOwned);
      releaseIfOwned();
    };
  }, []);

  const ping = async (opts = {}) => {
    if (runningRef.current) return;
    runningRef.current = true;

    try {
      const token = localStorage.getItem("authToken") || "";
      if (!token) return;

      // If offline, do nothing
      if (typeof navigator !== "undefined" && !navigator.onLine) return;

      await fetch("/api/presence/ping", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        // keepalive helps when tab is closing / being backgrounded (browser support varies)
        keepalive: true,
        ...opts
      }).catch(() => null);
    } finally {
      runningRef.current = false;
    }
  };

  useEffect(() => {
    const LOCK_KEY = "maintenix_presence_lock";
    const LOCK_TTL_MS = 15000;

    const readLock = () => {
      try {
        const raw = localStorage.getItem(LOCK_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object") return null;
        return obj;
      } catch {
        return null;
      }
    };

    const writeLock = (obj) => {
      try {
        localStorage.setItem(LOCK_KEY, JSON.stringify(obj));
      } catch {}
    };

    const ensureLeader = () => {
      const now = Date.now();
      const id = instanceIdRef.current;
      const cur = readLock();

      const expiredByExpiresAt = cur?.expiresAt ? now >= Number(cur.expiresAt) : false;
      const expiredByTs = cur?.ts ? now - Number(cur.ts) >= LOCK_TTL_MS : true;

      const canTake = !cur || cur.id === id || expiredByExpiresAt || expiredByTs || !cur.id;

      if (canTake) {
        writeLock({ id, ts: now, expiresAt: now + LOCK_TTL_MS });
        leaderRef.current = true;
        return true;
      }

      leaderRef.current = false;
      return false;
    };

    // Ping immediately once on mount if possible (becomes "Online" quickly)
    if (online) {
      ensureLeader();
      if (leaderRef.current) ping();
    }

    const tick = setInterval(() => {
      if (!online) return;
      if (!ensureLeader()) return;
      ping();
    }, 15000);

    const onVisibility = () => {
      // When user returns to the tab, mark online quickly
      if (document.visibilityState === "visible") {
        if (!online) return;
        ensureLeader();
        if (leaderRef.current) ping();
      } else {
        // When leaving/hidden, send a final ping so lastSeen updates near-real-time
        if (!online) return;
        ensureLeader();
        if (leaderRef.current) ping();
      }
    };

    const onFocus = () => {
      if (!online) return;
      ensureLeader();
      if (leaderRef.current) ping();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(tick);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  return null;
}

/**
 * --- Background Servicing Job Runner ---
 * Processes queued servicing jobs stored in IndexedDB.
 * Runs on ANY page because it is mounted at the app root.
 *
 * Updated behavior:
 * - Online: submit payload quickly to server (/api/servicing/submit-payload)
 * - Poll server job status (/api/servicing/status/:reportId)
 * - Generation happens server-side (worker), so it continues if user logs out/closes app.
 *
 * --- Background CallOut Job Runner ---
 * Mirrors the Servicing runner for calloutJobs:
 * - Online: submit payload quickly to server (/api/callout/submit-payload)
 * - Poll server job status (/api/callout/status/:reportId)
 */

// ✅ Job schema protection
const JOB_SCHEMA_VERSION = 2;

function openMaintenixDb() {
  return new Promise((resolve, reject) => {
    // IMPORTANT: bump DB version so we can add CallOut stores
    const req = indexedDB.open("maintenix", 2);
    req.onupgradeneeded = () => {
      const db = req.result;

      // Existing Servicing stores
      if (!db.objectStoreNames.contains("servicingCache")) {
        db.createObjectStore("servicingCache", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("servicingJobs")) {
        const s = db.createObjectStore("servicingJobs", { keyPath: "id" });
        s.createIndex("status", "status", { unique: false });
        s.createIndex("createdAt", "createdAt", { unique: false });
      }

      // New CallOut stores
      if (!db.objectStoreNames.contains("calloutCache")) {
        db.createObjectStore("calloutCache", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("calloutJobs")) {
        const s = db.createObjectStore("calloutJobs", { keyPath: "id" });
        s.createIndex("status", "status", { unique: false });
        s.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(db, store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const st = tx.objectStore(store);
    const req = st.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAllByIndex(db, store, indexName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const st = tx.objectStore(store);
    const idx = st.index(indexName);
    const req = idx.getAll(value);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(db, store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const st = tx.objectStore(store);
    const req = st.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(db, store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(store).put(value);
  });
}

function normalizeSchemaVersion(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function withLatestSchema(job) {
  const cur = normalizeSchemaVersion(job?.schemaVersion);
  const next = Math.max(cur, JOB_SCHEMA_VERSION);
  if (next === cur) return job;
  return { ...(job || {}), schemaVersion: next };
}

function ensureIso(v) {
  const s = String(v || "").trim();
  return s ? s : "";
}

// ✅ Stop protection: if user stopped or removed job, runner must not overwrite it.
function isStoppedStatus(status) {
  return String(status || "").toLowerCase() === "stopped";
}

async function abortIfStoppedOrMissing(db, store, jobId) {
  try {
    const cur = await idbGet(db, store, jobId);
    if (!cur) return true; // removed
    if (isStoppedStatus(cur.status)) return true; // stopped
    return false;
  } catch {
    // safest: do not proceed if we can't confirm
    return true;
  }
}

function migrateServicingJobToV2(job) {
  const j = { ...(job || {}) };
  let changed = false;

  // schemaVersion: missing -> v1
  let sv = normalizeSchemaVersion(j.schemaVersion);
  if (sv !== normalizeSchemaVersion(job?.schemaVersion)) {
    changed = true;
  }

  if (sv < 2) {
    // Ensure critical fields exist so runner doesn't break
    if (!ensureIso(j.createdAt)) {
      j.createdAt = ensureIso(j.startedAt) || new Date().toISOString();
      changed = true;
    }
    if (!String(j.status || "").trim()) {
      j.status = "queued";
      changed = true;
    }
    if (j.retries == null || !Number.isFinite(Number(j.retries))) {
      j.retries = 0;
      changed = true;
    }
    if (!Array.isArray(j.attachments)) {
      j.attachments = [];
      changed = true;
    }

    // Normalize reportId if present in payload
    const rid = String(j.reportId || j?.payload?.reportId || "").trim();
    if (!String(j.reportId || "").trim() && rid) {
      j.reportId = rid;
      changed = true;
    }

    // Upgrade version
    sv = 2;
    changed = true;
  }

  j.schemaVersion = sv;
  return { job: j, changed };
}

function migrateCalloutJobToV2(job) {
  const j = { ...(job || {}) };
  let changed = false;

  let sv = normalizeSchemaVersion(j.schemaVersion);
  if (sv !== normalizeSchemaVersion(job?.schemaVersion)) {
    changed = true;
  }

  if (sv < 2) {
    if (!ensureIso(j.createdAt)) {
      j.createdAt = ensureIso(j.startedAt) || new Date().toISOString();
      changed = true;
    }
    if (!String(j.status || "").trim()) {
      j.status = "queued";
      changed = true;
    }
    if (j.retries == null || !Number.isFinite(Number(j.retries))) {
      j.retries = 0;
      changed = true;
    }

    // Normalize reportId if present in payload
    const rid = String(j.reportId || j?.payload?.reportId || "").trim();
    if (!String(j.reportId || "").trim() && rid) {
      j.reportId = rid;
      changed = true;
    }

    // Ensure payload/photos shape so submit function can safely map it
    if (j.payload && typeof j.payload === "object") {
      const p = { ...j.payload };
      if (!Array.isArray(p.photos)) {
        p.photos = [];
        changed = true;
      } else {
        const normalized = p.photos.map((ph, i) => {
          const obj = { ...(ph || {}) };
          if (!String(obj.id || "").trim()) obj.id = `p_${i}`;
          if (!String(obj.name || "").trim()) obj.name = `photo_${i}.jpg`;
          if (obj.description == null) obj.description = "";
          return obj;
        });

        // Only mark changed if something likely missing (cheap check)
        if (normalized.length !== p.photos.length) {
          changed = true;
        } else {
          for (let i = 0; i < normalized.length; i++) {
            const a = p.photos[i] || {};
            const b = normalized[i] || {};
            if (a.id !== b.id || a.name !== b.name || a.description !== b.description) {
              changed = true;
              break;
            }
          }
        }

        p.photos = normalized;
      }
      j.payload = p;
    }

    sv = 2;
    changed = true;
  }

  j.schemaVersion = sv;
  return { job: j, changed };
}

async function migrateJobStores(db) {
  try {
    // Servicing
    try {
      const allServicing = await idbGetAll(db, "servicingJobs");
      for (const item of allServicing) {
        const { job, changed } = migrateServicingJobToV2(item);
        if (changed) {
          await idbPut(db, "servicingJobs", job);
        }
      }
    } catch {}

    // CallOut
    try {
      const allCallout = await idbGetAll(db, "calloutJobs");
      for (const item of allCallout) {
        const { job, changed } = migrateCalloutJobToV2(item);
        if (changed) {
          await idbPut(db, "calloutJobs", job);
        }
      }
    } catch {}
  } catch {}
}

function blobFromDataUrl(dataUrl) {
  try {
    const parts = String(dataUrl || "").split(",");
    if (parts.length < 2) return null;
    const meta = parts[0];
    const b64 = parts[1];
    const mimeMatch = /data:(.*?);base64/.exec(meta);
    const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  } catch {
    return null;
  }
}

function dispatchJobEvent(detail) {
  try {
    window.dispatchEvent(new CustomEvent("maintenix:servicing-jobs", { detail }));
  } catch {}
}

function dispatchCalloutJobEvent(detail) {
  try {
    window.dispatchEvent(new CustomEvent("maintenix:callout-jobs", { detail }));
  } catch {}
}

/* ----------------------------- SERVICING ----------------------------- */

async function submitPayloadToServer(job, token) {
  const reportId = String(job?.reportId || job?.payload?.reportId || "").trim();
  if (!reportId) throw new Error("Missing reportId.");

  // Ensure reportId is in payload
  const payload = { ...(job.payload || {}), reportId };

  const form = new FormData();
  form.append("payload", JSON.stringify(payload));

  // Attach blobs (supports Blob or dataUrl fallback)
  (job.attachments || []).forEach((att) => {
    if (!att || !att.field) return;

    let blob = att.blob || null;
    if (!blob && att.dataUrl) blob = blobFromDataUrl(att.dataUrl);

    if (!blob) return;

    try {
      form.append(String(att.field), blob, att.fileName || `${att.field}.jpg`);
    } catch {}
  });

  const res = await fetch("/api/servicing/submit-payload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || `Submit failed (HTTP ${res.status})`;
    throw new Error(msg);
  }

  return {
    reportId: String(data?.reportId || reportId),
    serverStatus: String(data?.status || "pending")
  };
}

async function pollServerStatus(reportId, token) {
  const id = String(reportId || "").trim();
  if (!id) throw new Error("Missing reportId (cannot poll).");

  const res = await fetch(`/api/servicing/status/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || `Status failed (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return data;
}

/**
 * Returns true if it did meaningful work this tick, false otherwise.
 */
async function processOneJob(db) {
  // Only process when online
  if (!navigator.onLine) return false;

  const token = localStorage.getItem("authToken") || "";
  if (!token) return false;

  // 1) Submit queued/retry jobs to server (fast), then mark server_pending
  const queued = await idbGetAllByIndex(db, "servicingJobs", "status", "queued");
  const retry = await idbGetAllByIndex(db, "servicingJobs", "status", "retry");
  const toSubmit = [...queued, ...retry].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];

  if (toSubmit) {
    const nowIso = new Date().toISOString();

    const submittingJob = withLatestSchema({
      ...toSubmit,
      status: "submitting",
      startedAt: toSubmit.startedAt || nowIso,
      lastUpdateAt: nowIso,
      error: ""
    });

    await idbPut(db, "servicingJobs", submittingJob);
    dispatchJobEvent({ type: "updated", id: submittingJob.id });

    try {
      const { reportId } = await submitPayloadToServer(submittingJob, token);

      // ✅ If user stopped/removed while submitting, do NOT overwrite.
      if (await abortIfStoppedOrMissing(db, "servicingJobs", submittingJob.id)) return true;

      const next = withLatestSchema({
        ...submittingJob,
        reportId,
        payload: submittingJob.payload ? { ...(submittingJob.payload || {}), reportId } : submittingJob.payload,
        status: "server_pending",
        lastUpdateAt: new Date().toISOString()
      });

      await idbPut(db, "servicingJobs", next);
      dispatchJobEvent({ type: "updated", id: next.id });
    } catch (e) {
      // ✅ If user stopped/removed while submitting, do NOT overwrite.
      if (await abortIfStoppedOrMissing(db, "servicingJobs", submittingJob.id)) return true;

      const retries = Number(toSubmit.retries || 0) + 1;
      const nextStatus = retries >= 3 ? "error" : "retry";

      const failJob = withLatestSchema({
        ...submittingJob,
        status: nextStatus,
        retries,
        lastUpdateAt: new Date().toISOString(),
        error: String(e?.message || "Submit failed")
      });

      await idbPut(db, "servicingJobs", failJob);
      dispatchJobEvent({ type: "updated", id: failJob.id });
    }

    return true; // one job per tick
  }

  // 2) Poll server_pending/running/polling/submitting jobs for completion
  const serverPending = await idbGetAllByIndex(db, "servicingJobs", "status", "server_pending");
  const running = await idbGetAllByIndex(db, "servicingJobs", "status", "running");
  const polling = await idbGetAllByIndex(db, "servicingJobs", "status", "polling");
  const submitting = await idbGetAllByIndex(db, "servicingJobs", "status", "submitting");

  const toPoll = [...serverPending, ...running, ...polling, ...submitting].sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt))
  )[0];

  if (!toPoll) return false;

  const reportId = toPoll.reportId || toPoll?.payload?.reportId;
  if (!reportId) {
    // ✅ If user stopped/removed meanwhile, do NOT overwrite.
    if (await abortIfStoppedOrMissing(db, "servicingJobs", toPoll.id)) return true;

    const bad = withLatestSchema({
      ...toPoll,
      status: "error",
      lastUpdateAt: new Date().toISOString(),
      error: "Missing reportId (cannot poll)."
    });

    await idbPut(db, "servicingJobs", bad);
    dispatchJobEvent({ type: "updated", id: bad.id });
    return true;
  }

  const nowIso = new Date().toISOString();
  const pollingJob = withLatestSchema({ ...toPoll, status: "polling", lastUpdateAt: nowIso });

  // ✅ If user stopped/removed before we flip to polling, do NOT overwrite.
  if (await abortIfStoppedOrMissing(db, "servicingJobs", pollingJob.id)) return true;

  await idbPut(db, "servicingJobs", pollingJob);
  dispatchJobEvent({ type: "updated", id: pollingJob.id });

  try {
    const statusData = await pollServerStatus(reportId, token);
    const s = String(statusData?.status || "").toLowerCase();

    // ✅ If user stopped/removed during fetch, do NOT overwrite.
    if (await abortIfStoppedOrMissing(db, "servicingJobs", pollingJob.id)) return true;

    if (s === "done") {
      const result = statusData?.result || {};
      const doneJob = withLatestSchema({
        ...pollingJob,
        status: "done",
        doneAt: new Date().toISOString(),
        lastUpdateAt: new Date().toISOString(),
        result: { fileName: String(result?.fileName || ""), url: String(result?.url || "") },
        // Remove heavy data after success (keeps record)
        payload: null,
        attachments: [],
        error: ""
      });

      await idbPut(db, "servicingJobs", doneJob);
      dispatchJobEvent({ type: "updated", id: doneJob.id });
      return true;
    }

    if (s === "error") {
      const failJob = withLatestSchema({
        ...pollingJob,
        status: "error",
        lastUpdateAt: new Date().toISOString(),
        error: String(statusData?.error || "Server job failed.")
      });

      await idbPut(db, "servicingJobs", failJob);
      dispatchJobEvent({ type: "updated", id: failJob.id });
      return true;
    }

    // pending/running
    const nextJob = withLatestSchema({
      ...pollingJob,
      status: s === "running" ? "running" : "server_pending",
      lastUpdateAt: new Date().toISOString(),
      error: ""
    });

    await idbPut(db, "servicingJobs", nextJob);
    dispatchJobEvent({ type: "updated", id: nextJob.id });
    return true;
  } catch (e) {
    // ✅ If user stopped/removed during fetch, do NOT overwrite.
    if (await abortIfStoppedOrMissing(db, "servicingJobs", pollingJob.id)) return true;

    // Poll failure: keep it pending and try again next tick
    const nextJob = withLatestSchema({
      ...pollingJob,
      status: "server_pending",
      lastUpdateAt: new Date().toISOString(),
      error: String(e?.message || "")
    });

    await idbPut(db, "servicingJobs", nextJob);
    dispatchJobEvent({ type: "updated", id: nextJob.id });
    return true;
  }
}

/* ------------------------------ CALLOUT ------------------------------ */

async function submitCalloutPayloadToServer(job, token) {
  const reportId = String(job?.reportId || job?.payload?.reportId || "").trim();
  if (!reportId) throw new Error("Missing reportId.");

  // Clone payload and strip heavy photo dataUrl from JSON, but keep photo meta
  const originalPayload = job.payload || {};
  const rawPhotos = Array.isArray(originalPayload.photos) ? originalPayload.photos : [];

  const photosMeta = rawPhotos.map((p, i) => ({
    id: String(p?.id || `p_${i}`),
    name: String(p?.name || `photo_${i}.jpg`),
    description: String(p?.description || "")
  }));

  const payload = {
    ...originalPayload,
    reportId,
    photos: photosMeta
  };

  const form = new FormData();
  form.append("payload", JSON.stringify(payload));

  // Upload images as repeated "photo" fields (backend can accept many)
  rawPhotos.forEach((p, i) => {
    const dataUrl = p?.dataUrl || "";
    const blob = blobFromDataUrl(dataUrl);
    if (!blob) return;
    const filename = String(p?.name || `photo_${i}.jpg`);
    try {
      form.append("photo", blob, filename);
    } catch {}
  });

  const res = await fetch("/api/callout/submit-payload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || `Submit failed (HTTP ${res.status})`;
    throw new Error(msg);
  }

  return {
    reportId: String(data?.reportId || reportId),
    serverStatus: String(data?.status || "pending")
  };
}

async function pollCalloutServerStatus(reportId, token) {
  const id = String(reportId || "").trim();
  if (!id) throw new Error("Missing reportId (cannot poll).");

  const res = await fetch(`/api/callout/status/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || `Status failed (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return data;
}

/**
 * Returns true if it did meaningful work this tick, false otherwise.
 */
async function processOneCalloutJob(db) {
  if (!navigator.onLine) return false;

  const token = localStorage.getItem("authToken") || "";
  if (!token) return false;

  // 1) Submit queued/retry callout jobs
  const queued = await idbGetAllByIndex(db, "calloutJobs", "status", "queued");
  const retry = await idbGetAllByIndex(db, "calloutJobs", "status", "retry");
  const toSubmit = [...queued, ...retry].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];

  if (toSubmit) {
    const nowIso = new Date().toISOString();

    const submittingJob = withLatestSchema({
      ...toSubmit,
      status: "submitting",
      startedAt: toSubmit.startedAt || nowIso,
      lastUpdateAt: nowIso,
      error: ""
    });

    await idbPut(db, "calloutJobs", submittingJob);
    dispatchCalloutJobEvent({ type: "updated", id: submittingJob.id });

    try {
      const { reportId } = await submitCalloutPayloadToServer(submittingJob, token);

      // ✅ If user stopped/removed while submitting, do NOT overwrite.
      if (await abortIfStoppedOrMissing(db, "calloutJobs", submittingJob.id)) return true;

      const next = withLatestSchema({
        ...submittingJob,
        reportId,
        payload: submittingJob.payload ? { ...(submittingJob.payload || {}), reportId } : submittingJob.payload,
        status: "server_pending",
        lastUpdateAt: new Date().toISOString()
      });

      await idbPut(db, "calloutJobs", next);
      dispatchCalloutJobEvent({ type: "updated", id: next.id });
    } catch (e) {
      // ✅ If user stopped/removed while submitting, do NOT overwrite.
      if (await abortIfStoppedOrMissing(db, "calloutJobs", submittingJob.id)) return true;

      const retries = Number(toSubmit.retries || 0) + 1;
      const nextStatus = retries >= 3 ? "error" : "retry";

      const failJob = withLatestSchema({
        ...submittingJob,
        status: nextStatus,
        retries,
        lastUpdateAt: new Date().toISOString(),
        error: String(e?.message || "Submit failed")
      });

      await idbPut(db, "calloutJobs", failJob);
      dispatchCalloutJobEvent({ type: "updated", id: failJob.id });
    }

    return true;
  }

  // 2) Poll callout jobs
  const serverPending = await idbGetAllByIndex(db, "calloutJobs", "status", "server_pending");
  const running = await idbGetAllByIndex(db, "calloutJobs", "status", "running");
  const polling = await idbGetAllByIndex(db, "calloutJobs", "status", "polling");
  const submitting = await idbGetAllByIndex(db, "calloutJobs", "status", "submitting");

  const toPoll = [...serverPending, ...running, ...polling, ...submitting].sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt))
  )[0];

  if (!toPoll) return false;

  const reportId = toPoll.reportId || toPoll?.payload?.reportId;
  if (!reportId) {
    // ✅ If user stopped/removed meanwhile, do NOT overwrite.
    if (await abortIfStoppedOrMissing(db, "calloutJobs", toPoll.id)) return true;

    const bad = withLatestSchema({
      ...toPoll,
      status: "error",
      lastUpdateAt: new Date().toISOString(),
      error: "Missing reportId (cannot poll)."
    });

    await idbPut(db, "calloutJobs", bad);
    dispatchCalloutJobEvent({ type: "updated", id: bad.id });
    return true;
  }

  const nowIso = new Date().toISOString();
  const pollingJob = withLatestSchema({ ...toPoll, status: "polling", lastUpdateAt: nowIso });

  // ✅ If user stopped/removed before we flip to polling, do NOT overwrite.
  if (await abortIfStoppedOrMissing(db, "calloutJobs", pollingJob.id)) return true;

  await idbPut(db, "calloutJobs", pollingJob);
  dispatchCalloutJobEvent({ type: "updated", id: pollingJob.id });

  try {
    const statusData = await pollCalloutServerStatus(reportId, token);
    const s = String(statusData?.status || "").toLowerCase();

    // ✅ If user stopped/removed during fetch, do NOT overwrite.
    if (await abortIfStoppedOrMissing(db, "calloutJobs", pollingJob.id)) return true;

    if (s === "done") {
      const result = statusData?.result || {};
      const doneJob = withLatestSchema({
        ...pollingJob,
        status: "done",
        doneAt: new Date().toISOString(),
        lastUpdateAt: new Date().toISOString(),
        result: { fileName: String(result?.fileName || ""), url: String(result?.url || "") },
        payload: null,
        error: ""
      });

      await idbPut(db, "calloutJobs", doneJob);
      dispatchCalloutJobEvent({ type: "updated", id: doneJob.id });
      return true;
    }

    if (s === "error") {
      const failJob = withLatestSchema({
        ...pollingJob,
        status: "error",
        lastUpdateAt: new Date().toISOString(),
        error: String(statusData?.error || "Server job failed.")
      });

      await idbPut(db, "calloutJobs", failJob);
      dispatchCalloutJobEvent({ type: "updated", id: failJob.id });
      return true;
    }

    const nextJob = withLatestSchema({
      ...pollingJob,
      status: s === "running" ? "running" : "server_pending",
      lastUpdateAt: new Date().toISOString(),
      error: ""
    });

    await idbPut(db, "calloutJobs", nextJob);
    dispatchCalloutJobEvent({ type: "updated", id: nextJob.id });
    return true;
  } catch (e) {
    // ✅ If user stopped/removed during fetch, do NOT overwrite.
    if (await abortIfStoppedOrMissing(db, "calloutJobs", pollingJob.id)) return true;

    const nextJob = withLatestSchema({
      ...pollingJob,
      status: "server_pending",
      lastUpdateAt: new Date().toISOString(),
      error: String(e?.message || "")
    });

    await idbPut(db, "calloutJobs", nextJob);
    dispatchCalloutJobEvent({ type: "updated", id: nextJob.id });
    return true;
  }
}

function ServicingJobRunner() {
  const dbRef = useRef(null);
  const runningRef = useRef(false);

  // Prevent duplicate polling when the app is open in multiple tabs or the runner is mounted twice.
  const instanceIdRef = useRef(`runner_${Math.random().toString(16).slice(2)}_${Date.now()}`);
  const leaderRef = useRef(false);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    let mounted = true;

    openMaintenixDb()
      .then((db) => {
        if (!mounted) return;
        dbRef.current = db;

        // ✅ Run safe job migrations once DB is available
        migrateJobStores(db);
      })
      .catch(() => {});

    const onOn = () => setOnline(true);
    const onOff = () => setOnline(false);
    window.addEventListener("online", onOn);
    window.addEventListener("offline", onOff);

    // --- Cross-tab leader lock (best-effort) ---
    // IMPORTANT: This key matches Servicing.js so Servicing.js will NOT run its own background poller.
    const LOCK_KEY = "maintenix_servicing_runner_lock";
    const LOCK_TTL_MS = 15000;

    const readLock = () => {
      try {
        const raw = localStorage.getItem(LOCK_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object") return null;
        return obj;
      } catch {
        return null;
      }
    };

    const writeLock = (obj) => {
      try {
        localStorage.setItem(LOCK_KEY, JSON.stringify(obj));
      } catch {}
    };

    const isOtherTabLockActive = (cur, now, myId) => {
      if (!cur || !cur.id || cur.id === myId) return false;

      // New-style lock uses expiresAt
      if (cur.expiresAt && Number(cur.expiresAt) > now) return true;

      // Back-compat: old-style lock used ts TTL
      if (cur.ts && now - Number(cur.ts) < LOCK_TTL_MS) return true;

      return false;
    };

    const tryClaimLock = () => {
      const now = Date.now();
      const id = instanceIdRef.current;
      const cur = readLock();

      // If another tab currently owns a non-expired lock, don't run.
      if (isOtherTabLockActive(cur, now, id)) return false;

      // Write new-style lock (and keep ts for compatibility)
      writeLock({ id, ts: now, expiresAt: now + LOCK_TTL_MS });
      return true;
    };

    // Initial claim
    leaderRef.current = tryClaimLock();

    // React to other tabs taking the lock
    const onStorage = (e) => {
      if (e.key !== LOCK_KEY) return;
      const now = Date.now();
      const cur = readLock();
      const id = instanceIdRef.current;

      if (isOtherTabLockActive(cur, now, id)) {
        leaderRef.current = false;
      }
    };
    window.addEventListener("storage", onStorage);

    const releaseIfOwned = () => {
      try {
        const cur = readLock();
        const id = instanceIdRef.current;
        if (cur && cur.id === id) localStorage.removeItem(LOCK_KEY);
      } catch {}
    };
    window.addEventListener("beforeunload", releaseIfOwned);

    return () => {
      mounted = false;
      window.removeEventListener("online", onOn);
      window.removeEventListener("offline", onOff);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("beforeunload", releaseIfOwned);
      releaseIfOwned();
    };
  }, []);

  useEffect(() => {
    const LOCK_KEY = "maintenix_servicing_runner_lock";
    const LOCK_TTL_MS = 15000;

    const readLock = () => {
      try {
        const raw = localStorage.getItem(LOCK_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object") return null;
        return obj;
      } catch {
        return null;
      }
    };

    const writeLock = (obj) => {
      try {
        localStorage.setItem(LOCK_KEY, JSON.stringify(obj));
      } catch {}
    };

    const ensureLeader = () => {
      const now = Date.now();
      const id = instanceIdRef.current;
      const cur = readLock();

      // Determine expiry using either expiresAt (preferred) or ts TTL (back-compat)
      const expiredByExpiresAt = cur?.expiresAt ? now >= Number(cur.expiresAt) : false;
      const expiredByTs = cur?.ts ? now - Number(cur.ts) >= LOCK_TTL_MS : true;

      // If lock is free/expired/ours -> refresh and run
      const canTake = !cur || cur.id === id || expiredByExpiresAt || expiredByTs || !cur.id;

      if (canTake) {
        writeLock({ id, ts: now, expiresAt: now + LOCK_TTL_MS });
        leaderRef.current = true;
        return true;
      }

      leaderRef.current = false;
      return false;
    };

    const t = setInterval(async () => {
      if (runningRef.current) return;
      if (!dbRef.current) return;
      if (!online) return;

      // Only one tab/process should poll + submit at a time
      if (!ensureLeader()) return;

      runningRef.current = true;
      try {
        // Servicing first, then CallOut
        const didServicing = await processOneJob(dbRef.current);
        if (!didServicing) {
          await processOneCalloutJob(dbRef.current);
        }
      } finally {
        runningRef.current = false;
      }
    }, 5000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  return null;
}

ReactDOM.render(
  <HashRouter>
    <ScrollToTop />
    <PresenceHeartbeat />
    <ServicingJobRunner />
    <HomePage />
  </HashRouter>,
  document.getElementById("root")
);
