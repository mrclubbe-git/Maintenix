const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "sessions.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const SESSION_COOKIE_NAME = String(process.env.SESSION_COOKIE_NAME || "maintenix_session").trim() || "maintenix_session";
const ALLOW_LEGACY_BEARER = String(process.env.ALLOW_LEGACY_BEARER || "").toLowerCase() === "true";

// session token -> { userId, createdAt, lastSeenAt, csrfToken, organization }
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
  return Boolean(
    session?.userId &&
    session?.csrfToken &&
    createdAt > 0 &&
    Date.now() - createdAt <= SESSION_TTL_MS
  );
}

function loadSessions() {
  if (loaded) return;
  loaded = true;
  ensureFile();

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
    const parsed = raw ? JSON.parse(raw) : { sessions: [] };
    const list = Array.isArray(parsed?.sessions) ? parsed.sessions : [];

    let discardedLegacy = false;
    for (const entry of list) {
      const token = String(entry?.token || "").trim();
      const session = {
        userId: String(entry?.userId || "").trim(),
        createdAt: Number(entry?.createdAt || 0),
        lastSeenAt: Number(entry?.lastSeenAt || entry?.createdAt || 0),
        csrfToken: String(entry?.csrfToken || "").trim(),
        organization: String(entry?.organization || process.env.ORGANIZATION_CODE || "CRA").trim().toUpperCase()
      };

      // Sessions created before the HttpOnly-cookie migration have no CSRF
      // secret. Discard them so a previously copied bearer token cannot be
      // promoted into a valid cookie credential after this release.
      if (token && !session.csrfToken) {
        discardedLegacy = true;
        continue;
      }

      if (token && isFresh(session)) sessions.set(token, session);
    }

    if (discardedLegacy) saveSessions();
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
    lastSeenAt: Number(session.lastSeenAt || session.createdAt || now),
    csrfToken: session.csrfToken,
    organization: session.organization || "CRA"
  }));

  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ sessions: list }, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, DATA_FILE);
}

function createSession(userId, options = {}) {
  loadSessions();
  const token = "s_" + crypto.randomBytes(32).toString("hex");
  const csrfToken = "c_" + crypto.randomBytes(32).toString("hex");
  const now = Date.now();

  sessions.set(token, {
    userId: String(userId || "").trim(),
    createdAt: now,
    lastSeenAt: now,
    csrfToken,
    organization: String(options.organization || process.env.ORGANIZATION_CODE || "CRA").trim().toUpperCase()
  });
  saveSessions();
  return token;
}

function getSessionExpiresAt(token) {
  loadSessions();
  const key = String(token || "").trim();
  if (!key) return 0;

  const session = sessions.get(key) || null;
  if (!session || !isFresh(session)) return 0;
  return Number(session.createdAt || 0) + SESSION_TTL_MS;
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

  if (Date.now() - Number(session._lastSavedAt || 0) > 1000 * 60 * 5) {
    session._lastSavedAt = Date.now();
    saveSessions();
  }

  return session;
}

function deleteSession(token) {
  loadSessions();
  const key = String(token || "").trim();
  if (!key) return false;
  const deleted = sessions.delete(key);
  if (deleted) saveSessions();
  return deleted;
}

function deleteSessionsForUser(userId) {
  loadSessions();
  const wanted = String(userId || "").trim();
  if (!wanted) return 0;

  let removed = 0;
  for (const [token, session] of sessions.entries()) {
    if (String(session?.userId || "") === wanted) {
      sessions.delete(token);
      removed += 1;
    }
  }

  if (removed) saveSessions();
  return removed;
}

function parseCookies(headerValue) {
  const result = {};
  String(headerValue || "")
    .split(";")
    .forEach((part) => {
      const idx = part.indexOf("=");
      if (idx <= 0) return;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (!key) return;
      try { result[key] = decodeURIComponent(value); }
      catch { result[key] = value; }
    });
  return result;
}

function extractLegacyBearer(value) {
  const match = String(value || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function extractSessionToken(input) {
  if (input && typeof input === "object") {
    const cookies = parseCookies(input?.headers?.cookie || "");
    const cookieToken = String(cookies[SESSION_COOKIE_NAME] || "").trim();
    if (cookieToken) return cookieToken;

    if (ALLOW_LEGACY_BEARER) {
      return extractLegacyBearer(input?.headers?.authorization || "");
    }
    return "";
  }

  return ALLOW_LEGACY_BEARER ? extractLegacyBearer(input) : "";
}

// Compatibility export for existing route modules. It now resolves the
// server-managed cookie and only accepts bearer credentials when an explicit,
// temporary migration flag is enabled.
const extractBearer = extractSessionToken;

function cookieSameSite() {
  const raw = String(process.env.SESSION_COOKIE_SAMESITE || "None").trim().toLowerCase();
  if (raw === "strict") return "Strict";
  if (raw === "lax") return "Lax";
  return "None";
}

function cookieSecure() {
  const sameSite = cookieSameSite();
  if (sameSite === "None") return true;
  return String(process.env.SESSION_COOKIE_SECURE || "true").toLowerCase() !== "false";
}

function sessionCookieValue(token, expiresAt) {
  const maxAgeSeconds = Math.max(0, Math.floor((Number(expiresAt || 0) - Date.now()) / 1000));
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(String(token || ""))}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${cookieSameSite()}`,
    `Max-Age=${maxAgeSeconds}`,
    `Expires=${new Date(Number(expiresAt || Date.now())).toUTCString()}`
  ];

  if (cookieSecure()) parts.push("Secure");
  const domain = String(process.env.SESSION_COOKIE_DOMAIN || "").trim();
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

function expiredCookieValue() {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    `SameSite=${cookieSameSite()}`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT"
  ];
  if (cookieSecure()) parts.push("Secure");
  const domain = String(process.env.SESSION_COOKIE_DOMAIN || "").trim();
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

function setSessionCookie(res, token) {
  const expiresAt = getSessionExpiresAt(token);
  if (!expiresAt) throw new Error("Cannot set cookie for an invalid session.");
  res.setHeader("Set-Cookie", sessionCookieValue(token, expiresAt));
  return expiresAt;
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", expiredCookieValue());
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length > 0 && aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function validateCsrfToken(session, supplied) {
  return safeEqual(session?.csrfToken, supplied);
}

module.exports = {
  SESSION_TTL_MS,
  SESSION_COOKIE_NAME,
  createSession,
  getSession,
  getSessionExpiresAt,
  deleteSession,
  deleteSessionsForUser,
  extractSessionToken,
  extractBearer,
  setSessionCookie,
  clearSessionCookie,
  validateCsrfToken
};
