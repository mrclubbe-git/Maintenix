const { extractSessionToken, getSession, validateCsrfToken } = require("./sessions");

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://mrclubbe-git.github.io"
];

function allowedOrigins() {
  return new Set(
    String(process.env.CORS_ORIGINS || DEFAULT_CORS_ORIGINS.join(","))
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function isStateChanging(method) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(String(method || "").toUpperCase());
}

function isCsrfExempt(req) {
  const routePath = String(req.originalUrl || req.url || "").split("?")[0];
  return (
    routePath.endsWith("/api/auth/login") ||
    routePath.endsWith("/api/auth/register")
  );
}

function csrfProtection(req, res, next) {
  if (!isStateChanging(req.method) || isCsrfExempt(req)) return next();

  const token = extractSessionToken(req);
  if (!token) return next();

  const session = getSession(token);
  if (!session) return next();

  const origin = String(req.headers.origin || "").trim();
  if (origin && !allowedOrigins().has(origin)) {
    return res.status(403).json({ ok: false, message: "Request origin is not allowed." });
  }

  const supplied = String(req.headers["x-csrf-token"] || "").trim();
  if (!validateCsrfToken(session, supplied)) {
    return res.status(403).json({ ok: false, message: "Invalid or missing CSRF token." });
  }

  req.authSession = session;
  req.authSessionToken = token;
  next();
}

module.exports = {
  DEFAULT_CORS_ORIGINS,
  allowedOrigins,
  csrfProtection
};
