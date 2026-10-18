const express = require("express");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;

const multer = require("multer");

// ✅ Match Servicing auth pattern
const { getSession, extractBearer } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");
const { validateImageBuffer, validateSignatureDataUrl, safeGeneratedImageName } = require("../lib/imageValidation");

const router = express.Router();

// -------------------- Config / Paths --------------------

const DATA_DIR = path.join(__dirname, "..", "data");

const CALLOUT_PAYLOADS_DIR = path.join(DATA_DIR, "callout-payloads");
const CALLOUT_STATUS_DIR = path.join(DATA_DIR, "callout-status");
const CALLOUT_QUEUE_DIR = path.join(DATA_DIR, "callout-queue");
const CALLOUT_DRAFTS_DIR = path.join(DATA_DIR, "callout-drafts-v2");

// Store callout photos separately from servicing
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const CALLOUT_PHOTOS_DIR = path.join(UPLOADS_DIR, "calloutphotos");

// Reports output folder (same as servicing so Reports page can list them later)
const REPORTS_OUT_DIR = path.join(UPLOADS_DIR, "reports");
const MAX_TOTAL_UPLOAD_BYTES = 45 * 1024 * 1024;

function totalUploadBytes(files) {
  return (Array.isArray(files) ? files : []).reduce((sum, f) => sum + Number(f?.size || f?.buffer?.length || 0), 0);
}

function validateRequiredSignature(payload) {
  try {
    return validateSignatureDataUrl(payload?.signatureDataUrl || payload?.signature || "");
  } catch (error) {
    const wrapped = new Error(`A valid technician signature is required. ${String(error?.message || "")}`.trim());
    wrapped.status = /too large/i.test(String(error?.message || "")) ? 413 : 400;
    throw wrapped;
  }
}

function validateEvidenceFiles(files) {
  return (Array.isArray(files) ? files : []).map((file) => ({
    file,
    info: validateImageBuffer(file?.buffer, {
      allowed: ["png", "jpeg"],
      maxBytes: 15 * 1024 * 1024,
      declaredMime: file?.mimetype || ""
    })
  }));
}

function safeBasename(name) {
  return path.basename(String(name || "")).replace(/[^\w.\-]/g, "_");
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

function ownerFromReq(req) {
  return {
    id: String(req.user?.id || "").trim(),
    email: String(req.user?.email || "").trim(),
    name: String(req.user?.name || "").trim(),
    role: String(req.user?.role || "").trim()
  };
}

// ✅ Same as routes/servicing.js
function requireAuth(req, res, next) {
  const token = extractBearer(req);

  const session = token ? getSession(token) : null;
  if (!session?.userId) return res.status(401).json({ ok: false, message: "Not logged in." });

  const user = getUsers().find((u) => u.id === session.userId) || null;
  if (!user) return res.status(401).json({ ok: false, message: "Not logged in." });

  req.user = user;
  next();
}

function userKeyFromReq(req) {
  // Prefer stable numeric/uuid id, else email
  const u = req.user || {};
  return safeBasename(u.id || u.email || "unknown");
}

function statusFilePath(userKey, reportId) {
  return path.join(CALLOUT_STATUS_DIR, userKey, `${safeBasename(reportId)}.json`);
}

function payloadFilePath(userKey, reportId) {
  return path.join(CALLOUT_PAYLOADS_DIR, userKey, `${safeBasename(reportId)}.json`);
}

function queueJobPath(userKey, reportId) {
  return path.join(CALLOUT_QUEUE_DIR, userKey, `${safeBasename(reportId)}.job.json`);
}

function photosDirPath(reportId) {
  return path.join(CALLOUT_PHOTOS_DIR, safeBasename(reportId));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validDraftId(value) {
  const raw = String(value || "").trim();
  const draftId = safeBasename(raw);
  if (!draftId || draftId !== raw || !draftId.startsWith("callout_v2_draft_")) return "";
  return draftId;
}

function draftFilePath(userKey, draftId) {
  return path.join(CALLOUT_DRAFTS_DIR, safeBasename(userKey), `${draftId}.json`);
}

async function readDraftFile(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeDraftFileAtomic(filePath, record) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await fsp.writeFile(tmp, JSON.stringify(record, null, 2), { encoding: "utf8", mode: 0o600 });
    await fsp.rename(tmp, filePath);
  } catch (error) {
    await fsp.unlink(tmp).catch(() => {});
    throw error;
  }
}

function isCalloutV2Draft(record, expectedKey = "") {
  return Boolean(
    record &&
    record.type === "calloutV2Draft" &&
    validDraftId(record.key) &&
    (!expectedKey || record.key === expectedKey)
  );
}

function publicDraft(record, { includeValue = true } = {}) {
  const draft = {
    key: String(record.key || ""),
    type: "calloutV2Draft",
    name: String(record.name || record.key || ""),
    createdAt: String(record.createdAt || ""),
    updatedAt: String(record.updatedAt || "")
  };
  if (includeValue) draft.value = isPlainObject(record.value) ? record.value : {};
  return draft;
}

// -------------------- Multer (multipart form-data) --------------------
// We accept many photo fields named "photo" (as the frontend sends).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024 // 15MB per image (adjust as needed)
  }
});

// -------------------- Routes --------------------

// -------------------- Call Out V2 drafts --------------------

router.use("/drafts", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

router.get("/drafts", requireAuth, async (req, res) => {
  try {
    const userKey = userKeyFromReq(req);
    const dir = path.join(CALLOUT_DRAFTS_DIR, userKey);
    let names = [];

    try {
      names = await fsp.readdir(dir);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    const drafts = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const record = await readDraftFile(path.join(dir, name));
      if (!isCalloutV2Draft(record)) continue;
      drafts.push(publicDraft(record, { includeValue: false }));
    }

    drafts.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return res.json({ ok: true, drafts });
  } catch (error) {
    return res.status(500).json({ ok: false, message: String(error?.message || "Failed to list Call Out drafts.") });
  }
});

router.get("/drafts/:draftId", requireAuth, async (req, res) => {
  try {
    const userKey = userKeyFromReq(req);
    const draftId = validDraftId(req.params.draftId);
    if (!draftId) return res.status(400).json({ ok: false, message: "Invalid draft id." });

    const record = await readDraftFile(draftFilePath(userKey, draftId));
    if (!isCalloutV2Draft(record, draftId)) {
      return res.status(404).json({ ok: false, message: "Draft not found." });
    }

    return res.json({ ok: true, draft: publicDraft(record) });
  } catch (error) {
    return res.status(500).json({ ok: false, message: String(error?.message || "Failed to load Call Out draft.") });
  }
});

router.post("/drafts", requireAuth, async (req, res) => {
  try {
    const userKey = userKeyFromReq(req);
    const body = req.body || {};
    const key = validDraftId(body.key || body.draftId);
    if (!key) return res.status(400).json({ ok: false, message: "Invalid Call Out draft id." });

    if (!isPlainObject(body.value)) {
      return res.status(400).json({ ok: false, message: "Draft value must be an object." });
    }
    try { validateRequiredSignature(body.value); }
    catch (error) { return res.status(error.status || 400).json({ ok: false, message: error.message }); }

    const filePath = draftFilePath(userKey, key);
    await ensureDir(path.dirname(filePath));
    const existing = await readDraftFile(filePath);
    const now = new Date().toISOString();
    const owner = ownerFromReq(req);
    const record = {
      key,
      type: "calloutV2Draft",
      name: String(body.name || existing?.name || key).trim() || key,
      createdAt: existing?.createdAt || String(body.createdAt || "").trim() || now,
      updatedAt: now,
      owner,
      ownerEmail: owner.email || "",
      userKey,
      value: body.value
    };

    await writeDraftFileAtomic(filePath, record);
    return res.json({ ok: true, draft: publicDraft(record, { includeValue: false }) });
  } catch (error) {
    return res.status(500).json({ ok: false, message: String(error?.message || "Failed to save Call Out draft.") });
  }
});

router.delete("/drafts/:draftId", requireAuth, async (req, res) => {
  try {
    const userKey = userKeyFromReq(req);
    const draftId = validDraftId(req.params.draftId);
    if (!draftId) return res.status(400).json({ ok: false, message: "Invalid draft id." });

    const filePath = draftFilePath(userKey, draftId);
    const record = await readDraftFile(filePath);
    if (!isCalloutV2Draft(record, draftId)) {
      return res.status(404).json({ ok: false, message: "Draft not found." });
    }

    await fsp.unlink(filePath);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, message: String(error?.message || "Failed to delete Call Out draft.") });
  }
});

/**
 * POST /api/callout/submit-payload
 *
 * Expects multipart/form-data:
 * - payload: JSON string (required)
 * - photo: image files (0..n)
 *
 * Writes:
 * - data/callout-payloads/<userKey>/<reportId>.json
 * - data/callout-status/<userKey>/<reportId>.json
 * - data/uploads/calloutphotos/<reportId>/*.jpg
 * - data/callout-queue/<userKey>/<reportId>.job.json
 *
 * Returns: { ok:true, reportId, status:"pending" }
 */
router.post("/submit-payload", requireAuth, upload.array("photo", 50), async (req, res) => {
  try {
    const uploadedBytes = totalUploadBytes(req.files);
    if (uploadedBytes > MAX_TOTAL_UPLOAD_BYTES) {
      return res.status(413).json({
        ok: false,
        message: "Selected photos are too large as a group. Please reduce photo size/count and try again.",
        maxTotalMB: Math.round(MAX_TOTAL_UPLOAD_BYTES / 1024 / 1024)
      });
    }

    const userKey = userKeyFromReq(req);
    const owner = ownerFromReq(req);

    // Ensure base dirs exist
    await Promise.all([
      ensureDir(path.join(CALLOUT_PAYLOADS_DIR, userKey)),
      ensureDir(path.join(CALLOUT_STATUS_DIR, userKey)),
      ensureDir(path.join(CALLOUT_QUEUE_DIR, userKey)),
      ensureDir(CALLOUT_PHOTOS_DIR),
      ensureDir(REPORTS_OUT_DIR)
    ]);

    const rawPayload = req.body?.payload;
    if (!rawPayload) {
      return res.status(400).json({ ok: false, message: "Missing payload field." });
    }

    let payload;
    try {
      payload = JSON.parse(rawPayload);
    } catch (e) {
      return res.status(400).json({ ok: false, message: "Invalid payload JSON." });
    }

    try {
      validateRequiredSignature(payload);
    } catch (error) {
      return res.status(error.status || 400).json({ ok: false, message: error.message });
    }

    let validatedFiles = [];
    try {
      validatedFiles = validateEvidenceFiles(req.files);
    } catch (error) {
      const status = /too large/i.test(String(error?.message || "")) ? 413 : 400;
      return res.status(status).json({ ok: false, message: String(error?.message || "Invalid evidence image.") });
    }

    const reportId = String(payload?.reportId || "").trim();
    if (!reportId) {
      return res.status(400).json({ ok: false, message: "Missing payload.reportId." });
    }

    // ✅ Stamp technician from logged-in user (used by template <<technician>>)
    payload.technician = payload.technician || owner.name || owner.email || "";

    // Save uploaded photos (if any) to a report folder
    const reportPhotosDir = photosDirPath(reportId);
    await ensureDir(reportPhotosDir);

    const savedPhotos = [];

    try {
      for (let i = 0; i < validatedFiles.length; i += 1) {
        const { file, info } = validatedFiles[i];
        const outName = safeGeneratedImageName("evidence", `${reportId}_${i + 1}`, info.ext);
        const outPath = path.join(reportPhotosDir, outName);
        await fsp.writeFile(outPath, file.buffer, { mode: 0o600 });
        savedPhotos.push({
          filename: outName,
          originalname: file.originalname || outName,
          mimetype: info.mime,
          size: info.bytes
        });
      }
    } catch (error) {
      await fsp.rm(reportPhotosDir, { recursive: true, force: true }).catch(() => {});
      return res.status(500).json({ ok: false, message: "Evidence images could not be saved." });
    }

    // Attach saved photo filenames to payload so generator can embed them later
    // Frontend already sends meta in payload.photos (id/name/description).
    // We’ll extend each with filename in order (best-effort).
    if (Array.isArray(payload.photos)) {
      const updated = payload.photos.map((p, idx) => ({
        ...(p || {}),
        filename: savedPhotos[idx]?.filename || ""
      }));
      payload.photos = updated;
    } else {
      payload.photos = [];
    }

    payload.owner = owner;
    payload.ownerEmail = owner.email || "";
    payload._server = {
      receivedAt: new Date().toISOString(),
      userKey,
      owner,
      ownerEmail: owner.email || "",
      photoDir: reportPhotosDir
    };

    // Write durable payload file
    const pPath = payloadFilePath(userKey, reportId);
    await fsp.writeFile(pPath, JSON.stringify(payload, null, 2), "utf8");

    // Write initial status file (so UI can poll)
    const sPath = statusFilePath(userKey, reportId);
    const statusObj = {
      status: "pending",
      reportId,
      owner,
      ownerEmail: owner.email || "",
      updatedAt: new Date().toISOString()
    };
    await fsp.writeFile(sPath, JSON.stringify(statusObj, null, 2), "utf8");

    // Enqueue job for worker (calloutWorker will consume this)
    const qPath = queueJobPath(userKey, reportId);
    const jobObj = {
      type: "callout",
      reportId,
      userKey,
      createdAt: new Date().toISOString(),
      payloadPath: pPath,
      statusPath: sPath
    };
    await fsp.writeFile(qPath, JSON.stringify(jobObj, null, 2), "utf8");

    return res.json({ ok: true, reportId, status: "pending" });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || "Server error" });
  }
});

/**
 * GET /api/callout/status/:reportId
 * Reads data/callout-status/<userKey>/<reportId>.json
 */
router.get("/status/:reportId", requireAuth, async (req, res) => {
  try {
    const userKey = userKeyFromReq(req);
    const reportId = String(req.params.reportId || "").trim();
    if (!reportId) return res.status(400).json({ ok: false, message: "Missing reportId." });

    const sPath = statusFilePath(userKey, reportId);
    const raw = await fsp.readFile(sPath, "utf8").catch(() => null);

    if (!raw) {
      return res.status(404).json({ ok: false, message: "No status found for reportId." });
    }

    const obj = JSON.parse(raw);
    return res.json(obj);
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || "Server error" });
  }
});

/**
 * GET /api/callout/download/:filename
 * Serves from uploads/reports (same as servicing)
 */
router.get("/download/:filename", requireAuth, async (req, res) => {
  try {
    const filename = safeBasename(req.params.filename || "");
    if (!filename) return res.status(400).json({ ok: false, message: "Missing filename." });

    const filePath = path.join(REPORTS_OUT_DIR, filename);
    const exists = await fsp
      .stat(filePath)
      .then((st) => st.isFile())
      .catch(() => false);

    if (!exists) return res.status(404).json({ ok: false, message: "File not found." });

    return res.download(filePath, filename);
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || "Server error" });
  }
});

module.exports = router;
