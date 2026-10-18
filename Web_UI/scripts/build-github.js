/* eslint-disable no-console */
const { spawnSync } = require("child_process");

const apiBase = process.env.REACT_APP_API_BASE_URL || "https://dev-api.main-tenix.com/CRA";
process.env.REACT_APP_API_BASE_URL = apiBase;
process.env.GENERATE_SOURCEMAP = "false";
// CRA 3 normally injects the webpack runtime as an inline <script>.
// The deployed CSP deliberately uses script-src self without unsafe-inline,
// so keep the runtime as an external same-origin asset instead.
process.env.INLINE_RUNTIME_CHUNK = "false";

if (!String(process.env.NODE_OPTIONS || "").includes("--openssl-legacy-provider")) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ""} --openssl-legacy-provider`.trim();
}

console.log(`Building CRA GitHub Pages UI with API base: ${apiBase}`);

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

process.exit(result.status == null ? 1 : result.status);
