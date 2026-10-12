// /opt/maintenix-ui/server-api/routes/admin.js
const express = require("express");
const { getUsers, saveUsers } = require("../lib/userStore");
const { getSession, extractBearer } = require("../lib/sessions");

const router = express.Router();

function safeRole(x) {
  return String(x || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function requireAdmin(req, res, next) {
  let token = "";
  try {
    token = extractBearer(req);
  } catch {
    const auth = (req.headers && req.headers.authorization) || "";
    token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  }

  const session = token ? getSession(token) : null;
  if (!session) return res.status(401).json({ ok: false, message: "Not logged in." });

  const user = getUsers().find((u) => u.id === session.userId) || null;
  if (!user) return res.status(401).json({ ok: false, message: "Not logged in." });

  if (safeRole(user.role) !== "ADMIN") return res.status(403).json({ ok: false, message: "Admin only." });

  req.admin = user;
  next();
}

// GET /api/admin/users?status=PENDING
router.get("/users", requireAdmin, (req, res) => {
  const status = safeRole(req.query.status);
  let users = getUsers();

  if (status) {
    users = users.filter((u) => safeRole(u.status) === status);
  }

  // never return password data
  const safe = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    photoUrl: u.photoUrl || "",
    createdAt: u.createdAt,
    approvedAt: u.approvedAt,
    approvedBy: u.approvedBy
  }));

  res.json({ ok: true, users: safe });
});

// POST /api/admin/users/:id/approve
router.post("/users/:id/approve", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");
  const users = getUsers();
  const u = users.find((x) => String(x.id) === id);

  if (!u) return res.status(404).json({ ok: false, message: "User not found." });

  u.status = "APPROVED";
  u.approvedAt = new Date().toISOString();
  u.approvedBy = req.admin.email;

  // ✅ Default role on approval
  const role = safeRole(u.role);
  if (!role || !["ADMIN", "L1", "L2", "L3"].includes(role)) {
    u.role = "L1";
  }

  saveUsers(users);
  res.json({ ok: true });
});

// POST /api/admin/users/:id/deny
router.post("/users/:id/deny", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");
  const users = getUsers();
  const u = users.find((x) => String(x.id) === id);

  if (!u) return res.status(404).json({ ok: false, message: "User not found." });

  u.status = "DENIED";
  u.approvedAt = new Date().toISOString();
  u.approvedBy = req.admin.email;

  saveUsers(users);
  res.json({ ok: true });
});

/**
 * ✅ PATCH /api/admin/users/:id/role
 * Body: { role: "ADMIN" | "L1" | "L2" }
 */
router.patch("/users/:id/role", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");
  const nextRole = safeRole(req.body?.role);

  if (!["ADMIN", "L1", "L2", "L3"].includes(nextRole)) {
    return res.status(400).json({ ok: false, message: 'Invalid role.' });
  }

  const users = getUsers();
  const u = users.find((x) => String(x.id) === id);
  if (!u) return res.status(404).json({ ok: false, message: "User not found." });

  // Safety: prevent admin from downgrading themselves by mistake
  if (String(u.id) === String(req.admin.id) && nextRole !== "ADMIN") {
    return res.status(400).json({ ok: false, message: "You cannot downgrade your own ADMIN role." });
  }

  u.role = nextRole;
  saveUsers(users);

  res.json({
    ok: true,
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status
    }
  });
});

/**
 * ✅ DELETE /api/admin/users/:id
 * Removes user from users.json
 */
router.delete("/users/:id", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");

  // Safety: prevent deleting yourself
  if (id === String(req.admin.id)) {
    return res.status(400).json({ ok: false, message: "You cannot delete your own admin account." });
  }

  const users = getUsers();
  const exists = users.some((u) => String(u.id) === id);
  if (!exists) return res.status(404).json({ ok: false, message: "User not found." });

  const updated = users.filter((u) => String(u.id) !== id);
  saveUsers(updated);

  res.json({ ok: true });
});

module.exports = router;
