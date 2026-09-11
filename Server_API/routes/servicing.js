const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// For auth (same pattern as routes/stock.js)
const { getSession, extractBearer } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");
const { writeJsonAtomicSync, updateJsonWithLockSync } = require("../lib/lockedJson");

// Multipart support (npm i multer)
let multer = null;
try {
  multer = require("multer");
} catch {
  multer = null;
}

// ✅ NEW: generator used by worker + optional sync route
const { generateServicingDocx } = require("../lib/servicingGenerator");
const { resolveUnder } = require("../lib/reportStorage");

const router = express.Router();

const DATA_DIR = path.join(__dirname, "..", "data");
const TEMPLATES_DIR = path.join(DATA_DIR, "templates");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

// Source files
const CHECKLIST_FILES = {
  substation: path.join(TEMPLATES_DIR, "full_manual_checklist_questions.json"),
  conveyor: path.join(TEMPLATES_DIR, "conveyor_system_checklist_questions.json")
};
const DEFAULT_CHECKLIST_TYPE = "substation";
const CHECKLIST_FILE = CHECKLIST_FILES[DEFAULT_CHECKLIST_TYPE]; // backward-compatible default
const TEMPLATE_DOCX = path.join(TEMPLATES_DIR, "template.docx");
const AREAS_TXT = path.join(TEMPLATES_DIR, "areas.txt");
const SERVICES_TXT = path.join(TEMPLATES_DIR, "services.txt");

// Output folders
const REPORTS_DIR = path.join(UPLOADS_DIR, "reports"); // generated DOCX output
const REPORTPHOTOS_DIR = path.join(UPLOADS_DIR, "reportphotos"); // saved photos
const SIGNATURES_DIR = path.join(UPLOADS_DIR, "signatures"); // signatures
const REPORTS_META = path.join(DATA_DIR, "reports.meta.json");
const MAX_TOTAL_UPLOAD_BYTES = 45 * 1024 * 1024;

function totalUploadBytes(files) {
  return (Array.isArray(files) ? files : []).reduce((sum, f) => sum + Number(f?.size || f?.buffer?.length || 0), 0);
}

// ✅ NEW: durable payload + queue + status
const SERVICING_PAYLOADS_DIR = path.join(DATA_DIR, "servicing-payloads");
const SERVICING_STATUS_DIR = path.join(DATA_DIR, "servicing-status");
const SERVICING_QUEUE_DIR = path.join(DATA_DIR, "servicing-queue");
const SERVICING_DRAFTS_DIR = path.join(DATA_DIR, "servicing-drafts");

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

function noStore(req, res, next) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
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
  writeJsonAtomicSync(REPORTS_META, meta);
}

/**
 * Add/update a report entry in reports.meta.json WITHOUT overwriting existing statuses.
 */
function upsertReportMeta(fileName, fields) {
  updateJsonWithLockSync(REPORTS_META, { reports: {} }, (meta) => {
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) meta = { reports: {} };
    if (!meta.reports || typeof meta.reports !== "object" || Array.isArray(meta.reports)) meta.reports = {};

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

    return meta;
  });
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

function draftPathFor(userKey, draftId) {
  return path.join(SERVICING_DRAFTS_DIR, userKey, `${safeFilename(draftId)}.json`);
}

function publicDraft(rec) {
  return {
    key: rec.key,
    type: rec.type || "servicingDraft",
    name: rec.name || rec.key,
    createdAt: rec.createdAt || "",
    updatedAt: rec.updatedAt || rec.createdAt || "",
    value: rec.value || {}
  };
}

function ensureDraftOwner(req, rec) {
  const owner = ownerFromReq(req);
  return { ...(rec || {}), owner, ownerEmail: owner.email || "", userKey: userKeyFromReq(req) };
}

function findErrorStatusForAnyUser(reportId) {
  const fileName = `${safeFilename(reportId)}.json`;
  try {
    if (!fs.existsSync(SERVICING_STATUS_DIR)) return null;
    for (const userKey of fs.readdirSync(SERVICING_STATUS_DIR)) {
      const sPath = path.join(SERVICING_STATUS_DIR, userKey, fileName);
      if (!fs.existsSync(sPath)) continue;
      const st = readJsonFile(sPath, null);
      if (String(st?.status || "").toLowerCase() === "error") {
        return {
          status: "error",
          reportId,
          error: st.error || "This saved job is no longer available on the server. Please clear it and submit again if needed.",
          updatedAt: st.updatedAt || new Date().toISOString()
        };
      }
    }
  } catch {
    // ignore fallback lookup errors
  }
  return null;
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
      limits: {
        fileSize: 25 * 1024 * 1024,
        fieldSize: 10 * 1024 * 1024,
        files: 80,
        fields: 2000,
        parts: 2200
      }
    })
  : null;

function servicingUploadAny(req, res, next) {
  if (!upload) return express.raw({ type: "*/*", limit: "1mb" })(req, res, next);
  return upload.any()(req, res, (err) => {
    if (!err) return next();
    const code = String(err.code || "");
    const message = String(err.message || "Upload failed.");
    console.error("Servicing multipart upload error", {
      code,
      message,
      path: req.path,
      contentLength: req.headers && req.headers["content-length"],
      contentType: req.headers && req.headers["content-type"]
    });
    const status = code === "LIMIT_FILE_SIZE" || code === "LIMIT_FIELD_VALUE" ? 413 : 400;
    return res.status(status).json({
      ok: false,
      code,
      message: code === "LIMIT_FILE_SIZE"
        ? "One uploaded photo is too large. Please reduce the photo size and try again."
        : code === "LIMIT_FIELD_VALUE"
          ? "The report form payload is too large. Please reduce attached photos or split the report."
          : message
    });
  });
}

function normalizeChecklistType(value) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "conveyor") return "conveyor";
  if (s === "substation" || s === "full" || s === "manual") return "substation";
  return DEFAULT_CHECKLIST_TYPE;
}

/**
 * GET /api/servicing/checklist
 * Optional query: ?type=substation|conveyor
 * Defaults to substation to preserve existing clients/logic.
 */
router.get("/checklist", requireAuth, (req, res) => {
  const checklistType = normalizeChecklistType(req.query?.type);
  const checklistFile = CHECKLIST_FILES[checklistType] || CHECKLIST_FILE;

  if (!fs.existsSync(checklistFile)) {
    return res.status(404).json({
      ok: false,
      message: "Checklist file not found on server.",
      type: checklistType,
      path: checklistFile
    });
  }
  const data = readJsonFile(checklistFile, null);
  if (!data) return res.status(500).json({ ok: false, message: "Checklist JSON is invalid.", type: checklistType });

  // Backward compatible:
  // - older clients may expect the raw checklist object
  // - newer clients can use { ok: true, checklist: <object> }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return res.json({ ok: true, type: checklistType, checklist: data, ...data });
  }
  return res.json({ ok: true, type: checklistType, checklist: data });
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
function downloadServicingReport(req, res) {
  const requestedPath = String(req.query?.path || "").trim();
  const filename = safeFilename(req.params.filename || "");
  const rel = requestedPath || filename;
  if (!rel) return res.status(400).json({ ok: false, message: "Missing filename." });

  const p = requestedPath ? resolveUnder(REPORTS_DIR, requestedPath) : path.join(REPORTS_DIR, filename);
  if (!p || !p.startsWith(REPORTS_DIR)) return res.status(400).json({ ok: false, message: "Invalid filename." });
  if (!fs.existsSync(p)) return res.status(404).json({ ok: false, message: "File not found." });

  const downloadName = path.basename(p);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
  fs.createReadStream(p).pipe(res);
}

router.get("/download", requireAuth, downloadServicingReport);
router.get("/download/:filename", requireAuth, downloadServicingReport);

router.use("/drafts", noStore);

router.get("/drafts", requireAuth, (req, res) => {
  try {
    const userKey = userKeyFromReq(req);
    const dir = path.join(SERVICING_DRAFTS_DIR, userKey);
    ensureDir(dir);
    const drafts = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJsonFile(path.join(dir, f), null))
      .filter((x) => x && x.key)
      .map(publicDraft)
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return res.json({ ok: true, drafts });
  } catch (e) {
    return res.status(500).json({ ok: false, message: String(e?.message || "Failed to list drafts.") });
  }
});

router.get("/drafts/:draftId", requireAuth, (req, res) => {
  try {
    const userKey = userKeyFromReq(req);
    const draftId = safeFilename(req.params.draftId || "");
    if (!draftId) return res.status(400).json({ ok: false, message: "Missing draft id." });
    const p = draftPathFor(userKey, draftId);
    if (!fs.existsSync(p)) return res.status(404).json({ ok: false, message: "Draft not found." });
    const rec = readJsonFile(p, null);
    if (!rec) return res.status(500).json({ ok: false, message: "Draft file invalid." });
    return res.json({ ok: true, draft: publicDraft(rec) });
  } catch (e) {
    return res.status(500).json({ ok: false, message: String(e?.message || "Failed to load draft.") });
  }
});

router.post("/drafts", requireAuth, (req, res) => {
  try {
    const userKey = userKeyFromReq(req);
    const body = req.body || {};
    const now = new Date().toISOString();
    const key = safeFilename(body.key || body.draftId || `servicing_draft_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`);
    if (!key) return res.status(400).json({ ok: false, message: "Missing draft id." });
    const existing = readJsonFile(draftPathFor(userKey, key), null) || {};
    const rec = ensureDraftOwner(req, {
      ...existing,
      key,
      type: "servicingDraft",
      name: String(body.name || existing.name || key).trim() || key,
      createdAt: existing.createdAt || body.createdAt || now,
      updatedAt: now,
      value: body.value && typeof body.value === "object" ? body.value : existing.value || {}
    });
    writeJsonFileAtomic(draftPathFor(userKey, key), rec);
    return res.json({ ok: true, draft: publicDraft(rec) });
  } catch (e) {
    return res.status(500).json({ ok: false, message: String(e?.message || "Failed to save draft.") });
  }
});

router.delete("/drafts/:draftId", requireAuth, (req, res) => {
  try {
    const userKey = userKeyFromReq(req);
    const draftId = safeFilename(req.params.draftId || "");
    if (!draftId) return res.status(400).json({ ok: false, message: "Missing draft id." });
    const p = draftPathFor(userKey, draftId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, message: String(e?.message || "Failed to delete draft.") });
  }
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
  servicingUploadAny,
  (req, res) => {
    if (!upload) {
      return res.status(500).json({
        ok: false,
        message: "Multipart upload is not configured. Install 'multer' (npm i multer) and restart server."
      });
    }

    const uploadedBytes = totalUploadBytes(req.files);
    if (uploadedBytes > MAX_TOTAL_UPLOAD_BYTES) {
      return res.status(413).json({
        ok: false,
        message: "Selected photos are too large as a group. Please reduce photo size/count and try again.",
        maxTotalMB: Math.round(MAX_TOTAL_UPLOAD_BYTES / 1024 / 1024)
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

  // Some older mobile drafts can be left under a different historical user key.
  // If we can prove the server already marked that reportId as an error, return
  // the safe generic error so the client stops polling forever.
  const historicalError = findErrorStatusForAnyUser(reportId);
  if (historicalError) return res.json({ ok: true, ...historicalError });

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
  servicingUploadAny,
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

      const { fileName, relativePath, section, reportMonth, url, signatureFileName, signaturePath } = await generateServicingDocx({
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
        relativePath,
        section,
        reportMonth,
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

    const uploadedBytes = totalUploadBytes(req.files);
    if (uploadedBytes > MAX_TOTAL_UPLOAD_BYTES) {
      return res.status(413).json({
        ok: false,
        message: "Selected photos are too large as a group. Please reduce photo size/count and try again.",
        maxTotalMB: Math.round(MAX_TOTAL_UPLOAD_BYTES / 1024 / 1024)
      });
    }
  }
);

module.exports = router;
