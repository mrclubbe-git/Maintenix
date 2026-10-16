const express = require("express");
const crypto = require("crypto");

const { getUsers, saveUsers, findByEmail } = require("../lib/userStore");
const { hashPassword, verifyPassword } = require("../lib/passwords");
const {
  createSession,
  getSession,
  getSessionExpiresAt,
  deleteSession,
  extractSessionToken,
  setSessionCookie,
  clearSessionCookie
} = require("../lib/sessions");

const router = express.Router();
const ORGANIZATION_CODE = String(process.env.ORGANIZATION_CODE || "CRA").trim().toUpperCase() || "CRA";
const LOGIN_WINDOW_MS = Math.max(60_000, Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000));
const LOGIN_MAX_FAILURES = Math.max(3, Number(process.env.AUTH_RATE_LIMIT_MAX_FAILURES || 8));
const loginFailures = new Map();

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  next();
});

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    photoUrl: u.photoUrl || "",
    organization: String(u.organization || ORGANIZATION_CODE).trim().toUpperCase(),
    createdAt: u.createdAt,
    approvedAt: u.approvedAt,
    approvedBy: u.approvedBy
  };
}

function clientAddress(req) {
  const forwarded = String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || String(req.socket?.remoteAddress || "unknown");
}

function loginKey(req, email) {
  return `${clientAddress(req)}|${String(email || "").trim().toLowerCase()}`;
}

function pruneFailures(now = Date.now()) {
  for (const [key, entry] of loginFailures.entries()) {
    if (now - Number(entry?.firstAt || 0) > LOGIN_WINDOW_MS) loginFailures.delete(key);
  }
}

function currentFailureState(req, email) {
  const now = Date.now();
  pruneFailures(now);
  const key = loginKey(req, email);
  const entry = loginFailures.get(key);
  if (!entry) return { key, count: 0, retryAfterMs: 0 };
  const age = now - Number(entry.firstAt || now);
  if (age >= LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return { key, count: 0, retryAfterMs: 0 };
  }
  return {
    key,
    count: Number(entry.count || 0),
    retryAfterMs: Math.max(0, LOGIN_WINDOW_MS - age)
  };
}

function recordFailure(req, email) {
  const state = currentFailureState(req, email);
  const now = Date.now();
  const next = {
    count: state.count + 1,
    firstAt: state.count ? (loginFailures.get(state.key)?.firstAt || now) : now,
    lastAt: now
  };
  loginFailures.set(state.key, next);
  return next;
}

function clearFailures(req, email) {
  loginFailures.delete(loginKey(req, email));
}

function rateLimitResponse(res, retryAfterMs) {
  const retryAfter = Math.max(1, Math.ceil(Number(retryAfterMs || LOGIN_WINDOW_MS) / 1000));
  res.setHeader("Retry-After", String(retryAfter));
  return res.status(429).json({
    ok: false,
    message: "Too many failed sign-in attempts. Please wait before trying again.",
    retryAfterSeconds: retryAfter
  });
}

// POST /api/auth/register
router.post("/register", (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanName = String(name || "").trim();

    if (!cleanEmail || !cleanEmail.includes("@") || cleanEmail.length > 254) {
      return res.status(400).json({ ok: false, message: "Valid email is required." });
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 256) {
      return res.status(400).json({ ok: false, message: "Password must be between 8 and 256 characters." });
    }
    if (cleanName.length > 120) {
      return res.status(400).json({ ok: false, message: "Name must be 120 characters or fewer." });
    }

    if (findByEmail(cleanEmail)) {
      return res.status(409).json({ ok: false, message: "Email already registered." });
    }

    const newUser = {
      id: "u_" + crypto.randomBytes(12).toString("hex"),
      email: cleanEmail,
      name: cleanName || null,
      photoUrl: "",
      role: "USER",
      status: "PENDING",
      organization: ORGANIZATION_CODE,
      password: hashPassword(password),
      createdAt: new Date().toISOString(),
      approvedAt: null,
      approvedBy: null
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
    const failureState = currentFailureState(req, cleanEmail);

    if (failureState.count >= LOGIN_MAX_FAILURES) {
      return rateLimitResponse(res, failureState.retryAfterMs);
    }

    const user = findByEmail(cleanEmail);
    const ok = Boolean(user) && verifyPassword(String(password || ""), user.password);
    if (!ok) {
      const failure = recordFailure(req, cleanEmail);
      if (failure.count >= LOGIN_MAX_FAILURES) {
        return rateLimitResponse(res, LOGIN_WINDOW_MS - (Date.now() - failure.firstAt));
      }
      return res.status(401).json({ ok: false, message: "Invalid email or password." });
    }

    clearFailures(req, cleanEmail);

    const role = String(user.role || "").trim().toUpperCase();
    const status = String(user.status || "").trim().toUpperCase();
    if (role !== "ADMIN" && status !== "APPROVED") {
      return res.status(403).json({ ok: false, message: "Pending admin approval.", status: user.status });
    }

    const organization = String(user.organization || ORGANIZATION_CODE).trim().toUpperCase();
    if (organization !== ORGANIZATION_CODE) {
      return res.status(403).json({ ok: false, message: "Account is not authorised for this organisation." });
    }

    const token = createSession(user.id, { organization });
    const session = getSession(token);
    const expiresAt = setSessionCookie(res, token);

    return res.json({
      ok: true,
      expiresAt,
      csrfToken: session?.csrfToken || "",
      user: publicUser(user)
    });
  } catch {
    return res.status(500).json({ ok: false, message: "Login failed." });
  }
});

function authenticated(req) {
  const token = extractSessionToken(req);
  const session = token ? getSession(token) : null;
  const user = session?.userId ? getUsers().find((u) => u.id === session.userId) : null;
  if (!session || !user) return null;

  const organization = String(user.organization || session.organization || ORGANIZATION_CODE).trim().toUpperCase();
  const role = String(user.role || "").trim().toUpperCase();
  const status = String(user.status || "").trim().toUpperCase();
  if (organization !== ORGANIZATION_CODE) return null;
  if (role !== "ADMIN" && status !== "APPROVED") return null;

  return { token, session, user };
}

// GET /api/auth/me
router.get("/me", (req, res) => {
  const auth = authenticated(req);
  if (!auth) {
    clearSessionCookie(res);
    return res.status(401).json({ ok: false, message: "Not logged in." });
  }

  return res.json({
    ok: true,
    user: publicUser(auth.user),
    expiresAt: getSessionExpiresAt(auth.token),
    csrfToken: auth.session.csrfToken
  });
});

// GET /api/auth/csrf
router.get("/csrf", (req, res) => {
  const auth = authenticated(req);
  if (!auth) {
    clearSessionCookie(res);
    return res.status(401).json({ ok: false, message: "Not logged in." });
  }
  return res.json({
    ok: true,
    csrfToken: auth.session.csrfToken,
    expiresAt: getSessionExpiresAt(auth.token)
  });
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  const token = extractSessionToken(req);
  if (token) deleteSession(token);
  clearSessionCookie(res);
  return res.json({ ok: true });
});

module.exports = router;
