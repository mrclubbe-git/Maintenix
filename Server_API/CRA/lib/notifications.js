const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_FILE = path.join(__dirname, "..", "data", "notifications.json");

function nowIso() {
  return new Date().toISOString();
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

function ensureFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ notifications: [] }, null, 2), "utf8");
  }
}

function readDb() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
    if (!raw) return { notifications: [] };
    const parsed = JSON.parse(raw);
    return {
      notifications: Array.isArray(parsed?.notifications) ? parsed.notifications : []
    };
  } catch {
    const backup = DATA_FILE.replace(/\.json$/i, `.corrupt.${Date.now()}.json`);
    try { fs.copyFileSync(DATA_FILE, backup); } catch {}
    fs.writeFileSync(DATA_FILE, JSON.stringify({ notifications: [] }, null, 2), "utf8");
    return { notifications: [] };
  }
}

function writeDb(db) {
  ensureFile();
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ notifications: Array.isArray(db?.notifications) ? db.notifications : [] }, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

function newId(prefix = "ntf") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function hasUser(list, user) {
  const keys = new Set([
    userKey(user),
    userEmail(user)
  ].filter(Boolean));
  return (Array.isArray(list) ? list : []).some((entry) => {
    const value = typeof entry === "string" ? entry : (entry?.userId || entry?.email || "");
    return keys.has(String(value || "").trim().toLowerCase());
  });
}

function visibleToUser(notification, user) {
  if (!notification || typeof notification !== "object") return false;
  if (notification.scope === "GLOBAL" || notification.global === true) {
    const roles = Array.isArray(notification.targetRoles) ? notification.targetRoles.map(safeRole).filter(Boolean) : [];
    return roles.length === 0 || roles.includes(safeRole(user?.role));
  }

  const targetUserId = String(notification.targetUserId || "").trim().toLowerCase();
  const targetEmail = String(notification.targetUserEmail || notification.userEmail || "").trim().toLowerCase();
  return (!!targetUserId && targetUserId === userKey(user)) || (!!targetEmail && targetEmail === userEmail(user));
}

function normalizeNotification(input) {
  const createdAt = input.createdAt || nowIso();
  return {
    id: input.id || newId(),
    type: String(input.type || "INFO").trim().toUpperCase(),
    scope: input.scope === "USER" ? "USER" : "GLOBAL",
    title: String(input.title || "Notification").trim(),
    message: String(input.message || "").trim(),
    severity: String(input.severity || "info").trim().toLowerCase(),
    createdByUserId: String(input.createdByUserId || "").trim(),
    createdByEmail: String(input.createdByEmail || "").trim().toLowerCase(),
    createdByName: String(input.createdByName || "").trim(),
    targetUserId: String(input.targetUserId || "").trim(),
    targetUserEmail: String(input.targetUserEmail || input.userEmail || "").trim().toLowerCase(),
    targetRoles: Array.isArray(input.targetRoles) ? input.targetRoles.map(safeRole).filter(Boolean) : [],
    relatedEntityType: String(input.relatedEntityType || "").trim(),
    relatedEntityId: String(input.relatedEntityId || "").trim(),
    actionUrl: String(input.actionUrl || "").trim(),
    requiresAck: !!input.requiresAck,
    createdAt,
    expiresAt: input.expiresAt || null,
    readBy: Array.isArray(input.readBy) ? input.readBy : [],
    clearedBy: Array.isArray(input.clearedBy) ? input.clearedBy : [],
    acknowledgements: Array.isArray(input.acknowledgements) ? input.acknowledgements : []
  };
}

function createNotification(input) {
  const db = readDb();
  const notification = normalizeNotification(input || {});
  db.notifications.unshift(notification);
  // Keep a generous but bounded local JSON store.
  db.notifications = db.notifications.slice(0, 2000);
  writeDb(db);
  return notification;
}

function notificationForClient(n, user) {
  return {
    ...n,
    read: hasUser(n.readBy, user),
    acknowledged: hasUser(n.acknowledgements, user),
    acknowledgementCount: Array.isArray(n.acknowledgements) ? n.acknowledgements.length : 0
  };
}

function listForUser(user, { includeCleared = false } = {}) {
  const now = Date.now();
  return readDb().notifications
    .filter((n) => visibleToUser(n, user))
    .filter((n) => {
      if (!n.expiresAt) return true;
      const t = Date.parse(n.expiresAt);
      return Number.isNaN(t) || t >= now;
    })
    .filter((n) => includeCleared || !hasUser(n.clearedBy, user))
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
    .map((n) => notificationForClient(n, user));
}

function markRead(id, user) {
  const db = readDb();
  let out = null;
  db.notifications = db.notifications.map((n) => {
    if (String(n.id) !== String(id) || !visibleToUser(n, user)) return n;
    const readBy = Array.isArray(n.readBy) ? [...n.readBy] : [];
    if (!hasUser(readBy, user)) readBy.push({ userId: user?.id || "", email: user?.email || "", at: nowIso() });
    out = { ...n, readBy };
    return out;
  });
  writeDb(db);
  return out ? notificationForClient(out, user) : null;
}

function markAllRead(user) {
  const db = readDb();
  let count = 0;
  db.notifications = db.notifications.map((n) => {
    if (!visibleToUser(n, user) || hasUser(n.readBy, user)) return n;
    count += 1;
    return { ...n, readBy: [...(Array.isArray(n.readBy) ? n.readBy : []), { userId: user?.id || "", email: user?.email || "", at: nowIso() }] };
  });
  writeDb(db);
  return count;
}

function acknowledgementNoticeFor(n, user) {
  if (!n.createdByUserId && !n.createdByEmail) return null;
  return normalizeNotification({
    type: "ACKNOWLEDGEMENT",
    scope: "USER",
    title: "Notification acknowledged",
    message: `${userLabel(user)} acknowledged: ${n.title || n.message || "Notification"}`,
    severity: "success",
    createdByUserId: user?.id || "",
    createdByEmail: user?.email || "",
    createdByName: userLabel(user),
    targetUserId: n.createdByUserId || "",
    targetUserEmail: n.createdByEmail || "",
    relatedEntityType: "notification",
    relatedEntityId: n.id
  });
}

function acknowledgeMatching(predicate, user, { createAckNotice = true } = {}) {
  const db = readDb();
  const out = [];
  const ackNotices = [];
  const ackAt = nowIso();

  db.notifications = db.notifications.map((n) => {
    if (!predicate(n) || !visibleToUser(n, user) || !n.requiresAck) return n;

    const acknowledgements = Array.isArray(n.acknowledgements) ? [...n.acknowledgements] : [];
    const readBy = Array.isArray(n.readBy) ? [...n.readBy] : [];
    if (!hasUser(acknowledgements, user)) {
      acknowledgements.push({ userId: user?.id || "", email: user?.email || "", name: userLabel(user), acknowledgedAt: ackAt });
      const ackNotice = createAckNotice ? acknowledgementNoticeFor(n, user) : null;
      if (ackNotice) ackNotices.push(ackNotice);
    }
    if (!hasUser(readBy, user)) readBy.push({ userId: user?.id || "", email: user?.email || "", at: ackAt });

    const updated = { ...n, acknowledgements, readBy };
    out.push(updated);
    return updated;
  });

  if (ackNotices.length) db.notifications.unshift(...ackNotices);
  writeDb(db);
  return out.map((n) => notificationForClient(n, user));
}

function acknowledge(id, user) {
  return acknowledgeMatching((n) => String(n.id) === String(id), user)[0] || null;
}

function acknowledgeRelatedEntity(relatedEntityType, relatedEntityId, user, options = {}) {
  const type = String(relatedEntityType || "").trim();
  const id = String(relatedEntityId || "").trim();
  if (!type || !id) return [];
  return acknowledgeMatching((n) => String(n.relatedEntityType || "") === type && String(n.relatedEntityId || "") === id, user, options);
}

function clearVisible(user) {
  const db = readDb();
  let count = 0;
  db.notifications = db.notifications.map((n) => {
    if (!visibleToUser(n, user)) return n;
    // Do not clear required acknowledgement items until this user has acknowledged them.
    if (n.requiresAck && !hasUser(n.acknowledgements, user)) return n;
    if (hasUser(n.clearedBy, user)) return n;
    count += 1;
    return { ...n, clearedBy: [...(Array.isArray(n.clearedBy) ? n.clearedBy : []), { userId: user?.id || "", email: user?.email || "", at: nowIso() }] };
  });
  writeDb(db);
  return count;
}

function getAcknowledgements(id, user) {
  const n = readDb().notifications.find((item) => String(item.id) === String(id));
  if (!n || !visibleToUser(n, user)) return null;
  return Array.isArray(n.acknowledgements) ? n.acknowledgements : [];
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
  userLabel,
  safeRole
};
