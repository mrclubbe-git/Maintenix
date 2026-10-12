// /opt/maintenix-ui/server-api/routes/photos.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");

const { getSession, extractBearer } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");
const { safeRelativePath, resolveUnder } = require("../lib/reportStorage");

const router = express.Router();

const REPORT_PHOTOS_DIR = path.join(__dirname, "..", "data", "uploads", "reportphotos");
const REPORTS_META_FILE = path.join(__dirname, "..", "data", "reports.meta.json");
const AUTO_DELETE_MONTHS = 24;
const MAX_PAGE_SIZE = 120;
const DEFAULT_PAGE_SIZE = 48;

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

function cleanSpaces(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function readReportsMeta() {
  try {
    if (!fs.existsSync(REPORTS_META_FILE)) return [];
    const raw = fs.readFileSync(REPORTS_META_FILE, "utf8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.reports)) return parsed.reports;
    if (parsed?.reports && typeof parsed.reports === "object") {
      return Object.entries(parsed.reports).map(([storedPath, m]) => ({ storedPath, ...(m || {}) }));
    }
    return [];
  } catch {
    return [];
  }
}

function buildMetaIndexes() {
  const meta = readReportsMeta();
  const byId = new Map();
  const byName = new Map();
  for (const m of meta) {
    const id = cleanSpaces(m?.id || m?.reportId || "");
    if (id) byId.set(id, m);
    const names = [m?.fileName, m?.filename, m?.name, m?.storedPath, m?.relativePath].map(cleanSpaces).filter(Boolean);
    for (const n of names) byName.set(path.basename(n), m);
  }
  return { meta, byId, byName };
}

function getRangeWindow(range) {
  const now = new Date();
  const end = now.getTime();
  const r = String(range || "30d").toLowerCase().trim();
  if (r === "all") return { fromMs: 0, toMs: end };
  if (r === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { fromMs: start.getTime(), toMs: end };
  }
  if (r === "last_month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const finish = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { fromMs: start.getTime(), toMs: finish.getTime() };
  }
  if (r === "ytd") return { fromMs: new Date(now.getFullYear(), 0, 1).getTime(), toMs: end };
  const map = { "7d": 7, "past_7_days": 7, "14d": 14, "30d": 30, "90d": 90 };
  const days = map[r] || 30;
  return { fromMs: end - days * 24 * 60 * 60 * 1000, toMs: end };
}

function cutoff24MonthsMs() {
  const d = new Date();
  d.setMonth(d.getMonth() - AUTO_DELETE_MONTHS);
  return d.getTime();
}

function safePhotoRel(reportId, filename) {
  const rid = safeRelativePath(reportId);
  const fn = path.basename(String(filename || ""));
  if (!rid || !fn || fn.includes("..") || fn.includes("/") || fn.includes("\\")) return null;
  return `${rid}/${fn}`;
}

function resolvePhotoPath(reportId, filename) {
  const rel = safePhotoRel(reportId, filename);
  if (!rel) return { ok: false, status: 400, message: "Bad request." };
  const fullPath = resolveUnder(REPORT_PHOTOS_DIR, rel);
  if (!fullPath) return { ok: false, status: 400, message: "Bad request." };
  return { ok: true, reportId: safeRelativePath(reportId), filename: path.basename(String(filename || "")), fullPath };
}

function listPhotoFiles() {
  ensureDir(REPORT_PHOTOS_DIR);
  const out = [];
  const imageExt = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"]);
  const walk = (dir) => {
    let items = [];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile() && imageExt.has(path.extname(item.name).toLowerCase())) {
        const rel = path.relative(REPORT_PHOTOS_DIR, full).replace(/\\/g, "/");
        const parts = rel.split("/");
        const filename = parts.pop();
        const reportId = parts.join("/");
        out.push({ reportId, filename, rel, fullPath: full });
      }
    }
  };
  walk(REPORT_PHOTOS_DIR);
  return out;
}

function cleanupOldPhotos() {
  ensureDir(REPORT_PHOTOS_DIR);
  const cutoff = cutoff24MonthsMs();
  let deleted = 0;
  let errors = 0;
  for (const p of listPhotoFiles()) {
    try {
      const st = fs.statSync(p.fullPath);
      const mtime = st.mtimeMs || st.mtime?.getTime?.() || 0;
      if (mtime && mtime < cutoff) {
        fs.unlinkSync(p.fullPath);
        deleted++;
      }
    } catch {
      errors++;
    }
  }
  removeEmptyDirs(REPORT_PHOTOS_DIR);
  return { deleted, errors, cutoff: new Date(cutoff).toISOString(), retentionMonths: AUTO_DELETE_MONTHS };
}

function removeEmptyDirs(root) {
  if (!fs.existsSync(root)) return;
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
    for (const e of entries) if (e.isDirectory()) walk(path.join(dir, e.name));
    if (dir !== root) {
      try {
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } catch {}
    }
  };
  walk(root);
}

function metaForPhoto(p, indexes) {
  const reportIdBase = path.basename(p.reportId || "");
  return indexes.byId.get(p.reportId) || indexes.byId.get(reportIdBase) || indexes.byName.get(reportIdBase) || null;
}

function reportType(m) {
  const t = String(m?.type || m?.reportType || "").toUpperCase();
  if (t.includes("CALLOUT")) return "CALLOUT";
  if (t.includes("SERVICING") || t.includes("SERVICE")) return "SERVICING";
  return "UNKNOWN";
}

function buildRows() {
  const indexes = buildMetaIndexes();
  return listPhotoFiles().map((p) => {
    const st = fs.statSync(p.fullPath);
    const m = metaForPhoto(p, indexes);
    const updatedAt = new Date(st.mtimeMs || st.mtime?.getTime?.() || Date.now()).toISOString();
    const section = cleanSpaces(m?.section || "");
    const reportMonth = cleanSpaces(m?.reportMonth || String(m?.createdDate || m?.createdAt || updatedAt).slice(0, 7));
    const area = cleanSpaces(m?.area || "");
    const technician = cleanSpaces(m?.technician || m?.technicianName || "");
    const service = cleanSpaces(m?.service || m?.serviceType || "");
    const displayName = cleanSpaces(m?.fileName || m?.filename || m?.name || m?.title || path.basename(m?.storedPath || "") || p.reportId);
    const query = `reportId=${encodeURIComponent(p.reportId)}&filename=${encodeURIComponent(p.filename)}`;
    return {
      reportId: p.reportId,
      reportName: displayName,
      reportDate: m?.createdDate || m?.createdAt || m?.created || "",
      section,
      reportMonth,
      area,
      technician,
      service,
      reportType: reportType(m),
      photo: {
        filename: p.filename,
        size: st.size || 0,
        updatedAt,
        url: `/api/photos/fileq?${query}`,
        previewUrl: `/api/photos/fileq?${query}`,
        downloadUrl: `/api/photos/fileq?${query}&download=1`,
        downloadUrlLegacy: `/api/photos/file/${encodeURIComponent(p.reportId)}/${encodeURIComponent(p.filename)}?download=1`
      }
    };
  });
}

function includes(haystack, needle) {
  if (!needle) return true;
  return String(haystack || "").toLowerCase().includes(String(needle || "").toLowerCase());
}

function applyFilters(rows, query) {
  const range = String(query.range || "30d");
  const { fromMs, toMs } = getRangeWindow(range);
  const section = cleanSpaces(query.section || "");
  const month = cleanSpaces(query.month || query.reportMonth || "");
  const area = cleanSpaces(query.area || "");
  const technician = cleanSpaces(query.technician || "");
  const type = cleanSpaces(query.type || "").toUpperCase();
  const service = cleanSpaces(query.service || "");
  const q = cleanSpaces(query.q || query.search || "").toLowerCase();

  return rows.filter((r) => {
    const t = Date.parse(r.photo.updatedAt);
    if (Number.isNaN(t) || t < fromMs || t > toMs) return false;
    if (section && section !== "ALL" && r.section !== section) return false;
    if (month && month !== "ALL" && r.reportMonth !== month) return false;
    if (area && area !== "ALL" && !includes(r.area, area)) return false;
    if (technician && technician !== "ALL" && !includes(r.technician, technician)) return false;
    if (service && service !== "ALL" && !includes(r.service, service)) return false;
    if (type && type !== "ALL" && r.reportType !== type) return false;
    if (q) {
      const blob = [r.reportName, r.reportId, r.section, r.reportMonth, r.area, r.technician, r.service, r.reportType, r.photo.filename].join(" ").toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
}

function facetValues(rows, field) {
  return Array.from(new Set(rows.map((r) => cleanSpaces(r[field])).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

// GET /api/photos?range=today|7d|14d|30d|90d|all&page=1&pageSize=48&section=...
router.get("/", requireAuth, (req, res) => {
  const cleanup = cleanupOldPhotos();
  let rows = [];
  try {
    rows = buildRows();
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Failed to list photos.", details: String(e?.message || e) });
  }

  rows.sort((a, b) => String(b.photo.updatedAt).localeCompare(String(a.photo.updatedAt)));
  const allRowsForFacets = rows;
  const filtered = applyFilters(rows, req.query);
  const total = filtered.length;
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(req.query.pageSize || DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  const start = (page - 1) * pageSize;
  const paged = filtered.slice(start, start + pageSize);

  res.json({
    ok: true,
    range: String(req.query?.range || "30d"),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    cleanup,
    facets: {
      sections: facetValues(allRowsForFacets, "section"),
      months: facetValues(allRowsForFacets, "reportMonth").sort((a, b) => b.localeCompare(a)),
      areas: facetValues(allRowsForFacets, "area"),
      technicians: facetValues(allRowsForFacets, "technician"),
      services: facetValues(allRowsForFacets, "service"),
      types: facetValues(allRowsForFacets, "reportType")
    },
    rows: paged
  });
});

router.get("/fileq", requireAuth, (req, res) => {
  ensureDir(REPORT_PHOTOS_DIR);
  const resolved = resolvePhotoPath(req.query?.reportId, req.query?.filename);
  if (!resolved.ok) return res.status(resolved.status).send(resolved.message);
  const { fullPath, filename } = resolved;
  if (!fs.existsSync(fullPath)) return res.status(404).send("Not found.");

  const type = mime.lookup(fullPath) || "application/octet-stream";
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "private, max-age=300");
  const download = String(req.query.download || "").trim() === "1";
  if (download) {
    if (!canL3OrAdmin(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin/L3 only." });
    res.setHeader("Content-Disposition", `attachment; filename="${String(filename).replace(/"/g, "")}"`);
  } else {
    res.setHeader("Content-Disposition", `inline; filename="${String(filename).replace(/"/g, "")}"`);
  }
  fs.createReadStream(fullPath).pipe(res);
});

function streamPhoto(req, res, reportId, filename) {
  ensureDir(REPORT_PHOTOS_DIR);
  const resolved = resolvePhotoPath(reportId, filename);
  if (!resolved.ok) return res.status(resolved.status).send(resolved.message);
  const { fullPath } = resolved;
  if (!fs.existsSync(fullPath)) return res.status(404).send("Not found.");

  const type = mime.lookup(fullPath) || "application/octet-stream";
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "private, max-age=300");
  const download = String(req.query.download || "").trim() === "1";
  if (download) {
    if (!canL3OrAdmin(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin/L3 only." });
    res.setHeader("Content-Disposition", `attachment; filename="${String(filename).replace(/"/g, "")}"`);
  } else {
    res.setHeader("Content-Disposition", `inline; filename="${String(filename).replace(/"/g, "")}"`);
  }
  fs.createReadStream(fullPath).pipe(res);
}

router.get("/file/:reportId/:filename", requireAuth, (req, res) => {
  return streamPhoto(req, res, req.params.reportId, req.params.filename);
});

router.delete("/delete", requireAuth, (req, res) => {
  if (!canAdmin(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin only." });
  const resolved = resolvePhotoPath(req.query?.reportId, req.query?.filename);
  if (!resolved.ok) return res.status(resolved.status).json({ ok: false, message: resolved.message });
  if (!fs.existsSync(resolved.fullPath)) return res.status(404).json({ ok: false, message: "Not found." });
  try {
    fs.unlinkSync(resolved.fullPath);
    removeEmptyDirs(REPORT_PHOTOS_DIR);
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Failed to delete.", details: String(e?.message || e) });
  }
  res.json({ ok: true });
});

router.post("/bulk-delete", requireAuth, (req, res) => {
  if (!canAdmin(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin only." });
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  let deleted = 0;
  const failed = [];
  for (const item of items) {
    const resolved = resolvePhotoPath(item?.reportId, item?.filename);
    if (!resolved.ok || !fs.existsSync(resolved.fullPath)) {
      failed.push({ reportId: item?.reportId, filename: item?.filename, message: "Not found" });
      continue;
    }
    try {
      fs.unlinkSync(resolved.fullPath);
      deleted++;
    } catch (e) {
      failed.push({ reportId: item?.reportId, filename: item?.filename, message: String(e?.message || e) });
    }
  }
  removeEmptyDirs(REPORT_PHOTOS_DIR);
  res.json({ ok: true, deleted, failed });
});

router.post("/cleanup-old", requireAuth, (req, res) => {
  if (!canAdmin(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin only." });
  res.json({ ok: true, cleanup: cleanupOldPhotos() });
});

router.delete("/:reportId/:filename", requireAuth, (req, res) => {
  if (!canAdmin(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin only." });
  const resolved = resolvePhotoPath(req.params.reportId, req.params.filename);
  if (!resolved.ok) return res.status(resolved.status).json({ ok: false, message: resolved.message });
  if (!fs.existsSync(resolved.fullPath)) return res.status(404).json({ ok: false, message: "Not found." });
  try {
    fs.unlinkSync(resolved.fullPath);
    removeEmptyDirs(REPORT_PHOTOS_DIR);
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Failed to delete.", details: String(e?.message || e) });
  }
  res.json({ ok: true });
});

router.post("/clear", requireAuth, (req, res) => {
  if (!canAdmin(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin only." });
  ensureDir(REPORT_PHOTOS_DIR);
  try {
    const dirs = fs.readdirSync(REPORT_PHOTOS_DIR, { withFileTypes: true });
    for (const d of dirs) fs.rmSync(path.join(REPORT_PHOTOS_DIR, d.name), { recursive: true, force: true });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Failed to clear report photos.", details: String(e?.message || e) });
  }
  res.json({ ok: true });
});

router.cleanupOldPhotos = cleanupOldPhotos;
module.exports = router;
