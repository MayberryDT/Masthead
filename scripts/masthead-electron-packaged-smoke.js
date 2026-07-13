#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, win32 } from "node:path";
import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { buildPackagedCliInvocation } from "./packaged-cli-command.js";
import { verifyPackagedBundleManifest } from "./packaged-bundle-manifest.js";
import {
  buildWindowsProcessSnapshotInvocation,
  buildWindowsTaskkillInvocation,
  parseWindowsListenerPid,
  parseWindowsProcessSnapshot,
  windowsProcessBelongsToTree
} from "./packaged-process-cleanup.js";

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
  await access(join(resources, "scripts", "masthead-production.js"), constants.R_OK);
  await access(join(resourceRoot, "release-manifest.json"), constants.R_OK);
  const release = JSON.parse(await readFile(join(resources, "release.json"), "utf8"));
  if (!/^[a-f0-9]{40}$/u.test(release.gitSha) || typeof release.version !== "string" || !release.version) {
    throw new Error(`Packaged release identity is invalid: ${JSON.stringify(release)}`);
  }
  await verifyPackagedBundleManifest({
    bundleRoot: dirname(binary),
    executablePath: binary,
    resourcesPath: resourceRoot
  });

  const fuseWire = await getCurrentFuseWire(binary);
  assertFuse(fuseWire, FuseV1Options.RunAsNode, false, "RunAsNode");
  assertFuse(fuseWire, FuseV1Options.EnableNodeOptionsEnvironmentVariable, false, "EnableNodeOptionsEnvironmentVariable");
  assertFuse(fuseWire, FuseV1Options.EnableNodeCliInspectArguments, false, "EnableNodeCliInspectArguments");
  assertFuse(fuseWire, FuseV1Options.EnableEmbeddedAsarIntegrityValidation, true, "EnableEmbeddedAsarIntegrityValidation");
  assertFuse(fuseWire, FuseV1Options.OnlyLoadAppFromAsar, true, "OnlyLoadAppFromAsar");
  assertFuse(fuseWire, FuseV1Options.GrantFileProtocolExtraPrivileges, false, "GrantFileProtocolExtraPrivileges");

  await runPackagedSmoke(binary, release);
  console.log(`Packaged Electron smoke passed. ${binary}`);
}

async function runPackagedSmoke(binary, release) {
  const dataDir = await mkdtemp(join(tmpdir(), "masthead-electron-packaged-smoke-"));
  let homeDir;
  let child;
  let electronProcessTree;
  let smokePort;
  let timeout;
  let primaryError;
  let cleanupError;
  const verificationAbort = new AbortController();
  const commandChildren = new Map();
  try {
    homeDir = await mkdtemp(join(tmpdir(), "masthead-electron-packaged-home-"));
    smokePort = await availablePort();
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
        MASTHEAD_BUILD_SHA: release.gitSha,
        MASTHEAD_BUILD_VERSION: release.version,
        MASTHEAD_PORT: String(smokePort),
        MASTHEAD_GIT_REFRESH_MS: "0"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    electronProcessTree = startWindowsProcessTreeTracker(child.pid);

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
        const timeoutError = new Error("Packaged Electron smoke timed out after 45 seconds.");
        void terminateChild(child, { processGroup: true, windowsProcessTree: electronProcessTree }).then(
          () => reject(timeoutError),
          (error) => reject(combineErrors(timeoutError, error, timeoutError.message))
        );
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
    assertPackagedSmokeResult(parsed, dataDir, smokePort, release);
  } catch (error) {
    primaryError = error;
  } finally {
    verificationAbort.abort();
    if (timeout) clearTimeout(timeout);
    try {
      await cleanupPackagedProcesses(commandChildren, child, electronProcessTree, dataDir, smokePort);
    } catch (error) {
      cleanupError = error;
    }

    if (!cleanupError) {
      try {
        if (homeDir) await rm(homeDir, { force: true, recursive: true });
        await rm(dataDir, { force: true, recursive: true });
      } catch (error) {
        cleanupError = error;
      }
    }
  }

  if (primaryError) {
    if (cleanupError) throw combineErrors(primaryError, cleanupError, "Packaged smoke failed and cleanup also failed.");
    throw primaryError;
  }
  if (cleanupError) throw cleanupError;
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
      detached: process.platform !== "win32",
      env: { ...env, ...invocation.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const windowsProcessTree = startWindowsProcessTreeTracker(commandChild.pid);
    commandChildren.set(commandChild, windowsProcessTree);
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      const timeoutError = new Error(`Timed out invoking packaged authoring CLI: ${command}`);
      void terminateChild(commandChild, { processTree: true, windowsProcessTree }).then(
        () => {
          reject(timeoutError);
        },
        (error) => {
          reject(combineErrors(timeoutError, error, timeoutError.message));
        }
      );
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
      reject(error);
    });
    commandChild.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, stderr, stdout });
    });
  });
}

function startWindowsProcessTreeTracker(rootPid) {
  if (process.platform !== "win32" || !rootPid) return undefined;
  const tracker = {
    attributedProcesses: new Map(),
    pending: undefined,
    rootIdentity: undefined,
    rootPid,
    snapshot: [],
    timer: undefined
  };
  const poll = () => {
    void refreshWindowsProcessTree(tracker).catch(() => undefined);
  };
  tracker.timer = setInterval(poll, 500);
  tracker.timer.unref();
  poll();
  return tracker;
}

async function stopWindowsProcessTreeTracker(tracker) {
  if (!tracker) return;
  if (tracker.timer) clearInterval(tracker.timer);
  if (tracker.pending) await tracker.pending.catch(() => undefined);
  await refreshWindowsProcessTree(tracker);
}

function refreshWindowsProcessTree(tracker) {
  if (!tracker) return Promise.resolve();
  if (tracker.pending) return tracker.pending;
  tracker.pending = queryWindowsProcessSnapshot()
    .then((snapshot) => {
      tracker.snapshot = snapshot;
      if (!tracker.rootIdentity) {
        const root = snapshot.find((processRecord) => processRecord.pid === tracker.rootPid);
        if (root) {
          tracker.rootIdentity = { creationTime: root.creationTime, pid: root.pid };
          tracker.attributedProcesses.set(root.pid, tracker.rootIdentity);
        }
      }
      const attributed = [...tracker.attributedProcesses.values()];
      for (const processRecord of snapshot) {
        const identity = { creationTime: processRecord.creationTime, pid: processRecord.pid };
        if (windowsProcessBelongsToTree(snapshot, identity, attributed)) {
          tracker.attributedProcesses.set(identity.pid, identity);
        }
      }
    })
    .finally(() => {
      tracker.pending = undefined;
    });
  return tracker.pending;
}

async function queryWindowsProcessSnapshot() {
  const invocation = buildWindowsProcessSnapshotInvocation(
    process.env.SystemRoot || process.env.SYSTEMROOT
  );
  const result = await runBoundedProcess(invocation.command, invocation.args, 3_000);
  if (result.code !== 0) {
    throw new Error(`Windows process snapshot failed: ${result.stderr}`);
  }
  return parseWindowsProcessSnapshot(result.stdout);
}

function attributedWindowsPidsStillRunning(tracker) {
  return [...tracker.attributedProcesses.values()].flatMap((identity) => {
    const current = tracker.snapshot.find((processRecord) => processRecord.pid === identity.pid);
    return current?.creationTime === identity.creationTime ? [identity.pid] : [];
  });
}

async function terminateAttributedWindowsProcesses(tracker) {
  if (!tracker) return;
  await refreshWindowsProcessTree(tracker);
  const runningPids = attributedWindowsPidsStillRunning(tracker);
  for (const pid of runningPids) {
    await terminateWindowsProcessTree(pid, true);
  }
}

async function terminateChild(child, options = {}) {
  if (!child) return;
  const ownsProcessTree = Boolean((options.processGroup || options.processTree) && child.pid);
  const processGroupMayRemain = Boolean(ownsProcessTree && process.platform !== "win32" && child.pid);
  const windowsProcessTreeMayRemain = Boolean(
    ownsProcessTree && process.platform === "win32" && options.windowsProcessTree
  );
  if (!isChildRunning(child) && !processGroupMayRemain && !windowsProcessTreeMayRemain) return;

  if (ownsProcessTree && process.platform === "win32") {
    const processTree = options.windowsProcessTree || startWindowsProcessTreeTracker(child.pid);
    await stopWindowsProcessTreeTracker(processTree);
    if (child.pid && isChildRunning(child)) await terminateWindowsProcessTree(child.pid, false);
    await delay(750);
    await terminateAttributedWindowsProcesses(processTree);
    if (child.pid && isChildRunning(child)) await terminateWindowsProcessTree(child.pid, true);
    await assertProcessTreeStopped(child, { processGroup: true, windowsProcessTree: processTree });
    return;
  }

  signalChild(child, "SIGTERM", ownsProcessTree);
  await (processGroupMayRemain ? delay(750) : Promise.race([waitForChildExit(child), delay(750)]));

  if (ownsProcessTree && process.platform !== "win32" && child.pid && isProcessGroupRunning(child.pid)) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  } else if (isChildRunning(child)) {
    child.kill("SIGKILL");
  }
  await assertProcessTreeStopped(child, { processGroup: ownsProcessTree });
}

async function terminateWindowsProcessTree(pid, force) {
  const invocation = buildWindowsTaskkillInvocation(
    pid,
    force,
    process.env.SystemRoot || process.env.SYSTEMROOT
  );
  await runBoundedProcess(invocation.command, invocation.args, 1_500);
}

async function assertProcessTreeStopped(child, options = {}) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const directRunning = isChildRunning(child);
    let attributedWindowsProcessesRunning = false;
    if (process.platform === "win32" && options.windowsProcessTree) {
      await refreshWindowsProcessTree(options.windowsProcessTree);
      attributedWindowsProcessesRunning = attributedWindowsPidsStillRunning(options.windowsProcessTree).length > 0;
    }
    const groupRunning = Boolean(
      options.processGroup && process.platform !== "win32" && child?.pid && isProcessGroupRunning(child.pid)
    );
    if (!directRunning && !groupRunning && !attributedWindowsProcessesRunning) return;
    await delay(100);
  }
  throw new Error(`Could not stop packaged smoke process tree rooted at PID ${child?.pid ?? "unknown"}.`);
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

async function cleanupPackagedProcesses(commandChildren, electronChild, electronProcessTree, dataDir, smokePort) {
  const errors = [];
  for (const [commandChild, windowsProcessTree] of commandChildren) {
    try {
      await terminateChild(commandChild, { processTree: true, windowsProcessTree });
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await terminateChild(electronChild, { processGroup: true, windowsProcessTree: electronProcessTree });
  } catch (error) {
    errors.push(error);
  }
  if (smokePort) {
    try {
      await cleanupSmokeConnector(dataDir, smokePort, electronProcessTree);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Multiple packaged smoke process trees could not be stopped.");
}

async function cleanupSmokeConnector(dataDir, smokePort, electronProcessTree) {
  if (process.platform === "win32") {
    const listenerPid = await waitForWindowsSmokeListener(smokePort, electronProcessTree);
    if (!listenerPid) return;
    await terminateWindowsProcessTree(listenerPid, true);
    await assertWindowsListenerStopped(smokePort, listenerPid);
    return;
  }

  const health = await readSmokeHealth(smokePort);
  if (!health || health?.data?.dataDirectory !== dataDir) return;
  await assertSmokeConnectorStopped(dataDir, smokePort);
}

async function waitForWindowsSmokeListener(smokePort, electronProcessTree) {
  let unexpectedListenerPid;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const listenerPid = await findWindowsListenerPid(smokePort);
    if (listenerPid) {
      unexpectedListenerPid = listenerPid;
      if (electronProcessTree) {
        await refreshWindowsProcessTree(electronProcessTree);
        const listener = electronProcessTree.snapshot.find((processRecord) => processRecord.pid === listenerPid);
        if (
          listener && windowsProcessBelongsToTree(
            electronProcessTree.snapshot,
            { creationTime: listener.creationTime, pid: listener.pid },
            electronProcessTree.attributedProcesses.values()
          )
        ) {
          electronProcessTree.attributedProcesses.set(listener.pid, {
            creationTime: listener.creationTime,
            pid: listener.pid
          });
          return listenerPid;
        }
      }
    }
    await delay(200);
  }
  if (unexpectedListenerPid) {
    throw new Error(
      `Port ${smokePort} remained owned by unrelated PID ${unexpectedListenerPid}; it was not terminated.`
    );
  }
  return undefined;
}

async function findWindowsListenerPid(port) {
  const command = win32.join(
    process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows",
    "System32",
    "netstat.exe"
  );
  const result = await runBoundedProcess(command, ["-ano", "-p", "tcp"], 2_000);
  if (result.code !== 0) {
    throw new Error(`Windows netstat failed while locating smoke port ${port}: ${result.stderr}`);
  }
  return parseWindowsListenerPid(result.stdout, port);
}

async function assertWindowsListenerStopped(port, expectedPid) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const listenerPid = await findWindowsListenerPid(port);
    if (!listenerPid) return;
    if (listenerPid !== expectedPid) {
      throw new Error(`Port ${port} was claimed by unrelated PID ${listenerPid} during packaged smoke cleanup.`);
    }
    await delay(100);
  }
  throw new Error(`Could not stop packaged smoke listener PID ${expectedPid} on port ${port}.`);
}

function runBoundedProcess(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Process cleanup command timed out: ${command}`));
    }, timeoutMs);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, stderr, stdout });
    });
  });
}

function combineErrors(primaryError, cleanupError, message) {
  const primary = primaryError instanceof Error ? primaryError : new Error(String(primaryError));
  const cleanup = cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError));
  return new AggregateError([primary, cleanup], `${message} ${primary.message}`, { cause: primary });
}

function assertPackagedSmokeResult(parsed, dataDir, smokePort, release) {
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
  if (
    parsed.connector?.health?.buildVersion !== release.version ||
    parsed.connector?.health?.buildSha !== release.gitSha
  ) {
    throw new Error(`Packaged health identity does not match release.json: ${JSON.stringify(parsed.connector?.health)}`);
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
    const health = await readSmokeHealth(smokePort);
    if (!health || health?.data?.dataDirectory !== dataDir) return;
    await delay(250);
  }
  throw new Error(`Packaged Electron smoke connector was still running from ${dataDir} after the app exited.`);
}

function readSmokeHealth(smokePort) {
  return fetch(`http://127.0.0.1:${smokePort}/health`, { signal: AbortSignal.timeout(500) })
    .then((response) => (response.ok ? response.json() : undefined))
    .catch(() => undefined);
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
