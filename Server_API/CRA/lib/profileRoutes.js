const fs = require("fs");
const path = require("path");
const express = require("express");

const { extractBearer, getSession, getSessionExpiresAt } = require("./sessions");
const { decodeImageDataUrl, safeGeneratedImageName } = require("./imageValidation");
const {
  ensureProfilePicsDir,
  publicUrlForProfilePhoto,
  profilePhotoCandidatePaths
} = require("./profilePhotoStorage");
const { getUsers, updateUserById } = require("./userStore");
const { getUserPreferences, updateUserPreferences } = require("./userPreferences");

const router = express.Router();

function requireAuth(req, res, next) {
  const token = extractBearer(req);
  const session = getSession(token);
  if (!session?.userId) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  const user = getUsers().find((u) => u.id === session.userId);
  if (!user) return res.status(401).json({ ok: false, message: "Unauthorized" });

  const role = String(user.role || "").trim().toUpperCase();
  const status = String(user.status || "").trim().toUpperCase();
  if (role !== "ADMIN" && status !== "APPROVED") {
    return res.status(401).json({ ok: false, message: "Session is no longer authorised." });
  }

  req.user = user;
  req.authSession = session;
  req.authSessionToken = token;
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
    },
    expiresAt: getSessionExpiresAt(req.authSessionToken),
    csrfToken: req.authSession?.csrfToken || ""
  });
});

// PATCH /api/profile/me  (basic fields)
router.patch("/me", requireAuth, (req, res) => {
  const name = String(req.body?.name || "").trim();

  if (name.length > 120) {
    return res.status(400).json({ ok: false, message: "Name must be 120 characters or fewer." });
  }

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

// GET /api/profile/preferences
router.get("/preferences", requireAuth, (req, res) => {
  const preferences = getUserPreferences(req.user);
  res.json({ ok: true, preferences });
});

// PATCH /api/profile/preferences
router.patch("/preferences", requireAuth, (req, res) => {
  const notifications = req.body?.notifications;

  if (!notifications || typeof notifications !== "object" || Array.isArray(notifications)) {
    return res.status(400).json({
      ok: false,
      message: "notifications preference object is required."
    });
  }

  if (
    notifications.enabled !== undefined &&
    typeof notifications.enabled !== "boolean"
  ) {
    return res.status(400).json({
      ok: false,
      message: "notifications.enabled must be boolean."
    });
  }

  if (
    notifications.sound !== undefined &&
    typeof notifications.sound !== "boolean"
  ) {
    return res.status(400).json({
      ok: false,
      message: "notifications.sound must be boolean."
    });
  }

  if (
    notifications.enabled === undefined &&
    notifications.sound === undefined
  ) {
    return res.status(400).json({
      ok: false,
      message: "No supported notification preferences supplied."
    });
  }

  const preferences = updateUserPreferences(req.user, { notifications });
  if (!preferences) {
    return res.status(400).json({
      ok: false,
      message: "Unable to identify user."
    });
  }

  res.json({ ok: true, preferences });
});

// PUT /api/profile/photo  { dataUrl: "data:image/png;base64,..." }
router.put("/photo", requireAuth, (req, res) => {
  let decoded;
  try {
    decoded = decodeImageDataUrl(req.body?.dataUrl, {
      allowed: ["png", "jpeg", "webp"],
      maxBytes: 2 * 1024 * 1024
    });
  } catch (error) {
    const message = String(error?.message || "Invalid profile image.");
    const status = /too large/i.test(message) ? 413 : 400;
    return res.status(status).json({ ok: false, message });
  }

  const previousUrl = String(req.user.photoUrl || "").trim();
  let filepath = "";

  try {
    const uploadsDir = ensureProfilePicsDir();
    const filename = safeGeneratedImageName("profile", req.user.id, decoded.ext);
    filepath = path.join(uploadsDir, filename);

    fs.writeFileSync(filepath, decoded.buffer, { mode: 0o600 });
    const publicUrl = publicUrlForProfilePhoto(filename);
    const updated = updateUserById(req.user.id, { photoUrl: publicUrl });

    if (!updated) {
      try { fs.unlinkSync(filepath); } catch {}
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    for (const previousPath of profilePhotoCandidatePaths(previousUrl)) {
      if (path.resolve(previousPath) === path.resolve(filepath)) continue;
      try { fs.unlinkSync(previousPath); } catch {}
    }

    return res.json({ ok: true, photoUrl: publicUrl });
  } catch (error) {
    if (filepath) {
      try { fs.unlinkSync(filepath); } catch {}
    }
    console.error(
      "Profile photo save failed:",
      String(error?.code || ""),
      String(error?.message || error || "unknown error")
    );
    return res.status(500).json({ ok: false, message: "Profile image could not be saved." });
  }
});

module.exports = router;
