const express = require("express");
const crypto = require("crypto");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { allowedOrigins, csrfProtection } = require("./lib/requestSecurity");
const { extractSessionToken, getSession } = require("./lib/sessions");
const { getUsers } = require("./lib/userStore");
const { PROFILE_PICS_DIR } = require("./lib/profilePhotoStorage");
const { logEvent } = require("./lib/siteLogger");

// routes
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const presenceRoutes = require("./routes/presence");
const profileRoutes = require("./lib/profileRoutes");
const profilePasswordRoutes = require("./routes/profilePassword");
const reportsRoutes = require("./routes/reports");
const stockRoutes = require("./routes/stock");
const servicingRoutes = require("./routes/servicing");
const areasRoutes = require("./routes/areas");
const photosRoutes = require("./routes/photos");
const calloutRoutes = require("./routes/callout");
const standbyRoutes = require("./routes/standby");
const notificationsRoutes = require("./routes/notifications");
const pushRoutes = require("./routes/push");
const dailyPlannerRoutes = require("./routes/dailyPlanner");
const formalReportsRoutes = require("./routes/formalReports");
const siteLogsRoutes = require("./routes/siteLogs");

const app = express();
const allowedCorsOrigins = allowedOrigins();
const ORGANIZATION_CODE = String(process.env.ORGANIZATION_CODE || "CRA").trim().toUpperCase() || "CRA";

app.disable("x-powered-by");

app.use((req, res, next) => {
  req.requestId = `req_${crypto.randomUUID().replace(/-/g, "")}`;
  res.setHeader("X-Request-Id", req.requestId);
  next();
});

app.use((req, res, next) => {
  const method = String(req.method || "GET").toUpperCase();
  const routePath = String(req.originalUrl || req.url || "").split("?")[0];
  const writeMethod = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const excluded =
    routePath.startsWith("/api/presence/") ||
    routePath.startsWith("/api/site-logs/") ||
    routePath.startsWith("/api/auth/") ||
    routePath.startsWith("/api/admin/");

  res.on("finish", () => {
    if (excluded) return;

    const status = Number(res.statusCode || 0);
    const shouldLogWrite = writeMethod && status >= 200 && status < 300;
    const shouldLogDenied = status === 403 || status === 429;
    if (!shouldLogWrite && !shouldLogDenied) return;

    try {
      const token = extractSessionToken(req);
      const session = token ? getSession(token) : null;
      const user = session?.userId
        ? getUsers().find((entry) => String(entry.id) === String(session.userId)) || null
        : null;

      const moduleName = routePath
        .replace(/^\/api\//, "")
        .split("/")[0]
        .replace(/[^a-z0-9_-]/gi, "")
        .toUpperCase() || "API";

      logEvent({
        level: shouldLogDenied ? "WARN" : "INFO",
        category: shouldLogDenied ? "SECURITY" : moduleName,
        event: shouldLogDenied ? "API_REQUEST_DENIED" : "API_WRITE_SUCCEEDED",
        message: shouldLogDenied
          ? `API request denied with HTTP ${status}.`
          : `${method} request completed successfully.`,
        user,
        requestId: req.requestId,
        route: routePath,
        method,
        status,
        source: "server"
      });
    } catch {}
  });

  next();
});

app.use((req, res, next) => {
  const origin = String(req.headers.origin || "").trim();

  if (origin && allowedCorsOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Expose-Headers", "X-Request-Id");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-CSRF-Token");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  res.setHeader("X-Frame-Options", "DENY");

  if (String(req.headers["access-control-request-private-network"] || "").toLowerCase() === "true") {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }

  if (req.method === "OPTIONS") {
    if (origin && !allowedCorsOrigins.has(origin)) return res.sendStatus(403);
    return res.sendStatus(204);
  }

  next();
});

// JSON data URLs remain supported for profile images, but individual upload
// routes apply much tighter byte/type limits before anything is persisted.
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Session-bound CSRF protection is applied centrally to authenticated writes.
app.use(csrfProtection);

// New profile photos are stored in data/profilepics so avatar writes use the same
// writable runtime data root as users.json. Keep the historical public URL and
// fall through to data/uploads/profilepics for existing legacy avatar references.
app.use("/uploads/profilepics", express.static(PROFILE_PICS_DIR, {
  fallthrough: true,
  setHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
  }
}));

// Serve uploaded files (legacy profile pics, report photos, reports, etc.)
app.use("/uploads", express.static(path.join(__dirname, "data", "uploads"), {
  fallthrough: true,
  setHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
  }
}));

// mount API routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/presence", presenceRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/profile", profilePasswordRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/servicing", servicingRoutes);
app.use("/api/areas", areasRoutes);
app.use("/api/photos", photosRoutes);
app.use("/api/callout", calloutRoutes);
app.use("/api/standby", standbyRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/daily-planner", dailyPlannerRoutes);
app.use("/api/formal-reports", formalReportsRoutes);
app.use("/api/site-logs", siteLogsRoutes);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

function requireAdminMetrics(req, res, next) {
  const token = extractSessionToken(req);
  const session = token ? getSession(token) : null;
  if (!session?.userId) return res.status(401).json({ ok: false, message: "Not logged in." });

  const user = getUsers().find((entry) => String(entry.id) === String(session.userId)) || null;
  if (!user) return res.status(401).json({ ok: false, message: "Not logged in." });

  const userOrg = String(user.organization || session.organization || ORGANIZATION_CODE).trim().toUpperCase();
  if (userOrg !== ORGANIZATION_CODE) {
    return res.status(403).json({ ok: false, message: "Not authorised for this organisation." });
  }

  const role = String(user.role || "").trim().toUpperCase();
  if (role !== "ADMIN") return res.status(403).json({ ok: false, message: "Admin only." });

  req.user = user;
  next();
}

// ---- CPU usage from /proc/stat (Linux) ----
function readProcStat() {
  const firstLine = fs.readFileSync("/proc/stat", "utf8").split("\n")[0];
  const parts = firstLine.trim().split(/\s+/);
  const nums = parts.slice(1).map((n) => parseInt(n, 10));

  const user = nums[0] || 0;
  const nice = nums[1] || 0;
  const system = nums[2] || 0;
  const idle = nums[3] || 0;
  const iowait = nums[4] || 0;
  const irq = nums[5] || 0;
  const softirq = nums[6] || 0;
  const steal = nums[7] || 0;

  const idleAll = idle + iowait;
  const nonIdle = user + nice + system + irq + softirq + steal;
  const total = idleAll + nonIdle;

  return { total, idle: idleAll };
}

let prev = null;
function cpuUsagePercent() {
  const cur = readProcStat();
  if (!prev) {
    prev = cur;
    return 0;
  }
  const totalDelta = cur.total - prev.total;
  const idleDelta = cur.idle - prev.idle;
  prev = cur;

  if (totalDelta <= 0) return 0;
  const usage = (1 - idleDelta / totalDelta) * 100;
  return Math.max(0, Math.min(100, Number(usage.toFixed(1))));
}

function diskUsage(mountPath = "/") {
  const output = execFileSync("df", ["-P", mountPath], { encoding: "utf8" }).trim().split("\n");
  if (output.length < 2) return null;

  const cols = output[1].split(/\s+/);
  const totalKB = parseInt(cols[1], 10);
  const usedKB = parseInt(cols[2], 10);
  const availKB = parseInt(cols[3], 10);

  const total = totalKB * 1024;
  const used = usedKB * 1024;
  const free = availKB * 1024;
  const usedPercent = total > 0 ? (used / total) * 100 : 0;

  return {
    mountPath,
    storageUsedPercent: Math.max(0, Math.min(100, Number(usedPercent.toFixed(1)))),
    storageFreeGB: Math.max(0, Math.round(free / (1024 ** 3)))
  };
}

// Detailed telemetry is deliberately ADMIN-only. It remains on the historical
// endpoint because Administration -> System consumes it.
app.get("/api/server/status", requireAdminMetrics, (_req, res) => {
  try {
    const disk = diskUsage("/") || { storageUsedPercent: 0, storageFreeGB: 0 };
    res.setHeader("Cache-Control", "no-store, private");
    return res.json({
      ok: true,
      service: "Maintenix CRA API",
      host: os.hostname(),
      cpuUsagePercent: cpuUsagePercent(),
      storageUsedPercent: disk.storageUsedPercent,
      storageFreeGB: disk.storageFreeGB,
      processUptimeSeconds: Math.round(process.uptime())
    });
  } catch {
    return res.status(500).json({ ok: false, message: "Failed to read server metrics." });
  }
});

/**
 * Cleanly handle payload-too-large errors (prevents confusing 500s).
 */
app.use((err, req, res, next) => {
  if (err && (err.type === "entity.too.large" || err.status === 413 || err.code === "LIMIT_FILE_SIZE")) {
    try {
      logEvent({
        level: "WARN",
        category: "API",
        event: "PAYLOAD_TOO_LARGE",
        message: "Request payload exceeded the configured upload limit.",
        requestId: req.requestId,
        route: req.originalUrl,
        method: req.method,
        status: 413,
        appVersion: req.headers["x-maintenix-app-build"] || "",
        source: "server"
      });
    } catch {}
    return res.status(413).json({
      ok: false,
      message: "Upload is too large. Please choose a smaller image.",
      requestId: req.requestId
    });
  }
  next(err);
});

app.use((err, req, res, _next) => {
  try {
    logEvent({
      level: "ERROR",
      category: "API",
      event: "UNHANDLED_API_ERROR",
      message: String(err?.message || "Unhandled API error."),
      requestId: req.requestId,
      route: req.originalUrl,
      method: req.method,
      status: Number(err?.status || 500),
      appVersion: req.headers["x-maintenix-app-build"] || "",
      source: "server",
      details: {
        errorName: String(err?.name || ""),
        errorCode: String(err?.code || "")
      }
    });
  } catch {}

  if (res.headersSent) return;
  return res.status(Number(err?.status || 500)).json({
    ok: false,
    message: "Unexpected server error.",
    requestId: req.requestId
  });
});

const PORT = process.env.PORT || 5055;
const HOST = process.env.HOST || "127.0.0.1";
app.listen(PORT, HOST, () => {
  console.log(`Maintenix server API listening on ${HOST}:${PORT}`);
});
