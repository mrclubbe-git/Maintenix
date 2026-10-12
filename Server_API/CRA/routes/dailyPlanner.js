const express = require("express");
const { extractBearer, getSession } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");
const planner = require("../lib/dailyPlanner");
const { acknowledgeRelatedEntity } = require("../lib/notifications");

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

function handleError(res, err) {
  const status = Number(err?.status || 500);
  res.status(status).json({ ok: false, message: err?.message || "Daily planner error." });
}

router.get("/", requireAuth, (req, res) => {
  const date = req.query.date;
  const tasks = planner.list(date, req.user);
  res.json({
    ok: true,
    canEdit: planner.canEditPlanner(req.user),
    statuses: planner.STATUSES,
    statusLabels: planner.STATUS_LABELS,
    colours: planner.COLOURS,
    tasks
  });
});

router.get("/users", requireAuth, (req, res) => {
  if (!planner.canEditPlanner(req.user)) return res.status(403).json({ ok: false, message: "Admin or L3 only." });
  res.json({ ok: true, users: planner.listAssignableUsers() });
});

router.post("/", requireAuth, (req, res) => {
  try {
    const task = planner.create(req.body || {}, req.user);
    res.json({ ok: true, task });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch("/:id", requireAuth, (req, res) => {
  try {
    const task = planner.update(req.params.id, req.body || {}, req.user);
    if (!task) return res.status(404).json({ ok: false, message: "Planner task not found." });
    res.json({ ok: true, task });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete("/:id", requireAuth, (req, res) => {
  try {
    const removed = planner.remove(req.params.id, req.user);
    if (!removed) return res.status(404).json({ ok: false, message: "Planner task not found." });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.post("/:id/ack", requireAuth, (req, res) => {
  const task = planner.acknowledge(req.params.id, req.user);
  if (!task) return res.status(404).json({ ok: false, message: "Task allocation acknowledgement is not available." });
  const notifications = acknowledgeRelatedEntity("daily_planner_task", req.params.id, req.user, { createAckNotice: false });
  res.json({ ok: true, task, notifications });
});

module.exports = router;
