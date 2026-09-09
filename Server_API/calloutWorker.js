const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

// These deps are typically already present because Servicing uses docxtemplater.
// If image module isn't present, we generate without embedded photos.
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
  // One common module name; if your project uses a different image module, we’ll adjust later.
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
  await fsp.writeFile(p, JSON.stringify(obj, null, 2), "utf8");
}

function writeJsonAtomicSync(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, p);
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

  writeJsonAtomicSync(REPORTS_META, meta);
}

// Walk one level: data/callout-queue/<userKey>/*.job.json
async function listQueuedJobs() {
  const jobs = [];
  let userDirs = [];
  try {
    userDirs = await fsp.readdir(CALLOUT_QUEUE_DIR, { withFileTypes: true });
  } catch {
    return jobs;
  }

  for (const d of userDirs) {
    if (!d.isDirectory()) continue;
    const userKey = d.name;
    const userPath = path.join(CALLOUT_QUEUE_DIR, userKey);

    let files = [];
    try {
      files = await fsp.readdir(userPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const f of files) {
      if (!f.isFile()) continue;
      if (!f.name.endsWith(".job.json")) continue;
      jobs.push({
        userKey,
        jobPath: path.join(userPath, f.name),
        name: f.name
      });
    }
  }

  // oldest-first by filename timestamp-ish; good enough
  jobs.sort((a, b) => a.name.localeCompare(b.name));
  return jobs;
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

// Minimal date formatter for template friendliness
function fmtDateTime(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  // input from datetime-local is usually "YYYY-MM-DDTHH:mm"
  return s.replace("T", " ");
}

function buildTemplateData(payload, reportId) {
  const photos = Array.isArray(payload.photos) ? payload.photos : [];
  return {
    reportId,
    technician: payload.technician || payload._server?.owner?.name || payload._server?.owner?.email || payload._server?.userKey || "",

    area: payload.area || "",
    systemType: payload.systemType || "",

    timeCallLogged: fmtDateTime(payload.timeCallLogged),
    callLoggedByName: payload.callLoggedByName || "",
    callLoggedByRole: payload.callLoggedByRole || "",

    clientDefectDesc: payload.clientDefectDesc || "",

    timeArrival: fmtDateTime(payload.timeArrival),
    responderDefectDesc: payload.responderDefectDesc || "",

    couldRectify: payload.couldRectify || "",
    actionTaken: payload.actionTaken || "",
    materialsRequired: payload.materialsRequired || "",

    timeDeparture: fmtDateTime(payload.timeDeparture),

    jobcardCreated: payload.jobcardCreated || "",
    jobcardNumber: payload.jobcardNumber || "",
    noJobcardReason: payload.noJobcardReason || "",

    // For template loops: <<#photos>>...<</photos>>
    photos: photos.map((p, idx) => ({
      index: idx + 1,
      name: p.name || "",
      description: p.description || "",
      filename: p.filename || "" // set by submit route
    }))
  };
}

function loadBinary(p) {
  return fs.readFileSync(p, "binary");
}

// If image module exists, allow template to render images with <<%photo>>
function createImageModule(reportId) {
  if (!ImageModule) return null;

  return new ImageModule({
    centered: false,
    fileType: "docx",
    getImage: (tagValue) => {
      // tagValue will be a filename (e.g. from data.photos[n].filename)
      const file = safeBasename(tagValue || "");
      if (!file) return null;
      const imgPath = path.join(photosDirFor(reportId), file);
      try {
        return fs.readFileSync(imgPath);
      } catch {
        return null;
      }
    },
    getSize: () => {
      // Default size; you can tune later or make it depend on orientation
      return [520, 320];
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

  const content = loadBinary(TEMPLATE_PATH);
  const zip = new PizZip(content);

  const opts = {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "<<", end: ">>" }
  };

  const imageModule = createImageModule(reportId);
  if (imageModule) {
    opts.modules = [imageModule];
  }

  const doc = new Docxtemplater(zip, opts);

  const data = buildTemplateData(payload, reportId);
  doc.render(data);

  const out = doc.getZip().generate({ type: "nodebuffer" });

  const outName = `callout_${safeBasename(reportId)}.docx`;
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
      createdAt: payload?.createdAt || new Date().toISOString(),
      createdDate: String(payload?.createdAt || new Date().toISOString()).slice(0, 10),
      owner: resolvedOwner,
      ownerEmail,
      by: ownerEmail || "",
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

  // Poll loop
  // (Same model as servicingWorker; simple and robust)
  // One job per tick
  setInterval(async () => {
    const jobs = await listQueuedJobs();
    if (!jobs.length) return;

    try {
      await processOneJob(jobs[0]);
    } catch {
      // swallow; status gets updated inside
    }
  }, 2000);
}

mainLoop().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("CallOut worker failed to start:", e);
  process.exit(1);
});