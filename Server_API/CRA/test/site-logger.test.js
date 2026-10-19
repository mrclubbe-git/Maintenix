"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "maintenix-site-logs-"));
process.env.SITE_LOG_DIR = tempDir;

const {
  LOG_DIR,
  logEvent,
  listLogs,
  getLogById,
  summarizeLogs,
  clearAllLogs,
  RETENTION_DAYS
} = require("../lib/siteLogger");

test("Site Logs writes NDJSON and redacts sensitive keys", () => {
  const record = logEvent({
    level: "ERROR",
    category: "TEST",
    event: "SITE_LOG_TEST",
    message: "Synthetic logger test.",
    user: { id: "u_test", name: "Test User", email: "test@example.test", role: "ADMIN" },
    requestId: "req_test",
    details: {
      harmless: "ok",
      password: "do-not-store",
      csrfToken: "do-not-store",
      nested: { privateKey: "secret", note: "safe" }
    }
  });

  assert.ok(record.id.startsWith("log_"));
  assert.equal(record.details.harmless, "ok");
  assert.equal(record.details.password, "[redacted]");
  assert.equal(record.details.csrfToken, "[redacted]");
  assert.equal(record.details.nested.privateKey, "[redacted]");

  const files = fs.readdirSync(LOG_DIR).filter((name) => name.endsWith(".ndjson"));
  assert.equal(files.length, 1);

  const stored = fs.readFileSync(path.join(LOG_DIR, files[0]), "utf8");
  assert.match(stored, /SITE_LOG_TEST/);
  assert.doesNotMatch(stored, /do-not-store/);

  const loaded = getLogById(record.id);
  assert.equal(loaded?.id, record.id);
  assert.equal(loaded?.requestId, "req_test");
});

test("Site Logs filters and summarizes recent records", () => {
  logEvent({
    level: "INFO",
    category: "AUTH",
    event: "LOGIN_SUCCEEDED",
    message: "Synthetic login.",
    user: { id: "u_a", name: "Alpha", email: "alpha@example.test", role: "L1" }
  });
  logEvent({
    level: "WARN",
    category: "OFFLINE",
    event: "CONNECTIVITY_LOST",
    message: "Synthetic offline event.",
    user: { id: "u_b", name: "Beta", email: "beta@example.test", role: "L2" }
  });
  logEvent({
    level: "ERROR",
    category: "API",
    event: "API_SERVER_ERROR",
    message: "Synthetic server error.",
    user: { id: "u_a", name: "Alpha", email: "alpha@example.test", role: "L1" }
  });

  const auth = listLogs({ level: "INFO", category: "AUTH", search: "synthetic", limit: 20 });
  assert.ok(auth.some((entry) => entry.event === "LOGIN_SUCCEEDED"));

  const beta = listLogs({ user: "Beta", limit: 20 });
  assert.ok(beta.some((entry) => entry.user?.name === "Beta"));

  const summary = summarizeLogs(24);
  assert.ok(summary.total >= 3);
  assert.ok(summary.info >= 1);
  assert.ok(summary.warn >= 1);
  assert.ok(summary.error >= 1);
  assert.ok(summary.users >= 2);
  assert.ok(summary.categories.includes("AUTH"));
});


test("Site Logs default retention is 60 days", () => {
  assert.equal(RETENTION_DAYS, 60);
});

test("Site Logs clear-all removes current NDJSON history", () => {
  const before = logEvent({
    level: "INFO",
    category: "ADMIN",
    event: "CLEAR_TEST",
    message: "Clear-all test record."
  });

  assert.ok(getLogById(before.id));
  const cleared = clearAllLogs();
  assert.ok(cleared.deletedFiles >= 1);
  assert.ok(cleared.deletedEntries >= 1);
  assert.equal(getLogById(before.id), null);
  assert.equal(fs.readdirSync(LOG_DIR).filter((name) => name.endsWith(".ndjson")).length, 0);
});
