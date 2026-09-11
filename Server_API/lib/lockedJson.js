const fs = require("fs");
const path = require("path");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readJsonSync(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonAtomicSync(filePath, obj) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function lockInfoPath(lockPath) {
  return path.join(lockPath, "owner.json");
}

function acquireLockSync(lockPath, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs || 5000);
  const staleMs = Number(opts.staleMs || 10 * 60 * 1000);
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      fs.mkdirSync(lockPath);
      try {
        fs.writeFileSync(
          lockInfoPath(lockPath),
          JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }, null, 2),
          "utf8"
        );
      } catch {}
      return () => {
        try {
          fs.rmSync(lockPath, { recursive: true, force: true });
        } catch {}
      };
    } catch (err) {
      if (err && err.code !== "EEXIST") throw err;

      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {}

      sleepSync(50);
    }
  }

  throw new Error(`Timed out waiting for lock: ${lockPath}`);
}

function updateJsonWithLockSync(filePath, fallback, updater, opts = {}) {
  const release = acquireLockSync(`${filePath}.lock`, opts);
  try {
    const current = readJsonSync(filePath, fallback);
    const next = updater(current);
    writeJsonAtomicSync(filePath, next);
    return next;
  } finally {
    release();
  }
}

module.exports = {
  readJsonSync,
  writeJsonAtomicSync,
  updateJsonWithLockSync,
  acquireLockSync
};
