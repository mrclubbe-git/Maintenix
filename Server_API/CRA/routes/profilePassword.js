// /opt/maintenix-ui/server-api/routes/profilePassword.js
const express = require("express");
const { extractBearer, getSession } = require("../lib/sessions");
const { getUsers, updateUserById } = require("../lib/userStore");
const { hashPassword, verifyPassword } = require("../lib/passwords");

const router = express.Router();

function requireAuth(req, res, next) {
  const token = extractBearer(req); // works with your updated extractBearer
  const session = getSession(token);

  if (!session?.userId) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  const user = getUsers().find((u) => u.id === session.userId);
  if (!user) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  req.user = user;
  next();
}

// POST /api/profile/change-password
// body: { currentPassword, newPassword }
router.post("/change-password", requireAuth, (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");

  if (!currentPassword) {
    return res.status(400).json({ ok: false, message: "Current password is required." });
  }

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ ok: false, message: "New password must be at least 8 characters." });
  }

  // ✅ Your DB stores password as an object: { salt, hash, algo, keylen }
  const storedPasswordObj = req.user.password;

  if (!storedPasswordObj || typeof storedPasswordObj !== "object") {
    return res.status(400).json({ ok: false, message: "Password not set for this user." });
  }

  const ok = verifyPassword(currentPassword, storedPasswordObj);
  if (!ok) {
    return res.status(400).json({ ok: false, message: "Current password is incorrect." });
  }

  const newPasswordObj = hashPassword(newPassword);

  const updated = updateUserById(req.user.id, { password: newPasswordObj });
  if (!updated) {
    return res.status(404).json({ ok: false, message: "User not found." });
  }

  return res.json({ ok: true });
});

module.exports = router;
