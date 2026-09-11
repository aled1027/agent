#!/usr/bin/env node

import { spawn, execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

async function isDebugEndpointUp() {
  try {
    const response = await fetch("http://localhost:9222/json/version");
    return response.ok;
  } catch {
    return false;
  }
}

// If something is already listening on :9222, reuse it instead of killing Chrome.
if (await isDebugEndpointUp()) {
  console.log("✓ Chrome already running on :9222 (reusing existing instance)");
  process.exit(0);
}

// Copy Chrome data to a separate automation-safe directory.
const copiedDataDir = `${process.env["HOME"]}/.cache/scraping-profile-1`;
execSync("mkdir -p ~/.cache", { stdio: "ignore" });
execSync(
  `rsync -a --delete --exclude 'Safe Browsing/' --exclude 'Crashpad/' --exclude 'BrowserMetrics/' "${process.env["HOME"]}/Library/Application Support/Google/Chrome/" "${copiedDataDir}/"`,
  { stdio: "pipe" },
);

// Start a separate Chrome instance in background (detached so Node can exit).
spawn(
  "/usr/bin/open",
  [
    "-na",
    "Google Chrome",
    "--args",
    "--remote-debugging-port=9222",
    `--user-data-dir=${copiedDataDir}`,
    "--profile-directory=Profile 1",
    "--no-first-run",
    "--disable-features=ProfilePicker",
  ],
  { detached: true, stdio: "ignore" },
).unref();

// Wait for Chrome to be ready by checking the debugging endpoint
let connected = false;
for (let i = 0; i < 30; i++) {
  try {
    const response = await fetch("http://localhost:9222/json/version");
    if (response.ok) {
      connected = true;
      break;
    }
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}

if (!connected) {
  console.error("✗ Failed to connect to Chrome");
  process.exit(1);
}

// Start background watcher for logs/network (detached)
const scriptDir = dirname(fileURLToPath(import.meta.url));
const watcherPath = join(scriptDir, "watch.js");
spawn(process.execPath, [watcherPath], { detached: true, stdio: "ignore" }).unref();

console.log("✓ Chrome started on :9222 with Profile 1");
