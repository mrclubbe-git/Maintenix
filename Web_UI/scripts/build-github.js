/* eslint-disable no-console */
const { spawnSync } = require("child_process");

const apiBase = process.env.REACT_APP_API_BASE_URL || "https://dev-api.main-tenix.com";
process.env.REACT_APP_API_BASE_URL = apiBase;

if (!String(process.env.NODE_OPTIONS || "").includes("--openssl-legacy-provider")) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ""} --openssl-legacy-provider`.trim();
}

console.log(`Building GitHub Pages UI with API base: ${apiBase}`);

const command = process.platform === "win32" ? "react-scripts.cmd" : "react-scripts";
const result = spawnSync(command, ["build"], {
  stdio: "inherit",
  env: process.env
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

if (result.status !== 0) process.exit(result.status == null ? 1 : result.status);

const recovery = spawnSync(process.execPath, ["scripts/write-recovery-service-worker.js"], {
  stdio: "inherit",
  env: process.env
});

if (recovery.error) {
  console.error(recovery.error);
  process.exit(1);
}

process.exit(recovery.status == null ? 1 : recovery.status);
