const express = require("express");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;

const multer = require("multer");

// ✅ Match Servicing auth pattern
const { getSession, extractBearer } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");

const router = express.Router();

// -------------------- Config / Paths --------------------

const DATA_DIR = path.join(__dirname, "..", "data");

const CALLOUT_PAYLOADS_DIR = path.join(DATA_DIR, "callout-payloads");
const CALLOUT_STATUS_DIR = path.join(DATA_DIR, "callout-status");
const CALLOUT_QUEUE_DIR = path.join(DATA_DIR, "callout-queue");

// Store callout photos separately from servicing
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const CALLOUT_PHOTOS_DIR = path.join(UPLOADS_DIR, "calloutphotos");

// Reports output folder (same as servicing so Reports page can list them later)
const REPORTS_OUT_DIR = path.join(UPLOADS_DIR, "reports");

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

// -------------------- Multer (multipart form-data) --------------------
// We accept many photo fields named "photo" (as the frontend sends).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024 // 15MB per image (adjust as needed)
  }
});

// -------------------- Routes --------------------

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
    const files = Array.isArray(req.files) ? req.files : [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f || !f.buffer) continue;

      const origName = safeBasename(f.originalname || `photo_${i}.jpg`);
      const ext = path.extname(origName) || ".jpg";
      const base = path.basename(origName, ext);

      // Ensure unique filename
      const outName = `${base}_${Date.now()}_${i}${ext}`;
      const outPath = path.join(reportPhotosDir, outName);

      await fsp.writeFile(outPath, f.buffer);
      savedPhotos.push({
        filename: outName,
        originalname: f.originalname || outName,
        mimetype: f.mimetype || "",
        size: f.size || 0
      });
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