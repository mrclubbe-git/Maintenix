// /opt/maintenix-ui/server-api/lib/sessions.js
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "sessions.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// token -> { userId, createdAt, lastSeenAt }
const sessions = new Map();
let loaded = false;

function ensureFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ sessions: [] }, null, 2), "utf8");
  }
}

function isFresh(session) {
  const createdAt = Number(session?.createdAt || 0);
  return !!session?.userId && createdAt > 0 && Date.now() - createdAt <= SESSION_TTL_MS;
}

function loadSessions() {
  if (loaded) return;
  loaded = true;
  ensureFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
    const parsed = raw ? JSON.parse(raw) : { sessions: [] };
    const list = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    for (const entry of list) {
      const token = String(entry?.token || "").trim();
      const session = {
        userId: entry?.userId,
        createdAt: Number(entry?.createdAt || 0),
        lastSeenAt: Number(entry?.lastSeenAt || entry?.createdAt || 0)
      };
      if (token && isFresh(session)) sessions.set(token, session);
    }
  } catch {
    const backup = DATA_FILE.replace(/\.json$/i, `.corrupt.${Date.now()}.json`);
    try { fs.copyFileSync(DATA_FILE, backup); } catch {}
    sessions.clear();
    try { fs.writeFileSync(DATA_FILE, JSON.stringify({ sessions: [] }, null, 2), "utf8"); } catch {}
  }
}

function saveSessions() {
  ensureFile();
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (!isFresh(session)) sessions.delete(token);
  }
  const list = Array.from(sessions.entries()).map(([token, session]) => ({
    token,
    userId: session.userId,
    createdAt: Number(session.createdAt || now),
    lastSeenAt: Number(session.lastSeenAt || session.createdAt || now)
  }));
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ sessions: list }, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

function createSession(userId) {
  loadSessions();
  const token = "t_" + crypto.randomBytes(24).toString("hex");
  sessions.set(token, { userId, createdAt: Date.now(), lastSeenAt: Date.now() });
  saveSessions();
  return token;
}

function getSession(token) {
  loadSessions();
  const key = String(token || "").trim();
  if (!key) return null;
  const session = sessions.get(key) || null;
  if (!session) return null;
  if (!isFresh(session)) {
    sessions.delete(key);
    saveSessions();
    return null;
  }
  session.lastSeenAt = Date.now();
  sessions.set(key, session);
  // Avoid writing on every request; persist roughly every 5 minutes per token.
  if (Date.now() - Number(session._lastSavedAt || 0) > 1000 * 60 * 5) {
    session._lastSavedAt = Date.now();
    saveSessions();
  }
  return session;
}

function deleteSession(token) {
  loadSessions();
  sessions.delete(String(token || "").trim());
  saveSessions();
}

function extractBearer(input) {
  // input can be: req object OR authorization header string
  let auth = "";

  if (typeof input === "string") {
    auth = input;
  } else {
    auth = input?.headers?.authorization || "";
  }

  if (!auth) return "";

  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}


module.exports = { createSession, getSession, deleteSession, extractBearer };
