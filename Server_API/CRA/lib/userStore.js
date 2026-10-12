// /opt/maintenix-ui/server-api/lib/userStore.js
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "users.json");

const ROLE = {
  ADMIN: "ADMIN",
  L1: "L1",
  L2: "L2",
  L3: "L3"
};

function ensureFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [] }, null, 2), "utf8");
  }
}

function readDb() {
  ensureFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
  if (!raw) return { users: [] };

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.users || !Array.isArray(parsed.users)) return { users: [] };
    return parsed;
  } catch {
    // If file is corrupted, keep a backup and start fresh
    const backup = DATA_FILE.replace(/\.json$/i, `.corrupt.${Date.now()}.json`);
    fs.copyFileSync(DATA_FILE, backup);
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [] }, null, 2), "utf8");
    return { users: [] };
  }
}

function writeDb(db) {
  ensureFile();
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

// --- Role normalization (backward compatible) ---
function normalizeRole(role) {
  const r = String(role || "").toUpperCase().replace(/\s+/g, "");

  // Back-compat: older roles
  if (r === "LEVEL2" || r === "LEVEL_2") return ROLE.L2;
  if (r === "USER" || r === "LEVEL1" || r === "LEVEL_1") return ROLE.L1;

  if (r === ROLE.ADMIN) return ROLE.ADMIN;
  if (r === ROLE.L1) return ROLE.L1;
  if (r === ROLE.L2) return ROLE.L2;
  if (r === ROLE.L3) return ROLE.L3;

  // Default if missing/unknown
  return ROLE.L1;
}

function normalizeUser(u) {
  const user = { ...(u || {}) };
  user.email = String(user.email || "").trim();
  user.name = String(user.name || "").trim();

  user.role = normalizeRole(user.role);
  user.status = String(user.status || "").toUpperCase() || "PENDING";

  if (typeof user.photoUrl !== "string") user.photoUrl = "";

  return user;
}

function getUsers() {
  const db = readDb();
  return db.users.map(normalizeUser);
}

function saveUsers(users) {
  writeDb({ users: (users || []).map(normalizeUser) });
}

function findByEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return getUsers().find((u) => String(u.email || "").toLowerCase() === e) || null;
}

function findById(id) {
  const key = String(id || "");
  return getUsers().find((u) => String(u.id || "") === key) || null;
}

// Update helper: reads -> modifies -> saves
function updateUser(id, updaterFn) {
  const users = getUsers();
  const idx = users.findIndex((u) => String(u.id) === String(id));
  if (idx === -1) return null;

  const current = users[idx];
  const updated = normalizeUser(updaterFn ? updaterFn({ ...current }) : current);

  users[idx] = updated;
  saveUsers(users);
  return updated;
}

// Patch helper: merges a partial patch into the user and saves.
// (This is what profileRoutes.js expects.)
function updateUserById(id, patch) {
  const safePatch = patch && typeof patch === "object" ? patch : {};
  return updateUser(id, (u) => ({ ...u, ...safePatch }));
}

function setUserRole(id, role) {
  const normalized = normalizeRole(role);
  return updateUser(id, (u) => ({ ...u, role: normalized }));
}

function ensureDefaultRoleForApprovedUsers() {
  // Optional safety: if a user is APPROVED but has no/invalid role
  const users = getUsers();
  let changed = false;

  const fixed = users.map((u) => {
    const out = { ...u };
    const before = out.role;
    out.role = normalizeRole(out.role);

    if (out.status === "APPROVED" && !out.role) out.role = ROLE.L1;

    if (before !== out.role) changed = true;
    return out;
  });

  if (changed) saveUsers(fixed);
  return changed;
}

module.exports = {
  ROLE,
  getUsers,
  saveUsers,
  findByEmail,
  findById,
  updateUser,
  updateUserById,
  setUserRole,
  normalizeRole,
  ensureDefaultRoleForApprovedUsers
};
