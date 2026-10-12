const express = require("express");
const path = require("path");
const { getUsers } = require("../lib/userStore");
const { getSession, extractBearer } = require("../lib/sessions");
const { readJsonSync, updateJsonWithLockSync } = require("../lib/lockedJson");

const router = express.Router();

const DATA_DIR = path.join(__dirname, "..", "data");
const PRESENCE_FILE = path.join(DATA_DIR, "presence.json");
const ONLINE_WINDOW_MS = 60_000;
const PERSIST_INTERVAL_MS = 60_000;

// Current-process heartbeat state. This intentionally starts empty after an
// API restart so nobody is incorrectly reported as online from stale data.
const lastPing = new Map();

// Durable last-seen state is stored separately from users.json.
const persistedLastSeen = new Map();
const lastPersistedWrite = new Map();

function normalizePresenceStore(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const users = source.users && typeof source.users === "object" && !Array.isArray(source.users)
    ? source.users
    : {};
  return {
    version: 1,
    users
  };
}

function loadPersistedPresence() {
  const store = normalizePresenceStore(readJsonSync(PRESENCE_FILE, { version: 1, users: {} }));

  for (const [userId, rec] of Object.entries(store.users)) {
    const ts = Date.parse(String(rec?.lastSeenAt || ""));
    if (!Number.isNaN(ts)) {
      persistedLastSeen.set(String(userId), ts);
      lastPersistedWrite.set(String(userId), ts);
    }
  }
}

loadPersistedPresence();

function persistLastSeen(userId, seenAtMs) {
  const id = String(userId || "").trim();
  if (!id || !Number.isFinite(seenAtMs)) return;

  const previousWrite = Number(lastPersistedWrite.get(id) || 0);
  if (previousWrite && seenAtMs - previousWrite < PERSIST_INTERVAL_MS) return;

  const iso = new Date(seenAtMs).toISOString();

  try {
    updateJsonWithLockSync(
      PRESENCE_FILE,
      { version: 1, users: {} },
      (current) => {
        const store = normalizePresenceStore(current);
        const existing = store.users[id] && typeof store.users[id] === "object"
          ? store.users[id]
          : {};

        store.users[id] = {
          ...existing,
          lastSeenAt: iso
        };

        return store;
      }
    );

    persistedLastSeen.set(id, seenAtMs);
    lastPersistedWrite.set(id, seenAtMs);
  } catch (error) {
    // Presence persistence must never break login/API activity.
    console.warn("Failed to persist presence last seen:", error?.message || error);
  }
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
  if (!session) return res.status(401).json({ ok: false, message: "Not logged in." });

  const user = getUsers().find((u) => u.id === session.userId);
  if (!user) return res.status(401).json({ ok: false, message: "Not logged in." });

  req.user = user;
  next();
}

/**
 * Normalize stored photoUrl into a browser-accessible URL.
 * Supports:
 *  - Absolute http(s) URLs (returned as-is)
 *  - Already-public URLs like "/uploads/..."
 *  - Absolute disk paths that contain "/data/uploads/..." (converted to "/uploads/...")
 *  - Relative paths like "uploads/..." (converted to "/uploads/...")
 */
function toPublicPhotoUrl(photoUrl) {
  const raw = String(photoUrl || "").trim();
  if (!raw) return "";

  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/uploads/")) return raw;

  const marker = "/data/uploads/";
  const idx = raw.indexOf(marker);
  if (idx >= 0) {
    const tail = raw.slice(idx + marker.length).replace(/^\/+/, "");
    return "/uploads/" + tail;
  }

  if (raw.startsWith("uploads/")) return "/" + raw;
  if (!raw.startsWith("/")) return "/" + raw;
  return raw;
}

// POST /api/presence/ping
// Heartbeats update current-process online state immediately. Durable writes
// are throttled to at most once per minute per user and never touch users.json.
router.post("/ping", requireAuth, (req, res) => {
  const now = Date.now();
  const userId = String(req.user.id || "");

  lastPing.set(userId, now);
  persistLastSeen(userId, now);

  res.json({ ok: true });
});

// GET /api/presence/users
router.get("/users", requireAuth, (req, res) => {
  const now = Date.now();

  const users = getUsers()
    .filter((u) => u.status === "APPROVED")
    .map((u) => {
      const userId = String(u.id || "");
      const livePingMs = Number(lastPing.get(userId) || 0);
      const persistedMs = Number(persistedLastSeen.get(userId) || 0);
      const lastSeenMs = Math.max(livePingMs, persistedMs);
      const online = livePingMs > 0 && now - livePingMs <= ONLINE_WINDOW_MS;

      return {
        id: u.id,
        email: u.email,
        name: u.name,
        photoUrl: toPublicPhotoUrl(u.photoUrl),
        online,
        lastSeenAt: lastSeenMs ? new Date(lastSeenMs).toISOString() : null
      };
    });

  res.json({ ok: true, users });
});

module.exports = router;
