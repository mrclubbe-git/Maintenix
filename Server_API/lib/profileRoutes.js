const fs = require("fs");
const path = require("path");
const express = require("express");

const { extractBearer, getSession } = require("./sessions");
const { getUsers, updateUserById } = require("./userStore");

const router = express.Router();

function requireAuth(req, res, next) {
  const token = extractBearer(req.headers.authorization || "");
  const session = getSession(token);
  if (!session?.userId) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  const user = getUsers().find((u) => u.id === session.userId);
  if (!user) return res.status(401).json({ ok: false, message: "Unauthorized" });

  req.user = user;
  next();
}

// GET /api/profile/me
router.get("/me", requireAuth, (req, res) => {
  const u = req.user;
  res.json({
    ok: true,
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status,
      photoUrl: u.photoUrl || ""
    }
  });
});

// PATCH /api/profile/me  (basic fields)
router.patch("/me", requireAuth, (req, res) => {
  const name = String(req.body?.name || "").trim();

  const patch = {};
  if (name) patch.name = name;

  const updated = updateUserById(req.user.id, patch);
  if (!updated) return res.status(404).json({ ok: false, message: "User not found" });

  res.json({
    ok: true,
    user: {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      status: updated.status,
      photoUrl: updated.photoUrl || ""
    }
  });
});

// PUT /api/profile/photo  { dataUrl: "data:image/png;base64,..." }
router.put("/photo", requireAuth, (req, res) => {
  const s = String(req.body?.dataUrl || "");

  if (!s.startsWith("data:image/")) {
    return res.status(400).json({ ok: false, message: "Expected dataUrl starting with data:image/..." });
  }

  const match = s.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
  if (!match) {
    return res.status(400).json({ ok: false, message: "Unsupported image type (use png/jpeg/webp)" });
  }

  const extRaw = match[2].toLowerCase();
  const ext = extRaw === "jpg" ? "jpg" : extRaw; // keep jpg as jpg
  const b64 = match[3];

  // ~2MB-ish limit (base64 overhead)
  if (b64.length > 3_000_000) {
    return res.status(413).json({ ok: false, message: "Image too large (max ~2MB)" });
  }

  let buf;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return res.status(400).json({ ok: false, message: "Invalid base64 data." });
  }

  const uploadsDir = path.join(__dirname, "..", "data", "uploads", "profilepics");
  fs.mkdirSync(uploadsDir, { recursive: true });

  const filename = `${req.user.id}_${Date.now()}.${ext}`;
  const filepath = path.join(uploadsDir, filename);
  fs.writeFileSync(filepath, buf);

  const publicUrl = `/uploads/profilepics/${filename}`;
  const updated = updateUserById(req.user.id, { photoUrl: publicUrl });

  if (!updated) {
    // clean up file if user not found
    try { fs.unlinkSync(filepath); } catch {}
    return res.status(404).json({ ok: false, message: "User not found" });
  }

  res.json({ ok: true, photoUrl: publicUrl });
});

module.exports = router;
