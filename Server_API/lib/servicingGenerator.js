const fs = require("fs");
const path = require("path");
const {
  monthStamp,
  reportRelativePath,
  resolveSectionForArea,
  resolveUnder,
  ensureDir: ensureReportDir
} = require("./reportStorage");

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

function formatExtraValue(extraVal) {
  if (extraVal == null) return "";
  if (Array.isArray(extraVal)) {
    return extraVal.map(formatExtraValue).filter(Boolean).join(", ");
  }
  if (extraVal && typeof extraVal === "object") {
    return Object.entries(extraVal)
      .map(([key, value]) => {
        const formatted = formatExtraValue(value);
        if (!formatted) return "";
        const label = String(key || "")
          .replace(/[_-]+/g, " ")
          .replace(/\b\w/g, (m) => m.toUpperCase());
        return `${label}: ${formatted}`;
      })
      .filter(Boolean)
      .join("; ");
  }
  return String(extraVal).trim();
}

function classifyResponseSection(standard) {
  const s = String(standard || "").trim().toUpperCase();
  if (!s || s === "GENERAL") return "general";
  if (
    s.includes("NFPA 2001") ||
    s.includes("NFPA 25") ||
    /SUPPRESSION|DELUGE|WATER\s*SPRAY|EXTINGUISH/.test(s)
  ) {
    return "suppression";
  }
  return "detection";
}

function buildServicingReportSections(responses, photoByField) {
  const detectionItems = [];
  const suppressionItems = [];
  const generalItems = [];
  const detailedFindings = [];
  const missingPhotos = [];

  (Array.isArray(responses) ? responses : []).forEach((r, idx) => {
    const standard = String(r?.standard || "").trim();
    const answer = String(r?.answer || "").trim().toUpperCase();
    const question = String(r?.question || "").trim();
    const section = classifyResponseSection(standard);
    const extra = formatExtraValue(r?.extra);

    const rawDefects = Array.isArray(r?.defectEntries)
      ? r.defectEntries
      : (Array.isArray(r?.defects) ? r.defects : []);

    const legacyPhotoField = String(r?.photoField || "").trim();
    const legacyPhotoPath = legacyPhotoField ? (photoByField?.[legacyPhotoField] || "") : "";

    const defects = rawDefects
      .map((defect, defectIndex) => {
        const photoField = String(defect?.photoField || "").trim();
        const mappedPhoto = photoField ? (photoByField?.[photoField] || "") : "";
        return {
          finding: String(defect?.finding || "").trim(),
          photoField,
          photo: mappedPhoto || (defectIndex === 0 ? legacyPhotoPath : "")
        };
      })
      .filter((defect) => defect.finding || defect.photoField || defect.photo);

    const firstPhotoPath = defects.find((defect) => defect.photo)?.photo || legacyPhotoPath;
    const needsPhoto = section === "general" ? answer === "YES" : answer === "FAIL";

    if (needsPhoto) {
      if (defects.length) {
        defects.forEach((defect, defectIndex) => {
          if (defect.photo) return;
          missingPhotos.push({
            index: idx + 1,
            defectIndex: defectIndex + 1,
            standard,
            question,
            photoField: defect.photoField
          });
        });
      } else if (!firstPhotoPath) {
        missingPhotos.push({
          index: idx + 1,
          standard,
          question,
          photoField: legacyPhotoField
        });
      }
    }

    if (section === "general") {
      const generalNo =
        generalItems.reduce((max, item) => Math.max(max, Number(item.no) || 0), 0) + 1;

      if (defects.length) {
        defects.forEach((defect, defectIndex) => {
          const photo = defect.photo || (defectIndex === 0 ? firstPhotoPath : "");
          generalItems.push({
            no: generalNo,
            question,
            answer,
            comment: defect.finding || String(r?.comment || "").trim(),
            generalPhoto: photo,
            "%generalPhoto": photo
          });
        });
      } else {
        generalItems.push({
          no: generalNo,
          question,
          answer,
          comment: String(r?.comment || "").trim(),
          generalPhoto: firstPhotoPath,
          "%generalPhoto": firstPhotoPath
        });
      }
      return;
    }

    const target = section === "suppression" ? suppressionItems : detectionItems;
    const sectionLabel = section === "suppression" ? "Suppression" : "Detection";
    const sectionNo = target.length + 1;

    target.push({
      no: sectionNo,
      question,
      answer,
      extra
    });

    if (defects.length) {
      defects.forEach((defect, defectIndex) => {
        const photo = defect.photo || (defectIndex === 0 ? firstPhotoPath : "");
        detailedFindings.push({
          findingPhoto: photo,
          "%findingPhoto": photo,
          relatedItem: `${sectionLabel} ${sectionNo}: ${question}`,
          comment: defect.finding || String(r?.comment || "").trim()
        });
      });
    } else if (needsPhoto && firstPhotoPath) {
      detailedFindings.push({
        findingPhoto: firstPhotoPath,
        "%findingPhoto": firstPhotoPath,
        relatedItem: `${sectionLabel} ${sectionNo}: ${question}`,
        comment: String(r?.comment || "").trim()
      });
    }
  });

  return {
    detectionItems,
    suppressionItems,
    generalItems,
    detailedFindings,
    missingPhotos
  };
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
  const {
    detectionItems,
    suppressionItems,
    generalItems,
    detailedFindings,
    missingPhotos
  } = buildServicingReportSections(responses, photoByField);

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
    detectionItems,
    suppressionItems,
    generalItems,
    detailedFindings,
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
      getSize: (img, tagValue, tagName) => {
        const p = String(tagValue || "").trim();
        const tag = String(tagName || "").trim().toLowerCase();
        const isSignature =
          tag.includes("signature") ||
          p.includes("/signatures/") ||
          p.includes("\\signatures\\") ||
          /signature_.*\.(png|jpe?g)$/i.test(p);
        const sigBoxW = 240;
        const sigBoxH = 90;

        let photoBoxW = cmToPx(3.2);
        let photoBoxH = cmToPx(4.0);
        if (tag.includes("generalphoto")) {
          photoBoxW = cmToPx(3.0);
          photoBoxH = cmToPx(3.0);
        } else if (tag.includes("findingphoto")) {
          photoBoxW = cmToPx(4.5);
          photoBoxH = cmToPx(3.8);
        }

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

        if (!p && !isSignature) return [1, 1];
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
  const sectionInfo = resolveSectionForArea(data.area);
  const reportMonth = monthStamp(data.createdAt || payload?.dateCreated || payload?.createdAt || createdIso);
  const relativePath = reportRelativePath(sectionInfo.section, reportMonth, generatedFileName).replace(/\\/g, "/");
  const generatedPath = resolveUnder(reportsDir, relativePath);
  if (!generatedPath) throw new Error("Invalid generated report path.");
  ensureReportDir(path.dirname(generatedPath));
  fs.writeFileSync(generatedPath, outBuf);

  if (typeof upsertReportMeta === "function") {
    upsertReportMeta(relativePath, {
      id: reportId,
      type: "SERVICING",
      fileName: generatedFileName,
      relativePath,
      section: sectionInfo.section,
      sectionMatch: sectionInfo.matched ? sectionInfo.reason : "missing",
      sectionMatchedArea: sectionInfo.matchedArea || "",
      reportMonth,
      area: data.area,
      service: data.service,
      technician: data.technician,
      createdAt: createdIso,
      createdDate: data.createdAt,
      signatureFile: signatureFileName,
      signaturePath,
      photos: savedPhotos || [],
      correctionOfReport: payload?.correctionOfReport || "",
      correctionReason: payload?.correctionReason || "",
      owner: resolvedOwner,
      ownerEmail,
      by: ownerEmail || user?.email || user?.id || "unknown"
    });
  }

  return {
    fileName: generatedFileName,
    relativePath,
    section: sectionInfo.section,
    reportMonth,
    url: `/api/servicing/download?path=${encodeURIComponent(relativePath)}`,
    signatureFileName,
    signaturePath
  };
}

module.exports = { generateServicingDocx };
