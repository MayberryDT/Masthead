#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolvePackagedBundleLayout, verifyPackagedBundleManifest } from "./packaged-bundle-manifest.js";
import { readOwnedProcessStrict } from "./masthead-production.js";

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
  const livePaths = liveProductionPaths(environment);
  if (livePaths.some((path) => within(path, bundle))) throw new Error("Production activation rehearsal refuses a bundle inside live production state.");
  const layout = await resolvePackagedBundleLayout(bundle, process.platform);
  const manifest = await verifyPackagedBundleManifest(layout);
  return { bundle, layout, manifest, livePaths };
}

export async function runProductionActivationRehearsal(argv = process.argv.slice(2), environment = process.env) {
  const temporaryParent = await validateRehearsalTemporaryParent(environment);
  const verified = await validateRehearsalBundle(argv, environment);
  let rehearsalRoot;
  let installedLauncher;
  let lifecycleEnvironment;
  try {
    rehearsalRoot = await mkdtemp(join(temporaryParent, "masthead-production-activation-rehearsal-"));
    const homeDir = join(rehearsalRoot, "home");
    const productionRoot = join(rehearsalRoot, "production");
    const dataDirectory = join(rehearsalRoot, "data");
    const databasePath = join(dataDirectory, "masthead.sqlite");
    const lifecycleLeasePath = join(homeDir, ".local", "state", "masthead-production", "launcher.lease.sqlite");
    const isolatedPaths = [homeDir, productionRoot, dataDirectory, databasePath, join(dataDirectory, "masthead-instance.json"), lifecycleLeasePath];
    if (isolatedPaths.some((path) => !within(rehearsalRoot, path) || verified.livePaths.some((live) => within(live, path)))) {
      throw new Error("Production activation rehearsal isolation path validation failed.");
    }
    await Promise.all([mkdir(homeDir, { recursive: true }), mkdir(productionRoot, { recursive: true }), mkdir(dataDirectory, { recursive: true })]);
    const port = await reserveDynamicPort();
    const baseline = join(productionRoot, "Masthead-linux-x64-rehearsal-baseline");
    await cp(verified.bundle, baseline, { recursive: true });
    await verifyPackagedBundleManifest(await resolvePackagedBundleLayout(baseline, process.platform));
    await symlink(baseline, join(productionRoot, "current"));
    const release = verified.manifest.release;
    lifecycleEnvironment = productionEnvironment(environment, homeDir, {
      bundleDigest: verified.manifest.bundleDigest, dataDirectory, databasePath, gitSha: release.gitSha,
      lifecycleLeasePath, port, productionRoot, target: baseline, version: release.version
    });
    const stopped = await retryTransientProcessScan(() => runPackagedLifecycleCommand(verified, ["stop"], lifecycleEnvironment));
    if (stopped.stopped !== true || stopped.stoppedPids.length !== 0) throw new Error("Isolated stop proof failed before staging.");
    const baselineStatus = await retryTransientProcessScan(() => runPackagedLifecycleCommand(verified, ["status"], lifecycleEnvironment));
    if (baselineStatus.running !== false || baselineStatus.processes.length !== 0 || baselineStatus.healthMatches !== false) {
      throw new Error("Isolated baseline remained online after the default production stop proof.");
    }
    let receipt = await runPackagedLifecycleCommand(verified, [
      "stage", "--bundle", verified.bundle, "--bundle-digest", verified.manifest.bundleDigest,
      "--data-dir", dataDirectory, "--db-path", databasePath, "--port", String(port),
      "--production-root", productionRoot
    ], lifecycleEnvironment);
    if (receipt.launched || receipt.databaseOpened || await realpath(receipt.currentPath) !== baseline) throw new Error("Operational stage proof mutated runtime state.");
    await crashAndRecoverActivation(verified, receipt.receiptPath, lifecycleEnvironment);
    receipt = JSON.parse(await readFile(receipt.receiptPath, "utf8"));
    installedLauncher = receipt.stagedSurface.launcherPath;
    lifecycleEnvironment = productionEnvironment(environment, homeDir, {
      bundleDigest: receipt.sourceDigest, dataDirectory, databasePath, gitSha: receipt.buildSha,
      lifecycleLeasePath, port, productionRoot, target: receipt.target, version: receipt.buildVersion
    });
    const started = await runInstalledLifecycleCommand(installedLauncher, ["start"], lifecycleEnvironment);
    if (started.started !== true && started.alreadyRunning !== true) throw new Error("Operational packaged start did not prove a running candidate.");
    const rehearsalHealth = await fetch(`${receipt.baseUrl}/health`).then((response) => response.ok ? response.json() : undefined);
    if (
      rehearsalHealth?.ok !== true || rehearsalHealth.runtime?.mode !== "primary" || rehearsalHealth.runtime?.writable !== true ||
      rehearsalHealth.runtime?.baseUrl !== receipt.baseUrl || rehearsalHealth.runtime?.instanceDir !== receipt.instanceDir ||
      rehearsalHealth.runtime?.instanceManifest !== receipt.instanceManifestPath ||
      rehearsalHealth.runtime?.authoringCommand !== receipt.activeInstanceLauncherPath ||
      rehearsalHealth.data?.dataDirectory !== receipt.dataDirectory || rehearsalHealth.data?.databasePath !== receipt.databasePath ||
      rehearsalHealth.data?.migrationState !== "ready"
    ) throw new Error("Operational packaged start did not publish exact ready primary health.");
    const finalized = await runInstalledLifecycleCommand(installedLauncher, ["finalize", "--receipt", receipt.receiptPath], lifecycleEnvironment);
    if (!finalized.finalized) throw new Error("Operational finalization did not commit.");
    const installEntries = (await readdir(productionRoot)).sort();
    if (installEntries.length !== 2 || !installEntries.includes("current") || !installEntries.includes(basename(receipt.target))) {
      throw new Error(`Operational finalization left unexpected install artifacts: ${installEntries.join(", ")}`);
    }
    const stoppedCandidate = await retryTransientProcessScan(() => runInstalledLifecycleCommand(installedLauncher, ["stop"], lifecycleEnvironment));
    if (stoppedCandidate.stopped !== true) throw new Error("Operational packaged stop did not prove candidate shutdown.");
    const stoppedStatus = await retryTransientProcessScan(() => runInstalledLifecycleCommand(installedLauncher, ["status"], lifecycleEnvironment));
    if (stoppedStatus.running !== false || stoppedStatus.processes.length !== 0 || stoppedStatus.healthMatches !== false) {
      throw new Error("Operational candidate remained online after the default identity-bound production stop.");
    }
    if (await fetch(receipt.baseUrl).catch(() => undefined)) throw new Error("Operational candidate health endpoint remained reachable after stop.");
    await assertPortBindable(port);
    runCrashRaceMatrix(environment);
    return { ok: true, bundle: verified.bundle, isolated: true, matrix: true };
  } finally {
    if (rehearsalRoot) {
      if (installedLauncher && lifecycleEnvironment) {
        try {
          const stopped = await runInstalledLifecycleCommand(installedLauncher, ["stop"], lifecycleEnvironment);
          const status = await runInstalledLifecycleCommand(installedLauncher, ["status"], lifecycleEnvironment);
          if (stopped.stopped !== true || status.running !== false || status.processes.length !== 0) {
            throw new Error("identity-bound stop did not prove an empty process set");
          }
        } catch (error) {
          throw new Error(`Rehearsal cleanup could not prove isolated daemon exit; preserved ${rehearsalRoot}`, { cause: error });
        }
      }
      await rm(rehearsalRoot, { force: true, recursive: true });
    }
  }
}

async function crashAndRecoverActivation(verified, receiptPath, environment) {
  const lifecycleScript = join(verified.layout.resourcesPath, "daemon", "scripts", "masthead-production.js");
  const moduleUrl = pathToFileURL(lifecycleScript).href;
  const source = [
    `import { activateStagedProductionInstallation } from ${JSON.stringify(moduleUrl)};`,
    "for (let attempt = 0; attempt < 5; attempt += 1) {",
    "  try { await activateStagedProductionInstallation(process.argv[1], { onStep(step) { if (step === 'instance-launcher') process.kill(process.pid, 'SIGKILL'); } }); break; }",
    "  catch (error) { if (attempt === 4 || !/changed during scan|disappeared during scan/.test(String(error?.message))) throw error; }",
    "}"
  ].join("\n");
  const child = spawn(verified.layout.nodePath, ["--input-type=module", "-e", source, receiptPath], { env: environment, stdio: "inherit" });
  const [code, signal] = await once(child, "close");
  if (code !== null || signal !== "SIGKILL") throw new Error("Operational activation crash fixture did not die by SIGKILL.");
  await retryTransientProcessScan(() => runPackagedLifecycleCommand(verified, ["activate", "--receipt", receiptPath], environment));
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

export async function stopChild(child, adapters = {}) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const readProcess = adapters.readProcess ?? readOwnedProcessStrict;
  const captured = await readProcess(child.pid);
  if (!captured?.starttime) throw new Error("Rehearsal cleanup could not capture the spawned process identity.");
  const closeAfterTerm = once(child, "close");
  child.kill("SIGTERM");
  const result = await Promise.race([closeAfterTerm, new Promise((resolvePromise) => setTimeout(() => resolvePromise(undefined), adapters.termTimeoutMs ?? 5_000))]);
  if (result) return;
  const current = await readProcess(child.pid);
  if (!current || current.starttime !== captured.starttime) {
    throw new Error("Rehearsal cleanup refused SIGKILL because the spawned PID identity changed.");
  }
  const closeAfterKill = once(child, "close");
  child.kill("SIGKILL");
  await closeAfterKill;
}

async function runPackagedLifecycleCommand(verified, args, environment) {
  const lifecycleScript = join(verified.layout.resourcesPath, "daemon", "scripts", "masthead-production.js");
  return runLifecycleSubprocess(verified.layout.nodePath, [lifecycleScript, ...args, "--json"], environment);
}

async function runInstalledLifecycleCommand(launcherPath, args, environment) {
  return runLifecycleSubprocess(launcherPath, [...args, "--json"], environment);
}

async function runLifecycleSubprocess(executable, args, environment) {
  const child = spawn(executable, args, { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const [code, signal] = await once(child, "close");
  const output = Buffer.concat(stdout).toString("utf8").trim();
  const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
  if (code !== 0 || signal) throw new Error(`Packaged lifecycle command ${args[0]} failed (${signal || code}): ${errorOutput || output}`);
  const line = output.split(/\r?\n/u).filter(Boolean).at(-1);
  try {
    return JSON.parse(line || "");
  } catch (error) {
    throw new Error(`Packaged lifecycle command ${args[0]} did not return JSON.`, { cause: error });
  }
}

function runCrashRaceMatrix(environment) {
  process.stdout.write("Running the synthetic-fixture crash/race matrix after the supplied bundle completed the operational sequence.\n");
  const result = spawnSync(process.execPath, [
    join(dirname(SCRIPT_PATH), "..", "node_modules", "vitest", "vitest.mjs"),
    "run", "src/electron/__tests__/productionLauncher.test.ts", "-t",
    "unreceipted stage|stage receipt publication|real SIGKILL activation|repairs the staged receipt|resumes finalization in a fresh process|same crash-safe lifecycle lease|serializes real runCli lifecycle commands|foreign staged artifact|completion marker|symbolic-link substitution"
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

async function assertPortBindable(port) {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolvePromise);
  });
  await new Promise((resolvePromise) => server.close(resolvePromise));
}

async function validateRehearsalTemporaryParent(environment) {
  const requested = resolve(environment.TMPDIR || environment.TMP || environment.TEMP || tmpdir());
  const info = await lstat(requested).catch((error) => {
    throw new Error(`Production activation rehearsal temporary parent does not exist: ${requested}`, { cause: error });
  });
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Production activation rehearsal temporary parent must be a real directory, not a link.");
  }
  const canonical = await realpath(requested);
  if (canonical !== requested) throw new Error("Production activation rehearsal temporary parent must be canonical.");
  if (liveProductionPaths(environment).some((live) => within(live, canonical))) {
    throw new Error("Production activation rehearsal temporary parent overlaps live production state.");
  }
  return canonical;
}

function liveProductionPaths(environment) {
  const liveHome = resolve(environment.HOME || homedir());
  return [
    join(liveHome, ".local", "share", "masthead-production"),
    join(liveHome, ".config", "masthead-production"),
    join(liveHome, ".config", "masthead-production", "masthead.sqlite"),
    join(liveHome, ".config", "masthead-production", "masthead-instance.json")
  ];
}

function productionEnvironment(environment, homeDir, config) {
  return {
    ...isolatedEnvironment(environment, homeDir),
    MASTHEAD_ALLOWED_ORIGINS: `http://127.0.0.1:${config.port}`,
    MASTHEAD_BUILD_SHA: config.gitSha,
    MASTHEAD_BUILD_VERSION: config.version,
    MASTHEAD_BUNDLE_DIGEST: config.bundleDigest,
    MASTHEAD_DATA_DIR: config.dataDirectory,
    MASTHEAD_DB_PATH: config.databasePath,
    MASTHEAD_HOST: "127.0.0.1",
    MASTHEAD_LIFECYCLE_LEASE: config.lifecycleLeasePath,
    MASTHEAD_PORT: String(config.port),
    MASTHEAD_PRODUCTION_ROOT: config.productionRoot,
    MASTHEAD_PRODUCTION_TARGET: config.target
  };
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
