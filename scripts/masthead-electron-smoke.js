#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

const dataDir = await mkdtemp(join(tmpdir(), "masthead-electron-smoke-"));
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(command, ["electron-forge", "start"], {
  env: {
    ...process.env,
    MASTHEAD_DATA_DIR: dataDir,
    MASTHEAD_ELECTRON_DEV: "1",
    MASTHEAD_ELECTRON_SMOKE: "1",
    MASTHEAD_GIT_REFRESH_MS: "0"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const timeout = setTimeout(() => child.kill("SIGTERM"), 45_000);
const [code] = await once(child, "exit");
clearTimeout(timeout);
await rm(dataDir, { force: true, recursive: true });

const jsonLine = stdout.split(/\r?\n/).find((line) => line.includes('"smoke":"electron"'));
if (code !== 0 || !jsonLine) {
  console.error(stderr || stdout || `Electron smoke exited with ${code}`);
  process.exit(1);
}

const parsed = JSON.parse(jsonLine);
if (!parsed.renderer?.hasDesktopBridge) {
  console.error("Electron preload bridge was not exposed.");
  process.exit(1);
}
if (parsed.renderer?.hasNodeProcess || parsed.renderer?.hasRequire || parsed.renderer?.hasRawIpc) {
  console.error(`Renderer exposed forbidden privileged globals: ${JSON.stringify(parsed.renderer)}`);
  process.exit(1);
}
if (parsed.renderer?.cardCount >= 12 && (parsed.renderer.hoverMedianMs > 16 || parsed.renderer.hoverP95Ms > 50)) {
  console.error(`Electron hover latency exceeded threshold: ${JSON.stringify(parsed.renderer)}`);
  process.exit(1);
}

console.log(`Electron smoke passed. Electron ${parsed.electron}. GPU keys: ${Object.keys(parsed.gpu || {}).join(", ")}`);
