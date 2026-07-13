#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import { runColdProductionActivation } from "./masthead-production-cold-activation.js";

const DEFAULT_PORT = 17383;
const PRODUCTION_HEALTH_INTERVAL_MS = 250;
const PRODUCTION_HEALTH_TIMEOUT_MS = 300_000;
const PRODUCTION_SHUTDOWN_TIMEOUT_MS = 30_000;
const PRODUCTION_MAINTENANCE_TIMEOUT_MS = 1_800_000;
const PRODUCTION_MAINTENANCE_EXIT_GRACE_MS = 30_000;
const VERSIONED_TARGET = /^Masthead-linux-x64-[A-Za-z0-9][A-Za-z0-9._+-]*$/u;

export function productionHealthPollPolicy() {
  return {
    intervalMs: PRODUCTION_HEALTH_INTERVAL_MS,
    maxAttempts: PRODUCTION_HEALTH_TIMEOUT_MS / PRODUCTION_HEALTH_INTERVAL_MS,
    timeoutMs: PRODUCTION_HEALTH_TIMEOUT_MS
  };
}

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
    access(runtime.daemonEntry, constants.R_OK),
    access(runtime.maintenanceEntry, constants.R_OK)
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

export async function installDisabledProductionSurface(input = {}) {
  const homeDir = resolve(input.homeDir || homedir());
  const databasePath = resolve(required(input.databasePath, "disabled production status database path"));
  const journalPath = `${databasePath}.production-transition.json`;
  const launcherPath = join(homeDir, ".local", "bin", "masthead-production");
  const desktopPath = join(homeDir, ".local", "share", "applications", "ai.animas.masthead.desktop");
  await Promise.all([mkdir(dirname(launcherPath), { recursive: true }), mkdir(dirname(desktopPath), { recursive: true })]);
  const wrapper = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `COLD_TRANSITION_JOURNAL=${shellQuote(journalPath)}`,
    "if [[ ${1:-} == status ]]; then",
    "  if [[ -f \"$COLD_TRANSITION_JOURNAL\" && ! -L \"$COLD_TRANSITION_JOURNAL\" ]]; then",
    "    printf '%s\\n' '{\"coldActivation\":{\"pending\":true}}'",
    "  else",
    "    printf '%s\\n' '{\"coldActivation\":{\"pending\":false}}'",
    "  fi",
    "  exit 0",
    "fi",
    "echo 'Masthead production is offline after legacy cold activation. Retry the fully attested install with --cold-activate.' >&2",
    "exit 78",
    ""
  ].join("\n");
  const desktop = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Masthead (Offline)",
    `Exec=${launcherPath}`,
    "Terminal=true",
    "Categories=Development;",
    ""
  ].join("\n");
  await atomicWrite(launcherPath, wrapper, 0o755);
  await atomicWrite(desktopPath, desktop, 0o644);
  return { desktopPath, launcherPath };
}

export async function coldActivateProduction(input, dependencyOverrides = {}) {
  if (typeof input.databasePath !== "string" || !input.databasePath.trim()) {
    throw new Error("Cold activation requires an explicit --db-path; no database path is inferred.");
  }
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
  const dataDirectory = resolve(input.dataDirectory || join(homeDir, ".config", "masthead-production"));
  const config = await completeConfig({
    bundleDigest: input.bundleDigest,
    dataDirectory,
    databasePath: input.databasePath,
    gitSha: release.gitSha,
    lifecycleLeasePath: join(homeDir, ".local", "state", "masthead-production", "launcher.lease.sqlite"),
    port: input.port ?? DEFAULT_PORT,
    productionRoot,
    target,
    version: release.version
  });
  await attestCandidate(config);
  const noLifecycleLease = async () => ({ release: async () => undefined });
  const dependencies = {
    acquireLease: () => acquireLifecycleLease(config.lifecycleLeasePath),
    assertLegacyIdentity: (identity) => assertLegacyTargetIdentity(identity, productionRoot),
    assertOffline: () => assertColdProductionOffline(config),
    attestCandidate: () => attestCandidate(config),
    captureLegacyIdentity: (legacyTarget) => captureLegacyTargetIdentity(legacyTarget, productionRoot),
    cleanupBundles: () => cleanupOldProductionBundles(productionRoot, target),
    completeMaintenance: (request) => runMaintenanceChild(config, "complete", request),
    currentTarget: () => realpath(join(productionRoot, "current")).catch(() => undefined),
    installCandidateSurface: () => installProductionLauncher({
      bundleDigest: config.bundleDigest,
      bundlePath: config.target,
      dataDirectory: config.dataDirectory,
      databasePath: config.databasePath,
      homeDir,
      port: config.port,
      productionRoot
    }),
    installDisabledSurface: () => installDisabledProductionSurface({ databasePath: config.databasePath, homeDir }),
    prepareMaintenance: (request) => runMaintenanceChild(config, "prepare", request),
    readMaintenanceJournal: () => readTransitionJournal(config.databasePath),
    restoreCurrent: (legacyTarget) => swapCurrentTarget(productionRoot, legacyTarget),
    restoreMaintenance: (request) => runMaintenanceChild(config, "restore", request),
    start: (candidate) => startProduction(candidate, { acquireLease: noLifecycleLease }),
    stopCandidate: () => stopColdCandidate(config),
    stopMaintenance: (request) => stopColdMaintenanceChildren(config, request),
    swapCurrent: () => swapCurrentTarget(productionRoot, target),
    verifyCandidate: (candidate) => verifyColdCandidateCommit(candidate),
    ...dependencyOverrides
  };
  return runColdProductionActivation({ config }, dependencies);
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
    access(runtime.daemonEntry, constants.R_OK),
    access(runtime.maintenanceEntry, constants.R_OK)
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
    cleanupCandidate: (candidate) => stopProduction(candidate, { acquireLease: noLifecycleLease }),
    completeMaintenance: (request) => runMaintenanceChild(config, "complete", request),
    currentTarget: () => realpath(join(productionRoot, "current")).catch(() => undefined),
    readMaintenanceJournal: () => readTransitionJournal(config.databasePath),
    prepareMaintenance: (request) => runMaintenanceChild(config, "prepare", request),
    recoverLaunchers: (oldBundle) => installProductionLauncher({
      bundleDigest: oldBundle.bundleDigest,
      bundlePath: oldBundle.target,
      dataDirectory: config.dataDirectory,
      databasePath: config.databasePath,
      homeDir,
      port: config.port,
      productionRoot
    }),
    restoreCurrent: (_oldTarget) => swapCurrentTarget(productionRoot, _oldTarget),
    restoreLaunchers: (staged) => restoreStagedLaunchers(staged),
    restoreMaintenance: (request) => runMaintenanceChild(config, "restore", request),
    cleanupBundles: () => cleanupOldProductionBundles(productionRoot, target),
    cleanupRecoveredBundles: (oldTarget) => cleanupOldProductionBundles(productionRoot, oldTarget),
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
    const pending = await dependencies.readMaintenanceJournal();
    if (pending?.schemaVersion === 2 || pending?.rollbackMode === "offline_only") {
      throw new Error("Production has a pending offline-only cold activation; rerun install with --cold-activate.");
    }
    if (pending && !isRecoverableTransitionState(pending.state)) {
      throw new Error(`Production transition journal has unsupported state: ${String(pending.state)}.`);
    }
    if (pending) {
      const recoveryRequest = await validatePendingRecovery(config, pending);
      assertRecoveryCurrentTarget(await dependencies.currentTarget(), recoveryRequest);
      const stopReceipt = await dependencies.stop(config);
      const restored = await dependencies.restoreMaintenance(recoveryRequest);
      assertRestoredMaintenanceReceipt(restored, recoveryRequest);
      await dependencies.restoreCurrent(recoveryRequest.oldBundle.target);
      await dependencies.recoverLaunchers(recoveryRequest.oldBundle);
      const started = await dependencies.start({
        ...config,
        bundleDigest: recoveryRequest.oldBundle.bundleDigest,
        expectedDatabaseId: recoveryRequest.databaseId,
        expectedSchemaVersion: recoveryRequest.sourceSchemaVersion,
        gitSha: recoveryRequest.oldBundle.gitSha,
        target: recoveryRequest.oldBundle.target,
        transitionNonce: recoveryRequest.nonce,
        version: recoveryRequest.oldBundle.version
      });
      await dependencies.completeMaintenance(recoveryRequest);
      await dependencies.cleanupRecoveredBundles(recoveryRequest.oldBundle.target);
      return { activated: false, recovered: true, started, stopped: stopReceipt, target: recoveryRequest.oldBundle.target };
    }
    oldTarget = await dependencies.currentTarget();
    if (!oldTarget) throw new Error("Production transition requires an existing current target.");
    staged = await dependencies.stageLaunchers(config);
    const oldRelease = await readRelease(oldTarget);
    const oldDigest = pinnedDigestFromLauncherSnapshot(staged.previousLauncher);
    await verifyPinnedBundle(oldTarget, oldDigest);
    const maintenanceRequest = {
      databasePath: config.databasePath,
      newBundle: bundleIdentity(config),
      nonce: randomUUID(),
      oldBundle: { bundleDigest: oldDigest, gitSha: oldRelease.gitSha, target: oldTarget, version: oldRelease.version }
    };
    const stopReceipt = await dependencies.stop(config);
    let maintenanceReceipt;
    try {
      maintenanceReceipt = await dependencies.prepareMaintenance(maintenanceRequest);
    } catch (error) {
      if (error?.code === "maintenance_child_exit_unproven") {
        throw new Error(`${error.message}; pre-activation recovery skipped`, { cause: error });
      }
      let restored;
      try {
        restored = await dependencies.restoreMaintenance(maintenanceRequest);
      } catch {
        restored = undefined;
      }
      let restarted = false;
      try {
        await dependencies.start({
          ...config,
          bundleDigest: oldDigest,
          expectedDatabaseId: restored?.databaseId,
          expectedSchemaVersion: restored?.sourceSchemaVersion,
          gitSha: oldRelease.gitSha,
          target: oldTarget,
          transitionNonce: restored ? maintenanceRequest.nonce : undefined,
          version: oldRelease.version
        });
        if (restored) await dependencies.completeMaintenance(maintenanceRequest);
        restarted = true;
      } catch {
        restarted = false;
      }
      throw new Error(`${error instanceof Error ? error.message : String(error)}; pre-activation restart=${restarted}`, { cause: error });
    }
    let started;
    try {
      await dependencies.swapCurrent(productionRoot, target);
      await dependencies.activateLaunchers(staged);
      started = await dependencies.start({
        ...config,
        expectedDatabaseId: maintenanceReceipt.databaseId,
        expectedSchemaVersion: maintenanceReceipt.targetSchemaVersion,
        transitionNonce: maintenanceRequest.nonce
      });
      await dependencies.completeMaintenance(maintenanceRequest);
    } catch (error) {
      if (error?.code === "maintenance_child_exit_unproven") {
        throw new Error(`${error.message}; rollback skipped`, { cause: error });
      }
      try {
        await dependencies.cleanupCandidate(config);
      } catch (cleanupError) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; rollback skipped; candidate cleanup error=${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          { cause: error }
        );
      }
      let restarted = false;
      try {
        const restored = await dependencies.restoreMaintenance(maintenanceRequest);
        await dependencies.restoreCurrent(oldTarget);
        await dependencies.restoreLaunchers(staged);
        const oldConfig = {
          ...config,
          bundleDigest: oldDigest,
          expectedDatabaseId: restored.databaseId,
          expectedSchemaVersion: restored.sourceSchemaVersion,
          gitSha: oldRelease.gitSha,
          target: oldTarget,
          transitionNonce: maintenanceRequest.nonce,
          version: oldRelease.version
        };
        await dependencies.start(oldConfig);
        await dependencies.completeMaintenance(maintenanceRequest);
        restarted = true;
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

function classifyColdMaintenanceProcess(record, config) {
  if (!record || !Number.isSafeInteger(record.pid) || record.pid <= 0 || !record.starttime) return undefined;
  const target = productionTargetForPath(normalizeProcExecutable(record.exe), config.productionRoot);
  if (!target) return undefined;
  const runtime = productionRuntimePaths(target);
  const args = Array.isArray(record.argv) ? record.argv : [];
  const environment = record.environ || {};
  if (
    resolve(normalizeProcExecutable(record.exe) || "") !== runtime.node ||
    args.length !== 5 || resolve(args[0] || "") !== runtime.node ||
    resolve(args[1] || "") !== runtime.maintenanceEntry ||
    !["prepare", "restore", "complete"].includes(args[2]) || args[3] !== "--request" ||
    resolve(environment.MASTHEAD_DATA_DIR || "") !== config.dataDirectory ||
    resolve(environment.MASTHEAD_DB_PATH || "") !== config.databasePath
  ) return undefined;
  let request;
  try {
    request = JSON.parse(args[4]);
  } catch {
    return { ...record, action: args[2], request: undefined, role: "maintenance", target };
  }
  return { ...record, action: args[2], request, role: "maintenance", target };
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
    let interruptedStart;
    const pending = await dependencies.readMaintenanceJournal();
    if ((pending?.schemaVersion === 2 || pending?.rollbackMode === "offline_only") && !config.transitionNonce) {
      throw new Error("Production has a pending offline-only cold activation; ordinary start is disabled; rerun install with --cold-activate.");
    }
    if (pending && isRecoverableTransitionState(pending.state) && !config.transitionNonce) {
      interruptedStart = await validatePendingRecovery(config, pending, "start");
      const current = await dependencies.currentTarget();
      assertRecoveryCurrentTarget(current, interruptedStart);
      await dependencies.stopInterruptedStart(interruptedStart, dependencies);
      const restored = await dependencies.restoreInterruptedStart(interruptedStart);
      assertRestoredMaintenanceReceipt(restored, interruptedStart);
      await dependencies.recoverStartSurface(interruptedStart);
      Object.assign(config, interruptedStart.oldBundle);
      config.expectedDatabaseId = interruptedStart.databaseId;
      config.expectedSchemaVersion = interruptedStart.sourceSchemaVersion;
      config.transitionNonce = interruptedStart.nonce;
    }
    await dependencies.transitionGuard();
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
      if (interruptedStart) {
        await dependencies.completeInterruptedStart(interruptedStart);
        await dependencies.cleanupInterruptedStart(interruptedStart);
      }
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
      if (interruptedStart) {
        await dependencies.completeInterruptedStart(interruptedStart);
        await dependencies.cleanupInterruptedStart(interruptedStart);
      }
      return { health: startedHealth, pid, started: true };
    } catch (error) {
      const cleanup = dependencies.cleanupSpawned
        ? await dependencies.cleanupSpawned(captured, dependencies)
        : await cleanupFailedStart(captured, config, dependencies);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; cleanup stopped=${cleanup.stopped}${cleanup.error ? `; cleanup error=${cleanup.error}` : ""}`,
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
  const pending = await dependencies.readMaintenanceJournal();
  const matching = Boolean(health && healthMatches(health, config));
  return {
    coldActivation: pending?.schemaVersion === 2 && pending?.rollbackMode === "offline_only"
      ? {
          databaseId: pending.databaseId,
          legacyTarget: pending.legacyTarget?.path,
          nonce: pending.nonce,
          pending: true,
          state: pending.state,
          target: pending.newBundle?.target
        }
      : undefined,
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
    const install = argv.includes("--cold-activate") ? coldActivateProduction : transitionProduction;
    return install({
      bundlePath,
      bundleDigest: option(argv, "--bundle-digest"),
      dataDirectory: option(argv, "--data-dir"),
      databasePath: option(argv, "--db-path"),
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
    completeInterruptedStart: (request) => runMaintenanceChild(
      { ...config, ...request.newBundle },
      "complete",
      request
    ),
    cleanupInterruptedStart: (request) => cleanupOldProductionBundles(config.productionRoot, request.oldBundle.target),
    ownershipProbe: () => probeExclusiveOwnership(config),
    portBindable: () => portBindable(config.port),
    readProcess,
    readProcesses,
    readMaintenanceJournal: () => readTransitionJournal(config.databasePath),
    recoverStartSurface: async (request) => {
      await swapCurrentTarget(config.productionRoot, request.oldBundle.target);
      await installProductionLauncher({
        bundleDigest: request.oldBundle.bundleDigest,
        bundlePath: request.oldBundle.target,
        dataDirectory: config.dataDirectory,
        databasePath: config.databasePath,
        homeDir: homedir(),
        port: config.port,
        productionRoot: config.productionRoot
      });
    },
    restoreInterruptedStart: (request) => runMaintenanceChild(
      { ...config, ...request.newBundle },
      "restore",
      request
    ),
    stopInterruptedStart: (_request, activeDependencies) => stopInsideLifecycleLease(config, activeDependencies),
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
    transitionGuard: () => assertTransitionJournalAllowsStart(config),
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
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), stopped: false };
  }
}

async function stopInsideLifecycleLease(config, dependencies, excludedPids = new Set(), allowedTargets) {
  const captured = (await classifiedProcesses(config, dependencies)).filter((record) => !excludedPids.has(record.pid));
  if (allowedTargets && captured.some((record) => !allowedTargets.has(record.target))) {
    throw new Error(`Refusing to signal a production target outside the allowed shutdown set: ${formatProcesses(captured)}.`);
  }
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
  const exitTimeout = PRODUCTION_SHUTDOWN_TIMEOUT_MS;
  for (const processRecord of signalled) {
    if (!(await dependencies.waitForExit(processRecord.pid, processRecord.starttime, exitTimeout))) {
      throw new Error(`Production PID ${processRecord.pid} did not stop after SIGTERM within ${exitTimeout}ms; no SIGKILL was sent.`);
    }
  }
  const remaining = (await classifiedProcesses(config, dependencies)).filter((record) => !excludedPids.has(record.pid));
  if (remaining.length > 0) throw new Error(`Production process set is not empty after shutdown: ${formatProcesses(remaining)}.`);
  if (await dependencies.fetchHealth()) throw new Error("Production health endpoint remains available after shutdown.");
  if (!(await dependencies.portBindable())) throw new Error(`Production port remains occupied after shutdown: ${config.port}.`);
  await dependencies.ownershipProbe();
  return { stopped: true, stoppedPids: captured.map((record) => record.pid).sort((a, b) => a - b) };
}

async function attestCandidate(config) {
  const info = await lstat(config.target);
  if (info.isSymbolicLink() || await realpath(config.target) !== config.target || dirname(config.target) !== await realpath(config.productionRoot)) {
    throw new Error("Cold activation candidate is no longer the immutable direct production bundle.");
  }
  const manifest = await verifyPinnedBundle(config.target, config.bundleDigest);
  const release = await readRelease(config.target);
  if (manifest.bundleDigest !== config.bundleDigest || release.gitSha !== config.gitSha || release.version !== config.version) {
    throw new Error("Cold activation candidate release identity changed after attestation.");
  }
  const runtime = productionRuntimePaths(config.target);
  await Promise.all([
    access(runtime.executable, constants.X_OK),
    access(runtime.node, constants.X_OK),
    access(runtime.lifecycle, constants.R_OK),
    access(runtime.daemonEntry, constants.R_OK),
    access(runtime.maintenanceEntry, constants.R_OK)
  ]);
}

async function verifyColdCandidateCommit(config) {
  const dependencies = defaultDependencies(config);
  assertMatchingHealth(await dependencies.fetchHealth(), config);
  assertPinnedTopology(await classifiedProcesses(config, dependencies), config.target);
}

export async function captureLegacyTargetIdentity(targetValue, productionRoot, adapters = {}) {
  const lstatAdapter = adapters.lstat || ((path) => lstat(path, { bigint: true }));
  const realpathAdapter = adapters.realpath || realpath;
  const target = resolve(targetValue || "");
  if (dirname(target) !== await realpathAdapter(productionRoot) || !VERSIONED_TARGET.test(basename(target))) {
    throw new Error("Cold activation legacy target must be a versioned direct child of the production root.");
  }
  const linkInfo = await lstatAdapter(target);
  if (linkInfo.isSymbolicLink() || await realpathAdapter(target) !== target || !linkInfo.isDirectory()) {
    throw new Error("Cold activation legacy target must be an immutable non-symlink directory.");
  }
  return { device: String(linkInfo.dev), inode: String(linkInfo.ino), path: target };
}

async function assertLegacyTargetIdentity(expected, productionRoot) {
  const current = await captureLegacyTargetIdentity(expected?.path, productionRoot);
  if (current.path !== expected.path || current.device !== expected.device || current.inode !== expected.inode) {
    throw new Error("Cold activation legacy target filesystem identity changed; refusing replacement.");
  }
}

export async function assertColdProductionOffline(config, dependencyOverrides = {}) {
  const dependencies = { ...defaultDependencies(config), ...dependencyOverrides };
  const processes = await productionRootProcesses(config, dependencies);
  if (processes.length > 0) {
    throw new Error(`Cold activation requires an empty production process set: ${formatProcesses(processes)}.`);
  }
  if (await dependencies.fetchHealth()) throw new Error("Cold activation requires production health to be absent.");
  if (!(await dependencies.portBindable())) throw new Error(`Cold activation requires port ${config.port} to be bindable.`);
  await dependencies.ownershipProbe();
}

async function stopColdCandidate(config) {
  const dependencies = defaultDependencies(config);
  const before = await productionRootProcesses(config, dependencies);
  const nonCandidate = before.filter((record) => record.target !== config.target || record.role === "maintenance");
  if (nonCandidate.length > 0) {
    throw new Error(`Cold activation found a non-candidate production process and refused to signal it: ${formatProcesses(nonCandidate)}.`);
  }
  const receipt = await stopInsideLifecycleLease(config, dependencies, new Set(), new Set([config.target]));
  const remaining = await productionRootProcesses(config, dependencies);
  if (remaining.length > 0) {
    throw new Error(`Cold activation candidate process set is not empty after exact shutdown: ${formatProcesses(remaining)}.`);
  }
  return receipt;
}

async function productionRootProcesses(config, dependencies) {
  return (await dependencies.readProcesses()).flatMap((record) => {
    const target = productionTargetForPath(normalizeProcExecutable(record.exe), config.productionRoot);
    if (!target) return [];
    const classified = classifyProductionProcess(record, config) || classifyColdMaintenanceProcess(record, config);
    return [{ ...record, role: classified?.role || "unknown", target }];
  }).sort((left, right) => left.pid - right.pid);
}

async function coldMaintenanceProcesses(config, dependencies) {
  return (await dependencies.readProcesses())
    .map((record) => classifyColdMaintenanceProcess(record, config))
    .filter(Boolean)
    .sort((left, right) => left.pid - right.pid);
}

export async function stopColdMaintenanceChildren(config, request, dependencyOverrides = {}) {
  const dependencies = { ...defaultDependencies(config), ...dependencyOverrides };
  const captured = await coldMaintenanceProcesses(config, dependencies);
  for (const child of captured) {
    if (child.target !== config.target || !sameColdMaintenanceRequest(child.request, request)) {
      throw new Error(`Cold activation found an unrecognized maintenance child and refused to signal it: ${child.pid}.`);
    }
    const current = await dependencies.readProcess(child.pid);
    const classified = classifyColdMaintenanceProcess(current, config);
    if (
      !classified || classified.pid !== child.pid || classified.starttime !== child.starttime ||
      normalizeProcExecutable(classified.exe) !== normalizeProcExecutable(child.exe) ||
      classified.target !== config.target || !sameColdMaintenanceRequest(classified.request, request)
    ) {
      throw new Error(`Cold activation maintenance PID identity changed before SIGTERM: ${child.pid}.`);
    }
    dependencies.signal(child.pid, "SIGTERM");
    if (!(await dependencies.waitForExit(child.pid, child.starttime, PRODUCTION_SHUTDOWN_TIMEOUT_MS))) {
      throw new Error(`Cold activation maintenance PID ${child.pid} did not stop after SIGTERM; no SIGKILL was sent.`);
    }
  }
  const remaining = await coldMaintenanceProcesses(config, dependencies);
  if (remaining.length > 0) throw new Error(`Cold activation maintenance child set is not empty: ${formatProcesses(remaining)}.`);
}

function sameColdMaintenanceRequest(left, right) {
  return Boolean(
    left && right && left.rollbackMode === "offline_only" && right.rollbackMode === "offline_only" &&
    resolve(left.databasePath || "") === resolve(right.databasePath || "") && left.nonce === right.nonce &&
    sameBundleIdentity(left.newBundle, right.newBundle) &&
    left.legacyTarget?.path === right.legacyTarget?.path &&
    left.legacyTarget?.device === right.legacyTarget?.device &&
    left.legacyTarget?.inode === right.legacyTarget?.inode
  );
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
    expectedDatabaseId: input.expectedDatabaseId,
    expectedSchemaVersion: input.expectedSchemaVersion,
    gitSha: validateSha(release.gitSha),
    lifecycleLeasePath: resolve(input.lifecycleLeasePath || join(homedir(), ".local", "state", "masthead-production", "launcher.lease.sqlite")),
    port: validPort(input.port ?? DEFAULT_PORT),
    productionRoot,
    target,
    transitionNonce: input.transitionNonce,
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
    maintenanceEntry: join(daemonRoot, "dist", "src", "daemon", "productionTransitionMaintenance.js"),
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
  return readProductionProcesses();
}

export async function readProductionProcesses(adapters = {}) {
  const entries = await (adapters.entries || (async () =>
    (await readdir("/proc", { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name))
      .map((entry) => entry.name)))();
  const numericEntries = entries.filter((entry) => /^\d+$/u.test(String(entry)));
  const maxEntries = adapters.maxEntries ?? 100_000;
  const concurrency = adapters.concurrency ?? 32;
  const now = adapters.now || monotonicMilliseconds;
  const deadline = now() + (adapters.timeoutMs ?? 30_000);
  const readAdapter = adapters.readProcess || readOwnedProcessStrict;
  if (numericEntries.length > maxEntries) {
    throw new Error(`Production process scan exceeded its ${maxEntries} entry budget.`);
  }
  let cursor = 0;
  const records = [];
  const workers = Array.from({ length: Math.min(concurrency, numericEntries.length) }, async () => {
    while (cursor < numericEntries.length) {
      if (now() >= deadline) throw new Error("Production process scan exceeded its bounded deadline.");
      const entry = numericEntries[cursor];
      cursor += 1;
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error("Production process scan exceeded its bounded deadline.");
      const record = await promiseWithTimeout(
        readAdapter(Number(entry)),
        remaining,
        "Production process scan exceeded its bounded deadline."
      );
      if (record) records.push(record);
      if (now() >= deadline) throw new Error("Production process scan exceeded its bounded deadline.");
    }
  });
  await Promise.all(workers);
  return records;
}

function promiseWithTimeout(promise, timeoutMs, message) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs));
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolvePromise(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

async function readOwnedProcessStrict(pid) {
  const processRoot = `/proc/${pid}`;
  let info;
  try {
    info = await stat(processRoot);
  } catch (error) {
    if (error && typeof error === "object" && ["ENOENT", "ESRCH"].includes(error.code)) return undefined;
    throw error;
  }
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) return undefined;
  return readProcess(pid, true);
}

async function readProcess(pid, strict = false) {
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
  } catch (error) {
    if (strict && !(error && typeof error === "object" && ["ENOENT", "ESRCH"].includes(error.code))) throw error;
    return undefined;
  }
}

function nulFields(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

async function fetchHealth(port, timeoutMs = 750) {
  const boundedTimeout = Math.max(1, Math.floor(timeoutMs));
  return fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(boundedTimeout) })
    .then((response) => response.ok ? response.json() : undefined)
    .catch(() => undefined);
}

async function waitForHealth(config) {
  return waitForProductionHealth(config);
}

export async function waitForProductionHealth(config, adapters = {}) {
  const policy = productionHealthPollPolicy();
  const now = adapters.now || monotonicMilliseconds;
  const fetchAdapter = adapters.fetchHealth || fetchHealth;
  const delayAdapter = adapters.delay || delay;
  const startedAt = now();
  const deadline = startedAt + policy.timeoutMs;
  while (true) {
    if (now() >= deadline) break;
    const requestBudget = Math.min(750, deadline - now());
    if (requestBudget <= 0) break;
    const health = await fetchAdapter(config.port, requestBudget);
    if (now() >= deadline) break;
    if (health) return health;
    const sleepBudget = Math.min(policy.intervalMs, deadline - now());
    if (sleepBudget <= 0) break;
    await delayAdapter(sleepBudget);
  }
  throw new Error("Pinned Masthead production health did not become available within 5 minutes.");
}

function monotonicMilliseconds() {
  return Number(process.hrtime.bigint() / 1_000_000n);
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
    (config.expectedDatabaseId === undefined || health.data?.databaseId === config.expectedDatabaseId) &&
    (config.expectedSchemaVersion === undefined || health.schemaVersion === config.expectedSchemaVersion) &&
    health.runtime?.port === config.port &&
    health.runtime?.writable === true
  );
}

function assertMatchingHealth(health, config) {
  if (!healthMatches(health, config)) {
    throw new Error(`Production health does not match pinned version, SHA, data directory, database identity/schema, writable mode, and port.`);
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

function bundleIdentity(config) {
  return {
    bundleDigest: config.bundleDigest,
    gitSha: config.gitSha,
    target: config.target,
    version: config.version
  };
}

function isRecoverableTransitionState(state) {
  return ["snapshot_ready", "ready_to_activate", "restoring", "restore_failed", "restored"].includes(state);
}

async function readTransitionJournal(databasePath) {
  const journalPath = `${databasePath}.production-transition.json`;
  try {
    const info = await lstat(journalPath);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(journalPath) !== journalPath) {
      throw new Error("transition_journal_path_invalid");
    }
    return JSON.parse(await readFile(journalPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return undefined;
    throw new Error(`Production transition journal is invalid for ${databasePath}.`, { cause: error });
  }
}

async function validatePendingRecovery(config, receipt, mode = "install") {
  const request = {
    databaseId: receipt?.databaseId,
    databasePath: receipt?.databasePath,
    newBundle: receipt?.newBundle,
    nonce: receipt?.nonce,
    oldBundle: receipt?.oldBundle,
    sourceSchemaVersion: receipt?.sourceSchemaVersion
  };
  if (
    receipt?.schemaVersion !== 1 || !isRecoverableTransitionState(receipt?.state) ||
    typeof request.databaseId !== "string" || !request.databaseId ||
    !Number.isSafeInteger(request.sourceSchemaVersion) || request.sourceSchemaVersion < 0 ||
    request.databasePath !== config.databasePath ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(request.nonce || "") ||
    !request.oldBundle || !request.newBundle ||
    ![request.oldBundle, request.newBundle].every((bundle) =>
      dirname(resolve(bundle.target || "")) === config.productionRoot && VERSIONED_TARGET.test(basename(bundle.target || ""))
    ) ||
    (mode === "install" && !sameBundleIdentity(request.newBundle, bundleIdentity(config))) ||
    (mode === "start" && ![request.oldBundle, request.newBundle].some((bundle) => sameBundleIdentity(bundle, bundleIdentity(config))))
  ) {
    throw new Error("Production transition recovery receipt does not match the requested old/new bundle identity.");
  }
  for (const bundle of [request.oldBundle, request.newBundle]) {
    const targetInfo = await lstat(bundle.target);
    if (targetInfo.isSymbolicLink() || await realpath(bundle.target) !== bundle.target) {
      throw new Error("Production transition recovery target is not an immutable direct bundle.");
    }
    const release = await readRelease(bundle.target);
    if (release.gitSha !== bundle.gitSha || release.version !== bundle.version) {
      throw new Error("Production transition recovery release identity does not match its receipt.");
    }
    await verifyPinnedBundle(bundle.target, bundle.bundleDigest);
  }
  return request;
}

function assertRecoveryCurrentTarget(current, request) {
  if (current !== request.oldBundle.target && current !== request.newBundle.target) {
    throw new Error("Production transition recovery current target is neither the receipt old nor new bundle.");
  }
}

function assertRestoredMaintenanceReceipt(receipt, request) {
  if (
    receipt?.state !== "restored" || receipt.databasePath !== request.databasePath || receipt.nonce !== request.nonce ||
    !sameBundleIdentity(receipt.oldBundle, request.oldBundle) || !sameBundleIdentity(receipt.newBundle, request.newBundle) ||
    receipt.databaseId !== request.databaseId || receipt.sourceSchemaVersion !== request.sourceSchemaVersion
  ) {
    throw new Error("Production maintenance restore receipt does not exactly match the authoritative transition journal.");
  }
}

async function assertTransitionJournalAllowsStart(config) {
  const journalPath = `${config.databasePath}.production-transition.json`;
  let receipt;
  try {
    receipt = JSON.parse(await readFile(journalPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw new Error(`Refusing production start because transition journal is invalid: ${journalPath}.`, { cause: error });
  }
  const expectedBundle = bundleIdentity(config);
  const candidateAllowed = receipt.state === "ready_to_activate" && sameBundleIdentity(receipt.newBundle, expectedBundle) &&
    receipt.databaseId === config.expectedDatabaseId && receipt.targetSchemaVersion === config.expectedSchemaVersion;
  const restoredAllowed = receipt.state === "restored" && sameBundleIdentity(receipt.oldBundle, expectedBundle) &&
    receipt.databaseId === config.expectedDatabaseId && receipt.sourceSchemaVersion === config.expectedSchemaVersion;
  if (
    receipt.databasePath !== config.databasePath || !config.transitionNonce ||
    receipt.nonce !== config.transitionNonce || (!candidateAllowed && !restoredAllowed)
  ) {
    throw new Error(`Refusing production start while an incomplete transition journal exists: ${journalPath}.`);
  }
}

function sameBundleIdentity(left, right) {
  return Boolean(
    left && left.bundleDigest === right.bundleDigest && left.gitSha === right.gitSha &&
    left.target === right.target && left.version === right.version
  );
}

async function runMaintenanceChild(config, action, request) {
  const runtime = productionRuntimePaths(config.target);
  const child = spawn(runtime.node, [runtime.maintenanceEntry, action, "--request", JSON.stringify(request)], {
    env: {
      ...process.env,
      MASTHEAD_DATA_DIR: config.dataDirectory,
      MASTHEAD_DB_PATH: config.databasePath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const identity = captureMaintenanceChildIdentity(child);
  return waitForMaintenanceChild(
    child,
    action,
    PRODUCTION_MAINTENANCE_TIMEOUT_MS,
    PRODUCTION_MAINTENANCE_EXIT_GRACE_MS,
    identity
  );
}

export function waitForMaintenanceChild(
  child,
  action,
  timeoutMs,
  exitGraceMs = PRODUCTION_MAINTENANCE_EXIT_GRACE_MS,
  identityPromise = captureMaintenanceChildIdentity(child),
  identityReader = async (pid) => {
    const record = await readProcess(pid);
    return record ? { pid, starttime: record.starttime } : undefined;
  }
) {
  const observedIdentityPromise = Promise.resolve(identityPromise).then(
    (value) => ({ value }),
    (error) => ({ error })
  );
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let timedOut = false;
    let childError;
    let exitObserved = false;
    let exitGraceTimer;
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    const scheduleExitGrace = (message) => {
      if (exitGraceTimer) return;
      exitGraceTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
        reject(maintenanceChildExitUnproven(message));
      }, exitGraceMs);
    };
    const timer = setTimeout(async () => {
      if (settled) return;
      const graceMessage = `Production maintenance child exceeded ${timeoutMs}ms and exact exit was not proven within ${exitGraceMs}ms; no SIGKILL was sent.`;
      if (exitObserved) {
        scheduleExitGrace(graceMessage);
        return;
      }
      timedOut = true;
      let captured;
      let current;
      try {
        const identityDeadline = monotonicMilliseconds() + exitGraceMs;
        const observed = await promiseWithTimeout(
          observedIdentityPromise,
          exitGraceMs,
          "maintenance child identity acquisition exceeded its bounded deadline"
        );
        if (observed.error) throw observed.error;
        captured = observed.value;
        if (!captured || captured.pid !== child.pid || typeof captured.starttime !== "string" || !captured.starttime) {
          throw new Error("maintenance child PID/start identity was unavailable");
        }
        const remaining = identityDeadline - monotonicMilliseconds();
        if (remaining <= 0) throw new Error("maintenance child identity revalidation exceeded its bounded deadline");
        current = await promiseWithTimeout(
          identityReader(child.pid),
          remaining,
          "maintenance child identity revalidation exceeded its bounded deadline"
        );
      } catch (error) {
        if (!settled) {
          settled = true;
          reject(maintenanceChildExitUnproven(`Production maintenance child identity revalidation failed: ${error instanceof Error ? error.message : String(error)}.`));
        }
        return;
      }
      if (settled) return;
      if (exitObserved || !current) {
        scheduleExitGrace(graceMessage);
        return;
      }
      if (current.pid !== captured.pid || current.starttime !== captured.starttime) {
        settled = true;
        reject(maintenanceChildExitUnproven("Production maintenance child PID/start identity changed before SIGTERM; no signal was sent."));
        return;
      }
      child.kill("SIGTERM");
      scheduleExitGrace(`${graceMessage} SIGTERM was sent to the exact child identity.`);
    }, timeoutMs);
    child.once("exit", () => { exitObserved = true; });
    child.once("error", (error) => {
      if (settled) return;
      childError = error;
      scheduleExitGrace(`Production maintenance child emitted an error but exact exit was not proven within ${exitGraceMs}ms.`);
    });
    child.once("close", async (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(exitGraceTimer);
      let identity;
      try {
        const observed = await promiseWithTimeout(
          observedIdentityPromise,
          exitGraceMs,
          "maintenance child identity acquisition exceeded its bounded deadline"
        );
        if (observed.error) throw observed.error;
        identity = observed.value;
      } catch (error) {
        reject(maintenanceChildExitUnproven(`Production maintenance child identity was not proven: ${error instanceof Error ? error.message : String(error)}.`));
        return;
      }
      if (!identity || identity.pid !== child.pid || typeof identity.starttime !== "string" || !identity.starttime) {
        reject(maintenanceChildExitUnproven("Production maintenance child PID/start identity did not match the observed child exit."));
        return;
      }
      if (timedOut) {
        reject(new Error(`Production maintenance child exceeded ${timeoutMs}ms and exited after SIGTERM; no SIGKILL was sent.`));
        return;
      }
      if (childError) {
        reject(childError);
        return;
      }
      if (code !== 0) {
        reject(new Error(`Production maintenance ${action} failed (code=${code}, signal=${signal || "none"}): ${stderr.trim() || "no diagnostic"}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Production maintenance ${action} returned an invalid receipt.`, { cause: error }));
      }
    });
  });
}

async function captureMaintenanceChildIdentity(child) {
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) throw new Error("maintenance_child_pid_missing");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const record = await readProcess(child.pid);
    if (record?.starttime) return { pid: child.pid, starttime: record.starttime };
    await delay(5);
  }
  throw new Error("maintenance_child_start_identity_unavailable");
}

function maintenanceChildExitUnproven(message) {
  const error = new Error(message);
  error.code = "maintenance_child_exit_unproven";
  return error;
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
