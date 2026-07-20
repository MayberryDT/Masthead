import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const ACTIVE_ARTIFACTS = ["instance-active", "lifecycle-active", "desktop-active"];
const STAGE_ARTIFACTS = ["instance-stage", "lifecycle-stage", "desktop-stage"];

// This is deliberately literal. A generated contract could silently rename or replace
// a required crash boundary at the same time as the generated execution matrix.
const CRASH_BOUNDARIES = {
  "stage:candidate-copy:SIGKILL": stageBoundary(
    0,
    ["stage-intent", "candidate"],
    ["instance-stage", "lifecycle-stage", "desktop-stage", "pending-receipt", "receipt"]
  ),
  "stage:instance-stage:SIGKILL": stageBoundary(
    3,
    ["stage-intent", "candidate", "instance-stage"],
    ["lifecycle-stage", "desktop-stage", "pending-receipt", "receipt"]
  ),
  "stage:surface-stage:SIGKILL": stageBoundary(
    3,
    ["stage-intent", "candidate", ...STAGE_ARTIFACTS],
    ["pending-receipt", "receipt"]
  ),
  "stage:receipt-publication:SIGKILL": stageBoundary(
    3,
    ["stage-intent", "candidate", ...STAGE_ARTIFACTS, "pending-receipt", "receipt"],
    []
  ),
  "stage:intent-removal:SIGKILL": stageBoundary(
    null,
    ["candidate", ...STAGE_ARTIFACTS, "pending-receipt", "receipt"],
    ["stage-intent"]
  ),
  "activate:current:SIGKILL": activationBoundary(
    "before-current",
    ["candidate", "journal", "receipt-before", "journal-receipt-before", ...STAGE_ARTIFACTS],
    ["stage-intent", "pending-receipt", "receipt-after", "journal-receipt-after", ...ACTIVE_ARTIFACTS]
  ),
  "activate:instance-launcher:SIGKILL": activationBoundary(
    "before-instance-launcher",
    ["candidate", "journal", "receipt-before", "journal-receipt-before", ...STAGE_ARTIFACTS, "instance-active"],
    ["stage-intent", "pending-receipt", "receipt-after", "journal-receipt-after", "lifecycle-active", "desktop-active"]
  ),
  "activate:lifecycle-launcher:SIGKILL": activationBoundary(
    "before-lifecycle-launcher",
    ["candidate", "journal", "receipt-before", "journal-receipt-before", ...STAGE_ARTIFACTS, "instance-active", "lifecycle-active"],
    ["stage-intent", "pending-receipt", "receipt-after", "journal-receipt-after", "desktop-active"]
  ),
  "activate:desktop:SIGKILL": activationBoundary(
    "before-desktop",
    ["candidate", "journal", "receipt-before", "journal-receipt-before", ...STAGE_ARTIFACTS, ...ACTIVE_ARTIFACTS],
    ["stage-intent", "pending-receipt", "receipt-after", "journal-receipt-after"]
  ),
  "activate:activation-pre-commit:SIGKILL": activationBoundary(
    "before-activation-commit",
    ["candidate", "journal", "receipt-before", "journal-receipt-after", ...STAGE_ARTIFACTS, ...ACTIVE_ARTIFACTS],
    ["stage-intent", "pending-receipt", "receipt-after", "journal-receipt-before"]
  ),
  "activate:activation-commit:SIGKILL": activationBoundary(
    "activation-committed",
    ["candidate", "journal", "receipt-before", "journal-receipt-after", ...STAGE_ARTIFACTS, ...ACTIVE_ARTIFACTS],
    ["stage-intent", "pending-receipt", "receipt-after", "journal-receipt-before"]
  ),
  "activate:activation-receipt:SIGKILL": activationBoundary(
    "activation-committed",
    ["candidate", "journal", "receipt-after", "journal-receipt-after", ...STAGE_ARTIFACTS, ...ACTIVE_ARTIFACTS],
    ["stage-intent", "pending-receipt", "receipt-before", "journal-receipt-before"]
  ),
  "finalize:rollback-bundle:SIGKILL": finalizationBoundary("finalize-cleanup-after-artifact-<rollback-bundle-basename>", ["candidate", "receipt", "journal", ...STAGE_ARTIFACTS, ...ACTIVE_ARTIFACTS], ["rollback-bundle", "completion-marker"]),
  "finalize:rollback-bundle:exit": finalizationBoundary("finalize-cleanup-after-artifact-<rollback-bundle-basename>", ["candidate", "receipt", "journal", ...STAGE_ARTIFACTS, ...ACTIVE_ARTIFACTS], ["rollback-bundle", "completion-marker"]),
  "finalize:staged-0:SIGKILL": finalizationBoundary("finalize-cleanup-after-staged-0", ["candidate", "receipt", "journal", "lifecycle-stage", "desktop-stage", ...ACTIVE_ARTIFACTS], ["rollback-bundle", "instance-stage", "completion-marker"]),
  "finalize:staged-0:exit": finalizationBoundary("finalize-cleanup-after-staged-0", ["candidate", "receipt", "journal", "lifecycle-stage", "desktop-stage", ...ACTIVE_ARTIFACTS], ["rollback-bundle", "instance-stage", "completion-marker"]),
  "finalize:staged-1:SIGKILL": finalizationBoundary("finalize-cleanup-after-staged-1", ["candidate", "receipt", "journal", "desktop-stage", ...ACTIVE_ARTIFACTS], ["rollback-bundle", "instance-stage", "lifecycle-stage", "completion-marker"]),
  "finalize:staged-1:exit": finalizationBoundary("finalize-cleanup-after-staged-1", ["candidate", "receipt", "journal", "desktop-stage", ...ACTIVE_ARTIFACTS], ["rollback-bundle", "instance-stage", "lifecycle-stage", "completion-marker"]),
  "finalize:staged-2:SIGKILL": finalizationBoundary("finalize-cleanup-after-staged-2", ["candidate", "receipt", "journal", ...ACTIVE_ARTIFACTS], ["rollback-bundle", ...STAGE_ARTIFACTS, "completion-marker"]),
  "finalize:staged-2:exit": finalizationBoundary("finalize-cleanup-after-staged-2", ["candidate", "receipt", "journal", ...ACTIVE_ARTIFACTS], ["rollback-bundle", ...STAGE_ARTIFACTS, "completion-marker"]),
  "finalize:receipt:SIGKILL": finalizationBoundary("finalize-cleanup-after-receipt", ["candidate", "journal", "completion-marker", ...ACTIVE_ARTIFACTS], ["rollback-bundle", ...STAGE_ARTIFACTS, "receipt"]),
  "finalize:receipt:exit": finalizationBoundary("finalize-cleanup-after-receipt", ["candidate", "journal", "completion-marker", ...ACTIVE_ARTIFACTS], ["rollback-bundle", ...STAGE_ARTIFACTS, "receipt"]),
  "finalize:journal:SIGKILL": finalizationBoundary(null, ["candidate", "completion-marker", ...ACTIVE_ARTIFACTS], ["rollback-bundle", ...STAGE_ARTIFACTS, "receipt", "journal"]),
  "finalize:journal:exit": finalizationBoundary(null, ["candidate", "completion-marker", ...ACTIVE_ARTIFACTS], ["rollback-bundle", ...STAGE_ARTIFACTS, "receipt", "journal"])
};

function stageBoundary(ownedStageCount, present, absent) {
  return { current: "baseline", journalPhase: null, ownedStageCount, present, absent };
}

function activationBoundary(journalPhase, present, absent) {
  return { current: "candidate", journalPhase, present, absent };
}

function finalizationBoundary(journalPhase, present, absent) {
  return { current: "candidate", journalPhase, present, absent };
}

export function packageBoundCrashBoundaryContract() {
  return structuredClone(CRASH_BOUNDARIES);
}

export async function assertPackageBoundCrashBoundary(definition, fixture, receiptInput) {
  const expected = CRASH_BOUNDARIES[definition.id];
  if (!expected) throw new Error(`No durable crash-boundary contract exists for ${definition.id}.`);
  try {
    const state = await resolveBoundaryState(fixture, receiptInput);
    const expectedCurrent = expected.current === "baseline" ? fixture.baseline : state.receipt?.target ?? state.intent?.target;
    if (!expectedCurrent || await realpath(join(fixture.productionRoot, "current")) !== expectedCurrent) {
      throw new Error(`current did not point to ${expected.current}`);
    }
    const expectedJournalPhase = expected.journalPhase?.replace(
      "<rollback-bundle-basename>",
      state.receipt?.rollbackBundle?.path ? basename(state.receipt.rollbackBundle.path) : "<missing>"
    );
    if (expectedJournalPhase == null) {
      if (state.journal !== undefined) throw new Error(`journal existed with phase ${state.journal.phase ?? "missing"}`);
    } else if (state.journal?.phase !== expectedJournalPhase) {
      throw new Error(`journal phase was ${state.journal?.phase ?? "absent"}; expected ${expectedJournalPhase}`);
    }
    if (Object.hasOwn(expected, "ownedStageCount")) assertStageOwnershipContract(expected, state);
    for (const artifact of expected.present) await assertArtifact(artifact, true, state);
    for (const artifact of expected.absent) await assertArtifact(artifact, false, state);
  } catch (cause) {
    throw new Error(`Packaged lifecycle did not establish durable boundary ${definition.id}.`, { cause });
  }
}

async function resolveBoundaryState(fixture, receiptInput) {
  const intentPath = join(fixture.productionRoot, ".masthead-install-stage.intent.json");
  const pendingPath = join(fixture.productionRoot, ".masthead-install-stage.pending.json");
  const journalPath = join(fixture.productionRoot, ".masthead-install-activation.journal.json");
  const [intent, pending, journal] = await Promise.all([
    readJsonIfPresent(intentPath),
    readJsonIfPresent(pendingPath),
    readJsonIfPresent(journalPath)
  ]);
  const receiptPath = receiptInput?.receiptPath ?? pending?.receiptPath ?? intent?.receiptPath;
  const receipt = receiptInput ?? (receiptPath ? await readJsonIfPresent(receiptPath) : undefined);
  const target = receipt?.target ?? intent?.target;
  const stagePaths = {
    "instance-stage": receipt?.stagedInstanceLauncherPath ?? intent?.stagedInstanceLauncherPath,
    "lifecycle-stage": receipt?.stagedSurface?.launcherStage ?? intent?.launcherStage,
    "desktop-stage": receipt?.stagedSurface?.desktopStage ?? intent?.desktopStage
  };
  const activePaths = {
    "instance-active": receipt?.activeInstanceLauncherPath,
    "lifecycle-active": receipt?.stagedSurface?.launcherPath,
    "desktop-active": receipt?.stagedSurface?.desktopPath
  };
  const markerPath = receiptPath
    ? join(
      dirname(fixture.productionRoot),
      `.masthead-production-finalization-${createHash("sha256").update(fixture.productionRoot).digest("hex")}`,
      `${createHash("sha256").update(receiptPath).digest("hex")}.json`
    )
    : undefined;
  return {
    activePaths,
    fixture,
    intent,
    intentPath,
    journal,
    journalPath,
    markerPath,
    pending,
    pendingPath,
    receipt,
    receiptPath,
    stagePaths,
    target
  };
}

async function assertArtifact(name, shouldExist, state) {
  if (name === "receipt-before" || name === "receipt-after") {
    const record = state.receiptPath ? await readJsonIfPresent(state.receiptPath) : undefined;
    const matches = record !== undefined && (name === "receipt-after" ? hasActivatedAt(record) : !hasActivatedAt(record));
    if (matches !== shouldExist) throw new Error(`${name} was ${matches ? "present" : "absent"}`);
    return;
  }
  if (name === "journal-receipt-before" || name === "journal-receipt-after") {
    const matches = state.journal?.receipt !== undefined && (name === "journal-receipt-after" ? hasActivatedAt(state.journal.receipt) : !hasActivatedAt(state.journal.receipt));
    if (matches !== shouldExist) throw new Error(`${name} was ${matches ? "present" : "absent"}`);
    return;
  }
  const path = artifactPath(name, state);
  const exists = path ? await pathExists(path) : false;
  if (exists !== shouldExist) throw new Error(`${name} was ${exists ? "present" : "absent"}`);
  if (shouldExist && name in state.stagePaths) await assertStagedArtifactMatchesAuthority(name, state);
  if (shouldExist && name.endsWith("-active")) await assertActiveArtifactMatchesStage(name, state);
}

function assertStageOwnershipContract(expected, state) {
  if (expected.ownedStageCount === null) {
    if (state.intent !== undefined) throw new Error("stage intent remained after its removal boundary");
    return;
  }
  const ownedStages = state.intent?.ownedStages;
  if (!Array.isArray(ownedStages) || ownedStages.length !== expected.ownedStageCount) {
    throw new Error(`stage intent owned ${Array.isArray(ownedStages) ? ownedStages.length : "no"} stages; expected ${expected.ownedStageCount}`);
  }
  const expectedPaths = expected.ownedStageCount === 0 ? [] : Object.values(state.stagePaths);
  if (
    ownedStages.some((reservation, index) => reservation?.path !== expectedPaths[index]) ||
    ownedStages.some((reservation) => (
      reservation?.quarantinePath !== join(dirname(reservation.path), `.${basename(reservation.path)}.${state.intent.stagingNonce}.cleanup`) ||
      !/^[0-9a-f]{64}$/u.test(reservation.sha256 || "") ||
      !Number.isInteger(reservation.mode) || reservation.mode < 0 || reservation.mode > 0o777
    ))
  ) throw new Error("stage intent reservations did not exactly match their declared paths, hashes, and modes");
}

async function assertStagedArtifactMatchesAuthority(name, state) {
  const path = state.stagePaths[name];
  const intentReservation = state.intent?.ownedStages?.find((entry) => entry.path === path);
  const receiptAttestation = state.receipt?.stagedFiles?.find((entry) => entry.path === path);
  const authorities = [intentReservation, receiptAttestation].filter(Boolean);
  if (authorities.length === 0) throw new Error(`${name} had no durable ownership authority`);
  const info = await lstat(path, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) {
    throw new Error(`${name} was not a regular single-link file`);
  }
  const bodyHash = createHash("sha256").update(await readFile(path)).digest("hex");
  const mode = Number(info.mode & 0o777n);
  for (const authority of authorities) {
    if (authority.path !== path || authority.sha256 !== bodyHash || authority.mode !== mode) {
      throw new Error(
        `${name} did not match its durable path, hash, and mode authority: ` +
        `path=${authority.path === path}, hash=${authority.sha256 === bodyHash}, mode=${mode}/${authority.mode}`
      );
    }
  }
}

function artifactPath(name, state) {
  if (name === "stage-intent") return state.intentPath;
  if (name === "pending-receipt") return state.pendingPath;
  if (name === "receipt") return state.receiptPath;
  if (name === "journal") return state.journalPath;
  if (name === "candidate") return state.target;
  if (name === "rollback-bundle") return state.receipt?.rollbackBundle?.path;
  if (name === "completion-marker") return state.markerPath;
  if (name in state.stagePaths) return state.stagePaths[name];
  if (name in state.activePaths) return state.activePaths[name];
  throw new Error(`Unknown crash-boundary artifact ${name}.`);
}

async function assertActiveArtifactMatchesStage(name, state) {
  const stageName = name === "instance-active" ? "instance-stage" : name === "lifecycle-active" ? "lifecycle-stage" : "desktop-stage";
  const active = await readFile(state.activePaths[name]);
  const attestation = state.receipt?.stagedFiles?.find(({ path }) => path === state.stagePaths[stageName]);
  if (!attestation || createHash("sha256").update(active).digest("hex") !== attestation.sha256) {
    throw new Error(`${name} did not match ${stageName} attestation`);
  }
}

function hasActivatedAt(record) {
  return typeof record?.activatedAt === "string" && record.activatedAt.length > 0;
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
