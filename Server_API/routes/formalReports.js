"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { extractBearer, getSession } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");
const { updateJsonWithLockSync } = require("../lib/lockedJson");

const router = express.Router();
const DATA_DIR = path.join(__dirname, "..", "data");
const MODULE_DIR = path.join(__dirname, "..", "formal-reporting");
const SYSTEMS_FILE = path.join(DATA_DIR, "templates", "service-report-systems.json");
const WORKER_FILE = path.join(MODULE_DIR, "report_worker.py");
const TEMPLATES_DIR = path.join(DATA_DIR, "templates", "formal-reports");
const STATE_DIR = path.join(DATA_DIR, "formal-reporting");
const DRAFTS_DIR = path.join(STATE_DIR, "drafts");
const REPORTS_DIR = path.join(DATA_DIR, "uploads", "reports");
const DOCX_DIR = REPORTS_DIR;
const PDF_DIR = path.join(DATA_DIR, "uploads", "reports_pdf");
const REPORTS_META = path.join(DATA_DIR, "reports.meta.json");

function ensureDirs() {
  for (const dir of [DRAFTS_DIR, DOCX_DIR, PDF_DIR]) fs.mkdirSync(dir, { recursive: true });
}

function safeRole(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function requireAdmin(req, res, next) {
  let token = "";
  try { token = extractBearer(req); } catch {}
  const session = token ? getSession(token) : null;
  const user = session?.userId ? getUsers().find((entry) => entry.id === session.userId) : null;
  if (!user) return res.status(401).json({ ok: false, error: "Not logged in" });
  if (safeRole(user.role) !== "ADMIN") return res.status(403).json({ ok: false, error: "Admin only" });
  req.user = user;
  next();
}

router.use(requireAdmin);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonAtomic(filePath, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.renameSync(temporary, filePath);
}

function listFiles(directory, extension) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (!extension || entry.name.toLowerCase().endsWith(extension)))
    .map((entry) => {
      const stat = fs.statSync(path.join(directory, entry.name));
      return { name: entry.name, size: stat.size, modified: stat.mtime.toISOString() };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function sectionInventory() {
  const inventory = readJson(SYSTEMS_FILE);
  return (inventory.sections || []).map((entry) => ({
    name: String(entry.section || "").trim(),
    systemCount: Array.isArray(entry.systems) ? entry.systems.length : 0,
    systems: (entry.systems || []).map((system, index) => ({
      id: String(index + 1),
      name: String(system.system || "").trim(),
      f: system.f ?? null,
      g: system.g ?? null
    }))
  }));
}

function safeId(value) {
  const id = String(value || "").trim();
  return /^[a-z0-9][a-z0-9-]{5,120}$/.test(id) ? id : null;
}

function safeFileName(value) {
  const fileName = path.basename(String(value || ""));
  return fileName && fileName === String(value || "") && !fileName.includes("..") ? fileName : null;
}

function generationId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "z").toLowerCase();
}

function validateDraft(payload) {
  const section = sectionInventory().find((candidate) => candidate.name === payload?.section);
  if (!section) return "Unknown reporting section";
  if (!/^\d{4}-\d{2}$/.test(String(payload?.month || ""))) return "Month must use YYYY-MM";
  if (!Number.isInteger(payload?.week) || payload.week < 1 || payload.week > 53) return "Week must be 1–53";
  if (!Array.isArray(payload?.responses)) return "Responses must be an array";
  const validIds = new Set(section.systems.map((system) => system.id));
  for (const response of payload.responses) {
    if (!validIds.has(String(response.systemId))) return `Unknown system ${response.systemId}`;
    if (![null, "yes", "no"].includes(response.defectsFound ?? null)) return "Invalid defects response";
    if (response.defectsFound === "yes") {
      if (!Array.isArray(response.defects) || response.defects.length === 0) return "A Yes response requires a defect";
      for (const defect of response.defects) {
        if (!String(defect.finding || "").trim() || !String(defect.action || "").trim()) return "Each defect requires a finding and required action";
      }
    }
  }
  return null;
}

function runWorker(command, payload = null) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [WORKER_FILE, command], { cwd: MODULE_DIR, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch {}
      if (code !== 0) return reject(new Error(parsed?.error || stderr.trim() || `Worker exited ${code}`));
      if (!parsed) return reject(new Error("Worker returned invalid JSON"));
      resolve(parsed);
    });
    child.stdin.end(payload == null ? "" : JSON.stringify(payload));
  });
}

function outputUrls(output) {
  return {
    ...output,
    docxUrl: `/api/formal-reports/files/docx/${encodeURIComponent(output.docx)}`,
    pdfUrl: `/api/formal-reports/files/pdf/${encodeURIComponent(output.pdf)}`
  };
}

router.get("/health", async (req, res) => {
  try { return res.json({ ok: true, worker: await runWorker("health") }); }
  catch (error) { return res.status(500).json({ ok: false, error: error.message }); }
});

router.get("/sections", (req, res) => res.json({ ok: true, sections: sectionInventory() }));

router.post("/drafts", (req, res) => {
  ensureDirs();
  const error = validateDraft(req.body);
  if (error) return res.status(400).json({ ok: false, error });
  const id = safeId(req.body.id);
  if (!id) return res.status(400).json({ ok: false, error: "Invalid draft ID" });
  const destination = path.join(DRAFTS_DIR, `${id}.json`);
  const existing = fs.existsSync(destination) ? readJson(destination) : {};
  const defaultName = `${req.body.section} · ${req.body.month} · Week ${req.body.week}`;
  const saved = { ...req.body, id, name: existing.name || defaultName, savedAt: new Date().toISOString(), savedBy: req.user.id, version: 1 };
  writeJsonAtomic(destination, saved);
  res.json({ ok: true, draft: saved });
});

router.get("/drafts", (req, res) => {
  ensureDirs();
  const drafts = listFiles(DRAFTS_DIR, ".json")
    .map((file) => readJson(path.join(DRAFTS_DIR, file.name)))
    .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")))
    .map((draft) => ({
      id: draft.id,
      name: String(draft.name || "").trim(),
      section: draft.section,
      month: draft.month,
      week: draft.week,
      compiledName: draft.compiledName,
      savedAt: draft.savedAt
    }));
  res.json({ ok: true, drafts });
});

router.get("/drafts/:id", (req, res) => {
  const id = safeId(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "Invalid draft ID" });
  const source = path.join(DRAFTS_DIR, `${id}.json`);
  if (!fs.existsSync(source)) return res.status(404).json({ ok: false, error: "Draft not found" });
  res.json({ ok: true, draft: readJson(source) });
});

router.patch("/drafts/:id", (req, res) => {
  const id = safeId(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "Invalid draft ID" });
  const source = path.join(DRAFTS_DIR, `${id}.json`);
  if (!fs.existsSync(source)) return res.status(404).json({ ok: false, error: "Draft not found" });
  const name = String(req.body?.name || "").replace(/\s+/g, " ").trim();
  if (!name || name.length > 120) return res.status(400).json({ ok: false, error: "Draft name must be 1–120 characters" });
  const draft = { ...readJson(source), name, savedAt: new Date().toISOString(), savedBy: req.user.id };
  writeJsonAtomic(source, draft);
  res.json({ ok: true, draft });
});

router.delete("/drafts/:id", (req, res) => {
  const id = safeId(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: "Invalid draft ID" });
  const source = path.join(DRAFTS_DIR, `${id}.json`);
  if (!fs.existsSync(source)) return res.status(404).json({ ok: false, error: "Draft not found" });
  fs.unlinkSync(source);
  res.json({ ok: true });
});

router.post("/generate", async (req, res) => {
  ensureDirs();
  const payload = req.body || {};
  const error = validateDraft(payload);
  if (error) return res.status(400).json({ ok: false, error });
  const baseId = safeId(payload.id);
  if (!baseId) return res.status(400).json({ ok: false, error: "Invalid report ID" });
  if (!String(payload.compiledName || "").trim() || !String(payload.compiledDesignation || "").trim()) {
    return res.status(400).json({ ok: false, error: "Compiled By name and designation are required" });
  }
  if (payload.finalConfirmed !== true) return res.status(400).json({ ok: false, error: "Final report confirmation is required" });
  const section = sectionInventory().find((candidate) => candidate.name === payload.section);
  if (payload.responses.length !== section.systems.length || payload.responses.some((item) => !["yes", "no"].includes(item.defectsFound))) {
    return res.status(400).json({ ok: false, error: "Every system must be answered before report generation" });
  }
  try {
    const currentGenerationId = generationId();
    const generatedAt = new Date().toISOString();
    const result = await runWorker("generate", { ...payload, systems: section.systems, generationId: currentGenerationId });
    updateJsonWithLockSync(REPORTS_META, { reports: {} }, (meta) => {
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) meta = { reports: {} };
      if (!meta.reports || typeof meta.reports !== "object" || Array.isArray(meta.reports)) meta.reports = {};
      for (const output of result.outputs || []) {
        const fileName = String(output.docx || "");
        if (!fileName) continue;
        const existing = meta.reports[fileName] || {};
        meta.reports[fileName] = {
          ...existing,
          id: `${baseId}-${currentGenerationId}`,
          type: "SERVICE_REPORT",
          reportType: "SERVICE_REPORT",
          fileName,
          relativePath: fileName,
          section: payload.section,
          reportMonth: payload.month,
          area: payload.section,
          service: "Service Report",
          technician: payload.compiledName,
          createdAt: generatedAt,
          createdDate: generatedAt.slice(0, 10),
          owner: { id: req.user.id || "", email: req.user.email || "", name: req.user.name || payload.compiledName },
          ownerEmail: req.user.email || "",
          by: req.user.email || "",
          status: existing.status || "PENDING"
        };
      }
      return meta;
    });
    result.outputs = result.outputs.map(outputUrls);
    res.json(result);
  } catch (workerError) {
    console.error("Formal report generation failed:", workerError.message);
    res.status(500).json({ ok: false, error: workerError.message });
  }
});

router.get("/files/:type/:name", (req, res) => {
  const type = String(req.params.type || "").toLowerCase();
  const fileName = safeFileName(req.params.name);
  if (!fileName || !["docx", "pdf"].includes(type)) return res.status(400).json({ ok: false, error: "Invalid file" });
  const root = type === "docx" ? DOCX_DIR : PDF_DIR;
  const source = path.join(root, fileName);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return res.status(404).json({ ok: false, error: "File not found" });
  res.setHeader("Cache-Control", "no-store");
  res.download(source, fileName);
});

module.exports = router;
