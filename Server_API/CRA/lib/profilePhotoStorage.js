const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const configuredDir = String(process.env.PROFILE_PICS_DIR || "").trim();

const PROFILE_PICS_DIR = configuredDir
  ? path.resolve(configuredDir)
  : path.join(DATA_DIR, "profilepics");

const LEGACY_PROFILE_PICS_DIR = path.join(DATA_DIR, "uploads", "profilepics");
const PROFILE_PICS_PUBLIC_PREFIX = "/uploads/profilepics/";

function ensureProfilePicsDir() {
  fs.mkdirSync(PROFILE_PICS_DIR, { recursive: true });
  return PROFILE_PICS_DIR;
}

function publicUrlForProfilePhoto(filename) {
  const name = path.basename(String(filename || ""));
  if (!name) throw new Error("Profile image filename is invalid.");
  return `${PROFILE_PICS_PUBLIC_PREFIX}${name}`;
}

function profilePhotoCandidatePaths(photoUrl) {
  const raw = String(photoUrl || "").trim();
  if (!raw.startsWith(PROFILE_PICS_PUBLIC_PREFIX)) return [];

  let name = raw.slice(PROFILE_PICS_PUBLIC_PREFIX.length).split(/[?#]/, 1)[0];
  try { name = decodeURIComponent(name); } catch {}
  name = path.basename(name);
  if (!name || name === "." || name === "..") return [];

  return [
    path.join(PROFILE_PICS_DIR, name),
    path.join(LEGACY_PROFILE_PICS_DIR, name)
  ];
}

module.exports = {
  PROFILE_PICS_DIR,
  LEGACY_PROFILE_PICS_DIR,
  PROFILE_PICS_PUBLIC_PREFIX,
  ensureProfilePicsDir,
  publicUrlForProfilePhoto,
  profilePhotoCandidatePaths
};
