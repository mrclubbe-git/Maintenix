const envCode = String(process.env.REACT_APP_ORGANIZATION_CODE || "CRA").trim().toUpperCase();
const envName = String(
  process.env.REACT_APP_ORGANIZATION_NAME || "Collaborative Risk Applications"
).trim();

export const ORGANIZATION = Object.freeze({
  code: envCode || "CRA",
  name: envName || "Collaborative Risk Applications"
});

const STORAGE_PREFIX = `maintenix:${ORGANIZATION.code}:`;
const SESSION_MARKER_KEY = STORAGE_PREFIX + "authSessionActive";
const LEGACY_TOKEN_KEY = STORAGE_PREFIX + "authToken";

export const AUTH_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  enabled: true,
  sound: false
});

function notificationPreferencesStorageKey(userId) {
  const id = String(userId || "anonymous").trim() || "anonymous";
  return `notificationPreferences:${id}`;
}

export function getNotificationPreferences(userId) {
  const fallback = { ...DEFAULT_NOTIFICATION_PREFERENCES };

  try {
    const raw = orgLocalStorage.getItem(notificationPreferencesStorageKey(userId));
    if (!raw) return fallback;

    const parsed = JSON.parse(raw);
    return {
      enabled: parsed?.enabled !== false,
      sound: parsed?.sound === true
    };
  } catch {
    return fallback;
  }
}

export function setNotificationPreferences(userId, patch = {}) {
  const current = getNotificationPreferences(userId);
  const next = {
    enabled: patch.enabled === undefined ? current.enabled : patch.enabled !== false,
    sound: patch.sound === undefined ? current.sound : patch.sound === true
  };

  if (!next.enabled) next.sound = false;

  orgLocalStorage.setItem(
    notificationPreferencesStorageKey(userId),
    JSON.stringify(next)
  );

  try {
    window.dispatchEvent(new CustomEvent("notificationPreferencesUpdated", {
      detail: { userId: String(userId || ""), preferences: next }
    }));
  } catch {}

  return next;
}

export const orgLocalStorage = {
  getItem(key) {
    const wanted = String(key);
    if (wanted === "authToken") {
      // Compatibility shim for existing components: this is only a boolean
      // session marker, never the server credential. The real credential is
      // held exclusively in a Secure, HttpOnly cookie.
      return window.localStorage.getItem(SESSION_MARKER_KEY) === "1" ? "cookie-session" : null;
    }
    return window.localStorage.getItem(STORAGE_PREFIX + wanted);
  },
  setItem(key, value) {
    const wanted = String(key);
    if (wanted === "authToken") {
      window.localStorage.removeItem(LEGACY_TOKEN_KEY);
      if (String(value || "").trim()) {
        window.localStorage.setItem(SESSION_MARKER_KEY, "1");
      } else {
        window.localStorage.removeItem(SESSION_MARKER_KEY);
      }
      return;
    }
    return window.localStorage.setItem(STORAGE_PREFIX + wanted, value);
  },
  removeItem(key) {
    const wanted = String(key);
    if (wanted === "authToken") {
      window.localStorage.removeItem(LEGACY_TOKEN_KEY);
      return window.localStorage.removeItem(SESSION_MARKER_KEY);
    }
    return window.localStorage.removeItem(STORAGE_PREFIX + wanted);
  }
};

export const orgSessionStorage = {
  getItem(key) {
    return window.sessionStorage.getItem(STORAGE_PREFIX + String(key));
  },
  setItem(key, value) {
    return window.sessionStorage.setItem(STORAGE_PREFIX + String(key), value);
  },
  removeItem(key) {
    return window.sessionStorage.removeItem(STORAGE_PREFIX + String(key));
  }
};

export function setOrgCsrfToken(value) {
  try {
    window.__maintenixSetCsrfToken?.(String(value || ""));
  } catch {}
}

export function clearOrgCsrfToken() {
  try {
    window.__maintenixClearCsrfToken?.();
  } catch {}
}

export function hasOrgAuthSession() {
  return window.localStorage.getItem(SESSION_MARKER_KEY) === "1";
}

export function clearOrgAuth() {
  window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  window.localStorage.removeItem(SESSION_MARKER_KEY);
  orgLocalStorage.removeItem("authUser");
  orgLocalStorage.removeItem("authExpiresAt");
  clearOrgCsrfToken();
  try {
    window.dispatchEvent(new Event("authUserUpdated"));
  } catch {}
}

export function setOrgAuth(user, expiresAt, csrfToken = "") {
  const suppliedExpiry = Number(expiresAt || 0);
  const expiry = Number.isFinite(suppliedExpiry) && suppliedExpiry > Date.now()
    ? suppliedExpiry
    : Date.now() + AUTH_SESSION_TTL_MS;

  window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  window.localStorage.setItem(SESSION_MARKER_KEY, "1");
  orgLocalStorage.setItem("authUser", JSON.stringify(user || null));
  orgLocalStorage.setItem("authExpiresAt", String(expiry));
  setOrgCsrfToken(csrfToken);

  try {
    window.dispatchEvent(new Event("authUserUpdated"));
  } catch {}

  return expiry;
}

export function getOrgAuthExpiresAt() {
  const value = Number(orgLocalStorage.getItem("authExpiresAt") || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function ensureOrgAuthExpiresAt() {
  if (!hasOrgAuthSession()) return 0;

  const existing = getOrgAuthExpiresAt();
  if (existing > 0) return existing;

  const expiry = Date.now() + AUTH_SESSION_TTL_MS;
  orgLocalStorage.setItem("authExpiresAt", String(expiry));
  return expiry;
}

export function isOrgAuthExpired(now = Date.now()) {
  if (!hasOrgAuthSession()) return false;
  const expiry = ensureOrgAuthExpiresAt();
  return expiry > 0 && Number(now) >= expiry;
}

export async function logoutOrgSession() {
  try {
    let response = await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });

    // A newly opened tab can have the HttpOnly session cookie before the
    // in-memory CSRF value is hydrated. Fetch it once and retry logout.
    if (response.status === 403) {
      const csrfResponse = await fetch("/api/auth/csrf", { cache: "no-store" });
      const csrfBody = await csrfResponse.json().catch(() => ({}));
      if (csrfResponse.ok && csrfBody?.csrfToken) {
        setOrgCsrfToken(csrfBody.csrfToken);
        response = await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
      }
    }

    return response.ok;
  } catch {
    return false;
  } finally {
    clearOrgAuth();
  }
}

// CRA predates organization-scoped browser storage. Migrate its known
// non-secret localStorage values once. Any historical bearer token is
// intentionally discarded and never copied into the organization namespace.
export function migrateLegacyCraLocalStorage() {
  if (ORGANIZATION.code !== "CRA") return;

  try {
    window.localStorage.removeItem("authToken");
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {}

  const legacyKeys = [
    "authUser",
    "authExpiresAt",
    "settingsVisible",
    "appNotifications"
  ];

  legacyKeys.forEach((key) => {
    try {
      const scopedKey = STORAGE_PREFIX + key;
      const existing = window.localStorage.getItem(scopedKey);
      const legacy = window.localStorage.getItem(key);

      if (existing === null && legacy !== null) {
        window.localStorage.setItem(scopedKey, legacy);
      }

      if (legacy !== null) {
        window.localStorage.removeItem(key);
      }
    } catch {}
  });

  // Existing pre-cookie sessions must sign in once after this migration.
  if (!window.localStorage.getItem(SESSION_MARKER_KEY)) {
    orgLocalStorage.removeItem("authUser");
    orgLocalStorage.removeItem("authExpiresAt");
  }
}

export function organizationDbName(baseName) {
  const base = String(baseName || "maintenix");
  if (ORGANIZATION.code === "CRA") return base;
  return `${base}_${ORGANIZATION.code.toLowerCase()}`;
}
