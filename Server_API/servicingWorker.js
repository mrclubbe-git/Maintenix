const fs = require("fs");
const path = require("path");

const { generateServicingDocx } = require("./lib/servicingGenerator");

// Same helper style as routes/servicing.js
const DATA_DIR = path.join(__dirname, "data");
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

function writeStatus(userKey, reportId, patch) {
  const p = path.join(SERVICING_STATUS_DIR, userKey, `${reportId}.json`);
  const existing = fs.existsSync(p) ? readJsonFile(p, {}) : {};
  const next = { ...existing, ...patch, reportId, userKey, updatedAt: new Date().toISOString() };
  writeJsonFileAtomic(p, next);
}

function findNextJobFile() {
  if (!fs.existsSync(SERVICING_QUEUE_DIR)) return null;

  // Find the oldest job file by mtime
  let best = null;

  const walk = (dir) => {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) walk(p);
      else if (it.isFile() && it.name.endsWith(".job")) {
        const st = fs.statSync(p);
        if (!best || st.mtimeMs < best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs };
      }
    }
  };

  walk(SERVICING_QUEUE_DIR);
  return best ? best.path : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeDocxName(name) {
  const s = String(name || "").trim();
  if (!s) return null;
  return s.toLowerCase().endsWith(".docx") ? s : `${s}.docx`;
}

function buildDownloadUrl(fileName) {
  return `/api/servicing/download/${encodeURIComponent(fileName)}`;
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

async function processOne(jobFile) {
  const job = readJsonFile(jobFile, null);
  if (!job?.userKey || !job?.reportId) {
    // bad job file
    try {
      fs.unlinkSync(jobFile);
    } catch {}
    return;
  }

  const userKey = String(job.userKey);
  const reportId = String(job.reportId);

  const payloadPath = path.join(SERVICING_PAYLOADS_DIR, userKey, `${reportId}.json`);
  if (!fs.existsSync(payloadPath)) {
    // payload missing → remove job and mark error status
    writeStatus(userKey, reportId, { status: "error", error: "Payload file missing on server." });
    try {
      fs.unlinkSync(jobFile);
    } catch {}
    return;
  }

  const stored = readJsonFile(payloadPath, null);
  if (!stored?.payload) {
    writeStatus(userKey, reportId, { status: "error", error: "Payload JSON invalid." });
    try {
      fs.unlinkSync(jobFile);
    } catch {}
    return;
  }

  const resolvedOwner =
    normalizeOwner(stored?.owner) ||
    normalizeOwner(stored?.payload?.owner) ||
    normalizeOwner({
      email: stored?.ownerEmail || stored?.payload?.ownerEmail || stored?.payload?.by || "",
      name: stored?.payload?.technician || "",
      role: ""
    });

  const ownerEmail =
    pickNonEmpty(
      resolvedOwner?.email,
      stored?.ownerEmail,
      stored?.payload?.ownerEmail,
      stored?.payload?.by
    ) || "";

  // mark running
  writeStatus(userKey, reportId, {
    status: "running",
    startedAt: new Date().toISOString(),
    error: "",
    owner: resolvedOwner,
    ownerEmail
  });
  stored.status = "running";
  stored.owner = resolvedOwner || stored.owner || null;
  stored.ownerEmail = ownerEmail;
  if (stored.payload && typeof stored.payload === "object") {
    stored.payload.owner = resolvedOwner || stored.payload.owner || null;
    stored.payload.ownerEmail = ownerEmail;
  }
  writeJsonFileAtomic(payloadPath, stored);

  try {
    // ✅ Preferred deterministic name stored in payload by the server route:
    //    serverFileName -> desiredFileName -> legacy fileNameOverride
    const desired =
      stored?.payload?.serverFileName ||
      stored?.payload?.desiredFileName ||
      stored?.fileNameOverride ||
      null;

    const expectedName = normalizeDocxName(desired);

    // Build meta upsert function inline (same behavior as your route)
    const reportsMeta = stored.reportsMeta;
    const upsertReportMeta = (fileName, fields) => {
      const readReportsMetaCompat = () => {
        try {
          if (!fs.existsSync(reportsMeta)) return { reports: {} };
          const raw = fs.readFileSync(reportsMeta, "utf8").trim();
          if (!raw) return { reports: {} };
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.reports) return parsed;
          return { reports: {} };
        } catch {
          return { reports: {} };
        }
      };

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

      writeJsonFileAtomic(reportsMeta, meta);
    };

    const { fileName, url } = await generateServicingDocx({
      reportId,
      payload: {
        ...stored.payload,
        owner: resolvedOwner,
        ownerEmail
      },
      user: resolvedOwner || { email: ownerEmail },
      templateDocx: stored.templateDocx,
      reportsDir: stored.reportsDir,
      reportPhotosDir: stored.reportPhotosDir,
      signaturesDir: stored.signaturesDir,
      reportsMeta: stored.reportsMeta,
      fileNameOverride: expectedName || undefined,
      photoByField: stored.photoByField || {},
      savedPhotos: stored.photos || [],
      upsertReportMeta: (fileNameArg, fields) =>
        upsertReportMeta(fileNameArg, {
          ...fields,
          owner: resolvedOwner,
          ownerEmail,
          by: ownerEmail || fields?.by || ""
        })
    });

    // ✅ REQUIRED FIX (without removing anything):
    // If generator still returned a fallback name, but we have an expected deterministic name,
    // rename the output file on disk and update status result accordingly.
    let finalFileName = fileName;
    let finalUrl = url;

    if (expectedName && fileName && expectedName !== fileName) {
      try {
        const fromPath = path.join(stored.reportsDir, fileName);
        const toPath = path.join(stored.reportsDir, expectedName);

        if (fs.existsSync(fromPath) && !fs.existsSync(toPath)) {
          fs.renameSync(fromPath, toPath);
        }

        // Also migrate the meta key if needed (best-effort)
        try {
          if (stored.reportsMeta && fs.existsSync(stored.reportsMeta)) {
            const meta = readJsonFile(stored.reportsMeta, { reports: {} });
            if (
              meta &&
              meta.reports &&
              meta.reports[fileName] &&
              !meta.reports[expectedName]
            ) {
              meta.reports[expectedName] = {
                ...meta.reports[fileName],
                owner:
                  normalizeOwner(meta.reports[fileName]?.owner) ||
                  resolvedOwner ||
                  undefined,
                ownerEmail:
                  pickNonEmpty(
                    meta.reports[fileName]?.ownerEmail,
                    resolvedOwner?.email,
                    ownerEmail,
                    meta.reports[fileName]?.by
                  ) || "",
                by:
                  pickNonEmpty(
                    meta.reports[fileName]?.by,
                    resolvedOwner?.email,
                    ownerEmail
                  ) || ""
              };
              delete meta.reports[fileName];
              writeJsonFileAtomic(stored.reportsMeta, meta);
            }
          }
        } catch {}

        finalFileName = expectedName;
        finalUrl = buildDownloadUrl(expectedName);
      } catch {
        // If rename fails, keep generator output as-is (no functionality removed)
        finalFileName = fileName;
        finalUrl = url;
      }
    }

    writeStatus(userKey, reportId, {
      status: "done",
      doneAt: new Date().toISOString(),
      result: { fileName: finalFileName, url: finalUrl },
      owner: resolvedOwner,
      ownerEmail,
      error: ""
    });

    // ✅ REQUIREMENT: remove payload JSON ONLY on success
    try {
      fs.unlinkSync(payloadPath);
    } catch {}

    // remove job file
    try {
      fs.unlinkSync(jobFile);
    } catch {}
  } catch (e) {
    const msg = String(e?.message || "Generate failed");
    const details = e?.details || null;

    writeStatus(userKey, reportId, {
      status: "error",
      error: msg,
      details,
      owner: resolvedOwner,
      ownerEmail,
      failedAt: new Date().toISOString()
    });

    // Keep payload for retry (do NOT delete), but remove job file so it doesn't spin forever
    try {
      fs.unlinkSync(jobFile);
    } catch {}
  }
}

async function main() {
  ensureDir(SERVICING_QUEUE_DIR);
  ensureDir(SERVICING_STATUS_DIR);
  ensureDir(SERVICING_PAYLOADS_DIR);

  // eslint-disable-next-line no-console
  console.log("Servicing worker started.");

  while (true) {
    const jobFile = findNextJobFile();
    if (!jobFile) {
      await sleep(1500);
      continue;
    }

    try {
      await processOne(jobFile);
    } catch {
      // avoid worker crash loop
      await sleep(500);
    }
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Servicing worker fatal:", e);
  process.exit(1);
});