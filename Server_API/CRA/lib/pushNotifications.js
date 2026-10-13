const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const webpush = require("web-push");

const { acquireLockSync, writeJsonAtomicSync } = require("./lockedJson");
const { getUsers } = require("./userStore");

const DATA_FILE = path.join(__dirname, "..", "data", "push-subscriptions.json");
const LOCK_FILE = `${DATA_FILE}.lock`;

function nowIso() {
  return new Date().toISOString();
}

function emptyDb() {
  return { version: 1, subscriptions: [] };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function userKey(user) {
  return String(user?.id || "").trim() || normalizeEmail(user?.email);
}

function ensureFileUnlocked() {
  if (!fs.existsSync(DATA_FILE)) {
    writeJsonAtomicSync(DATA_FILE, emptyDb());
  }
}

function readDbUnlocked() {
  ensureFileUnlocked();

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
    if (!raw) return emptyDb();
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      subscriptions: Array.isArray(parsed?.subscriptions) ? parsed.subscriptions : []
    };
  } catch {
    const backup = DATA_FILE.replace(/\.json$/i, `.corrupt.${Date.now()}.json`);
    try { fs.copyFileSync(DATA_FILE, backup); } catch {}
    const clean = emptyDb();
    writeJsonAtomicSync(DATA_FILE, clean);
    return clean;
  }
}

function writeDbUnlocked(db) {
  writeJsonAtomicSync(DATA_FILE, {
    version: 1,
    subscriptions: Array.isArray(db?.subscriptions) ? db.subscriptions : []
  });
}

function pushConfigured() {
  return Boolean(
    String(process.env.VAPID_SUBJECT || "").trim() &&
    String(process.env.VAPID_PUBLIC_KEY || "").trim() &&
    String(process.env.VAPID_PRIVATE_KEY || "").trim()
  );
}

function configureWebPush() {
  if (!pushConfigured()) return false;

  webpush.setVapidDetails(
    String(process.env.VAPID_SUBJECT || "").trim(),
    String(process.env.VAPID_PUBLIC_KEY || "").trim(),
    String(process.env.VAPID_PRIVATE_KEY || "").trim()
  );
  return true;
}

function getPublicKey() {
  return pushConfigured() ? String(process.env.VAPID_PUBLIC_KEY || "").trim() : "";
}

function validateSubscription(subscription) {
  if (!subscription || typeof subscription !== "object") return null;

  const endpoint = String(subscription.endpoint || "").trim();
  const p256dh = String(subscription?.keys?.p256dh || "").trim();
  const auth = String(subscription?.keys?.auth || "").trim();

  if (!endpoint.startsWith("https://") || !p256dh || !auth) return null;

  return {
    endpoint,
    expirationTime: subscription.expirationTime || null,
    keys: { p256dh, auth }
  };
}

function upsertSubscription(user, subscription, meta = {}) {
  const clean = validateSubscription(subscription);
  const key = userKey(user);
  if (!clean || !key) return null;

  const release = acquireLockSync(LOCK_FILE);
  try {
    const db = readDbUnlocked();
    const now = nowIso();
    const existingIndex = db.subscriptions.findIndex((item) => item.endpoint === clean.endpoint);
    const record = {
      id: existingIndex >= 0
        ? db.subscriptions[existingIndex].id
        : `push_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      userId: String(user?.id || "").trim(),
      userEmail: normalizeEmail(user?.email),
      endpoint: clean.endpoint,
      expirationTime: clean.expirationTime,
      keys: clean.keys,
      userAgent: String(meta?.userAgent || "").trim().slice(0, 500),
      createdAt: existingIndex >= 0 ? db.subscriptions[existingIndex].createdAt : now,
      updatedAt: now
    };

    if (existingIndex >= 0) db.subscriptions[existingIndex] = record;
    else db.subscriptions.push(record);

    writeDbUnlocked(db);
    return record;
  } finally {
    release();
  }
}

function removeSubscription(user, endpoint) {
  const cleanEndpoint = String(endpoint || "").trim();
  const id = String(user?.id || "").trim();
  const email = normalizeEmail(user?.email);
  if (!cleanEndpoint || (!id && !email)) return false;

  const release = acquireLockSync(LOCK_FILE);
  try {
    const db = readDbUnlocked();
    const before = db.subscriptions.length;
    db.subscriptions = db.subscriptions.filter((item) => {
      if (item.endpoint !== cleanEndpoint) return true;
      const owns =
        (id && String(item.userId || "") === id) ||
        (email && normalizeEmail(item.userEmail) === email);
      return !owns;
    });
    if (db.subscriptions.length !== before) writeDbUnlocked(db);
    return db.subscriptions.length !== before;
  } finally {
    release();
  }
}

function removeEndpoint(endpoint) {
  const cleanEndpoint = String(endpoint || "").trim();
  if (!cleanEndpoint) return false;

  const release = acquireLockSync(LOCK_FILE);
  try {
    const db = readDbUnlocked();
    const before = db.subscriptions.length;
    db.subscriptions = db.subscriptions.filter((item) => item.endpoint !== cleanEndpoint);
    if (db.subscriptions.length !== before) writeDbUnlocked(db);
    return db.subscriptions.length !== before;
  } finally {
    release();
  }
}

function subscriptionsForUser(user) {
  const id = String(user?.id || "").trim();
  const email = normalizeEmail(user?.email);

  const release = acquireLockSync(LOCK_FILE);
  try {
    return readDbUnlocked().subscriptions.filter((item) =>
      (id && String(item.userId || "") === id) ||
      (email && normalizeEmail(item.userEmail) === email)
    );
  } finally {
    release();
  }
}

function notificationVisibleToUser(notification, user) {
  if (!notification || !user) return false;

  const scope = String(notification.scope || "GLOBAL").toUpperCase();
  if (scope === "GLOBAL") {
    const roles = Array.isArray(notification.targetRoles)
      ? notification.targetRoles.map((role) => String(role || "").trim().toUpperCase()).filter(Boolean)
      : [];
    if (!roles.length) return true;
    return roles.includes(String(user?.role || "").trim().toUpperCase());
  }

  const targetUserId = String(notification.targetUserId || "").trim().toLowerCase();
  const targetEmail = normalizeEmail(notification.targetUserEmail || notification.userEmail);
  const id = String(user?.id || "").trim().toLowerCase();
  const email = normalizeEmail(user?.email);

  return Boolean(
    (targetUserId && id && targetUserId === id) ||
    (targetEmail && email && targetEmail === email)
  );
}

function subscriptionsForNotification(notification) {
  const users = getUsers();
  const byId = new Map(users.map((user) => [String(user?.id || "").trim(), user]));
  const byEmail = new Map(users.map((user) => [normalizeEmail(user?.email), user]));

  const release = acquireLockSync(LOCK_FILE);
  try {
    return readDbUnlocked().subscriptions.filter((item) => {
      const user =
        byId.get(String(item.userId || "").trim()) ||
        byEmail.get(normalizeEmail(item.userEmail));
      return notificationVisibleToUser(notification, user);
    });
  } finally {
    release();
  }
}

function pushPayload(notification) {
  return JSON.stringify({
    title: String(notification?.title || "Maintenix").trim() || "Maintenix",
    body: String(notification?.message || "").trim(),
    icon: "./android-chrome-192x192.png",
    badge: "./android-chrome-192x192.png",
    tag: String(notification?.id || "").trim() || undefined,
    data: {
      notificationId: String(notification?.id || "").trim(),
      url: String(notification?.actionUrl || "").trim() || "./",
      requiresAck: !!notification?.requiresAck
    }
  });
}

async function sendToRecord(record, payload, options = {}) {
  try {
    await webpush.sendNotification(
      {
        endpoint: record.endpoint,
        expirationTime: record.expirationTime || null,
        keys: record.keys
      },
      payload,
      {
        TTL: Number(options.TTL || 300),
        urgency: options.urgency || "normal"
      }
    );
    return { ok: true };
  } catch (error) {
    const statusCode = Number(error?.statusCode || 0);
    if (statusCode === 404 || statusCode === 410) {
      removeEndpoint(record.endpoint);
    }
    return {
      ok: false,
      statusCode,
      message: String(error?.message || "Push delivery failed.")
    };
  }
}

async function sendNotificationPush(notification) {
  if (!configureWebPush()) {
    return { ok: false, configured: false, sent: 0 };
  }

  const records = subscriptionsForNotification(notification);
  if (!records.length) return { ok: true, configured: true, sent: 0 };

  const payload = pushPayload(notification);
  const urgency = notification?.requiresAck || String(notification?.severity || "").toLowerCase() === "danger"
    ? "high"
    : "normal";

  const results = await Promise.all(records.map((record) =>
    sendToRecord(record, payload, { TTL: 300, urgency })
  ));

  return {
    ok: true,
    configured: true,
    sent: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length
  };
}

function queueNotificationPush(notification) {
  Promise.resolve()
    .then(() => sendNotificationPush(notification))
    .catch(() => {});
}

async function sendTestPush(user) {
  if (!configureWebPush()) {
    return { ok: false, configured: false, sent: 0 };
  }

  const records = subscriptionsForUser(user);
  if (!records.length) {
    return { ok: false, configured: true, sent: 0, message: "No device subscription found." };
  }

  const payload = JSON.stringify({
    title: "Maintenix device notifications",
    body: "Device notifications are working on this device.",
    icon: "./android-chrome-192x192.png",
    badge: "./android-chrome-192x192.png",
    tag: `maintenix_push_test_${Date.now()}`,
    data: { url: "./", test: true }
  });

  const results = await Promise.all(records.map((record) =>
    sendToRecord(record, payload, { TTL: 60, urgency: "normal" })
  ));

  return {
    ok: results.some((result) => result.ok),
    configured: true,
    sent: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length
  };
}

module.exports = {
  pushConfigured,
  getPublicKey,
  upsertSubscription,
  removeSubscription,
  queueNotificationPush,
  sendTestPush
};
