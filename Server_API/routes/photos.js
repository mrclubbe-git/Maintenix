// /opt/maintenix-ui/server-api/routes/photos.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");

const { getSession, extractBearer } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");

const router = express.Router();

const REPORT_PHOTOS_DIR = path.join(__dirname, "..", "data", "uploads", "reportphotos");
const REPORTS_META_FILE = path.join(__dirname, "..", "data", "reports.meta.json");

function safeRole(x) {
  return String(x || "").trim().toUpperCase().replace(/\s+/g, "");
}

function requireAuth(req, res, next) {
  let token = "";
  try {
    token = extractBearer(req);
  } catch {
    const auth = (req.headers && req.headers.authorization) || "";
    token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  }

  const session = token ? getSession(token) : null;
  if (!session?.userId) return res.status(401).json({ ok: false, message: "Not logged in." });

  const user = getUsers().find((u) => u.id === session.userId) || null;
  if (!user) return res.status(401).json({ ok: false, message: "Not logged in." });

  req.user = user;
  next();
}

function canAdmin(role) {
  return safeRole(role) === "ADMIN";
}

function canL3OrAdmin(role) {
  const r = safeRole(role);
  return r === "ADMIN" || r === "L3" || r === "LEVEL3" || r === "LEVEL_3";
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readReportsMeta() {
  try {
    if (!fs.existsSync(REPORTS_META_FILE)) return [];
    const raw = fs.readFileSync(REPORTS_META_FILE, "utf8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.reports) ? parsed.reports : []);
  } catch {
    return [];
  }
}

function getRangeWindow(range) {
  const now = Date.now();
  const r = String(range || "30d").toLowerCase().trim();
  if (r === "all") return { fromMs: 0, toMs: now };

  const map = {
    "today": 1,
    "7d": 7,
    "14d": 14,
    "30d": 30,
    "90d": 90
  };
  const days = map[r] || 30;
  const fromMs = now - days * 24 * 60 * 60 * 1000;
  return { fromMs, toMs: now };
}

/**
 * ✅ Safer resolver used by both path-param and query-param endpoints
 */
function resolvePhotoPath(reportId, filename) {
  const rid = String(reportId || "").trim();
  const fn = String(filename || "").trim();

  if (!rid || !fn) return { ok: false, status: 400, message: "Bad request." };

  // Prevent path traversal
  if (rid.includes("..") || fn.includes("..")) return { ok: false, status: 400, message: "Bad request." };

  const fullPath = path.join(REPORT_PHOTOS_DIR, rid, fn);
  return { ok: true, reportId: rid, filename: fn, fullPath };
}

// GET /api/photos?range=today|7d|14d|30d|90d|all
router.get("/", requireAuth, (req, res) => {
  ensureDir(REPORT_PHOTOS_DIR);

  const range = String(req.query?.range || "30d");
  const { fromMs, toMs } = getRangeWindow(range);

  const meta = readReportsMeta();
  const metaById = new Map();
  meta.forEach((m) => {
    const id = String(m?.id || m?.reportId || "").trim();
    if (id) metaById.set(id, m);
  });

  const rows = [];

  let reportFolders = [];
  try {
    reportFolders = fs.readdirSync(REPORT_PHOTOS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    reportFolders = [];
  }

  for (const dirent of reportFolders) {
    const reportId = dirent.name;
    const folder = path.join(REPORT_PHOTOS_DIR, reportId);

    let files = [];
    try {
      files = fs.readdirSync(folder, { withFileTypes: true }).filter((f) => f.isFile());
    } catch {
      files = [];
    }

    for (const f of files) {
      const filename = f.name;
      const fullPath = path.join(folder, filename);

      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      const mtime = stat.mtimeMs || stat.mtime?.getTime?.() || 0;
      if (mtime < fromMs || mtime > toMs) continue;

      const m = metaById.get(reportId) || null;

      rows.push({
        reportId,
        reportName: m?.fileName || m?.filename || m?.name || m?.title || "",
        reportDate: m?.date || m?.createdAt || m?.created || "",
        photo: {
          filename,
          size: stat.size || 0,
          updatedAt: new Date(mtime).toISOString(),
          url: `/uploads/reportphotos/${encodeURIComponent(reportId)}/${encodeURIComponent(filename)}`,

          // ✅ Use query-based download URL to avoid 404s caused by path param encoding issues
          downloadUrl: `/api/photos/fileq?reportId=${encodeURIComponent(reportId)}&filename=${encodeURIComponent(filename)}&download=1`,

          // ✅ Keep legacy path-param download URL for backwards compatibility
          downloadUrlLegacy: `/api/photos/file/${encodeURIComponent(reportId)}/${encodeURIComponent(filename)}?download=1`
        }
      });
    }
  }

  // newest first
  rows.sort((a, b) => String(b.photo.updatedAt).localeCompare(String(a.photo.updatedAt)));

  res.json({ ok: true, range, rows });
});

// ✅ NEW: GET /api/photos/fileq?reportId=...&filename=...[&download=1]
// Query-based version prevents routing problems caused by special chars in filename.
router.get("/fileq", requireAuth, (req, res) => {
  ensureDir(REPORT_PHOTOS_DIR);

  const reportId = req.query?.reportId;
  const filename = req.query?.filename;

  const resolved = resolvePhotoPath(reportId, filename);
  if (!resolved.ok) return res.status(resolved.status).send(resolved.message);

  const { fullPath } = resolved;
  if (!fs.existsSync(fullPath)) return res.status(404).send("Not found.");

  const type = mime.lookup(fullPath) || "application/octet-stream";
  res.setHeader("Content-Type", type);

  const download = String(req.query.download || "").trim() === "1";
  if (download) {
    if (!canL3OrAdmin(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin/L3 only." });
    res.setHeader("Content-Disposition", `attachment; filename="${String(filename).replace(/"/g, "")}"`);
  } else {
    res.setHeader("Content-Disposition", `inline; filename="${String(filename).replace(/"/g, "")}"`);
  }

  fs.createReadStream(fullPath).pipe(res);
});

// GET /api/photos/file/:reportId/:filename[?download=1]
// Inline by default; attachment if download=1. L3/Admin can download; everyone can view thumbnail.
router.get("/file/:reportId/:filename", requireAuth, (req, res) => {
  ensureDir(REPORT_PHOTOS_DIR);

  const reportId = String(req.params.reportId || "").trim();
  const filename = String(req.params.filename || "").trim();

  if (!reportId || !filename) return res.status(400).send("Bad request.");

  // Prevent path traversal
  if (reportId.includes("..") || filename.includes("..")) return res.status(400).send("Bad request.");

  const fullPath = path.join(REPORT_PHOTOS_DIR, reportId, filename);
  if (!fs.existsSync(fullPath)) return res.status(404).send("Not found.");

  const type = mime.lookup(fullPath) || "application/octet-stream";
  res.setHeader("Content-Type", type);

  const download = String(req.query.download || "").trim() === "1";
  if (download) {
    if (!canL3OrAdmin(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin/L3 only." });
    res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
  } else {
    // inline preview
    res.setHeader("Content-Disposition", `inline; filename="${filename.replace(/"/g, "")}"`);
  }

  fs.createReadStream(fullPath).pipe(res);
});

// ✅ NEW: DELETE /api/photos/delete?reportId=...&filename=...  (ADMIN only)
router.delete("/delete", requireAuth, (req, res) => {
  if (!canAdmin(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin only." });

  const reportId = req.query?.reportId;
  const filename = req.query?.filename;

  const resolved = resolvePhotoPath(reportId, filename);
  if (!resolved.ok) return res.status(resolved.status).json({ ok: false, message: resolved.message });

  const { fullPath } = resolved;
  if (!fs.existsSync(fullPath)) return res.status(404).json({ ok: false, message: "Not found." });

  try {
    fs.unlinkSync(fullPath);
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Failed to delete.", details: String(e?.message || e) });
  }

  res.json({ ok: true });
});

// DELETE /api/photos/:reportId/:filename  (ADMIN only)
router.delete("/:reportId/:filename", requireAuth, (req, res) => {
  if (!canAdmin(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin only." });

  const reportId = String(req.params.reportId || "").trim();
  const filename = String(req.params.filename || "").trim();
  if (!reportId || !filename) return res.status(400).json({ ok: false, message: "Bad request." });

  if (reportId.includes("..") || filename.includes("..")) return res.status(400).json({ ok: false, message: "Bad request." });

  const fullPath = path.join(REPORT_PHOTOS_DIR, reportId, filename);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ ok: false, message: "Not found." });

  try {
    fs.unlinkSync(fullPath);
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Failed to delete.", details: String(e?.message || e) });
  }

  res.json({ ok: true });
});

// POST /api/photos/clear  (ADMIN only) - clears entire reportphotos folder contents
router.post("/clear", requireAuth, (req, res) => {
  if (!canAdmin(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin only." });

  ensureDir(REPORT_PHOTOS_DIR);

  try {
    const dirs = fs.readdirSync(REPORT_PHOTOS_DIR, { withFileTypes: true });
    for (const d of dirs) {
      const p = path.join(REPORT_PHOTOS_DIR, d.name);
      // rm recursive (node 18 supports fs.rmSync)
      fs.rmSync(p, { recursive: true, force: true });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Failed to clear report photos.", details: String(e?.message || e) });
  }

  res.json({ ok: true });
});

module.exports = router;

