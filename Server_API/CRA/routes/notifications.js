const express = require("express");
const { extractBearer, getSession } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");
const {
  createNotification,
  listForUser,
  markRead,
  markAllRead,
  acknowledge,
  clearVisible,
  getAcknowledgements,
  userLabel,
  safeRole
} = require("../lib/notifications");
const planner = require("../lib/dailyPlanner");

const router = express.Router();

function requireAuth(req, res, next) {
  const token = extractBearer(req);
  const session = getSession(token);
  if (!session?.userId) return res.status(401).json({ ok: false, message: "Unauthorized" });

  const user = getUsers().find((u) => String(u.id) === String(session.userId)) || null;
  if (!user) return res.status(401).json({ ok: false, message: "Unauthorized" });

  req.user = user;
  next();
}

function canBroadcast(user) {
  const role = safeRole(user?.role);
  return role === "ADMIN" || role === "L3" || role === "LEVEL3" || role === "LEVEL_3";
}

function requireAdminOrL3(req, res, next) {
  requireAuth(req, res, () => {
    if (!canBroadcast(req.user)) return res.status(403).json({ ok: false, message: "Admin or L3 only." });
    next();
  });
}

router.get("/", requireAuth, (req, res) => {
  const notifications = listForUser(req.user);
  const unreadCount = notifications.filter((n) => !n.read).length;
  const requiresAckCount = notifications.filter((n) => n.requiresAck && !n.acknowledged).length;
  res.json({ ok: true, notifications, unreadCount, requiresAckCount });
});

router.post("/broadcast", requireAdminOrL3, (req, res) => {
  const title = String(req.body?.title || "").trim();
  const message = String(req.body?.message || "").trim();
  const requiresAck = !!req.body?.requiresAck;

  if (!title) return res.status(400).json({ ok: false, message: "Title is required." });
  if (!message) return res.status(400).json({ ok: false, message: "Message is required." });
  if (title.length > 120) return res.status(400).json({ ok: false, message: "Title is too long." });
  if (message.length > 1000) return res.status(400).json({ ok: false, message: "Message is too long." });

  const notification = createNotification({
    type: "ADMIN_BROADCAST",
    scope: "GLOBAL",
    title,
    message,
    severity: requiresAck ? "warning" : "info",
    requiresAck,
    createdByUserId: req.user?.id || "",
    createdByEmail: req.user?.email || "",
    createdByName: userLabel(req.user)
  });

  res.json({ ok: true, notification });
});

router.post("/:id/read", requireAuth, (req, res) => {
  const notification = markRead(req.params.id, req.user);
  if (!notification) return res.status(404).json({ ok: false, message: "Notification not found." });
  res.json({ ok: true, notification });
});

router.post("/read-all", requireAuth, (req, res) => {
  const count = markAllRead(req.user);
  res.json({ ok: true, count });
});

router.post("/:id/ack", requireAuth, (req, res) => {
  const notification = acknowledge(req.params.id, req.user);
  if (!notification) return res.status(404).json({ ok: false, message: "Acknowledgement not available." });

  let relatedTask = null;
  if (String(notification.relatedEntityType || "") === "daily_planner_task" && notification.relatedEntityId) {
    relatedTask = planner.acknowledge(notification.relatedEntityId, req.user);
  }

  res.json({ ok: true, notification, relatedTask });
});

router.post("/clear-visible", requireAuth, (req, res) => {
  const count = clearVisible(req.user);
  res.json({ ok: true, count });
});

router.get("/:id/acks", requireAdminOrL3, (req, res) => {
  const acknowledgements = getAcknowledgements(req.params.id, req.user);
  if (!acknowledgements) return res.status(404).json({ ok: false, message: "Notification not found." });
  res.json({ ok: true, acknowledgements });
});

module.exports = router;
