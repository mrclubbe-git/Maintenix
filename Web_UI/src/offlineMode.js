export const OFFLINE_AUTH_TOKEN_KEY = "offlineAuthToken";
export const OFFLINE_AUTH_USER_KEY = "offlineAuthUser";
export const OFFLINE_AUTH_EXPIRES_KEY = "offlineAuthExpiresAt";
export const OFFLINE_AUTH_LOADED_NOTICE_KEY = "offlineAuthLoadedNoticeAt";

const DB_NAME = "maintenix";
const DB_VERSION = 2;

export function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export function getUserKey(user) {
  return String(user?.id || user?.email || "user").trim().toLowerCase() || "user";
}

export function getOfflineSession() {
  const token = localStorage.getItem(OFFLINE_AUTH_TOKEN_KEY) || "";
  const user = safeJsonParse(localStorage.getItem(OFFLINE_AUTH_USER_KEY) || "null", null);
  const expiresAt = localStorage.getItem(OFFLINE_AUTH_EXPIRES_KEY) || "";
  return { token, user, expiresAt };
}

export function storeOfflineSession(token, user, ttlMs) {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  localStorage.setItem(OFFLINE_AUTH_TOKEN_KEY, token);
  localStorage.setItem(OFFLINE_AUTH_USER_KEY, JSON.stringify(user || {}));
  localStorage.setItem(OFFLINE_AUTH_EXPIRES_KEY, expiresAt);
  localStorage.setItem(OFFLINE_AUTH_LOADED_NOTICE_KEY, new Date().toISOString());
  return expiresAt;
}

export function clearOfflineSession() {
  localStorage.removeItem(OFFLINE_AUTH_TOKEN_KEY);
  localStorage.removeItem(OFFLINE_AUTH_USER_KEY);
  localStorage.removeItem(OFFLINE_AUTH_EXPIRES_KEY);
  localStorage.removeItem(OFFLINE_AUTH_LOADED_NOTICE_KEY);
}

function clearStore(db, storeName) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve(false);
      return;
    }
    const tx = db.transaction(storeName, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(storeName).clear();
  });
}

export async function clearOfflineModeCache() {
  const cleared = [];

  clearOfflineSession();
  localStorage.removeItem("maintenixOfflinePreparedAt");
  localStorage.removeItem("appNotifications");
  cleared.push("offline token");

  const db = await openMaintenixDb();
  await Promise.all([clearStore(db, "servicingCache"), clearStore(db, "calloutCache")]);
  db.close();
  cleared.push("offline data");

  if (typeof caches !== "undefined" && caches.keys) {
    const keys = await caches.keys();
    const maintenixKeys = keys.filter((key) => key.indexOf("maintenix") !== -1);
    await Promise.all(maintenixKeys.map((key) => caches.delete(key)));
    if (maintenixKeys.length) cleared.push("app shell");
  }

  window.dispatchEvent(new Event("notificationsUpdated"));
  return cleared;
}

export function isExpired(expiresAtIso) {
  if (!expiresAtIso) return true;
  const t = new Date(expiresAtIso).getTime();
  if (!Number.isFinite(t)) return true;
  return t <= Date.now();
}

function getChecklistPayload(data) {
  return data?.checklist && typeof data.checklist === "object" ? data.checklist : data;
}

export function openMaintenixDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Offline storage is not available in this browser."));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open offline storage."));
  });
}

export function cacheSet(db, storeName, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(storeName).put({ key, value, updatedAt: new Date().toISOString() });
  });
}

async function fetchJsonWithToken(url, token) {
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
}

export async function warmOfflineMode(token) {
  if (!token) throw new Error("Not logged in.");

  const db = await openMaintenixDb();
  const results = await Promise.allSettled([
    fetchJsonWithToken("/api/servicing/areas", token),
    fetchJsonWithToken("/api/servicing/services", token),
    fetchJsonWithToken("/api/servicing/checklist?type=substation", token),
    fetchJsonWithToken("/api/servicing/checklist?type=conveyor", token)
  ]);

  const summary = {
    cached: [],
    failed: []
  };

  const [areasRes, servicesRes, substationRes, conveyorRes] = results;

  if (areasRes.status === "fulfilled" && Array.isArray(areasRes.value?.areas)) {
    await cacheSet(db, "servicingCache", "areas", areasRes.value.areas);
    summary.cached.push("areas");
  } else {
    summary.failed.push("areas");
  }

  if (servicesRes.status === "fulfilled" && Array.isArray(servicesRes.value?.services)) {
    await cacheSet(db, "servicingCache", "services", servicesRes.value.services);
    summary.cached.push("services");
  } else {
    summary.failed.push("services");
  }

  if (substationRes.status === "fulfilled") {
    const checklist = getChecklistPayload(substationRes.value);
    await cacheSet(db, "servicingCache", "checklist_substation", checklist);
    await cacheSet(db, "servicingCache", "checklist", checklist);
    summary.cached.push("substation checklist");
  } else {
    summary.failed.push("substation checklist");
  }

  if (conveyorRes.status === "fulfilled") {
    await cacheSet(db, "servicingCache", "checklist_conveyor", getChecklistPayload(conveyorRes.value));
    summary.cached.push("conveyor checklist");
  } else {
    summary.failed.push("conveyor checklist");
  }

  if (!summary.cached.length) {
    throw new Error("Could not cache offline data. Check API connectivity and login session.");
  }

  localStorage.setItem("maintenixOfflinePreparedAt", new Date().toISOString());
  window.dispatchEvent(new Event("maintenixOfflinePrepared"));

  return summary;
}

function readLocalNotifications() {
  const raw = safeJsonParse(localStorage.getItem("appNotifications") || "[]", []);
  return Array.isArray(raw) ? raw : [];
}

function writeLocalNotifications(items) {
  localStorage.setItem("appNotifications", JSON.stringify(Array.isArray(items) ? items : []));
  window.dispatchEvent(new Event("notificationsUpdated"));
}

export function upsertLocalNotification(notification) {
  const next = notification && typeof notification === "object" ? notification : null;
  if (!next?.id) return;

  const items = readLocalNotifications();
  const existing = items.find((item) => item?.id === next.id);
  const merged = existing
    ? {
        ...(existing || {}),
        ...next,
        read: existing.read || next.read,
        acknowledged: existing.acknowledged || next.acknowledged,
        acknowledgementCount: existing.acknowledgementCount || next.acknowledgementCount || 0
      }
    : next;
  const without = items.filter((item) => item?.id !== next.id);
  without.unshift(merged);
  writeLocalNotifications(without);
}

export function updateLocalNotification(id, patch) {
  const items = readLocalNotifications();
  let changed = false;
  const next = items.map((item) => {
    if (item?.id !== id) return item;
    changed = true;
    return { ...(item || {}), ...(patch || {}) };
  });
  if (changed) writeLocalNotifications(next);
}

export function clearVisibleLocalNotifications() {
  const items = readLocalNotifications();
  const next = items.filter((item) => item?.requiresAck && !item?.acknowledged);
  writeLocalNotifications(next);
}

export function readVisibleLocalNotifications(authUser) {
  const key = getUserKey(authUser);
  return readLocalNotifications().filter((item) => {
    if (!item || typeof item !== "object") return false;
    if (item.hidden) return false;
    const target = String(item.userKey || "").trim().toLowerCase();
    return !target || target === key;
  });
}

export function notifyOfflineTokenLoaded(user) {
  const userKey = getUserKey(user);
  const createdAt = localStorage.getItem(OFFLINE_AUTH_LOADED_NOTICE_KEY) || new Date().toISOString();
  upsertLocalNotification({
    id: `offline_token_loaded_${userKey}_${createdAt.slice(0, 10) || "current"}`,
    userKey,
    local: true,
    title: "7 day token loaded successfully",
    message: "Offline mode is ready for this login session.",
    severity: "success",
    read: false,
    requiresAck: false,
    createdAt
  });
}

export function checkOfflineTokenNotifications(authUser) {
  const { token, user, expiresAt } = getOfflineSession();
  if (!token || !user?.email || isExpired(expiresAt)) return;

  const userKey = getUserKey(user);
  const expiresMs = new Date(expiresAt).getTime();
  const remainingMs = expiresMs - Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (remainingMs > 0 && remainingMs <= oneDayMs) {
    upsertLocalNotification({
      id: `offline_token_expiring_${userKey}`,
      userKey,
      local: true,
      title: "Offline token expires tomorrow",
      message: "Your 7 day offline token will expire in less than a day. Please log out and log back in to reset the token.",
      severity: "warning",
      read: false,
      requiresAck: true,
      acknowledged: false,
      acknowledgementCount: 0,
      actionUrl: "#/examples/sign-in",
      createdAt: new Date().toISOString()
    });
  }
}
