#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  resolvePackagedBundleLayout,
  verifyPackagedBundleManifest,
  writePackagedBundleManifest
} from "./packaged-bundle-manifest.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MATRIX_STAGE_STEPS = ["candidate-copy", "instance-stage", "surface-stage", "receipt-publication", "intent-removal"];
const MATRIX_ACTIVATION_STEPS = [
  "current", "instance-launcher", "lifecycle-launcher", "desktop", "activation-pre-commit", "activation-commit", "activation-receipt"
];
const MATRIX_FINALIZATION_STEPS = ["rollback-bundle", "staged-0", "staged-1", "staged-2", "receipt", "journal"];
const PACKAGE_BOUND_MATRIX_REQUIRED_IDS = [
  "stage:candidate-copy:SIGKILL",
  "stage:instance-stage:SIGKILL",
  "stage:surface-stage:SIGKILL",
  "stage:receipt-publication:SIGKILL",
  "stage:intent-removal:SIGKILL",
  "activate:current:SIGKILL",
  "activate:instance-launcher:SIGKILL",
  "activate:lifecycle-launcher:SIGKILL",
  "activate:desktop:SIGKILL",
  "activate:activation-pre-commit:SIGKILL",
  "activate:activation-commit:SIGKILL",
  "activate:activation-receipt:SIGKILL",
  "finalize:rollback-bundle:SIGKILL",
  "finalize:rollback-bundle:exit",
  "finalize:staged-0:SIGKILL",
  "finalize:staged-0:exit",
  "finalize:staged-1:SIGKILL",
  "finalize:staged-1:exit",
  "finalize:staged-2:SIGKILL",
  "finalize:staged-2:exit",
  "finalize:receipt:SIGKILL",
  "finalize:receipt:exit",
  "finalize:journal:SIGKILL",
  "finalize:journal:exit"
];
const PACKAGE_BOUND_MATRIX_CASES = [
  ...MATRIX_STAGE_STEPS.map((step) => ({ id: `stage:${step}:SIGKILL`, operation: "stage", step, termination: "SIGKILL" })),
  ...MATRIX_ACTIVATION_STEPS.map((step) => ({ id: `activate:${step}:SIGKILL`, operation: "activate", step, termination: "SIGKILL" })),
  ...MATRIX_FINALIZATION_STEPS.flatMap((step) => ["SIGKILL", "exit"].map((termination) => ({
    id: `finalize:${step}:${termination}`, operation: "finalize", step, termination
  })))
];
const PACKAGE_BOUND_MATRIX_MINIMUM_CASES = 24;
const MATRIX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

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
    const matrix = await runPackageBoundCrashMatrix(verified, environment, temporaryParent);
    return { ok: true, bundle: verified.bundle, isolated: true, matrix };
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

export function assertPackageBoundMatrixCoverage(executedCaseIds, expectedCaseIds = PACKAGE_BOUND_MATRIX_REQUIRED_IDS) {
  if (executedCaseIds.length !== expectedCaseIds.length) {
    throw new Error(`Package-bound crash matrix executed ${executedCaseIds.length} of ${expectedCaseIds.length} required cases.`);
  }
  if (
    new Set(executedCaseIds).size !== executedCaseIds.length ||
    executedCaseIds.some((id, index) => id !== expectedCaseIds[index])
  ) {
    throw new Error("Package-bound crash matrix case set changed; missing, duplicated, or renamed cases cannot be certified.");
  }
}

export async function runPackageBoundCrashMatrix(verified, environment = process.env, temporaryParent) {
  const definedCaseIds = PACKAGE_BOUND_MATRIX_CASES.map(({ id }) => id);
  assertPackageBoundMatrixCoverage(definedCaseIds, PACKAGE_BOUND_MATRIX_REQUIRED_IDS);
  if (PACKAGE_BOUND_MATRIX_REQUIRED_IDS.length !== PACKAGE_BOUND_MATRIX_MINIMUM_CASES) {
    throw new Error(`Package-bound crash matrix contract has ${PACKAGE_BOUND_MATRIX_REQUIRED_IDS.length} cases; expected exactly ${PACKAGE_BOUND_MATRIX_MINIMUM_CASES}.`);
  }
  const executedCaseIds = [];
  process.stdout.write(`Running ${PACKAGE_BOUND_MATRIX_REQUIRED_IDS.length} fresh-process crash cases through the supplied packaged lifecycle module.\n`);
  for (const definition of PACKAGE_BOUND_MATRIX_CASES) {
    try {
      await executePackageBoundCrashCase(definition, {
        environment,
        temporaryParent,
        verified
      });
    } catch (error) {
      throw new Error(
        `Package-bound crash matrix case ${definition.id} failed after ${executedCaseIds.length} of ${PACKAGE_BOUND_MATRIX_REQUIRED_IDS.length} cases.`,
        { cause: error }
      );
    }
    executedCaseIds.push(definition.id);
  }
  assertPackageBoundMatrixCoverage(executedCaseIds, PACKAGE_BOUND_MATRIX_REQUIRED_IDS);
  return {
    source: "supplied-package",
    executedCaseCount: executedCaseIds.length,
    expectedCaseCount: PACKAGE_BOUND_MATRIX_REQUIRED_IDS.length,
    minimumCaseCount: PACKAGE_BOUND_MATRIX_MINIMUM_CASES,
    caseIds: executedCaseIds
  };
}

async function executePackageBoundCrashCase(definition, context) {
  const temporaryParent = resolve(context.temporaryParent || context.environment.TMPDIR || tmpdir());
  const root = await mkdtemp(join(temporaryParent, "masthead-package-bound-matrix-"));
  try {
    const fixture = await createPackageBoundMatrixFixture(root, definition, context);
    if (definition.operation === "stage") await executeStageCrashCase(definition, fixture);
    else if (definition.operation === "activate") await executeActivationCrashCase(definition, fixture);
    else await executeFinalizationCrashCase(definition, fixture);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function createPackageBoundMatrixFixture(root, definition, context) {
  const homeDir = join(root, "home");
  const productionRoot = join(root, "production");
  const dataDirectory = join(root, "data");
  const databasePath = join(dataDirectory, "masthead.sqlite");
  const lifecycleLeasePath = join(homeDir, ".local", "state", "masthead-production", "launcher.lease.sqlite");
  const baseline = join(productionRoot, "Masthead-linux-x64-matrix-baseline");
  const candidateSource = join(root, "candidate-source");
  await Promise.all([
    createSyntheticMatrixBundle(baseline, { gitSha: "a".repeat(40), version: "matrix-baseline" }),
    createSyntheticMatrixBundle(candidateSource, { gitSha: "b".repeat(40), version: "matrix-candidate" }),
    mkdir(dataDirectory, { recursive: true }),
    mkdir(homeDir, { recursive: true })
  ]);
  await symlink(baseline, join(productionRoot, "current"));
  const candidateManifest = await verifyPackagedBundleManifest(await resolvePackagedBundleLayout(candidateSource, process.platform));
  const lifecycleScript = join(context.verified.layout.resourcesPath, "daemon", "scripts", "masthead-production.js");
  return {
    baseline,
    candidateSource,
    definition,
    environment: isolatedEnvironment(context.environment, homeDir),
    input: {
      bundleDigest: candidateManifest.bundleDigest,
      dataDirectory,
      databasePath,
      homeDir,
      lifecycleLeasePath,
      port: 29000,
      productionRoot,
      sourceBundlePath: candidateSource
    },
    lifecycleModuleUrl: pathToFileURL(lifecycleScript).href,
    nodePath: context.verified.layout.nodePath,
    productionRoot,
    root
  };
}

async function createSyntheticMatrixBundle(bundleRoot, release) {
  const daemonRoot = join(bundleRoot, "resources", "daemon");
  const scriptsRoot = join(daemonRoot, "scripts");
  const distRoot = join(daemonRoot, "dist", "src");
  await Promise.all([
    mkdir(scriptsRoot, { recursive: true }),
    mkdir(join(distRoot, "daemon"), { recursive: true }),
    mkdir(join(distRoot, "cli"), { recursive: true }),
    mkdir(join(distRoot, "core"), { recursive: true }),
    mkdir(join(distRoot, "shared"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(join(bundleRoot, process.platform === "win32" ? "masthead.exe" : "masthead"), "matrix executable\n", { mode: 0o755 }),
    writeFile(join(bundleRoot, "resources", "app.asar"), "matrix app\n"),
    writeFile(join(bundleRoot, "resources", "masthead-logo-sail.png"), MATRIX_PNG),
    writeFile(join(daemonRoot, process.platform === "win32" ? "node.exe" : "node"), "matrix node\n", { mode: 0o755 }),
    writeFile(join(daemonRoot, "release.json"), `${JSON.stringify(release)}\n`),
    ...["packaged-bundle-manifest.js", "masthead-production-cold-activation.js", "masthead-production.js", "masthead-hook.js", "resolve-hook-runtime.js"]
      .map((name) => writeFile(join(scriptsRoot, name), "export {};\n")),
    writeFile(join(distRoot, "daemon", "main.js"), "export {};\n"),
    writeFile(join(distRoot, "daemon", "productionTransitionMaintenance.js"), "export {};\n"),
    writeFile(join(distRoot, "cli", "mastheadctl.js"), "export {};\n"),
    writeFile(join(distRoot, "core", "daemonOwnership.js"), "export {};\n"),
    writeFile(join(distRoot, "shared", "protocol.js"), "export {};\n")
  ]);
  return writePackagedBundleManifest(await resolvePackagedBundleLayout(bundleRoot, process.platform));
}

async function executeStageCrashCase(definition, fixture) {
  await expectMatrixCrash(definition, fixture, {
    operation: "stage",
    input: fixture.input,
    step: definition.step,
    termination: definition.termination
  });
  const receipt = await runMatrixOperation(fixture, { operation: "stage", input: fixture.input });
  if (receipt?.staged !== true || !receipt.receiptPath) throw new Error("Fresh-process stage recovery did not return a durable receipt.");
  const entries = await readdir(fixture.productionRoot);
  if (entries.includes(".masthead-install-stage.intent.json") || entries.includes(".masthead-install-stage.pending.json")) {
    throw new Error("Fresh-process stage recovery left its intent or pending receipt record behind.");
  }
  if (entries.filter((name) => name.endsWith(".receipt.json")).length !== 1) {
    throw new Error("Fresh-process stage recovery did not leave exactly one durable receipt.");
  }
}

async function executeActivationCrashCase(definition, fixture) {
  const receipt = await runMatrixOperation(fixture, { operation: "stage", input: fixture.input });
  await expectMatrixCrash(definition, fixture, {
    operation: "activate",
    receiptPath: receipt.receiptPath,
    step: definition.step,
    termination: definition.termination
  });
  const recovered = await runMatrixOperation(fixture, { operation: "activate", receiptPath: receipt.receiptPath });
  if (recovered?.activated !== true || await realpath(receipt.currentPath) !== receipt.target) {
    throw new Error("Fresh-process activation recovery did not restore the candidate as current.");
  }
  const durableReceipt = JSON.parse(await readFile(receipt.receiptPath, "utf8"));
  if (typeof durableReceipt.activatedAt !== "string" || !durableReceipt.activatedAt) {
    throw new Error("Fresh-process activation recovery did not commit activation to the durable receipt.");
  }
}

async function executeFinalizationCrashCase(definition, fixture) {
  const receipt = await runMatrixOperation(fixture, { operation: "stage", input: fixture.input });
  await runMatrixOperation(fixture, { operation: "activate", receiptPath: receipt.receiptPath });
  const hookStep = definition.step === "rollback-bundle" ? `artifact-${basename(receipt.rollbackBundle.path)}` : definition.step;
  await expectMatrixCrash(definition, fixture, {
    operation: "finalize",
    receiptPath: receipt.receiptPath,
    step: hookStep,
    termination: definition.termination
  });
  const recovered = await runMatrixOperation(fixture, { operation: "finalize", receiptPath: receipt.receiptPath });
  if (recovered?.finalized !== true || recovered.receiptRemoved !== true) {
    throw new Error("Fresh-process finalization recovery did not commit.");
  }
  const entries = (await readdir(fixture.productionRoot)).sort();
  if (entries.length !== 2 || !entries.includes("current") || !entries.includes(basename(receipt.target))) {
    throw new Error(`Fresh-process finalization recovery left unexpected install artifacts: ${entries.join(", ")}`);
  }
}

async function expectMatrixCrash(definition, fixture, payload) {
  const result = await runMatrixWorker(fixture, payload);
  if (result.timedOut) throw new Error(`Packaged lifecycle hook timed out at ${definition.id}.`);
  const expected = definition.termination === "SIGKILL"
    ? result.code === null && result.signal === "SIGKILL"
    : result.code === 86 && result.signal === null;
  if (!expected) {
    throw new Error(
      `Packaged lifecycle hook did not terminate at ${definition.id}; code=${result.code}, signal=${result.signal || "none"}, stderr=${result.stderr || "empty"}.`
    );
  }
}

async function runMatrixOperation(fixture, payload) {
  const resultPath = join(fixture.root, `.matrix-result-${process.pid}-${Date.now()}.json`);
  const result = await runMatrixWorker(fixture, { ...payload, resultPath, termination: undefined });
  if (result.timedOut) throw new Error(`Packaged lifecycle ${payload.operation} recovery timed out.`);
  if (result.code !== 0 || result.signal) {
    throw new Error(`Packaged lifecycle recovery failed (${result.signal || result.code}): ${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(await readFile(resultPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Packaged lifecycle recovery did not persist JSON; code=${result.code}, signal=${result.signal || "none"}, stdout=${JSON.stringify(result.stdout)}, stderr=${JSON.stringify(result.stderr)}.`,
      { cause: error }
    );
  } finally {
    await rm(resultPath, { force: true });
  }
}

const MATRIX_WORKER_SOURCE = [
  "import { writeFile } from 'node:fs/promises';",
  "const lifecycle = await import(process.argv[1]);",
  "const payload = JSON.parse(process.argv[2]);",
  "const terminate = (step) => {",
  "  if (!payload.termination || step !== payload.step) return;",
  "  if (payload.termination === 'SIGKILL') process.kill(process.pid, 'SIGKILL');",
  "  process['exit'](86);",
  "};",
  "let result;",
  "if (payload.operation === 'stage') {",
  "  result = await lifecycle.stageProductionInstallation({ ...payload.input, onStageStep: terminate });",
  "} else if (payload.operation === 'activate') {",
  "  result = await lifecycle.activateStagedProductionInstallation(payload.receiptPath, { assertOffline: async () => undefined, runDesktopDatabaseCommand: () => undefined, onStep: terminate });",
  "} else {",
  "  result = await lifecycle.finalizeStagedProductionInstallation(payload.receiptPath, { verifyLiveProof: async () => undefined, onFinalizeStep: terminate });",
  "}",
  "if (payload.resultPath) await writeFile(payload.resultPath, `${JSON.stringify(result)}\\n`, 'utf8');"
].join("\n");

async function runMatrixWorker(fixture, payload) {
  const child = spawn(fixture.nodePath, [
    "--input-type=module", "-e", MATRIX_WORKER_SOURCE, fixture.lifecycleModuleUrl, JSON.stringify(payload)
  ], { env: fixture.environment, stdio: ["ignore", "pipe", "pipe"] });
  const stdoutPromise = readChildStream(child.stdout);
  const stderrPromise = readChildStream(child.stderr);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 30_000);
  let closed;
  try {
    closed = await Promise.all([
      once(child, "close"),
      stdoutPromise,
      stderrPromise
    ]);
  } finally {
    clearTimeout(timeout);
  }
  const [[code, signal], stdout, stderr] = closed;
  return {
    code,
    signal,
    timedOut,
    stdout,
    stderr: stderr.trim()
  };
}

async function readChildStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
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
