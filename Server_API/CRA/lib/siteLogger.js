"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const LOG_DIR = process.env.SITE_LOG_DIR
  ? path.resolve(process.env.SITE_LOG_DIR)
  : path.join(__dirname, "..", "data", "site-logs");
const RETENTION_DAYS = Math.max(7, Number(process.env.SITE_LOG_RETENTION_DAYS || 30));
const LEVELS = new Set(["INFO", "WARN", "ERROR", "CRITICAL"]);
const MAX_MESSAGE = 1000;
const MAX_DETAIL_TEXT = 2000;
const MAX_DEPTH = 4;
const SENSITIVE_KEY = /(password|passwd|secret|token|csrf|cookie|authorization|signature|private.?key|vapid|lease)/i;

let lastCleanupDay = "";

function ensureDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function isoDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function safeText(value, max = MAX_DETAIL_TEXT) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (typeof value === "string") return safeText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value !== "object") return safeText(value);

  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    const cleanKey = safeText(key, 120);
    output[cleanKey] = SENSITIVE_KEY.test(cleanKey) ? "[redacted]" : sanitize(item, depth + 1);
  }
  return output;
}

function cleanupOldFiles(now = new Date()) {
  ensureDir();
  const today = isoDay(now);
  if (lastCleanupDay === today) return;
  lastCleanupDay = today;

  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  cutoff.setUTCHours(0, 0, 0, 0);

  for (const name of fs.readdirSync(LOG_DIR)) {
    const match = /^(\d{4}-\d{2}-\d{2})\.ndjson$/.exec(name);
    if (!match) continue;
    const date = new Date(`${match[1]}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime()) && date < cutoff) {
      try { fs.unlinkSync(path.join(LOG_DIR, name)); } catch {}
    }
  }
}

function logEvent(input = {}) {
  const now = new Date();
  const level = LEVELS.has(String(input.level || "").toUpperCase())
    ? String(input.level).toUpperCase()
    : "INFO";

  const record = {
    id: input.id || `log_${crypto.randomUUID().replace(/-/g, "")}`,
    timestamp: input.timestamp || now.toISOString(),
    level,
    category: safeText(input.category || "SYSTEM", 80).toUpperCase(),
    event: safeText(input.event || "EVENT", 120).toUpperCase(),
    message: safeText(input.message || "", MAX_MESSAGE),
    source: safeText(input.source || "server", 40),
    requestId: safeText(input.requestId || "", 120),
    route: safeText(input.route || "", 240),
    method: safeText(input.method || "", 16).toUpperCase(),
    status: Number.isFinite(Number(input.status)) ? Number(input.status) : null,
    user: input.user ? sanitize({
      id: input.user.id || "",
      name: input.user.name || "",
      email: input.user.email || "",
      role: input.user.role || ""
    }) : null,
    area: safeText(input.area || "", 160),
    entityId: safeText(input.entityId || "", 180),
    appVersion: safeText(input.appVersion || "", 120),
    apiVersion: safeText(input.apiVersion || process.env.APP_VERSION || process.env.GIT_SHA || "", 120),
    device: input.device ? sanitize(input.device) : null,
    details: input.details ? sanitize(input.details) : null
  };

  try {
    ensureDir();
    cleanupOldFiles(now);
    const file = path.join(LOG_DIR, `${isoDay(now)}.ndjson`);
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    try { console.error("Site Logs write failed:", error?.message || error); } catch {}
  }

  return record;
}

function parseLine(line) {
  try {
    const value = JSON.parse(line);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function listLogFiles(fromMs, toMs) {
  ensureDir();
  const files = [];
  for (const name of fs.readdirSync(LOG_DIR)) {
    const match = /^(\d{4}-\d{2}-\d{2})\.ndjson$/.exec(name);
    if (!match) continue;
    const dayStart = Date.parse(`${match[1]}T00:00:00.000Z`);
    const dayEnd = dayStart + 86400000 - 1;
    if (Number.isFinite(fromMs) && dayEnd < fromMs) continue;
    if (Number.isFinite(toMs) && dayStart > toMs) continue;
    files.push({ name, dayStart });
  }
  return files.sort((a, b) => b.dayStart - a.dayStart);
}

function listLogs(filters = {}) {
  const now = Date.now();
  const fromMs = Number.isFinite(Number(filters.fromMs)) ? Number(filters.fromMs) : now - 24 * 60 * 60 * 1000;
  const toMs = Number.isFinite(Number(filters.toMs)) ? Number(filters.toMs) : now;
  const limit = Math.min(5000, Math.max(1, Number(filters.limit || 200)));
  const level = safeText(filters.level || "", 20).toUpperCase();
  const category = safeText(filters.category || "", 80).toUpperCase();
  const userNeedle = safeText(filters.user || "", 160).toLowerCase();
  const search = safeText(filters.search || "", 240).toLowerCase();

  const logs = [];
  for (const file of listLogFiles(fromMs, toMs)) {
    const full = path.join(LOG_DIR, file.name);
    let lines = [];
    try { lines = fs.readFileSync(full, "utf8").split("\n").filter(Boolean).reverse(); }
    catch { continue; }

    for (const line of lines) {
      const record = parseLine(line);
      if (!record) continue;
      const ts = Date.parse(record.timestamp || "");
      if (!Number.isFinite(ts) || ts < fromMs || ts > toMs) continue;
      if (level && String(record.level || "").toUpperCase() !== level) continue;
      if (category && String(record.category || "").toUpperCase() !== category) continue;

      const userText = [record?.user?.name, record?.user?.email, record?.user?.role]
        .map((v) => String(v || "").toLowerCase()).join(" ");
      if (userNeedle && !userText.includes(userNeedle)) continue;

      if (search) {
        const haystack = [
          record.message, record.event, record.category, record.requestId,
          record.route, record.area, record.entityId, userText,
          JSON.stringify(record.details || {})
        ].join(" ").toLowerCase();
        if (!haystack.includes(search)) continue;
      }

      logs.push(record);
      if (logs.length >= limit) return logs;
    }
  }

  return logs;
}

function getLogById(id) {
  const wanted = safeText(id || "", 160);
  if (!wanted) return null;
  const files = listLogFiles(Date.now() - RETENTION_DAYS * 86400000, Date.now());
  for (const file of files) {
    let lines = [];
    try { lines = fs.readFileSync(path.join(LOG_DIR, file.name), "utf8").split("\n").filter(Boolean).reverse(); }
    catch { continue; }
    for (const line of lines) {
      const record = parseLine(line);
      if (record?.id === wanted) return record;
    }
  }
  return null;
}

function clearAllLogs() {
  ensureDir();
  let deletedFiles = 0;
  let deletedEntries = 0;

  for (const name of fs.readdirSync(LOG_DIR)) {
    if (!/^\d{4}-\d{2}-\d{2}\.ndjson$/.test(name)) continue;
    const full = path.join(LOG_DIR, name);

    try {
      const lines = fs.readFileSync(full, "utf8").split("\n").filter(Boolean);
      deletedEntries += lines.length;
    } catch {}

    try {
      fs.unlinkSync(full);
      deletedFiles += 1;
    } catch {}
  }

  lastCleanupDay = "";
  return { deletedFiles, deletedEntries };
}

function summarizeLogs(hours = 24) {
  const fromMs = Date.now() - Math.max(1, Number(hours || 24)) * 60 * 60 * 1000;
  const logs = listLogs({ fromMs, toMs: Date.now(), limit: 5000 });
  const users = new Set();
  const categories = new Set();

  const summary = {
    total: logs.length,
    info: 0,
    warn: 0,
    error: 0,
    critical: 0,
    users: 0,
    categories: []
  };

  for (const record of logs) {
    const key = String(record.level || "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(summary, key)) summary[key] += 1;
    if (record?.user?.id || record?.user?.email) users.add(record.user.id || record.user.email);
    if (record?.category) categories.add(record.category);
  }

  summary.users = users.size;
  summary.categories = Array.from(categories).sort();
  return summary;
}

module.exports = {
  LOG_DIR,
  RETENTION_DAYS,
  logEvent,
  listLogs,
  getLogById,
  summarizeLogs,
  clearAllLogs,
  sanitize,
  safeText
};
