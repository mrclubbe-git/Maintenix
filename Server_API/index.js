const express = require("express");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// routes
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const presenceRoutes = require("./routes/presence");
const profileRoutes = require("./lib/profileRoutes");
const profilePasswordRoutes = require("./routes/profilePassword");
const reportsRoutes = require("./routes/reports");
const stockRoutes = require("./routes/stock");
const servicingRoutes = require("./routes/servicing");
const photosRoutes = require("./routes/photos");
const calloutRoutes = require("./routes/callout");
const standbyRoutes = require("./routes/standby");
const notificationsRoutes = require("./routes/notifications");
const dailyPlannerRoutes = require("./routes/dailyPlanner");
const formalReportsRoutes = require("./routes/formalReports");

const app = express();

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://mrclubbe-git.github.io"
];

const allowedCorsOrigins = new Set(
  String(process.env.CORS_ORIGINS || DEFAULT_CORS_ORIGINS.join(","))
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
);

app.use((req, res, next) => {
  const origin = String(req.headers.origin || "").trim();

  if (origin && allowedCorsOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");

  if (String(req.headers["access-control-request-private-network"] || "").toLowerCase() === "true") {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }

  if (req.method === "OPTIONS") {
    if (origin && !allowedCorsOrigins.has(origin)) return res.sendStatus(403);
    return res.sendStatus(204);
  }

  next();
});

/**
 * ✅ Increase request body limits for base64 uploads (profile photos, etc.)
 * Base64 inflates size, so default limits can cause 500 errors.
 */
app.use(express.json({ limit: "75mb" }));
app.use(express.urlencoded({ extended: true, limit: "75mb" }));

// Serve uploaded files (profile pics, report photos, reports, etc.)
app.use("/uploads", express.static(path.join(__dirname, "data", "uploads")));

// mount API routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/presence", presenceRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/profile", profilePasswordRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/servicing", servicingRoutes);
app.use("/api/photos", photosRoutes);
app.use("/api/callout", calloutRoutes);
app.use("/api/standby", standbyRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/daily-planner", dailyPlannerRoutes);
app.use("/api/formal-reports", formalReportsRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

/**
 * ✅ Cleanly handle payload-too-large errors (prevents confusing 500s)
 * This catches body-parser errors like entity.too.large and returns 413.
 */
app.use((err, req, res, next) => {
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    return res.status(413).json({
      ok: false,
      message: "Image too large. Please upload a smaller photo."
    });
  }
  next(err);
});

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

// ---- Disk usage (Linux via df -P) ----
function diskUsage(mountPath = "/") {
  const out = execSync(`df -P ${mountPath}`, { encoding: "utf8" })
    .trim()
    .split("\n");
  if (out.length < 2) return null;

  const cols = out[1].split(/\s+/);
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
    storageFreeGB: Math.max(0, Math.round(free / (1024 ** 3))),
  };
}

app.get("/api/server/status", (_req, res) => {
  try {
    const host = os.hostname();
    const cpu = cpuUsagePercent();
    const disk = diskUsage("/") || { storageUsedPercent: 0, storageFreeGB: 0 };

    res.json({
      host,
      cpuUsagePercent: cpu,
      storageUsedPercent: disk.storageUsedPercent,
      storageFreeGB: disk.storageFreeGB,
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to read server metrics" });
  }
});

const PORT = process.env.PORT || 5055;
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`Maintenix server API listening on ${HOST}:${PORT}`);
});
