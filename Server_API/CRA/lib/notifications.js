const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { acquireLockSync, writeJsonAtomicSync } = require("./lockedJson");
const { enqueueNotificationDelivery } = require("./notificationDelivery");

const DATA_FILE =
  process.env.MAINTENIX_NOTIFICATIONS_FILE ||
  path.join(__dirname, "..", "data", "notifications.json");
const LOCK_FILE = `${DATA_FILE}.lock`;
const MAX_NOTIFICATIONS = 2000;

function nowIso() {
  return new Date().toISOString();
}

function emptyDb() {
  return { version: 2, notifications: [] };
}

function safeRole(role) {
  return String(role || "").trim().toUpperCase().replace(/\s+/g, "");
}

function userKey(user) {
  return String(user?.id || user?.email || "").trim().toLowerCase();
}

function userEmail(user) {
  return String(user?.email || "").trim().toLowerCase();
}

function userLabel(user) {
  return String(user?.name || user?.email || user?.id || "User").trim();
}

function normalizeChannels(value) {
  const source = Array.isArray(value) ? value : ["IN_APP", "PUSH"];
  return [...new Set(source.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean))];
}

function normalizeNotification(input) {
  const createdAt = input?.createdAt || nowIso();
  const type = String(input?.type || input?.eventType || "INFO").trim().toUpperCase();
  return {
    id: input?.id || `ntf_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    eventType: String(input?.eventType || type).trim().toUpperCase(),
    type,
    category: String(input?.category || "GENERAL").trim().toUpperCase(),
    scope: input?.scope === "USER" ? "USER" : "GLOBAL",
    title: String(input?.title || "Notification").trim(),
    message: String(input?.message || "").trim(),
    severity: String(input?.severity || "info").trim().toLowerCase(),
    mandatory: !!input?.mandatory,
    deliveryChannels: normalizeChannels(input?.deliveryChannels),
    createdByUserId: String(input?.createdByUserId || "").trim(),
    createdByEmail: String(input?.createdByEmail || "").trim().toLowerCase(),
    createdByName: String(input?.createdByName || "").trim(),
    targetUserId: String(input?.targetUserId || "").trim(),
    targetUserEmail: String(input?.targetUserEmail || input?.userEmail || "").trim().toLowerCase(),
    targetRoles: Array.isArray(input?.targetRoles) ? input.targetRoles.map(safeRole).filter(Boolean) : [],
    relatedEntityType: String(input?.relatedEntityType || "").trim(),
    relatedEntityId: String(input?.relatedEntityId || "").trim(),
    sourceEventId: String(input?.sourceEventId || "").trim(),
    idempotencyKey: String(input?.idempotencyKey || "").trim(),
    actionUrl: String(input?.actionUrl || "").trim(),
    requiresAck: !!input?.requiresAck,
    createdAt,
    expiresAt: input?.expiresAt || null,
    readBy: Array.isArray(input?.readBy) ? input.readBy : [],
    clearedBy: Array.isArray(input?.clearedBy) ? input.clearedBy : [],
    acknowledgements: Array.isArray(input?.acknowledgements) ? input.acknowledgements : []
  };
}

function normalizeDb(input) {
  return {
    version: 2,
    notifications: Array.isArray(input?.notifications)
      ? input.notifications.map((item) => normalizeNotification(item))
      : []
  };
}

function readDbUnlocked() {
  if (!fs.existsSync(DATA_FILE)) {
    const clean = emptyDb();
    writeJsonAtomicSync(DATA_FILE, clean);
    return clean;
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
    return raw ? normalizeDb(JSON.parse(raw)) : emptyDb();
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
    version: 2,
    notifications: Array.isArray(db?.notifications)
      ? db.notifications.slice(0, MAX_NOTIFICATIONS)
      : []
  });
}

function withDbLock(mutator) {
  const release = acquireLockSync(LOCK_FILE);
  try {
    const db = readDbUnlocked();
    const result = mutator(db);
    writeDbUnlocked(db);
    return result;
  } finally {
    release();
  }
}

function readDb() {
  const release = acquireLockSync(LOCK_FILE);
  try {
    return readDbUnlocked();
  } finally {
    release();
  }
}

function hasUser(list, user) {
  const keys = new Set([userKey(user), userEmail(user)].filter(Boolean));
  return (Array.isArray(list) ? list : []).some((entry) => {
    const value = typeof entry === "string" ? entry : (entry?.userId || entry?.email || "");
    return keys.has(String(value || "").trim().toLowerCase());
  });
}

function visibleToUser(notification, user) {
  if (!notification || typeof notification !== "object") return false;
  if (notification.scope === "GLOBAL" || notification.global === true) {
    const roles = Array.isArray(notification.targetRoles)
      ? notification.targetRoles.map(safeRole).filter(Boolean)
      : [];
    return roles.length === 0 || roles.includes(safeRole(user?.role));
  }

  const targetUserId = String(notification.targetUserId || "").trim().toLowerCase();
  const targetEmail = String(notification.targetUserEmail || notification.userEmail || "").trim().toLowerCase();
  return (
    (!!targetUserId && targetUserId === userKey(user)) ||
    (!!targetEmail && targetEmail === userEmail(user))
  );
}

function createNotification(input) {
  let created = null;
  const notification = withDbLock((db) => {
    const candidate = normalizeNotification(input || {});
    if (candidate.idempotencyKey) {
      const existing = db.notifications.find(
        (item) => String(item?.idempotencyKey || "") === candidate.idempotencyKey
      );
      if (existing) return existing;
    }

    db.notifications.unshift(candidate);
    db.notifications = db.notifications.slice(0, MAX_NOTIFICATIONS);
    created = candidate;
    return candidate;
  });

  if (created) {
    try { enqueueNotificationDelivery(created); } catch {}
  }
  return notification;
}

function notificationForClient(notification, user) {
  return {
    ...notification,
    read: hasUser(notification.readBy, user),
    acknowledged: hasUser(notification.acknowledgements, user),
    acknowledgementCount: Array.isArray(notification.acknowledgements)
      ? notification.acknowledgements.length
      : 0
  };
}

function listForUser(user, { includeCleared = false } = {}) {
  const now = Date.now();
  return readDb().notifications
    .filter((notification) => visibleToUser(notification, user))
    .filter((notification) => {
      if (!notification.expiresAt) return true;
      const expiresAt = Date.parse(notification.expiresAt);
      return Number.isNaN(expiresAt) || expiresAt >= now;
    })
    .filter((notification) => includeCleared || !hasUser(notification.clearedBy, user))
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
    .map((notification) => notificationForClient(notification, user));
}

function markRead(id, user) {
  const out = withDbLock((db) => {
    let updated = null;
    db.notifications = db.notifications.map((notification) => {
      if (String(notification.id) !== String(id) || !visibleToUser(notification, user)) return notification;
      const readBy = Array.isArray(notification.readBy) ? [...notification.readBy] : [];
      if (!hasUser(readBy, user)) readBy.push({ userId: user?.id || "", email: user?.email || "", at: nowIso() });
      updated = { ...notification, readBy };
      return updated;
    });
    return updated;
  });
  return out ? notificationForClient(out, user) : null;
}

function markAllRead(user) {
  return withDbLock((db) => {
    let count = 0;
    db.notifications = db.notifications.map((notification) => {
      if (!visibleToUser(notification, user) || hasUser(notification.readBy, user)) return notification;
      count += 1;
      return {
        ...notification,
        readBy: [
          ...(Array.isArray(notification.readBy) ? notification.readBy : []),
          { userId: user?.id || "", email: user?.email || "", at: nowIso() }
        ]
      };
    });
    return count;
  });
}

function acknowledgementNoticeFor(notification, user) {
  if (!notification.createdByUserId && !notification.createdByEmail) return null;
  return normalizeNotification({
    eventType: "ACKNOWLEDGEMENT",
    type: "ACKNOWLEDGEMENT",
    category: "SYSTEM",
    scope: "USER",
    title: "Notification acknowledged",
    message: `${userLabel(user)} acknowledged: ${notification.title || notification.message || "Notification"}`,
    severity: "success",
    createdByUserId: user?.id || "",
    createdByEmail: user?.email || "",
    createdByName: userLabel(user),
    targetUserId: notification.createdByUserId || "",
    targetUserEmail: notification.createdByEmail || "",
    relatedEntityType: "notification",
    relatedEntityId: notification.id,
    idempotencyKey: `ACKNOWLEDGEMENT:${notification.id}:${userKey(user)}`
  });
}

function acknowledgeMatching(predicate, user, { createAckNotice = true } = {}) {
  const ackNotices = [];
  const out = withDbLock((db) => {
    const updatedNotifications = [];
    const ackAt = nowIso();

    db.notifications = db.notifications.map((notification) => {
      if (!predicate(notification) || !visibleToUser(notification, user) || !notification.requiresAck) return notification;

      const acknowledgements = Array.isArray(notification.acknowledgements)
        ? [...notification.acknowledgements]
        : [];
      const readBy = Array.isArray(notification.readBy) ? [...notification.readBy] : [];

      if (!hasUser(acknowledgements, user)) {
        acknowledgements.push({
          userId: user?.id || "",
          email: user?.email || "",
          name: userLabel(user),
          acknowledgedAt: ackAt
        });

        const ackNotice = createAckNotice ? acknowledgementNoticeFor(notification, user) : null;
        if (
          ackNotice &&
          !db.notifications.some(
            (item) => item.idempotencyKey && item.idempotencyKey === ackNotice.idempotencyKey
          )
        ) {
          ackNotices.push(ackNotice);
        }
      }

      if (!hasUser(readBy, user)) readBy.push({ userId: user?.id || "", email: user?.email || "", at: ackAt });

      const updated = { ...notification, acknowledgements, readBy };
      updatedNotifications.push(updated);
      return updated;
    });

    if (ackNotices.length) db.notifications.unshift(...ackNotices);
    db.notifications = db.notifications.slice(0, MAX_NOTIFICATIONS);
    return updatedNotifications;
  });

  for (const notice of ackNotices) {
    try { enqueueNotificationDelivery(notice); } catch {}
  }

  return out.map((notification) => notificationForClient(notification, user));
}

function acknowledge(id, user) {
  return acknowledgeMatching((notification) => String(notification.id) === String(id), user)[0] || null;
}

function acknowledgeRelatedEntity(relatedEntityType, relatedEntityId, user, options = {}) {
  const type = String(relatedEntityType || "").trim();
  const id = String(relatedEntityId || "").trim();
  if (!type || !id) return [];
  return acknowledgeMatching(
    (notification) =>
      String(notification.relatedEntityType || "") === type &&
      String(notification.relatedEntityId || "") === id,
    user,
    options
  );
}

function clearVisible(user) {
  return withDbLock((db) => {
    let count = 0;
    db.notifications = db.notifications.map((notification) => {
      if (!visibleToUser(notification, user)) return notification;
      if (notification.requiresAck && !hasUser(notification.acknowledgements, user)) return notification;
      if (hasUser(notification.clearedBy, user)) return notification;
      count += 1;
      return {
        ...notification,
        clearedBy: [
          ...(Array.isArray(notification.clearedBy) ? notification.clearedBy : []),
          { userId: user?.id || "", email: user?.email || "", at: nowIso() }
        ]
      };
    });
    return count;
  });
}

function getAcknowledgements(id, user) {
  const notification = readDb().notifications.find((item) => String(item.id) === String(id));
  if (!notification || !visibleToUser(notification, user)) return null;
  return Array.isArray(notification.acknowledgements) ? notification.acknowledgements : [];
}

function getNotificationById(id) {
  return readDb().notifications.find((item) => String(item.id) === String(id)) || null;
}

module.exports = {
  createNotification,
  listForUser,
  markRead,
  markAllRead,
  acknowledge,
  acknowledgeRelatedEntity,
  clearVisible,
  getAcknowledgements,
  getNotificationById,
  userLabel,
  safeRole
};
