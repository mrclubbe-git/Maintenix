const express = require("express");
const fs = require("fs");
const path = require("path");

const { getSession, extractBearer } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");
const { loadAreaSections } = require("../lib/reportStorage");
const { ensurePendingAreaMetadata, normalizeAreaKey } = require("../lib/areaMetadata");
const { notifySafe } = require("../lib/notificationService");

const router = express.Router();
const AREAS_TXT = path.join(__dirname, "..", "data", "templates", "areas.txt");
const MAX_AREA_LENGTH = 160;

function requireAuth(req, res, next) {\n  const token = extractBearer(req);

  const session = token ? getSession(token) : null;
  if (!session?.userId) return res.status(401).json({ ok: false, message: "Not logged in." });

  const user = getUsers().find((u) => u.id === session.userId) || null;
  if (!user) return res.status(401).json({ ok: false, message: "Not logged in." });

  req.user = user;
  next();
}

function cleanAreaName(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_AREA_LENGTH);
}

function normalizeArea(value) {
  return cleanAreaName(String(value || "")).toLowerCase();
}

function parseAreas(raw) {
  return String(raw || "")
    .split(/\r?\n/g)
    .map((value) => String(value || "").trim())
    .filter((value) => value && !value.startsWith("#"));
}

function readAreasText() {
  try {
    return fs.readFileSync(AREAS_TXT, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function readAreas() {
  return parseAreas(readAreasText());
}

function writeAreasTextAtomic(contents) {
  fs.mkdirSync(path.dirname(AREAS_TXT), { recursive: true });

  const tmp = path.join(
    path.dirname(AREAS_TXT),
    `.${path.basename(AREAS_TXT)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  let fd = null;

  try {
    fd = fs.openSync(tmp, "wx", 0o600);
    fs.writeFileSync(fd, contents, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, AREAS_TXT);
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Best-effort cleanup for an interrupted atomic write.
      }
    }
    if (fs.existsSync(tmp)) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // The original areas file remains intact if cleanup cannot run.
      }
    }
  }
}

function hasExactBaselineArea(area) {
  const key = normalizeArea(area);
  if (!key) return false;
  const loaded = loadAreaSections();
  return Boolean(loaded?.normalized?.[key]);
}

function registerNewAreaMetadata(area, actor) {
  if (hasExactBaselineArea(area)) {
    return {
      metadataStatus: "CONFIGURED",
      metadataSource: "BASELINE",
      adminNotificationCreated: false
    };
  }

  const pending = ensurePendingAreaMetadata(area, actor);
  let notification = null;

  if (pending?.created) {
    const key = normalizeAreaKey(area);
    notification = notifySafe("AREA_METADATA_REQUIRED", {
      actor,
      area,
      sourceEventId: `area:${key}`,
      idempotencyKey: `AREA_METADATA_REQUIRED:${key}`
    });
  }

  return {
    metadataStatus: pending?.record?.status || "PENDING",
    metadataSource: "RUNTIME",
    adminNotificationCreated: Boolean(notification?.id)
  };
}

function addArea(value, options = {}) {
  const area = cleanAreaName(value);
  if (!area) {
    return { ok: false, status: 400, message: "Area name is required." };
  }

  const source = readAreasText();
  const areas = parseAreas(source);
  const existing = areas.find((candidate) => normalizeArea(candidate) === normalizeArea(area));

  if (existing) {
    return { ok: true, area: existing, areas, created: false };
  }

  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const separator = source && !source.endsWith("\n") ? newline : "";
  writeAreasTextAtomic(`${source}${separator}${area}${newline}`);

  let metadata = {
    metadataStatus: "PENDING",
    metadataSource: "RUNTIME",
    adminNotificationCreated: false
  };

  try {
    metadata = registerNewAreaMetadata(area, options?.actor || null);
  } catch (error) {
    // Area creation must remain available even if metadata follow-up fails.
    console.error("Area metadata registration failed:", error?.message || error);
  }

  return {
    ok: true,
    area,
    areas: [...areas, area],
    created: true,
    ...metadata
  };
}

router.get("/", requireAuth, (_req, res) => {
  try {
    return res.json({ ok: true, areas: readAreas() });
  } catch (error) {
    return res.status(500).json({ ok: false, message: String(error?.message || "Failed to read areas.") });
  }
});

router.post("/", requireAuth, (req, res) => {
  try {
    const result = addArea(req.body?.area, { actor: req.user });
    if (!result.ok) return res.status(result.status || 400).json(result);
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: String(error?.message || "Failed to add area.") });
  }
});

// Servicing imports these helpers so both endpoints have one canonical source
// and exactly the same normalization, duplicate handling, and write process.
router.readAreas = readAreas;
router.addArea = addArea;

module.exports = router;
