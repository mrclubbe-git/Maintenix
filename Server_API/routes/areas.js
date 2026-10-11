const express = require("express");
const fs = require("fs");
const path = require("path");

const { getSession, extractBearer } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");

const router = express.Router();
const AREAS_TXT = path.join(__dirname, "..", "data", "templates", "areas.txt");

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

function readAreas() {
  try {
    return fs
      .readFileSync(AREAS_TXT, "utf8")
      .split(/\r?\n/g)
      .map((value) => String(value || "").trim())
      .filter((value) => value && !value.startsWith("#"));
  } catch {
    return [];
  }
}

function normalizeArea(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanAreaName(value) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function writeAreas(areas) {
  fs.mkdirSync(path.dirname(AREAS_TXT), { recursive: true });
  const tmp = `${AREAS_TXT}.tmp`;
  fs.writeFileSync(tmp, areas.length ? `${areas.join("\n")}\n` : "", "utf8");
  fs.renameSync(tmp, AREAS_TXT);
}

router.get("/", requireAuth, (_req, res) => {
  return res.json({ ok: true, areas: readAreas() });
});

router.post("/", requireAuth, (req, res) => {
  try {
    const area = cleanAreaName(req.body?.area);
    if (!area) return res.status(400).json({ ok: false, message: "Area name is required." });

    const areas = readAreas();
    const wanted = normalizeArea(area);
    const existing = areas.find((value) => normalizeArea(value) === wanted);

    if (existing) {
      return res.json({ ok: true, area: existing, areas, created: false });
    }

    const updated = [...areas, area];
    writeAreas(updated);

    return res.status(201).json({
      ok: true,
      area,
      areas: updated,
      created: true
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      message: String(e?.message || "Failed to add area.")
    });
  }
});

module.exports = router;
