#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  resolvePackagedBundleLayout,
  verifyPackagedBundleManifest,
  writePackagedBundleManifest
} from "./packaged-bundle-manifest.js";
import { assertPackageBoundCrashBoundary } from "./masthead-production-crash-boundaries.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PIDFD_HELPER_PATH = fileURLToPath(new URL("./masthead-rehearsal-pidfd.py", import.meta.url));
const WAIT_HELPER_PATH = fileURLToPath(new URL("./masthead-rehearsal-exec.py", import.meta.url));
const PIDFD_HELPER_PYTHON = "/usr/bin/python3";
const SYSTEMD_RUN_PATH = "/usr/bin/systemd-run";
const SYSTEMCTL_PATH = "/usr/bin/systemctl";
const CGROUP_ROOT = "/sys/fs/cgroup";
const fixtureScopes = new Map();
const fixtureExternalClaims = new Map();
const MATRIX_STAGE_STEPS = [
  "candidate-temp-created",
  "candidate-copy-start",
  "candidate-claim",
  "candidate-claimed",
  "candidate-copy",
  "instance-file-created",
  "instance-stage",
  "lifecycle-file-created",
  "desktop-file-created",
  "surface-stage",
  "receipt-publication",
  "intent-removal"
];
const MATRIX_ACTIVATION_STEPS = [
  "current", "instance-launcher", "lifecycle-launcher", "desktop", "activation-pre-commit", "activation-commit", "activation-receipt"
];
const MATRIX_FINALIZATION_STEPS = ["rollback-bundle", "staged-0", "staged-1", "staged-2", "receipt", "journal"];
const PACKAGE_BOUND_MATRIX_REQUIRED_IDS = [
  "stage:candidate-temp-created:SIGKILL",
  "stage:candidate-copy-start:SIGKILL",
  "stage:candidate-claim:SIGKILL",
  "stage:candidate-claimed:SIGKILL",
  "stage:candidate-copy:SIGKILL",
  "stage:instance-file-created:SIGKILL",
  "stage:instance-stage:SIGKILL",
  "stage:lifecycle-file-created:SIGKILL",
  "stage:desktop-file-created:SIGKILL",
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
const PACKAGE_BOUND_MATRIX_MINIMUM_CASES = 31;
const FIXTURE_PROCESS_MARKER = "MASTHEAD_REHEARSAL_FIXTURE_ROOT";
const FIXTURE_RUN_TOKEN_MARKER = "MASTHEAD_REHEARSAL_RUN_TOKEN";
const OPERATIONAL_SUBPROCESS_TIMEOUT_MS = 360_000;
const MATRIX_SUBPROCESS_TIMEOUT_MS = 30_000;
const POST_KILL_TIMEOUT_MS = 5_000;
const NATURAL_EXIT_GRACE_MS = 150;
const DEFAULT_SUBPROCESS_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const READY_HEALTH_TIMEOUT_MS = 30_000;
const READY_HEALTH_RETRY_DELAY_MS = 50;
const MATRIX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

export async function runBoundedFixtureSubprocess(executable, args, options) {
  const fixtureRoot = resolve(options.fixtureRoot);
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_SUBPROCESS_OUTPUT_LIMIT_BYTES;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new Error("Fixture subprocess maxOutputBytes must be a positive safe integer.");
  }
  const runToken = `${randomUUID()}${randomUUID()}`;
  const environment = {
    ...(options.environment || process.env),
    [FIXTURE_PROCESS_MARKER]: fixtureRoot,
    [FIXTURE_RUN_TOKEN_MARKER]: runToken
  };
  const scopeUnit = `masthead-rehearsal-${process.pid}-${randomUUID()}.scope`;
  const waitSecret = `${randomUUID()}${randomUUID()}`;
  registerFixtureScope(fixtureRoot, scopeUnit);
  const child = spawn(SYSTEMD_RUN_PATH, [
    "--user", "--scope", "--quiet", "--collect", `--unit=${scopeUnit}`, "--",
    PIDFD_HELPER_PYTHON, "-I", "-S", WAIT_HELPER_PATH
  ], {
    env: environment,
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdin?.on("error", () => undefined);
  child.stdin?.end(`${JSON.stringify({ argv: [executable, ...args], secret: waitSecret })}\n`);
  const stdout = [];
  const stderr = [];
  let collectedOutputBytes = 0;
  let outputExceeded = false;
  const outputLimitReached = Symbol("output-limit-reached");
  let resolveOutputLimit;
  const outputLimit = new Promise((resolvePromise) => {
    resolveOutputLimit = resolvePromise;
  });
  const collectOutput = (chunks, chunk) => {
    if (outputExceeded) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = maxOutputBytes - collectedOutputBytes;
    if (buffer.length <= remaining) {
      chunks.push(buffer);
      collectedOutputBytes += buffer.length;
      return;
    }
    if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
    collectedOutputBytes = maxOutputBytes;
    outputExceeded = true;
    resolveOutputLimit(outputLimitReached);
  };
  child.stdout?.on("data", (chunk) => collectOutput(stdout, chunk));
  child.stderr?.on("data", (chunk) => collectOutput(stderr, chunk));
  let closed = false;
  const completion = new Promise((resolvePromise) => {
    child.once("error", (error) => {
      closed = true;
      resolvePromise({ error });
    });
    child.once("close", (code, signal) => {
      closed = true;
      resolvePromise({ code, signal });
    });
  });
  const timeoutMs = options.timeoutMs;
  const timedOut = Symbol("timed-out");
  let timer;
  const timeout = new Promise((resolvePromise) => {
    timer = setTimeout(() => resolvePromise(timedOut), timeoutMs);
  });
  let outcome;
  try {
    outcome = await Promise.race([completion, timeout, outputLimit]);
  } finally {
    clearTimeout(timer);
  }
  let waitProofFailure;
  let normalizedOutcome = outcome;
  let attestedStderr;
  if (outcome !== timedOut && outcome !== outputLimitReached && !outcome?.error) {
    try {
      const proof = extractAttestedWaitOutcome(Buffer.concat(stderr).toString("utf8"), waitSecret);
      normalizedOutcome = proof.outcome;
      attestedStderr = proof.stderr;
    } catch (error) {
      waitProofFailure = error;
    }
  }
  const result = outcome === timedOut || outcome === outputLimitReached ? undefined : {
    ...normalizedOutcome,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: (attestedStderr ?? Buffer.concat(stderr).toString("utf8")).trim()
  };
  let allowedLiveIdentities = normalizeFixtureProcessIdentities(options.allowedLiveIdentities || []);
  let captureFailure;
  if (result && !result.error && !waitProofFailure && options.captureAllowedLiveIdentities) {
    try {
      const captureInspectionTimeoutMs = options.postKillTimeoutMs ?? POST_KILL_TIMEOUT_MS;
      const inspectProcesses = () => inspectFixtureProcesses(
        fixtureRoot,
        scopeUnit,
        options.processSetAdapters,
        Date.now() + captureInspectionTimeoutMs
      );
      allowedLiveIdentities = normalizeFixtureProcessIdentities(await options.captureAllowedLiveIdentities({
        claimExternalScope: (input) => claimFixtureExternalScope(fixtureRoot, runToken, {
          ...input,
          deadline: Date.now() + captureInspectionTimeoutMs
        }),
        fixtureRoot,
        inspectProcesses,
        result
      }));
    } catch (error) {
      captureFailure = error;
      allowedLiveIdentities = [];
    }
  }
  let reconciliation;
  try {
    reconciliation = await reconcileFixtureProcessSet(fixtureRoot, {
      adapters: options.processSetAdapters,
      allowedLiveIdentities,
      fixtureScope: scopeUnit,
      isClosed: () => closed,
      naturalExitGraceMs: options.naturalExitGraceMs ?? NATURAL_EXIT_GRACE_MS,
      postKillTimeoutMs: options.postKillTimeoutMs ?? POST_KILL_TIMEOUT_MS,
      requireChildClosed: outcome === timedOut || outcome === outputLimitReached
    });
  } catch (cause) {
    throw fixturePreservationError(
      fixtureRoot,
      outcome === timedOut
        ? `Fixture subprocess timed out after ${timeoutMs}ms and exact fixture process-set exit could not be proven`
        : outcome === outputLimitReached
          ? `Fixture subprocess exceeded the combined stdout/stderr limit of ${maxOutputBytes} bytes and exact fixture process-set exit could not be proven`
        : "Fixture subprocess completed but its exact fixture process set could not be proven",
      cause
    );
  }
  if (allowedLiveIdentities.length === 0 || fixtureExternalClaims.get(fixtureRoot)?.size > 0) {
    fixtureScopes.delete(fixtureRoot);
  }
  if (captureFailure) throw fixturePreservationError(
    fixtureRoot,
    "Fixture subprocess companion attribution failed closed",
    captureFailure
  );
  if (waitProofFailure) throw fixturePreservationError(
    fixtureRoot,
    "Fixture subprocess exit status was not attested by the trusted wait helper",
    waitProofFailure
  );
  if (outcome === timedOut) throw new Error(`Fixture subprocess timed out after ${timeoutMs}ms.`);
  if (outcome === outputLimitReached) {
    const cause = new Error("Fixture subprocess output collection stopped at its configured byte limit.");
    cause.stdout = Buffer.concat(stdout).toString("utf8");
    cause.stderr = Buffer.concat(stderr).toString("utf8").trim();
    throw fixturePreservationError(
      fixtureRoot,
      `Fixture subprocess exceeded the combined stdout/stderr limit of ${maxOutputBytes} bytes`,
      cause
    );
  }
  if (reconciliation.unexpectedSeen) {
    throw new Error(`Fixture subprocess left unexpected fixture processes: ${reconciliation.unexpectedPids.join(", ")}.`);
  }
  if (result.error) throw result.error;
  return { ...result, allowedLiveIdentities };
}

function extractAttestedWaitOutcome(stderr, secret) {
  const prefix = "MASTHEAD_REHEARSAL_WAIT:";
  const marker = stderr.lastIndexOf(prefix);
  if (marker < 0) throw new Error("Trusted wait helper did not publish an exit attestation.");
  const end = stderr.indexOf("\n", marker);
  const record = stderr.slice(marker + prefix.length, end < 0 ? undefined : end);
  const separator = record.lastIndexOf(":");
  if (separator < 0) throw new Error("Trusted wait helper exit attestation is malformed.");
  const payload = record.slice(0, separator);
  const signature = record.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expected, "utf8"))
  ) throw new Error("Trusted wait helper exit attestation signature is invalid.");
  const parsed = JSON.parse(payload);
  const code = parsed?.code === null ? null : parsed?.code;
  const signal = parsed?.signal === null ? null : parsed?.signal === 9 ? "SIGKILL" : parsed?.signal === 15 ? "SIGTERM" : undefined;
  if ((code !== null && !Number.isInteger(code)) || (parsed?.signal !== null && signal === undefined)) {
    throw new Error("Trusted wait helper exit attestation contains an unsupported status.");
  }
  return {
    outcome: { code, signal },
    stderr: `${stderr.slice(0, marker)}${end < 0 ? "" : stderr.slice(end + 1)}`
  };
}

export async function cleanupDisposableRehearsalRoot(root, failure) {
  if (failure?.preserveFixtureRoot === true) return false;
  await rm(root, { force: true, recursive: true });
  fixtureScopes.delete(resolve(root));
  fixtureExternalClaims.delete(resolve(root));
  return true;
}

export function combineRehearsalAndCleanupFailures(fixtureRoot, rehearsalFailure, cleanupFailure) {
  const errors = rehearsalFailure === undefined ? [cleanupFailure] : [rehearsalFailure, cleanupFailure];
  const failure = new AggregateError(
    errors,
    rehearsalFailure === undefined
      ? `Rehearsal cleanup failed; preserved ${fixtureRoot}.`
      : `Production activation rehearsal failed and cleanup also failed; preserved ${fixtureRoot}.`,
    { cause: rehearsalFailure ?? cleanupFailure }
  );
  failure.preserveFixtureRoot = true;
  failure.fixtureRoot = fixtureRoot;
  return failure;
}

export async function runRehearsalCaseWithCleanup(fixtureRoot, body, cleanup) {
  let bodyFailure;
  try {
    return await body();
  } catch (error) {
    bodyFailure = error;
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (cleanupFailure) {
      throw combineRehearsalAndCleanupFailures(fixtureRoot, bodyFailure, cleanupFailure);
    }
  }
}

async function reconcileFixtureProcessSet(fixtureRoot, options) {
  const deadline = Date.now() + options.postKillTimeoutMs;
  const inspect = options.adapters?.inspect || (() => inspectFixtureProcessSet(fixtureRoot, options.fixtureScope, deadline));
  const signalIdentity = options.adapters?.signalIdentity || signalFixtureProcessIdentity;
  const allowed = new Map(options.allowedLiveIdentities.map((record) => [fixtureProcessKey(record), record]));
  const naturalExitDeadline = options.allowedLiveIdentities.length === 0 && !options.requireChildClosed
    ? Math.min(deadline, Date.now() + options.naturalExitGraceMs)
    : 0;
  const unexpectedPids = new Set();
  while (Date.now() < deadline) {
    const observed = await inspect(fixtureRoot, deadline);
    const unexpected = observed.filter((record) => !allowed.has(fixtureProcessKey(record)));
    if (unexpected.length === 0 && (!options.requireChildClosed || options.isClosed())) {
      return { unexpectedSeen: unexpectedPids.size > 0, unexpectedPids: [...unexpectedPids].sort((left, right) => left - right) };
    }
    if (unexpected.length > 0 && Date.now() < naturalExitDeadline) {
      await delay(20);
      continue;
    }
    for (const record of unexpected) {
      unexpectedPids.add(record.pid);
      if (record.signalSafe === false) throw new Error(
        `Fixture process ${record.pid} is unexpected in a claimed external cgroup; preserved without signaling; cgroup=${record.controlGroup || "unknown"}.`
      );
      if (Date.now() >= deadline) throw new Error("Fixture process-set deadline expired before identity-bound signaling completed.");
      await signalIdentity(record, "SIGKILL", deadline);
    }
    await delay(20);
  }
  const remaining = await inspect(fixtureRoot, deadline);
  throw new Error(
    `Fixture process set did not converge before its bounded deadline; remaining=${remaining.map(fixtureProcessKey).join(",") || "none"}; allowed=${[...allowed.keys()].join(",") || "none"}; childClosed=${options.isClosed()}.`
  );
}

async function inspectFixtureProcesses(fixtureRoot, fixtureScope, adapters, deadline) {
  return (adapters?.inspect || (() => inspectFixtureProcessSet(fixtureRoot, fixtureScope, deadline)))(fixtureRoot, deadline);
}

function normalizeFixtureProcessIdentities(records) {
  if (!Array.isArray(records)) throw new Error("Allowed fixture process identities must be an array.");
  const normalized = records.map((record) => {
    if (!Number.isSafeInteger(record?.pid) || record.pid < 1 || typeof record.starttime !== "string" || !record.starttime) {
      throw new Error("Allowed fixture process identity must contain an exact PID and starttime.");
    }
    return { pid: record.pid, starttime: record.starttime };
  });
  if (new Set(normalized.map(fixtureProcessKey)).size !== normalized.length) {
    throw new Error("Allowed fixture process identities must be unique.");
  }
  return normalized;
}

function fixtureProcessKey(record) {
  return `${record.pid}:${record.starttime}`;
}

function registerFixtureScope(fixtureRoot, scopeUnit) {
  const scopes = fixtureScopes.get(fixtureRoot) || new Set();
  scopes.add(scopeUnit);
  fixtureScopes.set(fixtureRoot, scopes);
}

function fixtureUserCgroupRoot() {
  if (typeof process.getuid !== "function") throw new Error("Fixture cgroup containment requires a Linux user identity.");
  const uid = process.getuid();
  return join(CGROUP_ROOT, "user.slice", `user-${uid}.slice`, `user@${uid}.service`);
}

function systemdUserEnvironment() {
  const environment = { ...process.env };
  delete environment[FIXTURE_PROCESS_MARKER];
  delete environment[FIXTURE_RUN_TOKEN_MARKER];
  return environment;
}

function remainingProcessSetTimeout(deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Fixture process-set deadline expired during containment inspection.");
  return Math.max(1, Math.min(3_000, remaining));
}

async function fixtureScopePids(scopeUnit, deadline, budget) {
  const result = spawnSync(SYSTEMCTL_PATH, ["--user", "show", scopeUnit, "--property=ControlGroup", "--value"], {
    encoding: "utf8",
    env: systemdUserEnvironment(),
    maxBuffer: 64 * 1024,
    timeout: remainingProcessSetTimeout(deadline)
  });
  if (result.error) throw new Error(`Could not inspect fixture scope ${scopeUnit}.`, { cause: result.error });
  if (result.status !== 0) {
    if (/not found|could not be found|does not exist/u.test(`${result.stdout}\n${result.stderr}`.toLowerCase())) {
      return { controlGroup: undefined, pids: [] };
    }
    throw new Error(`Could not inspect fixture scope ${scopeUnit}: ${result.stderr.trim() || `exit ${result.status}`}.`);
  }
  const controlGroup = result.stdout.trim();
  if (!controlGroup) return { controlGroup: undefined, pids: [] };
  if (!controlGroup.startsWith("/") || controlGroup.includes("..")) {
    throw new Error(`Fixture scope ${scopeUnit} returned an invalid control group.`);
  }
  return { controlGroup, pids: await readCgroupTreePids(controlGroup, deadline, budget) };
}

async function readCgroupTreePids(controlGroup, deadline, budget = { directories: 0 }) {
  const pending = [`${CGROUP_ROOT}${controlGroup}`];
  const pids = new Set();
  while (pending.length > 0) {
    remainingProcessSetTimeout(deadline);
    const current = pending.pop();
    budget.directories += 1;
    if (budget.directories > 1_024) throw new Error("Fixture cgroup tree exceeded its bounded inspection limit.");
    const [body, entries] = await Promise.all([
      readFile(join(current, "cgroup.procs"), "utf8").catch((error) => {
        if (error?.code === "ENOENT") return "";
        throw error;
      }),
      readdir(current, { withFileTypes: true }).catch((error) => {
        if (error?.code === "ENOENT") return [];
        throw error;
      })
    ]);
    for (const value of body.split(/\s+/u).filter(Boolean)) pids.add(Number(value));
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(join(current, entry.name));
    }
  }
  return [...pids];
}

function assertValidControlGroup(controlGroup, label) {
  if (typeof controlGroup !== "string" || !controlGroup.startsWith("/") || controlGroup.includes("..")) {
    throw new Error(`${label} returned an invalid control group.`);
  }
}

function validateExternalClaim(claim, userControlGroupRoot) {
  assertValidControlGroup(claim?.controlGroup, "Claimed external scope");
  if (!Number.isSafeInteger(claim?.startPid) || claim.startPid < 1) {
    throw new Error("Claimed external scope omitted the trusted Electron PID.");
  }
  if (claim.controlGroup !== userControlGroupRoot && !claim.controlGroup.startsWith(`${userControlGroupRoot}/`)) {
    throw new Error(`Claimed external scope ${claim.controlGroup} is outside the user cgroup subtree.`);
  }
  if (basename(claim.controlGroup) !== `app-masthead-${claim.startPid}.scope`) {
    throw new Error(`Claimed external scope ${claim.controlGroup} does not match trusted Electron PID ${claim.startPid}.`);
  }
  if (!Array.isArray(claim.trustedIdentities) || claim.trustedIdentities.length < 1) {
    throw new Error("Claimed external scope omitted exact trusted process identities.");
  }
}

async function readProcessIdentity(pid, deadline, includeControlGroup = false) {
  remainingProcessSetTimeout(deadline);
  const processRoot = join("/proc", String(pid));
  let info;
  try {
    info = await lstat(processRoot);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ESRCH") return undefined;
    throw new Error(`Fixture process identity is unreadable for PID ${pid}.`, { cause: error });
  }
  if (typeof process.geteuid === "function" && info.uid !== process.geteuid()) {
    throw new Error(`Fixture process ${pid} is not owned by the rehearsal user.`);
  }
  try {
    const statLine = await readFile(join(processRoot, "stat"), "utf8");
    const close = statLine.lastIndexOf(")");
    const fields = close < 0 ? [] : statLine.slice(close + 2).trim().split(/\s+/u);
    if (!fields[19]) throw new Error(`Fixture process ${pid} start identity is unavailable.`);
    const ppid = Number(fields[1]);
    if (!Number.isSafeInteger(ppid) || ppid < 0) throw new Error(`Fixture process ${pid} parent identity is unavailable.`);
    return {
      pid,
      ppid,
      ...(includeControlGroup ? { controlGroup: await readUnifiedProcessControlGroup(pid, deadline) } : {}),
      starttime: fields[19]
    };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ESRCH") return undefined;
    throw new Error(`Fixture process identity is unreadable for PID ${pid}.`, { cause: error });
  }
}

async function readUnifiedProcessControlGroup(pid, deadline) {
  remainingProcessSetTimeout(deadline);
  const body = await readFile(join("/proc", String(pid), "cgroup"), "utf8");
  const unified = body.split(/\r?\n/u).find((line) => line.startsWith("0::"))?.slice(3);
  assertValidControlGroup(unified, `Process ${pid}`);
  return unified;
}

async function readTokenBoundClaimIdentity(pid, runToken, deadline, allowExited, requireToken = true) {
  const first = await readProcessIdentity(pid, deadline, true);
  if (!first && allowExited) return undefined;
  if (!first) throw new Error(`Trusted candidate process identity is unreadable for PID ${pid}.`);
  let environment;
  try {
    environment = await readFile(join("/proc", String(pid), "environ"), "utf8");
  } catch (cause) {
    if (allowExited && (cause?.code === "ENOENT" || cause?.code === "ESRCH")) return undefined;
    throw new Error(`Trusted candidate process environment is unreadable for PID ${pid}.`, { cause });
  }
  if (requireToken && !environment.split("\0").includes(`${FIXTURE_RUN_TOKEN_MARKER}=${runToken}`)) {
    throw new Error(`Trusted candidate process PID ${pid} did not inherit the rehearsal run token.`);
  }
  const second = await readProcessIdentity(pid, deadline, true);
  if (!second && allowExited) return undefined;
  if (!second || second.starttime !== first.starttime || second.controlGroup !== first.controlGroup) {
    throw new Error(`Trusted candidate process identity changed while claiming PID ${pid}.`);
  }
  return second;
}

async function claimFixtureExternalScope(fixtureRoot, runToken, input) {
  const deadline = input?.deadline ?? Date.now() + POST_KILL_TIMEOUT_MS;
  const startPid = input?.startPid;
  const daemonPid = input?.daemonPid;
  if (!Number.isSafeInteger(startPid) || startPid < 1 || !Number.isSafeInteger(daemonPid) || daemonPid < 1) {
    throw new Error("Candidate external cgroup claim requires exact trusted Electron and daemon PIDs.");
  }
  const expectedScopeName = `app-masthead-${startPid}.scope`;
  const startIdentity = await readTokenBoundClaimIdentity(startPid, runToken, deadline, true, false);
  const daemonIdentity = daemonPid === startPid
    ? startIdentity
    : await readTokenBoundClaimIdentity(daemonPid, runToken, deadline, false);
  if (!daemonIdentity) throw new Error(`Trusted candidate daemon identity is unreadable for PID ${daemonPid}.`);
  if (startIdentity && daemonPid !== startPid && daemonIdentity.ppid !== startPid) {
    throw new Error(`Trusted candidate daemon PID ${daemonPid} is not a direct child of Electron PID ${startPid}.`);
  }
  const liveTrustedIdentities = [startIdentity, daemonIdentity].filter(Boolean);
  const controlGroup = startIdentity?.controlGroup || daemonIdentity.controlGroup;
  const userControlGroupRoot = fixtureUserCgroupRoot().slice(CGROUP_ROOT.length);
  if (
    basename(controlGroup) !== expectedScopeName ||
    liveTrustedIdentities.some((record) => record.controlGroup !== controlGroup)
  ) {
    throw new Error(`Trusted candidate processes did not occupy exact external scope ${expectedScopeName}.`);
  }
  const claim = {
    controlGroup,
    startPid,
    trustedIdentities: liveTrustedIdentities.map(({ pid, starttime }) => ({ pid, starttime }))
  };
  validateExternalClaim(claim, userControlGroupRoot);
  const claims = fixtureExternalClaims.get(fixtureRoot) || new Map();
  if (!claims.has(controlGroup) && claims.size >= 8) {
    throw new Error("Fixture claimed external scope set exceeded its bounded limit.");
  }
  claims.set(controlGroup, claim);
  fixtureExternalClaims.set(fixtureRoot, claims);
  return claim;
}

async function inspectClaimedFixtureProcessSet(input, adapters) {
  const deadline = input.deadline ?? Date.now() + POST_KILL_TIMEOUT_MS;
  const userControlGroupRoot = input.userControlGroupRoot;
  assertValidControlGroup(userControlGroupRoot, "User cgroup subtree");
  registerFixtureScope(input.fixtureRoot, input.currentScope);
  const scopes = fixtureScopes.get(input.fixtureRoot) || new Set();
  if (scopes.size > 128) throw new Error("Fixture registered scope set exceeded its bounded limit.");
  const claims = input.claimedExternalControlGroups || [];
  if (claims.length > 8) throw new Error("Fixture claimed external scope set exceeded its bounded limit.");
  const entries = new Map();

  for (const scopeUnit of scopes) {
    remainingProcessSetTimeout(deadline);
    const resolved = await adapters.resolveRegisteredScope(scopeUnit, deadline);
    if (resolved.pids.length === 0) scopes.delete(scopeUnit);
    for (const pid of resolved.pids) entries.set(pid, { signalSafe: true });
  }
  if (scopes.size === 0) fixtureScopes.delete(input.fixtureRoot);

  for (const claim of claims) {
    remainingProcessSetTimeout(deadline);
    validateExternalClaim(claim, userControlGroupRoot);
    const pids = await adapters.readCgroupTreePids(claim.controlGroup, deadline);
    if (pids.length > 1_024) throw new Error("Fixture process set exceeded its bounded identity limit.");
    const claimedPidSet = new Set(pids);
    for (const trusted of claim.trustedIdentities) {
      if (!Number.isSafeInteger(trusted?.pid) || trusted.pid < 1 || typeof trusted.starttime !== "string" || !trusted.starttime) {
        throw new Error("Claimed external scope contains an invalid trusted process identity.");
      }
      const current = await adapters.readProcessIdentity(trusted.pid, deadline);
      if (claimedPidSet.has(trusted.pid) && !current) {
        throw new Error(`Claimed external scope trusted process identity is unreadable for PID ${trusted.pid}.`);
      }
      if (current && current.starttime !== trusted.starttime) {
        throw new Error(`Claimed external scope trusted process identity changed for PID ${trusted.pid}.`);
      }
      if (current?.controlGroup && current.controlGroup !== claim.controlGroup) {
        throw new Error(`Claimed external scope trusted process PID ${trusted.pid} moved outside its claimed cgroup.`);
      }
    }
    for (const pid of pids) entries.set(pid, { controlGroup: claim.controlGroup, signalSafe: false });
  }

  if (entries.size > 1_024) throw new Error("Fixture process set exceeded its bounded identity limit.");
  const records = [];
  for (const [pid, attribution] of entries) {
    remainingProcessSetTimeout(deadline);
    if (pid === process.pid) continue;
    const identity = await adapters.readProcessIdentity(pid, deadline);
    if (!identity) {
      if (attribution.signalSafe === false) {
        throw new Error(`Claimed external scope process identity is unreadable for PID ${pid}.`);
      }
      continue;
    }
    records.push({
      ...(attribution.controlGroup ? { controlGroup: attribution.controlGroup } : {}),
      pid,
      ppid: identity.ppid,
      signalSafe: attribution.signalSafe,
      starttime: identity.starttime
    });
  }
  return records.sort((left, right) => left.pid - right.pid);
}

export async function inspectClaimedFixtureProcessSetForTest(input, adapters) {
  return inspectClaimedFixtureProcessSet(input, adapters);
}

async function inspectFixtureProcessSet(fixtureRoot, currentScope, deadline = Date.now() + POST_KILL_TIMEOUT_MS) {
  if (process.platform !== "linux") throw new Error("Exact fixture process-set inspection is only implemented on Linux.");
  const budget = { directories: 0 };
  return inspectClaimedFixtureProcessSet({
    claimedExternalControlGroups: [...(fixtureExternalClaims.get(fixtureRoot)?.values() || [])],
    currentScope,
    deadline,
    fixtureRoot,
    userControlGroupRoot: fixtureUserCgroupRoot().slice(CGROUP_ROOT.length)
  }, {
    readCgroupTreePids: (controlGroup, inspectionDeadline) => readCgroupTreePids(controlGroup, inspectionDeadline, budget),
    readProcessIdentity: (pid, inspectionDeadline) => readProcessIdentity(pid, inspectionDeadline, true),
    resolveRegisteredScope: (scopeUnit, inspectionDeadline) => fixtureScopePids(scopeUnit, inspectionDeadline, budget)
  });
}

function runPidfdHelper(request, timeoutMs = 3_000) {
  const result = spawnSync(PIDFD_HELPER_PYTHON, ["-I", "-S", PIDFD_HELPER_PATH, JSON.stringify(request)], {
    encoding: "utf8",
    env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
    maxBuffer: 64 * 1024,
    timeout: timeoutMs
  });
  if (result.error) throw new Error("Identity-bound pidfd helper could not run.", { cause: result.error });
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error("Identity-bound pidfd helper returned malformed output.", { cause: error });
  }
  if (result.status !== 0 || response?.status === "error") {
    throw new Error(`Identity-bound pidfd helper failed: ${response?.message || result.stderr.trim() || `exit ${result.status}`}.`);
  }
  return response;
}

export async function assertIdentityBoundSignalingAvailable() {
  const response = runPidfdHelper({ operation: "probe" });
  if (response?.status !== "available") throw new Error("Identity-bound pidfd helper capability probe failed closed.");
}

export async function assertFixtureContainmentAvailable() {
  const scopeUnit = `masthead-rehearsal-probe-${process.pid}-${randomUUID()}.scope`;
  const result = spawnSync(SYSTEMD_RUN_PATH, [
    "--user", "--scope", "--quiet", "--collect", `--unit=${scopeUnit}`, "--", "/usr/bin/true"
  ], {
    encoding: "utf8",
    env: systemdUserEnvironment(),
    maxBuffer: 64 * 1024,
    timeout: 3_000
  });
  if (result.error || result.status !== 0) throw new Error(
    "Kernel-backed fixture cgroup containment is unavailable.",
    { cause: result.error || new Error(result.stderr.trim() || `exit ${result.status}`) }
  );
}

export async function signalFixtureProcessIdentity(record, requestedSignal, deadline = Date.now() + 3_000) {
  if (
    !Number.isSafeInteger(record?.pid) || record.pid < 1 ||
    typeof record?.starttime !== "string" || !record.starttime ||
    (requestedSignal !== "SIGTERM" && requestedSignal !== "SIGKILL")
  ) throw new Error("Identity-bound fixture signal requires an exact process identity and supported signal.");
  const response = runPidfdHelper({
    operation: "signal",
    pid: record.pid,
    signal: requestedSignal,
    starttime: record.starttime
  }, remainingProcessSetTimeout(deadline));
  if (response?.status === "signaled" || response?.status === "already-exited") return { status: response.status };
  if (response?.status === "reused" && typeof response.observedStarttime === "string") {
    return { status: "reused", observedStarttime: response.observedStarttime };
  }
  throw new Error("Identity-bound pidfd helper returned an unsupported result.");
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

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
  await assertIdentityBoundSignalingAvailable();
  await assertFixtureContainmentAvailable();
  let rehearsalRoot;
  let installedLauncher;
  let lifecycleEnvironment;
  let rehearsalFailure;
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
    await runInstalledStartAndFinalizeProof(installedLauncher, receipt, lifecycleEnvironment);
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
  } catch (error) {
    rehearsalFailure = error;
    throw error;
  } finally {
    if (rehearsalRoot) {
      try {
        if (installedLauncher && lifecycleEnvironment) {
          const stopped = await runInstalledLifecycleCommand(installedLauncher, ["stop"], lifecycleEnvironment);
          const status = await runInstalledLifecycleCommand(installedLauncher, ["status"], lifecycleEnvironment);
          if (stopped.stopped !== true || status.running !== false || status.processes.length !== 0) {
            throw new Error("identity-bound stop did not prove an empty process set");
          }
        }
        await cleanupDisposableRehearsalRoot(rehearsalRoot, rehearsalFailure);
      } catch (cleanupFailure) {
        throw combineRehearsalAndCleanupFailures(rehearsalRoot, rehearsalFailure, cleanupFailure);
      }
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
  const crashResult = await runBoundedFixtureSubprocess(
    verified.layout.nodePath,
    ["--input-type=module", "-e", source, receiptPath],
    {
      environment,
      fixtureRoot: fixtureRootFromEnvironment(environment),
      postKillTimeoutMs: POST_KILL_TIMEOUT_MS,
      timeoutMs: OPERATIONAL_SUBPROCESS_TIMEOUT_MS
    }
  );
  if (crashResult.code !== null || crashResult.signal !== "SIGKILL") throw new Error(
    `Operational activation crash fixture did not die by SIGKILL; code=${crashResult.code}, signal=${crashResult.signal || "none"}, stderr=${crashResult.stderr || "empty"}.`
  );
  await retryTransientProcessScan(() => runPackagedLifecycleCommand(verified, ["activate", "--receipt", receiptPath], environment));
}

export async function retryTransientProcessScan(operation) {
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

async function runInstalledLifecycleCommand(launcherPath, args, environment, supervisorOptions = {}) {
  return runLifecycleSubprocess(launcherPath, [...args, "--json"], environment, supervisorOptions);
}

export async function runReceiptBoundStopAndStatus(runLifecycleCommand, launcherPath, environment) {
  let stopped;
  let status;
  let stopFailure;
  let statusFailure;
  try {
    stopped = await retryTransientProcessScan(() => runLifecycleCommand(launcherPath, ["stop"], environment));
  } catch (error) {
    stopFailure = error;
  }
  try {
    status = await retryTransientProcessScan(() => runLifecycleCommand(launcherPath, ["status"], environment));
  } catch (error) {
    statusFailure = error;
  }
  if (stopFailure && statusFailure) {
    throw new AggregateError(
      [stopFailure, statusFailure],
      "Receipt-bound stop and status cleanup both failed.",
      { cause: stopFailure }
    );
  }
  if (stopFailure) throw stopFailure;
  if (statusFailure) throw statusFailure;
  return { status, stopped };
}

async function startInstalledLifecycleWithIdentityCapture(runLifecycleCommand, launcherPath, environment, receipt) {
  return retryTransientProcessScan(() => runLifecycleCommand(launcherPath, ["start"], environment, {
    captureAllowedLiveIdentities: captureProductionCompanionIdentities(receipt)
  }));
}

export async function runInstalledStartAndFinalizeProof(installedLauncher, receipt, environment, adapters = {}) {
  const runLifecycleCommand = adapters.runLifecycleCommand || runInstalledLifecycleCommand;
  const started = await startInstalledLifecycleWithIdentityCapture(
    runLifecycleCommand,
    installedLauncher,
    environment,
    receipt
  );
  if (started.started !== true && started.alreadyRunning !== true) {
    throw new Error("Operational packaged start did not prove a running candidate.");
  }
  const fixtureProcessIdentities = normalizeFixtureProcessIdentities(started.fixtureProcessIdentities || []);
  if (fixtureProcessIdentities.length < 1) {
    throw new Error("Operational packaged start did not retain the exact live daemon/process-tree identities.");
  }
  await waitForExactReadyHealth(receipt, { fetchHealth: adapters.fetchHealth });
  const finalized = await runLifecycleCommand(
    installedLauncher,
    ["finalize", "--receipt", receipt.receiptPath],
    environment,
    { allowedLiveIdentities: fixtureProcessIdentities }
  );
  if (!finalized.finalized) throw new Error("Operational finalization did not commit.");
  return { finalized, fixtureProcessIdentities, started };
}

async function runLifecycleSubprocess(executable, args, environment, supervisorOptions = {}) {
  const subprocess = await runBoundedFixtureSubprocess(executable, args, {
    ...supervisorOptions,
    environment,
    fixtureRoot: fixtureRootFromEnvironment(environment),
    postKillTimeoutMs: POST_KILL_TIMEOUT_MS,
    timeoutMs: OPERATIONAL_SUBPROCESS_TIMEOUT_MS
  });
  const { code, signal, stdout, stderr } = subprocess;
  const output = stdout.trim();
  const errorOutput = stderr.trim();
  if (code !== 0 || signal) throw new Error(`Packaged lifecycle command ${args[0]} failed (${signal || code}): ${errorOutput || output}`);
  const line = output.split(/\r?\n/u).filter(Boolean).at(-1);
  try {
    const value = JSON.parse(line || "");
    return { ...value, fixtureProcessIdentities: subprocess.allowedLiveIdentities };
  } catch (error) {
    throw new Error(`Packaged lifecycle command ${args[0]} did not return JSON.`, { cause: error });
  }
}

function captureProductionCompanionIdentities(receipt) {
  return async ({ claimExternalScope, inspectProcesses, result }) => {
    if (result.code !== 0 || result.signal) return [];
    const output = result.stdout.trim();
    const line = output.split(/\r?\n/u).filter(Boolean).at(-1);
    const started = JSON.parse(line || "");
    if (started?.started !== true || !Number.isSafeInteger(started.pid) || started.pid < 1) {
      throw new Error("Installed packaged start did not return an exact trusted Electron start PID.");
    }
    return retryTransientProcessScan(async () => {
      const health = await waitForExactReadyHealth(receipt);
      const manifest = JSON.parse(await readFile(receipt.instanceManifestPath, "utf8"));
      if (
        manifest?.schemaVersion !== 1 || manifest.pid !== health.runtime.pid || manifest.instanceId !== health.runtime.daemonInstanceId ||
        manifest.baseUrl !== receipt.baseUrl || manifest.instanceDir !== receipt.instanceDir || manifest.buildSha !== receipt.buildSha ||
        !Number.isFinite(Date.parse(manifest.updatedAt))
      ) throw new Error("Installed packaged start did not publish an exact startup manifest.");
      await claimExternalScope({ startPid: started.pid, daemonPid: health.runtime.pid });
      const processes = await inspectProcesses();
      try {
        return selectProductionCompanionIdentities(started, health, processes);
      } catch (error) {
        const daemonCgroup = await readFile(join("/proc", String(health.runtime.pid), "cgroup"), "utf8")
          .then((value) => value.trim())
          .catch((cause) => `unreadable:${cause?.code || cause}`);
        throw new Error(`${error instanceof Error ? error.message : String(error)}; daemonCgroup=${daemonCgroup}`, { cause: error });
      }
    });
  };
}

export function selectProductionCompanionIdentities(started, health, processes) {
  const electronPids = started?.started === true
    ? [started.pid]
    : started?.alreadyRunning === true && Array.isArray(started.pids) ? started.pids : [];
  const daemonPid = health?.runtime?.pid;
  const expectedRoots = new Set([...electronPids, daemonPid]);
  const observedSummary = processes
    .map((record) => `${record.pid}/${Number.isSafeInteger(record.ppid) ? record.ppid : "unknown"}/${record.starttime}`)
    .join(",");
  const rejectProof = (reason) => {
    throw new Error(`Installed packaged start process ancestry proof failed (${reason}); observed=${observedSummary || "none"}.`);
  };
  if (
    electronPids.length === 0 || electronPids.some((pid) => !Number.isSafeInteger(pid) || pid < 1) ||
    !Number.isSafeInteger(daemonPid) || daemonPid < 1
  ) rejectProof("start or health omitted an expected root PID");
  const expectedExternalScopes = new Set(electronPids.map((pid) => `app-masthead-${pid}.scope`));
  for (const record of processes) {
    if (
      record.signalSafe === false &&
      (typeof record.controlGroup !== "string" || !expectedExternalScopes.has(basename(record.controlGroup)))
    ) rejectProof(`process ${record.pid} escaped into an unrecognized external cgroup`);
  }
  const byPid = new Map();
  for (const record of processes) {
    if (
      !Number.isSafeInteger(record?.pid) || record.pid < 1 || !Number.isSafeInteger(record?.ppid) || record.ppid < 0 ||
      typeof record.starttime !== "string" || !record.starttime || byPid.has(record.pid)
    ) rejectProof("observed process identities are incomplete or duplicated");
    byPid.set(record.pid, record);
  }
  if (!byPid.has(daemonPid)) rejectProof(`expected live daemon PID ${daemonPid} was not observed`);
  for (const record of processes) {
    if (expectedRoots.has(record.pid)) continue;
    const visited = new Set([record.pid]);
    let parentPid = record.ppid;
    let belongsToExpectedRoot = false;
    while (Number.isSafeInteger(parentPid) && parentPid > 0 && !visited.has(parentPid)) {
      if (expectedRoots.has(parentPid)) {
        belongsToExpectedRoot = true;
        break;
      }
      visited.add(parentPid);
      parentPid = byPid.get(parentPid)?.ppid;
    }
    if (!belongsToExpectedRoot) rejectProof(`PID ${record.pid} is unrelated to the expected roots`);
  }
  return processes;
}

export async function waitForExactReadyHealth(receipt, options = {}) {
  const timeoutMs = options.timeoutMs ?? READY_HEALTH_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? READY_HEALTH_RETRY_DELAY_MS;
  const deadline = Date.now() + timeoutMs;
  const fetchHealth = options.fetchHealth || (async (baseUrl, attemptTimeoutMs) => fetch(`${baseUrl}/health`, {
    signal: AbortSignal.timeout(attemptTimeoutMs)
  }).then((response) => response.ok ? response.json() : undefined));
  let lastFailure;
  while (Date.now() < deadline) {
    const attemptTimeoutMs = Math.max(1, Math.min(1_000, deadline - Date.now()));
    let attemptTimer;
    try {
      const health = await Promise.race([
        Promise.resolve(fetchHealth(receipt.baseUrl, attemptTimeoutMs)),
        new Promise((_, reject) => {
          attemptTimer = setTimeout(() => reject(new Error("Health readiness attempt timed out.")), attemptTimeoutMs);
        })
      ]);
      assertExactReadyHealth(receipt, health);
      return health;
    } catch (error) {
      lastFailure = error;
    } finally {
      clearTimeout(attemptTimer);
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) await delay(Math.min(retryDelayMs, remainingMs));
  }
  throw new Error(`Installed packaged start did not publish exact ready primary health before ${timeoutMs}ms deadline.`, {
    cause: lastFailure
  });
}

function assertExactReadyHealth(receipt, health) {
  if (
    health?.ok !== true || health.runtime?.mode !== "primary" || health.runtime?.writable !== true ||
    health.runtime?.baseUrl !== receipt.baseUrl || health.runtime?.instanceDir !== receipt.instanceDir ||
    health.runtime?.instanceManifest !== receipt.instanceManifestPath ||
    health.runtime?.authoringCommand !== receipt.activeInstanceLauncherPath ||
    health.data?.dataDirectory !== receipt.dataDirectory || health.data?.databasePath !== receipt.databasePath ||
    health.data?.migrationState !== "ready" || health.buildSha !== receipt.buildSha
  ) throw new Error("Installed packaged start did not publish exact ready primary health.");
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
  let failure;
  try {
    const fixture = await createPackageBoundMatrixFixture(root, definition, context);
    if (definition.operation === "stage") await executeStageCrashCase(definition, fixture);
    else if (definition.operation === "activate") await executeActivationCrashCase(definition, fixture);
    else await executeFinalizationCrashCase(definition, fixture);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await cleanupDisposableRehearsalRoot(root, failure);
    } catch (cleanupFailure) {
      throw combineRehearsalAndCleanupFailures(root, failure, cleanupFailure);
    }
  }
}

async function createPackageBoundMatrixFixture(root, definition, context) {
  const homeDir = join(root, "home");
  const productionRoot = join(root, "production");
  const dataDirectory = join(root, "data");
  const databasePath = join(dataDirectory, "masthead.sqlite");
  const lifecycleLeasePath = join(homeDir, ".local", "state", "masthead-production", "launcher.lease.sqlite");
  const baseline = join(productionRoot, "Masthead-linux-x64-matrix-baseline");
  await Promise.all([
    createSyntheticMatrixBaseline(baseline, { gitSha: "a".repeat(40), version: "matrix-baseline" }),
    mkdir(dataDirectory, { recursive: true }),
    mkdir(homeDir, { recursive: true })
  ]);
  await symlink(baseline, join(productionRoot, "current"));
  const lifecycleScript = join(context.verified.layout.resourcesPath, "daemon", "scripts", "masthead-production.js");
  return {
    baseline,
    candidateSource: context.verified.bundle,
    definition,
    environment: isolatedEnvironment(context.environment, homeDir),
    input: {
      bundleDigest: context.verified.manifest.bundleDigest,
      dataDirectory,
      databasePath,
      homeDir,
      lifecycleLeasePath,
      port: await reserveDynamicPort(),
      productionRoot,
      sourceBundlePath: context.verified.bundle
    },
    lifecycleModuleUrl: pathToFileURL(lifecycleScript).href,
    nodePath: context.verified.layout.nodePath,
    productionRoot,
    root
  };
}

async function createSyntheticMatrixBaseline(bundleRoot, release) {
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
  await assertPackageBoundCrashBoundary(definition, fixture);
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
  await assertPackageBoundCrashBoundary(definition, fixture, receipt);
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
  const lifecycleEnvironment = productionEnvironment(fixture.environment, fixture.input.homeDir, {
    bundleDigest: receipt.sourceDigest,
    dataDirectory: receipt.dataDirectory,
    databasePath: receipt.databasePath,
    gitSha: receipt.buildSha,
    lifecycleLeasePath: receipt.lifecycleLeasePath,
    port: receipt.port,
    productionRoot: receipt.productionRoot,
    target: receipt.target,
    version: receipt.buildVersion
  });
  await runRehearsalCaseWithCleanup(fixture.root, async () => {
    const started = await startInstalledLifecycleWithIdentityCapture(
      runInstalledLifecycleCommand,
      receipt.stagedSurface.launcherPath,
      lifecycleEnvironment,
      receipt
    );
    fixture.allowedLiveIdentities = started.fixtureProcessIdentities;
    const hookStep = definition.step === "rollback-bundle" ? `artifact-${basename(receipt.rollbackBundle.path)}` : definition.step;
    await expectMatrixCrash(definition, fixture, {
      operation: "finalize",
      receiptPath: receipt.receiptPath,
      step: hookStep,
      termination: definition.termination
    });
    await assertPackageBoundCrashBoundary(definition, fixture, receipt);
    const recovered = await runMatrixOperation(fixture, { operation: "finalize", receiptPath: receipt.receiptPath });
    if (recovered?.finalized !== true || recovered.receiptRemoved !== true) {
      throw new Error("Fresh-process finalization recovery did not commit.");
    }
    const entries = (await readdir(fixture.productionRoot)).sort();
    if (entries.length !== 2 || !entries.includes("current") || !entries.includes(basename(receipt.target))) {
      throw new Error(`Fresh-process finalization recovery left unexpected install artifacts: ${entries.join(", ")}`);
    }
  }, async () => {
    try {
      const { status, stopped } = await runReceiptBoundStopAndStatus(
        runInstalledLifecycleCommand,
        receipt.stagedSurface.launcherPath,
        lifecycleEnvironment
      );
      if (stopped.stopped !== true || status.running !== false || status.processes.length !== 0) {
        throw new Error("Identity-bound matrix stop did not prove an empty supplied-package process set.");
      }
    } finally {
      fixture.allowedLiveIdentities = [];
    }
  });
}

function fixturePreservationError(fixtureRoot, message, cause) {
  const error = new Error(`${message}; preserved ${fixtureRoot}.`, { cause });
  error.preserveFixtureRoot = true;
  error.fixtureRoot = fixtureRoot;
  return error;
}

async function expectMatrixCrash(definition, fixture, payload) {
  const result = await runMatrixWorkerWithTransientProcessScan(fixture, payload);
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
  const result = await runMatrixWorkerWithTransientProcessScan(fixture, { ...payload, resultPath, termination: undefined });
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

async function runMatrixWorkerWithTransientProcessScan(fixture, payload) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await runMatrixWorker(fixture, payload);
    if (
      result.code !== 0 &&
      attempt < 4 &&
      /changed during scan|disappeared during scan/u.test(result.stderr)
    ) continue;
    return result;
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
  "  result = await lifecycle.activateStagedProductionInstallation(payload.receiptPath, { runDesktopDatabaseCommand: () => undefined, onStep: terminate });",
  "} else {",
  "  result = await lifecycle.finalizeStagedProductionInstallation(payload.receiptPath, { onFinalizeStep: terminate });",
  "}",
  "if (payload.resultPath) await writeFile(payload.resultPath, `${JSON.stringify(result)}\\n`, 'utf8');"
].join("\n");

async function runMatrixWorker(fixture, payload) {
  return runBoundedFixtureSubprocess(fixture.nodePath, [
    "--input-type=module", "-e", MATRIX_WORKER_SOURCE, fixture.lifecycleModuleUrl, JSON.stringify(payload)
  ], {
    allowedLiveIdentities: fixture.allowedLiveIdentities || [],
    environment: fixture.environment,
    fixtureRoot: fixture.root,
    postKillTimeoutMs: POST_KILL_TIMEOUT_MS,
    timeoutMs: MATRIX_SUBPROCESS_TIMEOUT_MS
  });
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

function fixtureRootFromEnvironment(environment) {
  const productionRoot = environment.MASTHEAD_PRODUCTION_ROOT;
  if (!productionRoot || !isAbsolute(productionRoot)) {
    throw new Error("Bounded production lifecycle subprocess requires an absolute isolated production root.");
  }
  return dirname(resolve(productionRoot));
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

export function formatRehearsalFailure(failure) {
  const messages = [];
  const visit = (value) => {
    const message = value instanceof Error ? value.message : String(value);
    if (message && !messages.includes(message)) messages.push(message);
    if (value instanceof AggregateError) {
      for (const nested of value.errors) visit(nested);
    } else if (value instanceof Error && value.cause !== undefined) {
      visit(value.cause);
    }
  };
  visit(failure);
  return messages.join("\nCaused by: ");
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
    process.stderr.write(`${formatRehearsalFailure(failure)}\n`);
    process.exitCode = 1;
  }
}
