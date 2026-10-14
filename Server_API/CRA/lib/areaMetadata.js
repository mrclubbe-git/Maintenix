const fs = require("fs");
const path = require("path");

const { acquireLockSync, writeJsonAtomicSync } = require("./lockedJson");

const DATA_FILE =
  process.env.MAINTENIX_AREA_METADATA_FILE ||
  path.join(__dirname, "..", "data", "area-metadata.json");
const LOCK_FILE = `${DATA_FILE}.lock`;
const MAX_AREA_LENGTH = 160;
const MAX_SECTION_LENGTH = 120;
const MAX_CODE_LENGTH = 40;

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value, maxLength = 200) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeAreaKey(value) {
  return cleanText(value, MAX_AREA_LENGTH).toLowerCase();
}

function emptyDb() {
  return { version: 1, areas: [] };
}

function actorFields(actor) {
  return {
    userId: cleanText(actor?.id, 120),
    email: cleanText(actor?.email, 200).toLowerCase(),
    name: cleanText(actor?.name || actor?.email || actor?.id, 200)
  };
}

function normalizeRecord(input) {
  const area = cleanText(input?.area, MAX_AREA_LENGTH);
  const section = cleanText(input?.section, MAX_SECTION_LENGTH);
  const status =
    String(input?.status || "").trim().toUpperCase() === "CONFIGURED" && section
      ? "CONFIGURED"
      : "PENDING";

  const updatedBy =
    input?.updatedBy && typeof input.updatedBy === "object"
      ? actorFields(input.updatedBy)
      : null;

  return {
    area,
    status,
    section: status === "CONFIGURED" ? section : "",
    baseArea: cleanText(input?.baseArea, MAX_AREA_LENGTH),
    first: cleanText(input?.first, MAX_CODE_LENGTH),
    second: cleanText(input?.second, MAX_CODE_LENGTH),
    createdAt: input?.createdAt || nowIso(),
    createdByUserId: cleanText(input?.createdByUserId, 120),
    createdByEmail: cleanText(input?.createdByEmail, 200).toLowerCase(),
    createdByName: cleanText(input?.createdByName, 200),
    updatedAt: input?.updatedAt || null,
    updatedBy
  };
}

function normalizeDb(input) {
  const deduped = new Map();
  const source = Array.isArray(input?.areas) ? input.areas : [];

  for (const item of source) {
    const record = normalizeRecord(item);
    const key = normalizeAreaKey(record.area);
    if (!key) continue;
    deduped.set(key, record);
  }

  return {
    version: 1,
    areas: Array.from(deduped.values())
  };
}

function ensureDataFileUnlocked() {
  if (fs.existsSync(DATA_FILE)) return;
  writeJsonAtomicSync(DATA_FILE, emptyDb());
}

function readDbUnlocked() {
  ensureDataFileUnlocked();

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
    if (!raw) return emptyDb();
    return normalizeDb(JSON.parse(raw));
  } catch {
    const backup = DATA_FILE.replace(/\.json$/i, `.corrupt.${Date.now()}.json`);
    try {
      fs.copyFileSync(DATA_FILE, backup);
    } catch {}

    const clean = emptyDb();
    writeJsonAtomicSync(DATA_FILE, clean);
    return clean;
  }
}

function writeDbUnlocked(db) {
  writeJsonAtomicSync(DATA_FILE, normalizeDb(db));
}

function listAreaMetadata() {
  const release = acquireLockSync(LOCK_FILE);
  try {
    return readDbUnlocked().areas.map((record) => ({ ...record }));
  } finally {
    release();
  }
}

function getAreaMetadata(area) {
  const key = normalizeAreaKey(area);
  if (!key) return null;

  const release = acquireLockSync(LOCK_FILE);
  try {
    const record = readDbUnlocked().areas.find(
      (item) => normalizeAreaKey(item.area) === key
    );
    return record ? { ...record } : null;
  } finally {
    release();
  }
}

function ensurePendingAreaMetadata(area, actor = null) {
  const cleanArea = cleanText(area, MAX_AREA_LENGTH);
  const key = normalizeAreaKey(cleanArea);
  if (!key) return { record: null, created: false };

  const release = acquireLockSync(LOCK_FILE);
  try {
    const db = readDbUnlocked();
    const existingIndex = db.areas.findIndex(
      (item) => normalizeAreaKey(item.area) === key
    );

    if (existingIndex >= 0) {
      return { record: { ...db.areas[existingIndex] }, created: false };
    }

    const createdBy = actorFields(actor || {});
    const record = normalizeRecord({
      area: cleanArea,
      status: "PENDING",
      section: "",
      baseArea: "",
      first: "",
      second: "",
      createdAt: nowIso(),
      createdByUserId: createdBy.userId,
      createdByEmail: createdBy.email,
      createdByName: createdBy.name,
      updatedAt: null,
      updatedBy: null
    });

    db.areas.push(record);
    writeDbUnlocked(db);
    return { record: { ...record }, created: true };
  } finally {
    release();
  }
}

function configureAreaMetadata(area, patch = {}, actor = null) {
  const cleanArea = cleanText(area, MAX_AREA_LENGTH);
  const key = normalizeAreaKey(cleanArea);
  const section = cleanText(patch?.section, MAX_SECTION_LENGTH);
  if (!key || !section) return null;

  const release = acquireLockSync(LOCK_FILE);
  try {
    const db = readDbUnlocked();
    const existingIndex = db.areas.findIndex(
      (item) => normalizeAreaKey(item.area) === key
    );
    const existing = existingIndex >= 0 ? db.areas[existingIndex] : null;
    const createdBy = existing
      ? {
          userId: existing.createdByUserId || "",
          email: existing.createdByEmail || "",
          name: existing.createdByName || ""
        }
      : actorFields(actor || {});

    const record = normalizeRecord({
      area: cleanArea,
      status: "CONFIGURED",
      section,
      baseArea: patch?.baseArea,
      first: patch?.first,
      second: patch?.second,
      createdAt: existing?.createdAt || nowIso(),
      createdByUserId: createdBy.userId,
      createdByEmail: createdBy.email,
      createdByName: createdBy.name,
      updatedAt: nowIso(),
      updatedBy: actorFields(actor || {})
    });

    if (existingIndex >= 0) db.areas[existingIndex] = record;
    else db.areas.push(record);

    writeDbUnlocked(db);
    return { ...record };
  } finally {
    release();
  }
}

module.exports = {
  DATA_FILE,
  normalizeAreaKey,
  listAreaMetadata,
  getAreaMetadata,
  ensurePendingAreaMetadata,
  configureAreaMetadata
};
