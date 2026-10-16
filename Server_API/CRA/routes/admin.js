const express = require("express");
const { getUsers, saveUsers } = require("../lib/userStore");
const { getSession, extractBearer, deleteSessionsForUser } = require("../lib/sessions");
const sharedAreas = require("./areas");
const {
  cleanSpaces,
  loadAreaSections,
  resolveSectionForArea
} = require("../lib/reportStorage");
const {
  normalizeAreaKey,
  listAreaMetadata,
  ensurePendingAreaMetadata,
  configureAreaMetadata
} = require("../lib/areaMetadata");

const router = express.Router();

function safeRole(x) {
  return String(x || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function requireAdmin(req, res, next) {\n  const token = extractBearer(req);

  const session = token ? getSession(token) : null;
  if (!session) return res.status(401).json({ ok: false, message: "Not logged in." });

  const user = getUsers().find((u) => u.id === session.userId) || null;
  if (!user) return res.status(401).json({ ok: false, message: "Not logged in." });

  if (safeRole(user.role) !== "ADMIN") {
    return res.status(403).json({ ok: false, message: "Admin only." });
  }

  req.admin = user;
  next();
}

function noStore(_req, res, next) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  next();
}

function baselineAreaMap(loaded) {
  const map = new Map();

  for (const record of loaded?.records || []) {
    const key = normalizeAreaKey(record?.area);
    if (!key) continue;
    map.set(key, {
      area: cleanSpaces(record.area || ""),
      section: cleanSpaces(record.section || ""),
      baseArea: cleanSpaces(record.baseArea || ""),
      first: cleanSpaces(record.first || ""),
      second: cleanSpaces(record.second || ""),
      workbookRow: record.workbookRow ?? null
    });
  }

  for (const [area, section] of Object.entries(loaded?.direct || {})) {
    const key = normalizeAreaKey(area);
    if (!key || map.has(key)) continue;
    map.set(key, {
      area: cleanSpaces(area),
      section: cleanSpaces(section),
      baseArea: "",
      first: "",
      second: "",
      workbookRow: null
    });
  }

  return map;
}

function runtimeAreaMap(records) {
  return new Map(
    (Array.isArray(records) ? records : [])
      .map((record) => [normalizeAreaKey(record?.area), record])
      .filter(([key]) => Boolean(key))
  );
}

function knownSections(loaded) {
  const sections = new Set(
    Object.keys(loaded?.data?.sections || {}).map((value) => cleanSpaces(value)).filter(Boolean)
  );

  for (const record of loaded?.records || []) {
    const section = cleanSpaces(record?.section || "");
    if (section && section !== "Unmapped") sections.add(section);
  }

  return Array.from(sections).sort((a, b) => a.localeCompare(b));
}

function actorLabelFromMetadata(record) {
  return (
    cleanSpaces(record?.createdByName || "") ||
    cleanSpaces(record?.createdByEmail || "") ||
    "Unknown"
  );
}

function buildAdminAreaView({ reconcile = true } = {}) {
  const loaded = loadAreaSections();
  const baselineMap = baselineAreaMap(loaded);
  const operationalAreas = sharedAreas.readAreas();

  let runtimeRecords = listAreaMetadata();
  let runtimeMap = runtimeAreaMap(runtimeRecords);

  if (reconcile) {
    for (const area of operationalAreas) {
      const key = normalizeAreaKey(area);
      if (!key || baselineMap.has(key) || runtimeMap.has(key)) continue;
      ensurePendingAreaMetadata(area, null);
    }
    runtimeRecords = listAreaMetadata();
    runtimeMap = runtimeAreaMap(runtimeRecords);
  }

  const names = new Map();
  for (const [key, baseline] of baselineMap.entries()) names.set(key, baseline.area);
  for (const record of runtimeRecords) {
    const key = normalizeAreaKey(record?.area);
    if (key && !names.has(key)) names.set(key, cleanSpaces(record.area || ""));
  }
  for (const area of operationalAreas) {
    const key = normalizeAreaKey(area);
    if (key) names.set(key, cleanSpaces(area));
  }

  const areas = Array.from(names.entries())
    .map(([key, area]) => {
      const baseline = baselineMap.get(key) || null;
      const runtime = runtimeMap.get(key) || null;
      const runtimeConfigured =
        String(runtime?.status || "").toUpperCase() === "CONFIGURED" &&
        Boolean(cleanSpaces(runtime?.section || ""));
      const configured = runtimeConfigured || Boolean(baseline?.section);
      const status = configured ? "CONFIGURED" : "PENDING";

      const resolution = resolveSectionForArea(area, {
        loaded,
        runtimeMetadata: runtime || null
      });

      const section = runtimeConfigured
        ? cleanSpaces(runtime.section)
        : cleanSpaces(baseline?.section || "");
      const baseArea = runtimeConfigured
        ? cleanSpaces(runtime.baseArea || "")
        : cleanSpaces(baseline?.baseArea || "");
      const first = runtimeConfigured
        ? cleanSpaces(runtime.first || "")
        : cleanSpaces(baseline?.first || "");
      const second = runtimeConfigured
        ? cleanSpaces(runtime.second || "")
        : cleanSpaces(baseline?.second || "");

      return {
        area,
        status,
        section,
        baseArea,
        first,
        second,
        source: runtimeConfigured ? "RUNTIME" : baseline ? "BASELINE" : runtime ? "RUNTIME" : "UNMAPPED",
        addedBy: baseline ? "System" : runtime ? actorLabelFromMetadata(runtime) : "Unknown",
        createdAt: runtime?.createdAt || null,
        updatedAt: runtime?.updatedAt || null,
        updatedBy:
          cleanSpaces(runtime?.updatedBy?.name || "") ||
          cleanSpaces(runtime?.updatedBy?.email || "") ||
          "",
        workbookRow: baseline?.workbookRow ?? null,
        baselineSection: cleanSpaces(baseline?.section || ""),
        metadataRequired: status === "PENDING",
        diagnostics: {
          resolvedSection: cleanSpaces(resolution?.section || "Unmapped") || "Unmapped",
          matched: !!resolution?.matched,
          reason: String(resolution?.reason || ""),
          matchedArea: cleanSpaces(resolution?.matchedArea || ""),
          score: Number(resolution?.score || 0)
        }
      };
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "PENDING" ? -1 : 1;
      return a.area.localeCompare(b.area);
    });

  return {
    areas,
    sections: knownSections(loaded),
    summary: {
      total: areas.length,
      configured: areas.filter((item) => item.status === "CONFIGURED").length,
      pending: areas.filter((item) => item.status === "PENDING").length,
      runtimeConfigured: areas.filter(
        (item) => item.status === "CONFIGURED" && item.source === "RUNTIME"
      ).length
    }
  };
}

function sendAreaView(res, status = "") {
  const view = buildAdminAreaView({ reconcile: true });
  const wanted = String(status || "").trim().toUpperCase();
  const areas = wanted
    ? view.areas.filter((item) => item.status === wanted)
    : view.areas;

  return res.json({
    ok: true,
    areas,
    sections: view.sections,
    summary: view.summary
  });
}

// GET /api/admin/areas
router.get("/areas", requireAdmin, noStore, (req, res) => {
  try {
    return sendAreaView(res, req.query?.status);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: String(error?.message || "Failed to load area administration data.")
    });
  }
});

// GET /api/admin/areas/pending
router.get("/areas/pending", requireAdmin, noStore, (_req, res) => {
  try {
    return sendAreaView(res, "PENDING");
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: String(error?.message || "Failed to load pending area metadata.")
    });
  }
});

// PATCH /api/admin/areas/:area/metadata
router.patch("/areas/:area/metadata", requireAdmin, noStore, (req, res) => {
  try {
    const requestedArea = cleanSpaces(req.params.area || "");
    const key = normalizeAreaKey(requestedArea);
    if (!key) return res.status(400).json({ ok: false, message: "Area is required." });

    const view = buildAdminAreaView({ reconcile: true });
    const existing = view.areas.find((item) => normalizeAreaKey(item.area) === key);
    if (!existing) return res.status(404).json({ ok: false, message: "Area not found." });

    const rawSection = cleanSpaces(req.body?.section || "");
    const section = view.sections.find(
      (candidate) => candidate.toLowerCase() === rawSection.toLowerCase()
    );
    if (!section) {
      return res.status(400).json({
        ok: false,
        message: "Select a valid Section from the existing area metadata."
      });
    }

    const baseArea = cleanSpaces(req.body?.baseArea || "");
    const first = cleanSpaces(req.body?.first || "");
    const second = cleanSpaces(req.body?.second || "");

    if (baseArea.length > 160) {
      return res.status(400).json({ ok: false, message: "Base area is too long." });
    }
    if (first.length > 40 || second.length > 40) {
      return res.status(400).json({ ok: false, message: "F / G code values are too long." });
    }

    const metadata = configureAreaMetadata(
      existing.area,
      { section, baseArea, first, second },
      req.admin
    );

    const refreshed = buildAdminAreaView({ reconcile: false });
    const area = refreshed.areas.find((item) => normalizeAreaKey(item.area) === key);

    return res.json({ ok: true, metadata, area });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: String(error?.message || "Failed to update area metadata.")
    });
  }
});

// GET /api/admin/users?status=PENDING
router.get("/users", requireAdmin, (req, res) => {
  const status = safeRole(req.query.status);
  let users = getUsers();

  if (status) {
    users = users.filter((u) => safeRole(u.status) === status);
  }

  // never return password data
  const safe = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    photoUrl: u.photoUrl || "",
    createdAt: u.createdAt,
    approvedAt: u.approvedAt,
    approvedBy: u.approvedBy
  }));

  res.json({ ok: true, users: safe });
});

// POST /api/admin/users/:id/approve
router.post("/users/:id/approve", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");
  const users = getUsers();
  const u = users.find((x) => String(x.id) === id);

  if (!u) return res.status(404).json({ ok: false, message: "User not found." });

  u.status = "APPROVED";
  u.approvedAt = new Date().toISOString();
  u.approvedBy = req.admin.email;

  const role = safeRole(u.role);
  if (!role || !["ADMIN", "L1", "L2", "L3"].includes(role)) {
    u.role = "L1";
  }

  saveUsers(users);
  res.json({ ok: true });
});

// POST /api/admin/users/:id/deny
router.post("/users/:id/deny", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");
  const users = getUsers();
  const u = users.find((x) => String(x.id) === id);

  if (!u) return res.status(404).json({ ok: false, message: "User not found." });

  u.status = "DENIED";
  u.approvedAt = new Date().toISOString();
  u.approvedBy = req.admin.email;

  saveUsers(users);
  deleteSessionsForUser(u.id);
  res.json({ ok: true, sessionsInvalidated: true });
});

// PATCH /api/admin/users/:id/role
router.patch("/users/:id/role", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");
  const nextRole = safeRole(req.body?.role);

  if (!["ADMIN", "L1", "L2", "L3"].includes(nextRole)) {
    return res.status(400).json({ ok: false, message: "Invalid role." });
  }

  const users = getUsers();
  const u = users.find((x) => String(x.id) === id);
  if (!u) return res.status(404).json({ ok: false, message: "User not found." });

  if (String(u.id) === String(req.admin.id) && nextRole !== "ADMIN") {
    return res.status(400).json({ ok: false, message: "You cannot downgrade your own ADMIN role." });
  }

  const previousRole = safeRole(u.role);
  u.role = nextRole;
  saveUsers(users);
  if (previousRole !== nextRole) deleteSessionsForUser(u.id);

  res.json({
    ok: true,
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status
    }
  });
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");

  if (id === String(req.admin.id)) {
    return res.status(400).json({ ok: false, message: "You cannot delete your own admin account." });
  }

  const users = getUsers();
  const exists = users.some((u) => String(u.id) === id);
  if (!exists) return res.status(404).json({ ok: false, message: "User not found." });

  deleteSessionsForUser(id);
  const updated = users.filter((u) => String(u.id) !== id);
  saveUsers(updated);

  res.json({ ok: true, sessionsInvalidated: true });
});

module.exports = router;
