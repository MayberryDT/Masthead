#!/usr/bin/env node
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

async function canExecute(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findPackagedBinary(root = "out") {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findPackagedBinary(path);
      if (nested) return nested;
      continue;
    }

    const expectedName = process.platform === "win32" ? "masthead.exe" : "masthead";
    if (entry.name === expectedName && (await canExecute(path))) return path;
  }
  return "";
}

const binary = process.env.MASTHEAD_ELECTRON_PACKAGED_BIN || process.argv[2] || (await findPackagedBinary());
if (!binary) {
  console.error("Could not find packaged Masthead binary. Pass a path, set MASTHEAD_ELECTRON_PACKAGED_BIN, or run npm run build:desktop first.");
  process.exit(1);
}

const resources = join(dirname(binary), "resources", "daemon");
await access(join(resources, process.platform === "win32" ? "node.exe" : "node"), constants.X_OK);
await access(join(resources, "dist", "src", "daemon", "main.js"), constants.R_OK);
await access(join(resources, "dist", "src", "mcp", "server.js"), constants.R_OK);

const dataDir = await mkdtemp(join(tmpdir(), "masthead-electron-packaged-smoke-"));
const disableSandboxForCi = process.env.CI ? { ELECTRON_DISABLE_SANDBOX: "1" } : {};
const child = spawn(binary, [], {
  env: { ...process.env, ...disableSandboxForCi, MASTHEAD_DATA_DIR: dataDir, MASTHEAD_ELECTRON_SMOKE: "1", MASTHEAD_GIT_REFRESH_MS: "0" },
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
  console.error(stderr || stdout || `Packaged Electron smoke exited with ${code}`);
  process.exit(1);
}

const parsed = JSON.parse(jsonLine);
if (!parsed.renderer?.hasDesktopBridge || parsed.renderer?.hasNodeProcess || parsed.renderer?.hasRequire || parsed.renderer?.hasRawIpc) {
  console.error(`Packaged renderer security check failed: ${JSON.stringify(parsed.renderer)}`);
  process.exit(1);
}

console.log(`Packaged Electron smoke passed. ${binary}`);
