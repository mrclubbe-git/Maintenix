const fs = require("fs");
const path = require("path");

// DOCX templating
let PizZip = null;
let Docxtemplater = null;
try {
  PizZip = require("pizzip");
  Docxtemplater = require("docxtemplater");
} catch {
  PizZip = null;
  Docxtemplater = null;
}

// Image module
let ImageModule = null;
try {
  ImageModule = require("docxtemplater-image-module-free");
} catch {
  ImageModule = null;
}

// Image dimension helper
let sizeOf = null;
try {
  sizeOf = require("image-size");
} catch {
  sizeOf = null;
}

const TRANSPARENT_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5cZKkAAAAASUVORK5CYII=";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function safeFilename(name) {
  return String(name || "")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

function normalizeDocxFileName(name) {
  const MAX = 120;
  let s = safeFilename(name).trim();
  if (!s) return "";
  if (s.toLowerCase().endsWith(".docx")) return s;
  if (s.length > MAX - 5) s = s.slice(0, MAX - 5);
  return `${s}.docx`;
}

function isoDateStamp(isoLike) {
  try {
    const d = isoLike ? new Date(isoLike) : new Date();
    if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    return d.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
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

function buildDeterministicReportFileName(payload, reportId, createdAtIso) {
  const preferred = String(payload?.serverFileName || payload?.desiredFileName || "").trim();
  if (preferred) return normalizeDocxFileName(preferred);

  const area = safeFilename(payload?.area || "Area");
  const service = safeFilename(payload?.service || payload?.serviceType || "Service");
  const dateCreated = isoDateStamp(payload?.dateCreated || payload?.createdAt || createdAtIso);
  const svcSource = payload?.svcNumber || payload?.srvNumber || payload?.reportId || reportId;
  const last4 = last4FromSvc(svcSource);

  return normalizeDocxFileName(`${area}_${service}_${dateCreated}_${last4}.docx`);
}

function parseDataUrlToBuffer(dataUrl) {
  const s = String(dataUrl || "").trim();
  const m = s.match(/^data:image\/(png|jpe?g);base64,([\s\S]+)$/i);
  if (!m || !m[2]) return null;
  try {
    return Buffer.from(m[2], "base64");
  } catch {
    return null;
  }
}

function parseDataUrlInfo(dataUrl) {
  const s = String(dataUrl || "").trim();
  const m = s.match(/^data:image\/(png|jpeg|jpg);base64,/i);
  if (!m || !m[1]) return null;
  const t = String(m[1]).toLowerCase();
  if (t === "png") return { ext: ".png", mime: "png" };
  return { ext: ".jpg", mime: "jpg" };
}

function cmToPx(cm) {
  return Math.round((cm / 2.54) * 96);
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

async function generateServicingDocx(opts) {
  const {
    reportId,
    payload,
    user,
    templateDocx,
    reportsDir,
    reportPhotosDir,
    signaturesDir,
    reportsMeta,
    fileNameOverride,
    photoByField,
    savedPhotos,
    upsertReportMeta
  } = opts || {};

  if (!fs.existsSync(templateDocx)) throw new Error("Template DOCX not found on server.");
  if (!PizZip || !Docxtemplater) throw new Error("DOCX dependencies missing: 'pizzip' and 'docxtemplater'.");

  ensureDir(reportsDir);
  ensureDir(reportPhotosDir);
  ensureDir(signaturesDir);

  const responses = Array.isArray(payload?.responses) ? payload.responses : [];

  // Build items and enforce required photos
  const missingPhotos = [];
  const items = responses.map((r, idx) => {
    const extraVal = r?.extra;
    let extra = "";

    if (extraVal && typeof extraVal === "object") {
      if (Array.isArray(extraVal)) extra = extraVal.length ? JSON.stringify(extraVal) : "";
      else extra = Object.keys(extraVal).length ? JSON.stringify(extraVal) : "";
    } else if (typeof extraVal === "string") {
      extra = extraVal.trim();
    } else if (extraVal != null) {
      extra = String(extraVal);
    }

    const standard = String(r?.standard || "").trim();
    const answer = String(r?.answer || "").trim().toUpperCase();
    const isGeneral = standard.toLowerCase() === "general";

    const photoField = String(r?.photoField || "").trim();
    const photoPath = photoField ? (photoByField?.[photoField] || "") : "";

    const needsPhoto = isGeneral ? answer === "YES" : answer === "FAIL";
    if (needsPhoto && !photoPath) {
      missingPhotos.push({
        index: idx + 1,
        standard,
        question: String(r?.question || ""),
        photoField
      });
    }

    return {
      no: idx + 1,
      standard: r?.standard || "",
      question: r?.question || "",
      answer: r?.answer || "",
      comment: r?.comment || "",
      extra,
      photo: photoPath || "",
      "%photo": photoPath || ""
    };
  });

  if (missingPhotos.length) {
    const err = new Error("Missing required photos for one or more questions.");
    err.details = { missingPhotos };
    throw err;
  }

  // Date-only (but keep a full ISO for metadata)
  const rawCreated = String(payload?.createdAt || "").trim();
  const createdIso = rawCreated.includes("T") ? rawCreated : new Date().toISOString();
  const createdDateOnly = createdIso.slice(0, 10);

  // Signature handling (PNG only)
  const signatureDataUrlRaw = String(payload?.signatureDataUrl || payload?.signature || "").trim();
  const sigInfo = parseDataUrlInfo(signatureDataUrlRaw);
  const sigBuf = sigInfo?.mime === "png" ? parseDataUrlToBuffer(signatureDataUrlRaw) : null;

  const signatureFileName = `signature_${safeFilename(reportId)}.png`;
  const signaturePath = path.join(signaturesDir, signatureFileName);
  fs.writeFileSync(signaturePath, sigBuf || Buffer.from(TRANSPARENT_PNG_B64, "base64"));

  const resolvedOwner =
    normalizeOwner(payload?.owner) ||
    normalizeOwner(user) ||
    normalizeOwner({
      email: payload?.ownerEmail || user?.email || "",
      name: payload?.technician || user?.name || "",
      role: user?.role || ""
    });

  const ownerEmail = pickNonEmpty(
    resolvedOwner?.email,
    payload?.ownerEmail,
    user?.email
  );

  const data = {
    reportId,
    area: payload?.area || "",
    service: payload?.service || "",
    frequencyKey: payload?.frequencyKey || "",
    standards: Array.isArray(payload?.standards) ? payload.standards.join(", ") : "",
    technician: payload?.technician || resolvedOwner?.name || resolvedOwner?.email || "",
    createdAt: createdDateOnly,
    items,
    photoCount: Array.isArray(savedPhotos) ? savedPhotos.length : 0,
    signature: signaturePath,
    "%signature": signaturePath,
    "%%signature": signaturePath
  };

  const templateBuf = fs.readFileSync(templateDocx);
  const zip = new PizZip(templateBuf);

  const options = {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "<<", end: ">>" },
    nullGetter: () => ""
  };

  const makeImageModule = () =>
    new ImageModule({
      centered: false,
      getImage: (tagValue) => {
        const p = String(tagValue || "").trim();
        if (!p) return Buffer.from(TRANSPARENT_PNG_B64, "base64");
        try {
          if (!fs.existsSync(p)) return Buffer.from(TRANSPARENT_PNG_B64, "base64");
          return fs.readFileSync(p);
        } catch {
          return Buffer.from(TRANSPARENT_PNG_B64, "base64");
        }
      },
      getSize: (img, tagValue) => {
        const p = String(tagValue || "").trim();
        const isSignature =
          p.includes("/signatures/") ||
          p.includes("\\signatures\\") ||
          /signature_.*\.(png|jpe?g)$/i.test(p);

        const photoBoxW = cmToPx(3.2);
        const photoBoxH = cmToPx(4.0);

        const sigBoxW = 240;
        const sigBoxH = 90;

        let w = 0;
        let h = 0;
        if (sizeOf) {
          try {
            const dim = sizeOf(img);
            w = Number(dim?.width || 0);
            h = Number(dim?.height || 0);
          } catch {
            w = 0;
            h = 0;
          }
        }

        if (!w || !h) return isSignature ? [sigBoxW, sigBoxH] : [photoBoxW, photoBoxH];

        const boxW = isSignature ? sigBoxW : photoBoxW;
        const boxH = isSignature ? sigBoxH : photoBoxH;

        const scale = Math.min(boxW / w, boxH / h);
        return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
      }
    });

  let doc = null;
  if (ImageModule) {
    try {
      doc = new Docxtemplater(zip, { ...options, modules: [makeImageModule()] });
    } catch {
      doc = new Docxtemplater(zip, options);
      if (typeof doc.attachModule === "function") doc.attachModule(makeImageModule());
    }
  } else {
    doc = new Docxtemplater(zip, options);
  }

  doc.render(data);

  const outBuf = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });

  /**
   * ✅ CRITICAL FIX:
   * If payload.serverFileName exists, we ALWAYS save using that name (sanitized),
   * so the file on disk is never "Service_Report_<reportId>.docx" unless no desired name exists.
   */
  const payloadPreferredRaw = String(payload?.serverFileName || payload?.desiredFileName || "").trim();
  const payloadPreferredName = payloadPreferredRaw ? normalizeDocxFileName(payloadPreferredRaw) : "";

  const deterministicName =
    payloadPreferredName || buildDeterministicReportFileName(payload, reportId, payload?.createdAt || createdIso);

  // Keep existing override support, but NEVER allow it to downgrade to Service_Report_ when we have a deterministic name.
  const overrideName = String(fileNameOverride || "").trim();
  const overrideNormalized = overrideName ? normalizeDocxFileName(overrideName) : "";

  const fallbackName = `Service_Report_${safeFilename(reportId)}.docx`;

  // Choose base name (existing behavior preserved), but force deterministic when available.
  let chosen =
    overrideNormalized ||
    deterministicName ||
    normalizeDocxFileName(fallbackName);

  // Safety: if chosen accidentally becomes empty, use fallback
  if (!chosen) chosen = normalizeDocxFileName(fallbackName);

  // Final guard: if chosen is the old Service_Report_ style but we DO have a deterministic name, force deterministic.
  if (/^Service_Report_/i.test(chosen) && deterministicName) {
    chosen = deterministicName;
  }

  const generatedFileName = chosen;
  const generatedPath = path.join(reportsDir, generatedFileName);
  fs.writeFileSync(generatedPath, outBuf);

  if (typeof upsertReportMeta === "function") {
    upsertReportMeta(generatedFileName, {
      id: reportId,
      type: "SERVICING",
      fileName: generatedFileName,
      area: data.area,
      service: data.service,
      technician: data.technician,
      createdAt: createdIso,
      createdDate: data.createdAt,
      signatureFile: signatureFileName,
      signaturePath,
      photos: savedPhotos || [],
      owner: resolvedOwner,
      ownerEmail,
      by: ownerEmail || user?.email || user?.id || "unknown"
    });
  }

  return {
    fileName: generatedFileName,
    url: `/api/servicing/download/${encodeURIComponent(generatedFileName)}`,
    signatureFileName,
    signaturePath
  };
}

module.exports = { generateServicingDocx };