"use strict";

const express = require("express");
const { extractSessionToken, getSession } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");
const { logEvent, safeText, sanitize } = require("../lib/siteLogger");

const router = express.Router();
const ORGANIZATION_CODE = String(process.env.ORGANIZATION_CODE || "CRA").trim().toUpperCase() || "CRA";
const CLIENT_LEVELS = new Set(["INFO", "WARN", "ERROR"]);

function authenticatedUser(req) {
  const token = extractSessionToken(req);
  const session = token ? getSession(token) : null;
  const user = session?.userId ? getUsers().find((entry) => String(entry.id) === String(session.userId)) : null;
  if (!session || !user) return null;

  const organization = String(user.organization || session.organization || ORGANIZATION_CODE).trim().toUpperCase();
  const role = String(user.role || "").trim().toUpperCase();
  const status = String(user.status || "").trim().toUpperCase();
  if (organization !== ORGANIZATION_CODE) return null;
  if (role !== "ADMIN" && status !== "APPROVED") return null;

  return user;
}

router.post("/client", (req, res) => {
  const user = authenticatedUser(req);
  if (!user) return res.status(401).json({ ok: false, message: "Not logged in." });

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const requestedLevel = String(body.level || "ERROR").trim().toUpperCase();
  const level = CLIENT_LEVELS.has(requestedLevel) ? requestedLevel : "ERROR";

  const record = logEvent({
    level,
    category: safeText(body.category || "CLIENT", 80),
    event: safeText(body.event || "CLIENT_EVENT", 120),
    message: safeText(body.message || "", 1000),
    source: "client",
    requestId: safeText(body.requestId || req.requestId || "", 120),
    route: safeText(body.route || "", 240),
    method: safeText(body.method || "", 16),
    status: body.status,
    user,
    area: safeText(body.area || "", 160),
    entityId: safeText(body.entityId || "", 180),
    appVersion: safeText(body.appVersion || req.headers["x-maintenix-app-build"] || "", 120),
    device: sanitize(body.device || {}),
    details: sanitize(body.details || {})
  });

  return res.status(201).json({ ok: true, id: record.id });
});

module.exports = router;
