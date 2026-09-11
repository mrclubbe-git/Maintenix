const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const TEMPLATES_DIR = path.join(DATA_DIR, "templates");
const AREA_SECTIONS_JSON = path.join(TEMPLATES_DIR, "area-sections.json");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJsonFile(p, fallback = null) {
  try {
    if (!fs.existsSync(p)) return fallback;
    const raw = fs.readFileSync(p, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function cleanSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeSegment(value, fallback = "Unmapped") {
  const s = cleanSpaces(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\s*-\s*/g, " - ")
    .replace(/-+/g, "-")
    .trim();
  return s || fallback;
}

function monthStamp(value, fallbackDate = new Date()) {
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  const d = raw ? new Date(raw) : fallbackDate;
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  const f = fallbackDate instanceof Date && !Number.isNaN(fallbackDate.getTime()) ? fallbackDate : new Date();
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeForMatch(value) {
  return cleanSpaces(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/handeling/g, "handling")
    .replace(/\bsubstation\b/g, "sub")
    .replace(/\bsubsation\b/g, "sub")
    .replace(/(?<=\d)\s*(kv|v)\b/g, "$1")
    .replace(/\b(11kv|3\.3kv|33kv|380v|525v|66kv)\b/g, " ")
    .replace(/\b[a-z]?\s*\d{3,4}\s*-?\s*g\s*\d{0,4}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(sub|room|plant|the|and|main)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function codePairFromText(value) {
  const s = String(value || "").toUpperCase();
  const m = s.match(/\b([A-Z])?\s*(\d{3,4})\s*-?\s*G\s*(\d{0,4})\b/);
  if (m) return { prefix: m[1] || "", first: String(m[2] || "").replace(/^0+/, "") || "0", second: String(m[3] || "").replace(/^0+/, "") || "0" };
  return null;
}

function codePairFromRecord(rec) {
  const firstRaw = String(rec?.first || "").trim().toUpperCase();
  const firstMatch = firstRaw.match(/([A-Z])?\s*(\d{3,4})/);
  const secondRaw = String(rec?.second || "").trim();
  const secondMatch = secondRaw.match(/(\d{3,4})/);
  if (!firstMatch && !secondMatch) return codePairFromText(rec?.area || rec?.baseArea || "");
  return {
    prefix: firstMatch?.[1] || "",
    first: String(firstMatch?.[2] || "").replace(/^0+/, "") || "0",
    second: String(secondMatch?.[1] || "").replace(/^0+/, "") || "0"
  };
}

function tokenOverlap(a, b) {
  const aa = new Set(String(a || "").split(/\s+/).filter(Boolean));
  const bb = new Set(String(b || "").split(/\s+/).filter(Boolean));
  let n = 0;
  for (const x of aa) if (bb.has(x)) n++;
  return n;
}

function loadAreaSections(filePath = AREA_SECTIONS_JSON) {
  const data = readJsonFile(filePath, { areaToSection: {}, areas: [] });
  const direct = data?.areaToSection && typeof data.areaToSection === "object" ? data.areaToSection : {};
  const normalized = {};
  for (const [area, section] of Object.entries(direct)) {
    normalized[cleanSpaces(area).toLowerCase()] = cleanSpaces(section);
  }
  const records = Array.isArray(data?.areas)
    ? data.areas.map((rec) => {
        const area = cleanSpaces(rec.area || "");
        const baseArea = cleanSpaces(rec.baseArea || area);
        return {
          ...rec,
          area,
          baseArea,
          section: cleanSpaces(rec.section || "Unmapped"),
          normArea: normalizeForMatch(area),
          normBaseArea: normalizeForMatch(baseArea),
          code: codePairFromRecord(rec)
        };
      })
    : [];
  return { data, direct, normalized, records };
}

function resolveSectionForArea(area, opts = {}) {
  const cleaned = cleanSpaces(area);
  const fallback = opts.fallback || "Unmapped";
  if (!cleaned) return { section: fallback, matched: false, reason: "missing_area" };

  const loaded = opts.loaded || loadAreaSections(opts.filePath);
  const exact = loaded.direct[cleaned];
  if (exact) return { section: cleanSpaces(exact), matched: true, reason: "exact" };

  const normalizedExact = loaded.normalized[cleaned.toLowerCase()];
  if (normalizedExact) return { section: normalizedExact, matched: true, reason: "normalized" };

  const targetNorm = normalizeForMatch(cleaned);
  const targetCode = codePairFromText(cleaned);
  let best = null;

  for (const rec of loaded.records || []) {
    let score = 0;
    let reason = "fuzzy";
    const recCode = rec.code;
    if (targetCode && recCode) {
      if (targetCode.first === recCode.first && targetCode.second === recCode.second) {
        score += 80;
        reason = "code";
        if (targetCode.prefix && recCode.prefix && targetCode.prefix === recCode.prefix) score += 10;
      } else if (targetCode.second && targetCode.second === recCode.second) {
        score += 35;
      }
    }

    const overlap = Math.max(tokenOverlap(targetNorm, rec.normArea), tokenOverlap(targetNorm, rec.normBaseArea));
    score += Math.min(30, overlap * 10);
    if (targetNorm && (targetNorm === rec.normArea || targetNorm === rec.normBaseArea)) {
      score += 70;
      reason = reason === "code" ? "code_text" : "text_exact";
    } else if (targetNorm && (rec.normArea.includes(targetNorm) || targetNorm.includes(rec.normArea) || rec.normBaseArea.includes(targetNorm) || targetNorm.includes(rec.normBaseArea))) {
      score += 35;
      reason = reason === "code" ? "code_text" : "text";
    }

    if (!best || score > best.score) best = { score, rec, reason };
  }

  if (best && best.score >= 70) {
    return { section: best.rec.section, matched: true, reason: best.reason, score: best.score, matchedArea: best.rec.area };
  }

  return { section: fallback, matched: false, reason: "not_found", score: best?.score || 0, matchedArea: best?.rec?.area || "" };
}

function safeRelativePath(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw || raw.includes("\0")) return null;
  const parts = raw.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === "." || p === "..")) return null;
  return parts.join("/");
}

function resolveUnder(root, rel) {
  const safeRel = safeRelativePath(rel);
  if (!safeRel) return null;
  const rootResolved = path.resolve(root);
  const full = path.resolve(rootResolved, safeRel);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) return null;
  return full;
}

function reportRelativeDir(section, month) {
  const safeMonth = sanitizeSegment(month, "Unknown-Month").replace(/\s+-\s+/g, "-");
  return path.join(sanitizeSegment(section, "Unmapped"), safeMonth);
}

function reportRelativePath(section, month, fileName) {
  return path.join(reportRelativeDir(section, month), path.basename(String(fileName || "")));
}

function listFilesRecursive(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile()) out.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  };
  walk(root);
  return out;
}

module.exports = {
  AREA_SECTIONS_JSON,
  ensureDir,
  cleanSpaces,
  sanitizeSegment,
  monthStamp,
  loadAreaSections,
  resolveSectionForArea,
  safeRelativePath,
  resolveUnder,
  reportRelativeDir,
  reportRelativePath,
  listFilesRecursive
};
