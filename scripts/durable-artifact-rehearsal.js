#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, lstatSync, realpathSync } from "node:fs";
import {
  access,
  cp,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { verifyPackagedBundleManifest } from "./packaged-bundle-manifest.js";

export const REHEARSAL_PORT = 17483;
const REHEARSAL_ROOT_PREFIX = "masthead-durable-rehearsal-";
const STATE_VERSION = 1;
const EXPECTED_SCHEMA_VERSION = 24;
const EXPECTED_V1_ARTIFACTS = 1_283;
const EXPECTED_V1_RUNS = 66;
const DISCOVERY_PASSES = 13;
const CANDIDATE_DETECTOR_REVISION = 4;
const MAINTENANCE_TIMEOUT_MS = 43_200_000;
const HTTP_REQUEST_TIMEOUT_MS = 900_000;
const DAEMON_STOP_GRACE_MS = 30_000;

export function validateStaticRehearsalConfig(input) {
  const root = resolve(requiredString(input.root, "root"));
  const temporaryRoot = resolve(tmpdir());
  if (root === temporaryRoot) throw new Error("Rehearsal requires a dedicated temporary root");
  if (dirname(root) !== temporaryRoot) {
    throw new Error(`Rehearsal root must be a direct child of the temporary directory ${temporaryRoot}`);
  }
  const rootRelative = relative(temporaryRoot, root);
  if (!rootRelative || rootRelative === ".." || rootRelative.startsWith(`..${sep}`) || isAbsolute(rootRelative)) {
    throw new Error(`Rehearsal root must be inside the temporary directory ${temporaryRoot}`);
  }
  if (!basename(root).startsWith(REHEARSAL_ROOT_PREFIX)) {
    throw new Error(`Rehearsal root basename must start with ${REHEARSAL_ROOT_PREFIX}`);
  }

  const port = Number(input.port);
  if (port !== REHEARSAL_PORT) throw new Error(`Rehearsal must use isolated port ${REHEARSAL_PORT}`);
  const sourceBackup = resolve(requiredString(input.sourceBackup, "sourceBackup"));
  if (basename(sourceBackup) !== "masthead.sqlite.backup-current") {
    throw new Error("Source backup must be named masthead.sqlite.backup-current");
  }
  assertOutside(root, sourceBackup, "Source backup must remain outside the rehearsal root");

  const expectedBuildSha = requiredHash(input.expectedBuildSha, "expectedBuildSha", 40);
  const bundleRoot = resolve(requiredString(input.bundleRoot, "bundleRoot"));
  assertOutside(root, bundleRoot, "Packaged bundle must remain outside the writable rehearsal root");
  if (!basename(bundleRoot).endsWith(`-${expectedBuildSha.slice(0, 8)}`)) {
    throw new Error(`Packaged bundle path must end with immutable build suffix -${expectedBuildSha.slice(0, 8)}`);
  }
  const labelsPath = resolve(requiredString(input.labelsPath, "labelsPath"));
  const samplePath = resolve(requiredString(input.samplePath, "samplePath"));
  assertOutside(root, labelsPath, "Label receipt must remain outside the rehearsal root");
  assertOutside(root, samplePath, "Sample receipt must remain outside the rehearsal root");

  const daemonRoot = join(bundleRoot, "resources", "daemon");
  return {
    activeDatabase: join(root, "masthead.sqlite"),
    bundleRoot,
    cliEntry: join(daemonRoot, "dist", "src", "cli", "mastheadctl.js"),
    daemonEntry: join(daemonRoot, "dist", "src", "daemon", "main.js"),
    dossierEntry: join(daemonRoot, "dist", "src", "daemon", "db", "sessionDossierRepository.js"),
    expectedAuditHash: requiredHash(input.expectedAuditHash, "expectedAuditHash", 64),
    expectedBuildSha,
    expectedDatabaseId: requiredString(input.expectedDatabaseId, "expectedDatabaseId"),
    expectedLabelSha256: requiredHash(input.expectedLabelSha256, "expectedLabelSha256", 64),
    expectedSampleSha256: requiredHash(input.expectedSampleSha256, "expectedSampleSha256", 64),
    expectedSourceSha256: requiredHash(input.expectedSourceSha256, "expectedSourceSha256", 64),
    frozenDatabase: join(root, "frozen-v1", "masthead.sqlite"),
    labelsPath,
    mcpEntry: join(daemonRoot, "dist", "src", "mcp", "server.js"),
    nodePath: join(daemonRoot, process.platform === "win32" ? "node.exe" : "node"),
    port,
    recoveryBackup: join(root, "masthead.sqlite.backup-current"),
    root,
    samplePath,
    sourceBackup
  };
}

export function buildIsolatedDaemonEnv(config, cliCommand) {
  return {
    HOME: join(config.root, "home"),
    OPENAI_API_KEY: "",
    MASTHEAD_ALLOWED_ORIGINS: `http://127.0.0.1:${config.port}`,
    MASTHEAD_BACKGROUND_HYDRATION: "0",
    MASTHEAD_BUILD_SHA: config.expectedBuildSha,
    MASTHEAD_BUILD_VERSION: config.buildVersion ?? "",
    MASTHEAD_CLI_COMMAND: cliCommand,
    MASTHEAD_CODEX_HOME: join(config.root, "codex-home"),
    MASTHEAD_DATA_DIR: config.root,
    MASTHEAD_DB_PATH: config.activeDatabase,
    MASTHEAD_GIT_REFRESH_MS: "0",
    MASTHEAD_HOOK_TRANSCRIPT_CATCHUP: "0",
    MASTHEAD_HOST: "127.0.0.1",
    MASTHEAD_LIVE_COPY: "0",
    MASTHEAD_LLM_COPY: "0",
    MASTHEAD_MCP_COMMAND: config.nodePath,
    MASTHEAD_MCP_ENTRY: config.mcpEntry,
    MASTHEAD_PORT: String(config.port),
    MASTHEAD_REMOTE_ENRICHMENT: "0",
    MASTHEAD_SKIP_BACKGROUND_HYDRATION: "1",
    MASTHEAD_STORE_PATH: join(config.root, "legacy", "events.ndjson")
  };
}

export function evaluateCandidateLabels(labels, candidates) {
  const discovered = new Set();
  for (const candidate of candidates) {
    for (const sessionId of normalizedStrings(candidate.provenanceSessionIds)) {
      discovered.add(`${sessionId}\u0000${candidate.kind}`);
    }
  }
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  const units = labels.map((label) => {
    const key = `${label.sessionId}\u0000${label.kind}`;
    const discoveredCandidate = discovered.has(key);
    const expectedCandidate = label.expectedCandidate === true;
    if (expectedCandidate && discoveredCandidate) truePositive += 1;
    else if (!expectedCandidate && discoveredCandidate) falsePositive += 1;
    else if (expectedCandidate) falseNegative += 1;
    else trueNegative += 1;
    return { discoveredCandidate, expectedCandidate, kind: label.kind, sessionId: label.sessionId };
  });
  const recallDenominator = truePositive + falseNegative;
  const precisionDenominator = truePositive + falsePositive;
  return {
    falseNegative,
    falsePositive,
    precision: precisionDenominator === 0 ? 0 : truePositive / precisionDenominator,
    recall: recallDenominator === 0 ? 0 : truePositive / recallDenominator,
    total: labels.length,
    trueNegative,
    truePositive,
    units
  };
}

export function selectCanaryCandidates(candidates, frozenSessionIds) {
  return candidates
    .filter((candidate) => normalizedStrings(candidate.provenanceSessionIds).some((id) => frozenSessionIds.has(id)))
    .toSorted((left, right) => String(left.candidateId).localeCompare(String(right.candidateId)));
}

export function assertDiscoveryCompletion(report, expectedSessions = EXPECTED_V1_ARTIFACTS) {
  if (report.eligibleSessions !== expectedSessions || report.currentScans !== expectedSessions) {
    throw new Error(
      `candidate discovery incomplete: expected ${expectedSessions}, eligible ${report.eligibleSessions}, current scans ${report.currentScans}`
    );
  }
  return report;
}

export function classifyPreparedInvalidationState(counts) {
  const baseline = {
    artifacts: EXPECTED_V1_ARTIFACTS,
    candidates: 0,
    provenance: EXPECTED_V1_ARTIFACTS,
    runs: EXPECTED_V1_RUNS,
    searchRows: EXPECTED_V1_ARTIFACTS,
    sessions: EXPECTED_V1_ARTIFACTS
  };
  const invalidated = {
    artifacts: 0,
    candidates: 0,
    provenance: 0,
    runs: EXPECTED_V1_RUNS,
    searchRows: 0,
    sessions: EXPECTED_V1_ARTIFACTS
  };
  if (exactFieldsMatch(counts, baseline)) return "ready";
  if (exactFieldsMatch(counts, invalidated)) return "committed";
  throw new Error("Prepared invalidation state is neither the exact V1 baseline nor the exact committed invalidation");
}

export function validateDaemonCloseResult(result, requestedStop) {
  const close = record(result, "isolated daemon close result");
  if (requestedStop !== true) {
    throw new Error(`Isolated daemon exited before coordinator shutdown: code=${close.code} signal=${close.signal}`);
  }
  const cleanExit = close.code === 0 && (close.signal === null || close.signal === undefined);
  if (!cleanExit) {
    throw new Error(`Isolated daemon shutdown failed: code=${close.code} signal=${close.signal}`);
  }
  return close;
}

export function validateHumanReviewReceipt(value, expected) {
  const receipt = record(value, "human review receipt");
  if (receipt.receiptVersion !== 1 || receipt.reviewerKind !== "human") {
    throw new Error("Rehearsal requires a receipt signed by a real human");
  }
  assertEqual(receipt.machineReportSha256, expected.machineReportSha256, "human review machine-report binding");
  assertEqual(receipt.packetSha256, expected.packetSha256, "human review packet binding");
  assertEqual(receipt.reviewSetSha256, expected.reviewSetSha256, "human review set binding");
  requiredString(receipt.reviewer, "reviewer");
  requireIsoTimestamp(receipt.signedAt, "signedAt");
  const dossiers = reviewRows(receipt.dossiers, "dossiers");
  const optionalArtifacts = reviewRows(receipt.optionalArtifacts, "optionalArtifacts");
  assertExactIds(dossiers.map((row) => row.artifactId), expected.dossierArtifactIds, "dossier review coverage mismatch");
  assertExactIds(
    optionalArtifacts.map((row) => row.artifactId),
    expected.optionalArtifactIds,
    "optional artifact review coverage mismatch"
  );
  const means = [...dossiers, ...optionalArtifacts].map((row) => row.overall);
  const minimumOverall = Math.min(...means);
  const medianOverall = roundedMedian(means);
  if (minimumOverall < 3) throw new Error(`Human review stop condition: minimum overall ${minimumOverall}`);
  if (medianOverall < 4) throw new Error(`Human review stop condition: median overall ${medianOverall}`);
  return { dossiers, medianOverall, minimumOverall, optionalArtifacts, reviewer: receipt.reviewer, signedAt: receipt.signedAt };
}

function reviewRows(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value.map((entry, index) => {
    const row = record(entry, `${field}[${index}]`);
    const artifactId = requiredString(row.artifactId, `${field}[${index}].artifactId`);
    const scores = record(row.scores, `${field}[${index}].scores`);
  const values = ["findability", "grounding", "reusability", "specificity", "readability"].map((axis) => {
      const score = scores[axis];
      if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error(`${artifactId} ${axis} score must be 1-5`);
      if (score < 4) {
        const notes = row.notes && typeof row.notes === "object" && !Array.isArray(row.notes) ? row.notes : {};
        requiredString(notes[axis], `${artifactId} ${axis} note`);
      }
      return score;
    });
    return { artifactId, overall: round(values.reduce((sum, score) => sum + score, 0) / values.length), scores };
  });
}

function roundedMedian(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

async function runCli(argv) {
  const phase = argv[0];
  const options = parseOptions(argv.slice(1));
  if (!phase || phase === "help" || phase === "--help") return { ok: true, help: rehearsalHelp() };
  if (phase === "preflight") return runPreflight(options);
  if (phase === "stage") return runStage(options);
  if (phase === "migrate-invalidate") return runMigrateInvalidate(options);
  if (phase === "publish-discover") return runPublishDiscover(options);
  if (phase === "serve-authoring") return runServeAuthoring(options);
  if (phase === "verify") return runVerify(options);
  if (phase === "human-review") return runHumanReview(options);
  if (phase === "restore") return runRestore(options);
  throw new Error(`Unknown rehearsal phase: ${phase}`);
}

async function runPreflight(options) {
  const config = validateStaticRehearsalConfig(configFromOptions(options));
  const evidence = await preflightConfig(config, { rootMustBeEmpty: true });
  return {
    ok: true,
    phase: "preflight",
    productionAccessed: false,
    root: config.root,
    sourceReadOnly: true,
    ...evidence
  };
}

async function runStage(options) {
  requireConfirmation(options);
  const config = validateStaticRehearsalConfig(configFromOptions(options));
  const preflight = await preflightConfig(config, { rootMustBeEmpty: true });
  const resolvedConfig = { ...config, buildVersion: preflight.buildVersion, bundleDigest: preflight.bundleDigest };
  await mkdir(config.root, { recursive: true, mode: 0o700 });
  await assertPrivateOwnedDirectory(config.root, "rehearsal root");
  await mkdir(join(config.root, "evidence"), { recursive: true, mode: 0o700 });
  await mkdir(dirname(config.frozenDatabase), { recursive: true, mode: 0o700 });
  await mkdir(join(config.root, "private"), { recursive: true, mode: 0o700 });
  await mkdir(join(config.root, "bin"), { recursive: true, mode: 0o700 });
  await mkdir(join(config.root, "home"), { recursive: true, mode: 0o700 });
  await mkdir(join(config.root, "codex-home"), { recursive: true, mode: 0o700 });
  await mkdir(join(config.root, "legacy"), { recursive: true, mode: 0o700 });
  const layoutIdentities = await assertRehearsalLayout(resolvedConfig);
  resolvedConfig.layoutIdentities = layoutIdentities;
  const cliCommand = await writeIsolatedCliLauncher(resolvedConfig);
  const cliSha256 = await hashFile(cliCommand);

  // Never SQLite-open the production backup. Even a read-only SQLite open can
  // create WAL/SHM sidecars beside a WAL-mode database. Copy bytes first, and
  // treat an audit of that exact-hash temporary copy as the source-byte audit.
  const sourceBefore = await immutableFileIdentity(config.sourceBackup);
  resolvedConfig.sourceIdentity = sourceBefore;
  await copyFile(config.sourceBackup, config.activeDatabase, constants.COPYFILE_EXCL);
  await assertFileHash(config.activeDatabase, config.expectedSourceSha256, "active schema-21 copy");
  await assertNoSidecars(config.activeDatabase);
  const activeAudit = await runMaintenance(resolvedConfig, [
    "workbench", "audit-v1-generation", "--db", config.activeDatabase, "--json"
  ]);
  assertV1Audit(activeAudit.audit, resolvedConfig);
  await assertNoSidecars(config.activeDatabase);
  assertEqual(readDatabaseIdentity(config.activeDatabase), config.expectedDatabaseId, "copied source database ID");
  validateLabelEvidenceRefs(config.activeDatabase, await readJson(config.labelsPath));
  await writeEvidence(resolvedConfig, "01-source-byte-audit.json", {
    audit: activeAudit.audit,
    databasePath: config.activeDatabase,
    ok: true,
    sourceBackup: config.sourceBackup,
    sourceOpenedBySqlite: false,
    sourceSha256: config.expectedSourceSha256
  });

  await rename(config.activeDatabase, config.frozenDatabase);
  await copyFile(config.frozenDatabase, config.activeDatabase, constants.COPYFILE_EXCL);
  await assertFileHash(config.frozenDatabase, config.expectedSourceSha256, "frozen schema-21 copy");
  await assertFileHash(config.activeDatabase, config.expectedSourceSha256, "restaged schema-21 copy");
  await assertNoSidecars(config.frozenDatabase);
  await assertNoSidecars(config.activeDatabase);
  const frozenAudit = await runMaintenance(resolvedConfig, [
    "workbench", "audit-v1-generation", "--db", config.frozenDatabase, "--json"
  ]);
  const restagedAudit = await runMaintenance(resolvedConfig, [
    "workbench", "audit-v1-generation", "--db", config.activeDatabase, "--json"
  ]);
  assertV1Audit(frozenAudit.audit, resolvedConfig);
  assertV1Audit(restagedAudit.audit, resolvedConfig);
  await assertNoSidecars(config.frozenDatabase);
  await assertNoSidecars(config.activeDatabase);
  await assertSourceUnchanged(config, sourceBefore);
  await assertWritableDatabaseIsolation(resolvedConfig);
  await writeEvidence(resolvedConfig, "02-staged-audits.json", {
    activeAudit,
    frozenAudit,
    sourceByteAudit: activeAudit,
    sourceOpenedBySqlite: false
  });

  const state = {
    stateVersion: STATE_VERSION,
    phase: "staged",
    config: stateConfig(resolvedConfig),
    cliCommand,
    cliSha256,
    createdAt: new Date().toISOString(),
    evidence: {
      bundleDigest: preflight.bundleDigest,
      labelSha256: preflight.labelSha256,
      sampleSha256: preflight.sampleSha256,
      sourceIdentity: sourceBefore,
      sourceSha256: preflight.sourceSha256
    },
    layoutIdentities
  };
  await writeState(resolvedConfig, state);
  return { ok: true, phase: state.phase, root: config.root, sourceReadOnly: true };
}

function validateFrozenReceipts(sampleValue, labelsValue, config) {
  const sample = record(sampleValue, "sample receipt");
  const labels = record(labelsValue, "label receipt");
  if (sample.sourceDatabaseId !== config.expectedDatabaseId || labels.sourceDatabaseId !== config.expectedDatabaseId) {
    throw new Error("Frozen receipt database identity mismatch");
  }
  if (sample.receiptVersion !== 1 || labels.receiptVersion !== 1 || labels.createdBeforeDiscovery !== true) {
    throw new Error("Frozen sample/label receipt metadata is invalid");
  }
  assertEqual(labels.sampleReceiptSha256, config.expectedSampleSha256, "label-to-sample SHA-256 binding");
  if (!Array.isArray(sample.rows) || sample.rows.length !== 25) throw new Error("Sample receipt must contain exactly 25 rows");
  if (!Array.isArray(labels.rows) || labels.rows.length !== 75) throw new Error("Label receipt must contain exactly 75 rows");
  const sampleIds = new Set(sample.rows.map((row) => requiredString(row?.sessionId, "sample sessionId")));
  if (sampleIds.size !== 25) throw new Error("Sample receipt session IDs must be unique");
  const sampleKeyMap = Object.fromEntries(sample.rows.map((row) => [
    requiredString(row?.key, "sample key"),
    requiredString(row?.sessionId, "sample sessionId")
  ]));
  if (Object.keys(sampleKeyMap).length !== 25) throw new Error("Sample receipt keys must be unique");
  if (JSON.stringify(sortDeep(labels.sample)) !== JSON.stringify(sortDeep(sampleKeyMap))) {
    throw new Error("Frozen label receipt sample mapping does not match the sample receipt");
  }
  const labelKeys = new Set();
  for (const rowValue of labels.rows) {
    const row = record(rowValue, "label row");
    const sessionId = requiredString(row.sessionId, "label sessionId");
    const kind = requiredString(row.kind, "label kind");
    if (!sampleIds.has(sessionId)) throw new Error(`Label session is outside frozen sample: ${sessionId}`);
    if (!new Set(["runbook", "adr", "incident_timeline"]).has(kind)) throw new Error(`Invalid label kind: ${kind}`);
    const key = `${sessionId}\u0000${kind}`;
    if (labelKeys.has(key)) throw new Error(`Duplicate frozen label: ${sessionId}/${kind}`);
    labelKeys.add(key);
    if (typeof row.expectedCandidate !== "boolean") throw new Error(`Label expectedCandidate must be boolean: ${key}`);
    if (row.expectedCandidate === true && (!Array.isArray(row.evidenceRefs) || row.evidenceRefs.length === 0)) {
      throw new Error(`Positive frozen label requires evidence refs: ${key}`);
    }
    requiredString(row.rationale, "label rationale");
    requiredString(row.reviewer, "label reviewer");
  }
  if (labelKeys.size !== 75) throw new Error("Frozen labels do not cover exactly 75 units");
}

function assertV1Audit(auditValue, config) {
  const audit = record(auditValue, "failed V1 audit");
  const exact = {
    adrs: 0,
    auditHash: config.expectedAuditHash,
    contractVersion: "workbench-authoring-v1",
    dossiers: EXPECTED_V1_ARTIFACTS,
    incidentTimelines: 0,
    runbooks: 0,
    totalArtifacts: EXPECTED_V1_ARTIFACTS,
    totalRuns: EXPECTED_V1_RUNS,
    totalSessions: EXPECTED_V1_ARTIFACTS
  };
  for (const [field, expected] of Object.entries(exact)) assertEqual(audit[field], expected, `V1 audit ${field}`);
  return audit;
}

async function writeIsolatedCliLauncher(config) {
  if (process.platform === "win32") throw new Error("This production rehearsal coordinator currently requires POSIX");
  const path = join(config.root, "bin", "mastheadctl");
  const source = isolatedCliLauncherSource(config);
  await writeFile(path, source, { encoding: "utf8", mode: 0o700, flag: "wx" });
  return path;
}

function isolatedCliLauncherSource(config) {
  return [
    "#!/bin/sh",
    `exec env MASTHEAD_DAEMON_URL=${shellQuote(baseUrl(config))} ${shellQuote(config.nodePath)} ${shellQuote(config.cliEntry)} \"$@\"`,
    ""
  ].join("\n");
}

async function runMigrateInvalidate(options) {
  requireConfirmation(options);
  const { config, state } = await loadState(options);
  assertPhase(state, ["staged", "prepared"]);
  await assertFileHash(config.frozenDatabase, config.expectedSourceSha256, "frozen schema-21 copy");
  let preparedState = state;
  if (state.phase === "staged") {
    // Re-running the corrected daemon is safe whether the active copy is still
    // schema 21 or a previous attempt already completed its schema-24 migration.
    // The exact V1 audit fails closed if invalidation or any other mutation ran.
    await assertNoSidecars(config.activeDatabase);
    const preMigrationAudit = await runMaintenance(config, [
      "workbench", "audit-v1-generation", "--db", config.activeDatabase, "--json"
    ]);
    assertV1Audit(preMigrationAudit.audit, config);
    await assertNoSidecars(config.activeDatabase);
    assertEqual(readDatabaseIdentity(config.activeDatabase), config.expectedDatabaseId, "preparation active database ID");

    let daemon;
    let health;
    let capabilities;
    const sample = await readJson(config.samplePath);
    const sampleSessionIds = sample.rows.map((row) => requiredString(row.sessionId, "sample sessionId"));
    try {
      daemon = await startIsolatedDaemon(config, state.cliCommand, "migration");
      health = daemon.health;
      capabilities = await getJson(config, "/workbench/authoring/capabilities");
      assertCapabilities(capabilities, config, state.cliCommand);
    } finally {
      if (daemon) await stopDaemon(daemon);
    }

    await assertNoSidecars(config.activeDatabase);
    const originals = await captureOriginalDossiers(config, sampleSessionIds);
    await writeJsonAtomic(join(config.root, "private", "original-dossiers.json"), originals, 0o600);
    const prepared = await runMaintenance(config, [
      "workbench", "prepare-v1-recovery", "--db", config.activeDatabase, "--json"
    ]);
    assertV1Audit(prepared.audit, config);
    const backup = record(prepared.backup, "prepare recovery backup");
    assertEqual(resolve(requiredString(backup.backupPath, "backupPath")), config.recoveryBackup, "recovery backup path");
    assertEqual(backup.databaseId, config.expectedDatabaseId, "recovery backup database ID");
    assertEqual(backup.integrityResult, "ok", "recovery backup integrity");
    if (!(Number(backup.sizeBytes) > 0) || !(Number(backup.pagesCopied) > 0)) {
      throw new Error("Recovery backup size/pages must be positive");
    }
    await assertOnlyRecoveryBackup(config);
    await assertNoSidecars(config.activeDatabase);
    await assertNoSidecars(config.recoveryBackup);

    const [activeAudit, recoveryAudit] = await Promise.all([
      runMaintenance(config, ["workbench", "audit-v1-generation", "--db", config.activeDatabase, "--json"]),
      runMaintenance(config, ["workbench", "audit-v1-generation", "--db", config.recoveryBackup, "--json"])
    ]);
    assertV1Audit(activeAudit.audit, config);
    assertV1Audit(recoveryAudit.audit, config);
    await assertNoSidecars(config.activeDatabase);
    const activeLedger = readMigrationLedger(config.activeDatabase);
    await assertNoSidecars(config.recoveryBackup);
    const recoveryLedger = readMigrationLedger(config.recoveryBackup);
    assertCurrentLedger(activeLedger);
    assertCurrentLedger(recoveryLedger);
    await assertNoSidecars(config.activeDatabase);
    const activeWholeDatabase = readWholeDatabaseCounts(config.activeDatabase);
    await assertNoSidecars(config.recoveryBackup);
    const recoveryWholeDatabase = readWholeDatabaseCounts(config.recoveryBackup);
    assertWholeDatabaseBaseline(activeWholeDatabase, "migrated active");
    assertWholeDatabaseBaseline(recoveryWholeDatabase, "schema-24 recovery backup");
    const originalDossiersSha256 = await hashFile(join(config.root, "private", "original-dossiers.json"));
    const backupSha256 = await hashFile(config.recoveryBackup);
    const backupIdentity = await immutableFileIdentity(config.recoveryBackup);
    await writeEvidence(config, "03-migration-and-prepare.json", {
      activeAudit,
      activeLedger,
      activeWholeDatabase,
      capabilities,
      health,
      prepared,
      recoveryAudit,
      recoveryLedger,
      recoveryWholeDatabase
    });

    // This checkpoint is persisted before the invalidation command is even
    // constructed. A crash from here onward can always restore from the bound
    // recovery snapshot or resume the exact atomic invalidation.
    preparedState = {
      ...state,
      phase: "prepared",
      updatedAt: new Date().toISOString(),
      preparation: {
        auditHash: config.expectedAuditHash,
        backup: prepared.backup,
        backupIdentity,
        backupSha256,
        originalDossiersSha256,
        schemaVersion: EXPECTED_SCHEMA_VERSION
      }
    };
    await writeState(config, preparedState);
  }

  const invalidationState = await verifyPreparedCheckpoint(config, preparedState);
  let invalidated;
  if (invalidationState === "ready") {
    invalidated = await runMaintenance(config, [
      "workbench",
      "invalidate-v1-generation",
      "--db",
      config.activeDatabase,
      "--audit-hash",
      config.expectedAuditHash,
      "--confirm",
      "--json"
    ]);
    assertInvalidationReceipt(invalidated.receipt, config);
  } else {
    invalidated = {
      databasePath: config.activeDatabase,
      ok: true,
      receipt: readCommittedInvalidationReceipt(config.activeDatabase, config),
      resumedAfterCommittedInvalidation: true
    };
  }
  await assertNoSidecars(config.activeDatabase);
  const invalidatedWholeDatabase = readWholeDatabaseCounts(config.activeDatabase);
  assertInvalidatedWholeDatabase(invalidatedWholeDatabase);
  await writeEvidence(config, "04-invalidation.json", { ...invalidated, invalidatedWholeDatabase });
  const nextState = {
    ...preparedState,
    phase: "invalidated",
    updatedAt: new Date().toISOString(),
    invalidation: {
      receipt: invalidated.receipt,
      schemaVersion: EXPECTED_SCHEMA_VERSION
    }
  };
  await writeState(config, nextState);
  return { ok: true, phase: nextState.phase, root: config.root, productionAccessed: false };
}

async function verifyPreparedCheckpoint(config, state) {
  const preparation = record(state.preparation, "prepared recovery checkpoint");
  assertEqual(preparation.auditHash, config.expectedAuditHash, "prepared checkpoint audit hash");
  assertEqual(preparation.schemaVersion, EXPECTED_SCHEMA_VERSION, "prepared checkpoint schema version");
  const backupSha256 = requiredHash(preparation.backupSha256, "prepared checkpoint backupSha256", 64);
  const originalDossiersSha256 = requiredHash(
    preparation.originalDossiersSha256,
    "prepared checkpoint originalDossiersSha256",
    64
  );
  const backupIdentity = record(preparation.backupIdentity, "prepared checkpoint backup identity");
  await assertOnlyRecoveryBackup(config);
  await assertNoSidecars(config.activeDatabase);
  await assertNoSidecars(config.recoveryBackup);
  await assertImmutableFileIdentity(config.recoveryBackup, backupIdentity, "prepared recovery backup");
  await assertFileHash(config.recoveryBackup, backupSha256, "prepared recovery backup");
  await assertFileHash(
    join(config.root, "private", "original-dossiers.json"),
    originalDossiersSha256,
    "prepared original dossiers"
  );
  const recoveryAudit = await runMaintenance(config, [
    "workbench", "audit-v1-generation", "--db", config.recoveryBackup, "--json"
  ]);
  assertV1Audit(recoveryAudit.audit, config);
  await assertNoSidecars(config.recoveryBackup);
  assertEqual(readDatabaseIdentity(config.recoveryBackup), config.expectedDatabaseId, "prepared recovery database ID");
  await assertNoSidecars(config.recoveryBackup);
  assertCurrentLedger(readMigrationLedger(config.recoveryBackup));
  await assertNoSidecars(config.recoveryBackup);
  assertWholeDatabaseBaseline(readWholeDatabaseCounts(config.recoveryBackup), "prepared recovery backup");

  await assertNoSidecars(config.activeDatabase);
  assertEqual(readDatabaseIdentity(config.activeDatabase), config.expectedDatabaseId, "prepared active database ID");
  await assertNoSidecars(config.activeDatabase);
  assertCurrentLedger(readMigrationLedger(config.activeDatabase));
  await assertNoSidecars(config.activeDatabase);
  assertEqual(readDatabaseIntegrity(config.activeDatabase), "ok", "prepared active database integrity");
  await assertNoSidecars(config.activeDatabase);
  const stateKind = classifyPreparedInvalidationState(readWholeDatabaseCounts(config.activeDatabase));
  if (stateKind === "ready") {
    const activeAudit = await runMaintenance(config, [
      "workbench", "audit-v1-generation", "--db", config.activeDatabase, "--json"
    ]);
    assertV1Audit(activeAudit.audit, config);
  } else {
    await assertNoSidecars(config.activeDatabase);
    assertInvalidationReceipt(readCommittedInvalidationReceipt(config.activeDatabase, config), config);
  }
  return stateKind;
}

function readCommittedInvalidationReceipt(databasePath, config) {
  const db = openImmutableDatabase(databasePath);
  try {
    const activities = db.prepare(
      `SELECT activity_id AS activityId, event_at AS eventAt, actor_kind AS actorKind,
              actor_id AS actorId, details_json AS detailsJson
       FROM workbench_activity
       WHERE event_type = 'failed_v1_generation_recovered'`
    ).all();
    if (activities.length !== 1) {
      throw new Error(`Committed invalidation must have exactly one recovery activity; found ${activities.length}`);
    }
    const activity = record(activities[0], "committed invalidation activity");
    assertEqual(activity.actorKind, "system", "committed invalidation actor kind");
    assertEqual(activity.actorId, "mastheadctl", "committed invalidation actor ID");
    const details = record(JSON.parse(requiredString(activity.detailsJson, "committed invalidation details")), "committed invalidation details");
    assertEqual(details.auditHash, config.expectedAuditHash, "committed invalidation audit hash");
    assertEqual(details.artifactCount, EXPECTED_V1_ARTIFACTS, "committed invalidation artifact count");
    assertEqual(details.sessionCount, EXPECTED_V1_ARTIFACTS, "committed invalidation session count");
    if (!Array.isArray(details.runIds) || new Set(details.runIds).size !== EXPECTED_V1_RUNS) {
      throw new Error("Committed invalidation activity must bind all 66 V1 runs exactly once");
    }
    const resetPipelines = Number(db.prepare(
      `SELECT COUNT(*) AS count
       FROM workbench_session_state
       WHERE publication_status = 'publish_path'
         AND next_action = 'create_dossier'
         AND session_dossier_status = 'missing'
         AND bug_fix_trace_status = 'unknown'
         AND runbook_status = 'unknown'
         AND adr_status = 'unknown'
         AND incident_timeline_status = 'unknown'
         AND session_package_status = 'missing'
         AND resolution_status = 'in_progress'
         AND non_publication_reason IS NULL
         AND published_at IS NULL
         AND published_activity_id IS NULL`
    ).get().count);
    assertEqual(resetPipelines, EXPECTED_V1_ARTIFACTS, "committed invalidation reset pipelines");
    const claimsReleased = Number(db.prepare(
      `SELECT COUNT(*) AS count FROM workbench_claims
       WHERE release_reason = 'failed_v1_generation_recovery' AND released_at = ?`
    ).get(requiredString(activity.eventAt, "committed invalidation event time")).count);
    const receipt = {
      activityId: requiredString(activity.activityId, "committed invalidation activity ID"),
      artifactsInvalidated: EXPECTED_V1_ARTIFACTS,
      auditHash: config.expectedAuditHash,
      claimsReleased,
      provenanceDeleted: EXPECTED_V1_ARTIFACTS,
      recoveryBackup: details.recoveryBackup,
      searchRowsDeleted: EXPECTED_V1_ARTIFACTS,
      sessionsReset: EXPECTED_V1_ARTIFACTS
    };
    assertInvalidationReceipt(receipt, config);
    return receipt;
  } finally {
    db.close();
  }
}

function assertInvalidationReceipt(value, config) {
  const receipt = record(value, "invalidation receipt");
  const exact = {
    artifactsInvalidated: EXPECTED_V1_ARTIFACTS,
    auditHash: config.expectedAuditHash,
    provenanceDeleted: EXPECTED_V1_ARTIFACTS,
    searchRowsDeleted: EXPECTED_V1_ARTIFACTS,
    sessionsReset: EXPECTED_V1_ARTIFACTS
  };
  for (const [field, expected] of Object.entries(exact)) assertEqual(receipt[field], expected, `invalidation ${field}`);
  if (!Number.isInteger(receipt.claimsReleased) || receipt.claimsReleased < 0) {
    throw new Error("invalidation claimsReleased must be a non-negative integer");
  }
  const recovery = record(receipt.recoveryBackup, "invalidation recovery backup");
  assertEqual(resolve(requiredString(recovery.backupPath, "recovery backup path")), config.recoveryBackup, "invalidation recovery backup path");
  assertEqual(recovery.databaseId, config.expectedDatabaseId, "invalidation recovery database ID");
  assertEqual(recovery.auditHash, config.expectedAuditHash, "invalidation recovery audit hash");
  assertEqual(recovery.integrityResult, "ok", "invalidation recovery integrity");
  assertEqual(recovery.backupPreserved, true, "invalidation recovery preservation");
  assertEqual(recovery.artifacts, EXPECTED_V1_ARTIFACTS, "invalidation recovery artifacts");
  assertEqual(recovery.runs, EXPECTED_V1_RUNS, "invalidation recovery runs");
  assertEqual(recovery.sessions, EXPECTED_V1_ARTIFACTS, "invalidation recovery sessions");
  return receipt;
}

async function startIsolatedDaemon(config, cliCommand, label) {
  await assertRootIdentity(config.root, config.rootIdentity, { optional: config.rootIdentity === undefined });
  if (config.layoutIdentities) await assertRehearsalLayout(config, config.layoutIdentities);
  await assertWritableDatabaseIsolation(config);
  await assertNoSidecars(config.activeDatabase);
  await assertPortAvailable(config.port);
  const logPath = join(config.root, "evidence", `daemon-${label}.log`);
  const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
  const child = spawn(config.nodePath, [config.daemonEntry], {
    cwd: config.root,
    env: { ...sanitizedBaseEnv(), ...buildIsolatedDaemonEnv(config, cliCommand) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  try {
    const health = await waitForHealth(config, child);
    assertHealth(health, config);
    return { child, health, log, logPath };
  } catch (error) {
    try {
      await stopDaemon({ child, log });
    } catch (shutdownError) {
      throw new AggregateError([error, shutdownError], "Isolated daemon startup and shutdown both failed");
    }
    throw error;
  }
}

async function stopDaemon(instance) {
  const { child, log } = instance;
  let closeResult;
  let closeFailure;
  if (child.exitCode === null && child.signalCode === null) {
    const closed = new Promise((resolvePromise, reject) => {
      child.once("close", (code, signal) => resolvePromise({ code, signal }));
      child.once("error", reject);
    });
    if (!child.kill("SIGTERM")) {
      closeResult = await closed;
      try {
        validateDaemonCloseResult(closeResult, false);
      } catch (error) {
        closeFailure = error;
      }
    } else {
      const graceful = await Promise.race([
        closed.then((result) => ({ result, timedOut: false })),
        delay(DAEMON_STOP_GRACE_MS).then(() => ({ timedOut: true }))
      ]);
      if (graceful.timedOut) {
        const killSent = child.kill("SIGKILL");
        closeResult = await closed;
        closeFailure = new Error(
          killSent
            ? `Isolated daemon ${child.pid} ignored SIGTERM for 30 seconds and required SIGKILL; the rehearsal phase is failed`
            : `Isolated daemon ${child.pid} exceeded the SIGTERM grace period and exited during bounded cleanup; the rehearsal phase is failed`
        );
      } else {
        closeResult = graceful.result;
        try {
          validateDaemonCloseResult(closeResult, true);
        } catch (error) {
          closeFailure = error;
        }
      }
    }
  } else {
    closeResult = { code: child.exitCode, signal: child.signalCode };
    try {
      validateDaemonCloseResult(closeResult, false);
    } catch (error) {
      closeFailure = error;
    }
  }
  await finishWritableLog(log);
  await assertPortAvailable(REHEARSAL_PORT);
  if (closeFailure) throw closeFailure;
  return closeResult;
}

async function finishWritableLog(log) {
  if (!log || log.writableFinished) return;
  await new Promise((resolvePromise, reject) => {
    log.once("finish", resolvePromise);
    log.once("error", reject);
    log.end();
  });
}

async function waitForHealth(config, child) {
  const deadline = Date.now() + MAINTENANCE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Isolated daemon exited before health: code=${child.exitCode} signal=${child.signalCode}`);
    }
    try {
      const response = await fetch(`${baseUrl(config)}/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return await response.json();
    } catch {
      // Migration and full verification can take hours on the production-sized copy.
    }
    await delay(1_000);
  }
  throw new Error("Isolated daemon did not become healthy within the twelve-hour maintenance ceiling");
}

function assertHealth(value, config) {
  const health = record(value, "health receipt");
  assertEqual(health.ok, true, "health ok");
  assertEqual(health.product, "masthead", "health product");
  assertEqual(health.schemaVersion, EXPECTED_SCHEMA_VERSION, "health schema version");
  assertEqual(health.buildSha, config.expectedBuildSha, "health build SHA");
  const data = record(health.data, "health data");
  assertEqual(resolve(requiredString(data.databasePath, "health database path")), config.activeDatabase, "health database path");
  assertEqual(data.databaseId, config.expectedDatabaseId, "health database ID");
  const runtime = record(health.runtime, "health runtime");
  assertEqual(runtime.mode, "primary", "health runtime mode");
  assertEqual(runtime.writable, true, "health writable");
  assertEqual(runtime.port, REHEARSAL_PORT, "health port");
  return health;
}

function assertCapabilities(value, config, cliCommand) {
  const capabilities = record(value, "authoring capabilities");
  const exact = {
    bundleVersion: "workbench-authoring-v2",
    capability: "artifact_authoring",
    command: cliCommand,
    databaseId: config.expectedDatabaseId,
    evidencePolicy: "candidate_scoped_canonical_evidence",
    protocol: "masthead.workbench.authoring/v1"
  };
  for (const [field, expected] of Object.entries(exact)) assertEqual(capabilities[field], expected, `capabilities ${field}`);
  return capabilities;
}

async function runPublishDiscover(options) {
  requireConfirmation(options);
  const { config, state } = await loadState(options);
  assertPhase(state, ["invalidated"]);
  const originals = await readJson(join(config.root, "private", "original-dossiers.json"));
  const sample = await readJson(config.samplePath);
  const labels = await readJson(config.labelsPath);
  const sessionIds = sample.rows.map((row) => requiredString(row.sessionId, "sample sessionId"));
  let daemon;
  let publication;
  let dossierReport;
  let candidates;
  let discoveryCompletion;
  let pendingCandidateIds;
  try {
    daemon = await startIsolatedDaemon(config, state.cliCommand, "publish-discover");
    const capabilities = await getJson(config, "/workbench/authoring/capabilities");
    assertCapabilities(capabilities, config, state.cliCommand);
    publication = await postJson(config, "/workbench/dossiers/publish", {
      actorId: "durable-artifact-rehearsal",
      sessionIds
    });
    const artifactIds = publication?.receipt?.artifactIds;
    if (!Array.isArray(artifactIds) || artifactIds.length !== sessionIds.length) {
      throw new Error("Canonical dossier publication did not return exactly 25 artifact IDs");
    }
    dossierReport = await verifyDossiers(config, sessionIds, artifactIds, originals);

    let candidatePage;
    const discoveryPasses = [];
    for (let pass = 1; pass <= DISCOVERY_PASSES; pass += 1) {
      candidatePage = await getJson(config, "/workbench/authoring/candidates?status=pending&limit=100");
      discoveryPasses.push({ pass, returnedCandidates: Array.isArray(candidatePage.candidates) ? candidatePage.candidates.length : 0 });
    }
    discoveryCompletion = assertDiscoveryCompletion(readDiscoveryCompletion(config.activeDatabase));
    candidates = await collectCandidatePages(config, candidatePage);
    pendingCandidateIds = readPendingCandidateIds(config.activeDatabase, { liveWriter: true });
    await writeEvidence(config, "05-dossier-and-discovery-http.json", {
      discoveryPasses,
      dossierReport,
      publication,
      totalCandidates: candidates.length
    });
  } finally {
    if (daemon) await stopDaemon(daemon);
  }

  assertExactIds(
    candidates.map((candidate) => candidate.candidateId),
    pendingCandidateIds,
    "HTTP/DB pending candidate IDs differ"
  );
  const metrics = evaluateCandidateLabels(labels.rows, candidates);
  const frozenSessionIds = new Set(sessionIds);
  const canaryCandidates = selectCanaryCandidates(candidates, frozenSessionIds);
  const byKind = candidateKindCoverage(labels.rows, metrics.units);
  const failures = [];
  if (metrics.recall < 0.9) failures.push(`candidate recall ${round(metrics.recall * 100)}% is below 90%`);
  if (metrics.precision < 0.8) failures.push(`candidate precision ${round(metrics.precision * 100)}% is below 80%`);
  for (const [kind, coverage] of Object.entries(byKind)) {
    if (coverage.expectedPositive > 0 && coverage.discoveredPositive === 0) failures.push(`${kind} has zero frozen-sample yield`);
  }
  if (canaryCandidates.some((candidate) => normalizedStrings(candidate.provenanceSessionIds).length > 12)) {
    failures.push("a canary candidate exceeds 12 provenance sessions");
  }

  const report = {
    reportVersion: "durable-artifact-rehearsal-discovery-v1",
    candidateCount: candidates.length,
    canaryCandidateCount: canaryCandidates.length,
    discoveryCompletion,
    failures,
    frozenLabelMetrics: metrics,
    kindCoverage: byKind,
    machineGatePassed: failures.length === 0,
    productionAccessed: false
  };
  await writeEvidence(config, "06-candidate-report.json", report);
  await writeJsonAtomic(join(config.root, "evidence", "all-candidates.json"), candidates);
  const authoringQueuePath = join(config.root, "evidence", "authoring-queue.json");
  await writeJsonAtomic(authoringQueuePath, {
    actorId: "durable-artifact-rehearsal-author",
    candidates: canaryCandidates,
    databaseId: config.expectedDatabaseId,
    instructions: [
      "Run serve-authoring in one terminal.",
      "Use the root/bin/mastheadctl command for capabilities, open, evidence, submit, and finish.",
      "Open exactly one candidate per V2 run; do not invent or merge candidates."
    ]
  });
  const nextState = {
    ...state,
    phase: failures.length === 0 ? "discovered" : "discovery_failed",
    updatedAt: new Date().toISOString(),
    canary: {
      dossierArtifactIds: publication.receipt.artifactIds,
      candidateIds: canaryCandidates.map((candidate) => candidate.candidateId),
      queueSha256: await hashFile(authoringQueuePath),
      reportSha256: await hashFile(join(config.root, "evidence", "06-candidate-report.json"))
    }
  };
  await writeState(config, nextState);
  if (failures.length > 0) throw new Error(`Candidate machine gate failed: ${failures.join("; ")}`);
  return {
    ok: true,
    phase: nextState.phase,
    authoringQueue: join(config.root, "evidence", "authoring-queue.json"),
    canaryCandidates: canaryCandidates.length,
    productionAccessed: false
  };
}

async function verifyDossiers(config, sessionIds, artifactIds, originals) {
  const rows = [];
  for (let index = 0; index < sessionIds.length; index += 1) {
    const sessionId = sessionIds[index];
    const artifactId = artifactIds[index];
    const detail = await getJson(config, `/logbook/artifacts/${encodeURIComponent(artifactId)}`);
    const artifact = record(detail.artifact, "canonical dossier artifact");
    assertEqual(artifact.schemaVersion, "canonical-session-dossier-v1", "canonical dossier schema");
    assertExactIds(artifact.provenanceSessionIds, [sessionId], "canonical dossier provenance mismatch");
    const body = record(artifact.body, "canonical dossier body");
    assertEqual(body.snapshotVersion, "canonical-session-dossier-v1", "canonical dossier snapshot version");
    const canonicalResponse = await getJson(config, `/sessions/${encodeURIComponent(sessionId)}/dossier`);
    const canonical = record(canonicalResponse.dossier, "post-publication canonical dossier");
    const artifactSnapshot = normalizedDossierForComparison(body);
    const postPublicationCanonical = normalizedDossierForComparison(canonical);
    if (JSON.stringify(artifactSnapshot) !== JSON.stringify(postPublicationCanonical)) {
      throw new Error(`Canonical dossier artifact differs from post-publication canonical dossier for ${sessionId}`);
    }
    const original = record(originals[sessionId], "original canonical dossier record");
    if (typeof original.wasPublished !== "boolean") {
      throw new Error(`Original canonical dossier publication state is missing for ${sessionId}`);
    }
    const expected = normalizedOriginalDossierForComparison(original.dossier, original.wasPublished);
    const actual = normalizedOriginalDossierForComparison(canonical, original.wasPublished);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Canonical dossier body differs from original dossier for ${sessionId}`);
    }
    const title = requiredString(body.identity?.title, "canonical dossier title");
    const search = await getJson(
      config,
      `/logbook/artifacts?kind=session_dossier&q=${encodeURIComponent(title)}&limit=100`
    );
    if (!search.artifacts?.some((entry) => entry.artifactId === artifactId)) {
      throw new Error(`Canonical dossier is not searchable by title: ${artifactId}`);
    }
    rows.push({
      artifactId,
      artifactMatchesCanonical: true,
      findable: true,
      materiallyEquivalent: true,
      previouslyPublished: original.wasPublished,
      sessionId
    });
  }
  return { count: rows.length, rows };
}

async function captureOriginalDossiers(config, sessionIds) {
  await assertNoSidecars(config.activeDatabase);
  await assertRegularNonSymlink(config.dossierEntry, "packaged canonical dossier repository");
  const module = await import(pathToFileURL(config.dossierEntry).href);
  if (typeof module.getSessionDossier !== "function") {
    throw new Error("Packaged canonical dossier repository does not export getSessionDossier");
  }
  const database = openImmutableDatabase(config.activeDatabase);
  try {
    const publication = database.prepare(
      `SELECT publication_status AS publicationStatus
       FROM workbench_session_state
       WHERE session_id = ?`
    );
    const originals = {};
    for (const sessionId of sessionIds) {
      const state = publication.get(sessionId);
      if (!state) throw new Error(`Canonical dossier source session has no Workbench state: ${sessionId}`);
      const dossier = module.getSessionDossier(database, sessionId);
      if (!dossier) throw new Error(`Canonical dossier source session is missing: ${sessionId}`);
      originals[sessionId] = {
        dossier,
        wasPublished: state.publicationStatus === "published"
      };
    }
    return originals;
  } finally {
    database.close();
  }
}

export function normalizedDossierForComparison(value) {
  const dossier = structuredClone(record(value, "dossier comparison value"));
  delete dossier.artifacts;
  delete dossier.capturedAt;
  delete dossier.snapshotVersion;
  return sortDeep(dossier);
}

export function normalizedOriginalDossierForComparison(value, wasPublished) {
  const dossier = structuredClone(record(normalizedDossierForComparison(value), "original dossier comparison value"));
  if (!wasPublished) {
    const reuse = record(dossier.reuse, "original dossier reuse");
    delete reuse.mcpIncluded;
    const context = requiredString(reuse.copyableContext, "original dossier copyable context");
    const neutralized = context.replace(
      /\nAgent retrieval: (?:included|excluded)$/u,
      "\nAgent retrieval: publication-state"
    );
    if (neutralized === context) {
      throw new Error("Original unpublished dossier copyable context has no terminal Agent retrieval state");
    }
    reuse.copyableContext = neutralized;
  }
  return sortDeep(dossier);
}

async function collectCandidatePages(config, firstPage) {
  const candidates = [];
  const seen = new Set();
  const seenCursors = new Set();
  let page = firstPage;
  for (;;) {
    if (!Array.isArray(page?.candidates)) throw new Error("Candidate page is malformed");
    for (const candidate of page.candidates) {
      const id = requiredString(candidate.candidateId, "candidateId");
      if (!seen.has(id)) {
        seen.add(id);
        candidates.push(candidate);
      }
    }
    if (!page.nextCursor) break;
    if (seenCursors.has(page.nextCursor)) throw new Error(`Candidate pagination repeated cursor: ${page.nextCursor}`);
    seenCursors.add(page.nextCursor);
    page = await getJson(
      config,
      `/workbench/authoring/candidates?status=pending&limit=100&cursor=${encodeURIComponent(page.nextCursor)}`
    );
  }
  return candidates.toSorted((left, right) => String(left.candidateId).localeCompare(String(right.candidateId)));
}

function readDiscoveryCompletion(databasePath) {
  assertSafeRehearsalDatabasePath(databasePath);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const eligible = db.prepare(
      `SELECT COUNT(*) AS count
       FROM sessions
       INNER JOIN workbench_session_state state ON state.session_id = sessions.session_id
       WHERE sessions.deleted_at IS NULL
         AND state.publication_status <> 'not_added_to_logbook'`
    ).get().count;
    const current = db.prepare(
      `SELECT COUNT(DISTINCT sessions.session_id) AS count
       FROM sessions
       INNER JOIN workbench_session_state state ON state.session_id = sessions.session_id
       LEFT JOIN workbench_artifact_candidate_source_revisions revisions
         ON revisions.session_id = sessions.session_id
       INNER JOIN workbench_artifact_candidate_scans scans
         ON scans.session_id = sessions.session_id
        AND scans.source_revision = COALESCE(revisions.source_revision, 0)
        AND scans.detector_revision = ?
       WHERE sessions.deleted_at IS NULL
         AND state.publication_status <> 'not_added_to_logbook'`
    ).get(CANDIDATE_DETECTOR_REVISION).count;
    return { currentScans: Number(current), eligibleSessions: Number(eligible) };
  } finally {
    db.close();
  }
}

function candidateKindCoverage(labels, units) {
  const result = {};
  for (const kind of ["runbook", "adr", "incident_timeline"]) {
    result[kind] = {
      discoveredPositive: units.filter((unit) => unit.kind === kind && unit.discoveredCandidate).length,
      expectedPositive: labels.filter((label) => label.kind === kind && label.expectedCandidate === true).length
    };
  }
  return result;
}

async function runServeAuthoring(options) {
  requireConfirmation(options);
  const { config, state } = await loadState(options);
  assertPhase(state, ["discovered"]);
  const queue = await readJson(join(config.root, "evidence", "authoring-queue.json"));
  if (!Array.isArray(queue.candidates) || queue.candidates.length !== state.canary.candidateIds.length) {
    throw new Error("Authoring queue does not match the frozen canary candidate set");
  }
  assertExactIds(
    queue.candidates.map((candidate) => requiredString(candidate?.candidateId, "queued candidate ID")),
    state.canary.candidateIds,
    "Authoring queue candidate IDs changed"
  );
  const daemon = await startIsolatedDaemon(config, state.cliCommand, "authoring");
  try {
    assertCapabilities(await getJson(config, "/workbench/authoring/capabilities"), config, state.cliCommand);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      phase: "authoring_ready",
      baseUrl: baseUrl(config),
      command: state.cliCommand,
      candidateCount: queue.candidates.length,
      productionAccessed: false
    })}\n`);
    await waitForOperatorSignal();
  } finally {
    await stopDaemon(daemon);
  }
  return { ok: true, phase: "authoring_stopped", productionAccessed: false, root: config.root };
}

async function runVerify(options) {
  requireConfirmation(options);
  const { config, state } = await loadState(options);
  assertPhase(state, ["discovered", "verified", "verification_failed"]);
  const queue = record(await readJson(join(config.root, "evidence", "authoring-queue.json")), "authoring queue");
  const candidates = Array.isArray(queue.candidates) ? queue.candidates.map((value) => record(value, "queued candidate")) : [];
  const expectedCandidateIds = state.canary.candidateIds;
  assertExactIds(candidates.map((candidate) => requiredString(candidate.candidateId, "queued candidate ID")), expectedCandidateIds, "queued candidate IDs changed");
  await assertNoSidecars(config.activeDatabase);
  const runs = readCanaryRuns(config.activeDatabase, candidates);
  const failures = [];
  const optionalArtifacts = [];
  const optionalReviewRows = [];
  const claimSupportChecks = [];
  const persistedEqualityChecks = [];
  const logbookRetrieval = [];
  const mcpRetrieval = [];
  const protocolLeaks = [];
  const provenanceSizes = [];
  const receiptHashes = [];
  let daemon;
  try {
    daemon = await startIsolatedDaemon(config, state.cliCommand, "verify");
    assertCapabilities(await getJson(config, "/workbench/authoring/capabilities"), config, state.cliCommand);
    for (const { candidate, runId } of runs) {
      const status = await getJson(config, `/workbench/authoring/runs/${encodeURIComponent(runId)}`);
      const run = record(status.run, `authoring run ${runId}`);
      const receipt = record(run.receipt, `authoring receipt ${runId}`);
      const bundle = record(run.bundle, `authoring bundle ${runId}`);
      assertEqual(run.contractVersion, "workbench-authoring-v2", `${runId} contract`);
      assertEqual(run.status, "completed", `${runId} status`);
      assertEqual(receipt.contractVersion, "workbench-authoring-v2", `${runId} receipt contract`);
      assertEqual(receipt.candidateId, candidate.candidateId, `${runId} receipt candidate`);
      assertEqual(bundle.candidateId, candidate.candidateId, `${runId} bundle candidate`);
      assertEqual(bundle.runId, runId, `${runId} bundle run`);
      const provenanceSessionIds = normalizedStrings(candidate.provenanceSessionIds);
      assertExactIds(receipt.provenanceSessionIds, provenanceSessionIds, `${runId} receipt provenance`);
      assertExactIds(bundle.artifact?.provenanceSessionIds, provenanceSessionIds, `${runId} bundle provenance`);
      if (provenanceSessionIds.length > 12) failures.push(`${runId}:provenance_above_12`);
      provenanceSizes.push({ candidateId: candidate.candidateId, runId, size: provenanceSessionIds.length });

      const optional = record(receipt.optionalArtifact, `${runId} optional artifact receipt`);
      assertEqual(optional.kind, candidate.kind, `${runId} optional artifact kind`);
      const artifactId = requiredString(optional.artifactId, `${runId} optional artifact ID`);
      const detailResponse = await getJson(config, `/logbook/artifacts/${encodeURIComponent(artifactId)}`);
      const detail = record(detailResponse.artifact, `artifact ${artifactId}`);
      assertEqual(detail.capsule?.kind, candidate.kind, `${artifactId} persisted kind`);
      assertExactIds(detail.provenanceSessionIds, provenanceSessionIds, `${artifactId} persisted provenance`);
      const body = record(detail.body, `${artifactId} body`);
      const submittedOutput = record(bundle.artifact?.output, `${runId} submitted output`);
      const persistedMatched = JSON.stringify(sortDeep(body)) === JSON.stringify(sortDeep(submittedOutput));
      persistedEqualityChecks.push({ artifactId, matched: persistedMatched, runId });
      if (!persistedMatched) failures.push(`${artifactId}:persisted_body_differs_from_submission`);

      const evidence = await collectRunEvidence(config, runId, provenanceSessionIds);
      const support = verifyClaimSupport(candidate.kind, body, provenanceSessionIds, evidence);
      claimSupportChecks.push({ artifactId, ...support });
      for (const failure of support.failures) failures.push(`${artifactId}:${failure}`);
      for (const leak of findProtocolLeaks(body, support.supports, evidence)) {
        protocolLeaks.push({ artifactId, ...leak });
        failures.push(`${artifactId}:protocol_leak:${leak.path}`);
      }

      const title = requiredString(body.title ?? detail.capsule?.title, `${artifactId} title`);
      const logbookSearch = await getJson(
        config,
        `/logbook/artifacts?kind=${encodeURIComponent(candidate.kind)}&q=${encodeURIComponent(title)}&limit=5`
      );
      const logbookRank = Array.isArray(logbookSearch.artifacts)
        ? logbookSearch.artifacts.findIndex((entry) => entry.artifactId === artifactId)
        : -1;
      logbookRetrieval.push({ artifactId, passed: logbookRank >= 0 && logbookRank < 5, query: title, rank: logbookRank + 1 });
      if (logbookRank < 0 || logbookRank >= 5) failures.push(`${artifactId}:logbook_retrieval_failed`);

      const reuseProbe = artifactReuseProbe(candidate.kind, body);
      const mcpSearch = await callPackagedMcp(config, "search_artifacts", {
        kind: candidate.kind,
        limit: 5,
        query: reuseProbe.problemQuery
      });
      const mcpRank = Array.isArray(mcpSearch.artifacts)
        ? mcpSearch.artifacts.findIndex((entry) => entry.artifactId === artifactId)
        : -1;
      const mcpDetail = mcpRank >= 0 ? await callPackagedMcp(config, "get_artifact", { artifactId }) : undefined;
      const mcpBody = mcpDetail && record(mcpDetail.artifact, `MCP artifact ${artifactId}`).body;
      const derivedAnswer = mcpBody && valueAtPath(mcpBody, reuseProbe.answerPath);
      const mcpPassed =
        mcpRank >= 0 &&
        mcpRank < 5 &&
        JSON.stringify(sortDeep(mcpBody)) === JSON.stringify(sortDeep(body)) &&
        JSON.stringify(sortDeep(derivedAnswer)) === JSON.stringify(sortDeep(reuseProbe.expectedAnswer));
      mcpRetrieval.push({
        answerPath: reuseProbe.answerPath,
        artifactId,
        derivedAnswerSha256: mcpPassed ? sha256Json(derivedAnswer) : undefined,
        passed: mcpPassed,
        problemQuery: reuseProbe.problemQuery,
        rank: mcpRank + 1,
        toolCalls: ["initialize", "search_artifacts", ...(mcpRank >= 0 ? ["initialize", "get_artifact"] : [])]
      });
      if (!mcpPassed) failures.push(`${artifactId}:mcp_artifact_only_reuse_failed`);

      optionalArtifacts.push({
        artifactId,
        candidateId: candidate.candidateId,
        kind: candidate.kind,
        provenanceSessionIds,
        runId,
        title
      });
      optionalReviewRows.push({
        artifactId,
        body,
        capsule: detail.capsule,
        contentSha256: sha256Json(body),
        kind: candidate.kind,
        provenanceSessionIds,
        title
      });
      receiptHashes.push({ runId, sha256: sha256Json(receipt) });
    }
  } finally {
    if (daemon) await stopDaemon(daemon);
  }

  await assertNoSidecars(config.activeDatabase);
  const duplicateSubstantiveFingerprints = findDuplicateSubstantiveArtifacts(optionalArtifacts, config.activeDatabase);
  for (const duplicate of duplicateSubstantiveFingerprints) failures.push(`duplicate_substantive_fingerprint:${duplicate.artifactIds.join(",")}`);
  const databaseCrossCheck = readPublishedCanaryCrossCheck(config.activeDatabase, expectedCandidateIds);
  if (databaseCrossCheck.publishedCandidates !== expectedCandidateIds.length) {
    failures.push(`published_candidate_count:${databaseCrossCheck.publishedCandidates}:${expectedCandidateIds.length}`);
  }
  if (databaseCrossCheck.completedRuns !== expectedCandidateIds.length) {
    failures.push(`completed_v2_run_count:${databaseCrossCheck.completedRuns}:${expectedCandidateIds.length}`);
  }
  if (databaseCrossCheck.totalPublishedCandidates !== expectedCandidateIds.length) {
    failures.push(`total_published_candidate_count:${databaseCrossCheck.totalPublishedCandidates}:${expectedCandidateIds.length}`);
  }
  if (databaseCrossCheck.totalV2Runs !== expectedCandidateIds.length) {
    failures.push(`total_v2_run_count:${databaseCrossCheck.totalV2Runs}:${expectedCandidateIds.length}`);
  }
  const discoveryReport = await readJson(join(config.root, "evidence", "06-candidate-report.json"));
  if (discoveryReport.machineGatePassed !== true) failures.push("discovery_machine_gate_not_passed");

  const report = {
    reportVersion: "durable-artifact-rehearsal-machine-v1",
    claimSupportChecks,
    databaseCrossCheck,
    duplicateSubstantiveFingerprints,
    failures: [...new Set(failures)].sort(),
    logbookRetrieval,
    machineGatePassed: failures.length === 0,
    mcpRetrieval,
    optionalArtifacts,
    persistedEqualityChecks,
    productionAccessed: false,
    protocolLeaks,
    provenanceSizes,
    receiptHashes
  };
  const machineReportPath = join(config.root, "evidence", "07-machine-verification.json");
  await writeEvidence(config, "07-machine-verification.json", report);
  const machineReportSha256 = await hashFile(machineReportPath);
  const dossierRows = await dossierWorksheetRows(config, state.canary.dossierArtifactIds);
  await assertNoSidecars(config.activeDatabase);
  const reviewSetSha256 = sha256Json({
    databaseId: config.expectedDatabaseId,
    dossiers: dossierRows,
    machineReportSha256,
    optionalArtifacts: optionalReviewRows,
    releaseSha: config.expectedBuildSha
  });
  const reviewPacket = {
    packetVersion: 1,
    databaseId: config.expectedDatabaseId,
    releaseSha: config.expectedBuildSha,
    machineReportSha256,
    reviewSetSha256,
    instructions: [
      "This packet is self-contained: every row embeds the complete persisted artifact body, capsule, provenance, and a body SHA-256.",
      "A real human must review every row. Scores are integers 1-5; add notes.<axis> for every score below 4.",
      "Copy the companion 08-human-review-receipt-template.json outside the disposable rehearsal root, fill it without changing any hashes or artifact IDs, then sign it with reviewer and signedAt."
    ],
    dossiers: dossierRows,
    optionalArtifacts: optionalReviewRows
  };
  const reviewPacketPath = join(config.root, "evidence", "08-human-review-packet.json");
  await writeEvidence(config, "08-human-review-packet.json", reviewPacket);
  const packetSha256 = await hashFile(reviewPacketPath);
  const receiptTemplatePath = join(config.root, "evidence", "08-human-review-receipt-template.json");
  await writeEvidence(config, "08-human-review-receipt-template.json", {
    receiptVersion: 1,
    reviewerKind: "human",
    reviewer: "",
    signedAt: "",
    machineReportSha256,
    packetSha256,
    reviewSetSha256,
    dossiers: dossierRows.map((row) => ({ artifactId: row.artifactId, scores: emptyScores(), notes: {} })),
    optionalArtifacts: optionalReviewRows.map((row) => ({ artifactId: row.artifactId, scores: emptyScores(), notes: {} }))
  });
  const nextState = {
    ...state,
    phase: failures.length === 0 ? "verified" : "verification_failed",
    updatedAt: new Date().toISOString(),
    machine: {
      dossierArtifactIds: state.canary.dossierArtifactIds,
      optionalArtifactIds: optionalArtifacts.map((artifact) => artifact.artifactId),
      packetSha256,
      receiptTemplateSha256: await hashFile(receiptTemplatePath),
      reportSha256: machineReportSha256,
      reviewSetSha256
    }
  };
  await writeState(config, nextState);
  if (failures.length > 0) throw new Error(`Rehearsal machine verification failed: ${failures.join("; ")}`);
  return {
    ok: true,
    phase: nextState.phase,
    humanReviewPacket: reviewPacketPath,
    humanReviewReceiptTemplate: receiptTemplatePath,
    optionalArtifacts: optionalArtifacts.length,
    productionAccessed: false
  };
}

function artifactReuseProbe(kind, body) {
  if (kind === "runbook") {
    const signature = record(body.problemSignature, "runbook problem signature");
    const problemQuery = firstRequiredString(
      [signature.errorStrings, signature.symptoms, [signature.affectedScope]],
      "runbook problem query"
    );
    return {
      answerPath: "fixSteps[0]",
      expectedAnswer: requiredString(valueAtPath(body, "fixSteps[0]"), "runbook reusable fix"),
      problemQuery
    };
  }
  if (kind === "adr") {
    return {
      answerPath: "decision",
      expectedAnswer: requiredString(body.decision, "ADR reusable decision"),
      problemQuery: requiredString(body.context, "ADR problem context")
    };
  }
  if (kind === "incident_timeline") {
    return {
      answerPath: "remediation[0]",
      expectedAnswer: requiredString(valueAtPath(body, "remediation[0]"), "incident reusable remediation"),
      problemQuery: requiredString(body.symptom, "incident problem symptom")
    };
  }
  throw new Error(`Unsupported reuse-probe artifact kind: ${kind}`);
}

function firstRequiredString(groups, label) {
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const value of group) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  throw new Error(`${label} is required`);
}

function valueAtPath(value, path) {
  let current = value;
  for (const match of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    const key = match[1] ?? Number(match[2]);
    if (!current || typeof current !== "object" || !(key in current)) return undefined;
    current = current[key];
  }
  return current;
}

async function runHumanReview(options) {
  requireConfirmation(options);
  const { config, state } = await loadState(options);
  assertPhase(state, ["verified", "reviewed"]);
  const receiptPath = resolve(requiredString(options.receipt, "--receipt"));
  assertOutside(config.root, receiptPath, "Signed human review receipt must be retained outside the disposable rehearsal root");
  await assertRegularNonSymlink(receiptPath, "human review receipt");
  const expectedReceiptHash = requiredHash(options["receipt-sha256"], "--receipt-sha256", 64);
  await assertFileHash(receiptPath, expectedReceiptHash, "human review receipt");
  const receipt = await readJson(receiptPath);
  const review = validateHumanReviewReceipt(receipt, {
    dossierArtifactIds: state.machine.dossierArtifactIds,
    machineReportSha256: state.machine.reportSha256,
    optionalArtifactIds: state.machine.optionalArtifactIds,
    packetSha256: state.machine.packetSha256,
    reviewSetSha256: state.machine.reviewSetSha256
  });
  await writeEvidence(config, "09-human-review-receipt.json", {
    receipt,
    receiptSha256: expectedReceiptHash,
    result: review,
    sourcePath: receiptPath
  });
  const nextState = {
    ...state,
    phase: "reviewed",
    updatedAt: new Date().toISOString(),
    humanReview: {
      medianOverall: review.medianOverall,
      minimumOverall: review.minimumOverall,
      receiptSha256: expectedReceiptHash,
      reviewer: review.reviewer,
      signedAt: review.signedAt
    }
  };
  await writeState(config, nextState);
  return { ok: true, phase: nextState.phase, productionAccessed: false, review: nextState.humanReview };
}

async function runRestore(options) {
  requireConfirmation(options);
  const { config, state } = await loadState(options);
  assertPhase(state, [
    "prepared", "invalidated", "discovered", "discovery_failed", "verified", "verification_failed", "reviewed",
    "restore_export_pending", "restored"
  ]);
  const exportPath = resolve(requiredString(options["evidence-export"], "--evidence-export"));
  assertOutside(config.root, exportPath, "Evidence export must be outside the disposable rehearsal root");
  if (!basename(exportPath).startsWith("masthead-durable-rehearsal-evidence-")) {
    throw new Error("Evidence export basename must start with masthead-durable-rehearsal-evidence-");
  }
  const exportParentIdentity = await validateEvidenceExportDestination(config, exportPath);
  let pendingState = state;
  let proof;
  if (state.phase === "restore_export_pending" || state.phase === "restored") {
    if (JSON.stringify(state.evidenceExport?.parentIdentity) !== JSON.stringify(exportParentIdentity)) {
      throw new Error("Evidence export parent identity changed or was replaced");
    }
    const binding = assertEvidenceExportBinding(state, exportPath);
    if (await filesystemPathExists(exportPath)) {
      const exportedState = await verifyCompletedEvidenceExport(config, exportPath, binding);
      if (state.phase !== "restored") await writeState(config, exportedState);
      return restoreResult(exportedState, exportPath);
    }
    if (state.phase === "restored") {
      throw new Error(`Completed evidence export is missing: ${exportPath}`);
    }
    proof = await verifyRestoredDatabase(config, state.restore);
  } else {
    await assertPathAbsent(exportPath, "evidence export");
    await assertNoSidecars(config.activeDatabase);
    await assertNoSidecars(config.recoveryBackup);
    const preparation = record(state.preparation, "prepared recovery checkpoint");
    const backupIdentity = record(preparation.backupIdentity, "prepared recovery backup identity");
    const backupSha256 = requiredHash(preparation.backupSha256, "prepared recovery backup SHA-256", 64);
    await assertImmutableFileIdentity(config.recoveryBackup, backupIdentity, "prepared recovery backup before restore");
    await assertFileHash(config.recoveryBackup, backupSha256, "prepared recovery backup before restore");
    const restored = await runMaintenance(config, [
      "workbench",
      "restore-v1-recovery",
      "--db",
      config.activeDatabase,
      "--backup",
      config.recoveryBackup,
      "--audit-hash",
      config.expectedAuditHash,
      "--confirm",
      "--json"
    ]);
    assertRestoreReceipt(restored.receipt, config);
    proof = await verifyRestoredDatabase(config, { backupIdentity, backupSha256, receipt: restored.receipt });
    await writeEvidence(config, "10-restore.json", {
      backupSha256,
      postAudit: proof.postAudit,
      restored,
      schemaLedger: proof.schemaLedger,
      wholeDatabase: proof.wholeDatabase
    });
    const token = randomUUID();
    const stagingPath = join(dirname(exportPath), `.${basename(exportPath)}.partial-${token}`);
    await assertPathAbsent(stagingPath, "evidence export staging path");
    pendingState = {
      ...state,
      phase: "restore_export_pending",
      updatedAt: new Date().toISOString(),
      restore: {
        auditHash: proof.postAudit.audit.auditHash,
        backupIdentity,
        backupSha256,
        receipt: restored.receipt
      },
      evidenceExport: { parentIdentity: exportParentIdentity, path: exportPath, stagingPath, status: "pending", token }
    };
    await writeState(config, pendingState);
  }

  const binding = assertEvidenceExportBinding(pendingState, exportPath);
  await writeEvidenceManifest(config);
  await removeBoundPartialEvidenceExport(config, binding);
  await mkdir(binding.stagingPath, { mode: 0o700 });
  await assertPrivateOwnedDirectory(binding.stagingPath, "evidence export staging directory");
  await writeJsonAtomic(join(binding.stagingPath, "export-marker.json"), exportMarker(config, binding, "partial"), 0o600);
  await cp(join(config.root, "evidence"), join(binding.stagingPath, "evidence"), {
    errorOnExist: true,
    force: false,
    recursive: true
  });
  const completedAt = new Date().toISOString();
  const completedState = {
    ...pendingState,
    phase: "restored",
    updatedAt: completedAt,
    evidenceExport: { ...pendingState.evidenceExport, completedAt, status: "complete" }
  };
  await writeJsonAtomic(join(binding.stagingPath, "rehearsal-state.json"), completedState, 0o600);
  await writeJsonAtomic(
    join(binding.stagingPath, "export-marker.json"),
    exportMarker(config, binding, "complete"),
    0o600
  );
  await rename(binding.stagingPath, exportPath);
  const exportedState = await verifyCompletedEvidenceExport(config, exportPath, binding);
  await writeState(config, exportedState);
  return restoreResult(exportedState, exportPath);
}

function restoreResult(state, exportPath) {
  return {
    ok: true,
    phase: state.phase,
    evidenceExport: exportPath,
    productionAccessed: false,
    rootMayBeDeletedAfterReviewingExport: true
  };
}

async function validateEvidenceExportDestination(config, exportPath) {
  const parent = dirname(exportPath);
  await assertPrivateOwnedDirectory(parent, "evidence export parent");
  assertEqual(await realpath(parent), parent, "evidence export canonical parent");
  assertEqual(resolve(join(parent, basename(exportPath))), exportPath, "evidence export destination");
  assertOutside(await realpath(config.root), exportPath, "Evidence export must remain outside the canonical rehearsal root");
  return immutableDirectoryIdentity(parent);
}

async function verifyRestoredDatabase(config, restoreValue) {
  const restore = record(restoreValue, "restore checkpoint");
  const backupIdentity = record(restore.backupIdentity, "restore backup identity");
  const backupSha256 = requiredHash(restore.backupSha256, "restore backupSha256", 64);
  assertRestoreReceipt(restore.receipt, config);
  await assertNoSidecars(config.activeDatabase);
  const postAudit = await runMaintenance(config, [
    "workbench", "audit-v1-generation", "--db", config.activeDatabase, "--json"
  ]);
  assertV1Audit(postAudit.audit, config);
  await assertNoSidecars(config.activeDatabase);
  assertEqual(readDatabaseIdentity(config.activeDatabase), config.expectedDatabaseId, "restored database ID");
  await assertNoSidecars(config.activeDatabase);
  const schemaLedger = readMigrationLedger(config.activeDatabase);
  assertCurrentLedger(schemaLedger);
  await assertNoSidecars(config.activeDatabase);
  assertEqual(readDatabaseIntegrity(config.activeDatabase), "ok", "restored database integrity");
  await assertNoSidecars(config.activeDatabase);
  const wholeDatabase = readWholeDatabaseCounts(config.activeDatabase);
  assertWholeDatabaseBaseline(wholeDatabase, "restored");
  await assertNoSidecars(config.recoveryBackup);
  await assertImmutableFileIdentity(config.recoveryBackup, backupIdentity, "recovery backup");
  await assertNoSidecars(config.recoveryBackup);
  await assertFileHash(config.recoveryBackup, backupSha256, "recovery backup after restore");
  await assertNoSidecars(config.frozenDatabase);
  await assertFileHash(config.frozenDatabase, config.expectedSourceSha256, "frozen schema-21 source bytes");
  await assertNoSidecars(config.sourceBackup);
  await assertFileHash(config.sourceBackup, config.expectedSourceSha256, "external source backup after rehearsal");
  await assertNoSidecars(config.sourceBackup);
  return { postAudit, schemaLedger, wholeDatabase };
}

function assertEvidenceExportBinding(state, exportPath) {
  const binding = record(state.evidenceExport, "evidence export checkpoint");
  assertEqual(resolve(requiredString(binding.path, "evidence export path")), exportPath, "bound evidence export path");
  const token = requiredString(binding.token, "evidence export token");
  const expectedStagingPath = join(dirname(exportPath), `.${basename(exportPath)}.partial-${token}`);
  assertEqual(resolve(requiredString(binding.stagingPath, "evidence export staging path")), expectedStagingPath, "bound evidence staging path");
  return { path: exportPath, stagingPath: expectedStagingPath, token };
}

function exportMarker(config, binding, status) {
  return {
    databaseId: config.expectedDatabaseId,
    releaseSha: config.expectedBuildSha,
    rehearsalRoot: config.root,
    status,
    token: binding.token
  };
}

async function removeBoundPartialEvidenceExport(config, binding) {
  if (!(await filesystemPathExists(binding.stagingPath))) return;
  await assertDirectoryNonSymlink(binding.stagingPath, "partial evidence export");
  const names = await readdir(binding.stagingPath);
  if (names.length > 0) {
    const markerPath = join(binding.stagingPath, "export-marker.json");
    await assertRegularNonSymlink(markerPath, "partial evidence export marker");
    const marker = record(await readJson(markerPath), "partial evidence export marker");
    assertExactObject(marker, exportMarker(config, binding, marker.status), "partial evidence export marker");
    if (!new Set(["partial", "complete"]).has(marker.status)) {
      throw new Error(`Invalid partial evidence export marker status: ${marker.status}`);
    }
  }
  await rm(binding.stagingPath, { recursive: true });
}

async function verifyCompletedEvidenceExport(config, exportPath, binding) {
  await assertDirectoryNonSymlink(exportPath, "completed evidence export");
  const markerPath = join(exportPath, "export-marker.json");
  await assertRegularNonSymlink(markerPath, "completed evidence export marker");
  const marker = await readJson(markerPath);
  assertExactObject(marker, exportMarker(config, binding, "complete"), "completed evidence export marker");
  const exportedStatePath = join(exportPath, "rehearsal-state.json");
  await assertRegularNonSymlink(exportedStatePath, "completed exported rehearsal state");
  const exportedState = record(await readJson(exportedStatePath), "completed exported rehearsal state");
  assertEqual(exportedState.phase, "restored", "completed exported rehearsal phase");
  assertEvidenceExportBinding(exportedState, exportPath);
  assertEqual(exportedState.restore?.auditHash, config.expectedAuditHash, "completed export restore audit hash");
  const sourceEvidence = join(config.root, "evidence");
  const exportedEvidence = join(exportPath, "evidence");
  await assertDirectoryNonSymlink(exportedEvidence, "completed exported evidence");
  const sourceNames = (await readdir(sourceEvidence)).sort();
  const exportedNames = (await readdir(exportedEvidence)).sort();
  assertExactIds(exportedNames, sourceNames, "completed evidence export file set");
  for (const name of sourceNames) {
    const sourcePath = join(sourceEvidence, name);
    const destinationPath = join(exportedEvidence, name);
    await assertRegularNonSymlink(sourcePath, "source evidence file");
    await assertRegularNonSymlink(destinationPath, "exported evidence file");
    assertEqual(await hashFile(destinationPath), await hashFile(sourcePath), `exported evidence ${name} SHA-256`);
  }
  return exportedState;
}

function readCanaryRuns(databasePath, candidates) {
  const db = openImmutableDatabase(databasePath);
  try {
    const expectedCandidateIds = candidates.map((candidate) => requiredString(candidate.candidateId, "candidate ID"));
    const allV2CandidateIds = db.prepare(
      `SELECT candidate_id AS candidateId
       FROM workbench_authoring_runs
       WHERE contract_version = 'workbench-authoring-v2'
       ORDER BY candidate_id, run_id`
    ).all().map((row) => row.candidateId);
    assertExactIds(allV2CandidateIds, expectedCandidateIds, "exact V2 authoring-run candidate set");
    const allPublishedCandidateIds = db.prepare(
      `SELECT candidate_id AS candidateId
       FROM workbench_artifact_candidates
       WHERE status = 'published'
       ORDER BY candidate_id`
    ).all().map((row) => row.candidateId);
    assertExactIds(allPublishedCandidateIds, expectedCandidateIds, "exact published candidate set");
    const selectRuns = db.prepare(
      `SELECT run_id AS runId, status, bundle_json AS bundleJson, receipt_json AS receiptJson
       FROM workbench_authoring_runs
       WHERE contract_version = 'workbench-authoring-v2' AND candidate_id = ?
       ORDER BY run_id`
    );
    const candidateStatus = db.prepare(
      "SELECT status FROM workbench_artifact_candidates WHERE candidate_id = ?"
    );
    return candidates.map((candidate) => {
      const candidateId = requiredString(candidate.candidateId, "candidate ID");
      const rows = selectRuns.all(candidateId);
      if (rows.length !== 1) throw new Error(`${candidateId} must have exactly one V2 authoring run; found ${rows.length}`);
      const row = rows[0];
      assertEqual(row.status, "completed", `${candidateId} authoring run status`);
      if (!row.bundleJson || !row.receiptJson) throw new Error(`${candidateId} completed run is missing immutable bundle/receipt`);
      assertEqual(candidateStatus.get(candidateId)?.status, "published", `${candidateId} database status`);
      return { candidate, runId: requiredString(row.runId, `${candidateId} run ID`) };
    });
  } finally {
    db.close();
  }
}

async function collectRunEvidence(config, runId, sessionIds) {
  const evidence = new Map();
  for (const sessionId of sessionIds) {
    let cursor;
    let observed = 0;
    let expectedTotal;
    for (;;) {
      const query = new URLSearchParams({ limit: "250", order: "asc", sessionId });
      if (cursor) query.set("cursor", cursor);
      const page = await getJson(
        config,
        `/workbench/authoring/runs/${encodeURIComponent(runId)}/evidence?${query.toString()}`
      );
      assertEqual(page.sessionId, sessionId, `${runId} evidence session`);
      if (!Array.isArray(page.items)) throw new Error(`${runId}/${sessionId} evidence page is malformed`);
      expectedTotal ??= Number(page.total);
      assertEqual(Number(page.total), expectedTotal, `${runId}/${sessionId} evidence total`);
      for (const rawItem of page.items) {
        const item = record(rawItem, `${runId}/${sessionId} evidence item`);
        const itemId = requiredString(item.itemId, "evidence item ID");
        if (evidence.has(itemId)) throw new Error(`Duplicate canonical evidence ref in run ${runId}: ${itemId}`);
        const text = item.kind === "file_effect"
          ? `${item.label ?? ""} ${item.text ?? ""}`
          : item.kind === "message"
            ? String(item.narrativeText ?? item.text ?? "")
            : String(item.text ?? "");
        evidence.set(itemId, { ...item, sessionId, text });
        observed += 1;
      }
      cursor = requiredOptionalString(page.nextCursor);
      if (!cursor) break;
    }
    if (observed !== expectedTotal) {
      throw new Error(`${runId}/${sessionId} evidence pagination incomplete: ${observed}/${expectedTotal}`);
    }
  }
  return evidence;
}

function verifyClaimSupport(kind, body, provenanceSessionIds, evidence) {
  if (!Array.isArray(body.claimSupport)) {
    return { coverage: 0, failures: ["claim_support_not_array"], supports: [] };
  }
  const supports = body.claimSupport.map((value, index) => {
    const support = record(value, `claimSupport[${index}]`);
    return {
      evidenceRef: requiredString(support.evidenceRef, `claimSupport[${index}].evidenceRef`),
      excerpt: requiredString(support.excerpt, `claimSupport[${index}].excerpt`),
      path: requiredString(support.path, `claimSupport[${index}].path`),
      supportKind: requiredString(support.supportKind, `claimSupport[${index}].supportKind`)
    };
  });
  const failures = [];
  const provenance = new Set(provenanceSessionIds);
  for (const support of supports) {
    const item = evidence.get(support.evidenceRef);
    const excerpt = normalizeWhitespace(support.excerpt);
    const evidenceText = normalizeWhitespace(item?.text ?? "");
    if (!pathExists(body, support.path)) failures.push(`claim_path_missing:${support.path}`);
    if (excerpt.length < 20 || !item || !evidenceText.includes(excerpt)) {
      failures.push(`unsupported_claim_excerpt:${support.path}:${support.evidenceRef}`);
    }
    if (item && !provenance.has(item.sessionId)) failures.push(`claim_ref_outside_provenance:${support.evidenceRef}`);
  }
  const requiredPaths = requiredClaimPathsForRehearsal(kind, body, provenanceSessionIds);
  for (const path of requiredPaths) {
    const pathSupports = supports.filter((support) => support.path === path);
    if (pathSupports.length === 0) failures.push(`missing_claim_support:${path}`);
  }
  if (provenance.size > 1 && requiredPaths.includes("joinRationale")) {
    const joinedSessions = new Set(
      supports.filter((support) => support.path === "joinRationale")
        .map((support) => evidence.get(support.evidenceRef)?.sessionId)
        .filter(Boolean)
    );
    for (const sessionId of provenance) {
      if (!joinedSessions.has(sessionId)) failures.push(`join_rationale_missing_session:${sessionId}`);
    }
  }
  const requiredKinds = {
    adr: ["decision", "alternative"],
    incident_timeline: ["problem", "timeline", "remediation"],
    runbook: ["problem", "change", "verification"]
  }[kind] ?? [];
  for (const supportKind of requiredKinds) {
    if (!supports.some((support) => support.supportKind === supportKind)) {
      failures.push(`missing_required_support_kind:${supportKind}`);
    }
  }
  return {
    coverage: requiredPaths.length === 0
      ? 1
      : requiredPaths.filter((path) => supports.some((support) => support.path === path)).length / requiredPaths.length,
    failures: [...new Set(failures)].sort(),
    requiredPaths,
    supports
  };
}

function requiredClaimPathsForRehearsal(kind, body, provenanceSessionIds) {
  const paths = [];
  const strings = (value, prefix) => {
    if (!Array.isArray(value)) return;
    value.forEach((entry, index) => {
      if (typeof entry === "string" && entry.trim()) paths.push(`${prefix}[${index}]`);
    });
  };
  const string = (value, path) => {
    if (typeof value === "string" && value.trim()) paths.push(path);
  };
  if (kind === "runbook") {
    const signature = body.problemSignature && typeof body.problemSignature === "object"
      ? body.problemSignature
      : {};
    strings(signature.symptoms, "problemSignature.symptoms");
    strings(signature.errorStrings, "problemSignature.errorStrings");
    string(signature.affectedScope, "problemSignature.affectedScope");
    for (const field of ["preconditions", "reproSteps", "deadEnds", "fixSteps", "commands", "changedFiles", "validationChecks", "environmentRequirements", "preventionNotes", "risksOrGaps"]) {
      strings(body[field], field);
    }
    if (!isExplicitlyUnknown(body.rootCause)) string(body.rootCause, "rootCause");
  } else if (kind === "adr") {
    string(body.context, "context");
    string(body.decision, "decision");
    string(body.status, "status");
    for (const field of ["alternatives", "consequences", "affectedPaths", "supersedes"]) strings(body[field], field);
  } else if (kind === "incident_timeline") {
    string(body.symptom, "symptom");
    string(body.impact, "impact");
    if (Array.isArray(body.timeline)) {
      body.timeline.forEach((entry, index) => {
        if (entry && typeof entry === "object" && typeof entry.summary === "string" && entry.summary.trim()) {
          paths.push(`timeline[${index}].summary`);
        }
      });
    }
    if (!isExplicitlyUnknown(body.rootCause)) string(body.rootCause, "rootCause");
    for (const field of ["contributingFactors", "remediation", "prevention"]) strings(body[field], field);
    string(body.status, "status");
  } else {
    throw new Error(`Unsupported canary artifact kind: ${kind}`);
  }
  if (new Set(provenanceSessionIds).size > 1 && typeof body.joinRationale === "string" && body.joinRationale.trim()) {
    paths.push("joinRationale");
  }
  return paths;
}

export function isExplicitlyUnknown(value) {
  if (typeof value !== "string" || !value.trim()) return true;
  const normalized = normalizeWhitespace(value);
  return /^(?:(?:the )?root cause (?:is|remains) (?:unknown|undetermined|not (?:known|established|determined))(?: (?:from|based on) (?:the )?(?:available |current )?(?:canonical )?evidence)?|unknown (?:from|based on) (?:the )?(?:available |current )?(?:canonical )?evidence|(?:the )?(?:available |current )?(?:canonical )?evidence (?:does not establish|is insufficient to establish|cannot determine) (?:the )?root cause)[.!]?$/i.test(normalized);
}

function pathExists(value, path) {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) return false;
    current = current[part];
  }
  return current !== undefined;
}

const REHEARSAL_PROTOCOL_PHRASES = [
  "cursor pagination",
  "canonical evidence",
  "evidence manifest",
  "authoring run",
  "single provenance",
  "weak multi-session join",
  "published artifact"
];
const REHEARSAL_SELF_PROCESS_PATTERNS = [
  /\b(?:i|we)\s+(?:read|reviewed|inspected|processed)\s+(?:all|every)\s+(?:(?:canonical|available|provided|source)\s+)?(?:(?:evidence|source)\s+)?(?:items?|records?|entries?|evidence)\b[^.!?\n]{0,100}\b(?:kept|limited|restricted)\s+(?:all\s+|the\s+)?(?:claims?|assertions?)\b/i,
  /(?:^|[.!?]\s+|[-*]\s+)(?:(?:i|we)\s+)?(?:read|reviewed|inspect(?:ed)?|processed)\s+(?:all|every)\s+canonical\s+evidence(?:\s+items?)?\b[^.!?\n]{0,40}\b(?:through|using|via|with)\s+(?:cursor\s+)?pagination\b/i,
  /(?:^|[.!?]\s+|[-*]\s+)(?:(?:i|we)\s+)?(?:kept|keep|limited|restrict(?:ed)?)\s+(?:all\s+|the\s+)?(?:claims?|assertions?)\s+(?:to\s+)?(?:(?:a|one)\s+)?single[- ]session\b/i
];

function findProtocolLeaks(body, supports, evidence) {
  const leaks = [];
  for (const field of humanFacingStrings(body)) {
    const normalized = normalizeWhitespace(field.value).toLowerCase();
    for (const pattern of REHEARSAL_SELF_PROCESS_PATTERNS) {
      if (!pattern.test(normalized)) continue;
      if (!directlySupportedLanguage(field.path, supports, evidence, (excerpt) => pattern.test(excerpt.toLowerCase()))) {
        leaks.push({ path: field.path, phrase: "authoring self-process" });
      }
    }
    for (const phrase of REHEARSAL_PROTOCOL_PHRASES) {
      if (!normalized.includes(phrase)) continue;
      if (!directlySupportedLanguage(field.path, supports, evidence, (excerpt) => excerpt.toLowerCase().includes(phrase))) {
        leaks.push({ path: field.path, phrase });
      }
    }
  }
  return leaks;
}

function directlySupportedLanguage(path, supports, evidence, matches) {
  return supports.some((support) => {
    if (support.path !== path) return false;
    const excerpt = normalizeWhitespace(support.excerpt);
    return excerpt.length >= 20 && matches(excerpt) &&
      normalizeWhitespace(evidence.get(support.evidenceRef)?.text ?? "").includes(excerpt);
  });
}

function humanFacingStrings(body) {
  const excluded = new Set([
    "claimEvidence", "claimSupport", "confidence", "evidenceRefs", "missingEvidence",
    "provenanceSessionIds", "signatureKey"
  ]);
  const rows = [];
  const visit = (value, path, root) => {
    if (excluded.has(root)) return;
    if (typeof value === "string") rows.push({ path, value });
    else if (Array.isArray(value)) value.forEach((entry, index) => visit(entry, `${path}[${index}]`, root));
    else if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, entry]) => visit(entry, path ? `${path}.${key}` : key, root || key));
    }
  };
  Object.entries(body).forEach(([key, value]) => visit(value, key, key));
  return rows;
}

function findDuplicateSubstantiveArtifacts(optionalArtifacts, databasePath) {
  const db = openImmutableDatabase(databasePath);
  try {
    const select = db.prepare("SELECT content_json AS contentJson FROM session_artifacts WHERE artifact_id = ?");
    const entries = optionalArtifacts.map((artifact) => ({
      ...artifact,
      fingerprint: substantiveFingerprintForRehearsal(
        artifact.kind,
        JSON.parse(requiredString(select.get(artifact.artifactId)?.contentJson, `${artifact.artifactId} content`))
      )
    }));
    const duplicates = [];
    for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
        const left = entries[leftIndex];
        const right = entries[rightIndex];
        if (left.kind !== right.kind || left.fingerprint !== right.fingerprint) continue;
        const leftProvenance = new Set(left.provenanceSessionIds);
        if (right.provenanceSessionIds.some((sessionId) => leftProvenance.has(sessionId))) continue;
        duplicates.push({ artifactIds: [left.artifactId, right.artifactId], fingerprint: left.fingerprint });
      }
    }
    return duplicates;
  } finally {
    db.close();
  }
}

function substantiveFingerprintForRehearsal(kind, output) {
  const common = ["title", "summary", "context", "outcome", "decision", "rootCause"];
  const paths = kind === "runbook"
    ? [
        ...common, "problemSignature.symptoms", "problemSignature.errorStrings", "problemSignature.affectedScope",
        "preconditions", "reproSteps", "deadEnds", "fixSteps", "commands", "changedFiles", "validationChecks",
        "environmentRequirements", "preventionNotes", "risksOrGaps"
      ]
    : kind === "adr"
      ? [...common, "alternatives", "consequences", "affectedPaths", "supersedes"]
      : [...common, "symptom", "impact", "timeline", "contributingFactors", "remediation", "prevention", "status"];
  return JSON.stringify(paths.map((path) => normalizeSubstantiveValue(
    path === "timeline" ? substantiveTimeline(pathValue(output, path)) : pathValue(output, path)
  )));
}

function pathValue(value, path) {
  let current = value;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function substantiveTimeline(value) {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => entry && typeof entry === "object"
    ? { at: entry.at, summary: entry.summary }
    : entry);
}

function normalizeSubstantiveValue(value) {
  if (typeof value === "string") return normalizeWhitespace(value).toLowerCase();
  if (Array.isArray(value)) return value.map(normalizeSubstantiveValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeSubstantiveValue(entry)])
    );
  }
  return value ?? null;
}

function readPublishedCanaryCrossCheck(databasePath, candidateIds) {
  const db = openImmutableDatabase(databasePath);
  try {
    const placeholders = candidateIds.map(() => "?").join(",");
    const publishedCandidates = candidateIds.length === 0 ? 0 : Number(db.prepare(
      `SELECT COUNT(*) AS count FROM workbench_artifact_candidates
       WHERE candidate_id IN (${placeholders}) AND status = 'published'`
    ).get(...candidateIds).count);
    const completedRuns = candidateIds.length === 0 ? 0 : Number(db.prepare(
      `SELECT COUNT(*) AS count FROM workbench_authoring_runs
       WHERE candidate_id IN (${placeholders}) AND contract_version = 'workbench-authoring-v2'
         AND status = 'completed' AND receipt_json IS NOT NULL`
    ).get(...candidateIds).count);
    const totalPublishedCandidates = Number(db.prepare(
      "SELECT COUNT(*) AS count FROM workbench_artifact_candidates WHERE status = 'published'"
    ).get().count);
    const totalV2Runs = Number(db.prepare(
      "SELECT COUNT(*) AS count FROM workbench_authoring_runs WHERE contract_version = 'workbench-authoring-v2'"
    ).get().count);
    return { completedRuns, publishedCandidates, totalPublishedCandidates, totalV2Runs };
  } finally {
    db.close();
  }
}

async function dossierWorksheetRows(config, artifactIds) {
  let daemon;
  try {
    daemon = await startIsolatedDaemon(config, join(config.root, "bin", "mastheadctl"), "review-packet");
    const rows = [];
    for (const artifactId of artifactIds) {
      const response = await getJson(config, `/logbook/artifacts/${encodeURIComponent(artifactId)}`);
      const artifact = record(response.artifact, `dossier artifact ${artifactId}`);
      rows.push({
        artifactId,
        body: artifact.body,
        capsule: artifact.capsule,
        contentSha256: sha256Json(artifact.body),
        kind: "session_dossier",
        provenanceSessionIds: artifact.provenanceSessionIds,
        title: artifact.capsule?.title
      });
    }
    return rows;
  } finally {
    if (daemon) await stopDaemon(daemon);
  }
}

function emptyScores() {
  return { findability: null, grounding: null, readability: null, reusability: null, specificity: null };
}

async function callPackagedMcp(config, tool, args) {
  const requestId = `rehearsal:${tool}:${Date.now()}`;
  const initializeId = `${requestId}:initialize`;
  const initialize = JSON.stringify({
    id: initializeId,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "masthead-durable-rehearsal", version: "1" },
      protocolVersion: "2024-11-05"
    }
  });
  const initialized = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  const request = JSON.stringify({
    id: requestId,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: args, name: tool }
  });
  const result = await spawnCapture(config.nodePath, [config.mcpEntry], {
    cwd: config.root,
    env: { ...sanitizedBaseEnv(), ...buildIsolatedDaemonEnv(config, join(config.root, "bin", "mastheadctl")) },
    input: `${initialize}\n${initialized}\n${request}\n`,
    timeoutMs: 120_000
  });
  if (result.code !== 0) throw new Error(`Packaged MCP ${tool} failed: ${bounded(result.stderr)}`);
  const responses = result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
  const initialization = record(
    responses.find((entry) => entry?.id === initializeId),
    `MCP ${tool} initialization response`
  );
  assertEqual(initialization.result?.protocolVersion, "2024-11-05", `MCP ${tool} protocol version`);
  const response = record(responses.find((entry) => entry?.id === requestId), `MCP ${tool} response`);
  if (response.error) throw new Error(`Packaged MCP ${tool} error: ${JSON.stringify(response.error)}`);
  const content = record(response.result, `MCP ${tool} result`).content;
  if (!Array.isArray(content) || typeof content[0]?.text !== "string") throw new Error(`Packaged MCP ${tool} returned no text`);
  return JSON.parse(content[0].text);
}

function configFromOptions(options) {
  return {
    bundleRoot: requiredString(options.bundle, "--bundle"),
    expectedAuditHash: requiredString(options["audit-hash"], "--audit-hash"),
    expectedBuildSha: requiredString(options["build-sha"], "--build-sha"),
    expectedDatabaseId: requiredString(options["database-id"], "--database-id"),
    expectedLabelSha256: requiredString(options["labels-sha256"], "--labels-sha256"),
    expectedSampleSha256: requiredString(options["sample-sha256"], "--sample-sha256"),
    expectedSourceSha256: requiredString(options["source-sha256"], "--source-sha256"),
    labelsPath: requiredString(options.labels, "--labels"),
    port: options.port === undefined ? REHEARSAL_PORT : Number(options.port),
    root: requiredString(options.root, "--root"),
    samplePath: requiredString(options.sample, "--sample"),
    sourceBackup: requiredString(options["source-backup"], "--source-backup")
  };
}

function stateConfig(config) {
  return {
    bundleRoot: config.bundleRoot,
    expectedAuditHash: config.expectedAuditHash,
    expectedBuildSha: config.expectedBuildSha,
    expectedDatabaseId: config.expectedDatabaseId,
    expectedLabelSha256: config.expectedLabelSha256,
    expectedSampleSha256: config.expectedSampleSha256,
    expectedSourceSha256: config.expectedSourceSha256,
    labelsPath: config.labelsPath,
    port: config.port,
    root: config.root,
    samplePath: config.samplePath,
    sourceBackup: config.sourceBackup,
    buildVersion: config.buildVersion,
    bundleDigest: config.bundleDigest
  };
}

async function loadState(options) {
  const root = resolve(requiredString(options.root, "--root"));
  const temporaryRoot = resolve(tmpdir());
  const relativeRoot = relative(temporaryRoot, root);
  if (!relativeRoot || relativeRoot === ".." || relativeRoot.startsWith(`..${sep}`) || isAbsolute(relativeRoot)) {
    throw new Error("Stored rehearsal root is outside the temporary directory");
  }
  if (!basename(root).startsWith(REHEARSAL_ROOT_PREFIX)) throw new Error("Stored rehearsal root has an unsafe basename");
  await assertPrivateOwnedDirectory(root, "rehearsal root");
  const rawState = record(await readJson(join(root, "rehearsal-state.json")), "rehearsal state");
  if (rawState.stateVersion !== STATE_VERSION) throw new Error(`Unsupported rehearsal state version: ${rawState.stateVersion}`);
  const config = validateStaticRehearsalConfig(record(rawState.config, "stored rehearsal config"));
  assertEqual(config.root, root, "stored rehearsal root");
  await assertRootIdentity(config.root, rawState.rootIdentity);
  const manifest = await verifyCurrentBundle(config);
  assertEqual(manifest.bundleDigest, rawState.config.bundleDigest, "stored packaged bundle digest");
  assertEqual(manifest.release.version, rawState.config.buildVersion, "stored packaged version");
  config.buildVersion = rawState.config.buildVersion;
  config.bundleDigest = rawState.config.bundleDigest;
  config.rootIdentity = rawState.rootIdentity;
  config.sourceIdentity = record(rawState.evidence?.sourceIdentity, "stored external source identity");
  config.layoutIdentities = record(rawState.layoutIdentities, "stored rehearsal layout identities");
  await assertRehearsalLayout(config, config.layoutIdentities);
  const cliCommand = join(config.root, "bin", "mastheadctl");
  assertEqual(resolve(requiredString(rawState.cliCommand, "stored CLI command")), cliCommand, "stored CLI command");
  await assertRegularNonSymlink(cliCommand, "isolated CLI launcher");
  await access(cliCommand, constants.X_OK);
  await assertFileHash(cliCommand, requiredHash(rawState.cliSha256, "stored CLI SHA-256", 64), "isolated CLI launcher");
  assertEqual(await readFile(cliCommand, "utf8"), isolatedCliLauncherSource(config), "isolated CLI launcher content");
  await assertRegularNonSymlink(config.sourceBackup, "external source backup");
  await assertNoSidecars(config.sourceBackup);
  await assertImmutableFileIdentity(config.sourceBackup, config.sourceIdentity, "external source backup");
  await assertRegularNonSymlink(config.labelsPath, "stored label receipt");
  await assertRegularNonSymlink(config.samplePath, "stored sample receipt");
  await assertFileHash(config.labelsPath, config.expectedLabelSha256, "stored label receipt");
  await assertFileHash(config.samplePath, config.expectedSampleSha256, "stored sample receipt");
  await assertFileHash(config.sourceBackup, config.expectedSourceSha256, "stored external source backup");
  if (rawState.preparation) {
    await assertFileHash(
      join(config.root, "private", "original-dossiers.json"),
      requiredHash(rawState.preparation.originalDossiersSha256, "stored original dossier hash", 64),
      "stored original dossiers"
    );
  }
  if (rawState.canary) {
    await assertFileHash(
      join(config.root, "evidence", "06-candidate-report.json"),
      requiredHash(rawState.canary.reportSha256, "stored candidate report hash", 64),
      "stored candidate report"
    );
    await assertFileHash(
      join(config.root, "evidence", "authoring-queue.json"),
      requiredHash(rawState.canary.queueSha256, "stored authoring queue hash", 64),
      "stored authoring queue"
    );
  }
  if (rawState.machine) {
    await assertFileHash(
      join(config.root, "evidence", "07-machine-verification.json"),
      requiredHash(rawState.machine.reportSha256, "stored machine report hash", 64),
      "stored machine report"
    );
    await assertFileHash(
      join(config.root, "evidence", "08-human-review-packet.json"),
      requiredHash(rawState.machine.packetSha256, "stored human review packet hash", 64),
      "stored human review packet"
    );
    await assertFileHash(
      join(config.root, "evidence", "08-human-review-receipt-template.json"),
      requiredHash(rawState.machine.receiptTemplateSha256, "stored human review template hash", 64),
      "stored human review template"
    );
  }
  return { config, state: rawState };
}

function statePath(config) {
  return join(config.root, "rehearsal-state.json");
}

async function writeState(config, state) {
  const rootIdentity = state.rootIdentity ?? await immutableDirectoryIdentity(config.root);
  await writeJsonAtomic(statePath(config), { ...state, rootIdentity }, 0o600);
}

function assertPhase(state, allowed) {
  if (!allowed.includes(state.phase)) {
    throw new Error(`Rehearsal phase ${state.phase} is not allowed here; expected ${allowed.join(" or ")}`);
  }
}

function requireConfirmation(options) {
  if (options["confirm-temporary-only"] !== true) {
    throw new Error("Pass --confirm-temporary-only after verifying every path resolves beneath the isolated temporary root");
  }
}

async function verifyCurrentBundle(config) {
  await assertDirectoryNonSymlink(config.bundleRoot, "packaged bundle root");
  const executablePath = join(config.bundleRoot, process.platform === "win32" ? "masthead.exe" : "masthead");
  const manifest = await verifyPackagedBundleManifest({
    bundleRoot: config.bundleRoot,
    executablePath,
    resourcesPath: join(config.bundleRoot, "resources")
  });
  assertEqual(manifest.release.gitSha, config.expectedBuildSha, "packaged release SHA");
  return manifest;
}

async function runMaintenance(config, args) {
  assertMaintenancePaths(config, args);
  await assertRootIdentity(config.root, (await readJson(statePath(config)).catch(() => ({}))).rootIdentity, { optional: true });
  if (config.layoutIdentities) await assertRehearsalLayout(config, config.layoutIdentities);
  if (args[1] !== "audit-v1-generation") await assertWritableDatabaseIsolation(config);
  const result = await spawnCapture(config.nodePath, [config.cliEntry, ...args], {
    cwd: config.root,
    env: {
      ...sanitizedBaseEnv(),
      ...buildIsolatedDaemonEnv(config, join(config.root, "bin", "mastheadctl"))
    },
    timeoutMs: MAINTENANCE_TIMEOUT_MS
  });
  if (result.code !== 0) {
    throw new Error(`Packaged maintenance failed (${args.slice(0, 2).join(" ")}): ${bounded(result.stderr || result.stdout)}`);
  }
  const output = result.stdout.trim();
  if (!output) throw new Error(`Packaged maintenance returned no JSON: ${args.join(" ")}`);
  return JSON.parse(output);
}

function assertMaintenancePaths(config, args) {
  const command = args[1];
  const databasePath = resolve(requiredString(optionValueFromArgv(args, "--db"), "maintenance --db"));
  assertSafeRehearsalDatabasePath(databasePath);
  const readAllowed = new Set([config.activeDatabase, config.frozenDatabase, config.recoveryBackup]);
  if (command === "audit-v1-generation") {
    if (!readAllowed.has(databasePath)) throw new Error(`Maintenance audit path is outside the temporary database set: ${databasePath}`);
  } else {
    if (!new Set(["prepare-v1-recovery", "invalidate-v1-generation", "restore-v1-recovery"]).has(command)) {
      throw new Error(`Unsupported rehearsal maintenance command: ${command}`);
    }
    if (databasePath !== config.activeDatabase) {
      throw new Error(`Writable maintenance must target exactly ${config.activeDatabase}`);
    }
    if (command === "restore-v1-recovery") {
      const backupPath = resolve(requiredString(optionValueFromArgv(args, "--backup"), "restore --backup"));
      if (backupPath !== config.recoveryBackup) throw new Error(`Restore must use exactly ${config.recoveryBackup}`);
      assertSafeRehearsalDatabasePath(backupPath);
    }
  }
}

function optionValueFromArgv(args, name) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((arg) => typeof arg === "string" && arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function preflightConfig(config, options) {
  await assertTemporaryRoot(config.root, options.rootMustBeEmpty);
  await assertDirectoryNonSymlink(config.bundleRoot, "packaged bundle root");
  await assertRegularNonSymlink(config.sourceBackup, "source backup");
  await assertNoSidecars(config.sourceBackup);
  await assertRegularNonSymlink(config.labelsPath, "label receipt");
  await assertRegularNonSymlink(config.samplePath, "sample receipt");
  for (const path of [config.nodePath, config.cliEntry, config.daemonEntry, config.mcpEntry]) {
    await assertRegularNonSymlink(path, "packaged runtime file");
  }
  await access(config.nodePath, constants.X_OK);
  await assertPortAvailable(config.port);

  const sourceBefore = await immutableFileIdentity(config.sourceBackup);
  const [sourceSha256, labelSha256, sampleSha256] = await Promise.all([
    hashFile(config.sourceBackup),
    hashFile(config.labelsPath),
    hashFile(config.samplePath)
  ]);
  assertEqual(sourceSha256, config.expectedSourceSha256, "source backup SHA-256");
  assertEqual(labelSha256, config.expectedLabelSha256, "label receipt SHA-256");
  assertEqual(sampleSha256, config.expectedSampleSha256, "sample receipt SHA-256");
  await assertImmutableFileIdentity(config.sourceBackup, sourceBefore, "source backup");
  await assertNoSidecars(config.sourceBackup);
  const labels = await readJson(config.labelsPath);
  const sample = await readJson(config.samplePath);
  validateFrozenReceipts(sample, labels, config);

  const manifest = await verifyCurrentBundle(config);
  return {
    buildVersion: manifest.release.version,
    bundleDigest: manifest.bundleDigest,
    labelSha256,
    sampleSha256,
    sourceOpenedBySqlite: false,
    sourceSha256
  };
}

function readMigrationLedger(databasePath) {
  const db = openImmutableDatabase(databasePath);
  try {
    return db.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all();
  } finally {
    db.close();
  }
}

function openImmutableDatabase(databasePath) {
  assertSafeRehearsalDatabasePath(databasePath);
  assertNoSidecarsSync(databasePath);
  const databaseUrl = pathToFileURL(databasePath);
  databaseUrl.searchParams.set("immutable", "1");
  return new DatabaseSync(databaseUrl.href, { readOnly: true });
}

function assertNoSidecarsSync(databasePath) {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      lstatSync(`${databasePath}${suffix}`);
      throw new Error(`Database sidecar must be absent before immutable read: ${databasePath}${suffix}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function assertSafeRehearsalDatabasePath(databasePath) {
  const path = resolve(databasePath);
  const temporaryRoot = resolve(tmpdir());
  let rehearsalRoot;
  for (let cursor = dirname(path); cursor !== dirname(cursor); cursor = dirname(cursor)) {
    if (dirname(cursor) === temporaryRoot && basename(cursor).startsWith(REHEARSAL_ROOT_PREFIX)) {
      rehearsalRoot = cursor;
      break;
    }
  }
  if (!rehearsalRoot) throw new Error(`Database path is outside a direct temporary rehearsal root: ${path}`);
  const contained = relative(rehearsalRoot, path);
  if (!contained || contained === ".." || contained.startsWith(`..${sep}`) || isAbsolute(contained)) {
    throw new Error(`Database path escapes the temporary rehearsal root: ${path}`);
  }
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Rehearsal database must be a regular non-symlink file: ${path}`);
  }
  if (metadata.nlink !== 1) throw new Error(`Rehearsal database must have exactly one hard link: ${path}`);
  if (realpathSync(temporaryRoot) !== temporaryRoot || realpathSync(rehearsalRoot) !== rehearsalRoot) {
    throw new Error(`Rehearsal database has a symlinked root ancestor: ${path}`);
  }
  if (realpathSync(path) !== path) throw new Error(`Rehearsal database has a symlinked ancestor: ${path}`);
}

function assertCurrentLedger(rows) {
  if (!Array.isArray(rows) || rows.length !== EXPECTED_SCHEMA_VERSION) {
    throw new Error(`Migration ledger must contain exactly ${EXPECTED_SCHEMA_VERSION} rows`);
  }
  rows.forEach((row, index) => {
    assertEqual(Number(row.version), index + 1, `migration ledger version ${index + 1}`);
    requiredString(row.name, `migration ledger name ${index + 1}`);
  });
}

function readWholeDatabaseCounts(databasePath) {
  const db = openImmutableDatabase(databasePath);
  try {
    const count = (table) => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    return {
      artifacts: count("session_artifacts"),
      candidates: count("workbench_artifact_candidates"),
      provenance: count("session_artifact_provenance"),
      runs: count("workbench_authoring_runs"),
      searchRows: count("session_artifact_search"),
      sessions: count("sessions")
    };
  } finally {
    db.close();
  }
}

function assertWholeDatabaseBaseline(counts, label) {
  const expected = {
    artifacts: EXPECTED_V1_ARTIFACTS,
    candidates: 0,
    provenance: EXPECTED_V1_ARTIFACTS,
    runs: EXPECTED_V1_RUNS,
    searchRows: EXPECTED_V1_ARTIFACTS,
    sessions: EXPECTED_V1_ARTIFACTS
  };
  for (const [field, value] of Object.entries(expected)) assertEqual(counts[field], value, `${label} whole-database ${field}`);
}

function assertInvalidatedWholeDatabase(counts) {
  const expected = { artifacts: 0, candidates: 0, provenance: 0, runs: EXPECTED_V1_RUNS, searchRows: 0, sessions: EXPECTED_V1_ARTIFACTS };
  for (const [field, value] of Object.entries(expected)) assertEqual(counts[field], value, `invalidated whole-database ${field}`);
}

function readDatabaseIdentity(databasePath) {
  const db = openImmutableDatabase(databasePath);
  try {
    const row = db.prepare("SELECT setting_json AS value FROM app_settings WHERE setting_key = 'database_identity'").get();
    const value = record(JSON.parse(requiredString(row?.value, "database identity row")), "database identity");
    return requiredString(value.databaseId, "database identity");
  } finally {
    db.close();
  }
}

function readDatabaseIntegrity(databasePath) {
  const db = openImmutableDatabase(databasePath);
  try {
    return String(db.prepare("PRAGMA integrity_check").get().integrity_check ?? "");
  } finally {
    db.close();
  }
}

function readPendingCandidateIds(databasePath, options = {}) {
  assertSafeRehearsalDatabasePath(databasePath);
  const db = options.liveWriter
    ? new DatabaseSync(databasePath, { readOnly: true })
    : openImmutableDatabase(databasePath);
  try {
    return db.prepare("SELECT candidate_id AS candidateId FROM workbench_artifact_candidates WHERE status = 'pending' ORDER BY candidate_id")
      .all().map((row) => row.candidateId);
  } finally {
    db.close();
  }
}

function validateLabelEvidenceRefs(databasePath, labelsValue) {
  const labels = record(labelsValue, "label receipt");
  const db = openImmutableDatabase(databasePath);
  try {
    const sources = {
      message: ["messages", "message_id"],
      tool_call: ["tool_calls", "tool_call_id"],
      tool_result: ["tool_results", "tool_result_id"],
      checkpoint: ["checkpoints", "checkpoint_id"],
      signal: ["runtime_signals", "signal_id"],
      file: ["file_effects", "file_effect_id"]
    };
    for (const labelValue of labels.rows) {
      const label = record(labelValue, "label row");
      if (label.expectedCandidate !== true) continue;
      const sessionId = requiredString(label.sessionId, "positive label session");
      for (const ref of normalizedStrings(label.evidenceRefs)) {
        const separator = ref.indexOf(":");
        const prefix = separator > 0 ? ref.slice(0, separator) : "";
        const id = separator > 0 ? ref.slice(separator + 1) : "";
        const source = sources[prefix];
        if (!source || !id) throw new Error(`Positive label has invalid evidence ref: ${ref}`);
        const found = db.prepare(`SELECT 1 AS found FROM ${source[0]} WHERE ${source[1]} = ? AND session_id = ?`).get(id, sessionId);
        if (!found) throw new Error(`Positive label evidence ref is not canonical for ${sessionId}: ${ref}`);
      }
    }
  } finally {
    db.close();
  }
}

function assertRestoreReceipt(value, config) {
  const receipt = record(value, "restore receipt");
  const expected = {
    artifactsRestored: EXPECTED_V1_ARTIFACTS,
    auditHash: config.expectedAuditHash,
    backupPath: config.recoveryBackup,
    backupPreserved: true,
    databaseId: config.expectedDatabaseId,
    integrityResult: "ok",
    runsRestored: EXPECTED_V1_RUNS,
    sessionsRestored: EXPECTED_V1_ARTIFACTS
  };
  assertExactObject(receipt, expected, "restore receipt");
}

async function assertOnlyRecoveryBackup(config) {
  const names = (await readdir(config.root)).filter((name) => name.startsWith("masthead.sqlite.backup-")).sort();
  assertExactIds(names, [basename(config.recoveryBackup)], "retained recovery backups");
}

async function writeEvidence(config, name, value) {
  if (config.layoutIdentities) await assertRehearsalLayout(config, config.layoutIdentities);
  await writeJsonAtomic(join(config.root, "evidence", name), value, 0o600);
}

async function writeEvidenceManifest(config) {
  if (config.layoutIdentities) await assertRehearsalLayout(config, config.layoutIdentities);
  const directory = join(config.root, "evidence");
  const files = (await readdir(directory)).sort();
  const entries = [];
  for (const file of files) {
    if (file === "manifest.json") continue;
    const path = join(directory, file);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Evidence entry is not a regular file: ${path}`);
    entries.push({ file, sha256: await hashFile(path), sizeBytes: metadata.size });
  }
  await writeJsonAtomic(join(directory, "manifest.json"), {
    bundleDigest: config.bundleDigest,
    databaseId: config.expectedDatabaseId,
    entries,
    generatedAt: new Date().toISOString(),
    releaseSha: config.expectedBuildSha
  }, 0o600);
}

async function writeJsonAtomic(path, value, mode = 0o600) {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", mode);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readJson(path) {
  await assertRegularNonSymlink(path, "JSON input");
  return JSON.parse(await readFile(path, "utf8"));
}

async function hashFile(path) {
  await assertRegularNonSymlink(path, "hashed input");
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", () => resolvePromise());
    stream.once("error", reject);
  });
  return hash.digest("hex");
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(sortDeep(value))).digest("hex");
}

async function assertFileHash(path, expected, label) {
  const before = await immutableFileIdentity(path);
  assertEqual(await hashFile(path), expected, `${label} SHA-256`);
  await assertImmutableFileIdentity(path, before, label);
}

async function immutableFileIdentity(path) {
  const canonicalPath = resolve(path);
  const value = await lstat(canonicalPath, { bigint: true });
  if (!value.isFile() || value.isSymbolicLink()) throw new Error(`Expected regular non-symlink file: ${canonicalPath}`);
  if (await realpath(canonicalPath) !== canonicalPath) {
    throw new Error(`Expected path without symlinked ancestors: ${canonicalPath}`);
  }
  return {
    ctimeNs: value.ctimeNs.toString(),
    dev: value.dev.toString(),
    ino: value.ino.toString(),
    mode: value.mode.toString(),
    mtimeNs: value.mtimeNs.toString(),
    nlink: value.nlink.toString(),
    size: value.size.toString()
  };
}

async function assertWritableDatabaseIsolation(config) {
  const paths = [config.activeDatabase, config.frozenDatabase, config.sourceBackup];
  if (await filesystemPathExists(config.recoveryBackup)) paths.push(config.recoveryBackup);
  const identities = [];
  for (const path of paths) {
    await assertRegularNonSymlink(path, "rehearsal database isolation input");
    await assertNoSidecars(path);
    const identity = await immutableFileIdentity(path);
    if (path === config.sourceBackup && config.sourceIdentity && JSON.stringify(identity) !== JSON.stringify(config.sourceIdentity)) {
      throw new Error("External source backup identity changed or was replaced");
    }
    if (identity.nlink !== "1") throw new Error(`Rehearsal database must have exactly one hard link: ${path}`);
    const key = `${identity.dev}:${identity.ino}`;
    if (identities.some((entry) => entry.key === key)) {
      throw new Error(`Rehearsal database paths alias the same inode: ${path}`);
    }
    identities.push({ key, path });
  }
  return identities;
}

async function immutableDirectoryIdentity(path) {
  const canonicalPath = resolve(path);
  const value = await lstat(canonicalPath, { bigint: true });
  if (!value.isDirectory() || value.isSymbolicLink()) throw new Error(`Expected regular non-symlink directory: ${canonicalPath}`);
  if (await realpath(canonicalPath) !== canonicalPath) {
    throw new Error(`Expected directory without symlinked ancestors: ${canonicalPath}`);
  }
  return { dev: value.dev.toString(), ino: value.ino.toString() };
}

async function assertImmutableFileIdentity(path, expected, label) {
  const actual = await immutableFileIdentity(path);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} changed during rehearsal`);
}

async function assertSourceUnchanged(config, before) {
  await assertImmutableFileIdentity(config.sourceBackup, before, "external source backup");
  await assertFileHash(config.sourceBackup, config.expectedSourceSha256, "external source backup after staging");
  await assertNoSidecars(config.sourceBackup);
}

async function assertRootIdentity(root, expected, options = {}) {
  if (!expected && options.optional) return;
  const actual = await immutableDirectoryIdentity(root);
  if (!expected || actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error("Rehearsal root identity changed or was replaced");
  }
}

async function assertRegularNonSymlink(path, label) {
  const canonicalPath = resolve(path);
  const value = await lstat(canonicalPath);
  if (!value.isFile() || value.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file: ${canonicalPath}`);
  if (await realpath(canonicalPath) !== canonicalPath) {
    throw new Error(`${label} has a symlinked ancestor: ${canonicalPath}`);
  }
}

async function assertDirectoryNonSymlink(path, label) {
  const canonicalPath = resolve(path);
  const value = await lstat(canonicalPath);
  if (!value.isDirectory() || value.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink directory: ${canonicalPath}`);
  if (await realpath(canonicalPath) !== canonicalPath) {
    throw new Error(`${label} has a symlinked ancestor: ${canonicalPath}`);
  }
}

async function assertPrivateOwnedDirectory(path, label) {
  await assertDirectoryNonSymlink(path, label);
  const metadata = await lstat(path);
  const uid = process.getuid?.();
  if (uid === undefined || metadata.uid !== uid) {
    throw new Error(`${label} must be owned by the current UID: ${resolve(path)}`);
  }
  if ((metadata.mode & 0o777) !== 0o700) {
    throw new Error(`${label} must have exact mode 0700: ${resolve(path)}`);
  }
}

async function assertRehearsalLayout(config, expectedIdentities) {
  const paths = {
    bin: join(config.root, "bin"),
    codexHome: join(config.root, "codex-home"),
    evidence: join(config.root, "evidence"),
    frozenV1: dirname(config.frozenDatabase),
    home: join(config.root, "home"),
    legacy: join(config.root, "legacy"),
    private: join(config.root, "private")
  };
  const identities = {};
  for (const [name, path] of Object.entries(paths)) {
    await assertPrivateOwnedDirectory(path, `rehearsal ${name} directory`);
    identities[name] = await immutableDirectoryIdentity(path);
    if (expectedIdentities && JSON.stringify(identities[name]) !== JSON.stringify(expectedIdentities[name])) {
      throw new Error(`Rehearsal ${name} directory identity changed or was replaced`);
    }
  }
  return identities;
}

async function assertTemporaryRoot(root, mustBeEmpty) {
  const canonicalRoot = resolve(root);
  const temporaryRoot = resolve(tmpdir());
  if (dirname(canonicalRoot) !== temporaryRoot || await realpath(temporaryRoot) !== temporaryRoot) {
    throw new Error(`Temporary rehearsal root must be a direct child of the canonical temporary directory: ${temporaryRoot}`);
  }
  try {
    const value = await lstat(canonicalRoot);
    if (!value.isDirectory() || value.isSymbolicLink()) throw new Error(`Temporary rehearsal root is not a regular directory: ${canonicalRoot}`);
    if (await realpath(canonicalRoot) !== canonicalRoot) throw new Error(`Temporary rehearsal root has a symlinked ancestor: ${canonicalRoot}`);
    await assertPrivateOwnedDirectory(canonicalRoot, "temporary rehearsal root");
    if (mustBeEmpty && (await readdir(canonicalRoot)).length > 0) throw new Error(`Temporary rehearsal root must be empty: ${canonicalRoot}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function assertPathAbsent(path, label) {
  try {
    await lstat(path);
    throw new Error(`${label} already exists: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function filesystemPathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertNoSidecars(databasePath) {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      await lstat(`${databasePath}${suffix}`);
      throw new Error(`Database sidecar must be absent: ${databasePath}${suffix}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function assertPortAvailable(port) {
  await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolvePromise));
  });
}

async function getJson(config, pathname) {
  return requestJson(config, "GET", pathname);
}

async function postJson(config, pathname, body) {
  return requestJson(config, "POST", pathname, body);
}

async function requestJson(config, method, pathname, body) {
  const response = await fetch(`${baseUrl(config)}${pathname}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    method,
    signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS)
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${method} ${pathname} returned non-JSON HTTP ${response.status}: ${bounded(text)}`);
  }
  if (!response.ok) throw new Error(`${method} ${pathname} failed HTTP ${response.status}: ${bounded(JSON.stringify(parsed))}`);
  return parsed;
}

function baseUrl(config) {
  return `http://127.0.0.1:${config.port}`;
}

function sanitizedBaseEnv() {
  const env = {
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || "C.UTF-8",
    NODE_ENV: "production",
    PATH: process.env.PATH || "/usr/bin:/bin",
    TMPDIR: tmpdir(),
    TZ: process.env.TZ || "UTC"
  };
  if (process.env.LD_LIBRARY_PATH) env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH;
  return env;
}

async function spawnCapture(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    let timedOut = false;
    let forcedTermination = false;
    let forceTimer;
    const cleanupTimers = () => {
      clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
    };
    child.once("error", (error) => {
      cleanupTimers();
      reject(error);
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          forcedTermination = child.kill("SIGKILL");
        }
      }, DAEMON_STOP_GRACE_MS);
    }, options.timeoutMs);
    child.once("close", (code, signal) => {
      cleanupTimers();
      if (timedOut) {
        reject(new Error(
          `Process timed out after ${options.timeoutMs}ms and was reaped${forcedTermination ? " with SIGKILL" : ""}: ${command}`
        ));
        return;
      }
      resolvePromise({ code: code ?? 1, signal, stderr, stdout });
    });
    if (options.input !== undefined) child.stdin.end(options.input);
  });
}

function waitForOperatorSignal() {
  return new Promise((resolvePromise) => {
    const finish = () => {
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      resolvePromise();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected positional argument: ${arg}`);
    const equals = arg.indexOf("=");
    const key = arg.slice(2, equals >= 0 ? equals : undefined);
    if (!key) throw new Error("Empty option name");
    if (key === "confirm-temporary-only") {
      options[key] = true;
      continue;
    }
    const value = equals >= 0 ? arg.slice(equals + 1) : args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    if (key in options) throw new Error(`Duplicate option: --${key}`);
    options[key] = value;
  }
  return options;
}

function rehearsalHelp() {
  return [
    "Usage: npm run rehearse:durable-artifacts -- <phase> [options]",
    "",
    "Phases:",
    "  preflight             validate immutable bundle, external backup bytes, sample, labels, and port",
    "  stage                 copy source bytes into the temporary root; audit only temporary copies",
    "  migrate-invalidate    migrate, prepare rollback, then invalidate only the temporary active DB",
    "  publish-discover      publish 25 canonical dossiers and complete all 13 discovery passes",
    "  serve-authoring       run the isolated daemon until SIGINT/SIGTERM for manual candidate authoring",
    "  verify                run machine verification and emit the human review packet",
    "  human-review          validate an externally retained, real-human signed review receipt",
    "  restore               restore the temporary DB and export all evidence outside the root",
    "",
    "preflight/stage require: --root --bundle --source-backup --source-sha256 --build-sha",
    "  --database-id --audit-hash --sample --sample-sha256 --labels --labels-sha256",
    `--root must be a mode-0700 direct child of ${resolve(tmpdir())} named ${REHEARSAL_ROOT_PREFIX}*.`,
    "All mutating phases require --confirm-temporary-only; later phases require --root.",
    "human-review additionally requires --receipt and --receipt-sha256.",
    "restore additionally requires --evidence-export outside the temporary root under an existing mode-0700 parent."
  ].join("\n");
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function requiredOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredHash(value, label, length) {
  const hash = requiredString(value, label).toLowerCase();
  if (!new RegExp(`^[a-f0-9]{${length}}$`, "u").test(hash)) throw new Error(`${label} must be a ${length}-character lowercase hex hash`);
  return hash;
}

function requireIsoTimestamp(value, label) {
  const timestamp = requiredString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return timestamp;
}

function normalizedStrings(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))]
    : [];
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function exactFieldsMatch(actual, expected) {
  return actual && typeof actual === "object" &&
    Object.entries(expected).every(([field, value]) => actual[field] === value);
}

function assertExactIds(actualValue, expectedValue, label) {
  const actual = normalizedStrings(actualValue).sort();
  const expected = normalizedStrings(expectedValue).sort();
  if (!Array.isArray(actualValue) || actual.length !== actualValue.length) throw new Error(`${label}: actual IDs contain blanks or duplicates`);
  if (!Array.isArray(expectedValue) || expected.length !== expectedValue.length) throw new Error(`${label}: expected IDs contain blanks or duplicates`);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertExactObject(actual, expected, label) {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${label} fields mismatch: expected ${expectedKeys.join(",")}, got ${actualKeys.join(",")}`);
  }
  for (const [field, value] of Object.entries(expected)) assertEqual(actual[field], value, `${label}.${field}`);
}

function assertOutside(root, path, message) {
  const rel = relative(resolve(root), resolve(path));
  if (!rel || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) throw new Error(message);
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortDeep(entry)]));
  }
  return value;
}

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

function bounded(value, limit = 2_000) {
  const text = String(value ?? "").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function isMainModule() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href);
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).then((result) => {
    if (result.help) process.stdout.write(`${result.help}\n`);
    else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      productionAccessed: false
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
