const express = require("express");

const { extractBearer, getSession } = require("../lib/sessions");
const { getUsers } = require("../lib/userStore");
const {
  pushConfigured,
  getPublicKey,
  upsertSubscription,
  removeSubscription,
  sendTestPush
} = require("../lib/pushNotifications");

const router = express.Router();

function requireAuth(req, res, next) {
  const token = extractBearer(req);
  const session = getSession(token);
  if (!session?.userId) return res.status(401).json({ ok: false, message: "Unauthorized" });

  const user = getUsers().find((u) => String(u.id) === String(session.userId)) || null;
  if (!user) return res.status(401).json({ ok: false, message: "Unauthorized" });

  req.user = user;
  next();
}

router.get("/public-key", requireAuth, (_req, res) => {
  const configured = pushConfigured();
  res.json({
    ok: true,
    configured,
    publicKey: configured ? getPublicKey() : ""
  });
});

router.post("/subscribe", requireAuth, (req, res) => {
  if (!pushConfigured()) {
    return res.status(503).json({
      ok: false,
      message: "Web Push is not configured on this organization."
    });
  }

  const record = upsertSubscription(req.user, req.body?.subscription, {
    userAgent: req.headers["user-agent"] || ""
  });

  if (!record) {
    return res.status(400).json({
      ok: false,
      message: "A valid Web Push subscription is required."
    });
  }

  res.json({ ok: true });
});

router.post("/unsubscribe", requireAuth, (req, res) => {
  const endpoint = String(req.body?.endpoint || "").trim();
  if (!endpoint) {
    return res.status(400).json({ ok: false, message: "Subscription endpoint is required." });
  }

  removeSubscription(req.user, endpoint);
  res.json({ ok: true });
});

router.post("/test", requireAuth, async (req, res) => {
  const result = await sendTestPush(req.user);
  if (!result.configured) {
    return res.status(503).json({
      ok: false,
      message: "Web Push is not configured on this organization."
    });
  }

  if (!result.ok) {
    return res.status(404).json({
      ok: false,
      message: result.message || "No active device subscription found."
    });
  }

  res.json({ ok: true, sent: result.sent, failed: result.failed || 0 });
});

module.exports = router;
