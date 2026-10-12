// /opt/maintenix-ui/server-api/routes/reports.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const { extractBearer, getSession } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");
const { createNotification, userLabel } = require("../lib/notifications");
const { writeJsonAtomicSync, updateJsonWithLockSync } = require("../lib/lockedJson");
const {
  listFilesRecursive,
  resolveUnder,
  safeRelativePath,
  monthStamp
} = require("../lib/reportStorage");

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, "..", "data", "uploads");
const CHECKLISTS_DIR = path.join(UPLOADS_DIR, "checklists");
const CALLOUTS_DIR = path.join(UPLOADS_DIR, "callouts");
const FORMAL_REPORTS_DIR = path.join(UPLOADS_DIR, "reports");
const CHECKLISTS_PDF_DIR = path.join(UPLOADS_DIR, "checklists_pdf");
const CALLOUTS_PDF_DIR = path.join(UPLOADS_DIR, "callouts_pdf");
const FORMAL_REPORTS_PDF_DIR = path.join(UPLOADS_DIR, "reports_pdf");
const META_FILE = path.join(__dirname, "..", "data", "reports.meta.json");

const SERVICING_STATUS_DIR = path.join(__dirname, "..", "data", "servicing-status");
const SERVICING_PAYLOADS_DIR = path.join(__dirname, "..", "data", "servicing-payloads");
const CALLOUT_STATUS_DIR = path.join(__dirname, "..", "data", "callout-status");
const CALLOUT_PAYLOADS_DIR = path.join(__dirname, "..", "data", "callout-payloads");

function ensureDirs() {
  for (const dir of [CHECKLISTS_DIR, CALLOUTS_DIR, FORMAL_REPORTS_DIR, CHECKLISTS_PDF_DIR, CALLOUTS_PDF_DIR, FORMAL_REPORTS_PDF_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readMeta() {
  try {
    if (!fs.existsSync(META_FILE)) return { reports: {} };
    const raw = fs.readFileSync(META_FILE, "utf8").trim();
    if (!raw) return { reports: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { reports: {} };
    if (!parsed.reports || typeof parsed.reports !== "object") return { reports: {} };
    return parsed;
  } catch {
    return { reports: {} };
  }
}

function writeMeta(meta) {
  writeJsonAtomicSync(META_FILE, meta);
}

function safeFileName(name) {
  const base = path.basename(String(name || ""));
  if (!base || base.includes("..") || base.includes("/") || base.includes("\\")) return null;
  return base;
}

function safeRole(role) {
  return String(role || "").toUpperCase().replace(/\s+/g, "");
}

function readJsonFileSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function pickNonEmpty(...values) {
  for (const v of values) {
    const s = String(v || "").trim();
    if (s) return s;
  }
  return "";
}

function normalizeOwner(ownerLike) {
  if (!ownerLike || typeof ownerLike !== "object") return null;

  const id = pickNonEmpty(ownerLike.id, ownerLike.userId);
  const email = pickNonEmpty(ownerLike.email, ownerLike.userEmail, ownerLike.ownerEmail);
  const name = pickNonEmpty(ownerLike.name, ownerLike.fullName, ownerLike.displayName);

  if (!id && !email && !name) return null;

  return { id, email, name };
}

function ensureOwnerShape(metaEntry) {
  if (!metaEntry || typeof metaEntry !== "object") return;

  const normalized = normalizeOwner(metaEntry.owner);
  if (normalized) {
    metaEntry.owner = normalized;
    metaEntry.ownerEmail = normalized.email || "";
    return;
  }

  const ownerEmail = pickNonEmpty(metaEntry.ownerEmail);
  if (ownerEmail) {
    metaEntry.owner = { id: "", email: ownerEmail, name: "" };
    metaEntry.ownerEmail = ownerEmail;
  }
}

function extractServicingReportId(fileName) {
  const base = String(fileName || "");
  const m = base.match(/^Service_Report_(svc_\d+_[0-9a-f]+)\.docx$/i);
  return m ? m[1] : "";
}

function extractCalloutReportId(fileName) {
  const base = String(fileName || "");
  const m = base.match(/^(?:CallOut|Callout|Call_Out|Call-Out)_Report_(co_\d+_[0-9a-f]+)\.docx$/i);
  return m ? m[1] : "";
}

function resolveServicingOwner(reportId) {
  const rid = String(reportId || "").trim();
  if (!rid) return null;

  const statusPath = path.join(SERVICING_STATUS_DIR, `${rid}.json`);
  const payloadPath = path.join(SERVICING_PAYLOADS_DIR, `${rid}.json`);

  const statusData = readJsonFileSafe(statusPath, null);
  const payloadData = readJsonFileSafe(payloadPath, null);

  const owner =
    normalizeOwner(statusData?.owner) ||
    normalizeOwner(payloadData?.owner) ||
    normalizeOwner(payloadData?._server?.owner);

  if (owner) return owner;

  const fallbackEmail = pickNonEmpty(
    payloadData?.technicianEmail,
    payloadData?.userEmail,
    payloadData?.ownerEmail
  );
  const fallbackName = pickNonEmpty(payloadData?.technician);
  if (!fallbackEmail && !fallbackName) return null;

  return {
    id: "",
    email: fallbackEmail,
    name: fallbackName
  };
}

function resolveCalloutOwner(reportId) {
  const rid = String(reportId || "").trim();
  if (!rid) return null;

  const statusPath = path.join(CALLOUT_STATUS_DIR, `${rid}.json`);
  const payloadPath = path.join(CALLOUT_PAYLOADS_DIR, `${rid}.json`);

  const statusData = readJsonFileSafe(statusPath, null);
  const payloadData = readJsonFileSafe(payloadPath, null);

  const owner =
    normalizeOwner(statusData?.owner) ||
    normalizeOwner(payloadData?._server?.owner) ||
    normalizeOwner(payloadData?.owner);

  if (owner) return owner;

  const fallbackEmail = pickNonEmpty(
    payloadData?.technicianEmail,
    payloadData?.userEmail,
    payloadData?.ownerEmail
  );
  const fallbackName = pickNonEmpty(payloadData?.technician);
  if (!fallbackEmail && !fallbackName) return null;

  return {
    id: "",
    email: fallbackEmail,
    name: fallbackName
  };
}

function resolveReportOwnerFromSources(fileName) {
  const servicingId = extractServicingReportId(fileName);
  if (servicingId) return resolveServicingOwner(servicingId);

  const calloutId = extractCalloutReportId(fileName);
  if (calloutId) return resolveCalloutOwner(calloutId);

  return null;
}

function inferReportType(fileName, metaEntry = {}) {
  const explicitType = String(metaEntry?.type || metaEntry?.reportType || "").trim().toUpperCase();
  if (explicitType === "SERVICING" || explicitType === "SERVICE") return "SERVICING";
  if (explicitType === "CALLOUT" || explicitType === "CALL_OUT" || explicitType === "CALL-OUT") return "CALLOUT";
  if (explicitType === "SERVICE_REPORT" || explicitType === "FORMAL_REPORT") return "SERVICE_REPORT";

  const base = String(fileName || "").trim();
  if (extractServicingReportId(base) || /^Service_Report_/i.test(base)) return "SERVICING";
  if (extractCalloutReportId(base) || /^callout(?:_|-|\b)/i.test(base)) return "CALLOUT";

  return "UNKNOWN";
}

function ensureReportOwnerMeta(meta, fileName) {
  meta.reports = meta.reports || {};
  meta.reports[fileName] = meta.reports[fileName] || {};
  const entry = meta.reports[fileName];

  ensureOwnerShape(entry);

  if (entry.owner && entry.owner.email) {
    entry.ownerEmail = entry.owner.email;
    return entry.owner;
  }

  const resolved = resolveReportOwnerFromSources(fileName);
  if (resolved) {
    entry.owner = resolved;
    entry.ownerEmail = resolved.email || "";
    return resolved;
  }

  return entry.owner || null;
}

// ✅ Local auth middleware
function requireAuth(req, res, next) {
  const token = extractBearer(req);
  const session = getSession(token);

  if (!session?.userId) return res.status(401).json({ ok: false, message: "Unauthorized" });

  const user = getUsers().find((u) => u.id === session.userId) || null;
  if (!user) return res.status(401).json({ ok: false, message: "Unauthorized" });

  req.user = user;
  next();
}

function canModerateReports(user) {
  const role = String(user?.role || "").toUpperCase().replace(/\s+/g, "");
  return role === "ADMIN" || role === "L2" || role === "LEVEL2" || role === "LEVEL_2";
}

function isAdmin(user) {
  return safeRole(user?.role) === "ADMIN";
}

function cleanDecisionReason(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function setReportStatus(fileName, status, actor, opts = {}) {
  const nowIso = new Date().toISOString();
  let updatedEntry = null;
  const nextStatus = String(status || "").toUpperCase();
  const actorId = actor?.id || actor || "unknown";
  const actorEmail = String(actor?.email || "").trim();
  const actorName = userLabel(actor || {});
  const reason = cleanDecisionReason(opts.reason);
  const source = cleanDecisionReason(opts.source) || "manual";

  updateJsonWithLockSync(META_FILE, { reports: {} }, (meta) => {
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) meta = { reports: {} };
    if (!meta.reports || typeof meta.reports !== "object" || Array.isArray(meta.reports)) meta.reports = {};

    meta.reports[fileName] = meta.reports[fileName] || {};
    ensureReportOwnerMeta(meta, fileName);

    const entry = meta.reports[fileName];
    const previousStatus = String(entry.status || "PENDING").toUpperCase();
    const decision = {
      at: nowIso,
      source,
      previousStatus,
      status: nextStatus,
      decidedBy: actorId,
      decidedByEmail: actorEmail,
      decidedByName: actorName,
      reason
    };

    entry.status = nextStatus;
    entry.approvalDecision = decision;
    entry.approvalHistory = Array.isArray(entry.approvalHistory) ? entry.approvalHistory : [];
    entry.approvalHistory.push(decision);
    if (entry.approvalHistory.length > 50) entry.approvalHistory = entry.approvalHistory.slice(-50);
    if (nextStatus === "DENIED") entry.rejectionReason = reason || "No reason provided.";
    if (nextStatus === "APPROVED") entry.rejectionReason = "";
    meta.reports[fileName].updatedAt = nowIso;
    meta.reports[fileName].updatedBy = actorId;
    updatedEntry = meta.reports[fileName];
    return meta;
  });

  return updatedEntry || {};
}

function notifyReportOwner(fileName, status, entry, actor) {
  try {
    const owner = entry?.owner || {};
    const targetUserEmail = pickNonEmpty(entry?.ownerEmail, owner?.email);
    const targetUserId = pickNonEmpty(owner?.id, entry?.ownerUserId);
    if (!targetUserEmail && !targetUserId) return;

    const actorEmail = String(actor?.email || "").trim().toLowerCase();
    if (targetUserEmail && actorEmail && targetUserEmail.toLowerCase() === actorEmail) return;

    const approved = String(status || "").toUpperCase() === "APPROVED";
    const displayName = path.basename(String(fileName || ""));
    const reason = cleanDecisionReason(entry?.approvalDecision?.reason || entry?.rejectionReason);
    createNotification({
      type: "REPORT_STATUS",
      scope: "USER",
      title: approved ? "Report approved" : "Report rejected",
      message: `Your report ${displayName} was ${approved ? "approved" : "rejected"} by ${userLabel(actor)}.${!approved && reason ? ` Reason: ${reason}` : ""}`,
      severity: approved ? "success" : "danger",
      createdByUserId: actor?.id || "",
      createdByEmail: actor?.email || "",
      createdByName: userLabel(actor),
      targetUserId,
      targetUserEmail,
      relatedEntityType: "report",
      relatedEntityId: fileName,
      actionUrl: "#/reports"
    });
  } catch {
    // Notifications must not block report moderation.
  }
}

function isDocx(fileName) {
  return String(fileName || "").toLowerCase().endsWith(".docx");
}

function pdfNameForDocx(docxName) {
  // "something.docx" -> "something.pdf"
  const base = path.basename(docxName, path.extname(docxName));
  return `${base}.pdf`;
}

function pdfRelativePathForDocx(reportPath) {
  const safe = safeRelativePath(reportPath);
  if (!safe) return pdfNameForDocx(path.basename(String(reportPath || "")));
  const dir = path.dirname(safe);
  const pdf = pdfNameForDocx(path.basename(safe));
  return dir === "." ? pdf : path.join(dir, pdf).replace(/\\/g, "/");
}

function reportParam(req) {
  return safeRelativePath(req.params.name || "");
}

function reportFullPath(reportPath) {
  const safe = safeRelativePath(reportPath);
  if (!safe) return null;
  const meta = readMeta();
  const entry = meta?.reports?.[safe] || meta?.reports?.[path.basename(safe)] || {};
  const reportType = inferReportType(path.basename(safe), entry);
  const preferredRoot = reportType === "CALLOUT" ? CALLOUTS_DIR : reportType === "SERVICE_REPORT" ? FORMAL_REPORTS_DIR : CHECKLISTS_DIR;
  const fallbackRoots = [CHECKLISTS_DIR, CALLOUTS_DIR, FORMAL_REPORTS_DIR].filter((root) => root !== preferredRoot);
  const preferred = resolveUnder(preferredRoot, safe);
  if (preferred && fs.existsSync(preferred)) return preferred;
  for (const fallbackRoot of fallbackRoots) {
    const fallback = resolveUnder(fallbackRoot, safe);
    if (fallback && fs.existsSync(fallback)) return fallback;
  }
  return preferred;
}

function pdfRootForDocxPath(docxPath) {
  const resolved = path.resolve(String(docxPath || ""));
  if (resolved === path.resolve(CALLOUTS_DIR) || resolved.startsWith(path.resolve(CALLOUTS_DIR) + path.sep)) return CALLOUTS_PDF_DIR;
  if (resolved === path.resolve(FORMAL_REPORTS_DIR) || resolved.startsWith(path.resolve(FORMAL_REPORTS_DIR) + path.sep)) return FORMAL_REPORTS_PDF_DIR;
  return CHECKLISTS_PDF_DIR;
}

function statSafe(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function execFilePromise(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) {
        const msgParts = [];
        if (stderr) msgParts.push(String(stderr));
        if (stdout) msgParts.push(String(stdout));
        msgParts.push(String(err?.message || err));
        const msg = msgParts.join("\n").trim();
        return reject(new Error(msg || "Conversion failed"));
      }
      resolve({ stdout, stderr });
    });
  });
}

function canViewReports(role) {
  const r = safeRole(role);
  return r === "ADMIN" || r === "L1" || r === "L2" || r === "L3";
}
function canManageReports(role) {
  const r = safeRole(role);
  return r === "ADMIN" || r === "L3";
}

function canDownloadReportZip(role) {
  const r = safeRole(role);
  return r === "ADMIN" || r === "L3";
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = (year - 1980) << 9 | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date: day };
}

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }

async function sendZip(res, entries, zipName = "maintenix-reports.zip") {
  const central = [];
  let offset = 0;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${zipName.replace(/"/g, "")}"`);
  res.setHeader("Cache-Control", "no-store");

  for (const entry of entries) {
    const data = fs.readFileSync(entry.fullPath);
    const st = fs.statSync(entry.fullPath);
    const nameBuf = Buffer.from(entry.zipPath.replace(/\\/g, "/"), "utf8");
    const { time, date } = dosDateTime(st.mtime);
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf
    ]);
    res.write(local);
    res.write(data);
    central.push({ nameBuf, crc, size: data.length, time, date, offset });
    offset += local.length + data.length;
  }

  const centralStart = offset;
  for (const c of central) {
    const h = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(c.time), u16(c.date),
      u32(c.crc), u32(c.size), u32(c.size), u16(c.nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset), c.nameBuf
    ]);
    res.write(h);
    offset += h.length;
  }
  const centralSize = offset - centralStart;
  res.end(Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(centralSize), u32(centralStart), u16(0)
  ]));
}

/**
 * Convert DOCX to PDF using LibreOffice (soffice) headless.
 * - Caches output in the matching checklist/callout PDF directory
 * - Re-converts only if docx is newer than cached pdf
 * - Uses a dedicated LO profile dir to avoid permission/lock issues
 */
async function ensurePdfForDocx(docxPath, docxFileName) {
  ensureDirs();

  const pdfFileName = pdfNameForDocx(docxFileName);
  const pdfRelPath = pdfRelativePathForDocx(docxFileName);
  const pdfPath = resolveUnder(pdfRootForDocxPath(docxPath), pdfRelPath);
  if (!pdfPath) throw new Error("Invalid PDF path");
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });

  const docxStat = statSafe(docxPath);
  if (!docxStat || !docxStat.isFile()) throw new Error("DOCX not found");

  const pdfStat = statSafe(pdfPath);
  const needsConvert = !pdfStat || pdfStat.mtimeMs < docxStat.mtimeMs;
  if (!needsConvert) return { pdfPath, pdfFileName };

  // ✅ Dedicated LO profile to prevent "profile locked / cannot write / recovery" failures
  const loProfileDir = path.join(__dirname, "..", "data", "libreoffice-profile");
  fs.mkdirSync(loProfileDir, { recursive: true });

  // LibreOffice expects a file:// URL for UserInstallation
  const loProfileUrl = `file://${loProfileDir.replace(/\\/g, "/")}`;

  // Convert DOCX -> PDF into the matching storage category.
  // writer_pdf_Export is more explicit than plain "pdf"
  await execFilePromise(
    "soffice",
    [
      "--headless",
      "--nologo",
      "--nofirststartwizard",
      "--norestore",
      `-env:UserInstallation=${loProfileUrl}`,
      "--convert-to",
      "pdf:writer_pdf_Export",
      "--outdir",
      path.dirname(pdfPath),
      docxPath
    ],
    {
      timeout: 120_000,
      // ensure LO has a writable HOME too (some installs rely on it)
      env: { ...process.env, HOME: loProfileDir }
    }
  );

  const after = statSafe(pdfPath);
  if (!after || !after.isFile()) {
    throw new Error("PDF was not generated (LibreOffice conversion produced no output)");
  }

  return { pdfPath, pdfFileName };
}

/**
 * GET /api/reports
 * Lists files in /data/uploads/reports and returns metadata.
 * Any unknown file gets default status PENDING.
 */
router.get("/", requireAuth, (req, res) => {
  ensureDirs();

  if (!canViewReports(req.user?.role)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  const meta = readMeta();
  const userId = req.user?.id || "unknown";
  const nowIso = new Date().toISOString();

  let names = [];
  try {
    names = Array.from(new Set([
      ...listFilesRecursive(CHECKLISTS_DIR),
      ...listFilesRecursive(CALLOUTS_DIR),
      ...listFilesRecursive(FORMAL_REPORTS_DIR)
    ]));
  } catch {
    names = [];
  }

  const files = names
    .map((n) => {
      const full = reportFullPath(n);
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) return null;

        if (!meta.reports[n]) {
          const legacy = meta.reports[path.basename(n)] || {};
          meta.reports[n] = {
            ...legacy,
            status: legacy.status || "PENDING",
            createdAt: legacy.createdAt || st.mtime.toISOString(),
            updatedAt: legacy.updatedAt || nowIso,
            updatedBy: legacy.updatedBy || userId,
            relativePath: n
          };
        }

        const owner = ensureReportOwnerMeta(meta, n);
        const m = meta.reports[n] || {};
        const reportType = inferReportType(path.basename(n), m);
        const parts = n.split("/");
        return {
          fileName: n,
          storedPath: n,
          displayFileName: path.basename(n),
          relativePath: m.relativePath || n,
          section: m.section || (parts.length >= 3 ? parts[0] : ""),
          reportMonth: m.reportMonth || (parts.length >= 3 ? parts[1] : monthStamp(m.createdDate || m.createdAt || st.mtime.toISOString())),
          area: m.area || "",
          createdAt: m.createdAt || st.mtime.toISOString(),
          status: m.status || "PENDING",
          reportType,
          type: reportType,
          sizeBytes: st.size,
          owner: owner || null,
          ownerEmail: pickNonEmpty(m.ownerEmail, owner?.email),
          approvalDecision: m.approvalDecision || null,
          approvalHistory: Array.isArray(m.approvalHistory) ? m.approvalHistory : [],
          rejectionReason: m.rejectionReason || "",
          correctionOfReport: m.correctionOfReport || "",
          correctionReason: m.correctionReason || ""
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  writeMeta(meta);
  res.json({ ok: true, reports: files });
});

/**
 * POST /api/reports/zip
 * Admin/L3 only. Downloads selected reports as a ZIP while preserving Section/YYYY-MM paths.
 * Body: { files: ["Section/2026-05/report.docx", ...] }
 */
router.post("/zip", requireAuth, async (req, res) => {
  ensureDirs();
  if (!canDownloadReportZip(req.user?.role)) {
    return res.status(403).json({ ok: false, message: "Admin/L3 only." });
  }

  const requested = Array.isArray(req.body?.files) ? req.body.files : [];
  const unique = Array.from(new Set(requested.map((x) => safeRelativePath(x)).filter(Boolean)));
  if (unique.length === 0) return res.status(400).json({ ok: false, message: "No reports selected for ZIP download." });
  if (unique.length > 2000) return res.status(400).json({ ok: false, message: "Too many reports selected for one ZIP." });

  const entries = [];
  for (const rel of unique) {
    const full = reportFullPath(rel);
    if (!full || !fs.existsSync(full)) continue;
    const st = fs.statSync(full);
    if (!st.isFile()) continue;
    entries.push({ zipPath: rel, fullPath: full, size: st.size });
  }

  if (entries.length === 0) return res.status(404).json({ ok: false, message: "No selected report files were found." });

  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await sendZip(res, entries, `maintenix-reports-${stamp}.zip`);
  } catch (e) {
    if (!res.headersSent) return res.status(500).json({ ok: false, message: "ZIP download failed.", details: String(e?.message || e) });
    try { res.end(); } catch {}
  }
});

/**
 * GET /api/reports/file/:name
 * Streams the original report file (used for download).
 */
router.get("/file/:name", requireAuth, (req, res) => {
  ensureDirs();

  if (!canViewReports(req.user?.role)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  const fileName = reportParam(req);
  if (!fileName) return res.status(400).json({ ok: false, message: "Invalid file name." });

  const full = reportFullPath(fileName);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, message: "File not found." });

  res.setHeader("Content-Disposition", `inline; filename="${path.basename(fileName)}"`);
  res.sendFile(full);
});

/**
 * GET /api/reports/view/:name
 * If DOCX: convert to PDF (cached) then stream PDF for browser preview.
 * Else: stream the original file.
 */
router.get("/view/:name", requireAuth, async (req, res) => {
  ensureDirs();

  if (!canViewReports(req.user?.role)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  const fileName = reportParam(req);
  if (!fileName) return res.status(400).json({ ok: false, message: "Invalid file name." });

  const full = reportFullPath(fileName);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, message: "File not found." });

  try {
    if (isDocx(fileName)) {
      const { pdfPath, pdfFileName } = await ensurePdfForDocx(full, fileName);
      res.setHeader("Content-Disposition", `inline; filename="${path.basename(pdfFileName)}"`);
      return res.sendFile(pdfPath);
    }

    // For PDFs/images/etc, just show the original
    res.setHeader("Content-Disposition", `inline; filename="${path.basename(fileName)}"`);
    return res.sendFile(full);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      message: `Preview failed. ${String(e?.message || "DOCX->PDF conversion error")}`
    });
  }
});

/**
 * POST /api/reports/:name/approve
 * Admin/Level2 only
 */
router.post("/:name/approve", requireAuth, (req, res) => {
  if (!canModerateReports(req.user)) return res.status(403).json({ ok: false, message: "Forbidden" });

  ensureDirs();
  const fileName = reportParam(req);
  if (!fileName) return res.status(400).json({ ok: false, message: "Invalid file name." });

  const full = reportFullPath(fileName);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, message: "File not found." });

  const entry = setReportStatus(fileName, "APPROVED", req.user, {
    reason: req.body?.reason || "Approved by reviewer.",
    source: "manual"
  });
  notifyReportOwner(fileName, "APPROVED", entry, req.user);
  return res.json({ ok: true, status: "APPROVED" });
});

/**
 * POST /api/reports/:name/deny
 * Admin/Level2 only
 */
router.post("/:name/deny", requireAuth, (req, res) => {
  if (!canModerateReports(req.user)) return res.status(403).json({ ok: false, message: "Forbidden" });

  ensureDirs();
  const fileName = reportParam(req);
  if (!fileName) return res.status(400).json({ ok: false, message: "Invalid file name." });

  const full = reportFullPath(fileName);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, message: "File not found." });

  const reason = cleanDecisionReason(req.body?.reason);
  if (!reason) return res.status(400).json({ ok: false, message: "Reject reason is required." });

  const entry = setReportStatus(fileName, "DENIED", req.user, {
    reason,
    source: "manual"
  });
  notifyReportOwner(fileName, "DENIED", entry, req.user);
  return res.json({ ok: true, status: "DENIED" });
});

/**
 * DELETE /api/reports/:name
 * Admin only
 * Deletes the report file and cached PDF (if DOCX), and removes meta entry.
 */
router.delete("/:name", requireAuth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ ok: false, message: "Forbidden" });

  ensureDirs();

  const fileName = reportParam(req);
  if (!fileName) return res.status(400).json({ ok: false, message: "Invalid file name." });

  const full = reportFullPath(fileName);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, message: "File not found." });

  // Delete report file
  try {
    fs.unlinkSync(full);
  } catch (e) {
    return res.status(500).json({ ok: false, message: `Failed to delete file. ${String(e?.message || "")}`.trim() });
  }

  // Delete cached PDF if this was a DOCX
  if (isDocx(fileName)) {
    const pdfRelPath = pdfRelativePathForDocx(fileName);
    const pdfPath = resolveUnder(pdfRootForDocxPath(full), pdfRelPath);
    try {
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    } catch {
      // non-fatal
    }
  }

  // Remove meta entry
  const meta = readMeta();
  if (meta?.reports && meta.reports[fileName]) {
    delete meta.reports[fileName];
    try {
      writeMeta(meta);
    } catch {
      // non-fatal
    }
  }

  return res.json({ ok: true });
});

module.exports = router;
