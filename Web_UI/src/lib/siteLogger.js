import { orgLocalStorage, organizationDbName } from "../config/organization";

const STORE = "outbox";
const MAX_QUEUE = 250;
const FLUSH_INTERVAL_MS = 30000;
let started = false;
let dbPromise = null;
let flushing = false;

function readAuthUser() {
  try { return JSON.parse(orgLocalStorage.getItem("authUser") || "null"); }
  catch { return null; }
}

function appBuild() {
  try {
    const script = Array.from(document.scripts || [])
      .map((item) => item.getAttribute("src") || "")
      .find((src) => /\/static\/js\/main\.[^/]+\.js(?:\?|$)/.test(src));
    if (!script) return "";
    const match = /main\.([^.]+)\.js/.exec(script);
    return match ? match[1] : script.slice(-120);
  } catch {
    return "";
  }
}

function safeText(value, max = 2000) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(organizationDbName("maintenix_site_logs"), 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function idbPut(db, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE).put(value);
  });
}

function idbDelete(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE).delete(id);
  });
}

function idbAll(db) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function trimQueue(db) {
  const all = (await idbAll(db)).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  const extra = Math.max(0, all.length - MAX_QUEUE);
  for (let i = 0; i < extra; i += 1) await idbDelete(db, all[i].id);
}

function buildRecord(input = {}) {
  const user = readAuthUser();
  if (!user?.id) return null;

  return {
    id: `clientlog_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    createdAt: Date.now(),
    userId: String(user.id),
    payload: {
      level: safeText(input.level || "ERROR", 20).toUpperCase(),
      category: safeText(input.category || "CLIENT", 80).toUpperCase(),
      event: safeText(input.event || "CLIENT_EVENT", 120).toUpperCase(),
      message: safeText(input.message || "", 1000),
      requestId: safeText(input.requestId || "", 120),
      route: safeText(input.route || window.location.hash || window.location.pathname, 240),
      method: safeText(input.method || "", 16),
      status: Number.isFinite(Number(input.status)) ? Number(input.status) : null,
      area: safeText(input.area || "", 160),
      entityId: safeText(input.entityId || "", 180),
      appVersion: appBuild(),
      device: {
        userAgent: safeText(navigator.userAgent || "", 400),
        platform: safeText(navigator.platform || "", 120),
        language: safeText(navigator.language || "", 40),
        online: navigator.onLine !== false
      },
      details: input.details && typeof input.details === "object" ? input.details : {}
    }
  };
}

async function sendRecord(record) {
  if (!record?.payload || !navigator.onLine) return false;
  const current = readAuthUser();
  if (!current?.id || String(current.id) !== String(record.userId)) return false;

  const response = await fetch("/api/site-logs/client", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record.payload),
    cache: "no-store"
  });
  return response.ok;
}

async function queueRecord(record) {
  if (!record) return;
  try {
    const db = await openDb();
    await idbPut(db, record);
    await trimQueue(db);
  } catch {}
}

export async function logSiteEvent(input = {}) {
  const record = buildRecord(input);
  if (!record) return false;

  if (navigator.onLine) {
    try {
      if (await sendRecord(record)) return true;
    } catch {}
  }

  await queueRecord(record);
  return false;
}

export async function flushSiteLogOutbox() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const db = await openDb();
    const current = readAuthUser();
    if (!current?.id) return;

    const all = (await idbAll(db)).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    for (const record of all) {
      if (String(record.userId || "") !== String(current.id)) continue;
      try {
        if (await sendRecord(record)) await idbDelete(db, record.id);
        else break;
      } catch {
        break;
      }
    }
  } catch {
    // Best-effort diagnostics must never break the application.
  } finally {
    flushing = false;
  }
}

function errorStack(value) {
  return safeText(value?.stack || "", 4000);
}

export function startSiteLogger() {
  if (started || typeof window === "undefined") return () => {};
  started = true;

  const onError = (event) => {
    logSiteEvent({
      level: "ERROR",
      category: "CLIENT",
      event: "FRONTEND_ERROR",
      message: event?.message || "Unhandled browser error.",
      details: {
        filename: safeText(event?.filename || "", 300),
        line: Number(event?.lineno || 0),
        column: Number(event?.colno || 0),
        stack: errorStack(event?.error)
      }
    }).catch(() => {});
  };

  const onRejection = (event) => {
    const reason = event?.reason;
    logSiteEvent({
      level: "ERROR",
      category: "CLIENT",
      event: "UNHANDLED_REJECTION",
      message: safeText(reason?.message || reason || "Unhandled promise rejection.", 1000),
      details: { stack: errorStack(reason) }
    }).catch(() => {});
  };

  const onApiError = (event) => {
    const detail = event?.detail || {};
    logSiteEvent({
      level: detail.networkError ? "WARN" : "ERROR",
      category: "API",
      event: detail.networkError ? "API_NETWORK_ERROR" : "API_SERVER_ERROR",
      message: detail.networkError
        ? "API request could not reach the server."
        : `API request failed with HTTP ${Number(detail.status || 0)}.`,
      requestId: detail.requestId || "",
      route: detail.path || "",
      method: detail.method || "",
      status: detail.status,
      details: {
        networkError: detail.networkError === true,
        error: safeText(detail.error || "", 1000)
      }
    }).catch(() => {});
  };

  const onOffline = () => {
    logSiteEvent({
      level: "WARN",
      category: "OFFLINE",
      event: "CONNECTIVITY_LOST",
      message: "Browser connectivity was lost."
    }).catch(() => {});
  };

  const onOnline = () => {
    logSiteEvent({
      level: "INFO",
      category: "OFFLINE",
      event: "CONNECTIVITY_RESTORED",
      message: "Browser connectivity was restored."
    }).finally(() => flushSiteLogOutbox());
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("maintenix:api-error", onApiError);
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  window.addEventListener("authUserUpdated", flushSiteLogOutbox);

  const timer = window.setInterval(flushSiteLogOutbox, FLUSH_INTERVAL_MS);
  window.setTimeout(flushSiteLogOutbox, 0);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("maintenix:api-error", onApiError);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("authUserUpdated", flushSiteLogOutbox);
    window.clearInterval(timer);
    started = false;
  };
}
