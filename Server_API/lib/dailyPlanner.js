const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getUsers } = require("./userStore");
const { createNotification, userLabel, safeRole } = require("./notifications");

const DATA_FILE = path.join(__dirname, "..", "data", "daily-planner.json");

const STATUSES = ["TODO", "IN_PROGRESS", "WAITING", "DONE"];
const STATUS_LABELS = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  WAITING: "Waiting",
  DONE: "Done"
};
const COLOURS = ["yellow", "blue", "green", "pink", "purple", "orange"];

function nowIso() {
  return new Date().toISOString();
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function cleanDateKey(value) {
  const s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : todayKey();
}

function optionalDateKey(value, fallback = "") {
  const s = String(value || "").trim();
  if (!s) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

function userKey(user) {
  return String(user?.id || user?.email || "").trim().toLowerCase();
}

function canEditPlanner(user) {
  const role = safeRole(user?.role);
  return role === "ADMIN" || role === "L3" || role === "LEVEL3" || role === "LEVEL_3";
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    photoUrl: u.photoUrl || ""
  };
}

function ensureFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ tasks: [] }, null, 2), "utf8");
  }
}

function readDb() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
    if (!raw) return { tasks: [] };
    const parsed = JSON.parse(raw);
    return { tasks: Array.isArray(parsed?.tasks) ? parsed.tasks : [] };
  } catch {
    const backup = DATA_FILE.replace(/\.json$/i, `.corrupt.${Date.now()}.json`);
    try { fs.copyFileSync(DATA_FILE, backup); } catch {}
    fs.writeFileSync(DATA_FILE, JSON.stringify({ tasks: [] }, null, 2), "utf8");
    return { tasks: [] };
  }
}

function writeDb(db) {
  ensureFile();
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ tasks: Array.isArray(db?.tasks) ? db.tasks : [] }, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

function newId() {
  return `plan_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function findUserByAny(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return null;
  return getUsers().find((u) => String(u.id || "").toLowerCase() === key || String(u.email || "").toLowerCase() === key) || null;
}

function assigneeForTask(task) {
  return task?.assigneeUserId ? findUserByAny(task.assigneeUserId) : null;
}

function assignedToUser(task, user) {
  if (!task?.assigneeUserId || !user) return false;
  return String(task.assigneeUserId || "").toLowerCase() === String(user.id || "").toLowerCase() ||
    String(task.assigneeEmail || "").toLowerCase() === String(user.email || "").toLowerCase();
}

function normalizeStatus(value) {
  const s = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return STATUSES.includes(s) ? s : "TODO";
}

function normalizeColour(value) {
  const c = String(value || "").trim().toLowerCase();
  return COLOURS.includes(c) ? c : "yellow";
}

function normalizeTask(input, existing = null, actor = null) {
  const dateKey = cleanDateKey(input.date || existing?.date);
  const status = normalizeStatus(input.status || existing?.status);
  const assignee = input.assigneeUserId === null || input.assigneeUserId === "" ? null : findUserByAny(input.assigneeUserId || existing?.assigneeUserId || "");
  const assignmentChanged = String(existing?.assigneeUserId || "") !== String(assignee?.id || "");
  const createdAt = existing?.createdAt || nowIso();

  return {
    id: existing?.id || input.id || newId(),
    date: dateKey,
    startDate: optionalDateKey(input.startDate ?? existing?.startDate, dateKey),
    title: String(input.title ?? existing?.title ?? "").trim().slice(0, 140),
    description: String(input.description ?? existing?.description ?? "").trim().slice(0, 2000),
    status,
    colour: normalizeColour(input.colour || existing?.colour),
    position: Number.isFinite(Number(input.position)) ? Number(input.position) : Number(existing?.position || 0),
    assigneeUserId: assignee?.id || "",
    assigneeEmail: assignee?.email || "",
    assigneeName: assignee?.name || assignee?.email || "",
    assignmentAcknowledgements: assignmentChanged ? [] : (Array.isArray(existing?.assignmentAcknowledgements) ? existing.assignmentAcknowledgements : []),
    createdAt,
    createdByUserId: existing?.createdByUserId || actor?.id || "",
    createdByEmail: existing?.createdByEmail || actor?.email || "",
    createdByName: existing?.createdByName || userLabel(actor),
    updatedAt: nowIso(),
    updatedByUserId: actor?.id || existing?.updatedByUserId || "",
    updatedByEmail: actor?.email || existing?.updatedByEmail || "",
    updatedByName: actor ? userLabel(actor) : existing?.updatedByName || ""
  };
}

function taskForClient(task, viewer) {
  const acks = Array.isArray(task.assignmentAcknowledgements) ? task.assignmentAcknowledgements : [];
  const assignedToMe = assignedToUser(task, viewer);
  const acknowledgedByMe = acks.some((ack) => userKey(ack) === userKey(viewer) || String(ack.email || "").toLowerCase() === String(viewer?.email || "").toLowerCase());
  return {
    ...task,
    statusLabel: STATUS_LABELS[task.status] || task.status,
    assignedToMe,
    acknowledgedByMe,
    // This is the global allocation status for the card, visible to everyone.
    assignmentAcknowledged: acks.length > 0,
    assignmentAcknowledgedAt: acks[0]?.acknowledgedAt || null,
    assignmentAcknowledgedBy: acks[0]?.name || acks[0]?.email || ""
  };
}

function list(date, viewer) {
  return readDb().tasks
    .sort((a, b) => {
      const statusDiff = STATUSES.indexOf(normalizeStatus(a.status)) - STATUSES.indexOf(normalizeStatus(b.status));
      if (statusDiff !== 0) return statusDiff;
      const dateDiff = cleanDateKey(a.date).localeCompare(cleanDateKey(b.date));
      if (dateDiff !== 0) return dateDiff;
      return Number(a.position || 0) - Number(b.position || 0) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    })
    .map((task) => taskForClient(task, viewer));
}

function listAssignableUsers() {
  return getUsers()
    .filter((u) => safeRole(u.status) === "APPROVED" || safeRole(u.role) === "ADMIN")
    .map(publicUser)
    .sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || "")));
}

function notifyAssignee(task, actor) {
  const assignee = assigneeForTask(task);
  if (!assignee) return null;
  return createNotification({
    type: "PLANNER_TASK_ASSIGNED",
    scope: "USER",
    title: "Daily planner task allocated",
    message: `${userLabel(actor)} allocated you a planner task: ${task.title || "Untitled task"}${task.startDate ? ` starting ${task.startDate}` : ""}. Please open Daily Planner and acknowledge the allocation.`,
    severity: "warning",
    requiresAck: true,
    createdByUserId: actor?.id || "",
    createdByEmail: actor?.email || "",
    createdByName: userLabel(actor),
    targetUserId: assignee.id || "",
    targetUserEmail: assignee.email || "",
    relatedEntityType: "daily_planner_task",
    relatedEntityId: task.id,
    actionUrl: `#/daily-planner?date=${encodeURIComponent(task.date || todayKey())}`
  });
}

function create(input, actor) {
  if (!canEditPlanner(actor)) throw Object.assign(new Error("Admin or L3 only."), { status: 403 });
  const title = String(input?.title || "").trim();
  if (!title) throw Object.assign(new Error("Task title is required."), { status: 400 });

  const db = readDb();
  const task = normalizeTask(input || {}, null, actor);
  if (!Number.isFinite(Number(input?.position))) {
    const sameColumn = db.tasks.filter((t) => cleanDateKey(t.date) === task.date && normalizeStatus(t.status) === task.status);
    task.position = sameColumn.length;
  }
  db.tasks.push(task);
  writeDb(db);
  if (task.assigneeUserId) notifyAssignee(task, actor);
  return taskForClient(task, actor);
}

function update(id, input, actor) {
  if (!canEditPlanner(actor)) throw Object.assign(new Error("Admin or L3 only."), { status: 403 });
  const db = readDb();
  const idx = db.tasks.findIndex((task) => String(task.id) === String(id));
  if (idx === -1) return null;

  const existing = db.tasks[idx];
  const previousAssignee = String(existing.assigneeUserId || "");
  const next = normalizeTask({ ...input, id }, existing, actor);
  if (!next.title) throw Object.assign(new Error("Task title is required."), { status: 400 });

  db.tasks[idx] = next;
  writeDb(db);
  if (next.assigneeUserId && previousAssignee !== String(next.assigneeUserId || "")) notifyAssignee(next, actor);
  return taskForClient(next, actor);
}

function remove(id, actor) {
  if (!canEditPlanner(actor)) throw Object.assign(new Error("Admin or L3 only."), { status: 403 });
  const db = readDb();
  const before = db.tasks.length;
  db.tasks = db.tasks.filter((task) => String(task.id) !== String(id));
  writeDb(db);
  return db.tasks.length !== before;
}

function acknowledge(id, actor) {
  const db = readDb();
  let out = null;
  db.tasks = db.tasks.map((task) => {
    if (String(task.id) !== String(id) || !assignedToUser(task, actor)) return task;
    const acks = Array.isArray(task.assignmentAcknowledgements) ? [...task.assignmentAcknowledgements] : [];
    const already = acks.some((ack) => userKey(ack) === userKey(actor) || String(ack.email || "").toLowerCase() === String(actor?.email || "").toLowerCase());
    if (!already) acks.push({ userId: actor?.id || "", email: actor?.email || "", name: userLabel(actor), acknowledgedAt: nowIso() });
    out = { ...task, assignmentAcknowledgements: acks, updatedAt: nowIso() };
    return out;
  });
  writeDb(db);
  return out ? taskForClient(out, actor) : null;
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  COLOURS,
  canEditPlanner,
  list,
  listAssignableUsers,
  create,
  update,
  remove,
  acknowledge
};
