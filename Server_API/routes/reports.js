// /opt/maintenix-ui/server-api/routes/reports.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const { extractBearer, getSession } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");

const router = express.Router();

const REPORTS_DIR = path.join(__dirname, "..", "data", "uploads", "reports");
const REPORTS_PDF_DIR = path.join(__dirname, "..", "data", "uploads", "reports_pdf");
const META_FILE = path.join(__dirname, "..", "data", "reports.meta.json");

const SERVICING_STATUS_DIR = path.join(__dirname, "..", "data", "servicing-status");
const SERVICING_PAYLOADS_DIR = path.join(__dirname, "..", "data", "servicing-payloads");
const CALLOUT_STATUS_DIR = path.join(__dirname, "..", "data", "callout-status");
const CALLOUT_PAYLOADS_DIR = path.join(__dirname, "..", "data", "callout-payloads");

function ensureDirs() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.mkdirSync(REPORTS_PDF_DIR, { recursive: true });
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
  const tmp = META_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), "utf8");
  fs.renameSync(tmp, META_FILE);
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

function setReportStatus(fileName, status, userId) {
  const meta = readMeta();
  const nowIso = new Date().toISOString();

  meta.reports = meta.reports || {};
  meta.reports[fileName] = meta.reports[fileName] || {};

  ensureReportOwnerMeta(meta, fileName);

  meta.reports[fileName].status = status;
  meta.reports[fileName].updatedAt = nowIso;
  meta.reports[fileName].updatedBy = userId || "unknown";

  writeMeta(meta);
}

function isDocx(fileName) {
  return String(fileName || "").toLowerCase().endsWith(".docx");
}

function pdfNameForDocx(docxName) {
  // "something.docx" -> "something.pdf"
  const base = path.basename(docxName, path.extname(docxName));
  return `${base}.pdf`;
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

/**
 * Convert DOCX to PDF using LibreOffice (soffice) headless.
 * - Caches output in REPORTS_PDF_DIR
 * - Re-converts only if docx is newer than cached pdf
 * - Uses a dedicated LO profile dir to avoid permission/lock issues
 */
async function ensurePdfForDocx(docxPath, docxFileName) {
  ensureDirs();

  const pdfFileName = pdfNameForDocx(docxFileName);
  const pdfPath = path.join(REPORTS_PDF_DIR, pdfFileName);

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

  // Convert DOCX -> PDF into REPORTS_PDF_DIR
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
      REPORTS_PDF_DIR,
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
    names = fs.readdirSync(REPORTS_DIR);
  } catch {
    names = [];
  }

  const files = names
    .map((n) => {
      const full = path.join(REPORTS_DIR, n);
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) return null;

        if (!meta.reports[n]) {
          meta.reports[n] = {
            status: "PENDING",
            createdAt: st.mtime.toISOString(),
            updatedAt: nowIso,
            updatedBy: userId
          };
        }

        const owner = ensureReportOwnerMeta(meta, n);
        const m = meta.reports[n] || {};
        return {
          fileName: n,
          createdAt: m.createdAt || st.mtime.toISOString(),
          status: m.status || "PENDING",
          sizeBytes: st.size,
          owner: owner || null,
          ownerEmail: pickNonEmpty(m.ownerEmail, owner?.email)
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
 * GET /api/reports/file/:name
 * Streams the original report file (used for download).
 */
router.get("/file/:name", requireAuth, (req, res) => {
  ensureDirs();

  if (!canViewReports(req.user?.role)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  const fileName = safeFileName(req.params.name);
  if (!fileName) return res.status(400).json({ ok: false, message: "Invalid file name." });

  const full = path.join(REPORTS_DIR, fileName);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, message: "File not found." });

  res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
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

  const fileName = safeFileName(req.params.name);
  if (!fileName) return res.status(400).json({ ok: false, message: "Invalid file name." });

  const full = path.join(REPORTS_DIR, fileName);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, message: "File not found." });

  try {
    if (isDocx(fileName)) {
      const { pdfPath, pdfFileName } = await ensurePdfForDocx(full, fileName);
      res.setHeader("Content-Disposition", `inline; filename="${pdfFileName}"`);
      return res.sendFile(pdfPath);
    }

    // For PDFs/images/etc, just show the original
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
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
  const fileName = safeFileName(req.params.name);
  if (!fileName) return res.status(400).json({ ok: false, message: "Invalid file name." });

  const full = path.join(REPORTS_DIR, fileName);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, message: "File not found." });

  setReportStatus(fileName, "APPROVED", req.user?.id);
  return res.json({ ok: true, status: "APPROVED" });
});

/**
 * POST /api/reports/:name/deny
 * Admin/Level2 only
 */
router.post("/:name/deny", requireAuth, (req, res) => {
  if (!canModerateReports(req.user)) return res.status(403).json({ ok: false, message: "Forbidden" });

  ensureDirs();
  const fileName = safeFileName(req.params.name);
  if (!fileName) return res.status(400).json({ ok: false, message: "Invalid file name." });

  const full = path.join(REPORTS_DIR, fileName);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, message: "File not found." });

  setReportStatus(fileName, "DENIED", req.user?.id);
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

  const fileName = safeFileName(req.params.name);
  if (!fileName) return res.status(400).json({ ok: false, message: "Invalid file name." });

  const full = path.join(REPORTS_DIR, fileName);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, message: "File not found." });

  // Delete report file
  try {
    fs.unlinkSync(full);
  } catch (e) {
    return res.status(500).json({ ok: false, message: `Failed to delete file. ${String(e?.message || "")}`.trim() });
  }

  // Delete cached PDF if this was a DOCX
  if (isDocx(fileName)) {
    const pdfFileName = pdfNameForDocx(fileName);
    const pdfPath = path.join(REPORTS_PDF_DIR, pdfFileName);
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