const fs = require("fs");
const path = require("path");

const CLAIM_SUFFIX = ".processing";
const DEFAULT_STALE_MS = 30 * 60 * 1000;

function walkFilesSync(root, visitor) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walkFilesSync(full, visitor);
    else if (entry.isFile()) visitor(full, entry.name);
  }
}

function recoverStaleClaimsSync(root, staleMs = DEFAULT_STALE_MS) {
  const now = Date.now();
  walkFilesSync(root, (filePath) => {
    if (!filePath.endsWith(CLAIM_SUFFIX)) return;
    try {
      const st = fs.statSync(filePath);
      if (now - st.mtimeMs < staleMs) return;

      const original = filePath.slice(0, -CLAIM_SUFFIX.length);
      if (!fs.existsSync(original)) fs.renameSync(filePath, original);
      else fs.unlinkSync(filePath);
    } catch {}
  });
}

function findOldestQueuedJobSync(root, isQueuedJobName, opts = {}) {
  recoverStaleClaimsSync(root, Number(opts.staleMs || DEFAULT_STALE_MS));

  let best = null;
  walkFilesSync(root, (filePath, name) => {
    if (!isQueuedJobName(name)) return;
    try {
      const st = fs.statSync(filePath);
      if (!best || st.mtimeMs < best.mtimeMs) best = { path: filePath, mtimeMs: st.mtimeMs };
    } catch {}
  });

  return best ? best.path : null;
}

function claimJobSync(jobPath) {
  const claimedPath = `${jobPath}${CLAIM_SUFFIX}`;
  try {
    fs.renameSync(jobPath, claimedPath);
    return claimedPath;
  } catch {
    return null;
  }
}

function removeClaimedJobSync(claimedPath) {
  try {
    fs.unlinkSync(claimedPath);
  } catch {}
}

module.exports = {
  CLAIM_SUFFIX,
  findOldestQueuedJobSync,
  claimJobSync,
  removeClaimedJobSync,
  recoverStaleClaimsSync
};
