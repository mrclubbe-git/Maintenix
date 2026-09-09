// /opt/maintenix-ui/server-api/routes/presence.js
const express = require("express");
const { getUsers } = require("../lib/userStore");
const { getSession, extractBearer } = require("../lib/sessions");

const router = express.Router();

// userId -> lastPingMs
const lastPing = new Map();

function requireAuth(req, res, next) {
  const token = extractBearer(req);
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

  // Absolute URL
  if (/^https?:\/\//i.test(raw)) return raw;

  // Already public
  if (raw.startsWith("/uploads/")) return raw;

  // Convert absolute server path -> public /uploads path
  // Example: /opt/maintenix-ui/server-api/data/uploads/users/u1.jpg -> /uploads/users/u1.jpg
  const marker = "/data/uploads/";
  const idx = raw.indexOf(marker);
  if (idx >= 0) {
    const tail = raw.slice(idx + marker.length).replace(/^\/+/, "");
    return "/uploads/" + tail;
  }

  // Relative uploads path
  if (raw.startsWith("uploads/")) return "/" + raw;

  // Any other relative path
  if (!raw.startsWith("/")) return "/" + raw;

  // Fallback (already absolute-path-like)
  return raw;
}

// POST /api/presence/ping  (heartbeat)
router.post("/ping", requireAuth, (req, res) => {
  lastPing.set(req.user.id, Date.now());
  res.json({ ok: true });
});

// GET /api/presence/users  (online / last seen)
router.get("/users", requireAuth, (req, res) => {
  const now = Date.now();

  const users = getUsers()
    .filter((u) => u.status === "APPROVED") // only approved accounts appear
    .map((u) => {
      const lp = lastPing.get(u.id) || null;
      const online = lp ? now - lp <= 60_000 : false; // online if ping in last 60s

      return {
        id: u.id,
        email: u.email,
        name: u.name,
        photoUrl: toPublicPhotoUrl(u.photoUrl),
        online,
        lastSeenAt: lp ? new Date(lp).toISOString() : null
      };
    });

  res.json({ ok: true, users });
});

module.exports = router;
