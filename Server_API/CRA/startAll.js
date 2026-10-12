const { spawn } = require("child_process");
const path = require("path");

const services = [
  ["api", "index.js"],
  ["servicing-worker", "servicingWorker.js"],
  ["callout-worker", "calloutWorker.js"]
];

let stopping = false;
const children = new Map();

function stopAll(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;

  for (const child of children.values()) {
    if (!child.killed) {
      try {
        child.kill(signal);
      } catch {}
    }
  }
}

for (const [name, file] of services) {
  const child = spawn(process.execPath, [path.join(__dirname, file)], {
    stdio: "inherit",
    env: process.env
  });

  children.set(name, child);

  child.on("exit", (code, signal) => {
    if (stopping) return;

    console.error(`${name} exited (${signal || code || 0}); stopping local stack.`);
    process.exitCode = code || 1;
    stopAll();
  });

  child.on("error", (err) => {
    console.error(`${name} failed to start:`, err);
    process.exitCode = 1;
    stopAll();
  });
}

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));

process.on("exit", () => {
  for (const child of children.values()) {
    if (!child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  }
});
