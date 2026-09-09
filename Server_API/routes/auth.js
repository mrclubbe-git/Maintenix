// /opt/maintenix-ui/server-api/routes/auth.js
const express = require("express");
const crypto = require("crypto");

const { getUsers, saveUsers, findByEmail } = require("../lib/userStore");
const { hashPassword, verifyPassword } = require("../lib/passwords");
const { createSession, getSession, deleteSession, extractBearer } = require("../lib/sessions");

const router = express.Router();

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    approvedAt: u.approvedAt,
    approvedBy: u.approvedBy,
  };
}

// POST /api/auth/register
router.post("/register", (req, res) => {
  try {
    const { email, password, name } = req.body || {};

    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanName = String(name || "").trim();

    if (!cleanEmail || !cleanEmail.includes("@")) {
      return res.status(400).json({ ok: false, message: "Valid email is required." });
    }
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ ok: false, message: "Password must be at least 8 characters." });
    }

    if (findByEmail(cleanEmail)) {
      return res.status(409).json({ ok: false, message: "Email already registered." });
    }

    const pw = hashPassword(password);

    const newUser = {
      id: "u_" + crypto.randomBytes(12).toString("hex"),
      email: cleanEmail,
      name: cleanName || null,
      photoUrl: "",
      role: "USER",
      status: "PENDING",
      password: pw,
      createdAt: new Date().toISOString(),
      approvedAt: null,
      approvedBy: null,
    };

    const users = getUsers();
    users.push(newUser);
    saveUsers(users);

    return res.json({ ok: true, status: "PENDING" });
  } catch {
    return res.status(500).json({ ok: false, message: "Registration failed." });
  }
});

// POST /api/auth/login
router.post("/login", (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = String(email || "").trim().toLowerCase();

    const user = findByEmail(cleanEmail);
    if (!user) return res.status(401).json({ ok: false, message: "Invalid email or password." });

    const ok = verifyPassword(String(password || ""), user.password);
    if (!ok) return res.status(401).json({ ok: false, message: "Invalid email or password." });

    // Block until approved (admins always allowed)
    if (user.role !== "ADMIN" && user.status !== "APPROVED") {
      return res.status(403).json({ ok: false, message: "Pending admin approval.", status: user.status });
    }

    const token = createSession(user.id);
    return res.json({ ok: true, token, user: publicUser(user) });
  } catch {
    return res.status(500).json({ ok: false, message: "Login failed." });
  }
});

// GET /api/auth/me
router.get("/me", (req, res) => {
  const token = extractBearer(req);
  const session = token ? getSession(token) : null;

  if (!session) return res.status(401).json({ ok: false, message: "Not logged in." });

  const user = getUsers().find((u) => u.id === session.userId);
  if (!user) return res.status(401).json({ ok: false, message: "Not logged in." });

  return res.json({ ok: true, user: publicUser(user) });
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  const token = extractBearer(req);
  if (token) deleteSession(token);
  return res.json({ ok: true });
});

module.exports = router;

