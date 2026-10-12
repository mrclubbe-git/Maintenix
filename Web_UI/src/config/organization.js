const envCode = String(process.env.REACT_APP_ORGANIZATION_CODE || "CRA").trim().toUpperCase();
const envName = String(
  process.env.REACT_APP_ORGANIZATION_NAME || "Collaborative Risk Applications"
).trim();

export const ORGANIZATION = Object.freeze({
  code: envCode || "CRA",
  name: envName || "Collaborative Risk Applications"
});

const STORAGE_PREFIX = `maintenix:${ORGANIZATION.code}:`;

export const orgLocalStorage = {
  getItem(key) {
    return window.localStorage.getItem(STORAGE_PREFIX + String(key));
  },
  setItem(key, value) {
    return window.localStorage.setItem(STORAGE_PREFIX + String(key), value);
  },
  removeItem(key) {
    return window.localStorage.removeItem(STORAGE_PREFIX + String(key));
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

// CRA predates organization-scoped browser storage. Migrate its known
// localStorage values once so existing users remain signed in after the move
// from /Maintenix/ to /Maintenix/CRA/.
export function migrateLegacyCraLocalStorage() {
  if (ORGANIZATION.code !== "CRA") return;

  const legacyKeys = [
    "authToken",
    "authUser",
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
}

// CRA keeps its historical IndexedDB names so queued jobs and browser caches
// survive this migration. Any future organization receives a distinct DB name.
export function organizationDbName(baseName) {
  const base = String(baseName || "maintenix");
  if (ORGANIZATION.code === "CRA") return base;
  return `${base}_${ORGANIZATION.code.toLowerCase()}`;
}
