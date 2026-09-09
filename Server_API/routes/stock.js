// /opt/maintenix-ui/server-api/routes/stock.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { getSession, extractBearer } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");

const router = express.Router();

const DATA_FILE = path.join(__dirname, "..", "data", "stock.json");

function safeRole(x) {
  return String(x || "").trim().toUpperCase().replace(/\s+/g, "");
}

function ensureFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ items: [], movements: [] }, null, 2), "utf8");
  }
}

function readDb() {
  ensureFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
  if (!raw) return { items: [], movements: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      movements: Array.isArray(parsed.movements) ? parsed.movements : []
    };
  } catch {
    const backup = DATA_FILE.replace(/\.json$/i, `.corrupt.${Date.now()}.json`);
    fs.copyFileSync(DATA_FILE, backup);
    fs.writeFileSync(DATA_FILE, JSON.stringify({ items: [], movements: [] }, null, 2), "utf8");
    return { items: [], movements: [] };
  }
}

function writeDb(db) {
  ensureFile();
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

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

function canEditStock(role) {
  const r = safeRole(role);
  return r === "ADMIN" || r === "L2" || r === "LEVEL2" || r === "LEVEL_2";
}

function canAdmin(role) {
  return safeRole(role) === "ADMIN";
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function canAddItem(role) {
  const r = safeRole(role);
  // Allow any application level user to add new stock items
  return (
    r === "ADMIN" ||
    r === "L1" ||
    r === "L2" ||
    r === "L3" ||
    r === "LEVEL1" ||
    r === "LEVEL2" ||
    r === "LEVEL3" ||
    r === "LEVEL_1" ||
    r === "LEVEL_2" ||
    r === "LEVEL_3"
  );
}

function canChangeQty(role) { // receive / issue
  const r = safeRole(role);
  return r === "ADMIN" || r === "L1" || r === "L2" || r === "L3";
}

function canEditMetadata(role) { // name, unit, location, minQty
  const r = safeRole(role);
  return r === "ADMIN" || r === "L3";   // (since L3 “all stock functions” except delete)
}

function canDownloadCsv(role) {
  const r = safeRole(role);
  return r === "ADMIN" || r === "L2" || r === "L3";
}

function canDeleteItem(role) {
  const r = safeRole(role);
  return r === "ADMIN";                 // L3 explicitly cannot delete
}

// helper: create a stable-ish code if no SKU is provided
function makeCodeFromName(name) {
  const base = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  return `${base || "item"}-${crypto.randomBytes(3).toString("hex")}`;
}

/**
 * Delete movement helper
 */
function clearAllMovements() {
  const db = readDb();
  db.movements = [];
  writeDb(db);
  return { ok: true, cleared: true };
}

/**
 * GET /api/stock/items
 */
router.get("/items", requireAuth, (req, res) => {
  const db = readDb();
  res.json({ ok: true, items: db.items });
});

/**
 * POST /api/stock/items  (All levels can add)
 * Body: { name, unit(UOM), qty, minQty, location, sku? }
 * NOTE: sku is optional now; if not supplied, backend generates one.
 */
router.post("/items", requireAuth, (req, res) => {
  if (!canAddItem(req.user?.role)) return res.status(403).json({ ok: false, message: "Not allowed." });

  const name = String(req.body?.name || "").trim();
  const unit = String(req.body?.unit || "").trim() || "unit";
  const location = String(req.body?.location || "").trim() || "Main";

  const qty = Number(req.body?.qty ?? 0);
  const minQty = Number(req.body?.minQty ?? 0);

  // Optional sku (internal item code)
  let sku = String(req.body?.sku || "").trim();

  if (!name) return res.status(400).json({ ok: false, message: "name is required." });
  if (!Number.isFinite(qty) || qty < 0) return res.status(400).json({ ok: false, message: "qty must be >= 0." });
  if (!Number.isFinite(minQty) || minQty < 0) return res.status(400).json({ ok: false, message: "minQty must be >= 0." });

  const db = readDb();

  // Generate sku if missing
  if (!sku) sku = makeCodeFromName(name);

  // Enforce unique sku (internal)
  const exists = db.items.some((i) => String(i.sku || "").toLowerCase() === sku.toLowerCase());
  if (exists) return res.status(400).json({ ok: false, message: "Internal code already exists. Try again." });

  const now = new Date().toISOString();
  const item = {
    id: newId("stk"),
    sku, // internal code (hidden in UI for now)
    name,
    unit, // UOM
    location,
    qty,
    minQty,
    createdAt: now,
    updatedAt: now
  };

  db.items.push(item);
  writeDb(db);

  res.json({ ok: true, item });
});

/**
 * PATCH /api/stock/items/:id  (ADMIN or L2)
 * Body supports:
 *  - qty (absolute)
 *  - delta (relative)
 *  - name, unit, location, minQty (metadata edits)
 */
router.patch("/items/:id", requireAuth, (req, res) => {
  if (!canEditStock(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin/L2 only." });

  const id = String(req.params.id || "");
  const db = readDb();
  const idx = db.items.findIndex((i) => i.id === id);
  if (idx < 0) return res.status(404).json({ ok: false, message: "Item not found." });

  const now = new Date().toISOString();
  const item = db.items[idx];
  const patch = req.body || {};

  // qty change
  let newQty = item.qty;

  const hasQty = Object.prototype.hasOwnProperty.call(patch, "qty");
  const hasDelta = Object.prototype.hasOwnProperty.call(patch, "delta");

  if (hasQty) {
    const qty = Number(patch.qty);
    if (!Number.isFinite(qty) || qty < 0) return res.status(400).json({ ok: false, message: "qty must be >= 0." });
    newQty = qty;
  } else if (hasDelta) {
    const delta = Number(patch.delta);
    if (!Number.isFinite(delta)) return res.status(400).json({ ok: false, message: "delta must be a number." });
    newQty = Math.max(0, Number(item.qty || 0) + delta);
  }

  // metadata edits (optional)
  const nextName = Object.prototype.hasOwnProperty.call(patch, "name") ? String(patch.name || "").trim() : item.name;
  const nextUnit = Object.prototype.hasOwnProperty.call(patch, "unit") ? String(patch.unit || "").trim() : item.unit;
  const nextLoc = Object.prototype.hasOwnProperty.call(patch, "location")
    ? String(patch.location || "").trim()
    : item.location;

  let nextMin = item.minQty;
  if (Object.prototype.hasOwnProperty.call(patch, "minQty")) {
    const m = Number(patch.minQty);
    if (!Number.isFinite(m) || m < 0) return res.status(400).json({ ok: false, message: "minQty must be >= 0." });
    nextMin = m;
  }

  db.items[idx] = {
    ...item,
    name: nextName || item.name,
    unit: nextUnit || item.unit,
    location: nextLoc || item.location,
    minQty: nextMin,
    qty: newQty,
    updatedAt: now
  };

  // movement log only if qty changed
  const reason = String(patch?.reason || "").trim();
  if (hasQty || hasDelta) {
    db.movements.push({
      id: newId("mov"),
      itemId: id,
      by: req.user?.email || req.user?.id || "unknown",
      at: now,
      fromQty: Number(item.qty || 0),
      toQty: newQty,
      reason
    });
  }

  writeDb(db);
  res.json({ ok: true, item: db.items[idx] });
});

/**
 * DELETE /api/stock/items/:id (ADMIN only)
 * Deletes item, but logs a final movement "Item removed"
 */
router.delete("/items/:id", requireAuth, (req, res) => {
  if (!canAdmin(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin only." });

  const id = String(req.params.id || "");
  const db = readDb();

  const idx = db.items.findIndex((i) => i.id === id);
  if (idx < 0) return res.status(404).json({ ok: false, message: "Item not found." });

  const item = db.items[idx];
  const now = new Date().toISOString();

  // ✅ Log deletion as a movement (keep audit trail)
  db.movements.push({
    id: newId("mov"),
    itemId: id,
    by: req.user?.email || req.user?.id || "unknown",
    at: now,
    fromQty: Number(item.qty || 0),
    toQty: 0,
    reason: "Item removed",
    // Optional but recommended: keep context for UI after item is deleted
    itemName: item.name || "",
    sku: item.sku || ""
  });

  // ✅ Remove item only (do NOT delete movements)
  db.items = db.items.filter((i) => i.id !== id);

  writeDb(db);
  res.json({ ok: true });
});

/**
 * GET /api/stock/movements?itemId=...
 * Admin/L2 only
 */
router.get("/movements", requireAuth, (req, res) => {
  if (!canEditStock(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin/L2 only." });

  const itemId = String(req.query.itemId || "").trim();
  const db = readDb();

  let rows = db.movements || [];
  if (itemId) rows = rows.filter((m) => String(m.itemId || "") === itemId);

  // newest first
  rows = rows.slice().sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));

  res.json({ ok: true, movements: rows });
});

/**
 * DELETE /api/stock/movements (ADMIN only)
 * Clears ALL movement audit rows (does not affect items)
 */
router.delete("/movements", requireAuth, (req, res) => {
  if (!canAdmin(req.user?.role)) {
    return res.status(403).json({ ok: false, message: "Admin only." });
  }

  clearAllMovements();
  return res.json({ ok: true });
});

/**
 * POST /api/stock/move  (Admin/L2)
 * Body: { itemId, type: "RECEIVE"|"ISSUE"|"ADJUST", qty, reason? }
 * - RECEIVE: adds qty
 * - ISSUE: subtracts qty (floors at 0)
 * - ADJUST: sets qty to exact qty
 */
router.post("/move", requireAuth, (req, res) => {
  if (!canEditStock(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin/L2 only." });

  const itemId = String(req.body?.itemId || "").trim();
  const type = String(req.body?.type || "").trim().toUpperCase();
  const qty = Number(req.body?.qty);

  if (!itemId) return res.status(400).json({ ok: false, message: "itemId is required." });
  if (!["RECEIVE", "ISSUE", "ADJUST"].includes(type)) {
    return res.status(400).json({ ok: false, message: "type must be RECEIVE, ISSUE, or ADJUST." });
  }
  if (!Number.isFinite(qty) || qty < 0) return res.status(400).json({ ok: false, message: "qty must be >= 0." });

  const reason = String(req.body?.reason || "").trim();

  const db = readDb();
  const idx = db.items.findIndex((i) => i.id === itemId);
  if (idx < 0) return res.status(404).json({ ok: false, message: "Item not found." });

  const now = new Date().toISOString();
  const item = db.items[idx];
  const fromQty = Number(item.qty || 0);

  let toQty = fromQty;
  if (type === "RECEIVE") toQty = fromQty + qty;
  if (type === "ISSUE") toQty = Math.max(0, fromQty - qty);
  if (type === "ADJUST") toQty = qty;

  db.items[idx] = { ...item, qty: toQty, updatedAt: now };

  db.movements.push({
    id: newId("mov"),
    itemId,
    type,
    by: req.user?.email || req.user?.id || "unknown",
    at: now,
    fromQty,
    toQty,
    qty,
    reason
  });

  writeDb(db);

  res.json({ ok: true, item: db.items[idx] });
});

const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");

// Adjust these if your stock.js stores DB differently
const DATA_DIR = path.join(__dirname, "..", "data");
const TEMPLATE_FILE = path.join(DATA_DIR, "templates", "delivery_note_template.docx");
const OUT_DIR = path.join(DATA_DIR, "uploads", "delivery_notes");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function fmtDate(d = new Date()) {
  // YYYY-MM-DD
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtTime(d = new Date()) {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}-${mm}-${ss}`;
}

function canIssue(role) {
  const r = String(role || "").toUpperCase().trim();
  return r === "ADMIN" || r === "L2";
}

/**
 * POST /api/stock/issue-note  (Admin/L2)
 * Body:
 * {
 *   collectedBy: string,
 *   releasedBy: string,
 *   date?: "YYYY-MM-DD" (optional),
 *   lines: [{ itemId: string, qty: number }]
 * }
 *
 * - validates stock availability
 * - decrements stock
 * - logs movements
 * - generates Delivery Note DOCX using << >> template tags
 * - saves to /data/uploads/delivery_notes
 */
router.post("/issue-note", requireAuth, (req, res) => {
  if (!canIssue(req.user?.role)) return res.status(403).json({ ok: false, message: "Admin/L2 only." });

  const collectedBy = String(req.body?.collectedBy || "").trim();
  const releasedBy = String(req.body?.releasedBy || "").trim();
  const dateStr = String(req.body?.date || "").trim() || fmtDate(new Date());
  const linesIn = Array.isArray(req.body?.lines) ? req.body.lines : [];

  if (!collectedBy) return res.status(400).json({ ok: false, message: "collectedBy is required." });
  if (!releasedBy) return res.status(400).json({ ok: false, message: "releasedBy is required." });
  if (!linesIn.length) return res.status(400).json({ ok: false, message: "At least one line item is required." });

  if (!fs.existsSync(TEMPLATE_FILE)) {
    return res.status(500).json({
      ok: false,
      message: `Template missing: ${TEMPLATE_FILE}`
    });
  }

  // Normalize lines
  const lines = linesIn
    .map((x) => ({
      itemId: String(x?.itemId || "").trim(),
      qty: Number(x?.qty)
    }))
    .filter((x) => x.itemId && Number.isFinite(x.qty) && x.qty > 0);

  if (!lines.length) return res.status(400).json({ ok: false, message: "Lines must have itemId and qty > 0." });

  // Load DB
  const db = readDb();
  if (!Array.isArray(db.items)) db.items = [];
  if (!Array.isArray(db.movements)) db.movements = [];

  // Validate stock
  const errors = [];
  const resolved = lines
    .map((ln) => {
      const item = db.items.find((i) => i.id === ln.itemId);
      if (!item) {
        errors.push(`Item not found: ${ln.itemId}`);
        return null;
      }
      const onHand = Number(item.qty || 0);
      if (ln.qty > onHand) {
        errors.push(`Insufficient stock for "${item.name}": requested ${ln.qty}, available ${onHand}`);
        return null;
      }
      return { item, qty: ln.qty };
    })
    .filter(Boolean);

  if (errors.length) return res.status(400).json({ ok: false, message: errors.join(" | ") });

  // Apply stock changes + movement log
  const now = new Date();
  const nowIso = now.toISOString();

  resolved.forEach(({ item, qty }) => {
    const fromQty = Number(item.qty || 0);
    const toQty = fromQty - qty;

    item.qty = toQty;
    item.updatedAt = nowIso;

    db.movements.push({
      id: newId("mov"),
      itemId: item.id,
      type: "ISSUE",
      by: req.user?.email || req.user?.id || "unknown",
      at: nowIso,
      fromQty,
      toQty,
      qty,
      reason: `Delivery note issue: ${collectedBy} / ${releasedBy}`
    });
  });

  // Generate DOCX
  ensureDir(OUT_DIR);

  const noteNo = `DN_${fmtDate(now)}_${fmtTime(now)}`;
  const filename = `${noteNo}.docx`;
  const outPath = path.join(OUT_DIR, filename);

  try {
    const content = fs.readFileSync(TEMPLATE_FILE, "binary");
    const zip = new PizZip(content);

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: "<<", end: ">>" } // ✅ matches your template
    });

    // ✅ Keys with spaces MUST be quoted to match <<Collected By>> and <<Released By>>
    const templateData = {
      "Collected By": collectedBy,
      "Released By": releasedBy,
      "Date": dateStr,
      items: resolved.map(({ item, qty }, idx) => ({
        id: idx + 1,
        description: item.name || item.id,
        uom: item.unit || "",
        qty: qty
      }))
    };

    doc.render(templateData);

    const buf = doc.getZip().generate({ type: "nodebuffer" });
    fs.writeFileSync(outPath, buf);

    // Persist DB after successful doc generation
    writeDb(db);

    return res.json({
      ok: true,
      noteNo,
      filename,
      url: `/uploads/delivery_notes/${encodeURIComponent(filename)}`
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      message: `DOCX generation failed: ${e?.message || "unknown error"}`
    });
  }
});

module.exports = router;
