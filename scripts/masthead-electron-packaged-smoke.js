#!/usr/bin/env node
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses";

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

const resourceRoot = join(dirname(binary), "resources");
const resources = join(resourceRoot, "daemon");
await access(join(resourceRoot, "masthead-logo-sail.png"), constants.R_OK);
await access(join(resources, process.platform === "win32" ? "node.exe" : "node"), constants.X_OK);
await access(join(resources, "dist", "src", "daemon", "main.js"), constants.R_OK);
await access(join(resources, "dist", "src", "mcp", "server.js"), constants.R_OK);
await access(join(resources, "scripts", "masthead-hook.js"), constants.R_OK);

const fuseWire = await getCurrentFuseWire(binary);
assertFuse(fuseWire, FuseV1Options.RunAsNode, false, "RunAsNode");
assertFuse(fuseWire, FuseV1Options.EnableNodeOptionsEnvironmentVariable, false, "EnableNodeOptionsEnvironmentVariable");
assertFuse(fuseWire, FuseV1Options.EnableNodeCliInspectArguments, false, "EnableNodeCliInspectArguments");
assertFuse(fuseWire, FuseV1Options.EnableEmbeddedAsarIntegrityValidation, true, "EnableEmbeddedAsarIntegrityValidation");
assertFuse(fuseWire, FuseV1Options.OnlyLoadAppFromAsar, true, "OnlyLoadAppFromAsar");
assertFuse(fuseWire, FuseV1Options.GrantFileProtocolExtraPrivileges, false, "GrantFileProtocolExtraPrivileges");

const dataDir = await mkdtemp(join(tmpdir(), "masthead-electron-packaged-smoke-"));
const homeDir = await mkdtemp(join(tmpdir(), "masthead-electron-packaged-home-"));
const smokePort = await availablePort();
const baseUrl = `http://127.0.0.1:${smokePort}`;
const disableSandboxForCi = process.env.CI ? { ELECTRON_DISABLE_SANDBOX: "1" } : {};
const child = spawn(binary, [], {
  env: {
    ...process.env,
    ...disableSandboxForCi,
    HOME: homeDir,
    USERPROFILE: homeDir,
    MASTHEAD_DATA_DIR: dataDir,
    MASTHEAD_ELECTRON_SMOKE: "1",
    MASTHEAD_ELECTRON_SMOKE_HOLD_MS: "10000",
    MASTHEAD_ELECTRON_SMOKE_MODE: "renderer-autostart",
    MASTHEAD_PORT: String(smokePort),
    MASTHEAD_GIT_REFRESH_MS: "0"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
const cliVerification = verifyPackagedAuthoringCli(baseUrl, homeDir, child).then(
  (value) => ({ value }),
  (error) => ({ error })
);

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
const [[code], cliCheck] = await Promise.all([once(child, "exit"), cliVerification]);
clearTimeout(timeout);

const jsonLine = stdout.split(/\r?\n/).find((line) => line.includes('"smoke":"electron"'));
if (code !== 0 || !jsonLine) {
  console.error(stderr || stdout || `Packaged Electron smoke exited with ${code}`);
  process.exit(1);
}
if ("error" in cliCheck) {
  console.error(cliCheck.error instanceof Error ? cliCheck.error.message : String(cliCheck.error));
  process.exit(1);
}

const parsed = JSON.parse(jsonLine);
if (parsed.connector?.smokeMode !== "renderer-autostart" || !parsed.connector?.message?.includes("Renderer autostart")) {
  console.error(`Packaged renderer autostart connector check failed: ${JSON.stringify(parsed.connector)}`);
  process.exit(1);
}
if (!parsed.connector?.started || parsed.connector?.health?.dataDirectory !== dataDir || parsed.connector?.baseUrl !== `http://127.0.0.1:${smokePort}`) {
  console.error(`Packaged renderer autostart did not start the expected connector: ${JSON.stringify(parsed.connector)}`);
  process.exit(1);
}
if (!parsed.renderer?.hasDesktopBridge || parsed.renderer?.hasNodeProcess || parsed.renderer?.hasRequire || parsed.renderer?.hasRawIpc) {
  console.error(`Packaged renderer security check failed: ${JSON.stringify(parsed.renderer)}`);
  process.exit(1);
}
if (!parsed.renderer?.hasCustomChrome) {
  console.error(`Packaged custom window chrome was not rendered: ${JSON.stringify(parsed.renderer)}`);
  process.exit(1);
}
if (
  !parsed.renderer?.windowControls?.includes("Minimize window") ||
  !parsed.renderer?.windowControls?.includes("Maximize window") ||
  !parsed.renderer?.windowControls?.includes("Close window")
) {
  console.error(`Packaged custom window controls were not rendered: ${JSON.stringify(parsed.renderer)}`);
  process.exit(1);
}

await assertSmokeConnectorStopped(dataDir);
await rm(dataDir, { force: true, recursive: true });
await rm(homeDir, { force: true, recursive: true });

console.log(`Packaged Electron smoke passed. ${binary}`);

async function verifyPackagedAuthoringCli(baseUrl, homeDir, child) {
  let capabilities;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Packaged Electron exited before CLI capabilities were available.");
    capabilities = await fetch(`${baseUrl}/workbench/authoring/capabilities`, {
      signal: AbortSignal.timeout(500)
    })
      .then((response) => (response.ok ? response.json() : undefined))
      .catch(() => undefined);
    if (capabilities?.capability === "artifact_authoring" && capabilities?.command) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!capabilities?.command || !isAbsolute(capabilities.command)) {
    throw new Error(`Packaged daemon did not report an absolute authoring CLI command: ${JSON.stringify(capabilities)}`);
  }
  const commandRelativeToHome = relative(homeDir, capabilities.command);
  if (commandRelativeToHome.startsWith("..") || isAbsolute(commandRelativeToHome)) {
    throw new Error(`Packaged authoring CLI was installed outside the smoke HOME: ${capabilities.command}`);
  }
  await access(capabilities.command, process.platform === "win32" ? constants.R_OK : constants.X_OK);

  const result = await runCommand(capabilities.command, ["workbench", "capabilities", "--json"], {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir
  });
  if (result.code !== 0) {
    throw new Error(`Packaged authoring CLI failed: ${result.stderr || result.stdout}`);
  }
  const cliCapabilities = JSON.parse(result.stdout);
  if (
    cliCapabilities.capability !== "artifact_authoring" ||
    cliCapabilities.databaseId !== capabilities.databaseId ||
    cliCapabilities.command !== capabilities.command
  ) {
    throw new Error(`Packaged authoring CLI reached the wrong daemon: ${result.stdout}`);
  }
  return cliCapabilities;
}

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const commandChild = spawn(command, args, {
      env,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      commandChild.kill("SIGTERM");
      reject(new Error(`Timed out invoking packaged authoring CLI: ${command}`));
    }, 10_000);
    commandChild.stdout.setEncoding("utf8");
    commandChild.stderr.setEncoding("utf8");
    commandChild.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    commandChild.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    commandChild.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    commandChild.once("exit", (code) => {
      clearTimeout(timeout);
      resolve({ code, stderr, stdout });
    });
  });
}

function assertFuse(fuseWire, option, expected, name) {
  const enabled = fuseWire[option] === 49 || fuseWire[option] === "1";
  if (enabled !== expected) {
    console.error(`Packaged Electron fuse ${name} expected ${expected ? "enabled" : "disabled"} but was ${enabled ? "enabled" : "disabled"}.`);
    process.exit(1);
  }
}

async function assertSmokeConnectorStopped(dataDir) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const health = await fetch(`http://127.0.0.1:${smokePort}/health`, { signal: AbortSignal.timeout(500) })
      .then((response) => (response.ok ? response.json() : undefined))
      .catch(() => undefined);
    if (!health || health?.data?.dataDirectory !== dataDir) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  console.error(`Packaged Electron smoke connector was still running from ${dataDir} after the app exited.`);
  process.exit(1);
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}
