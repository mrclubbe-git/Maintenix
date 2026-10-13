const fs = require("fs");
const path = require("path");

const {
  acquireLockSync,
  writeJsonAtomicSync
} = require("./lockedJson");

const DATA_FILE = path.join(__dirname, "..", "data", "user-preferences.json");
const LOCK_FILE = `${DATA_FILE}.lock`;

const DEFAULT_PREFERENCES = Object.freeze({
  notifications: Object.freeze({
    enabled: true,
    sound: false
  })
});

function defaultPreferences() {
  return {
    notifications: {
      enabled: DEFAULT_PREFERENCES.notifications.enabled,
      sound: DEFAULT_PREFERENCES.notifications.sound
    }
  };
}

function emptyDb() {
  return {
    version: 1,
    users: {}
  };
}

function userKey(user) {
  const id = String(user?.id || "").trim();
  if (id) return `id:${id}`;

  const email = String(user?.email || "").trim().toLowerCase();
  return email ? `email:${email}` : "";
}

function normalizePreferences(input) {
  const source = input && typeof input === "object" ? input : {};
  const notifications =
    source.notifications && typeof source.notifications === "object"
      ? source.notifications
      : {};

  const enabled = notifications.enabled !== false;
  const sound = enabled && notifications.sound === true;

  return {
    notifications: {
      enabled,
      sound
    }
  };
}

function normalizeDb(input) {
  return {
    version: 1,
    users:
      input?.users &&
      typeof input.users === "object" &&
      !Array.isArray(input.users)
        ? { ...input.users }
        : {}
  };
}

function ensureDataFileUnlocked() {
  if (fs.existsSync(DATA_FILE)) return;
  writeJsonAtomicSync(DATA_FILE, emptyDb());
}

function readDbUnlocked() {
  ensureDataFileUnlocked();

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
    if (!raw) return emptyDb();
    return normalizeDb(JSON.parse(raw));
  } catch {
    const backup = DATA_FILE.replace(/\.json$/i, `.corrupt.${Date.now()}.json`);
    try {
      fs.copyFileSync(DATA_FILE, backup);
    } catch {}

    const clean = emptyDb();
    writeJsonAtomicSync(DATA_FILE, clean);
    return clean;
  }
}

function getUserPreferences(user) {
  const key = userKey(user);
  if (!key) return defaultPreferences();

  const release = acquireLockSync(LOCK_FILE);
  try {
    const db = readDbUnlocked();
    return normalizePreferences(db.users[key] || DEFAULT_PREFERENCES);
  } finally {
    release();
  }
}

function updateUserPreferences(user, patch = {}) {
  const key = userKey(user);
  if (!key) return null;

  const release = acquireLockSync(LOCK_FILE);
  try {
    const db = readDbUnlocked();
    const current = normalizePreferences(db.users[key] || DEFAULT_PREFERENCES);

    const notificationsPatch =
      patch?.notifications &&
      typeof patch.notifications === "object" &&
      !Array.isArray(patch.notifications)
        ? patch.notifications
        : {};

    const next = normalizePreferences({
      notifications: {
        enabled:
          notificationsPatch.enabled === undefined
            ? current.notifications.enabled
            : notificationsPatch.enabled,
        sound:
          notificationsPatch.sound === undefined
            ? current.notifications.sound
            : notificationsPatch.sound
      }
    });

    db.users[key] = next;
    writeJsonAtomicSync(DATA_FILE, db);
    return next;
  } finally {
    release();
  }
}

module.exports = {
  DEFAULT_PREFERENCES,
  getUserPreferences,
  updateUserPreferences
};
