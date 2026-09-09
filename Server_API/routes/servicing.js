const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// For auth (same pattern as routes/stock.js)
const { getSession, extractBearer } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");

// Multipart support (npm i multer)
let multer = null;
try {
  multer = require("multer");
} catch {
  multer = null;
}

// ✅ NEW: generator used by worker + optional sync route
const { generateServicingDocx } = require("../lib/servicingGenerator");

const router = express.Router();

const DATA_DIR = path.join(__dirname, "..", "data");
const TEMPLATES_DIR = path.join(DATA_DIR, "templates");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

// Source files
const CHECKLIST_FILE = path.join(TEMPLATES_DIR, "full_manual_checklist_questions.json");
const TEMPLATE_DOCX = path.join(TEMPLATES_DIR, "template.docx");
const AREAS_TXT = path.join(TEMPLATES_DIR, "areas.txt");
const SERVICES_TXT = path.join(TEMPLATES_DIR, "services.txt");

// Output folders
const REPORTS_DIR = path.join(UPLOADS_DIR, "reports"); // generated DOCX output
const REPORTPHOTOS_DIR = path.join(UPLOADS_DIR, "reportphotos"); // saved photos
const SIGNATURES_DIR = path.join(UPLOADS_DIR, "signatures"); // signatures
const REPORTS_META = path.join(DATA_DIR, "reports.meta.json");

// ✅ NEW: durable payload + queue + status
const SERVICING_PAYLOADS_DIR = path.join(DATA_DIR, "servicing-payloads");
const SERVICING_STATUS_DIR = path.join(DATA_DIR, "servicing-status");
const SERVICING_QUEUE_DIR = path.join(DATA_DIR, "servicing-queue");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJsonFile(p, fallback) {
  try {
    const raw = fs.readFileSync(p, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonFileAtomic(p, obj) {
  ensureDir(path.dirname(p));
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

function safeLinesFromTxt(p) {
  try {
    const raw = fs.readFileSync(p, "utf8");
    return raw
      .split(/\r?\n/g)
      .map((x) => String(x || "").trim())
      .filter((x) => x && !x.startsWith("#"));
  } catch {
    return [];
  }
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

function safeFilename(name) {
  return String(name || "")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 140);
}

function normalizeDocxName(name) {
  const s = String(name || "").trim();
  if (!s) return "";
  return s.toLowerCase().endsWith(".docx") ? s : `${s}.docx`;
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeOwner(ownerLike) {
  if (!ownerLike || typeof ownerLike !== "object") return null;

  const id = String(ownerLike.id || "").trim();
  const email = String(ownerLike.email || ownerLike.ownerEmail || "").trim();
  const name = String(ownerLike.name || "").trim();
  const role = String(ownerLike.role || "").trim();

  if (!id && !email && !name && !role) return null;

  return { id, email, name, role };
}

function ownerFromReq(req) {
  return {
    id: String(req.user?.id || "").trim(),
    email: String(req.user?.email || "").trim(),
    name: String(req.user?.name || "").trim(),
    role: String(req.user?.role || "").trim()
  };
}

function readReportsMetaCompat() {
  try {
    if (!fs.existsSync(REPORTS_META)) return { reports: {} };
    const raw = fs.readFileSync(REPORTS_META, "utf8").trim();
    if (!raw) return { reports: {} };
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (parsed.reports && typeof parsed.reports === "object" && !Array.isArray(parsed.reports)) {
        return parsed;
      }
      return { reports: {} };
    }

    if (Array.isArray(parsed)) {
      const meta = { reports: {} };
      for (const e of parsed) {
        const fileName = String(e?.fileName || "").trim();
        if (!fileName) continue;

        const owner =
          normalizeOwner(e?.owner) ||
          normalizeOwner({
            email: e?.ownerEmail || e?.by || "",
            name: e?.technician || "",
            role: ""
          });

        meta.reports[fileName] = {
          ...e,
          status: String(e?.status || "PENDING").toUpperCase(),
          updatedAt: e?.updatedAt || e?.approvedAt || e?.createdAt || null,
          updatedBy: e?.updatedBy || e?.approvedBy || e?.by || null,
          owner: owner || undefined,
          ownerEmail: owner?.email || String(e?.ownerEmail || e?.by || "").trim()
        };
      }
      return meta;
    }

    return { reports: {} };
  } catch {
    return { reports: {} };
  }
}

function writeReportsMetaAtomic(meta) {
  ensureDir(path.dirname(REPORTS_META));
  const tmp = REPORTS_META + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), "utf8");
  fs.renameSync(tmp, REPORTS_META);
}

/**
 * Add/update a report entry in reports.meta.json WITHOUT overwriting existing statuses.
 */
function upsertReportMeta(fileName, fields) {
  const meta = readReportsMetaCompat();
  meta.reports = meta.reports || {};

  const existing = meta.reports[fileName] || {};
  const existingStatus = String(existing.status || "").toUpperCase();

  const mergedOwner =
    normalizeOwner(fields?.owner) ||
    normalizeOwner(existing?.owner) ||
    normalizeOwner({
      email: fields?.ownerEmail || existing?.ownerEmail || existing?.by || "",
      name: fields?.technician || existing?.technician || "",
      role: ""
    });

  meta.reports[fileName] = {
    ...existing,
    ...fields,
    owner: mergedOwner || existing.owner || undefined,
    ownerEmail: fields?.ownerEmail || mergedOwner?.email || existing.ownerEmail || existing.by || "",
    by: fields?.by || existing.by || mergedOwner?.email || "",
    status: existingStatus || "PENDING",
    updatedAt: existing.updatedAt || null,
    updatedBy: existing.updatedBy || null
  };

  writeReportsMetaAtomic(meta);
}

function newReportId(prefix = "svc") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function userKeyFromReq(req) {
  // Prefer stable numeric/uuid id, else email
  const u = req.user || {};
  return safeFilename(u.id || u.email || "unknown");
}

function payloadPathFor(userKey, reportId) {
  return path.join(SERVICING_PAYLOADS_DIR, userKey, `${safeFilename(reportId)}.json`);
}

function statusPathFor(userKey, reportId) {
  return path.join(SERVICING_STATUS_DIR, userKey, `${safeFilename(reportId)}.json`);
}

function queuePathFor(userKey, reportId) {
  return path.join(SERVICING_QUEUE_DIR, userKey, `${safeFilename(reportId)}.job`);
}

function writeStatus(userKey, reportId, patch) {
  const p = statusPathFor(userKey, reportId);
  const existing = fs.existsSync(p) ? readJsonFile(p, {}) : {};
  const next = { ...existing, ...patch, reportId, userKey, updatedAt: new Date().toISOString() };
  writeJsonFileAtomic(p, next);
  return next;
}

function enqueueJob(userKey, reportId) {
  const jobFile = queuePathFor(userKey, reportId);
  ensureDir(path.dirname(jobFile));
  // idempotent: if job already queued, don't rewrite
  if (fs.existsSync(jobFile)) return;
  fs.writeFileSync(jobFile, JSON.stringify({ userKey, reportId, queuedAt: new Date().toISOString() }, null, 2), "utf8");
}

function isoDateStamp(isoLike) {
  try {
    const d = isoLike ? new Date(isoLike) : new Date();
    if (Number.isNaN(d.getTime())) return dateStamp();
    return d.toISOString().slice(0, 10);
  } catch {
    return dateStamp();
  }
}

function last4FromSvc(reportIdOrSvc) {
  const s = String(reportIdOrSvc || "").trim();

  // Preferred format: svc_<timestamp>_<hex>
  const parts = s.split("_");
  if (parts.length >= 3 && /^\d+$/.test(parts[1] || "")) {
    const ts = parts[1];
    return ts.slice(-4).padStart(4, "0");
  }

  // Fallback: use digits in the whole string
  const digits = (s.match(/\d+/g) || []).join("");
  if (!digits) return "0000";
  return digits.slice(-4).padStart(4, "0");
}

function buildReportFileName(payload, reportId, createdAtIso) {
  // If the client already sends a desired filename, honor it (sanitized).
  const preferred = String(payload?.serverFileName || payload?.desiredFileName || "").trim();
  if (preferred) {
    const safe = safeFilename(preferred);
    return normalizeDocxName(safe);
  }

  const area = safeFilename(payload?.area || "Area");
  const service = safeFilename(payload?.service || payload?.serviceType || "Service");
  const dateCreated = isoDateStamp(payload?.dateCreated || payload?.createdAt || createdAtIso);
  const svcSource = payload?.svcNumber || payload?.srvNumber || payload?.reportId || reportId;
  const last4 = last4FromSvc(svcSource);

  // Required format: area_service_datecreated_last4.docx
  return `${area}_${service}_${dateCreated}_${last4}.docx`;
}

function pickFilenameFromPayload(payload, reportId, createdAtIso) {
  return buildReportFileName(payload, reportId, createdAtIso);
}

const upload = multer
  ? multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 12 * 1024 * 1024 } // 12MB per file
    })
  : null;

/**
 * GET /api/servicing/checklist
 */
router.get("/checklist", requireAuth, (req, res) => {
  if (!fs.existsSync(CHECKLIST_FILE)) {
    return res.status(404).json({ ok: false, message: "Checklist file not found on server.", path: CHECKLIST_FILE });
  }
  const data = readJsonFile(CHECKLIST_FILE, null);
  if (!data) return res.status(500).json({ ok: false, message: "Checklist JSON is invalid." });

  // Backward compatible:
  // - older clients may expect the raw checklist object
  // - newer clients can use { ok: true, checklist: <object> }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return res.json({ ok: true, checklist: data, ...data });
  }
  return res.json({ ok: true, checklist: data });
});

/**
 * GET /api/servicing/areas
 */
router.get("/areas", requireAuth, (req, res) => {
  res.json({ ok: true, areas: safeLinesFromTxt(AREAS_TXT) });
});

/**
 * GET /api/servicing/services
 */
router.get("/services", requireAuth, (req, res) => {
  res.json({ ok: true, services: safeLinesFromTxt(SERVICES_TXT) });
});

/**
 * GET /api/servicing/template
 */
router.get("/template", requireAuth, (req, res) => {
  if (!fs.existsSync(TEMPLATE_DOCX)) {
    return res.status(404).json({ ok: false, message: "Template file not found on server.", path: TEMPLATE_DOCX });
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", 'attachment; filename="template.docx"');
  fs.createReadStream(TEMPLATE_DOCX).pipe(res);
});

/**
 * GET /api/servicing/download/:filename
 */
router.get("/download/:filename", requireAuth, (req, res) => {
  const filename = safeFilename(req.params.filename || "");
  if (!filename) return res.status(400).json({ ok: false, message: "Missing filename." });

  const p = path.join(REPORTS_DIR, filename);
  if (!p.startsWith(REPORTS_DIR)) return res.status(400).json({ ok: false, message: "Invalid filename." });
  if (!fs.existsSync(p)) return res.status(404).json({ ok: false, message: "File not found." });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  fs.createReadStream(p).pipe(res);
});

/**
 * ✅ NEW
 * POST /api/servicing/submit-payload
 * multipart/form-data:
 *  - payload: JSON string (must include or will be assigned reportId)
 *  - photos: any fields (photo_<qid> etc)
 *
 * Server:
 *  - writes payload JSON under /data/servicing-payloads/<userKey>/<reportId>.json
 *  - writes a status JSON under /data/servicing-status/<userKey>/<reportId>.json
 *  - saves photos to /uploads/reportphotos/<reportId>/
 *  - enqueues a job file under /data/servicing-queue/<userKey>/<reportId>.job
 *  - returns immediately with {reportId}
 *
 * IMPORTANT: payload JSON is only removed AFTER SUCCESSFUL generation by the worker.
 */
router.post(
  "/submit-payload",
  requireAuth,
  upload ? upload.any() : express.raw({ type: "*/*", limit: "1mb" }),
  (req, res) => {
    if (!upload) {
      return res.status(500).json({
        ok: false,
        message: "Multipart upload is not configured. Install 'multer' (npm i multer) and restart server."
      });
    }

    const payloadRaw = req.body?.payload;
    let payload = null;
    try {
      payload = JSON.parse(payloadRaw);
    } catch {
      return res.status(400).json({ ok: false, message: "Invalid payload JSON." });
    }

    const userKey = userKeyFromReq(req);
    const reportId = safeFilename(payload?.reportId || payload?.id || "") || newReportId("svc");
    const owner = ownerFromReq(req);

    // ✅ Deterministic server filename: area_service_YYYY-MM-DD_last4(svc)
    const createdAtIso = payload?.createdAt || new Date().toISOString();
    payload.reportId = reportId;
    payload.svcNumber = payload?.svcNumber || reportId;
    payload.serverFileName = pickFilenameFromPayload(payload, reportId, createdAtIso);
    payload.owner = owner;
    payload.ownerEmail = owner.email || "";

    // If payload already exists, do NOT overwrite (idempotent)
    const pPath = payloadPathFor(userKey, reportId);
    if (fs.existsSync(pPath)) {
      const existing = readJsonFile(pPath, null);
      const st = readJsonFile(statusPathFor(userKey, reportId), null);
      const existingServerFileName =
        existing?.payload?.serverFileName || existing?.payload?.desiredFileName || payload?.serverFileName || "";

      return res.json({
        ok: true,
        reportId,
        status: st?.status || existing?.status || "pending",
        serverFileName: existingServerFileName,
        message: "Already submitted."
      });
    }

    ensureDir(REPORTS_DIR);
    ensureDir(REPORTPHOTOS_DIR);
    ensureDir(SIGNATURES_DIR);
    ensureDir(SERVICING_PAYLOADS_DIR);
    ensureDir(SERVICING_STATUS_DIR);
    ensureDir(SERVICING_QUEUE_DIR);

    // Save photos to disk
    const files = Array.isArray(req.files) ? req.files : [];
    const savedPhotos = [];
    const photoByField = {};

    const photoDir = path.join(REPORTPHOTOS_DIR, reportId);
    ensureDir(photoDir);

    for (const f of files) {
      if (!f || !f.buffer) continue;
      const safe = safeFilename(f.originalname || "photo.jpg");
      const outPath = path.join(photoDir, safe);
      try {
        fs.writeFileSync(outPath, f.buffer);
        savedPhotos.push({ field: f.fieldname, filename: safe, path: outPath });
        if (!photoByField[f.fieldname]) photoByField[f.fieldname] = outPath;
      } catch {
        // ignore
      }
    }

    // Write status as pending (include serverFileName so /status can expose it)
    writeStatus(userKey, reportId, {
      status: "pending",
      createdAt: createdAtIso,
      serverFileName: payload.serverFileName,
      owner,
      ownerEmail: owner.email || ""
    });

    // Persist payload JSON (durable)
    const toStore = {
      reportId,
      userKey,
      owner,
      ownerEmail: owner.email || "",
      createdAt: createdAtIso,
      status: "pending",
      payload: { ...payload, reportId, owner, ownerEmail: owner.email || "" }, // ensure reportId is present
      photos: savedPhotos,
      photoByField,
      templateDocx: TEMPLATE_DOCX, // used by worker
      reportsDir: REPORTS_DIR,
      reportPhotosDir: REPORTPHOTOS_DIR,
      signaturesDir: SIGNATURES_DIR,
      reportsMeta: REPORTS_META
    };

    writeJsonFileAtomic(pPath, toStore);

    // Enqueue
    enqueueJob(userKey, reportId);

    return res.json({
      ok: true,
      reportId,
      status: "pending",
      serverFileName: payload.serverFileName
    });
  }
);

/**
 * ✅ NEW
 * GET /api/servicing/status/:reportId
 * Reads from the status file (survives payload deletion).
 */
router.get("/status/:reportId", requireAuth, (req, res) => {
  const userKey = userKeyFromReq(req);
  const reportId = safeFilename(req.params.reportId || "");
  if (!reportId) return res.status(400).json({ ok: false, message: "Missing reportId." });

  const sPath = statusPathFor(userKey, reportId);
  if (fs.existsSync(sPath)) {
    const st = readJsonFile(sPath, null);
    if (!st) return res.status(500).json({ ok: false, message: "Status file invalid." });

    // If serverFileName missing in status, try to recover from payload file (if still present)
    if (!st.serverFileName) {
      const pPath = payloadPathFor(userKey, reportId);
      if (fs.existsSync(pPath)) {
        const p = readJsonFile(pPath, null);
        const recovered = p?.payload?.serverFileName || p?.payload?.desiredFileName || "";
        if (recovered) st.serverFileName = recovered;
      }
    }

    return res.json({ ok: true, ...st });
  }

  // Fallback: if payload still exists, expose its status (+ serverFileName)
  const pPath = payloadPathFor(userKey, reportId);
  if (fs.existsSync(pPath)) {
    const p = readJsonFile(pPath, null);
    return res.json({
      ok: true,
      status: p?.status || "pending",
      reportId,
      userKey,
      owner: p?.owner || p?.payload?.owner || null,
      ownerEmail: p?.ownerEmail || p?.payload?.ownerEmail || "",
      serverFileName: p?.payload?.serverFileName || p?.payload?.desiredFileName || ""
    });
  }

  return res.status(404).json({ ok: false, message: "Job not found." });
});

/**
 * ---------------------------
 * KEEP: existing sync generator
 * ---------------------------
 * POST /api/servicing/generate
 * (Your original endpoint remains for backward compatibility.)
 *
 * Note: This does NOT persist payload for fail-safe server-side continuation.
 * Use /submit-payload for the new durable flow.
 */
router.post(
  "/generate",
  requireAuth,
  upload ? upload.any() : express.raw({ type: "*/*", limit: "1mb" }),
  async (req, res) => {
    try {
      if (!fs.existsSync(TEMPLATE_DOCX)) {
        return res.status(404).json({ ok: false, message: "Template DOCX not found on server.", path: TEMPLATE_DOCX });
      }
      if (!upload) {
        return res.status(500).json({
          ok: false,
          message: "Multipart upload is not configured. Install 'multer' (npm i multer) and restart server."
        });
      }

      // Parse payload
      const payloadRaw = req.body?.payload;
      let payload = null;
      try {
        payload = JSON.parse(payloadRaw);
      } catch {
        return res.status(400).json({ ok: false, message: "Invalid payload JSON." });
      }

      // Save in-memory photos to disk under a temp reportId (old flow)
      const reportId = newReportId("svc");
      const owner = ownerFromReq(req);

      // ✅ Set a deterministic server filename: area_service_YYYY-MM-DD_last4(svc)
      const createdAtIso = payload?.createdAt || new Date().toISOString();
      payload.reportId = reportId;
      payload.svcNumber = payload?.svcNumber || reportId;
      payload.serverFileName = pickFilenameFromPayload(payload, reportId, createdAtIso);
      payload.owner = owner;
      payload.ownerEmail = owner.email || "";

      ensureDir(REPORTS_DIR);
      ensureDir(REPORTPHOTOS_DIR);
      ensureDir(SIGNATURES_DIR);

      const photoDir = path.join(REPORTPHOTOS_DIR, reportId);
      ensureDir(photoDir);

      const files = Array.isArray(req.files) ? req.files : [];
      const photoByField = {};
      const savedPhotos = [];
      for (const f of files) {
        if (!f || !f.buffer) continue;
        const safe = safeFilename(f.originalname || "photo.jpg");
        const outPath = path.join(photoDir, safe);
        try {
          fs.writeFileSync(outPath, f.buffer);
          savedPhotos.push({ field: f.fieldname, filename: safe });
          if (!photoByField[f.fieldname]) photoByField[f.fieldname] = outPath;
        } catch {
          // ignore
        }
      }

      const generatedFileName =
        String(payload?.serverFileName || "") || pickFilenameFromPayload(payload, reportId, payload?.createdAt);

      const upsertReportMetaWithOwner = (fileName, fields) =>
        upsertReportMeta(fileName, {
          ...fields,
          owner,
          ownerEmail: owner.email || "",
          by: owner.email || fields?.by || ""
        });

      const { fileName, url, signatureFileName, signaturePath } = await generateServicingDocx({
        reportId,
        payload,
        user: req.user,
        templateDocx: TEMPLATE_DOCX,
        reportsDir: REPORTS_DIR,
        reportPhotosDir: REPORTPHOTOS_DIR,
        signaturesDir: SIGNATURES_DIR,
        reportsMeta: REPORTS_META,
        fileNameOverride: generatedFileName,
        photoByField,
        savedPhotos,
        upsertReportMeta: upsertReportMetaWithOwner
      });

      return res.json({
        ok: true,
        reportId,
        serverFileName: payload.serverFileName,
        fileName, // return the actual output file name
        url,
        signatureFile: signatureFileName,
        signaturePath,
        signatureKept: true
      });
    } catch (e) {
      return res.status(400).json({
        ok: false,
        message: String(e?.message || "Template render error.")
      });
    }
  }
);

module.exports = router;