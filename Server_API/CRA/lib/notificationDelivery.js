const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { acquireLockSync, writeJsonAtomicSync } = require("./lockedJson");

const DATA_FILE =
  process.env.MAINTENIX_NOTIFICATION_DELIVERY_FILE ||
  path.join(__dirname, "..", "data", "notification-delivery.json");
const LOCK_FILE = `${DATA_FILE}.lock`;
const MAX_ATTEMPTS = 5;
const STALE_PROCESSING_MS = 2 * 60 * 1000;
const MAX_HISTORY = 4000;
const RETRY_DELAYS_MS = [5000, 30000, 120000, 600000, 1800000];

function nowIso() {
  return new Date().toISOString();
}

function emptyDb() {
  return { version: 1, jobs: [] };
}

function normalizeDb(input) {
  return { version: 1, jobs: Array.isArray(input?.jobs) ? input.jobs : [] };
}

function readDbUnlocked() {
  if (!fs.existsSync(DATA_FILE)) {
    const clean = emptyDb();
    writeJsonAtomicSync(DATA_FILE, clean);
    return clean;
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
    return raw ? normalizeDb(JSON.parse(raw)) : emptyDb();
  } catch {
    const backup = DATA_FILE.replace(/\.json$/i, `.corrupt.${Date.now()}.json`);
    try { fs.copyFileSync(DATA_FILE, backup); } catch {}
    const clean = emptyDb();
    writeJsonAtomicSync(DATA_FILE, clean);
    return clean;
  }
}

function trimHistory(jobs) {
  if (jobs.length <= MAX_HISTORY) return jobs;
  const active = jobs.filter((job) => !["COMPLETED", "FAILED"].includes(String(job?.status || "")));
  const terminalLimit = Math.max(0, MAX_HISTORY - Math.min(active.length, MAX_HISTORY));
  const terminal = jobs
    .filter((job) => ["COMPLETED", "FAILED"].includes(String(job?.status || "")))
    .slice(-terminalLimit);
  return [...terminal, ...active].slice(-MAX_HISTORY);
}

function writeDbUnlocked(db) {
  writeJsonAtomicSync(DATA_FILE, {
    version: 1,
    jobs: trimHistory(Array.isArray(db?.jobs) ? db.jobs : [])
  });
}

function withDbLock(mutator) {
  const release = acquireLockSync(LOCK_FILE);
  try {
    const db = readDbUnlocked();
    const result = mutator(db);
    writeDbUnlocked(db);
    return result;
  } finally {
    release();
  }
}

function supportsPush(notification) {
  const channels = Array.isArray(notification?.deliveryChannels)
    ? notification.deliveryChannels.map((value) => String(value || "").toUpperCase())
    : ["IN_APP", "PUSH"];
  return channels.includes("PUSH");
}

function enqueueNotificationDelivery(notification) {
  if (!notification?.id || !supportsPush(notification)) return null;

  return withDbLock((db) => {
    const existing = db.jobs.find(
      (job) =>
        String(job?.notificationId || "") === String(notification.id) &&
        String(job?.channel || "").toUpperCase() === "PUSH"
    );
    if (existing) return { ...existing };

    const createdAt = nowIso();
    const job = {
      id: `ndl_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      notificationId: String(notification.id),
      eventType: String(notification.eventType || notification.type || "INFO").toUpperCase(),
      channel: "PUSH",
      status: "PENDING",
      attempts: 0,
      createdAt,
      updatedAt: createdAt,
      nextAttemptAt: createdAt,
      claimedAt: null,
      claimedBy: "",
      completedAt: null,
      lastError: "",
      result: null,
      notification
    };
    db.jobs.push(job);
    return { ...job };
  });
}

function recoverStaleJobs(db) {
  const now = Date.now();
  for (const job of db.jobs) {
    if (String(job?.status || "") !== "PROCESSING") continue;
    const claimedAt = Date.parse(job.claimedAt || "");
    if (!Number.isFinite(claimedAt) || now - claimedAt < STALE_PROCESSING_MS) continue;
    job.status = "RETRY";
    job.nextAttemptAt = nowIso();
    job.claimedAt = null;
    job.claimedBy = "";
    job.lastError = "Recovered stale notification delivery claim.";
    job.updatedAt = nowIso();
  }
}

function claimNextDelivery(workerId = `pid:${process.pid}`) {
  return withDbLock((db) => {
    recoverStaleJobs(db);
    const now = Date.now();
    const job = db.jobs.find((candidate) => {
      if (!["PENDING", "RETRY"].includes(String(candidate?.status || ""))) return false;
      const due = Date.parse(candidate?.nextAttemptAt || candidate?.createdAt || "");
      return !Number.isFinite(due) || due <= now;
    });

    if (!job) return null;
    job.status = "PROCESSING";
    job.attempts = Number(job.attempts || 0) + 1;
    job.claimedAt = nowIso();
    job.claimedBy = workerId;
    job.updatedAt = nowIso();
    return JSON.parse(JSON.stringify(job));
  });
}

function completeDelivery(jobId, result = {}) {
  return withDbLock((db) => {
    const job = db.jobs.find((candidate) => String(candidate?.id || "") === String(jobId || ""));
    if (!job) return null;
    job.status = "COMPLETED";
    job.completedAt = nowIso();
    job.updatedAt = job.completedAt;
    job.claimedAt = null;
    job.claimedBy = "";
    job.lastError = "";
    job.result = {
      configured: result?.configured !== false,
      sent: Number(result?.sent || 0),
      failed: Number(result?.failed || 0),
      retryableFailed: Number(result?.retryableFailed || 0),
      permanentFailed: Number(result?.permanentFailed || 0)
    };
    return { ...job };
  });
}

function failDelivery(jobId, error) {
  return withDbLock((db) => {
    const job = db.jobs.find((candidate) => String(candidate?.id || "") === String(jobId || ""));
    if (!job) return null;

    const attempts = Number(job.attempts || 0);
    const terminal = attempts >= MAX_ATTEMPTS;
    const retryDelay = RETRY_DELAYS_MS[Math.max(0, Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1))];

    job.status = terminal ? "FAILED" : "RETRY";
    job.nextAttemptAt = terminal ? null : new Date(Date.now() + retryDelay).toISOString();
    job.claimedAt = null;
    job.claimedBy = "";
    job.lastError = String(error?.message || error || "Notification delivery failed.").slice(0, 1000);
    job.updatedAt = nowIso();
    if (terminal) job.completedAt = job.updatedAt;
    return { ...job };
  });
}

function getDeliveryForNotification(notificationId) {
  const release = acquireLockSync(LOCK_FILE);
  try {
    return readDbUnlocked().jobs
      .filter((job) => String(job?.notificationId || "") === String(notificationId || ""))
      .map((job) => ({
        id: job.id,
        notificationId: job.notificationId,
        eventType: job.eventType,
        channel: job.channel,
        status: job.status,
        attempts: Number(job.attempts || 0),
        createdAt: job.createdAt || null,
        updatedAt: job.updatedAt || null,
        nextAttemptAt: job.nextAttemptAt || null,
        completedAt: job.completedAt || null,
        lastError: job.lastError || "",
        result: job.result || null
      }));
  } finally {
    release();
  }
}

module.exports = {
  enqueueNotificationDelivery,
  claimNextDelivery,
  completeDelivery,
  failDelivery,
  getDeliveryForNotification
};
