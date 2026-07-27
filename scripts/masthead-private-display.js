#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const XVFB_PATH = "/usr/bin/Xvfb";
const XAUTH_PATH = "/usr/bin/xauth";
const XDPYINFO_PATH = "/usr/bin/xdpyinfo";
const PRIVATE_DISPLAY_TIMEOUT_MS = 10_000;
const PROCESS_CLEANUP_TIMEOUT_MS = 5_000;
const PRIVATE_ENV_MARKER = "MASTHEAD_PRIVATE_DISPLAY_TOKEN";
const DESKTOP_KEYS = new Set([
  "AT_SPI_BUS_ADDRESS",
  "DBUS_SESSION_BUS_ADDRESS",
  "DBUS_STARTER_ADDRESS",
  "DBUS_STARTER_BUS_TYPE",
  "DESKTOP_SESSION",
  "DESKTOP_STARTUP_ID",
  "DISPLAY",
  "ELECTRON_OZONE_PLATFORM_HINT",
  "GDK_BACKEND",
  "ICEAUTHORITY",
  "QT_QPA_PLATFORM",
  "SESSION_MANAGER",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "XDG_CURRENT_DESKTOP",
  "XDG_RUNTIME_DIR",
  "XDG_SEAT",
  "XDG_SESSION_CLASS",
  "XDG_SESSION_DESKTOP",
  "XDG_SESSION_ID",
  "XDG_SESSION_PATH",
  "XDG_SESSION_TYPE",
  "XDG_VTNR"
]);

export function privateDisplayEnvironment(environment, session) {
  const clean = Object.fromEntries(Object.entries(environment || {}).filter(([key]) => !DESKTOP_KEYS.has(key)));
  const result = {
    ...clean,
    DISPLAY: session.display,
    ELECTRON_OZONE_PLATFORM_HINT: "x11",
    GDK_BACKEND: "x11",
    MASTHEAD_HEADLESS: "1",
    MASTHEAD_PRIVATE_DISPLAY: session.display,
    MASTHEAD_PRIVATE_DISPLAY_AUTHORITY: session.authPath,
    MASTHEAD_PRIVATE_DISPLAY_RUNTIME: session.runtimeDir,
    [PRIVATE_ENV_MARKER]: session.runToken,
    NO_AT_BRIDGE: "1",
    QT_QPA_PLATFORM: "xcb",
    XAUTHORITY: session.authPath,
    XDG_RUNTIME_DIR: session.runtimeDir,
    XDG_SESSION_TYPE: "x11"
  };
  assertPrivateDisplayEnvironment(result);
  return result;
}

export function assertPrivateDisplayEnvironment(environment) {
  if (environment?.MASTHEAD_HEADLESS !== "1") throw new Error("Headless launch requires an attested private display marker.");
  if (!/^:[1-9]\d*$/u.test(environment.DISPLAY || "") || environment.DISPLAY !== environment.MASTHEAD_PRIVATE_DISPLAY) {
    throw new Error("Headless launch DISPLAY does not match the attested private display.");
  }
  if (
    !isAbsolute(environment.XAUTHORITY || "") ||
    environment.XAUTHORITY !== environment.MASTHEAD_PRIVATE_DISPLAY_AUTHORITY
  ) throw new Error("Headless launch Xauthority does not match the attested private display authority.");
  if (
    !isAbsolute(environment.XDG_RUNTIME_DIR || "") ||
    environment.XDG_RUNTIME_DIR !== environment.MASTHEAD_PRIVATE_DISPLAY_RUNTIME
  ) throw new Error("Headless launch runtime does not match the attested private display runtime.");
  if (typeof environment[PRIVATE_ENV_MARKER] !== "string" || environment[PRIVATE_ENV_MARKER].length < 32) {
    throw new Error("Headless launch private display token is missing or invalid.");
  }
  if (environment.WAYLAND_DISPLAY) throw new Error("Headless launch must not retain a Wayland display.");
  if ([
    "AT_SPI_BUS_ADDRESS", "DBUS_SESSION_BUS_ADDRESS", "DBUS_STARTER_ADDRESS",
    "DBUS_STARTER_BUS_TYPE", "ICEAUTHORITY", "SESSION_MANAGER"
  ].some((key) => environment[key])) {
    throw new Error("Headless launch must not retain the real desktop session bus.");
  }
  if (environment.XDG_SESSION_TYPE !== "x11" || environment.GDK_BACKEND !== "x11" || environment.QT_QPA_PLATFORM !== "xcb") {
    throw new Error("Headless launch must force the private X11 backend.");
  }
  return environment;
}

export function assertChildPrivateDisplayEnvironment(childEnvironment, expectedEnvironment) {
  const normalizedChild = childEnvironment.DBUS_SESSION_BUS_ADDRESS === "disabled:"
    ? { ...childEnvironment, DBUS_SESSION_BUS_ADDRESS: undefined }
    : childEnvironment;
  assertPrivateDisplayEnvironment(normalizedChild);
  assertPrivateDisplayEnvironment(expectedEnvironment);
  for (const key of [
    "DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "MASTHEAD_PRIVATE_DISPLAY",
    "MASTHEAD_PRIVATE_DISPLAY_AUTHORITY", "MASTHEAD_PRIVATE_DISPLAY_RUNTIME", PRIVATE_ENV_MARKER
  ]) {
    if (childEnvironment[key] !== expectedEnvironment[key]) {
      throw new Error(`Headless child environment escaped the private display at ${key}.`);
    }
  }
  return childEnvironment;
}

export async function withPrivateDisplay(callback, options = {}) {
  if (process.platform !== "linux") throw new Error("Private Masthead display isolation currently requires Linux Xvfb.");
  const parent = resolve(options.temporaryParent || options.environment?.TMPDIR || tmpdir());
  await assertPrivateTemporaryParent(parent);
  const root = await mkdtemp(join(parent, "masthead-private-display-"));
  await chmod(root, 0o700);
  const runtimeDir = join(root, "runtime");
  const authPath = join(root, "Xauthority");
  await mkdir(runtimeDir, { mode: 0o700 });
  const runToken = `${randomUUID()}${randomUUID()}`;
  let session;
  let callbackFailure;
  let cleaning = false;
  const signalHandlers = new Map();
  try {
    session = await startPrivateDisplay({
      authPath,
      environment: options.environment || process.env,
      realDisplay: options.environment?.DISPLAY,
      root,
      runToken,
      runtimeDir
    });
    const cleanupForSignal = async (signal) => {
      if (cleaning) return;
      cleaning = true;
      try {
        await cleanupPrivateDisplay(session);
      } catch (error) {
        process.stderr.write(`Private display signal cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`);
      } finally {
        process.exit(signalExitCode(signal));
      }
    };
    for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
      const handler = () => { void cleanupForSignal(signal); };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
    return await callback(session);
  } catch (error) {
    callbackFailure = error;
    throw error;
  } finally {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    if (!cleaning) {
      cleaning = true;
      try {
        if (session) await cleanupPrivateDisplay(session);
        else if (!callbackFailure?.preservePrivateDisplayRoot) await rm(root, { force: true, recursive: true });
      } catch (cleanupFailure) {
        if (callbackFailure) throw new AggregateError([callbackFailure, cleanupFailure], "Private display work and cleanup both failed.");
        throw cleanupFailure;
      }
    }
  }
}

async function startPrivateDisplay(input) {
  await Promise.all([
    assertTrustedExecutable(XVFB_PATH),
    assertTrustedExecutable(XAUTH_PATH),
    assertTrustedExecutable(XDPYINFO_PATH)
  ]);
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const displayNumber = randomInt(1000, 30000);
    const display = `:${displayNumber}`;
    if (display === input.realDisplay) continue;
    await rm(input.authPath, { force: true });
    const cookie = randomBytes(32).toString("hex");
    const xauth = await runCommand(XAUTH_PATH, ["-f", input.authPath, "add", display, "MIT-MAGIC-COOKIE-1", cookie], {
      ...minimalSystemEnvironment(input.environment),
      XDG_RUNTIME_DIR: input.runtimeDir
    });
    if (xauth.code !== 0) throw new Error(`Could not create private Xauthority: ${xauth.stderr || xauth.stdout}`);
    await chmod(input.authPath, 0o600);
    const environment = privateDisplayEnvironment(input.environment, {
      authPath: input.authPath,
      display,
      runtimeDir: input.runtimeDir,
      runToken: input.runToken
    });
    const xvfb = spawn(XVFB_PATH, [
      display,
      "-auth", input.authPath,
      "-nolisten", "tcp",
      "-screen", "0", "1280x720x24",
      "-noreset",
      "-nocursor"
    ], { env: environment, stdio: ["ignore", "ignore", "pipe"] });
    const identity = await captureProcessIdentity(xvfb.pid, XVFB_PATH).catch(() => undefined);
    const ready = await waitForPrivateDisplay(xvfb, environment);
    if (!ready) {
      await stopCapturedProcess(identity).catch(() => undefined);
      continue;
    }
    if (!identity) {
      await stopChild(xvfb);
      throw new Error("Private Xvfb process identity could not be captured.");
    }
    const socketPath = join("/tmp/.X11-unix", `X${displayNumber}`);
    try {
      await assertPrivateDisplayFilesystem(input.root, input.runtimeDir, input.authPath, socketPath);
      await proveCookieIsolation(environment, input.root);
      return {
        authPath: input.authPath,
        display,
        environment,
        identity,
        root: input.root,
        runToken: input.runToken,
        runtimeDir: input.runtimeDir,
        socketPath
      };
    } catch (error) {
      await terminateTokenBoundProcesses(input.runToken, identity).catch((cleanupError) => {
        const failure = new AggregateError([error, cleanupError], `Private Xvfb proof and cleanup both failed; preserved ${input.root}.`);
        failure.preservePrivateDisplayRoot = true;
        failure.privateDisplayRoot = input.root;
        throw failure;
      });
      await waitForMissingPath(socketPath);
      throw error;
    }
  }
  throw new Error("Could not allocate and prove a unique private Xvfb display after 32 attempts.");
}

async function cleanupPrivateDisplay(session) {
  const failures = [];
  try {
    await terminateTokenBoundProcesses(session.runToken, session.identity);
  } catch (error) {
    failures.push(error);
  }
  try {
    const remaining = await readCurrentIdentity(session.identity.pid);
    if (remaining && remaining.starttime === session.identity.starttime) {
      throw new Error(`Private Xvfb PID ${session.identity.pid} remained live after cleanup.`);
    }
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 0) {
    await rm(session.root, { force: true, recursive: true });
    await waitForMissingPath(session.socketPath);
  }
  if (failures.length > 0) throw new AggregateError(failures, `Private display cleanup failed; preserved ${session.root}.`);
}

async function terminateTokenBoundProcesses(runToken, xvfbIdentity) {
  const records = await tokenBoundProcessIdentities(runToken);
  const ordered = records.sort((left, right) => Number(left.pid === xvfbIdentity.pid) - Number(right.pid === xvfbIdentity.pid));
  for (const record of ordered) await signalCapturedProcess(record, "SIGTERM");
  const deadline = Date.now() + PROCESS_CLEANUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const remaining = await tokenBoundProcessIdentities(runToken);
    if (remaining.length === 0) return;
    await delay(25);
  }
  for (const record of await tokenBoundProcessIdentities(runToken)) await signalCapturedProcess(record, "SIGKILL");
  const killDeadline = Date.now() + PROCESS_CLEANUP_TIMEOUT_MS;
  while (Date.now() < killDeadline) {
    if ((await tokenBoundProcessIdentities(runToken)).length === 0) return;
    await delay(25);
  }
  throw new Error("Private display token-bound process set did not become empty after cleanup.");
}

async function tokenBoundProcessIdentities(runToken) {
  const uid = typeof process.geteuid === "function" ? process.geteuid() : process.getuid?.();
  const entries = await readdir("/proc", { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
    const pid = Number(entry.name);
    if (pid === process.pid) continue;
    const processRoot = join("/proc", entry.name);
    try {
      const ownership = await stat(processRoot);
      if (ownership.uid !== uid) continue;
      const environment = await readFile(join(processRoot, "environ"));
      if (!environment.toString("utf8").split("\0").includes(`${PRIVATE_ENV_MARKER}=${runToken}`)) continue;
      const identity = await readCurrentIdentity(pid);
      if (identity) records.push(identity);
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(error?.code)) throw error;
    }
  }
  return records;
}

async function captureProcessIdentity(pid, expectedExecutable) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Private display process PID was not available.");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const identity = await readCurrentIdentity(pid);
    if (identity) {
      if (identity.executable !== expectedExecutable) throw new Error("Private display executable identity changed during startup.");
      return identity;
    }
    await delay(10);
  }
  throw new Error("Private display process identity could not be captured.");
}

async function readCurrentIdentity(pid) {
  try {
    const [executable, statLine] = await Promise.all([
      realpath(join("/proc", String(pid), "exe")),
      readFile(join("/proc", String(pid), "stat"), "utf8")
    ]);
    const close = statLine.lastIndexOf(")");
    const fields = close >= 0 ? statLine.slice(close + 2).trim().split(/\s+/u) : [];
    if (!fields[19]) throw new Error(`Process ${pid} start identity is malformed.`);
    return { executable, pid, starttime: fields[19] };
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes(error?.code)) return undefined;
    throw error;
  }
}

async function signalCapturedProcess(record, signal) {
  const current = await readCurrentIdentity(record.pid);
  if (!current) return;
  if (current.starttime !== record.starttime || current.executable !== record.executable) {
    throw new Error(`Private display process PID ${record.pid} identity changed; refusing to signal it.`);
  }
  process.kill(record.pid, signal);
}

async function stopCapturedProcess(identity) {
  if (!identity) return;
  await signalCapturedProcess(identity, "SIGTERM");
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolvePromise) => child.once("close", resolvePromise)), delay(1_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolvePromise) => child.once("close", resolvePromise));
  }
}

async function waitForPrivateDisplay(child, environment) {
  const deadline = Date.now() + PRIVATE_DISPLAY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    const probe = await runCommand(XDPYINFO_PATH, ["-display", environment.DISPLAY], environment, 1_000);
    if (probe.code === 0) return true;
    await delay(25);
  }
  await stopChild(child);
  throw new Error("Private Xvfb display did not become ready before the isolation deadline.");
}

async function proveCookieIsolation(environment, root) {
  const wrongAuth = join(root, "wrong-Xauthority");
  const wrongCookie = randomBytes(32).toString("hex");
  const xauth = await runCommand(XAUTH_PATH, ["-f", wrongAuth, "add", environment.DISPLAY, "MIT-MAGIC-COOKIE-1", wrongCookie], environment);
  if (xauth.code !== 0) throw new Error("Could not create the negative private-display authority proof.");
  await chmod(wrongAuth, 0o600);
  const rejected = await runCommand(XDPYINFO_PATH, ["-display", environment.DISPLAY], { ...environment, XAUTHORITY: wrongAuth }, 2_000);
  await rm(wrongAuth, { force: true });
  if (rejected.code === 0) throw new Error("Private Xvfb accepted a client without its unique authority cookie.");
}

async function assertPrivateDisplayFilesystem(root, runtimeDir, authPath, socketPath) {
  const [rootInfo, runtimeInfo, authInfo, socketInfo] = await Promise.all([
    lstat(root), lstat(runtimeDir), lstat(authPath), lstat(socketPath)
  ]);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (rootInfo.mode & 0o777) !== 0o700) {
    throw new Error("Private display root is not an exact mode-0700 directory.");
  }
  if (!runtimeInfo.isDirectory() || runtimeInfo.isSymbolicLink() || (runtimeInfo.mode & 0o777) !== 0o700) {
    throw new Error("Private display runtime is not an exact mode-0700 directory.");
  }
  if (!authInfo.isFile() || authInfo.isSymbolicLink() || authInfo.nlink !== 1 || (authInfo.mode & 0o777) !== 0o600) {
    throw new Error("Private display authority is not an exact private file.");
  }
  if (!socketInfo.isSocket() || socketInfo.isSymbolicLink()) throw new Error("Private display socket identity is invalid.");
}

async function assertPrivateTemporaryParent(parent) {
  const info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(parent) !== parent) {
    throw new Error("Private display temporary parent must be a canonical real directory.");
  }
}

async function assertTrustedExecutable(path) {
  const canonical = await realpath(path);
  const [entry, info] = await Promise.all([lstat(path), lstat(canonical)]);
  const currentUid = typeof process.geteuid === "function" ? process.geteuid() : process.getuid?.();
  if (
    (!entry.isFile() && !entry.isSymbolicLink()) || !info.isFile() || info.isSymbolicLink() ||
    info.uid === currentUid || (info.mode & 0o022) !== 0 || (info.mode & 0o111) === 0 ||
    !canonical.startsWith("/usr/")
  ) {
    throw new Error(`Private display dependency is not an exact root-owned executable: ${path}.`);
  }
}

function minimalSystemEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment || {}).filter(([key]) => !DESKTOP_KEYS.has(key)));
}

async function runCommand(executable, args, environment, timeoutMs = PRIVATE_DISPLAY_TIMEOUT_MS) {
  const child = spawn(executable, args, { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  let timer;
  const timeout = new Promise((resolvePromise) => {
    timer = setTimeout(() => resolvePromise({ code: null, timedOut: true }), timeoutMs);
  });
  const completion = new Promise((resolvePromise) => {
    child.once("error", (error) => resolvePromise({ error }));
    child.once("close", (code, signal) => resolvePromise({ code, signal }));
  });
  const result = await Promise.race([completion, timeout]);
  clearTimeout(timer);
  if (result.timedOut && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolvePromise) => child.once("close", resolvePromise));
  }
  if (result.error) throw result.error;
  return {
    code: result.code,
    signal: result.signal,
    stderr: Buffer.concat(stderr).toString("utf8").trim(),
    stdout: Buffer.concat(stdout).toString("utf8").trim()
  };
}

async function waitForMissingPath(path) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await lstat(path);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    await delay(25);
  }
  throw new Error(`Private display socket remained after cleanup: ${path}.`);
}

function signalExitCode(signal) {
  return signal === "SIGHUP" ? 129 : signal === "SIGINT" ? 130 : 143;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
