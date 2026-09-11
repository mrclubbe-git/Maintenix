// /opt/maintenix-ui/server-api/routes/standby.js
const express = require("express");
const fs = require("fs");
const path = require("path");

const { getSession, extractBearer } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");
const { createNotification, userLabel } = require("../lib/notifications");

const router = express.Router();

const DATA_FILE = path.join(__dirname, "..", "data", "standby.json");

function safeRole(x) {
  return String(x || "").trim().toUpperCase().replace(/\s+/g, "");
}

function ensureFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ config: null, schedule: [] }, null, 2), "utf8");
  }
}

function readDb() {
  ensureFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
  if (!raw) return { config: null, schedule: [] };

  try {
    const parsed = JSON.parse(raw);
    return {
      config: parsed && typeof parsed === "object" ? (parsed.config || null) : null,
      schedule: parsed && typeof parsed === "object" && Array.isArray(parsed.schedule) ? parsed.schedule : []
    };
  } catch {
    const backup = DATA_FILE.replace(/\.json$/i, `.corrupt.${Date.now()}.json`);
    try { fs.copyFileSync(DATA_FILE, backup); } catch {}
    fs.writeFileSync(DATA_FILE, JSON.stringify({ config: null, schedule: [] }, null, 2), "utf8");
    return { config: null, schedule: [] };
  }
}

function writeDb(db) {
  ensureFile();
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

function requireAuth(req, res, next) {
  let token = "";
  try {
    token = extractBearer(req);
  } catch {
    const auth = (req.headers && req.headers.authorization) || "";
    token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  }

  const session = token ? getSession(token) : null;
  if (!session?.userId) return res.status(401).json({ ok: false, message: "Not logged in." });

  const user = getUsers().find((u) => u.id === session.userId) || null;
  if (!user) return res.status(401).json({ ok: false, message: "Not logged in." });

  req.user = user;
  next();
}

function requireAdminOrL3(req, res, next) {
  requireAuth(req, res, () => {
    const r = safeRole(req.user?.role);
    if (r !== "ADMIN" && r !== "L3" && r !== "LEVEL3" && r !== "LEVEL_3") {
      return res.status(403).json({ ok: false, message: "Admin or L3 only." });
    }
    next();
  });
}

function parseYmd(dateStr) {
  const s = String(dateStr || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function fmtYmd(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function generateSchedule(userIds, usersById, startDateStr, endDateStr) {
  const start = parseYmd(startDateStr);
  const end = parseYmd(endDateStr);
  if (!start || !end) return { error: "Start and End dates must be valid (YYYY-MM-DD)." };
  if (end.getTime() < start.getTime()) return { error: "End date must be on/after the start date." };
  if (!Array.isArray(userIds) || userIds.length === 0) return { error: "At least 1 user is required." };

  const cleaned = userIds.map((x) => String(x || "").trim()).filter(Boolean);
  if (cleaned.length === 0) return { error: "At least 1 user is required." };

  const schedule = [];
  let current = new Date(start.getTime());
  let idx = 0;

  while (current.getTime() <= end.getTime()) {
    const blockStart = new Date(current.getTime());
    const blockEnd = new Date(current.getTime());
    blockEnd.setDate(blockEnd.getDate() + 6);

    if (blockEnd.getTime() > end.getTime()) {
      blockEnd.setTime(end.getTime());
    }

    const userId = cleaned[idx % cleaned.length];
    const u = usersById[userId];

    schedule.push({
      rotation: idx + 1,
      userId,
      userName: u?.name || u?.email || userId,
      startDate: fmtYmd(blockStart),
      endDate: fmtYmd(blockEnd)
    });

    current = new Date(blockEnd.getTime());
    current.setDate(current.getDate() + 1);
    idx += 1;
  }

  return { schedule };
}

// GET /api/standby/registered-users  (Admin/L3 only)
router.get("/registered-users", requireAdminOrL3, (_req, res) => {
  const users = getUsers()
    .filter((u) => safeRole(u.status) === "APPROVED" || safeRole(u.role) === "ADMIN")
    .map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status,
      photoUrl: u.photoUrl || ""
    }));

  return res.json({ ok: true, users });
});

// GET /api/standby/schedule (any authenticated user)
router.get("/schedule", requireAuth, (_req, res) => {
  const db = readDb();
  return res.json({ ok: true, config: db.config || null, schedule: db.schedule || [] });
});

// GET /api/standby/today (any authenticated user)
// Returns the rotation entry that covers today's date (if any).
router.get("/today", requireAuth, (_req, res) => {
  const db = readDb();
  const todayStr = fmtYmd(new Date());

  const sched = Array.isArray(db.schedule) ? db.schedule : [];
  const assignment = sched.find((r) => {
    const s = String(r?.startDate || "");
    const e = String(r?.endDate || "");
    return s && e && s <= todayStr && todayStr <= e;
  }) || null;

  return res.json({ ok: true, today: todayStr, assignment });
});

// POST /api/standby/schedule  (Admin/L3 only)
router.post("/schedule", requireAdminOrL3, (req, res) => {
  try {
    const { userIds, startDate, endDate } = req.body || {};

    const users = getUsers();
    const byId = {};
    for (const u of users) byId[String(u.id)] = u;

    const cleanedIds = Array.isArray(userIds)
      ? userIds.map((x) => String(x || "").trim()).filter(Boolean)
      : [];

    if (cleanedIds.length === 0) {
      return res.status(400).json({ ok: false, message: "Please select at least 1 user." });
    }

    for (const id of cleanedIds) {
      const u = byId[id];
      if (!u) return res.status(400).json({ ok: false, message: `Unknown user id: ${id}` });

      const isApproved = safeRole(u.status) === "APPROVED" || safeRole(u.role) === "ADMIN";
      if (!isApproved) {
        return res.status(400).json({ ok: false, message: `User is not approved: ${u.email || id}` });
      }
    }

    const out = generateSchedule(cleanedIds, byId, startDate, endDate);
    if (out.error) return res.status(400).json({ ok: false, message: out.error });

    const config = {
      userIds: cleanedIds,
      startDate: String(startDate || "").trim(),
      endDate: String(endDate || "").trim(),
      createdAt: new Date().toISOString(),
      createdBy: req.user?.email || req.user?.id || "unknown"
    };

    writeDb({ config, schedule: out.schedule });

    try {
      const first = out.schedule[0];
      const last = out.schedule[out.schedule.length - 1];
      createNotification({
        type: "STANDBY_CHANGE",
        scope: "GLOBAL",
        title: "Standby rotation updated",
        message: `Standby rotation was updated by ${userLabel(req.user)} for ${config.startDate} to ${config.endDate}. Current first rotation: ${first?.userName || "—"}${first ? ` (${first.startDate} to ${first.endDate})` : ""}.`,
        severity: "info",
        createdByUserId: req.user?.id || "",
        createdByEmail: req.user?.email || "",
        createdByName: userLabel(req.user),
        relatedEntityType: "standby",
        relatedEntityId: `${config.startDate}:${config.endDate}`,
        actionUrl: "#/standby"
      });
    } catch {}

    return res.json({ ok: true, config, schedule: out.schedule });
  } catch {
    return res.status(500).json({ ok: false, message: "Failed to create standby schedule." });
  }
});

// DELETE /api/standby/schedule (Admin/L3 only)
// Clears the current standby config + schedule.
router.delete("/schedule", requireAdminOrL3, (req, res) => {
  try {
    writeDb({ config: null, schedule: [] });
    try {
      createNotification({
        type: "STANDBY_CHANGE",
        scope: "GLOBAL",
        title: "Standby rotation cleared",
        message: `Standby rotation was cleared by ${userLabel(req.user)}.`,
        severity: "warning",
        createdByUserId: req.user?.id || "",
        createdByEmail: req.user?.email || "",
        createdByName: userLabel(req.user),
        relatedEntityType: "standby",
        relatedEntityId: "cleared",
        actionUrl: "#/standby"
      });
    } catch {}
    return res.json({ ok: true, message: "Standby schedule cleared." });
  } catch {
    return res.status(500).json({ ok: false, message: "Failed to clear standby schedule." });
  }
});

module.exports = router;
