#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { verifyPackagedBundleManifest } from "./packaged-bundle-manifest.js";

const DEFAULT_PORT = 17383;
const VERSIONED_TARGET = /^Masthead-linux-x64-[A-Za-z0-9][A-Za-z0-9._+-]*$/u;

export async function acquireLifecycleLease(leasePath) {
  await mkdir(dirname(leasePath), { recursive: true });
  const database = new DatabaseSync(leasePath);
  try {
    database.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;");
  } catch (error) {
    database.close();
    if (error instanceof Error && /database is (?:busy|locked)/iu.test(error.message)) {
      throw new Error(`Another Masthead production lifecycle command is already running through ${leasePath}.`, {
        cause: error
      });
    }
    throw error;
  }
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      try {
        database.exec("ROLLBACK;");
      } finally {
        database.close();
      }
    }
  };
}

export async function installProductionLauncher(input) {
  const productionRoot = resolve(input.productionRoot || join(input.homeDir || homedir(), ".local", "share", "masthead-production"));
  const requestedTarget = resolve(input.bundlePath || "");
  if (!input.bundlePath || dirname(requestedTarget) !== productionRoot || !VERSIONED_TARGET.test(basename(requestedTarget))) {
    throw new Error(`Production bundle must be a versioned direct child of ${productionRoot}.`);
  }
  if ((await lstat(requestedTarget)).isSymbolicLink()) {
    throw new Error(`Production bundle must not be a symbolic link: ${requestedTarget}.`);
  }
  const target = await realpath(requestedTarget).catch(() => {
    throw new Error(`Production bundle does not exist: ${requestedTarget}`);
  });
  const bundleManifest = await verifyPinnedBundle(target, input.bundleDigest);
  if (dirname(target) !== await realpath(productionRoot) || !VERSIONED_TARGET.test(basename(target))) {
    throw new Error(`Production bundle must resolve to a direct child of ${productionRoot}.`);
  }
  const currentPath = join(productionRoot, "current");
  const currentTarget = await realpath(currentPath).catch(() => undefined);
  if (currentTarget !== target) {
    throw new Error(`Production current symlink ${currentPath} must resolve to ${target} before installing launchers.`);
  }

  const release = await readRelease(target);
  const runtime = productionRuntimePaths(target);
  await Promise.all([
    access(runtime.executable, constants.X_OK),
    access(runtime.node, constants.X_OK),
    access(runtime.lifecycle, constants.R_OK),
    access(runtime.daemonEntry, constants.R_OK)
  ]);

  const homeDir = resolve(input.homeDir || homedir());
  const binDirectory = join(homeDir, ".local", "bin");
  const applicationDirectory = join(homeDir, ".local", "share", "applications");
  const launcherPath = join(binDirectory, "masthead-production");
  const desktopPath = join(applicationDirectory, "ai.animas.masthead.desktop");
  const dataDirectory = resolve(input.dataDirectory || join(homeDir, ".config", "masthead-production"));
  const databasePath = resolve(input.databasePath || join(dataDirectory, "masthead.sqlite"));
  const port = validPort(input.port ?? DEFAULT_PORT);
  await Promise.all([mkdir(binDirectory, { recursive: true }), mkdir(applicationDirectory, { recursive: true })]);

  const wrapper = productionWrapper({
    dataDirectory,
    databasePath,
    gitSha: release.gitSha,
    bundleDigest: bundleManifest.bundleDigest,
    lifecycleLeasePath: join(homeDir, ".local", "state", "masthead-production", "launcher.lease.sqlite"),
    port,
    productionRoot,
    target,
    version: release.version
  });
  const desktop = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Masthead",
    `Exec=${launcherPath}`,
    `Icon=${join(target, "resources", "masthead-logo-sail.png")}`,
    "Terminal=false",
    "Categories=Development;",
    ""
  ].join("\n");
  await atomicWrite(launcherPath, wrapper, 0o755);
  await atomicWrite(desktopPath, desktop, 0o644);
  return { desktopPath, gitSha: release.gitSha, launcherPath, target, version: release.version };
}

export async function transitionProduction(input, dependencyOverrides = {}) {
  const homeDir = resolve(input.homeDir || homedir());
  const productionRoot = resolve(input.productionRoot || join(homeDir, ".local", "share", "masthead-production"));
  const requestedTarget = resolve(input.bundlePath || "");
  if (!input.bundlePath || dirname(requestedTarget) !== productionRoot || !VERSIONED_TARGET.test(basename(requestedTarget))) {
    throw new Error(`Production bundle must be a versioned direct child of ${productionRoot}.`);
  }
  if ((await lstat(requestedTarget)).isSymbolicLink()) {
    throw new Error(`Production bundle must not be a symbolic link: ${requestedTarget}.`);
  }
  const target = await realpath(requestedTarget);
  const canonicalProductionRoot = await realpath(productionRoot);
  if (dirname(target) !== canonicalProductionRoot || !VERSIONED_TARGET.test(basename(target))) {
    throw new Error(`Production bundle must resolve to a direct child of ${canonicalProductionRoot}.`);
  }
  await verifyPinnedBundle(target, input.bundleDigest);
  const release = await readRelease(target);
  const runtime = productionRuntimePaths(target);
  await Promise.all([
    access(runtime.executable, constants.X_OK),
    access(runtime.node, constants.X_OK),
    access(runtime.lifecycle, constants.R_OK),
    access(runtime.daemonEntry, constants.R_OK)
  ]);
  const dataDirectory = resolve(input.dataDirectory || join(homeDir, ".config", "masthead-production"));
  const config = await completeConfig({
    bundleDigest: input.bundleDigest,
    dataDirectory,
    databasePath: input.databasePath || join(dataDirectory, "masthead.sqlite"),
    gitSha: release.gitSha,
    lifecycleLeasePath: join(homeDir, ".local", "state", "masthead-production", "launcher.lease.sqlite"),
    port: input.port ?? DEFAULT_PORT,
    productionRoot,
    target,
    version: release.version
  });
  const noLifecycleLease = async () => ({ release: async () => undefined });
  const dependencies = {
    acquireLease: () => acquireLifecycleLease(config.lifecycleLeasePath),
    activateLaunchers: (staged) => activateStagedLaunchers(staged),
    currentTarget: () => realpath(join(productionRoot, "current")).catch(() => undefined),
    restoreCurrent: (_oldTarget) => swapCurrentTarget(productionRoot, _oldTarget),
    restoreLaunchers: (staged) => restoreStagedLaunchers(staged),
    cleanupBundles: () => cleanupOldProductionBundles(productionRoot, target),
    stageLaunchers: () => stageProductionLaunchers({ ...input, bundlePath: target, homeDir, productionRoot }),
    start: (candidate = config) => startProduction(candidate, { acquireLease: noLifecycleLease }),
    stop: () => stopProduction(config, { acquireLease: noLifecycleLease }),
    swapCurrent: () => swapCurrentTarget(productionRoot, target),
    ...dependencyOverrides
  };
  const lease = await dependencies.acquireLease();
  let staged;
  let oldTarget;
  try {
    oldTarget = await dependencies.currentTarget();
    staged = await dependencies.stageLaunchers(config);
    const stopReceipt = await dependencies.stop(config);
    let started;
    try {
      await dependencies.swapCurrent(productionRoot, target);
      await dependencies.activateLaunchers(staged);
      started = await dependencies.start(config);
    } catch (error) {
      let restarted = false;
      try {
        if (oldTarget) await dependencies.restoreCurrent(oldTarget);
        await dependencies.restoreLaunchers(staged);
        if (oldTarget) {
          const oldRelease = await readRelease(oldTarget);
          const oldDigest = pinnedDigestFromLauncherSnapshot(staged.previousLauncher);
          const oldConfig = { ...config, bundleDigest: oldDigest, gitSha: oldRelease.gitSha, target: oldTarget, version: oldRelease.version };
          await dependencies.start(oldConfig);
          restarted = true;
        }
      } catch {
        restarted = false;
      }
      throw new Error(`${error instanceof Error ? error.message : String(error)}; rollback restarted=${restarted}`, { cause: error });
    }
    await dependencies.cleanupBundles(productionRoot, target);
    return { activated: true, started, stopped: stopReceipt, target };
  } finally {
    if (staged) await discardStagedLaunchers(staged);
    await lease.release();
  }
}

export function classifyProductionProcess(record, config) {
  if (!record || !Number.isSafeInteger(record.pid) || record.pid <= 0 || !record.starttime) return undefined;
  const productionRoot = resolve(config.productionRoot);
  const executableIdentity = normalizeProcExecutable(record.exe);
  const target = productionTargetForPath(executableIdentity, productionRoot);
  if (!target) return undefined;
  const runtime = productionRuntimePaths(target);
  const args = Array.isArray(record.argv) ? record.argv : [];
  const environment = record.environ || {};
  if (
    resolve(executableIdentity) === runtime.executable &&
    resolve(args[0] || "") === runtime.executable &&
    args.includes(`--user-data-dir=${resolve(config.dataDirectory)}`) &&
    resolve(environment.MASTHEAD_DATA_DIR || "") === resolve(config.dataDirectory) &&
    resolve(environment.MASTHEAD_DB_PATH || "") === resolve(config.databasePath) &&
    !args.some((argument) => argument.startsWith("--type="))
  ) {
    return { ...record, role: "electron", target };
  }
  if (
    resolve(executableIdentity) === runtime.node &&
    resolve(args[0] || "") === runtime.node &&
    resolve(args[1] || "") === runtime.daemonEntry &&
    resolve(environment.MASTHEAD_DATA_DIR || "") === resolve(config.dataDirectory) &&
    resolve(environment.MASTHEAD_DB_PATH || "") === resolve(config.databasePath)
  ) {
    return { ...record, role: "daemon", target };
  }
  return undefined;
}

function normalizeProcExecutable(path) {
  if (typeof path !== "string") return path;
  const deletedSuffix = " (deleted)";
  if (!path.endsWith(deletedSuffix)) return path;
  const normalized = path.slice(0, -deletedSuffix.length);
  return normalized.endsWith(deletedSuffix) ? path : normalized;
}

export async function startProduction(configInput, dependencyOverrides = {}) {
  const config = await completeConfig(configInput);
  await verifyPinnedBundle(config.target, config.bundleDigest);
  const dependencies = { ...defaultDependencies(config), ...dependencyOverrides };
  const lease = await dependencies.acquireLease();
  try {
    const current = await dependencies.currentTarget();
    if (current !== config.target) throw new Error(`Production current target changed: expected ${config.target}, found ${current || "missing"}.`);
    const processes = await classifiedProcesses(config, dependencies);
    const oldProcesses = processes.filter((processRecord) => processRecord.target !== config.target);
    if (oldProcesses.length > 0) {
      throw new Error(`Refusing to start while an old production target is running: ${formatProcesses(oldProcesses)}.`);
    }
    const pinnedProcesses = processes.filter((processRecord) => processRecord.target === config.target);
    const health = await dependencies.fetchHealth();
    if (pinnedProcesses.length > 0) {
      assertPinnedTopology(pinnedProcesses, config.target);
      assertMatchingHealth(health, config);
      return { alreadyRunning: true, started: false, pids: pinnedProcesses.map((record) => record.pid).sort((a, b) => a - b) };
    }
    if (health) throw new Error(`Refusing to start because port ${config.port} serves a process that is not the pinned production target.`);
    if (!(await dependencies.portBindable())) throw new Error(`Refusing to start because port ${config.port} is occupied by an unrelated listener.`);
    await dependencies.ownershipProbe();
    const launch = {
      args: [`--user-data-dir=${config.dataDirectory}`],
      env: {
        ...process.env,
        MASTHEAD_BUILD_SHA: config.gitSha,
        MASTHEAD_BUILD_VERSION: config.version,
        MASTHEAD_BUNDLE_DIGEST: config.bundleDigest,
        MASTHEAD_DATA_DIR: config.dataDirectory,
        MASTHEAD_DB_PATH: config.databasePath,
        MASTHEAD_PORT: String(config.port),
        MASTHEAD_PRODUCTION_ROOT: config.productionRoot,
        MASTHEAD_PRODUCTION_TARGET: config.target
      },
      executable: productionRuntimePaths(config.target).executable
    };
    const pid = await dependencies.spawnElectron(launch);
    const captured = await dependencies.captureSpawned(pid);
    try {
      const startedHealth = await dependencies.waitForHealth();
      assertMatchingHealth(startedHealth, config);
      assertPinnedTopology(await classifiedProcesses(config, dependencies), config.target);
      return { health: startedHealth, pid, started: true };
    } catch (error) {
      const cleanup = dependencies.cleanupSpawned
        ? await dependencies.cleanupSpawned(captured, dependencies)
        : await cleanupFailedStart(captured, config, dependencies);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; cleanup stopped=${cleanup.stopped}`,
        { cause: error }
      );
    }
  } finally {
    await lease.release();
  }
}

export async function stopProduction(configInput, dependencyOverrides = {}) {
  const config = await completeConfig(configInput);
  const dependencies = { ...defaultDependencies(config), ...dependencyOverrides };
  const lease = await dependencies.acquireLease();
  try {
    return await stopInsideLifecycleLease(config, dependencies);
  } finally {
    await lease.release();
  }
}

export async function statusProduction(configInput, dependencyOverrides = {}) {
  const config = await completeConfig(configInput);
  const dependencies = { ...defaultDependencies(config), ...dependencyOverrides };
  const processes = await classifiedProcesses(config, dependencies);
  const health = await dependencies.fetchHealth();
  const matching = Boolean(health && healthMatches(health, config));
  return {
    currentTarget: await dependencies.currentTarget(),
    healthMatches: matching,
    processes: processes.map(({ pid, role, starttime, target }) => ({ pid, role, starttime, target })),
    running: processes.length > 0 && matching,
    target: config.target
  };
}

export async function runCli(argv = process.argv.slice(2), environment = process.env) {
  const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "start";
  if (command === "install") {
    const bundlePath = option(argv, "--bundle");
    if (!bundlePath) throw new Error("install requires --bundle <versioned-production-path>.");
    return transitionProduction({
      bundlePath,
      bundleDigest: option(argv, "--bundle-digest"),
      dataDirectory: option(argv, "--data-dir"),
      homeDir: environment.HOME,
      port: numberOption(argv, "--port"),
      productionRoot: option(argv, "--production-root")
    });
  }
  const config = await configFromEnvironment(environment);
  if (command === "start") return startProduction(config);
  if (command === "stop") return stopProduction(config);
  if (command === "status") return statusProduction(config);
  throw new Error(`Unknown production lifecycle command: ${command}. Expected install, start, stop, or status.`);
}

async function swapCurrentTarget(productionRoot, target) {
  const current = join(productionRoot, "current");
  const temporary = join(productionRoot, `.current.${process.pid}.${Date.now()}.tmp`);
  try {
    await symlink(target, temporary);
    await rename(temporary, current);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function stageProductionLaunchers(input) {
  const homeDir = resolve(input.homeDir || homedir());
  const target = await realpath(input.bundlePath);
  const productionRoot = resolve(input.productionRoot);
  const release = await readRelease(target);
  const bundleManifest = await verifyPinnedBundle(target, input.bundleDigest);
  const dataDirectory = resolve(input.dataDirectory || join(homeDir, ".config", "masthead-production"));
  const databasePath = resolve(input.databasePath || join(dataDirectory, "masthead.sqlite"));
  const launcherPath = join(homeDir, ".local", "bin", "masthead-production");
  const desktopPath = join(homeDir, ".local", "share", "applications", "ai.animas.masthead.desktop");
  await Promise.all([mkdir(dirname(launcherPath), { recursive: true }), mkdir(dirname(desktopPath), { recursive: true })]);
  const wrapper = productionWrapper({
    bundleDigest: bundleManifest.bundleDigest, dataDirectory, databasePath, gitSha: release.gitSha,
    lifecycleLeasePath: join(homeDir, ".local", "state", "masthead-production", "launcher.lease.sqlite"),
    port: validPort(input.port ?? DEFAULT_PORT), productionRoot, target, version: release.version
  });
  const desktop = [
    "[Desktop Entry]", "Type=Application", "Name=Masthead", `Exec=${launcherPath}`,
    `Icon=${join(target, "resources", "masthead-logo-sail.png")}`, "Terminal=false", "Categories=Development;", ""
  ].join("\n");
  const token = `${process.pid}.${Date.now()}`;
  const launcherStage = `${launcherPath}.${token}.staged`;
  const desktopStage = `${desktopPath}.${token}.staged`;
  const [previousLauncher, previousDesktop] = await Promise.all([snapshotFile(launcherPath), snapshotFile(desktopPath)]);
  await writeFile(launcherStage, wrapper, { encoding: "utf8", mode: 0o755 });
  await chmod(launcherStage, 0o755);
  await writeFile(desktopStage, desktop, { encoding: "utf8", mode: 0o644 });
  return { desktopPath, desktopStage, launcherPath, launcherStage, previousDesktop, previousLauncher };
}

function pinnedDigestFromLauncherSnapshot(snapshot) {
  if (!snapshot?.exists) throw new Error("Previous production launcher is unavailable for rollback.");
  const source = Buffer.from(snapshot.body).toString("utf8");
  const match = source.match(/^MASTHEAD_BUNDLE_DIGEST='([a-f0-9]{64})'$/mu);
  if (!match) throw new Error("Previous production launcher has no pinned bundle digest for rollback.");
  return match[1];
}

async function activateStagedLaunchers(staged) {
  await rename(staged.launcherStage, staged.launcherPath);
  await rename(staged.desktopStage, staged.desktopPath);
}

async function restoreStagedLaunchers(staged) {
  await restoreSnapshot(staged.launcherPath, staged.previousLauncher);
  await restoreSnapshot(staged.desktopPath, staged.previousDesktop);
}

async function discardStagedLaunchers(staged) {
  const paths = [staged.launcherStage, staged.desktopStage].filter((path) => typeof path === "string");
  await Promise.all(paths.map((path) => rm(path, { force: true })));
}

async function snapshotFile(path) {
  try {
    const [body, info] = await Promise.all([readFile(path), stat(path)]);
    return { body, exists: true, mode: info.mode & 0o777 };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return { exists: false };
    throw error;
  }
}

async function restoreSnapshot(path, snapshot) {
  if (!snapshot.exists) {
    await rm(path, { force: true });
    return;
  }
  const temporary = `${path}.${process.pid}.${Date.now()}.restore`;
  try {
    await writeFile(temporary, snapshot.body, { mode: snapshot.mode });
    await chmod(temporary, snapshot.mode);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function cleanupOldProductionBundles(productionRoot, target) {
  const retainedName = basename(target);
  const entries = await readdir(productionRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!VERSIONED_TARGET.test(entry.name) || entry.name === retainedName) continue;
    await rm(join(productionRoot, entry.name), { force: true, recursive: true });
  }
}

function defaultDependencies(config) {
  return {
    acquireLease: () => acquireLifecycleLease(config.lifecycleLeasePath),
    captureSpawned: (pid) => captureSpawnedProcess(pid, config),
    currentTarget: () => realpath(join(config.productionRoot, "current")).catch(() => undefined),
    fetchHealth: () => fetchHealth(config.port),
    ownershipProbe: () => probeExclusiveOwnership(config),
    portBindable: () => portBindable(config.port),
    readProcess,
    readProcesses,
    signal: (pid, signal) => process.kill(pid, signal),
    spawnElectron: (launch) => {
      const child = spawn(launch.executable, launch.args, {
        detached: true,
        env: launch.env,
        stdio: "ignore"
      });
      if (!child.pid) throw new Error("Failed to start the pinned Masthead production Electron process.");
      child.unref();
      return child.pid;
    },
    waitForExit: waitForExit,
    waitForHealth: () => waitForHealth(config)
  };
}

async function captureSpawnedProcess(pid, config) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const record = await readProcess(pid);
    const classified = record ? classifyProductionProcess(record, config) : undefined;
    if (classified?.role === "electron" && classified.target === config.target) return classified;
    await delay(25);
  }
  return undefined;
}

async function cleanupFailedStart(captured, config, dependencies) {
  const excludedPids = new Set();
  if (captured) {
    const current = await dependencies.readProcess(captured.pid);
    if (current) {
      const classified = classifyProductionProcess(current, config);
      if (
        classified?.role !== "electron" || classified.target !== config.target ||
        classified.starttime !== captured.starttime || classified.exe !== captured.exe
      ) excludedPids.add(captured.pid);
    }
  }
  try {
    await stopInsideLifecycleLease(config, dependencies, excludedPids);
    return { stopped: true };
  } catch {
    return { stopped: false };
  }
}

async function stopInsideLifecycleLease(config, dependencies, excludedPids = new Set()) {
  const captured = (await classifiedProcesses(config, dependencies)).filter((record) => !excludedPids.has(record.pid));
  const signalled = [];
  for (const processRecord of captured) {
    const current = await dependencies.readProcess(processRecord.pid);
    if (!current) continue;
    const currentClassification = classifyProductionProcess(current, config);
    if (
      !currentClassification || currentClassification.starttime !== processRecord.starttime ||
      currentClassification.exe !== processRecord.exe || currentClassification.role !== processRecord.role
    ) throw new Error(`PID identity changed before shutdown for ${processRecord.pid}; refusing to signal it.`);
    dependencies.signal(processRecord.pid, "SIGTERM");
    signalled.push(processRecord);
  }
  for (const processRecord of signalled) {
    if (!(await dependencies.waitForExit(processRecord.pid, processRecord.starttime, 30_000))) {
      throw new Error(`Production PID ${processRecord.pid} did not stop after SIGTERM within 30 seconds; no SIGKILL was sent.`);
    }
  }
  const remaining = (await classifiedProcesses(config, dependencies)).filter((record) => !excludedPids.has(record.pid));
  if (remaining.length > 0) throw new Error(`Production process set is not empty after shutdown: ${formatProcesses(remaining)}.`);
  if (await dependencies.fetchHealth()) throw new Error("Production health endpoint remains available after shutdown.");
  if (!(await dependencies.portBindable())) throw new Error(`Production port remains occupied after shutdown: ${config.port}.`);
  await dependencies.ownershipProbe();
  return { stopped: true, stoppedPids: captured.map((record) => record.pid).sort((a, b) => a - b) };
}

function assertPinnedTopology(processes, target) {
  const pinned = processes.filter((record) => record.target === target);
  const electronCount = pinned.filter((record) => record.role === "electron").length;
  const daemonCount = pinned.filter((record) => record.role === "daemon").length;
  if (electronCount !== 1 || daemonCount !== 1 || pinned.length !== 2 || processes.length !== 2) {
    throw new Error("Pinned production topology must contain exactly one Electron main and one daemon on the same target.");
  }
}

async function configFromEnvironment(environment) {
  const targetValue = environment.MASTHEAD_PRODUCTION_TARGET;
  if (!targetValue) throw new Error("MASTHEAD_PRODUCTION_TARGET is required; use the installed immutable launcher.");
  return completeConfig({
    dataDirectory: environment.MASTHEAD_DATA_DIR,
    bundleDigest: environment.MASTHEAD_BUNDLE_DIGEST,
    databasePath: environment.MASTHEAD_DB_PATH,
    gitSha: environment.MASTHEAD_BUILD_SHA,
    lifecycleLeasePath: environment.MASTHEAD_LIFECYCLE_LEASE,
    port: Number(environment.MASTHEAD_PORT),
    productionRoot: environment.MASTHEAD_PRODUCTION_ROOT,
    target: targetValue,
    version: environment.MASTHEAD_BUILD_VERSION
  });
}

async function completeConfig(input) {
  const target = resolve(required(input.target, "production target"));
  const productionRoot = resolve(input.productionRoot || dirname(target));
  const release = input.gitSha && input.version ? { gitSha: input.gitSha, version: input.version } : await readRelease(target);
  const dataDirectory = resolve(required(input.dataDirectory, "production data directory"));
  return {
    bundleDigest: validateDigest(input.bundleDigest),
    dataDirectory,
    databasePath: resolve(input.databasePath || join(dataDirectory, "masthead.sqlite")),
    gitSha: validateSha(release.gitSha),
    lifecycleLeasePath: resolve(input.lifecycleLeasePath || join(homedir(), ".local", "state", "masthead-production", "launcher.lease.sqlite")),
    port: validPort(input.port ?? DEFAULT_PORT),
    productionRoot,
    target,
    version: required(release.version, "release version")
  };
}

async function readRelease(target) {
  const path = join(target, "resources", "daemon", "release.json");
  const parsed = JSON.parse(await readFile(path, "utf8"));
  return { gitSha: validateSha(parsed.gitSha), version: required(parsed.version, "release version") };
}

function productionRuntimePaths(target) {
  const daemonRoot = join(target, "resources", "daemon");
  return {
    daemonEntry: join(daemonRoot, "dist", "src", "daemon", "main.js"),
    executable: join(target, process.platform === "win32" ? "masthead.exe" : "masthead"),
    lifecycle: join(daemonRoot, "scripts", "masthead-production.js"),
    node: join(daemonRoot, process.platform === "win32" ? "node.exe" : "node")
  };
}

function productionTargetForPath(path, productionRoot) {
  if (typeof path !== "string" || !path) return undefined;
  const relativePath = relative(productionRoot, resolve(path));
  if (!relativePath || relativePath.startsWith("..") || relativePath.startsWith("/")) return undefined;
  const targetName = relativePath.split(/[\\/]/u)[0];
  if (!VERSIONED_TARGET.test(targetName)) return undefined;
  return join(productionRoot, targetName);
}

async function classifiedProcesses(config, dependencies) {
  return (await dependencies.readProcesses())
    .map((record) => classifyProductionProcess(record, config))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.role !== right.role) return left.role === "daemon" ? -1 : 1;
      return left.pid - right.pid;
    });
}

async function readProcesses() {
  const entries = await readdir("/proc", { withFileTypes: true });
  const records = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name))
    .map((entry) => readProcess(Number(entry.name))));
  return records.filter(Boolean);
}

async function readProcess(pid) {
  const processRoot = `/proc/${pid}`;
  try {
    const [exe, commandLine, environment, statLine] = await Promise.all([
      readlink(join(processRoot, "exe")),
      readFile(join(processRoot, "cmdline")),
      readFile(join(processRoot, "environ")),
      readFile(join(processRoot, "stat"), "utf8")
    ]);
    const values = statLine.slice(statLine.lastIndexOf(")") + 2).trim().split(/\s+/u);
    return {
      argv: nulFields(commandLine),
      environ: Object.fromEntries(nulFields(environment).flatMap((entry) => {
        const separator = entry.indexOf("=");
        return separator > 0 ? [[entry.slice(0, separator), entry.slice(separator + 1)]] : [];
      })),
      exe,
      pid,
      starttime: values[19]
    };
  } catch {
    return undefined;
  }
}

function nulFields(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

async function fetchHealth(port) {
  return fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(750) })
    .then((response) => response.ok ? response.json() : undefined)
    .catch(() => undefined);
}

async function waitForHealth(config) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const health = await fetchHealth(config.port);
    if (health) return health;
    await delay(250);
  }
  throw new Error("Pinned Masthead production health did not become available within 30 seconds.");
}

async function waitForExit(pid, starttime, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await readProcess(pid);
    if (!current || current.starttime !== starttime) return true;
    await delay(250);
  }
  return false;
}

function healthMatches(health, config) {
  return Boolean(
    health &&
    health.ok === true &&
    health.product === "masthead" &&
    health.buildVersion === config.version &&
    health.buildSha === config.gitSha &&
    resolve(health.data?.dataDirectory || "") === config.dataDirectory &&
    resolve(health.data?.databasePath || "") === config.databasePath &&
    health.runtime?.port === config.port &&
    health.runtime?.writable === true
  );
}

function assertMatchingHealth(health, config) {
  if (!healthMatches(health, config)) {
    throw new Error(`Production health does not match pinned version, SHA, data directory, database, writable mode, and port.`);
  }
}

async function portBindable(port) {
  const server = createServer();
  try {
    await new Promise((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolvePromise);
    });
    return true;
  } catch {
    return false;
  } finally {
    if (server.listening) await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

async function probeExclusiveOwnership(config) {
  const modulePath = join(config.target, "resources", "daemon", "dist", "src", "daemon", "databaseBackup.js");
  const module = await import(pathToFileURL(modulePath).href);
  if (typeof module.withExclusiveDatabaseMaintenance !== "function") {
    throw new Error(`Packaged ownership probe is unavailable at ${modulePath}.`);
  }
  await module.withExclusiveDatabaseMaintenance(config.databasePath, async () => undefined);
}

function productionWrapper(config) {
  const runtime = productionRuntimePaths(config.target);
  return [
    "#!/bin/sh",
    "set -eu",
    `MASTHEAD_PRODUCTION_TARGET=${shellQuote(config.target)}`,
    `MASTHEAD_PRODUCTION_ROOT=${shellQuote(config.productionRoot)}`,
    `MASTHEAD_BUILD_VERSION=${shellQuote(config.version)}`,
    `MASTHEAD_BUILD_SHA=${shellQuote(config.gitSha)}`,
    `MASTHEAD_BUNDLE_DIGEST=${shellQuote(config.bundleDigest)}`,
    `MASTHEAD_DATA_DIR=${shellQuote(config.dataDirectory)}`,
    `MASTHEAD_DB_PATH=${shellQuote(config.databasePath)}`,
    `MASTHEAD_PORT=${shellQuote(String(config.port))}`,
    `MASTHEAD_LIFECYCLE_LEASE=${shellQuote(config.lifecycleLeasePath)}`,
    "export MASTHEAD_PRODUCTION_TARGET MASTHEAD_PRODUCTION_ROOT MASTHEAD_BUILD_VERSION MASTHEAD_BUILD_SHA MASTHEAD_BUNDLE_DIGEST",
    "export MASTHEAD_DATA_DIR MASTHEAD_DB_PATH MASTHEAD_PORT MASTHEAD_LIFECYCLE_LEASE",
    `exec ${shellQuote(runtime.node)} ${shellQuote(runtime.lifecycle)} "$@"`,
    ""
  ].join("\n");
}

async function atomicWrite(path, body, mode) {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, body, { encoding: "utf8", mode });
    await chmod(temporaryPath, mode);
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function validateSha(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) throw new Error("Release git SHA must be full lowercase 40-hex.");
  return value;
}

function validateDigest(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) throw new Error("Pinned bundle digest must be lowercase 64-hex.");
  return value;
}

async function verifyPinnedBundle(target, expectedDigest) {
  const runtime = productionRuntimePaths(target);
  const manifest = await verifyPackagedBundleManifest({
    bundleRoot: target,
    executablePath: runtime.executable,
    nodePath: runtime.node,
    resourcesPath: join(target, "resources")
  });
  if (manifest.bundleDigest !== validateDigest(expectedDigest)) {
    throw new Error("Packaged content manifest does not match the pinned bundle digest.");
  }
  return manifest;
}

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function validPort(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) throw new Error(`Invalid production port: ${value}.`);
  return value;
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function numberOption(argv, name) {
  const value = option(argv, name);
  return value === undefined ? undefined : Number(value);
}

function formatProcesses(records) {
  return records.map((record) => `${record.role} pid ${record.pid} at ${record.target}`).join(", ");
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli().then(
    (result) => {
      const json = process.argv.includes("--json");
      process.stdout.write(`${json ? JSON.stringify(result) : JSON.stringify(result, null, 2)}\n`);
    },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  );
}
