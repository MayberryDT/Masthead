#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  cp,
  link,
  lstat,
  mkdir,
  open,
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
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { verifyPackagedBundleManifest } from "./packaged-bundle-manifest.js";
import { runColdProductionActivation } from "./masthead-production-cold-activation.js";

const DEFAULT_PORT = 17383;
const PRODUCTION_HEALTH_INTERVAL_MS = 250;
const PRODUCTION_HEALTH_TIMEOUT_MS = 300_000;
const PRODUCTION_SHUTDOWN_TIMEOUT_MS = 30_000;
const PRODUCTION_MAINTENANCE_TIMEOUT_MS = 43_200_000;
const PRODUCTION_MAINTENANCE_EXIT_GRACE_MS = 30_000;
const VERSIONED_TARGET = /^Masthead-linux-x64-[A-Za-z0-9][A-Za-z0-9._+-]*$/u;

export function productionHealthPollPolicy() {
  return {
    intervalMs: PRODUCTION_HEALTH_INTERVAL_MS,
    maxAttempts: PRODUCTION_HEALTH_TIMEOUT_MS / PRODUCTION_HEALTH_INTERVAL_MS,
    timeoutMs: PRODUCTION_HEALTH_TIMEOUT_MS
  };
}

export function productionMaintenanceTimeoutPolicy() {
  return {
    exitGraceMs: PRODUCTION_MAINTENANCE_EXIT_GRACE_MS,
    timeoutMs: PRODUCTION_MAINTENANCE_TIMEOUT_MS
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

export async function installProductionLauncher(input, dependencyOverrides = {}) {
  const homeDir = resolve(input.homeDir || homedir());
  const lease = await acquireLifecycleLease(resolve(input.lifecycleLeasePath || join(homeDir, ".local", "state", "masthead-production", "launcher.lease.sqlite")));
  try {
    const productionRoot = resolve(input.productionRoot || join(homeDir, ".local", "share", "masthead-production"));
    const dataDirectory = resolve(input.dataDirectory || join(homeDir, ".config", "masthead-production"));
    const pending = await readTransitionJournal(resolve(input.databasePath || join(dataDirectory, "masthead.sqlite")));
    await cleanupSafeStageOrphans(productionRoot, [input.bundlePath, ...bundlePathsFromMaintenanceJournal(pending)], homeDir);
    await gatePendingProductionLifecycle(productionRoot, "install");
    return await installProductionLauncherUnlocked(input, dependencyOverrides);
  } finally {
    await lease.release();
  }
}

async function installProductionLauncherUnlocked(input, dependencyOverrides = {}) {
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
  await assertRequiredProductionRuntimeResources(runtime);

  const homeDir = resolve(input.homeDir || homedir());
  const binDirectory = join(homeDir, ".local", "bin");
  const applicationDirectory = join(homeDir, ".local", "share", "applications");
  const launcherPath = join(binDirectory, "masthead-production");
  const desktopPath = join(applicationDirectory, "ai.animas.masthead.desktop");
  const dataDirectory = resolve(input.dataDirectory || join(homeDir, ".config", "masthead-production"));
  const databasePath = resolve(input.databasePath || join(dataDirectory, "masthead.sqlite"));
  const lifecycleLeasePath = resolve(input.lifecycleLeasePath || join(homeDir, ".local", "state", "masthead-production", "launcher.lease.sqlite"));
  const port = validPort(input.port ?? DEFAULT_PORT);
  await Promise.all([mkdir(binDirectory, { recursive: true }), mkdir(applicationDirectory, { recursive: true })]);

  const wrapper = productionWrapper({
    dataDirectory,
    databasePath,
    gitSha: release.gitSha,
    bundleDigest: bundleManifest.bundleDigest,
    lifecycleLeasePath,
    port,
    productionRoot,
    target,
    version: release.version
  });
  const desktop = productionDesktopEntry(launcherPath, target);
  await atomicWrite(launcherPath, wrapper, 0o755);
  await atomicWrite(desktopPath, desktop, 0o644);
  refreshDesktopDatabase(applicationDirectory, dependencyOverrides.runDesktopDatabaseCommand);
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
    acquireLease: async () => {
      const lease = await acquireLifecycleLease(config.lifecycleLeasePath);
      try {
        const pending = await readTransitionJournal(config.databasePath);
        await cleanupSafeStageOrphans(config.productionRoot, [config.target, ...bundlePathsFromMaintenanceJournal(pending)], homeDir);
        await gatePendingProductionLifecycle(config.productionRoot, "cold-activate");
        return lease;
      } catch (error) {
        await lease.release();
        throw error;
      }
    },
    assertLegacyIdentity: (identity) => assertLegacyTargetIdentity(identity, productionRoot),
    assertOffline: () => assertColdProductionOffline(config),
    attestCandidate: () => attestCandidate(config),
    captureLegacyIdentity: (legacyTarget) => captureLegacyTargetIdentity(legacyTarget, productionRoot),
    cleanupBundles: () => cleanupOldProductionBundles(productionRoot, target),
    completeMaintenance: (request) => runMaintenanceChild(config, "complete", request),
    currentTarget: () => realpath(join(productionRoot, "current")).catch(() => undefined),
    installCandidateSurface: () => installProductionLauncherUnlocked({
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
  await assertRequiredProductionRuntimeResources(runtime);
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
  let preparedInstallation;
  const noLifecycleLease = async () => ({ release: async () => undefined });
  const dependencies = {
    acquireLease: () => acquireLifecycleLease(config.lifecycleLeasePath),
    activateLaunchers: (staged) => staged?.receiptVersion === "masthead-production-stage-v1"
      ? activateStagedProductionInstallationUnlocked(staged.receiptPath, { assertOffline: dependencyOverrides.assertOffline, runDesktopDatabaseCommand: dependencyOverrides.runDesktopDatabaseCommand })
      : activateStagedLaunchers(staged, dependencyOverrides.runDesktopDatabaseCommand),
    cleanupCandidate: (candidate) => stopProduction(candidate, { acquireLease: noLifecycleLease }),
    completeMaintenance: (request) => runMaintenanceChild(config, "complete", request),
    currentTarget: () => realpath(join(productionRoot, "current")).catch(() => undefined),
    readMaintenanceJournal: () => readTransitionJournal(config.databasePath),
    prepareMaintenance: (request) => runMaintenanceChild(config, "prepare", request),
    recoverLaunchers: (oldBundle) => installProductionLauncherUnlocked({
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
    cleanupBundles: () => preparedInstallation
      ? finalizeStagedProductionInstallationUnlocked(preparedInstallation.receiptPath, { verifyLiveProof: dependencyOverrides.verifyLiveProof })
      : cleanupOldProductionBundles(productionRoot, target),
    cleanupRecoveredBundles: (oldTarget) => cleanupOldProductionBundles(productionRoot, oldTarget),
    stageLaunchers: () => preparedInstallation ?? stageProductionLaunchers({ ...input, bundlePath: target, homeDir, productionRoot }),
    start: (candidate = config) => startProduction(candidate, { acquireLease: noLifecycleLease }),
    stop: () => stopProduction(config, { acquireLease: noLifecycleLease }),
    swapCurrent: () => preparedInstallation ? undefined : swapCurrentTarget(productionRoot, target),
    ...dependencyOverrides
  };
  const lease = await dependencies.acquireLease();
  let staged;
  let oldTarget;
  try {
    await gatePendingProductionLifecycle(productionRoot, "transition");
    const pending = await dependencies.readMaintenanceJournal();
    await cleanupSafeStageOrphans(productionRoot, [target, ...bundlePathsFromMaintenanceJournal(pending)], homeDir);
    if (!dependencyOverrides.stageLaunchers) {
      try {
        preparedInstallation = await stageProductionInstallationUnlocked(
          { ...input, sourceBundlePath: target, homeDir, productionRoot },
          {
            dataDirectory: config.dataDirectory,
            databasePath: config.databasePath,
            homeDir,
            lifecycleLeasePath: config.lifecycleLeasePath,
            port: config.port,
            productionRoot
          }
        );
      } catch (error) {
        await cleanupSafeStageOrphans(productionRoot, [target], homeDir).catch(() => undefined);
        throw error;
      }
    }
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
    if (staged && !preparedInstallation) await discardStagedLaunchers(staged);
    if (preparedInstallation && !staged) {
      await discardStagedLaunchers(preparedInstallation);
      await rm(preparedInstallation.receiptPath, { force: true });
    }
    await lease.release();
  }
}

export async function stageProductionInstallation(input) {
  const homeDir = resolve(input.homeDir || homedir());
  const productionRoot = resolve(input.productionRoot || join(homeDir, ".local", "share", "masthead-production"));
  const dataDirectory = resolve(input.dataDirectory || join(homeDir, ".config", "masthead-production"));
  const databasePath = resolve(input.databasePath || join(dataDirectory, "masthead.sqlite"));
  const port = input.port ?? DEFAULT_PORT;
  const lifecycleLeasePath = resolve(input.lifecycleLeasePath || join(homeDir, ".local", "state", "masthead-production", "launcher.lease.sqlite"));
  const lease = await acquireLifecycleLease(lifecycleLeasePath);
  try {
    await cleanupSafeStageOrphans(productionRoot, [input.sourceBundlePath || input.bundlePath], homeDir);
    const pending = await gatePendingProductionLifecycle(productionRoot, "stage");
    if (pending === "completed") throw new Error("A previous staged activation must be finalized before staging another bundle.");
    return await stageProductionInstallationUnlocked(input, { dataDirectory, databasePath, homeDir, lifecycleLeasePath, port, productionRoot });
  } catch (error) {
    await cleanupSafeStageOrphans(productionRoot, [input.sourceBundlePath || input.bundlePath], homeDir).catch(() => undefined);
    throw error;
  } finally {
    await lease.release();
  }
}

async function stageProductionInstallationUnlocked(input, identity) {
  const { dataDirectory, databasePath, homeDir, lifecycleLeasePath, port, productionRoot } = identity;
  const sourceBundlePath = await realpath(input.sourceBundlePath || input.bundlePath || "");
  await mkdir(productionRoot, { recursive: true });
  const release = await readRelease(sourceBundlePath);
  let target;
  if (dirname(sourceBundlePath) === await realpath(productionRoot) && VERSIONED_TARGET.test(basename(sourceBundlePath))) {
    target = sourceBundlePath;
  } else {
    target = join(productionRoot, `Masthead-linux-x64-${release.version}-${release.gitSha.slice(0, 8)}`);
    const temporaryTarget = `${target}.${process.pid}.${randomUUID()}.staged`;
    await cp(sourceBundlePath, temporaryTarget, { errorOnExist: true, recursive: true });
    try {
      await rename(temporaryTarget, target);
    } catch (error) {
      await rm(temporaryTarget, { force: true, recursive: true });
      if (!(error && typeof error === "object" && error.code === "EEXIST")) throw error;
    }
  }
  await input.onStageStep?.("candidate-copy");
  const manifest = await verifyPinnedBundle(target, input.bundleDigest);
  const runtime = productionRuntimePaths(target);
  await assertRequiredProductionRuntimeResources(runtime);
  const currentPath = join(productionRoot, "current");
  const previousCurrentTarget = await realpath(currentPath);
  const instanceDir = dataDirectory;
  const instanceManifestPath = join(instanceDir, "masthead-instance.json");
  const activeInstanceLauncherPath = join(instanceDir, "bin", process.platform === "win32" ? "mastheadctl.cmd" : "mastheadctl");
  const previousInstanceLauncher = await snapshotFile(activeInstanceLauncherPath);
  const stagingNonce = randomUUID();
  const stagedInstanceLauncherPath = join(productionRoot, `.mastheadctl.${stagingNonce}.staged`);
  const instanceLauncher = productionInstanceLauncher({
    cliEntry: runtime.cliEntry,
    instanceManifestPath,
    node: runtime.node
  });
  await writeFile(stagedInstanceLauncherPath, instanceLauncher, { encoding: "utf8", mode: 0o755 });
  await chmod(stagedInstanceLauncherPath, 0o755);
  await input.onStageStep?.("instance-stage");
  const stagedSurface = await stageProductionLaunchers({
    ...input,
    bundlePath: target,
    homeDir,
    productionRoot
  });
  await input.onStageStep?.("surface-stage");
  const rollbackRelease = await readRelease(previousCurrentTarget);
  const rollbackManifest = await verifyPackagedBundleManifest({
    bundleRoot: previousCurrentTarget,
    executablePath: productionRuntimePaths(previousCurrentTarget).executable,
    nodePath: productionRuntimePaths(previousCurrentTarget).node,
    resourcesPath: join(previousCurrentTarget, "resources")
  });
  const receiptPath = join(productionRoot, `.masthead-install-${stagingNonce}.receipt.json`);
  const receipt = {
    receiptVersion: "masthead-production-stage-v1",
    staged: true,
    launched: false,
    databaseOpened: false,
    stagingNonce,
    sourceDigest: manifest.bundleDigest,
    buildSha: release.gitSha,
    buildVersion: release.version,
    baseUrl: `http://127.0.0.1:${port}`,
    databasePath,
    dataDirectory,
    port,
    lifecycleLeasePath,
    rollbackBundle: { path: previousCurrentTarget, buildSha: rollbackRelease.gitSha, version: rollbackRelease.version, bundleDigest: rollbackManifest.bundleDigest },
    target,
    productionRoot,
    currentPath,
    previousCurrentTarget,
    instanceDir,
    instanceManifestPath,
    activeInstanceLauncherPath,
    stagedInstanceLauncherPath,
    stagedSurface,
    previousInstanceLauncher,
    previousLauncher: stagedSurface.previousLauncher,
    previousDesktop: stagedSurface.previousDesktop,
    receiptPath
  };
  receipt.stagedFiles = await Promise.all([
    attestStagedFile(stagedInstanceLauncherPath),
    attestStagedFile(stagedSurface.launcherStage),
    attestStagedFile(stagedSurface.desktopStage)
  ]);
  await atomicWrite(receiptPath, `${JSON.stringify(stagedReceiptRecord(receipt), null, 2)}\n`, 0o444);
  return receipt;
}

export async function loadStagedProductionInstallation(receiptPathInput) {
  const receiptPath = resolve(required(receiptPathInput, "staged production receipt path"));
  const record = JSON.parse(await readFile(receiptPath, "utf8"));
  return hydrateStagedReceiptRecord(record, receiptPath);
}

function hydrateStagedReceiptRecord(record, receiptPath) {
  if (record?.receiptVersion !== "masthead-production-stage-v1" || record?.staged !== true || record.receiptPath !== receiptPath) {
    throw new Error("Invalid staged production installation receipt.");
  }
  validateStagedReceiptPaths(record);
  return {
    ...record,
    previousInstanceLauncher: snapshotFromReceipt(record.previousInstanceLauncher),
    previousLauncher: snapshotFromReceipt(record.previousLauncher),
    previousDesktop: snapshotFromReceipt(record.previousDesktop),
    stagedSurface: {
      ...record.stagedSurface,
      previousLauncher: snapshotFromReceipt(record.stagedSurface.previousLauncher),
      previousDesktop: snapshotFromReceipt(record.stagedSurface.previousDesktop)
    }
  };
}

export async function activateStagedProductionInstallation(receiptInput, dependencyOverrides = {}) {
  const receiptPath = typeof receiptInput === "string" ? receiptInput : receiptInput?.receiptPath;
  const preliminaryReceipt = await loadStagedProductionInstallation(receiptPath);
  const lease = await acquireLifecycleLease(preliminaryReceipt.lifecycleLeasePath);
  try {
    await cleanupSafeStageOrphans(preliminaryReceipt.productionRoot, [preliminaryReceipt.target], dirname(dirname(dirname(preliminaryReceipt.stagedSurface.launcherPath))));
    if (await gatePendingProductionLifecycle(preliminaryReceipt.productionRoot, "activate", preliminaryReceipt.receiptPath) === "completed") {
      return { activated: true, launched: false, databaseOpened: false, currentPath: preliminaryReceipt.currentPath, target: preliminaryReceipt.target };
    }
    return await activateStagedProductionInstallationUnlocked(receiptPath, dependencyOverrides);
  } finally {
    await lease.release();
  }
}

async function activateStagedProductionInstallationUnlocked(receiptPath, dependencyOverrides) {
  const receipt = await loadStagedProductionInstallation(receiptPath);
  await verifyPinnedBundle(receipt.rollbackBundle.path, receipt.rollbackBundle.bundleDigest);
  const rollbackRelease = await readRelease(receipt.rollbackBundle.path);
  if (rollbackRelease.gitSha !== receipt.rollbackBundle.buildSha || rollbackRelease.version !== receipt.rollbackBundle.version) {
    throw new Error("Staged rollback bundle release identity changed before activation.");
  }
  await (dependencyOverrides.assertOffline ?? assertStagedActivationOffline)(receipt);
  const currentTarget = await realpath(receipt.currentPath);
  if (currentTarget !== receipt.previousCurrentTarget) {
    throw new Error(`Production current target changed after staging: expected ${receipt.previousCurrentTarget}, found ${currentTarget}.`);
  }
  await verifyPinnedBundle(receipt.target, receipt.sourceDigest);
  await assertRequiredProductionRuntimeResources(productionRuntimePaths(receipt.target));
  await Promise.all([
    assertSnapshotUnchanged(receipt.activeInstanceLauncherPath, receipt.previousInstanceLauncher),
    assertSnapshotUnchanged(receipt.stagedSurface.launcherPath, receipt.previousLauncher),
    assertSnapshotUnchanged(receipt.stagedSurface.desktopPath, receipt.previousDesktop)
  ]);
  await mkdir(dirname(receipt.activeInstanceLauncherPath), { recursive: true });
  const stagedInstanceAttestation = stagedFileAttestation(receipt, receipt.stagedInstanceLauncherPath);
  const stagedLifecycleAttestation = stagedFileAttestation(receipt, receipt.stagedSurface.launcherStage);
  const stagedDesktopAttestation = stagedFileAttestation(receipt, receipt.stagedSurface.desktopStage);
  const [stagedInstanceBody, stagedLifecycleBody, stagedDesktopBody] = await Promise.all([
    readAttestedStagedFile(stagedInstanceAttestation),
    readAttestedStagedFile(stagedLifecycleAttestation),
    readAttestedStagedFile(stagedDesktopAttestation)
  ]);
  const expectedLeaseAssignment = `MASTHEAD_LIFECYCLE_LEASE=${shellQuote(receipt.lifecycleLeasePath)}`;
  if (!stagedLifecycleBody.toString("utf8").split("\n").includes(expectedLeaseAssignment)) {
    throw new Error("Staged production lifecycle launcher does not bind the receipt lifecycle lease.");
  }
  const activationJournalPath = productionActivationJournalPath(receipt.productionRoot);
  try {
    await writeActivationJournal(activationJournalPath, receipt, "before-current");
    await swapCurrentTarget(receipt.productionRoot, receipt.target);
    await dependencyOverrides.onStep?.("current");
    simulateActivationProcessDeath(dependencyOverrides, "current");
    await writeActivationJournal(activationJournalPath, receipt, "before-instance-launcher");
    await atomicWrite(receipt.activeInstanceLauncherPath, stagedInstanceBody, stagedInstanceAttestation.mode);
    await dependencyOverrides.onStep?.("instance-launcher");
    simulateActivationProcessDeath(dependencyOverrides, "instance-launcher");
    await writeActivationJournal(activationJournalPath, receipt, "before-lifecycle-launcher");
    await atomicWrite(receipt.stagedSurface.launcherPath, stagedLifecycleBody, stagedLifecycleAttestation.mode);
    await dependencyOverrides.onStep?.("lifecycle-launcher");
    simulateActivationProcessDeath(dependencyOverrides, "lifecycle-launcher");
    await writeActivationJournal(activationJournalPath, receipt, "before-desktop");
    await atomicWrite(receipt.stagedSurface.desktopPath, stagedDesktopBody, stagedDesktopAttestation.mode);
    await dependencyOverrides.onStep?.("desktop");
    simulateActivationProcessDeath(dependencyOverrides, "desktop");
    refreshDesktopDatabase(dirname(receipt.stagedSurface.desktopPath), dependencyOverrides.runDesktopDatabaseCommand);
    receipt.activatedAt = new Date().toISOString();
    await persistStagedReceipt(receipt);
    await writeActivationJournal(activationJournalPath, receipt, "activation-committed");
  } catch (error) {
    if (error?.code === "simulated_activation_process_death") throw error;
    let rollbackError;
    try {
      await swapCurrentTarget(receipt.productionRoot, receipt.previousCurrentTarget);
      await restoreSnapshot(receipt.activeInstanceLauncherPath, receipt.previousInstanceLauncher);
      await restoreSnapshot(receipt.stagedSurface.launcherPath, receipt.previousLauncher);
      await restoreSnapshot(receipt.stagedSurface.desktopPath, receipt.previousDesktop);
      refreshDesktopDatabase(dirname(receipt.stagedSurface.desktopPath), dependencyOverrides.runDesktopDatabaseCommand);
      delete receipt.activatedAt;
      await persistStagedReceipt(receipt);
      await rm(activationJournalPath, { force: true });
    } catch (rollbackFailure) {
      rollbackError = rollbackFailure;
    }
    throw new Error(`${error instanceof Error ? error.message : String(error)}${rollbackError ? `; activation rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}` : ""}`, { cause: error });
  }
  return {
    activated: true,
    launched: false,
    databaseOpened: false,
    currentPath: receipt.currentPath,
    target: receipt.target,
    activeInstanceLauncherPath: receipt.activeInstanceLauncherPath,
    instanceManifestPath: receipt.instanceManifestPath
  };
}

function simulateActivationProcessDeath(dependencies, step) {
  if (dependencies.simulateProcessDeathAfterStep !== step) return;
  const error = new Error(`simulated process death after ${step}`);
  error.code = "simulated_activation_process_death";
  throw error;
}

function productionActivationJournalPath(productionRoot) {
  return join(productionRoot, ".masthead-install-activation.journal.json");
}

async function writeActivationJournal(path, receipt, phase) {
  const receiptRecord = stagedReceiptRecord(receipt);
  const receiptHash = createHash("sha256").update(JSON.stringify(receiptRecord)).digest("hex");
  const existing = await readFile(path, "utf8").then(JSON.parse).catch(() => undefined);
  const transitions = [...(Array.isArray(existing?.transitions) ? existing.transitions : []), { phase, completedAt: new Date().toISOString() }];
  await atomicWrite(path, `${JSON.stringify({
    schemaVersion: 2,
    receiptPath: receipt.receiptPath,
    receiptHash,
    stagingNonce: receipt.stagingNonce,
    phase,
    before: {
      current: receipt.previousCurrentTarget,
      instanceLauncher: snapshotForReceipt(receipt.previousInstanceLauncher),
      lifecycleLauncher: snapshotForReceipt(receipt.previousLauncher),
      desktop: snapshotForReceipt(receipt.previousDesktop)
    },
    after: receipt.stagedFiles,
    build: { buildSha: receipt.buildSha, buildVersion: receipt.buildVersion, sourceDigest: receipt.sourceDigest },
    recovery: { rollbackBundle: receipt.rollbackBundle },
    receipt: receiptRecord,
    transitions,
    updatedAt: new Date().toISOString()
  }, null, 2)}\n`, 0o600);
}

async function gatePendingProductionLifecycle(productionRoot, command, expectedReceiptPath) {
  const path = productionActivationJournalPath(productionRoot);
  let journal;
  try {
    journal = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return "none";
    throw error;
  }
  if (![1, 2].includes(journal?.schemaVersion) || typeof journal.receiptPath !== "string") throw new Error("Production lifecycle journal is malformed.");
  if (expectedReceiptPath && journal.receiptPath !== expectedReceiptPath) throw new Error("Production lifecycle journal belongs to a different staged receipt.");
  let receipt;
  try {
    receipt = await loadStagedProductionInstallation(journal.receiptPath);
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT") || !journal.receipt) throw error;
    receipt = hydrateStagedReceiptRecord(journal.receipt, journal.receiptPath);
  }
  if (journal.schemaVersion === 2) {
    const receiptHash = createHash("sha256").update(JSON.stringify(stagedReceiptRecord(receipt))).digest("hex");
    if (receiptHash !== journal.receiptHash) throw new Error("Production lifecycle journal receipt hash mismatch.");
  }
  if (command === "finalize" && (journal.phase.startsWith("finalize-cleanup-") || journal.phase === "finalize-after-stage-cleanup")) {
    return "resume-finalization";
  }
  const result = await recoverInterruptedProductionActivation(receipt);
  if (result === "completed" && ["stage", "install", "cold-activate", "transition"].includes(command)) {
    throw new Error(`Pending activation must be finalized before ${command}.`);
  }
  if (result === "rolled_back" && command !== "activate") {
    throw new Error(`Recovered an interrupted activation before ${command}; rerun activation before continuing.`);
  }
  return result;
}

async function recoverInterruptedProductionActivation(receipt) {
  const journalPath = productionActivationJournalPath(receipt.productionRoot);
  let journal;
  try {
    journal = JSON.parse(await readFile(journalPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
  if (![1, 2].includes(journal?.schemaVersion) || journal.receiptPath !== receipt.receiptPath || journal.stagingNonce !== receipt.stagingNonce) {
    throw new Error("Production activation journal does not match the staged receipt.");
  }
  const current = await realpath(receipt.currentPath);
  if (current !== receipt.previousCurrentTarget && current !== receipt.target) throw new Error("Interrupted production activation current target is not recoverable.");
  const stagedInstance = await readAttestedStagedFile(stagedFileAttestation(receipt, receipt.stagedInstanceLauncherPath));
  const stagedLifecycle = await readAttestedStagedFile(stagedFileAttestation(receipt, receipt.stagedSurface.launcherStage));
  const stagedDesktop = await readAttestedStagedFile(stagedFileAttestation(receipt, receipt.stagedSurface.desktopStage));
  if (receipt.activatedAt && current === receipt.target) {
    await Promise.all([
      assertActiveMatchesStaged(receipt.activeInstanceLauncherPath, stagedFileAttestation(receipt, receipt.stagedInstanceLauncherPath)),
      assertActiveMatchesStaged(receipt.stagedSurface.launcherPath, stagedFileAttestation(receipt, receipt.stagedSurface.launcherStage)),
      assertActiveMatchesStaged(receipt.stagedSurface.desktopPath, stagedFileAttestation(receipt, receipt.stagedSurface.desktopStage))
    ]);
    return "completed";
  }
  await Promise.all([
    assertSnapshotBeforeOrAfter(receipt.activeInstanceLauncherPath, receipt.previousInstanceLauncher, stagedInstance),
    assertSnapshotBeforeOrAfter(receipt.stagedSurface.launcherPath, receipt.previousLauncher, stagedLifecycle),
    assertSnapshotBeforeOrAfter(receipt.stagedSurface.desktopPath, receipt.previousDesktop, stagedDesktop)
  ]);
  await swapCurrentTarget(receipt.productionRoot, receipt.previousCurrentTarget);
  await restoreSnapshot(receipt.activeInstanceLauncherPath, receipt.previousInstanceLauncher);
  await restoreSnapshot(receipt.stagedSurface.launcherPath, receipt.previousLauncher);
  await restoreSnapshot(receipt.stagedSurface.desktopPath, receipt.previousDesktop);
  delete receipt.activatedAt;
  await persistStagedReceipt(receipt);
  await rm(journalPath);
  return "rolled_back";
}

export async function finalizeStagedProductionInstallation(receiptInput, dependencyOverrides = {}) {
  const receiptPath = typeof receiptInput === "string" ? receiptInput : receiptInput?.receiptPath;
  const preliminaryReceipt = await loadFinalizationReceipt(receiptPath);
  const lease = await acquireLifecycleLease(preliminaryReceipt.lifecycleLeasePath);
  try {
    return await finalizeStagedProductionInstallationUnlocked(receiptPath, dependencyOverrides);
  } finally {
    await lease.release();
  }
}

async function finalizeStagedProductionInstallationUnlocked(receiptPath, dependencyOverrides = {}) {
    const preliminaryReceipt = await loadFinalizationReceipt(receiptPath);
    if (preliminaryReceipt.finalizationCommitted === true) {
      await assertCommittedFinalization(preliminaryReceipt);
      return { finalized: true, recovered: true, target: preliminaryReceipt.target, receiptRemoved: true };
    }
    const pending = await gatePendingProductionLifecycle(preliminaryReceipt.productionRoot, "finalize", preliminaryReceipt.receiptPath);
    if (pending === "resume-finalization") {
      await assertResumableFinalizationProof(preliminaryReceipt, dependencyOverrides);
      await continueFinalizationCleanup(preliminaryReceipt, dependencyOverrides);
      return { finalized: true, recovered: true, target: preliminaryReceipt.target, receiptRemoved: true };
    }
    const receipt = await loadStagedProductionInstallation(receiptPath);
    if (await realpath(receipt.currentPath) !== receipt.target) throw new Error("Cannot finalize a staged installation that is not current.");
    await verifyStagedCandidateIdentity(receipt);
    await Promise.all([
      assertActiveMatchesStaged(receipt.activeInstanceLauncherPath, stagedFileAttestation(receipt, receipt.stagedInstanceLauncherPath)),
      assertActiveMatchesStaged(receipt.stagedSurface.launcherPath, stagedFileAttestation(receipt, receipt.stagedSurface.launcherStage)),
      assertActiveMatchesStaged(receipt.stagedSurface.desktopPath, stagedFileAttestation(receipt, receipt.stagedSurface.desktopStage))
    ]);
    const verifyLiveProof = dependencyOverrides.verifyLiveProof ?? assertSuccessfulStagedStartup;
    await verifyLiveProof(receipt, dependencyOverrides);
    const journalPath = productionActivationJournalPath(receipt.productionRoot);
    await writeActivationJournal(journalPath, receipt, "finalize-before-artifact-cleanup");
    await verifyStagedCandidateIdentity(receipt);
    await Promise.all([
      assertActiveMatchesStaged(receipt.activeInstanceLauncherPath, stagedFileAttestation(receipt, receipt.stagedInstanceLauncherPath)),
      assertActiveMatchesStaged(receipt.stagedSurface.launcherPath, stagedFileAttestation(receipt, receipt.stagedSurface.launcherStage)),
      assertActiveMatchesStaged(receipt.stagedSurface.desktopPath, stagedFileAttestation(receipt, receipt.stagedSurface.desktopStage))
    ]);
    await verifyLiveProof(receipt, dependencyOverrides);
    await assertNoOtherLifecycleArtifacts(receipt);
    await continueFinalizationCleanup(receipt, dependencyOverrides);
    return { finalized: true, target: receipt.target, receiptRemoved: true };
}

async function loadFinalizationReceipt(receiptPathInput) {
  const receiptPath = resolve(required(receiptPathInput, "staged production receipt path"));
  try {
    return await loadStagedProductionInstallation(receiptPath);
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
    try {
      const journal = JSON.parse(await readFile(productionActivationJournalPath(dirname(receiptPath)), "utf8"));
      if (!journal?.receipt || journal.receiptPath !== receiptPath || !String(journal.phase).startsWith("finalize-cleanup-")) throw error;
      return hydrateStagedReceiptRecord(journal.receipt, receiptPath);
    } catch (journalError) {
      if (!(journalError && typeof journalError === "object" && journalError.code === "ENOENT")) throw journalError;
      const marker = JSON.parse(await readFile(finalizationCompletionMarkerPath(receiptPath), "utf8"));
      const receiptHash = createHash("sha256").update(JSON.stringify(marker.receipt)).digest("hex");
      if (marker?.schemaVersion !== 1 || marker.receiptPath !== receiptPath || marker.receiptHash !== receiptHash) throw error;
      return { ...hydrateStagedReceiptRecord(marker.receipt, receiptPath), finalizationCommitted: true };
    }
  }
}

async function assertCommittedFinalization(receipt) {
  if (await realpath(receipt.currentPath) !== receipt.target) throw new Error("Committed production finalization current target changed.");
  await verifyStagedCandidateIdentity(receipt);
  await Promise.all([
    assertActiveMatchesAttestation(receipt.activeInstanceLauncherPath, stagedFileAttestation(receipt, receipt.stagedInstanceLauncherPath)),
    assertActiveMatchesAttestation(receipt.stagedSurface.launcherPath, stagedFileAttestation(receipt, receipt.stagedSurface.launcherStage)),
    assertActiveMatchesAttestation(receipt.stagedSurface.desktopPath, stagedFileAttestation(receipt, receipt.stagedSurface.desktopStage))
  ]);
  await assertFinalizedProductionHygiene(receipt);
}

async function assertResumableFinalizationProof(receipt, dependencyOverrides) {
  if (await realpath(receipt.currentPath) !== receipt.target) throw new Error("Cannot resume finalization for a production installation that is not current.");
  await verifyStagedCandidateIdentity(receipt);
  await Promise.all([
    assertActiveMatchesAttestation(receipt.activeInstanceLauncherPath, stagedFileAttestation(receipt, receipt.stagedInstanceLauncherPath)),
    assertActiveMatchesAttestation(receipt.stagedSurface.launcherPath, stagedFileAttestation(receipt, receipt.stagedSurface.launcherStage)),
    assertActiveMatchesAttestation(receipt.stagedSurface.desktopPath, stagedFileAttestation(receipt, receipt.stagedSurface.desktopStage))
  ]);
  await (dependencyOverrides.verifyLiveProof ?? assertSuccessfulStagedStartup)(receipt, dependencyOverrides);
  await assertNoOtherLifecycleArtifacts(receipt);
}

async function continueFinalizationCleanup(receipt, dependencyOverrides) {
  const journalPath = productionActivationJournalPath(receipt.productionRoot);
  const removeWithJournal = async (path, options, label) => {
    await writeActivationJournal(journalPath, receipt, `finalize-cleanup-before-${label}`);
    await rm(path, options);
    await writeActivationJournal(journalPath, receipt, `finalize-cleanup-after-${label}`);
    await dependencyOverrides.onFinalizeStep?.(label);
  };
  await cleanupProductionInstallArtifacts(receipt.productionRoot, receipt.target, removeWithJournal);
  for (const [index, path] of [receipt.stagedInstanceLauncherPath, receipt.stagedSurface.launcherStage, receipt.stagedSurface.desktopStage].entries()) {
    await removeWithJournal(path, { force: true }, `staged-${index}`);
  }
  await writeActivationJournal(journalPath, receipt, "finalize-after-stage-cleanup");
  await assertFinalizedProductionHygiene(receipt);
  await writeFinalizationCompletionMarker(receipt);
  await writeActivationJournal(journalPath, receipt, "finalize-cleanup-before-receipt");
  await rm(receipt.receiptPath, { force: true });
  await writeActivationJournal(journalPath, receipt, "finalize-cleanup-after-receipt");
  await dependencyOverrides.onFinalizeStep?.("receipt");
  await rm(journalPath);
  await dependencyOverrides.onFinalizeStep?.("journal");
}

function finalizationCompletionMarkerPath(receiptPath) {
  const productionRoot = dirname(resolve(receiptPath));
  const markerName = `${createHash("sha256").update(resolve(receiptPath)).digest("hex")}.json`;
  return join(dirname(productionRoot), ".masthead-production-finalization", markerName);
}

async function writeFinalizationCompletionMarker(receipt) {
  const markerPath = finalizationCompletionMarkerPath(receipt.receiptPath);
  const markerDirectory = dirname(markerPath);
  const receiptRecord = stagedReceiptRecord(receipt);
  await mkdir(markerDirectory, { recursive: true });
  await atomicWrite(markerPath, `${JSON.stringify({
    schemaVersion: 1,
    receiptPath: receipt.receiptPath,
    receiptHash: createHash("sha256").update(JSON.stringify(receiptRecord)).digest("hex"),
    receipt: receiptRecord,
    committedAt: new Date().toISOString()
  }, null, 2)}\n`, 0o600);
  for (const entry of await readdir(markerDirectory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json") && join(markerDirectory, entry.name) !== markerPath) {
      await rm(join(markerDirectory, entry.name), { force: true });
    }
  }
}

async function assertFinalizedProductionHygiene(receipt) {
  const entries = await readdir(receipt.productionRoot);
  const bundles = entries.filter((name) => VERSIONED_TARGET.test(name));
  if (bundles.length !== 1 || bundles[0] !== basename(receipt.target)) throw new Error("Finalized production hygiene did not retain exactly one bundle.");
  const currentReceipt = basename(receipt.receiptPath);
  const forbidden = entries.filter((name) =>
    name.endsWith(".staged") ||
    (name.endsWith(".receipt.json") && name !== currentReceipt) ||
    /^(?:previous|backup-|helper)/u.test(name) ||
    name === "app-menu-icons"
  );
  if (forbidden.length > 0) throw new Error(`Finalized production hygiene left stale artifacts: ${forbidden.join(", ")}`);
}

async function assertNoOtherLifecycleArtifacts(receipt) {
  const currentReceipt = basename(receipt.receiptPath);
  const currentJournal = basename(productionActivationJournalPath(receipt.productionRoot));
  const ownedStages = new Set([
    basename(receipt.stagedInstanceLauncherPath),
    basename(receipt.stagedSurface.launcherStage),
    basename(receipt.stagedSurface.desktopStage)
  ]);
  const entries = await readdir(receipt.productionRoot);
  const forbidden = entries.filter((name) =>
    (name.endsWith(".staged") && !ownedStages.has(name)) ||
    (name.endsWith(".receipt.json") && name !== currentReceipt) ||
    (name.endsWith(".journal.json") && name !== currentJournal)
  );
  if (forbidden.length > 0) throw new Error(`Finalized production hygiene left stale artifacts: ${forbidden.join(", ")}`);
}

function stagedReceiptRecord(receipt) {
  return {
    receiptVersion: receipt.receiptVersion,
    receiptPath: receipt.receiptPath,
    staged: true,
    launched: false,
    databaseOpened: false,
    ...(receipt.activatedAt ? { activatedAt: receipt.activatedAt } : {}),
    stagingNonce: receipt.stagingNonce,
    sourceDigest: receipt.sourceDigest,
    buildSha: receipt.buildSha,
    buildVersion: receipt.buildVersion,
    baseUrl: receipt.baseUrl,
    databasePath: receipt.databasePath,
    dataDirectory: receipt.dataDirectory,
    port: receipt.port,
    lifecycleLeasePath: receipt.lifecycleLeasePath,
    rollbackBundle: receipt.rollbackBundle,
    target: receipt.target,
    productionRoot: receipt.productionRoot,
    currentPath: receipt.currentPath,
    previousCurrentTarget: receipt.previousCurrentTarget,
    instanceDir: receipt.instanceDir,
    instanceManifestPath: receipt.instanceManifestPath,
    activeInstanceLauncherPath: receipt.activeInstanceLauncherPath,
    stagedInstanceLauncherPath: receipt.stagedInstanceLauncherPath,
    stagedFiles: receipt.stagedFiles,
    previousInstanceLauncher: snapshotForReceipt(receipt.previousInstanceLauncher),
    previousLauncher: snapshotForReceipt(receipt.previousLauncher),
    previousDesktop: snapshotForReceipt(receipt.previousDesktop),
    stagedSurface: {
      desktopPath: receipt.stagedSurface.desktopPath,
      desktopStage: receipt.stagedSurface.desktopStage,
      launcherPath: receipt.stagedSurface.launcherPath,
      launcherStage: receipt.stagedSurface.launcherStage,
      previousLauncher: snapshotForReceipt(receipt.stagedSurface.previousLauncher),
      previousDesktop: snapshotForReceipt(receipt.stagedSurface.previousDesktop)
    }
  };
}

async function persistStagedReceipt(receipt) {
  await atomicWrite(receipt.receiptPath, `${JSON.stringify(stagedReceiptRecord(receipt), null, 2)}\n`, 0o444);
}

async function assertSuccessfulStagedStartup(receipt) {
  const activatedAt = Date.parse(receipt.activatedAt);
  if (!Number.isFinite(activatedAt)) throw new Error("Cannot finalize before staged activation completes.");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(receipt.instanceManifestPath, "utf8"));
  } catch (error) {
    throw new Error("Cannot finalize before the activated production daemon publishes its startup manifest.", { cause: error });
  }
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.buildSha !== receipt.buildSha ||
    manifest.baseUrl !== receipt.baseUrl ||
    manifest.instanceDir !== receipt.instanceDir ||
    !Number.isSafeInteger(manifest.pid) || manifest.pid < 1 ||
    typeof manifest.instanceId !== "string" || !manifest.instanceId ||
    !Number.isFinite(Date.parse(manifest.updatedAt)) || Date.parse(manifest.updatedAt) < activatedAt
  ) throw new Error("Activated production startup manifest does not prove the staged target started successfully.");
  const [firstProcess, health] = await Promise.all([readProcess(manifest.pid), fetchHealth(receipt.port)]);
  const secondProcess = await readProcess(manifest.pid);
  if (!firstProcess?.starttime || firstProcess.starttime !== secondProcess?.starttime) throw new Error("Activated production daemon PID/start identity is not live.");
  const classified = classifyProductionProcess(firstProcess, {
    dataDirectory: receipt.dataDirectory,
    databasePath: receipt.databasePath,
    productionRoot: receipt.productionRoot,
    target: receipt.target
  });
  if (classified?.role !== "daemon" || classified.target !== receipt.target) throw new Error("Activated production daemon process does not belong to the staged target.");
  const compatibility = await classifyPackagedDaemonHealth(receipt, health);
  if (compatibility?.state !== "compatible") throw new Error(`Activated production health failed strict protocol classification: ${compatibility?.state || "unavailable"}.`);
  if (
    health?.runtime?.mode !== "primary" || health.runtime.writable !== true ||
    health.runtime.pid !== manifest.pid || health.runtime.daemonInstanceId !== manifest.instanceId ||
    health.runtime.baseUrl !== receipt.baseUrl || health.runtime.instanceDir !== receipt.instanceDir ||
    health.runtime.instanceManifest !== receipt.instanceManifestPath || health.runtime.authoringCommand !== receipt.activeInstanceLauncherPath ||
    health.data?.dataDirectory !== receipt.dataDirectory || health.data?.databasePath !== receipt.databasePath ||
    health.data?.databaseId !== manifest.databaseId || health.buildSha !== receipt.buildSha
  ) throw new Error("Activated production health does not match the staged receipt and daemon manifest.");
  await assertManifestWriterGuardActive(receipt.instanceDir);
}

async function classifyPackagedDaemonHealth(receipt, health) {
  const modulePath = join(receipt.target, "resources", "daemon", "dist", "src", "shared", "protocol.js");
  const module = await import(`${pathToFileURL(modulePath).href}?bundle=${receipt.sourceDigest}`);
  if (typeof module.classifyDaemonHealth !== "function") throw new Error(`Packaged strict health classifier is unavailable at ${modulePath}.`);
  return module.classifyDaemonHealth(health);
}

async function assertStagedActivationOffline(receipt) {
  const processes = await productionRootProcesses(receipt, { readProcesses: () => readProcesses(receipt) });
  if (processes.length > 0) throw new Error(`Staged activation requires an empty production process set: ${formatProcesses(processes)}.`);
  if (await fetchHealth(receipt.port)) throw new Error("Staged activation requires production health to be absent.");
  if (!(await portBindable(receipt.port))) throw new Error(`Staged activation requires port ${receipt.port} to be bindable.`);
  const databaseLease = await acquireLifecycleLease(`${receipt.databasePath}.lease.sqlite`);
  await databaseLease.release();
  await probeExclusiveOwnership(receipt);
  for (const path of [receipt.instanceManifestPath, join(receipt.dataDirectory, "runtime", "database.lock")]) {
    try {
      await access(path);
      throw new Error(`Staged activation requires runtime ownership state to be absent: ${path}`);
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
    }
  }
}

async function assertManifestWriterGuardActive(instanceDir) {
  const guardPath = join(instanceDir, ".masthead-instance-writer.sqlite");
  const database = new DatabaseSync(guardPath, { open: true });
  try {
    try {
      database.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;");
      database.exec("ROLLBACK;");
    } catch (error) {
      if (error instanceof Error && /database is (?:busy|locked)/iu.test(error.message)) return;
      throw error;
    }
  } finally {
    database.close();
  }
  throw new Error("Activated production manifest is not protected by a live daemon writer guard.");
}

async function attestStagedFile(path) {
  const [body, info] = await Promise.all([readFile(path), stat(path)]);
  return { path, sha256: createHash("sha256").update(body).digest("hex"), mode: info.mode & 0o777 };
}

async function readAttestedStagedFile(attestation) {
  const [body, info] = await Promise.all([readFile(attestation.path), stat(attestation.path)]);
  const sha256 = createHash("sha256").update(body).digest("hex");
  if (sha256 !== attestation.sha256 || (info.mode & 0o777) !== attestation.mode) throw new Error(`Staged production file changed: ${attestation.path}`);
  return body;
}

async function assertActiveMatchesStaged(activePath, attestation) {
  const [activeBody, activeInfo, stagedBody] = await Promise.all([readFile(activePath), stat(activePath), readAttestedStagedFile(attestation)]);
  if (!activeBody.equals(stagedBody)) throw new Error(`Active production surface does not match staged attestation: ${activePath}`);
  if ((activeInfo.mode & 0o777) !== attestation.mode) throw new Error(`Active production surface mode does not match staged attestation: ${activePath}`);
}

async function assertActiveMatchesAttestation(activePath, attestation) {
  const [activeBody, activeInfo] = await Promise.all([readFile(activePath), stat(activePath)]);
  if (createHash("sha256").update(activeBody).digest("hex") !== attestation.sha256) {
    throw new Error(`Active production surface does not match staged attestation: ${activePath}`);
  }
  if ((activeInfo.mode & 0o777) !== attestation.mode) throw new Error(`Active production surface mode does not match staged attestation: ${activePath}`);
}

function stagedFileAttestation(receipt, path) {
  const attestation = receipt.stagedFiles.find((file) => file.path === path);
  if (!attestation) throw new Error(`Staged production file is not attested: ${path}`);
  return attestation;
}

function snapshotForReceipt(snapshot) {
  return snapshot?.exists
    ? { exists: true, mode: snapshot.mode, bodyBase64: Buffer.from(snapshot.body).toString("base64"), sha256: createHash("sha256").update(snapshot.body).digest("hex") }
    : { exists: false };
}

function snapshotFromReceipt(snapshot) {
  if (!snapshot || snapshot.exists === false) return { exists: false };
  const body = Buffer.from(required(snapshot.bodyBase64, "snapshot body"), "base64");
  if (createHash("sha256").update(body).digest("hex") !== snapshot.sha256 || !Number.isInteger(snapshot.mode)) throw new Error("Staged production snapshot identity changed.");
  return { exists: true, mode: snapshot.mode, body };
}

function validateStagedReceiptPaths(receipt) {
  const productionRoot = resolve(receipt.productionRoot);
  if (productionRoot !== receipt.productionRoot || dirname(receipt.target) !== productionRoot || !VERSIONED_TARGET.test(basename(receipt.target))) throw new Error("Staged receipt target path is invalid.");
  if (receipt.currentPath !== join(productionRoot, "current")) throw new Error("Staged receipt current path is invalid.");
  if (
    resolve(receipt.dataDirectory) !== receipt.dataDirectory || receipt.dataDirectory !== receipt.instanceDir ||
    resolve(receipt.databasePath) !== receipt.databasePath || dirname(receipt.databasePath) !== receipt.dataDirectory ||
    resolve(receipt.lifecycleLeasePath) !== receipt.lifecycleLeasePath ||
    !Number.isInteger(receipt.port) || receipt.port < 1 || receipt.port > 65535 ||
    typeof receipt.buildVersion !== "string" || !receipt.buildVersion
  ) throw new Error("Staged receipt lifecycle identity is invalid.");
  if (receipt.baseUrl !== `http://127.0.0.1:${receipt.port}`) throw new Error("Staged receipt base URL identity is invalid.");
  if (
    receipt.rollbackBundle?.path !== receipt.previousCurrentTarget ||
    typeof receipt.rollbackBundle.buildSha !== "string" || !receipt.rollbackBundle.buildSha ||
    typeof receipt.rollbackBundle.version !== "string" || !receipt.rollbackBundle.version ||
    !/^[0-9a-f]{64}$/u.test(receipt.rollbackBundle.bundleDigest)
  ) throw new Error("Staged receipt rollback bundle identity is invalid.");
  if (receipt.activatedAt !== undefined && !Number.isFinite(Date.parse(receipt.activatedAt))) throw new Error("Staged receipt activation timestamp is invalid.");
  if (resolve(receipt.instanceDir) !== receipt.instanceDir) throw new Error("Staged receipt instance directory is invalid.");
  if (
    !isAbsolute(receipt.stagedSurface.launcherPath) ||
    !isAbsolute(receipt.stagedSurface.launcherStage) ||
    !isAbsolute(receipt.stagedSurface.desktopPath) ||
    !isAbsolute(receipt.stagedSurface.desktopStage) ||
    dirname(receipt.receiptPath) !== productionRoot ||
    !/^\.masthead-install-[0-9a-f-]+\.receipt\.json$/u.test(basename(receipt.receiptPath)) ||
    dirname(receipt.stagedInstanceLauncherPath) !== productionRoot ||
    basename(receipt.stagedInstanceLauncherPath) !== `.mastheadctl.${receipt.stagingNonce}.staged`
  ) throw new Error("Staged receipt file path substitution.");
  if (dirname(receipt.previousCurrentTarget) !== productionRoot || !VERSIONED_TARGET.test(basename(receipt.previousCurrentTarget))) throw new Error("Staged receipt previous target path substitution.");
  if (receipt.instanceManifestPath !== join(receipt.instanceDir, "masthead-instance.json")) throw new Error("Staged receipt manifest path substitution.");
  const expectedLauncher = join(receipt.instanceDir, "bin", process.platform === "win32" ? "mastheadctl.cmd" : "mastheadctl");
  if (receipt.activeInstanceLauncherPath !== expectedLauncher) throw new Error("Staged receipt launcher path substitution.");
  if (
    basename(receipt.stagedSurface.launcherPath) !== "masthead-production" ||
    dirname(receipt.stagedSurface.launcherStage) !== dirname(receipt.stagedSurface.launcherPath) ||
    !basename(receipt.stagedSurface.launcherStage).startsWith("masthead-production.") ||
    !basename(receipt.stagedSurface.launcherStage).endsWith(".staged") ||
    basename(receipt.stagedSurface.desktopPath) !== "ai.animas.masthead.desktop" ||
    dirname(receipt.stagedSurface.desktopStage) !== dirname(receipt.stagedSurface.desktopPath) ||
    !basename(receipt.stagedSurface.desktopStage).startsWith("ai.animas.masthead.desktop.") ||
    !basename(receipt.stagedSurface.desktopStage).endsWith(".staged")
  ) throw new Error("Staged receipt active surface path substitution.");
  const expectedStages = new Set([receipt.stagedInstanceLauncherPath, receipt.stagedSurface.launcherStage, receipt.stagedSurface.desktopStage]);
  const attestedStages = new Set(Array.isArray(receipt.stagedFiles) ? receipt.stagedFiles.map((file) => file?.path) : []);
  if (
    !Array.isArray(receipt.stagedFiles) ||
    receipt.stagedFiles.length !== expectedStages.size ||
    attestedStages.size !== expectedStages.size ||
    [...expectedStages].some((path) => !attestedStages.has(path)) ||
    receipt.stagedFiles.some((file) => !/^[0-9a-f]{64}$/u.test(file?.sha256) || !Number.isInteger(file?.mode) || file.mode < 0 || file.mode > 0o777)
  ) throw new Error("Staged receipt attestation path substitution.");
}

function productionInstanceLauncher(input) {
  if (process.platform === "win32") {
    return `@echo off\r\n@setlocal DisableDelayedExpansion\r\n@set "MASTHEAD_INSTANCE_MANIFEST=${input.instanceManifestPath.replace(/%/gu, "%%")}"\r\n"${input.node.replace(/%/gu, "%%")}" "${input.cliEntry.replace(/%/gu, "%%")}" %*\r\n`;
  }
  return `#!/bin/sh\nexec env MASTHEAD_INSTANCE_MANIFEST=${shellQuote(input.instanceManifestPath)} ${shellQuote(input.node)} ${shellQuote(input.cliEntry)} "$@"\n`;
}

async function cleanupActivationBundles(productionRoot, retainedTargets) {
  const retainedNames = new Set([...retainedTargets].map((target) => basename(target)));
  for (const entry of await readdir(productionRoot, { withFileTypes: true })) {
    if (!VERSIONED_TARGET.test(entry.name) || retainedNames.has(entry.name)) continue;
    await rm(join(productionRoot, entry.name), { force: true, recursive: true });
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
  const userDataArgument = `--user-data-dir=${resolve(config.dataDirectory)}`;
  const exactElectronMainArgs =
    (args.length === 2 && resolve(args[0] || "") === runtime.executable && args[1] === userDataArgument) ||
    (args.length === 1 && args[0] === `${runtime.executable} ${userDataArgument}`);
  if (
    resolve(executableIdentity) === runtime.executable &&
    exactElectronMainArgs
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
    await gatePendingProductionLifecycle(config.productionRoot, "start");
    let interruptedStart;
    const pending = await dependencies.readMaintenanceJournal();
    await cleanupSafeStageOrphans(config.productionRoot, [config.target, ...bundlePathsFromMaintenanceJournal(pending)]);
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
    await gatePendingProductionLifecycle(config.productionRoot, "stop");
    const pending = await dependencies.readMaintenanceJournal();
    await cleanupSafeStageOrphans(config.productionRoot, [config.target, ...bundlePathsFromMaintenanceJournal(pending)]);
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

export async function runCli(argv = process.argv.slice(2), environment = process.env, dependencyOverrides = {}) {
  const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "start";
  if (command === "stage") {
    const bundlePath = option(argv, "--bundle");
    if (!bundlePath) throw new Error("stage requires --bundle <candidate-path>.");
    return stageProductionInstallation({
      sourceBundlePath: bundlePath,
      bundleDigest: option(argv, "--bundle-digest"),
      dataDirectory: option(argv, "--data-dir"),
      databasePath: option(argv, "--db-path"),
      homeDir: environment.HOME,
      port: numberOption(argv, "--port"),
      productionRoot: option(argv, "--production-root")
    });
  }
  if (command === "activate" || command === "finalize") {
    const receiptPath = option(argv, "--receipt");
    if (!receiptPath) throw new Error(`${command} requires --receipt <path>.`);
    return command === "activate"
      ? activateStagedProductionInstallation(receiptPath, dependencyOverrides)
      : finalizeStagedProductionInstallation(receiptPath, dependencyOverrides);
  }
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
  throw new Error(`Unknown production lifecycle command: ${command}. Expected stage, activate, finalize, install, start, stop, or status.`);
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
  const lifecycleLeasePath = resolve(input.lifecycleLeasePath || join(homeDir, ".local", "state", "masthead-production", "launcher.lease.sqlite"));
  const launcherPath = join(homeDir, ".local", "bin", "masthead-production");
  const desktopPath = join(homeDir, ".local", "share", "applications", "ai.animas.masthead.desktop");
  await Promise.all([mkdir(dirname(launcherPath), { recursive: true }), mkdir(dirname(desktopPath), { recursive: true })]);
  const wrapper = productionWrapper({
    bundleDigest: bundleManifest.bundleDigest, dataDirectory, databasePath, gitSha: release.gitSha,
    lifecycleLeasePath,
    port: validPort(input.port ?? DEFAULT_PORT), productionRoot, target, version: release.version
  });
  const desktop = productionDesktopEntry(launcherPath, target);
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

async function activateStagedLaunchers(staged, runDesktopDatabaseCommand) {
  await rename(staged.launcherStage, staged.launcherPath);
  await rename(staged.desktopStage, staged.desktopPath);
  refreshDesktopDatabase(dirname(staged.desktopPath), runDesktopDatabaseCommand);
}

function productionDesktopEntry(launcherPath, target) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Masthead",
    `Exec=${launcherPath}`,
    `Icon=${join(target, "resources", "masthead-logo-sail.png")}`,
    "Terminal=false",
    "Categories=Development;",
    "StartupWMClass=masthead",
    ""
  ].join("\n");
}

function refreshDesktopDatabase(applicationDirectory, runCommand = spawnSync) {
  try {
    runCommand("update-desktop-database", [applicationDirectory], { stdio: "ignore" });
  } catch {
    // Desktop cache refresh is best-effort, matching the development launcher.
  }
}

async function restoreStagedLaunchers(staged) {
  if (staged?.activeInstanceLauncherPath && staged?.previousInstanceLauncher) {
    await restoreSnapshot(staged.activeInstanceLauncherPath, staged.previousInstanceLauncher);
  }
  if (staged?.stagedSurface) staged = staged.stagedSurface;
  await restoreSnapshot(staged.launcherPath, staged.previousLauncher);
  await restoreSnapshot(staged.desktopPath, staged.previousDesktop);
}

async function discardStagedLaunchers(staged) {
  const stagedInstanceLauncherPath = staged?.stagedInstanceLauncherPath;
  if (staged?.stagedSurface) staged = staged.stagedSurface;
  const paths = [staged.launcherStage, staged.desktopStage].filter((path) => typeof path === "string");
  if (typeof stagedInstanceLauncherPath === "string") paths.push(stagedInstanceLauncherPath);
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

async function assertSnapshotUnchanged(path, expected) {
  const actual = await snapshotFile(path);
  if (actual.exists !== expected.exists) throw new Error(`Active production surface changed after staging: ${path}`);
  if (!actual.exists) return;
  const actualHash = createHash("sha256").update(actual.body).digest("hex");
  const expectedHash = createHash("sha256").update(expected.body).digest("hex");
  if (actualHash !== expectedHash || actual.mode !== expected.mode) throw new Error(`Active production surface changed after staging: ${path}`);
}

async function assertSnapshotBeforeOrAfter(path, before, afterBody) {
  const actual = await snapshotFile(path);
  const actualHash = actual.exists ? createHash("sha256").update(actual.body).digest("hex") : undefined;
  const beforeHash = before.exists ? createHash("sha256").update(before.body).digest("hex") : undefined;
  const afterHash = createHash("sha256").update(afterBody).digest("hex");
  if ((actual.exists === before.exists && actualHash === beforeHash) || (actual.exists && actualHash === afterHash)) return;
  throw new Error(`Interrupted production activation surface is not recoverable: ${path}`);
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

async function cleanupProductionInstallArtifacts(productionRoot, target, remove = (path, options) => rm(path, options)) {
  const retainedName = basename(target);
  const entries = await readdir(productionRoot, { withFileTypes: true });
  for (const entry of entries) {
    const staleBundle = VERSIONED_TARGET.test(entry.name) && entry.name !== retainedName;
    const staleInstallArtifact = /^(?:previous|backup-)/u.test(entry.name) || entry.name === "app-menu-icons" || /^helper(?:-|$)/u.test(entry.name);
    if (!staleBundle && !staleInstallArtifact) continue;
    await remove(join(productionRoot, entry.name), { force: true, recursive: true }, `artifact-${entry.name}`);
  }
}

function bundlePathsFromMaintenanceJournal(journal) {
  return [journal?.oldBundle?.target, journal?.newBundle?.target, journal?.legacyTarget?.path]
    .filter((path) => typeof path === "string" && path);
}

async function cleanupSafeStageOrphans(productionRoot, protectedPaths = [], homeDir) {
  const entries = await readdir(productionRoot, { withFileTypes: true });
  const retained = new Set(protectedPaths.filter((path) => typeof path === "string" && path).map((path) => resolve(path)));
  for (const entry of entries) {
    if (!entry.name.endsWith(".receipt.json")) continue;
    try {
      const receipt = JSON.parse(await readFile(join(productionRoot, entry.name), "utf8"));
      for (const path of [receipt.target, receipt.previousCurrentTarget, receipt.rollbackBundle?.path, receipt.stagedInstanceLauncherPath, receipt.stagedSurface?.launcherStage, receipt.stagedSurface?.desktopStage]) {
        if (typeof path === "string") retained.add(resolve(path));
      }
    } catch {
      // Preserve malformed receipts and their unknown dependencies for explicit recovery.
    }
  }
  const current = await realpath(join(productionRoot, "current")).catch(() => undefined);
  for (const entry of entries) {
    const path = join(productionRoot, entry.name);
    const unreferencedStage = entry.name.endsWith(".staged") && !retained.has(resolve(path));
    const unreferencedBundle = VERSIONED_TARGET.test(entry.name) && path !== current && !retained.has(resolve(path));
    if (unreferencedStage || unreferencedBundle) await rm(path, { force: true, recursive: true });
  }
  if (!homeDir) return;
  for (const [directory, pattern] of [
    [join(homeDir, ".local", "bin"), /^masthead-production\..+\.staged$/u],
    [join(homeDir, ".local", "share", "applications"), /^ai\.animas\.masthead\.desktop\..+\.staged$/u]
  ]) {
    const stagedEntries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error && typeof error === "object" && error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of stagedEntries) {
      const path = join(directory, entry.name);
      if (entry.isFile() && pattern.test(entry.name) && !retained.has(resolve(path))) await rm(path, { force: true });
    }
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
    readProcesses: () => readProcesses(config),
    readMaintenanceJournal: () => readTransitionJournal(config.databasePath),
    recoverStartSurface: async (request) => {
      await swapCurrentTarget(config.productionRoot, request.oldBundle.target);
      await installProductionLauncherUnlocked({
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
  await assertRequiredProductionRuntimeResources(runtime);
}

async function assertRequiredProductionRuntimeResources(runtime) {
  await Promise.all([
    assertProductionAppIcon(runtime.appIcon),
    access(runtime.executable, constants.X_OK),
    access(runtime.node, constants.X_OK),
    access(runtime.lifecycle, constants.R_OK),
    access(runtime.daemonEntry, constants.R_OK),
    access(runtime.cliEntry, constants.R_OK),
    access(runtime.maintenanceEntry, constants.R_OK)
  ]);
}

async function assertProductionAppIcon(path) {
  let body;
  try {
    body = await readFile(path);
  } catch (error) {
    throw new Error(`Production app icon is missing or unreadable: ${path}`, { cause: error });
  }
  if (!isStructurallyValidPng(body)) {
    throw new Error(`Production app icon is not a valid PNG: ${path}`);
  }
}

function isStructurallyValidPng(body) {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  if (body.length < 45 || !body.subarray(0, signature.length).equals(signature)) return false;

  let offset = signature.length;
  let sawHeader = false;
  let sawImageData = false;
  while (offset + 12 <= body.length) {
    const dataLength = body.readUInt32BE(offset);
    const type = body.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const chunkEnd = dataStart + dataLength + 4;
    if (chunkEnd > body.length) return false;
    if (!sawHeader) {
      if (type !== "IHDR" || dataLength !== 13) return false;
      if (body.readUInt32BE(dataStart) === 0 || body.readUInt32BE(dataStart + 4) === 0) return false;
      sawHeader = true;
    }
    if (type === "IDAT") sawImageData = true;
    if (type === "IEND") return sawHeader && sawImageData && dataLength === 0 && chunkEnd === body.length;
    offset = chunkEnd;
  }
  return false;
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
  await assertColdRuntimeOffline(config, dependencies);
  await dependencies.ownershipProbe();
}

async function assertColdRuntimeOffline(config, dependencies) {
  const processes = await productionRootProcesses(config, dependencies);
  if (processes.length > 0) {
    throw new Error(`Cold activation requires an empty production process set: ${formatProcesses(processes)}.`);
  }
  if (await dependencies.fetchHealth()) throw new Error("Cold activation requires production health to be absent.");
  if (!(await dependencies.portBindable())) throw new Error(`Cold activation requires port ${config.port} to be bindable.`);
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
    appIcon: join(target, "resources", "masthead-logo-sail.png"),
    daemonEntry: join(daemonRoot, "dist", "src", "daemon", "main.js"),
    cliEntry: join(daemonRoot, "dist", "src", "cli", "mastheadctl.js"),
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

async function readProcesses(config) {
  return readProductionProcesses({ scanContext: config });
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
  const readAdapter = adapters.readProcess || ((pid) => readOwnedProcessStrict(pid, {
    scanContext: adapters.scanContext
  }));
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

export async function readOwnedProcessStrict(pid, adapters = {}) {
  const processRoot = join(adapters.processRoot || "/proc", String(pid));
  const currentUid = adapters.currentUid ?? (typeof process.geteuid === "function"
    ? process.geteuid()
    : typeof process.getuid === "function" ? process.getuid() : undefined);
  if (!Number.isSafeInteger(currentUid) || currentUid < 0) {
    throw new Error("Production process scan current effective UID could not be established.");
  }
  const readStatus = adapters.readStatus || (() => readFile(join(processRoot, "status"), "utf8"));
  const statProcess = adapters.stat || (() => stat(processRoot));
  const inspectProcess = adapters.readProcess || ((processPid) => readProcess(processPid, true));
  const useGranularInspection = !adapters.readProcess || Boolean(
    adapters.readExecutable || adapters.readEnvironment || adapters.readStatLine
  );
  const readExecutable = adapters.readExecutable || (() => readlink(join(processRoot, "exe")));
  const readEnvironment = adapters.readEnvironment || (() => readFile(join(processRoot, "environ")));
  const readStatLine = adapters.readStatLine || (() => readFile(join(processRoot, "stat"), "utf8"));
  let status;
  try {
    status = await readStatus();
  } catch (error) {
    if (error && typeof error === "object" && ["ENOENT", "ESRCH"].includes(error.code)) return undefined;
    const ownership = await statProcess().catch((statError) => {
      if (statError && typeof statError === "object" && ["ENOENT", "ESRCH"].includes(statError.code)) return undefined;
      throw error;
    });
    if (!ownership) return undefined;
    if (Number.isSafeInteger(ownership.uid) && ownership.uid !== currentUid) return undefined;
    throw error;
  }
  let processStatus = parseProcStatus(status);
  const effectiveUid = processStatus.effectiveUid;
  if (!Number.isSafeInteger(effectiveUid) || effectiveUid < 0) {
    const ownership = await statProcess().catch((error) => {
      if (error && typeof error === "object" && ["ENOENT", "ESRCH"].includes(error.code)) return undefined;
      throw error;
    });
    if (!ownership) return undefined;
    if (Number.isSafeInteger(ownership.uid) && ownership.uid !== currentUid) return undefined;
    throw new Error(`Production process ${pid} effective UID could not be established.`);
  }
  if (effectiveUid !== currentUid) return undefined;
  if (processStatus.state === "Z") {
    if (processStatus.threads !== 1) {
      const cardinalityStatLine = await readProcValueOrRace(readStatLine);
      if (cardinalityStatLine === undefined) return undefined;
      const cardinalityStat = procStatSnapshot(cardinalityStatLine, pid);
      if (cardinalityStat.pid !== pid || cardinalityStat.state !== "Z") {
        throw new Error(`Production process ${pid} zombie identity changed during scan.`);
      }
      for (let attempt = 0; attempt < 3 && processStatus.threads !== 1; attempt += 1) {
        const retryStatusText = await readProcValueOrRace(readStatus);
        if (retryStatusText === undefined) return undefined;
        const retryStatus = parseProcStatus(retryStatusText);
        const retryStatLine = await readProcValueOrRace(readStatLine);
        if (retryStatLine === undefined) return undefined;
        const retryStat = procStatSnapshot(retryStatLine, pid);
        if (
          retryStatus.state !== "Z" || retryStatus.effectiveUid !== currentUid ||
          retryStat.pid !== pid || retryStat.state !== "Z" ||
          retryStat.starttime !== cardinalityStat.starttime
        ) {
          throw new Error(`Production process ${pid} zombie identity changed during scan.`);
        }
        processStatus = retryStatus;
      }
      if (processStatus.threads !== 1) {
        throw new Error(`Production process ${pid} zombie thread-group cardinality is unproven.`);
      }
    }
    const initialZombieStatLine = await readProcValueOrRace(readStatLine);
    if (initialZombieStatLine === undefined) return undefined;
    const initialZombieStat = procStatSnapshot(initialZombieStatLine, pid);
    const verifiedZombieStatusText = await readProcValueOrRace(readStatus);
    if (verifiedZombieStatusText === undefined) return undefined;
    const verifiedZombieStatus = parseProcStatus(verifiedZombieStatusText);
    const verifiedZombieStatLine = await readProcValueOrRace(readStatLine);
    if (verifiedZombieStatLine === undefined) return undefined;
    const verifiedZombieStat = procStatSnapshot(verifiedZombieStatLine, pid);
    if (
      initialZombieStat.state !== "Z" || verifiedZombieStatus.state !== "Z" ||
      verifiedZombieStatus.effectiveUid !== currentUid || verifiedZombieStatus.threads !== 1 ||
      initialZombieStat.pid !== pid || verifiedZombieStat.pid !== pid || verifiedZombieStat.state !== "Z" ||
      initialZombieStat.starttime !== verifiedZombieStat.starttime
    ) {
      throw new Error(`Production process ${pid} zombie identity changed during scan.`);
    }
    return undefined;
  }
  const readCommandLine = adapters.readCommandLine || (() => readFile(join(processRoot, "cmdline")));
  let commandLine;
  try {
    commandLine = await readCommandLine();
  } catch (error) {
    if (error && typeof error === "object" && ["ENOENT", "ESRCH"].includes(error.code)) return undefined;
    // Unreadable command lines cannot prove irrelevance. Continue through the
    // exact process reader, which preserves fail-closed exe/environ handling.
    return inspectProcess(pid);
  }
  const command = parseProcCommandLine(commandLine);
  const provenUnrelatedCommand = command.valid &&
    !commandCouldBelongToProduction(command.argv, adapters.scanContext);
  if (!useGranularInspection) {
    try {
      return await inspectProcess(pid);
    } catch (error) {
      if (error && typeof error === "object" && ["ENOENT", "ESRCH"].includes(error.code)) return undefined;
      if (
        provenUnrelatedCommand && error && typeof error === "object" &&
        ["EACCES", "EPERM"].includes(error.code)
      ) return undefined;
      throw error;
    }
  }
  const initialStatLine = await readProcValueOrRace(readStatLine);
  if (initialStatLine === undefined) return undefined;
  const initialStarttime = procStatStarttime(initialStatLine, pid);
  let exe;
  try {
    exe = await readExecutable();
  } catch (error) {
    if (error && typeof error === "object" && ["ENOENT", "ESRCH"].includes(error.code)) return undefined;
    if (
      provenUnrelatedCommand && error && typeof error === "object" &&
      ["EACCES", "EPERM"].includes(error.code)
    ) return undefined;
    throw error;
  }
  const verifiedStatLine = await readProcValueOrRace(readStatLine);
  if (verifiedStatLine === undefined) return undefined;
  const verifiedStarttime = procStatStarttime(verifiedStatLine, pid);
  if (initialStarttime !== verifiedStarttime) {
    throw new Error(`Production process ${pid} identity changed during scan.`);
  }
  const verifiedExe = await readProcValueOrRace(readExecutable);
  if (verifiedExe === undefined) return undefined;
  if (exe !== verifiedExe) {
    throw new Error(`Production process ${pid} executable identity changed during scan.`);
  }
  const exactExecutableIsUnrelated = command.valid && adapters.scanContext &&
    typeof adapters.scanContext.productionRoot === "string" &&
    !productionTargetForPath(normalizeProcExecutable(verifiedExe), resolve(adapters.scanContext.productionRoot));
  if (exactExecutableIsUnrelated) return undefined;
  const environment = await readProcValueOrRace(readEnvironment);
  if (environment === undefined) return undefined;
  const finalStatLine = await readProcValueOrRace(readStatLine);
  if (finalStatLine === undefined) return undefined;
  const finalStarttime = procStatStarttime(finalStatLine, pid);
  if (verifiedStarttime !== finalStarttime) {
    throw new Error(`Production process ${pid} identity changed during scan.`);
  }
  const finalExe = await readProcValueOrRace(readExecutable);
  if (finalExe === undefined) return undefined;
  if (verifiedExe !== finalExe) {
    throw new Error(`Production process ${pid} executable identity changed during scan.`);
  }
  const finalCommandLine = await readProcValueOrRace(readCommandLine);
  if (finalCommandLine === undefined) return undefined;
  if (!Buffer.from(commandLine).equals(Buffer.from(finalCommandLine))) {
    throw new Error(`Production process ${pid} command line changed during scan.`);
  }
  return {
    argv: command.argv,
    environ: Object.fromEntries(nulFields(environment).flatMap((entry) => {
      const separator = entry.indexOf("=");
      return separator > 0 ? [[entry.slice(0, separator), entry.slice(separator + 1)]] : [];
    })),
    exe: finalExe,
    pid,
    starttime: finalStarttime
  };
}

function parseProcCommandLine(commandLine) {
  const bytes = Buffer.isBuffer(commandLine) ? commandLine : Buffer.from(commandLine || "");
  if (bytes.length === 0 || bytes.at(-1) !== 0) return { argv: [], valid: false };
  const argv = nulFields(bytes);
  if (argv.length === 0 || argv.some((argument) => argument.includes("\u0000"))) return { argv: [], valid: false };
  return { argv, valid: true };
}

function parseProcStatus(status) {
  const text = String(status);
  const uidMatch = text.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/mu);
  const stateMatch = text.match(/^State:\s+([A-Z])(?:\s|$)/mu);
  const threadsMatch = text.match(/^Threads:\s+(\d+)\s*$/mu);
  return {
    effectiveUid: uidMatch ? Number(uidMatch[2]) : undefined,
    state: stateMatch?.[1],
    threads: threadsMatch ? Number(threadsMatch[1]) : undefined
  };
}

function commandCouldBelongToProduction(argv, scanContext) {
  if (!scanContext) return true;
  const identifiers = [
    scanContext.productionRoot,
    scanContext.target,
    scanContext.dataDirectory,
    scanContext.databasePath
  ].filter((value) => typeof value === "string" && value.length > 0).map((value) => resolve(value));
  if (identifiers.length < 4) return true;
  return argv.some((argument) => identifiers.some((identifier) =>
    argument === identifier || argument.includes(`${identifier}/`) || argument.includes(`${identifier}\\`) ||
    argument.includes(`=${identifier}`) || argument.includes(`\"${identifier}`)
  ));
}

function procStatStarttime(statLine, pid) {
  const snapshot = procStatSnapshot(statLine, pid);
  if (snapshot.pid !== pid) throw new Error(`Production process ${pid} stat PID is mismatched.`);
  return snapshot.starttime;
}

function procStatSnapshot(statLine, pid) {
  const text = String(statLine);
  const closingParenthesis = text.lastIndexOf(")");
  const parsedPid = closingParenthesis >= 0 ? Number(text.slice(0, text.indexOf(" "))) : undefined;
  const values = closingParenthesis >= 0
    ? text.slice(closingParenthesis + 2).trim().split(/\s+/u)
    : [];
  const state = values[0];
  const starttime = values[19];
  if (!Number.isSafeInteger(parsedPid) || parsedPid <= 0 || !state || !starttime) {
    throw new Error(`Production process ${pid} stat identity is malformed.`);
  }
  return { pid: parsedPid, state, starttime };
}

async function readProcValueOrRace(reader) {
  try {
    return await reader();
  } catch (error) {
    if (error && typeof error === "object" && ["ENOENT", "ESRCH"].includes(error.code)) return undefined;
    throw error;
  }
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
    return {
      argv: nulFields(commandLine),
      environ: Object.fromEntries(nulFields(environment).flatMap((entry) => {
        const separator = entry.indexOf("=");
        return separator > 0 ? [[entry.slice(0, separator), entry.slice(separator + 1)]] : [];
      })),
      exe,
      pid,
      starttime: procStatStarttime(statLine, pid)
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

export async function captureMaintenanceSentinel(config, childIdentity, adapters = {}) {
  if (
    !Number.isSafeInteger(childIdentity?.pid) || childIdentity.pid <= 0 ||
    typeof childIdentity.starttime !== "string" || !childIdentity.starttime
  ) {
    throw new Error("Maintenance sentinel capture requires an exact child PID/start identity.");
  }
  const path = join(resolve(config.dataDirectory), "runtime", "database.lock");
  const snapshot = await readMaintenanceSentinelSnapshot(path, adapters);
  if (!snapshot.exists) return { ...snapshot, childStarttime: childIdentity.starttime, pid: childIdentity.pid };
  if (snapshot.pid !== childIdentity.pid) {
    throw new Error("Maintenance compatibility sentinel is not owned by the exact child PID.");
  }
  return { ...snapshot, childStarttime: childIdentity.starttime };
}

export async function clearExactMaintenanceSentinel(config, childIdentity, evidence, adapters = {}) {
  const expectedPath = join(resolve(config.dataDirectory), "runtime", "database.lock");
  if (
    !evidence || evidence.path !== expectedPath || evidence.childStarttime !== childIdentity?.starttime ||
    evidence.pid !== childIdentity?.pid
  ) {
    throw new Error("Timed-out maintenance sentinel evidence does not match the exact child identity.");
  }
  const acquireLeases = adapters.acquireLeases || (() => acquireMaintenanceCleanupLeases(config));
  const assertRuntimeOffline = adapters.assertRuntimeOffline || (async () => {
    const dependencies = defaultDependencies(config);
    await assertColdRuntimeOffline(config, dependencies);
  });
  const assertFullyOffline = adapters.assertFullyOffline || (() => assertColdProductionOffline(config));
  const statProcess = adapters.statProcess || ((pid) => stat(join("/proc", String(pid))));
  const remove = adapters.remove || ((path) => rm(path));
  const leases = await acquireLeases();
  try {
    await assertMaintenancePidAbsent(childIdentity.pid, statProcess);
    await assertRuntimeOffline();
    const current = await readMaintenanceSentinelSnapshot(expectedPath, adapters);
    if (!evidence.exists) {
      if (current.exists) throw new Error("Maintenance sentinel appeared after an absent live-child capture.");
    } else if (current.exists) {
      if (!sameMaintenanceSentinelEvidence(current, evidence)) {
        throw new Error("Maintenance sentinel identity changed after exact child exit; cleanup refused.");
      }
      await quarantineAndRemoveExactMaintenanceSentinel(expectedPath, evidence, { ...adapters, remove });
      const afterRemoval = await readMaintenanceSentinelSnapshot(expectedPath, adapters);
      if (afterRemoval.exists) {
        throw new Error("Maintenance sentinel replacement appeared during exact cleanup.");
      }
    }
    await assertRuntimeOffline();
  } finally {
    await leases.release();
  }
  await assertFullyOffline();
}

async function readMaintenanceSentinelSnapshot(path, adapters = {}) {
  const lstatAdapter = adapters.lstat || ((value) => lstat(value, { bigint: true }));
  const openAdapter = adapters.open || ((value, flags) => open(value, flags));
  const currentUid = adapters.currentUid ?? (typeof process.geteuid === "function"
    ? process.geteuid()
    : typeof process.getuid === "function" ? process.getuid() : undefined);
  if (!Number.isSafeInteger(currentUid) || currentUid < 0) {
    throw new Error("Maintenance sentinel cleanup current effective UID is unavailable.");
  }
  let before;
  try {
    before = await lstatAdapter(path);
  } catch (error) {
    if (errnoIs(error, "ENOENT")) return { exists: false, path };
    throw error;
  }
  if (
    !before.isFile() || before.isSymbolicLink() || String(before.nlink) !== "1" ||
    String(before.uid) !== String(currentUid)
  ) {
    throw new Error("Maintenance compatibility sentinel path identity is unsafe.");
  }
  let handle;
  let body;
  let beforeIdentity;
  try {
    handle = await openAdapter(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const descriptorBefore = await handle.stat({ bigint: true });
    beforeIdentity = maintenanceFileIdentity(descriptorBefore);
    if (JSON.stringify(maintenanceFileIdentity(before)) !== JSON.stringify(beforeIdentity)) {
      throw new Error("Maintenance compatibility sentinel pathname is not bound to its opened inode.");
    }
    body = await handle.readFile({ encoding: "utf8" });
    const descriptorAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstatAdapter(path);
    if (
      !descriptorAfter.isFile() || descriptorAfter.isSymbolicLink() || String(descriptorAfter.nlink) !== "1" ||
      !pathAfter.isFile() || pathAfter.isSymbolicLink() || String(pathAfter.nlink) !== "1" ||
      JSON.stringify(beforeIdentity) !== JSON.stringify(maintenanceFileIdentity(descriptorAfter)) ||
      JSON.stringify(beforeIdentity) !== JSON.stringify(maintenanceFileIdentity(pathAfter)) ||
      String(Buffer.byteLength(body)) !== beforeIdentity.size
    ) {
      throw new Error("Maintenance compatibility sentinel changed during exact fd-bound capture.");
    }
  } finally {
    await handle?.close();
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Maintenance compatibility sentinel content is invalid.");
  }
  if (
    !Number.isSafeInteger(parsed?.pid) || parsed.pid <= 0 ||
    parsed.protocol !== "canonical-data-directory-lock-v4" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(parsed.token || "") ||
    typeof parsed.createdAt !== "string" || Number.isNaN(Date.parse(parsed.createdAt))
  ) {
    throw new Error("Maintenance compatibility sentinel ownership content is invalid.");
  }
  return {
    ...beforeIdentity,
    body,
    createdAt: parsed.createdAt,
    exists: true,
    path,
    pid: parsed.pid,
    protocol: parsed.protocol,
    token: parsed.token
  };
}

async function assertMaintenancePidAbsent(pid, statProcess) {
  try {
    await statProcess(pid);
  } catch (error) {
    if (errnoIs(error, "ENOENT") || errnoIs(error, "ESRCH")) return;
    throw error;
  }
  throw new Error("Timed-out maintenance PID is present; stale sentinel cleanup refused.");
}

async function quarantineAndRemoveExactMaintenanceSentinel(path, evidence, adapters = {}) {
  const renameAdapter = adapters.rename || rename;
  const linkAdapter = adapters.link || link;
  const remove = adapters.remove || ((value) => rm(value));
  const quarantinePath = join(dirname(path), `.database.lock.maintenance-cleanup-${randomUUID()}`);
  try {
    await lstat(quarantinePath);
    throw new Error("Maintenance sentinel cleanup quarantine path already exists.");
  } catch (error) {
    if (!errnoIs(error, "ENOENT")) throw error;
  }
  try {
    await renameAdapter(path, quarantinePath);
  } catch (error) {
    if (errnoIs(error, "ENOENT")) return;
    throw error;
  }
  const moved = await readMaintenanceSentinelSnapshot(quarantinePath, adapters);
  if (moved.exists && sameMaintenanceSentinelEvidence(moved, evidence, true)) {
    await remove(quarantinePath);
    return;
  }
  try {
    await linkAdapter(quarantinePath, path);
    await remove(quarantinePath);
  } catch (error) {
    if (errnoIs(error, "EEXIST")) {
      throw new Error(
        `Maintenance sentinel replacement was preserved at ${quarantinePath}; a new canonical sentinel also exists.`,
        { cause: error }
      );
    }
    throw error;
  }
  throw new Error("Maintenance sentinel identity changed at atomic quarantine; replacement restored and cleanup refused.");
}

function maintenanceFileIdentity(info) {
  return {
    device: String(info.dev),
    inode: String(info.ino),
    mode: String(info.mode),
    nlink: String(info.nlink),
    size: String(info.size),
    uid: String(info.uid)
  };
}

function sameMaintenanceSentinelEvidence(left, right, ignorePath = false) {
  return [
    "body", "createdAt", "device", "inode", "mode", "nlink", "path", "pid", "protocol", "size", "token", "uid"
  ].every((field) => (ignorePath && field === "path") || left[field] === right[field]);
}

async function acquireMaintenanceCleanupLeases(config) {
  const canonicalDataDirectory = await realpath(config.dataDirectory);
  const canonicalDatabasePath = await realpath(config.databasePath);
  if (dirname(canonicalDatabasePath) !== canonicalDataDirectory) {
    throw new Error("Maintenance sentinel cleanup database is outside its canonical data directory.");
  }
  const runtimeDirectory = await realpath(join(canonicalDataDirectory, "runtime"));
  if (dirname(runtimeDirectory) !== canonicalDataDirectory) {
    throw new Error("Maintenance sentinel cleanup runtime directory identity is invalid.");
  }
  const databaseLease = acquireCleanupSqliteLease(`${canonicalDatabasePath}.lease.sqlite`);
  let runtimeLease;
  try {
    runtimeLease = acquireCleanupSqliteLease(join(runtimeDirectory, "database.lease.sqlite"));
  } catch (error) {
    await databaseLease.release();
    throw error;
  }
  return {
    release: async () => {
      try {
        await runtimeLease.release();
      } finally {
        await databaseLease.release();
      }
    }
  };
}

function acquireCleanupSqliteLease(path) {
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;");
  } catch (error) {
    database.close();
    throw new Error(`Maintenance sentinel cleanup could not acquire exclusive lease ${path}.`, { cause: error });
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

function errnoIs(error, code) {
  return Boolean(error && typeof error === "object" && error.code === code);
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
  const identityReader = async (pid) => {
    const record = await readProcess(pid, true);
    return record ? { pid, starttime: record.starttime } : undefined;
  };
  const timeoutRecovery = action === "complete" ? undefined : {
    capture: (childIdentity) => captureMaintenanceSentinel(config, childIdentity),
    cleanup: (childIdentity, evidence) => clearExactMaintenanceSentinel(config, childIdentity, evidence)
  };
  return waitForMaintenanceChild(
    child,
    action,
    PRODUCTION_MAINTENANCE_TIMEOUT_MS,
    PRODUCTION_MAINTENANCE_EXIT_GRACE_MS,
    identity,
    identityReader,
    timeoutRecovery
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
  },
  timeoutRecovery
) {
  const observedIdentityPromise = Promise.resolve(identityPromise).then(
    (value) => ({ value }),
    (error) => ({ error })
  );
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let timedOut = false;
    let timeoutEvidence;
    let timeoutRecoveryError;
    let timeoutPreparation;
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
    const handleTimeout = async () => {
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
        if (timeoutRecovery) {
          timeoutRecoveryError = new Error("maintenance child exited before sentinel capture could be bound to its live PID identity");
        }
        scheduleExitGrace(graceMessage);
        return;
      }
      if (current.pid !== captured.pid || current.starttime !== captured.starttime) {
        settled = true;
        reject(maintenanceChildExitUnproven("Production maintenance child PID/start identity changed before SIGTERM; no signal was sent."));
        return;
      }
      if (timeoutRecovery?.capture) {
        try {
          timeoutEvidence = await promiseWithTimeout(
            timeoutRecovery.capture(captured),
            Math.min(5_000, exitGraceMs),
            "maintenance sentinel capture exceeded its bounded deadline"
          );
        } catch (error) {
          timeoutRecoveryError = error;
        }
      }
      if (timeoutRecovery) {
        let postCaptureIdentity;
        try {
          postCaptureIdentity = await promiseWithTimeout(
            identityReader(child.pid),
            Math.min(5_000, exitGraceMs),
            "maintenance child post-capture identity revalidation exceeded its bounded deadline"
          );
        } catch (error) {
          settled = true;
          reject(maintenanceChildExitUnproven(
            `Production maintenance child post-capture identity revalidation failed: ${error instanceof Error ? error.message : String(error)}; no signal was sent.`
          ));
          return;
        }
        if (exitObserved || !postCaptureIdentity) {
          timeoutRecoveryError = new Error("maintenance child exited before sentinel capture could be revalidated against its live PID identity");
          scheduleExitGrace(graceMessage);
          return;
        }
        if (postCaptureIdentity.pid !== captured.pid || postCaptureIdentity.starttime !== captured.starttime) {
          settled = true;
          reject(maintenanceChildExitUnproven("Production maintenance child PID/start identity changed after sentinel capture; no signal was sent."));
          return;
        }
      }
      child.kill("SIGTERM");
      scheduleExitGrace(`${graceMessage} SIGTERM was sent to the exact child identity.`);
    };
    const timer = setTimeout(() => {
      timeoutPreparation = handleTimeout().catch((error) => {
        timeoutRecoveryError = error;
        if (settled) return;
        settled = true;
        reject(maintenanceChildExitUnproven(
          `Production maintenance child timeout handling failed: ${error instanceof Error ? error.message : String(error)}.`
        ));
      });
    }, timeoutMs);
    child.once("exit", () => { exitObserved = true; });
    child.once("error", (error) => {
      if (settled) return;
      childError = error;
      scheduleExitGrace(`Production maintenance child emitted an error but exact exit was not proven within ${exitGraceMs}ms.`);
    });
    child.once("close", async (code, signal) => {
      if (timeoutPreparation) await timeoutPreparation;
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
        if (timeoutRecovery) {
          if (timeoutRecoveryError) {
            reject(new Error(
              `Production maintenance child exceeded ${timeoutMs}ms and exited after SIGTERM; exact stale sentinel capture failed: ${timeoutRecoveryError instanceof Error ? timeoutRecoveryError.message : String(timeoutRecoveryError)}.`
            ));
            return;
          }
          try {
            await timeoutRecovery.cleanup(identity, timeoutEvidence);
          } catch (error) {
            reject(new Error(
              `Production maintenance child exceeded ${timeoutMs}ms and exited after SIGTERM; exact stale sentinel cleanup failed: ${error instanceof Error ? error.message : String(error)}.`
            ));
            return;
          }
        }
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
  const modulePath = join(config.target, "resources", "daemon", "dist", "src", "core", "daemonOwnership.js");
  const module = await import(pathToFileURL(modulePath).href);
  if (typeof module.probeExclusiveDatabaseStartupOwnership !== "function") {
    throw new Error(`Packaged ownership probe is unavailable at ${modulePath}.`);
  }
  await module.probeExclusiveDatabaseStartupOwnership(config.databasePath, config.dataDirectory);
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
  let handle;
  try {
    handle = await open(temporaryPath, "wx", mode);
    await handle.writeFile(body, typeof body === "string" ? "utf8" : undefined);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporaryPath, mode);
    await rename(temporaryPath, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await handle?.close().catch(() => undefined);
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

async function verifyStagedCandidateIdentity(receipt) {
  await verifyPinnedBundle(receipt.target, receipt.sourceDigest);
  const release = await readRelease(receipt.target);
  if (release.gitSha !== receipt.buildSha || release.version !== receipt.buildVersion) {
    throw new Error("Staged production candidate release identity changed after staging.");
  }
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
