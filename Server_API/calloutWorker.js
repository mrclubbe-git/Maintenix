const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { writeJsonAtomicSync: atomicWriteJsonSync, updateJsonWithLockSync } = require("./lib/lockedJson");
const { findOldestQueuedJobSync, claimJobSync } = require("./lib/jobQueue");

// DOCX generation dependencies shared with Servicing.
let PizZip = null;
let Docxtemplater = null;
let ImageModule = null;

try {
  PizZip = require("pizzip");
} catch {}
try {
  Docxtemplater = require("docxtemplater");
} catch {}
try {
  // Image module used by the Call Out report template.
  ImageModule = require("docxtemplater-image-module-free");
} catch {}

const DATA_DIR = path.join(__dirname, "data");
const TEMPLATES_DIR = path.join(DATA_DIR, "templates");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

const CALLOUT_QUEUE_DIR = path.join(DATA_DIR, "callout-queue");
const CALLOUT_PAYLOADS_DIR = path.join(DATA_DIR, "callout-payloads");
const CALLOUT_STATUS_DIR = path.join(DATA_DIR, "callout-status");
const CALLOUT_PHOTOS_DIR = path.join(UPLOADS_DIR, "calloutphotos");

const REPORTS_OUT_DIR = path.join(UPLOADS_DIR, "reports");
const REPORTS_META = path.join(DATA_DIR, "reports.meta.json");
const TEMPLATE_PATH = path.join(TEMPLATES_DIR, "call_out_template.docx");

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function fileExists(p) {
  try {
    const st = await fsp.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

async function readJson(p) {
  const raw = await fsp.readFile(p, "utf8");
  return JSON.parse(raw);
}

async function writeJson(p, obj) {
  atomicWriteJsonSync(p, obj);
}

function safeBasename(name) {
  return path.basename(String(name || "")).replace(/[^\w.\-]/g, "_");
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
  const email = pickNonEmpty(ownerLike.email, ownerLike.ownerEmail, ownerLike.userEmail);
  const name = pickNonEmpty(ownerLike.name, ownerLike.fullName, ownerLike.displayName);
  const role = pickNonEmpty(ownerLike.role);

  if (!id && !email && !name && !role) return null;

  return { id, email, name, role };
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

// Walk one level: data/callout-queue/<userKey>/*.job.json
async function listQueuedJobs() {
  const jobPath = findOldestQueuedJobSync(CALLOUT_QUEUE_DIR, (name) => name.endsWith(".job.json"));
  if (!jobPath) return [];
  return [{
    userKey: path.basename(path.dirname(jobPath)),
    jobPath,
    name: path.basename(jobPath)
  }];
}

function statusPathFor(userKey, reportId) {
  return path.join(CALLOUT_STATUS_DIR, userKey, `${safeBasename(reportId)}.json`);
}

function payloadPathFor(userKey, reportId) {
  return path.join(CALLOUT_PAYLOADS_DIR, userKey, `${safeBasename(reportId)}.json`);
}

function photosDirFor(reportId) {
  return path.join(CALLOUT_PHOTOS_DIR, safeBasename(reportId));
}

const TRANSPARENT_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0J0AAAAASUVORK5CYII=";

function normalizeAnswer(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeDocxFileName(value) {
  const clean = safeBasename(String(value || "").trim() || "callout_report.docx");
  return /\.docx$/i.test(clean) ? clean : `${clean}.docx`;
}

function parseImageDataUrl(dataUrl) {
  const value = String(dataUrl || "").trim();
  const match = value.match(/^data:image\/(png|jpe?g);base64,([\s\S]+)$/i);
  if (!match) return null;
  try {
    return {
      ext: String(match[1] || "").toLowerCase() === "png" ? ".png" : ".jpg",
      buffer: Buffer.from(match[2], "base64")
    };
  } catch {
    return null;
  }
}

function writeSignatureImage(reportId, payload) {
  const reportDir = photosDirFor(reportId);
  fs.mkdirSync(reportDir, { recursive: true });

  const parsed = parseImageDataUrl(payload?.signatureDataUrl || payload?.signature || "");
  if (!parsed?.buffer?.length) {
    throw new Error("Call Out report is missing a valid technician signature.");
  }

  const filename = `signature_${safeBasename(reportId)}${parsed.ext}`;
  const filePath = path.join(reportDir, filename);
  fs.writeFileSync(filePath, parsed.buffer);
  return filename;
}

function normalizeTemplateImageTags(zip) {
  const targets = Object.keys(zip.files || {}).filter((name) =>
    /^word\/(document|header\d+|footer\d+)\.xml$/i.test(name)
  );

  const replacements = [
    ["&lt;&lt;photo&gt;&gt;", "&lt;&lt;%photo&gt;&gt;"],
    ["&lt;&lt;signature&gt;&gt;", "&lt;&lt;%signature&gt;&gt;"],
    ["<<photo>>", "<<%photo>>"],
    ["<<signature>>", "<<%signature>>"]
  ];

  let changed = 0;

  for (const name of targets) {
    const entry = zip.file(name);
    if (!entry) continue;

    let xml = entry.asText();
    let next = xml;

    for (const [plainTag, imageTag] of replacements) {
      if (!next.includes(plainTag)) continue;
      next = next.split(plainTag).join(imageTag);
    }

    if (next !== xml) {
      zip.file(name, next);
      changed += 1;
    }
  }

  return changed;
}

function buildTemplateData(payload, reportId) {
  const systemDefective = normalizeAnswer(
    payload?.systemDefective || payload?.answers?.system_defective?.answer
  );
  const rawResolved = normalizeAnswer(
    payload?.defectResolved || payload?.answers?.defect_resolved?.answer
  );

  if (systemDefective !== "YES" && systemDefective !== "NO") {
    throw new Error("Call Out payload is missing a valid system-defective answer.");
  }

  const defectResolved = systemDefective === "YES"
    ? rawResolved
    : "N/A";

  if (systemDefective === "YES" && defectResolved !== "YES" && defectResolved !== "NO") {
    throw new Error("Call Out payload is missing a valid defect-resolution answer.");
  }

  const repairResolved = systemDefective === "YES" && defectResolved === "YES";
  const repairOutstanding = systemDefective === "YES" && defectResolved === "NO";

  const photos = Array.isArray(payload?.photos) ? payload.photos : [];
  const normalizedPhotos = photos.map((photo, index) => ({
    index: index + 1,
    kind: String(photo?.kind || photo?.section || "").trim().toLowerCase(),
    questionId: String(photo?.questionId || "").trim(),
    comment: String(photo?.comment || photo?.description || "").trim(),
    filename: safeBasename(photo?.filename || ""),
    name: String(photo?.name || "").trim()
  }));

  const defectPictures = normalizedPhotos
    .filter((photo) => photo.kind === "defect" || photo.questionId === "system_defective")
    .map((photo, index) => ({
      no: index + 1,
      photo: photo.filename,
      comment: photo.comment
    }));

  const repairPictures = normalizedPhotos
    .filter((photo) => photo.kind === "repair" || photo.questionId === "defect_resolved")
    .map((photo, index) => ({
      no: index + 1,
      photo: photo.filename,
      comment: photo.comment
    }));

  if (systemDefective === "YES") {
    if (!defectPictures.length) {
      throw new Error("Call Out report requires at least one defect picture.");
    }
    if (defectPictures.some((item) => !item.photo || !item.comment)) {
      throw new Error("Every defect picture requires a saved image and picture comment.");
    }
  }

  const repairDescription = String(
    payload?.repairDescription || payload?.answers?.defect_resolved?.comment || ""
  ).trim();

  const repairRequirements = (
    Array.isArray(payload?.repairRequirements)
      ? payload.repairRequirements
      : (Array.isArray(payload?.answers?.defect_resolved?.requirements)
          ? payload.answers.defect_resolved.requirements
          : [])
  )
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((requirement, index) => ({ no: index + 1, requirement }));

  if (repairResolved) {
    if (!repairDescription) {
      throw new Error("Resolved Call Out report requires a repair description.");
    }
    if (!repairPictures.length) {
      throw new Error("Resolved Call Out report requires at least one repair picture.");
    }
    if (repairPictures.some((item) => !item.photo || !item.comment)) {
      throw new Error("Every repair picture requires a saved image and picture comment.");
    }
  }

  if (repairOutstanding && !repairRequirements.length) {
    throw new Error("Unresolved Call Out report requires at least one repair requirement.");
  }

  const signature = writeSignatureImage(reportId, payload);

  const completionDate = String(payload?.callOutCompletedDate || "").trim();
  const completionTime = String(payload?.callOutCompletedTime || "").trim();
  if (!completionDate || !completionTime) {
    throw new Error("Call Out payload is missing the completion date/time captured on Submit.");
  }

  const resolutionSummary = systemDefective !== "YES"
    ? "Not applicable - no defect reported."
    : repairResolved
      ? repairDescription
      : repairRequirements.map((item) => item.requirement).join("; ");

  return {
    reportId,
    technician:
      payload?.technician ||
      payload?._server?.owner?.name ||
      payload?._server?.owner?.email ||
      payload?._server?.userKey ||
      "",
    area: payload?.area || "",
    callOutStartDate: payload?.callOutStartDate || "",
    callOutStartTime: payload?.callOutStartTime || "",
    callOutCompletedDate: completionDate,
    callOutCompletedTime: completionTime,
    systemDefective,
    defectResolved,
    resolutionSummary,
    defectPictures: systemDefective === "YES" ? defectPictures : [],
    repairResolved,
    repairOutstanding,
    repairDescription: repairResolved ? repairDescription : "",
    repairPictures: repairResolved ? repairPictures : [],
    repairRequirements: repairOutstanding ? repairRequirements : [],
    signature,
    "%signature": signature
  };
}

function loadBinary(p) {
  return fs.readFileSync(p, "binary");
}

function createImageModule(reportId) {
  if (!ImageModule) {
    throw new Error("Missing DOCX image dependency: docxtemplater-image-module-free.");
  }

  return new ImageModule({
    centered: false,
    fileType: "docx",
    getImage: (tagValue) => {
      const file = safeBasename(tagValue || "");
      if (!file) {
        throw new Error("Call Out template requested an image without a filename.");
      }

      const imgPath = path.join(photosDirFor(reportId), file);
      if (!fs.existsSync(imgPath)) {
        throw new Error(`Call Out report image is missing on the server: ${file}`);
      }

      return fs.readFileSync(imgPath);
    },
    getSize: (img, tagValue) => {
      const file = String(tagValue || "").toLowerCase();
      if (file.includes("signature_")) return [240, 90];
      return [210, 145];
    }
  });
}

async function generateDocxFromTemplate(reportId, payload) {
  if (!PizZip || !Docxtemplater) {
    throw new Error("Missing docx generation dependencies (pizzip/docxtemplater).");
  }

  const templateOk = await fileExists(TEMPLATE_PATH);
  if (!templateOk) {
    throw new Error("Missing template file: data/templates/call_out_template.docx");
  }

  await ensureDir(REPORTS_OUT_DIR);
  await ensureDir(photosDirFor(reportId));

  const content = loadBinary(TEMPLATE_PATH);
  const zip = new PizZip(content);

  // Draft V2 was initially created with ordinary <<photo>> / <<signature>>
  // placeholders. Convert those legacy tags to image-module tags at runtime so
  // existing deployed templates embed the actual images without a binary
  // template replacement.
  normalizeTemplateImageTags(zip);

  const opts = {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "<<", end: ">>" },
    nullGetter: () => ""
  };

  const imageModule = createImageModule(reportId);
  opts.modules = [imageModule];

  const doc = new Docxtemplater(zip, opts);
  const data = buildTemplateData(payload, reportId);
  doc.render(data);

  const out = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });

  const preferredName = pickNonEmpty(payload?.serverFileName, payload?.desiredFileName);
  const datePart = String(payload?.callOutCompletedDate || payload?.callOutStartDate || "")
    .trim()
    .replace(/[^0-9-]/g, "") || new Date().toISOString().slice(0, 10);
  const reportDigits = (String(reportId || "").match(/\d+/g) || []).join("");
  const last4 = reportDigits ? reportDigits.slice(-4).padStart(4, "0") : "0000";
  const fallbackName = `${safeBasename(payload?.area || "Area")}_CallOut_${datePart}_${last4}.docx`;
  const outName = normalizeDocxFileName(preferredName || fallbackName);
  const outPath = path.join(REPORTS_OUT_DIR, outName);

  await fsp.writeFile(outPath, out);
  return outName;
}

async function setStatus(userKey, reportId, patch) {
  const sPath = statusPathFor(userKey, reportId);
  const now = new Date().toISOString();

  let cur = { status: "pending", reportId, updatedAt: now };
  try {
    cur = await readJson(sPath);
  } catch {}

  const next = { ...cur, ...patch, reportId, updatedAt: now };
  await ensureDir(path.dirname(sPath));
  await writeJson(sPath, next);
}

async function processOneJob(jobEntry) {
  const jobObj = await readJson(jobEntry.jobPath);

  const userKey = String(jobObj.userKey || jobEntry.userKey || "anonymous");
  const reportId = String(jobObj.reportId || "").trim();
  if (!reportId) {
    // bad job; delete it
    await fsp.unlink(jobEntry.jobPath).catch(() => {});
    return;
  }

  const pPath = jobObj.payloadPath || payloadPathFor(userKey, reportId);

  await setStatus(userKey, reportId, { status: "running" });

  try {
    const payload = await readJson(pPath);

    const resolvedOwner =
      normalizeOwner(payload?._server?.owner) ||
      normalizeOwner(payload?.owner) ||
      normalizeOwner({
        email: payload?.ownerEmail || payload?.by || "",
        name: payload?.technician || "",
        role: ""
      });

    const ownerEmail =
      pickNonEmpty(
        resolvedOwner?.email,
        payload?._server?.owner?.email,
        payload?.ownerEmail,
        payload?.by
      ) || "";

    await setStatus(userKey, reportId, {
      status: "running",
      owner: resolvedOwner,
      ownerEmail
    });

    const filename = await generateDocxFromTemplate(reportId, payload);

    upsertReportMeta(filename, {
      id: reportId,
      type: "CALLOUT",
      fileName: filename,
      area: payload?.area || "",
      service: "Callout",
      systemType: payload?.systemType || "",
      technician: payload?.technician || resolvedOwner?.name || resolvedOwner?.email || "",
      createdAt: payload?.callOutCompletedAt || payload?.createdAt || new Date().toISOString(),
      createdDate: payload?.callOutCompletedDate || String(payload?.createdAt || new Date().toISOString()).slice(0, 10),
      owner: resolvedOwner,
      ownerEmail,
      by: ownerEmail || "",
      correctionOfReport: payload?.correctionOfReport || "",
      correctionReason: payload?.correctionReason || "",
      status: "PENDING"
    });

    await setStatus(userKey, reportId, {
      status: "done",
      owner: resolvedOwner,
      ownerEmail,
      result: {
        fileName: filename,
        url: `/api/callout/download/${encodeURIComponent(filename)}`
      }
    });

    // Delete payload file on success (mirrors servicing)
    await fsp.unlink(pPath).catch(() => {});
  } catch (e) {
    await setStatus(userKey, reportId, {
      status: "error",
      error: String(e?.message || "Callout generation failed")
    });
  } finally {
    // Always remove queue job (mirrors servicing behavior)
    await fsp.unlink(jobEntry.jobPath).catch(() => {});
  }
}

async function mainLoop() {
  await Promise.all([
    ensureDir(CALLOUT_QUEUE_DIR),
    ensureDir(CALLOUT_PAYLOADS_DIR),
    ensureDir(CALLOUT_STATUS_DIR),
    ensureDir(CALLOUT_PHOTOS_DIR),
    ensureDir(REPORTS_OUT_DIR)
  ]);

  // eslint-disable-next-line no-console
  console.log("CallOut worker running...");

  let tickRunning = false;

  // Poll loop
  // (Same model as servicingWorker; simple and robust)
  // One job per tick
  setInterval(async () => {
    if (tickRunning) return;
    tickRunning = true;

    try {
      const jobs = await listQueuedJobs();
      if (!jobs.length) return;

      const claimedJobPath = claimJobSync(jobs[0].jobPath);
      if (!claimedJobPath) return;

      await processOneJob({ ...jobs[0], jobPath: claimedJobPath });
    } catch {
      // swallow; status gets updated inside
    } finally {
      tickRunning = false;
    }
  }, 2000);
}

if (require.main === module) {
  mainLoop().catch((e) => {
    // eslint-disable-next-line no-console
    console.error("CallOut worker failed to start:", e);
    process.exit(1);
  });
}

module.exports = {
  buildTemplateData,
  generateDocxFromTemplate
};
