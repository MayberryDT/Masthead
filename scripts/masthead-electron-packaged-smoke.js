#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { constants } from "node:fs";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, win32 } from "node:path";
import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { buildPackagedCliInvocation } from "./packaged-cli-command.js";

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function main() {
  const binary = process.env.MASTHEAD_ELECTRON_PACKAGED_BIN || process.argv[2] || (await findPackagedBinary());
  if (!binary) {
    throw new Error(
      "Could not find packaged Masthead binary. Pass a path, set MASTHEAD_ELECTRON_PACKAGED_BIN, or run npm run build:desktop first."
    );
  }

  const resourceRoot = join(dirname(binary), "resources");
  const resources = join(resourceRoot, "daemon");
  await access(join(resourceRoot, "masthead-logo-sail.png"), constants.R_OK);
  await access(join(resources, process.platform === "win32" ? "node.exe" : "node"), constants.X_OK);
  await access(join(resources, "dist", "src", "daemon", "main.js"), constants.R_OK);
  await access(join(resources, "dist", "src", "mcp", "server.js"), constants.R_OK);
  await access(join(resources, "dist", "src", "cli", "mastheadctl.js"), constants.R_OK);
  await access(join(resources, "scripts", "masthead-hook.js"), constants.R_OK);

  const fuseWire = await getCurrentFuseWire(binary);
  assertFuse(fuseWire, FuseV1Options.RunAsNode, false, "RunAsNode");
  assertFuse(fuseWire, FuseV1Options.EnableNodeOptionsEnvironmentVariable, false, "EnableNodeOptionsEnvironmentVariable");
  assertFuse(fuseWire, FuseV1Options.EnableNodeCliInspectArguments, false, "EnableNodeCliInspectArguments");
  assertFuse(fuseWire, FuseV1Options.EnableEmbeddedAsarIntegrityValidation, true, "EnableEmbeddedAsarIntegrityValidation");
  assertFuse(fuseWire, FuseV1Options.OnlyLoadAppFromAsar, true, "OnlyLoadAppFromAsar");
  assertFuse(fuseWire, FuseV1Options.GrantFileProtocolExtraPrivileges, false, "GrantFileProtocolExtraPrivileges");

  await runPackagedSmoke(binary);
  console.log(`Packaged Electron smoke passed. ${binary}`);
}

async function runPackagedSmoke(binary) {
  const dataDir = await mkdtemp(join(tmpdir(), "masthead-electron-packaged-smoke-"));
  let homeDir;
  let child;
  let timeout;
  const verificationAbort = new AbortController();
  const commandChildren = new Set();
  try {
    homeDir = await mkdtemp(join(tmpdir(), "masthead-electron-packaged-home-"));
    const smokePort = await availablePort();
    const baseUrl = `http://127.0.0.1:${smokePort}`;
    const disableSandboxForCi = process.env.CI ? { ELECTRON_DISABLE_SANDBOX: "1" } : {};
    child = spawn(binary, [], {
      detached: process.platform !== "win32",
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

    const cliVerification = verifyPackagedAuthoringCli(
      baseUrl,
      homeDir,
      child,
      commandChildren,
      verificationAbort.signal
    ).then(
      (value) => ({ value }),
      (error) => ({ error })
    );
    const electronTimeout = new Promise((_resolve, reject) => {
      timeout = setTimeout(() => {
        void terminateChild(child, { processGroup: true });
        reject(new Error("Packaged Electron smoke timed out after 45 seconds."));
      }, 45_000);
    });
    const [[code], cliCheck] = await Promise.race([
      Promise.all([once(child, "exit"), cliVerification]),
      electronTimeout
    ]);
    clearTimeout(timeout);

    const jsonLine = stdout.split(/\r?\n/).find((line) => line.includes('"smoke":"electron"'));
    if (code !== 0 || !jsonLine) {
      throw new Error(stderr || stdout || `Packaged Electron smoke exited with ${code}`);
    }
    if ("error" in cliCheck) throw cliCheck.error;

    const parsed = JSON.parse(jsonLine);
    assertPackagedSmokeResult(parsed, dataDir, smokePort);
    await assertSmokeConnectorStopped(dataDir, smokePort);
  } finally {
    verificationAbort.abort();
    if (timeout) clearTimeout(timeout);
    await Promise.all([...commandChildren].map((commandChild) => terminateChild(commandChild)));
    await terminateChild(child, { processGroup: true });
    if (homeDir) await rm(homeDir, { force: true, recursive: true });
    await rm(dataDir, { force: true, recursive: true });
  }
}

async function verifyPackagedAuthoringCli(baseUrl, homeDir, child, commandChildren, signal) {
  let capabilities;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (signal.aborted) throw new Error("Packaged CLI verification was cancelled.");
    if (!isChildRunning(child)) throw new Error("Packaged Electron exited before CLI capabilities were available.");
    capabilities = await fetch(`${baseUrl}/workbench/authoring/capabilities`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(500)])
    })
      .then((response) => (response.ok ? response.json() : undefined))
      .catch(() => undefined);
    if (capabilities?.capability === "artifact_authoring" && capabilities?.command) break;
    await delay(250);
  }
  if (!capabilities?.command || !isAbsolute(capabilities.command)) {
    throw new Error(`Packaged daemon did not report an absolute authoring CLI command: ${JSON.stringify(capabilities)}`);
  }
  const commandRelativeToHome = relative(homeDir, capabilities.command);
  if (commandRelativeToHome.startsWith("..") || isAbsolute(commandRelativeToHome)) {
    throw new Error(`Packaged authoring CLI was installed outside the smoke HOME: ${capabilities.command}`);
  }
  await access(capabilities.command, process.platform === "win32" ? constants.R_OK : constants.X_OK);

  const result = await runCommand(
    capabilities.command,
    ["workbench", "capabilities", "--json"],
    { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    commandChildren
  );
  if (result.code !== 0) throw new Error(`Packaged authoring CLI failed: ${result.stderr || result.stdout}`);
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

function runCommand(command, args, env, commandChildren) {
  return new Promise((resolve, reject) => {
    const invocation = buildPackagedCliInvocation(command, args, {
      comspec: process.env.ComSpec || process.env.COMSPEC,
      platform: process.platform,
      systemRoot: process.env.SystemRoot || process.env.SYSTEMROOT
    });
    const commandChild = spawn(invocation.command, invocation.args, {
      env: { ...env, ...invocation.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    commandChildren.add(commandChild);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      void terminateChild(commandChild).finally(() => {
        if (settled) return;
        settled = true;
        commandChildren.delete(commandChild);
        reject(new Error(`Timed out invoking packaged authoring CLI: ${command}`));
      });
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
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      commandChildren.delete(commandChild);
      reject(error);
    });
    commandChild.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      commandChildren.delete(commandChild);
      if (timedOut) reject(new Error(`Timed out invoking packaged authoring CLI: ${command}`));
      else resolve({ code, stderr, stdout });
    });
  });
}

async function terminateChild(child, options = {}) {
  if (!child) return;
  const processGroupMayRemain = Boolean(options.processGroup && child.pid);
  if (!isChildRunning(child) && !processGroupMayRemain) return;

  if (options.processGroup && process.platform === "win32" && child.pid && isChildRunning(child)) {
    await terminateWindowsProcessTree(child.pid, false);
  } else {
    signalChild(child, "SIGTERM", options.processGroup);
  }
  await (processGroupMayRemain ? delay(750) : Promise.race([waitForChildExit(child), delay(750)]));

  if (options.processGroup && process.platform === "win32" && child.pid && isChildRunning(child)) {
    await terminateWindowsProcessTree(child.pid, true);
  } else if (options.processGroup && process.platform !== "win32" && child.pid && isProcessGroupRunning(child.pid)) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  } else if (isChildRunning(child)) {
    child.kill("SIGKILL");
  }
  await Promise.race([waitForChildExit(child), delay(750)]);
}

async function terminateWindowsProcessTree(pid, force) {
  const taskkill = win32.join(process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows", "System32", "taskkill.exe");
  const args = ["/pid", String(pid), "/t", ...(force ? ["/f"] : [])];
  const taskkillChild = spawn(taskkill, args, { stdio: "ignore" });
  await Promise.race([once(taskkillChild, "exit").catch(() => undefined), delay(750)]);
  if (isChildRunning(taskkillChild)) taskkillChild.kill("SIGKILL");
}

function isProcessGroupRunning(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalChild(child, signal, processGroup) {
  if (processGroup && process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to signalling the direct child.
    }
  }
  child.kill(signal);
}

function waitForChildExit(child) {
  if (!isChildRunning(child)) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

function isChildRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function assertPackagedSmokeResult(parsed, dataDir, smokePort) {
  if (parsed.connector?.smokeMode !== "renderer-autostart" || !parsed.connector?.message?.includes("Renderer autostart")) {
    throw new Error(`Packaged renderer autostart connector check failed: ${JSON.stringify(parsed.connector)}`);
  }
  if (
    !parsed.connector?.started ||
    parsed.connector?.health?.dataDirectory !== dataDir ||
    parsed.connector?.baseUrl !== `http://127.0.0.1:${smokePort}`
  ) {
    throw new Error(`Packaged renderer autostart did not start the expected connector: ${JSON.stringify(parsed.connector)}`);
  }
  if (!parsed.renderer?.hasDesktopBridge || parsed.renderer?.hasNodeProcess || parsed.renderer?.hasRequire || parsed.renderer?.hasRawIpc) {
    throw new Error(`Packaged renderer security check failed: ${JSON.stringify(parsed.renderer)}`);
  }
  if (!parsed.renderer?.hasCustomChrome) {
    throw new Error(`Packaged custom window chrome was not rendered: ${JSON.stringify(parsed.renderer)}`);
  }
  if (
    !parsed.renderer?.windowControls?.includes("Minimize window") ||
    !parsed.renderer?.windowControls?.includes("Maximize window") ||
    !parsed.renderer?.windowControls?.includes("Close window")
  ) {
    throw new Error(`Packaged custom window controls were not rendered: ${JSON.stringify(parsed.renderer)}`);
  }
}

function assertFuse(fuseWire, option, expected, name) {
  const enabled = fuseWire[option] === 49 || fuseWire[option] === "1";
  if (enabled !== expected) {
    throw new Error(
      `Packaged Electron fuse ${name} expected ${expected ? "enabled" : "disabled"} but was ${enabled ? "enabled" : "disabled"}.`
    );
  }
}

async function assertSmokeConnectorStopped(dataDir, smokePort) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const health = await fetch(`http://127.0.0.1:${smokePort}/health`, { signal: AbortSignal.timeout(500) })
      .then((response) => (response.ok ? response.json() : undefined))
      .catch(() => undefined);
    if (!health || health?.data?.dataDirectory !== dataDir) return;
    await delay(250);
  }
  throw new Error(`Packaged Electron smoke connector was still running from ${dataDir} after the app exited.`);
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
