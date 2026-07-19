#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePackagedBundleLayout, verifyPackagedBundleManifest } from "./packaged-bundle-manifest.js";
import {
  activateStagedProductionInstallation,
  finalizeStagedProductionInstallation,
  loadStagedProductionInstallation,
  stageProductionInstallation,
  stopProduction
} from "./masthead-production.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

export async function validateRehearsalBundle(argv, environment = process.env) {
  const bundleIndex = argv.indexOf("--bundle");
  if (bundleIndex < 0 || !argv[bundleIndex + 1]) throw new Error("Production activation rehearsal requires --bundle <absolute-path>.");
  if (argv.length !== 2 || bundleIndex !== 0) throw new Error("Production activation rehearsal accepts only --bundle <absolute-path>.");
  const requested = argv[bundleIndex + 1];
  if (!isAbsolute(requested)) throw new Error("Production activation rehearsal bundle path must be absolute.");
  const info = await lstat(requested).catch((error) => {
    throw new Error(`Production activation rehearsal bundle does not exist: ${requested}`, { cause: error });
  });
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Production activation rehearsal bundle must be a real directory, not a link.");
  const bundle = await realpath(requested);
  if (bundle !== resolve(requested)) throw new Error("Production activation rehearsal bundle path must be canonical.");
  const liveHome = resolve(environment.HOME || homedir());
  const livePaths = [
    join(liveHome, ".local", "share", "masthead-production"),
    join(liveHome, ".config", "masthead-production"),
    join(liveHome, ".config", "masthead-production", "masthead.sqlite"),
    join(liveHome, ".config", "masthead-production", "masthead-instance.json")
  ];
  if (livePaths.some((path) => within(path, bundle))) throw new Error("Production activation rehearsal refuses a bundle inside live production state.");
  const layout = await resolvePackagedBundleLayout(bundle, process.platform);
  const manifest = await verifyPackagedBundleManifest(layout);
  return { bundle, layout, manifest, livePaths };
}

export async function runProductionActivationRehearsal(argv = process.argv.slice(2), environment = process.env) {
  const verified = await validateRehearsalBundle(argv, environment);
  const rehearsalRoot = await mkdtemp(join(tmpdir(), "masthead-production-activation-rehearsal-"));
  const homeDir = join(rehearsalRoot, "home");
  const productionRoot = join(rehearsalRoot, "production");
  const dataDirectory = join(rehearsalRoot, "data");
  const databasePath = join(dataDirectory, "masthead.sqlite");
  const lifecycleLeasePath = join(homeDir, ".local", "state", "masthead-production", "launcher.lease.sqlite");
  const isolatedPaths = [homeDir, productionRoot, dataDirectory, databasePath, join(dataDirectory, "masthead-instance.json"), lifecycleLeasePath];
  if (isolatedPaths.some((path) => !within(rehearsalRoot, path) || verified.livePaths.some((live) => within(live, path)))) {
    throw new Error("Production activation rehearsal isolation path validation failed.");
  }
  let daemon;
  let receipt;
  let port;
  let completed = false;
  try {
    await Promise.all([mkdir(homeDir, { recursive: true }), mkdir(productionRoot, { recursive: true }), mkdir(dataDirectory, { recursive: true })]);
    port = await reserveDynamicPort();
    const baseline = join(productionRoot, "Masthead-linux-x64-rehearsal-baseline");
    await cp(verified.bundle, baseline, { recursive: true });
    await verifyPackagedBundleManifest(await resolvePackagedBundleLayout(baseline, process.platform));
    await symlink(baseline, join(productionRoot, "current"));
    const release = verified.manifest.release;
    const baselineConfig = {
      bundleDigest: verified.manifest.bundleDigest,
      dataDirectory,
      databasePath,
      gitSha: release.gitSha,
      lifecycleLeasePath,
      port,
      productionRoot,
      target: baseline,
      version: release.version
    };
    const stopped = await stopProduction(baselineConfig, { readProcesses: async () => [] });
    if (stopped.stopped !== true || stopped.stoppedPids.length !== 0) throw new Error("Isolated stop proof failed before staging.");
    receipt = await stageProductionInstallation({
      bundleDigest: verified.manifest.bundleDigest,
      dataDirectory,
      databasePath,
      homeDir,
      lifecycleLeasePath,
      port,
      productionRoot,
      sourceBundlePath: verified.bundle
    });
    if (receipt.launched || receipt.databaseOpened || await realpath(receipt.currentPath) !== baseline) throw new Error("Operational stage proof mutated runtime state.");
    await crashAndRecoverActivation(receipt.receiptPath, environment, homeDir);
    receipt = await loadStagedProductionInstallation(receipt.receiptPath);
    daemon = spawnPackagedDaemon(receipt, environment, homeDir);
    await waitForHealth(receipt.baseUrl, daemon);
    const finalized = await finalizeStagedProductionInstallation(receipt.receiptPath);
    if (!finalized.finalized) throw new Error("Operational finalization did not commit.");
    const installEntries = (await readdir(productionRoot)).sort();
    if (installEntries.length !== 2 || !installEntries.includes("current") || !installEntries.includes(basename(receipt.target))) {
      throw new Error(`Operational finalization left unexpected install artifacts: ${installEntries.join(", ")}`);
    }
    await stopChild(daemon);
    daemon = undefined;
    runCrashRaceMatrix(environment);
    completed = true;
    return { ok: true, bundle: verified.bundle, isolated: true, matrix: true };
  } finally {
    let stopFailure;
    if (daemon) {
      try {
        await stopChild(daemon);
      } catch (error) {
        stopFailure = error;
      }
    }
    if (daemon && (stopFailure || daemon.exitCode === null && daemon.signalCode === null)) {
      throw new Error(`Rehearsal cleanup could not prove isolated daemon exit; preserved ${rehearsalRoot}`, { cause: stopFailure });
    }
    await rm(rehearsalRoot, { force: true, recursive: true });
  }
}

async function crashAndRecoverActivation(receiptPath, environment, homeDir) {
  const moduleUrl = new URL("./masthead-production.js", import.meta.url).href;
  const source = [
    `import { activateStagedProductionInstallation } from ${JSON.stringify(moduleUrl)};`,
    "for (let attempt = 0; attempt < 5; attempt += 1) {",
    "  try { await activateStagedProductionInstallation(process.argv[1], { onStep(step) { if (step === 'instance-launcher') process.kill(process.pid, 'SIGKILL'); } }); break; }",
    "  catch (error) { if (attempt === 4 || !/changed during scan|disappeared during scan/.test(String(error?.message))) throw error; }",
    "}"
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", source, receiptPath], { env: isolatedEnvironment(environment, homeDir), stdio: "inherit" });
  const [code, signal] = await once(child, "close");
  if (code !== null || signal !== "SIGKILL") throw new Error("Operational activation crash fixture did not die by SIGKILL.");
  await retryTransientProcessScan(() => activateStagedProductionInstallation(receiptPath));
}

async function retryTransientProcessScan(operation) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === 4 || !/changed during scan|disappeared during scan/u.test(String(error?.message))) throw error;
    }
  }
}

function spawnPackagedDaemon(receipt, environment, homeDir) {
  const daemonRoot = join(receipt.target, "resources", "daemon");
  const node = join(daemonRoot, process.platform === "win32" ? "node.exe" : "node");
  const entry = join(daemonRoot, "dist", "src", "daemon", "main.js");
  const child = spawn(node, [entry], {
    cwd: receipt.dataDirectory,
    env: {
      ...isolatedEnvironment(environment, homeDir),
      MASTHEAD_ALLOWED_ORIGINS: receipt.baseUrl,
      MASTHEAD_BUILD_SHA: receipt.buildSha,
      MASTHEAD_BUILD_VERSION: receipt.buildVersion,
      MASTHEAD_CLI_COMMAND: receipt.activeInstanceLauncherPath,
      MASTHEAD_DATA_DIR: receipt.dataDirectory,
      MASTHEAD_DB_PATH: receipt.databasePath,
      MASTHEAD_HOST: "127.0.0.1",
      MASTHEAD_INSTANCE_DIR: receipt.instanceDir,
      MASTHEAD_INSTANCE_MANIFEST: receipt.instanceManifestPath,
      MASTHEAD_PORT: String(receipt.port),
      MASTHEAD_PRODUCTION_ROOT: receipt.productionRoot,
      MASTHEAD_PRODUCTION_TARGET: receipt.target
    },
    stdio: "inherit"
  });
  let spawnError;
  child.once("error", (error) => { spawnError = error; });
  child.rehearsalSpawnError = () => spawnError;
  return child;
}

async function waitForHealth(baseUrl, child) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (child.rehearsalSpawnError?.()) throw new Error("Could not start the isolated packaged daemon.", { cause: child.rehearsalSpawnError() });
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Isolated packaged daemon exited before health proof.");
    const response = await fetch(`${baseUrl}/health`).catch(() => undefined);
    if (response?.ok) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("Isolated packaged daemon did not publish health within 60 seconds.");
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closeAfterTerm = once(child, "close");
  child.kill("SIGTERM");
  const result = await Promise.race([closeAfterTerm, new Promise((resolvePromise) => setTimeout(() => resolvePromise(undefined), 5_000))]);
  if (result) return;
  const closeAfterKill = once(child, "close");
  child.kill("SIGKILL");
  await closeAfterKill;
}

function runCrashRaceMatrix(environment) {
  process.stdout.write("Running the synthetic-fixture crash/race matrix after the supplied bundle completed the operational sequence.\n");
  const result = spawnSync(process.execPath, [
    join(dirname(SCRIPT_PATH), "..", "node_modules", "vitest", "vitest.mjs"),
    "run", "src/electron/__tests__/productionLauncher.test.ts", "-t",
    "unreceipted stage|real SIGKILL activation|resumes finalization in a fresh process|same crash-safe lifecycle lease|foreign staged artifact"
  ], { cwd: join(dirname(SCRIPT_PATH), ".."), env: environment, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Production activation crash/race matrix failed with exit ${result.status ?? "unknown"}.`);
}

async function reserveDynamicPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  if (!port) throw new Error("Could not reserve an isolated dynamic port.");
  return port;
}

function isolatedEnvironment(environment, homeDir) {
  const clean = Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith("MASTHEAD_")));
  return {
    ...clean,
    HOME: homeDir,
    XDG_CONFIG_HOME: join(homeDir, ".config"),
    XDG_DATA_HOME: join(homeDir, ".local", "share"),
    XDG_STATE_HOME: join(homeDir, ".local", "state")
  };
}

function within(root, path) {
  const value = relative(resolve(root), resolve(path));
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

if (resolve(process.argv[1] || "") === SCRIPT_PATH) {
  let failure;
  try {
    const result = await runProductionActivationRehearsal();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    failure = error;
  }
  if (failure) {
    process.stderr.write(`${failure instanceof Error ? failure.message : String(failure)}\n`);
    process.exitCode = 1;
  }
}
