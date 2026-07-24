import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { backup, DatabaseSync } from "node:sqlite";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ExclusiveDatabaseMaintenance, withExclusiveDatabaseMaintenance } from "./databaseBackup.ts";
import { CURRENT_SCHEMA_VERSION, migrateDatabase, validateCurrentDatabaseSchema } from "./db/schema.ts";
import { initializeSessionTranscriptFingerprintIndex } from "./db/sessionTranscriptFingerprintIndex.ts";
import { quickCheckMastheadDatabase } from "./db/sqlite.ts";
import { runLegacyWorkbenchPublicationBackfill } from "../workbench/legacyPublicationBackfill.ts";

export type ProductionBundleIdentity = {
  bundleDigest: string;
  gitSha: string;
  target: string;
  version: string;
};

export type ProductionTransitionState =
  | "snapshot_ready"
  | "ready_to_activate"
  | "restoring"
  | "restore_failed"
  | "restored";

export type ProductionTransitionPreparePhase =
  | "backup_copied"
  | "backup_verified"
  | "migration_stage_complete"
  | "post_migration_verified"
  | "ready_to_activate";

type DurableFileIdentity = {
  ctimeNs: string;
  device: string;
  inode: string;
  mtimeNs: string;
  sizeBytes: number;
};

type ProductionTransitionReceiptBase = {
  databaseId: string;
  databasePath: string;
  newBundle: ProductionBundleIdentity;
  nonce: string;
  preparePhase?: ProductionTransitionPreparePhase;
  preparedDatabaseIdentity?: DurableFileIdentity;
  snapshot: {
    fileIdentity?: DurableFileIdentity;
    path: string;
    sha256: string | null;
    sizeBytes: number;
    stagePath?: string;
  };
  sourceMigrationLedger: Array<{ name: string; version: number }>;
  sourceSchemaFingerprint: string;
  sourceSchemaVersion: number;
  state: ProductionTransitionState;
  targetSchemaVersion: number;
  updatedAt: string;
};

export type LegacyProductionTargetIdentity = {
  device: string;
  inode: string;
  path: string;
};

export type ProductionTransitionReceipt = ProductionTransitionReceiptBase & ({
  oldBundle: ProductionBundleIdentity;
  schemaVersion: 1;
} | {
  legacyTarget: LegacyProductionTargetIdentity;
  rollbackMode: "offline_only";
  schemaVersion: 2;
});

export type ProductionTransitionInput = {
  databasePath: string;
  newBundle: ProductionBundleIdentity;
  nonce: string;
} & ({
  oldBundle: ProductionBundleIdentity;
  rollbackMode?: undefined;
} | {
  legacyTarget: LegacyProductionTargetIdentity;
  rollbackMode: "offline_only";
});

export type ProductionTransitionBoundary =
  | "source_verified"
  | "backup_copy_started"
  | "backup_copied"
  | "backup_verified"
  | "backup_finalized"
  | "snapshot_hashed"
  | "snapshot_ready"
  | "after_migrate"
  | "migration_stage_complete"
  | "post_migration_verified"
  | "ready_to_activate"
  | "before_restore_promotion"
  | "after_restore_promotion"
  | "restored";

export type ProductionTransitionOptions = {
  onBoundary?: (boundary: ProductionTransitionBoundary, database?: DatabaseSync) => void;
  onFullIntegrityCheck?: (databasePath: string) => void;
  simulateProcessDeathAfterPhase?: ProductionTransitionPreparePhase;
};

export type ProductionTransitionPreflightResult = {
  batches: number;
  databaseId: string;
  fingerprintsPopulated: number;
  legacyCandidates: number;
  state: "ready_to_activate";
};

export function productionTransitionJournalPath(databasePath: string): string {
  return `${resolve(databasePath)}.production-transition.json`;
}

export async function prepareProductionTransition(
  inputValue: ProductionTransitionInput,
  options: ProductionTransitionOptions = {}
): Promise<ProductionTransitionReceipt> {
  const input = validateInput(inputValue);
  return withExclusiveDatabaseMaintenance(input.databasePath, async (ownership) => {
    let receipt: ProductionTransitionReceipt;
    const journalExists = await lstat(productionTransitionJournalPath(input.databasePath))
      .then(() => true)
      .catch((error) => {
        if (isErrno(error, "ENOENT")) return false;
        throw error;
      });
    if (journalExists) {
      receipt = await readAndValidateJournal(input);
      if (!["snapshot_ready", "ready_to_activate"].includes(receipt.state)) {
        throw new Error(`transition_prepare_resume_state_invalid:${receipt.state}`);
      }
      receipt.preparePhase = normalizedPreparePhase(receipt);
      await cleanupAbandonedMigrationStagesInsideOwnership(input.databasePath, receipt.snapshot.stagePath);
    } else {
      await assertCleanTransitionBoundary(input.databasePath);
      const activeBefore = verifyDatabase(input.databasePath);
      options.onBoundary?.("source_verified");
      const adoptedStagePath = await findAdoptableRecoveryStage(input.databasePath, activeBefore);
      await cleanupAbandonedMigrationStagesInsideOwnership(input.databasePath, adoptedStagePath);
      const adoptedSnapshotPath = adoptedStagePath ?? await findAdoptableCurrentBackup(input.databasePath, activeBefore);
      const stagePath = adoptedSnapshotPath ?? receiptOwnedRecoveryStagePath(input.databasePath, input.nonce);
      if (!adoptedSnapshotPath) {
        options.onBoundary?.("backup_copy_started");
        await copySnapshotToStage(input.databasePath, stagePath, ownership);
      }
      const stageIdentity = await captureDurableFileIdentity(stagePath, "transition_snapshot_stage_invalid");
      receipt = {
        databaseId: activeBefore.databaseId,
        databasePath: input.databasePath,
        newBundle: input.newBundle,
        nonce: input.nonce,
        ...(input.rollbackMode === "offline_only"
          ? { legacyTarget: input.legacyTarget }
          : { oldBundle: input.oldBundle }),
        ...(input.rollbackMode === "offline_only"
          ? { rollbackMode: "offline_only" as const, schemaVersion: 2 as const }
          : { schemaVersion: 1 as const }),
        snapshot: {
          fileIdentity: stageIdentity,
          path: finalSnapshotPath(input.databasePath),
          sha256: null,
          sizeBytes: stageIdentity.sizeBytes,
          stagePath
        },
        sourceMigrationLedger: activeBefore.migrationLedger,
        sourceSchemaFingerprint: activeBefore.schemaFingerprint,
        sourceSchemaVersion: activeBefore.schemaVersion,
        preparePhase: "backup_copied",
        state: "snapshot_ready",
        targetSchemaVersion: CURRENT_SCHEMA_VERSION,
        updatedAt: new Date().toISOString()
      } as ProductionTransitionReceipt;
      await checkpointPreparePhase(receipt, "backup_copied", options);
    }
    receipt = await ensureVerifiedSnapshot(receipt, ownership, options);
    const phase = normalizedPreparePhase(receipt);
    if (phase === "ready_to_activate") {
      await assertPreparedReceiptUnchanged(receipt);
      validatePreparedDatabase(input.databasePath);
      return receipt;
    }
    try {
      if (normalizedPreparePhase(receipt) === "backup_verified") {
        const active = verifyDatabase(input.databasePath);
        if (!matchesSourceDatabase(active, receipt) && !matchesTargetDatabase(active, receipt)) {
          throw new Error("transition_resume_database_mismatch");
        }
        const database = new DatabaseSync(input.databasePath);
        try {
          database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
          if (active.schemaVersion !== CURRENT_SCHEMA_VERSION) migrateDatabase(database);
          runPreListenStartupPreflight(database);
          options.onBoundary?.("after_migrate", database);
        } finally {
          database.close();
        }
        await checkpointPreparePhase(receipt, "migration_stage_complete", options);
      }
      if (normalizedPreparePhase(receipt) === "migration_stage_complete") {
        const migrated = verifyDatabase(input.databasePath, { foreignKeys: true });
        if (migrated.databaseId !== receipt.databaseId) throw new Error("transition_migrated_identity_mismatch");
        if (migrated.schemaVersion !== CURRENT_SCHEMA_VERSION) throw new Error("transition_target_schema_mismatch");
        validatePreparedDatabase(input.databasePath);
        receipt.preparedDatabaseIdentity = await captureDurableFileIdentity(
          input.databasePath,
          "transition_prepared_database_invalid"
        );
        await checkpointPreparePhase(receipt, "post_migration_verified", options);
      }
      if (normalizedPreparePhase(receipt) === "post_migration_verified") {
        await assertPreparedReceiptUnchanged(receipt);
        receipt.state = "ready_to_activate";
        await checkpointPreparePhase(receipt, "ready_to_activate", options);
      }
      return receipt;
    } catch (error) {
      if (isSimulatedProcessDeath(error)) throw error;
      try {
        await restoreSnapshotInsideOwnership(receipt, ownership, options, "database");
        await rm(productionTransitionJournalPath(input.databasePath), { force: true });
      } catch (restoreError) {
        receipt.state = "restore_failed";
        receipt.updatedAt = new Date().toISOString();
        await writeJournal(receipt);
        throw new Error(
          `${errorMessage(error)}; transition restore failed: ${errorMessage(restoreError)}`,
          { cause: error }
        );
      }
      throw error;
    }
  });
}

export async function preflightProductionTransition(
  inputValue: ProductionTransitionInput
): Promise<ProductionTransitionPreflightResult> {
  const input = validateInput(inputValue);
  return withExclusiveDatabaseMaintenance(input.databasePath, async () => {
    const receipt = await readAndValidateJournal(input);
    if (receipt.state !== "ready_to_activate") {
      throw new Error(`transition_preflight_state_invalid:${receipt.state}`);
    }
    const database = new DatabaseSync(input.databasePath);
    try {
      database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
      validateCurrentDatabaseSchema(database);
      const identity = database.prepare(
        "SELECT setting_json AS value FROM app_settings WHERE setting_key = 'database_identity'"
      ).get() as { value: string } | undefined;
      const databaseId = parseDatabaseId(identity?.value);
      if (databaseId !== receipt.databaseId) throw new Error("transition_preflight_identity_mismatch");
      const result = runPreListenStartupPreflight(database);
      quickCheckMastheadDatabase(database);
      validateCurrentDatabaseSchema(database);
      const foreignKeyFailures = database.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeyFailures.length > 0) {
        throw new Error(`transition_preflight_foreign_key_check_failed:${JSON.stringify(foreignKeyFailures.slice(0, 10))}`);
      }
      return {
        batches: result.fingerprints.batches,
        databaseId,
        fingerprintsPopulated: result.fingerprints.fingerprintsPopulated,
        legacyCandidates: result.legacy.totalCandidates,
        state: "ready_to_activate"
      };
    } finally {
      database.close();
    }
  });
}

function runPreListenStartupPreflight(database: DatabaseSync) {
  return {
    fingerprints: initializeSessionTranscriptFingerprintIndex(database),
    legacy: runLegacyWorkbenchPublicationBackfill(database)
  };
}

export async function restoreProductionTransition(
  inputValue: ProductionTransitionInput,
  options: ProductionTransitionOptions = {}
): Promise<ProductionTransitionReceipt> {
  const input = validateInput(inputValue);
  return withExclusiveDatabaseMaintenance(input.databasePath, async (ownership) => {
    let receipt = await readAndValidateJournal(input);
    await cleanupAbandonedMigrationStagesInsideOwnership(input.databasePath, receipt.snapshot.stagePath);
    if (!["snapshot_ready", "ready_to_activate", "restoring", "restore_failed", "restored"].includes(receipt.state)) {
      throw new Error(`transition_restore_state_invalid:${receipt.state}`);
    }
    if (receipt.state === "restored") {
      const active = verifyDatabase(input.databasePath, { foreignKeys: true });
      if (!matchesSourceDatabase(active, receipt)) throw new Error("transition_restored_database_mismatch");
      return receipt;
    }
    if (["snapshot_ready", "ready_to_activate"].includes(receipt.state)) {
      receipt = await ensureVerifiedSnapshot(receipt, ownership, options);
    }
    await restoreSnapshotInsideOwnership(
      receipt,
      ownership,
      options,
      receipt.state === "restoring" ? "receipt" : "full"
    );
    return receipt;
  });
}

function finalSnapshotPath(databasePath: string): string {
  return join(dirname(databasePath), `${basename(databasePath)}.backup-current`);
}

function receiptOwnedRecoveryStagePath(databasePath: string, nonce: string): string {
  return join(dirname(databasePath), `.${basename(databasePath)}.recovery-stage-${nonce}`);
}

function normalizedPreparePhase(receipt: ProductionTransitionReceipt): ProductionTransitionPreparePhase {
  if (receipt.state === "snapshot_ready" && receipt.preparePhase === "ready_to_activate") {
    return "post_migration_verified";
  }
  if (receipt.preparePhase) return receipt.preparePhase;
  return receipt.state === "ready_to_activate" ? "ready_to_activate" : "backup_verified";
}

async function checkpointPreparePhase(
  receipt: ProductionTransitionReceipt,
  phase: ProductionTransitionPreparePhase,
  options: ProductionTransitionOptions
): Promise<void> {
  receipt.preparePhase = phase;
  receipt.updatedAt = new Date().toISOString();
  await writeJournal(receipt);
  options.onBoundary?.(phase);
  if (options.simulateProcessDeathAfterPhase === phase) {
    const error = new Error(`simulated_production_transition_process_death:${phase}`) as Error & { code?: string };
    error.code = "simulated_production_transition_process_death";
    throw error;
  }
}

function isSimulatedProcessDeath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    error.code === "simulated_production_transition_process_death";
}

async function copySnapshotToStage(
  databasePath: string,
  stagePath: string,
  ownership: ExclusiveDatabaseMaintenance
): Promise<void> {
  if (ownership.databasePath !== databasePath) throw new Error("transition_snapshot_ownership_mismatch");
  await rmDatabase(stagePath);
  const source = new DatabaseSync(databasePath, { readOnly: true });
  try {
    await backup(source, stagePath);
  } finally {
    source.close();
  }
  normalizeJournal(stagePath);
}

async function ensureVerifiedSnapshot(
  receipt: ProductionTransitionReceipt,
  ownership: ExclusiveDatabaseMaintenance,
  options: ProductionTransitionOptions
): Promise<ProductionTransitionReceipt> {
  if (ownership.databasePath !== receipt.databasePath) throw new Error("transition_snapshot_ownership_mismatch");
  let phase = normalizedPreparePhase(receipt);
  if (!receipt.snapshot.fileIdentity) {
    await verifySnapshot(receipt, options, "receipt");
    receipt.snapshot.fileIdentity = await captureDurableFileIdentity(
      receipt.snapshot.path,
      "transition_snapshot_path_invalid"
    );
  }
  let snapshotLocation = await locateReceiptSnapshot(receipt);
  if (phase === "backup_copied") {
    options.onFullIntegrityCheck?.(snapshotLocation);
    const verified = verifyDatabase(snapshotLocation, { fullIntegrity: true });
    if (!matchesSourceDatabase(verified, receipt)) throw new Error("transition_snapshot_database_mismatch");
    receipt.snapshot.sha256 = await hashFile(snapshotLocation);
    options.onBoundary?.("snapshot_hashed");
    receipt.snapshot.fileIdentity = await captureDurableFileIdentity(
      snapshotLocation,
      "transition_snapshot_path_invalid"
    );
    await checkpointPreparePhase(receipt, "backup_verified", options);
    phase = "backup_verified";
  }
  snapshotLocation = await locateReceiptSnapshot(receipt);
  if (snapshotLocation !== receipt.snapshot.path) {
    await removeSidecars(receipt.snapshot.path);
    await rename(snapshotLocation, receipt.snapshot.path);
    snapshotLocation = receipt.snapshot.path;
    const promotedIdentity = await captureDurableFileIdentity(
      snapshotLocation,
      "transition_snapshot_path_invalid"
    );
    assertSamePromotedFile(receipt.snapshot.fileIdentity, promotedIdentity);
    receipt.snapshot.fileIdentity = promotedIdentity;
    await writeJournal(receipt);
    await retainOnlyCurrentBackup(receipt.databasePath);
  }
  options.onBoundary?.("backup_finalized");
  return receipt;
}

async function locateReceiptSnapshot(receipt: ProductionTransitionReceipt): Promise<string> {
  if (!receipt.snapshot.fileIdentity) throw new Error("transition_snapshot_identity_missing");
  let mismatch = false;
  for (const candidate of [receipt.snapshot.path, receipt.snapshot.stagePath].filter((value): value is string => Boolean(value))) {
    try {
      await assertDurableFileIdentity(candidate, receipt.snapshot.fileIdentity, "transition_snapshot_receipt_mismatch");
      return candidate;
    } catch (error) {
      if (isErrno(error, "ENOENT")) continue;
      if (error instanceof Error && error.message === "transition_snapshot_path_missing") continue;
      if (error instanceof Error && error.message === "transition_snapshot_receipt_mismatch") {
        mismatch = true;
        continue;
      }
      throw error;
    }
  }
  if (mismatch) throw new Error("transition_snapshot_receipt_mismatch");
  throw new Error("transition_snapshot_path_missing");
}

function assertSamePromotedFile(before: DurableFileIdentity, after: DurableFileIdentity): void {
  if (
    before.device !== after.device || before.inode !== after.inode || before.sizeBytes !== after.sizeBytes ||
    before.mtimeNs !== after.mtimeNs
  ) throw new Error("transition_snapshot_receipt_mismatch");
}

async function assertPreparedReceiptUnchanged(receipt: ProductionTransitionReceipt): Promise<void> {
  await locateReceiptSnapshot(receipt);
  if (!receipt.preparedDatabaseIdentity) {
    const active = verifyDatabase(receipt.databasePath);
    if (!matchesTargetDatabase(active, receipt)) throw new Error("transition_ready_database_mismatch");
    receipt.preparedDatabaseIdentity = await captureDurableFileIdentity(
      receipt.databasePath,
      "transition_prepared_database_invalid"
    );
    await writeJournal(receipt);
    return;
  }
  await assertDurableFileIdentity(
    receipt.databasePath,
    receipt.preparedDatabaseIdentity,
    "transition_prepared_database_changed"
  );
}

async function captureDurableFileIdentity(path: string, errorCode: string): Promise<DurableFileIdentity> {
  const info = await lstat(path, { bigint: true }).catch((error) => {
    if (isErrno(error, "ENOENT")) throw new Error(errorCode);
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path) throw new Error(errorCode);
  const sizeBytes = Number(info.size);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new Error(errorCode);
  return {
    ctimeNs: String(info.ctimeNs),
    device: String(info.dev),
    inode: String(info.ino),
    mtimeNs: String(info.mtimeNs),
    sizeBytes
  };
}

async function assertDurableFileIdentity(
  path: string,
  expected: DurableFileIdentity,
  errorCode: string
): Promise<void> {
  const actual = await captureDurableFileIdentity(path, "transition_snapshot_path_missing");
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(errorCode);
}

async function retainOnlyCurrentBackup(databasePath: string): Promise<void> {
  const directory = dirname(databasePath);
  const retained = basename(finalSnapshotPath(databasePath));
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.name.startsWith(`${basename(databasePath)}.backup-`) || entry.name === retained) continue;
    const path = join(directory, entry.name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("transition_backup_path_invalid");
    await rmDatabase(path);
  }
}

async function findAdoptableRecoveryStage(
  databasePath: string,
  source: VerifiedDatabase
): Promise<string | undefined> {
  const prefix = `.${basename(databasePath)}.recovery-stage-`;
  const candidates = (await readdir(dirname(databasePath), { withFileTypes: true }))
    .filter((entry) => entry.name.startsWith(prefix));
  if (candidates.length === 0) return undefined;
  const adoptable: string[] = [];
  for (const candidate of candidates) {
    const path = join(dirname(databasePath), candidate.name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("transition_recovery_stage_path_invalid");
    try {
      if (matchesSourceDatabase(verifyDatabase(path), {
        databaseId: source.databaseId,
        sourceMigrationLedger: source.migrationLedger,
        sourceSchemaFingerprint: source.schemaFingerprint,
        sourceSchemaVersion: source.schemaVersion
      } as ProductionTransitionReceipt)) adoptable.push(path);
    } catch {
      // Invalid or incomplete legacy stages are abandoned below after a fresh copy is selected.
    }
  }
  if (adoptable.length > 1) throw new Error("transition_recovery_stage_ambiguous");
  return adoptable[0];
}

async function findAdoptableCurrentBackup(
  databasePath: string,
  source: VerifiedDatabase
): Promise<string | undefined> {
  const path = finalSnapshotPath(databasePath);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("transition_backup_path_invalid");
    return matchesSourceDatabase(verifyDatabase(path), {
      databaseId: source.databaseId,
      sourceMigrationLedger: source.migrationLedger,
      sourceSchemaFingerprint: source.schemaFingerprint,
      sourceSchemaVersion: source.schemaVersion
    } as ProductionTransitionReceipt) ? path : undefined;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined;
    if (error instanceof Error && (
      error.message === "transition_database_identity_invalid" ||
      error.message.startsWith("SQLite quick_check failed:") ||
      error.message.includes("file is not a database")
    )) return undefined;
    throw error;
  }
}

export async function completeProductionTransition(inputValue: ProductionTransitionInput): Promise<void> {
  const input = validateInput(inputValue);
  const receipt = await readAndValidateJournal(input);
  if (receipt.state !== "ready_to_activate" && receipt.state !== "restored") {
    throw new Error(`transition_complete_state_invalid:${receipt.state}`);
  }
  await rm(productionTransitionJournalPath(input.databasePath));
  const directory = await open(dirname(input.databasePath), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function restoreSnapshotInsideOwnership(
  receipt: ProductionTransitionReceipt,
  ownership: ExclusiveDatabaseMaintenance,
  options: ProductionTransitionOptions,
  snapshotVerification: "database" | "full" | "receipt" = "full"
): Promise<void> {
  if (ownership.databasePath !== receipt.databasePath) throw new Error("transition_restore_ownership_mismatch");
  await verifySnapshot(receipt, options, snapshotVerification);
  receipt.state = "restoring";
  receipt.updatedAt = new Date().toISOString();
  await writeJournal(receipt);
  const stagePath = join(
    dirname(receipt.databasePath),
    `.${basename(receipt.databasePath)}.production-transition-restore-stage`
  );
  await rmDatabase(stagePath);
  try {
    const snapshot = new DatabaseSync(receipt.snapshot.path, { readOnly: true });
    try {
      await backup(snapshot, stagePath);
    } finally {
      snapshot.close();
    }
    normalizeJournal(stagePath);
    const staged = verifyDatabase(stagePath, { foreignKeys: true });
    if (!matchesSourceDatabase(staged, receipt)) {
      throw new Error("transition_restore_stage_mismatch");
    }
    options.onBoundary?.("before_restore_promotion");
    await removeSidecars(receipt.databasePath);
    await rename(stagePath, receipt.databasePath);
    if (options.onBoundary) {
      const promoted = new DatabaseSync(receipt.databasePath);
      try {
        options.onBoundary("after_restore_promotion", promoted);
      } finally {
        promoted.close();
      }
    }
    const restored = verifyDatabase(receipt.databasePath, { foreignKeys: true });
    if (!matchesSourceDatabase(restored, receipt)) {
      throw new Error("transition_restored_database_mismatch");
    }
    receipt.state = "restored";
    receipt.updatedAt = new Date().toISOString();
    await writeJournal(receipt);
    options.onBoundary?.("restored");
  } catch (error) {
    receipt.state = "restore_failed";
    receipt.updatedAt = new Date().toISOString();
    await writeJournal(receipt);
    throw error;
  } finally {
    await rmDatabase(stagePath);
  }
}

async function cleanupAbandonedMigrationStagesInsideOwnership(
  databasePath: string,
  preservedStagePath?: string
): Promise<void> {
  const directory = dirname(databasePath);
  const prefixes = [
    `.${basename(databasePath)}.migration-backup-stage-`,
    `.${basename(databasePath)}.recovery-stage-`
  ];
  const abandoned = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => prefixes.some((prefix) => entry.name.startsWith(prefix)));
  for (const entry of abandoned) {
    const path = join(directory, entry.name);
    if (path === preservedStagePath) continue;
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("transition_abandoned_stage_path_invalid");
    await rmDatabase(path);
  }
}

async function assertCleanTransitionBoundary(databasePath: string): Promise<void> {
  const journalPath = productionTransitionJournalPath(databasePath);
  try {
    await lstat(journalPath);
    throw new Error("transition_incomplete_journal_present");
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }
  const prefix = `.${basename(databasePath)}.production-transition-`;
  const entries = await readdir(dirname(databasePath), { withFileTypes: true });
  if (entries.some((entry) => entry.name.startsWith(prefix))) {
    throw new Error("transition_stage_hygiene_failed");
  }
}

async function readAndValidateJournal(input: ProductionTransitionInput): Promise<ProductionTransitionReceipt> {
  const path = productionTransitionJournalPath(input.databasePath);
  const info = await lstat(path).catch(() => { throw new Error("transition_journal_missing"); });
  if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error("transition_journal_path_invalid");
  }
  let receipt: ProductionTransitionReceipt;
  try {
    receipt = JSON.parse(await readFile(path, "utf8")) as ProductionTransitionReceipt;
  } catch {
    throw new Error("transition_journal_invalid");
  }
  if (
    receipt.databasePath !== input.databasePath ||
    receipt.nonce !== input.nonce ||
    (input.rollbackMode === "offline_only"
      ? receipt.schemaVersion !== 2 || receipt.rollbackMode !== "offline_only" ||
        !sameLegacyTarget(receipt.legacyTarget, input.legacyTarget) || "oldBundle" in receipt
      : receipt.schemaVersion !== 1 || !sameBundle(receipt.oldBundle, input.oldBundle) ||
        "legacyTarget" in receipt || "rollbackMode" in receipt) ||
    !sameBundle(receipt.newBundle, input.newBundle) ||
    receipt.snapshot?.path !== join(dirname(input.databasePath), `${basename(input.databasePath)}.backup-current`)
  ) {
    throw new Error("transition_receipt_mismatch");
  }
  return receipt;
}

async function verifySnapshot(
  receipt: ProductionTransitionReceipt,
  options: ProductionTransitionOptions,
  verification: "database" | "full" | "receipt"
): Promise<void> {
  const info = await lstat(receipt.snapshot.path);
  if (!info.isFile() || info.isSymbolicLink() || await realpath(receipt.snapshot.path) !== receipt.snapshot.path) {
    throw new Error("transition_snapshot_path_invalid");
  }
  if (info.size !== receipt.snapshot.sizeBytes || await hashFile(receipt.snapshot.path) !== receipt.snapshot.sha256) {
    throw new Error("transition_snapshot_receipt_mismatch");
  }
  if (verification === "receipt") return;
  const requireFullIntegrity = verification === "full";
  if (requireFullIntegrity) options.onFullIntegrityCheck?.(receipt.snapshot.path);
  const verified = verifyDatabase(receipt.snapshot.path, { foreignKeys: true, fullIntegrity: requireFullIntegrity });
  if (!matchesSourceDatabase(verified, receipt)) {
    throw new Error("transition_snapshot_database_mismatch");
  }
}

type VerifiedDatabase = {
  databaseId: string;
  migrationLedger: Array<{ name: string; version: number }>;
  schemaFingerprint: string;
  schemaVersion: number;
};

function verifyDatabase(
  path: string,
  options: { foreignKeys?: boolean; fullIntegrity?: boolean } = {}
): VerifiedDatabase {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    if (options.fullIntegrity) {
      const integrity = database.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
      const results = integrity.flatMap((row) => Object.values(row));
      if (results.length !== 1 || results[0] !== "ok") throw new Error("transition_database_integrity_failed");
    }
    quickCheckMastheadDatabase(database);
    if (options.foreignKeys) {
      const foreignKeyFailures = database.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeyFailures.length > 0) {
        throw new Error(`transition_foreign_key_check_failed:${JSON.stringify(foreignKeyFailures.slice(0, 10))}`);
      }
    }
    const identity = database.prepare(
      "SELECT setting_json AS value FROM app_settings WHERE setting_key = 'database_identity'"
    ).get() as { value: string } | undefined;
    const migrationLedger = database.prepare(
      "SELECT version, name FROM schema_migrations ORDER BY version"
    ).all() as Array<{ name: string; version: number }>;
    const schemaObjects = database.prepare(
      "SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
    ).all();
    return {
      databaseId: parseDatabaseId(identity?.value),
      migrationLedger,
      schemaFingerprint: createHash("sha256").update(JSON.stringify(schemaObjects)).digest("hex"),
      schemaVersion: migrationLedger.at(-1)?.version ?? 0
    };
  } finally {
    database.close();
  }
}

function validatePreparedDatabase(path: string): void {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    validateCurrentDatabaseSchema(database);
  } finally {
    database.close();
  }
}

function matchesSourceDatabase(database: VerifiedDatabase, receipt: ProductionTransitionReceipt): boolean {
  return database.databaseId === receipt.databaseId &&
    database.schemaVersion === receipt.sourceSchemaVersion &&
    database.schemaFingerprint === receipt.sourceSchemaFingerprint &&
    JSON.stringify(database.migrationLedger) === JSON.stringify(receipt.sourceMigrationLedger);
}

function matchesTargetDatabase(database: VerifiedDatabase, receipt: ProductionTransitionReceipt): boolean {
  return database.databaseId === receipt.databaseId && database.schemaVersion === receipt.targetSchemaVersion;
}

function validateInput(input: ProductionTransitionInput): ProductionTransitionInput {
  const databasePath = resolve(required(input?.databasePath, "transition_database_path_required"));
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(input?.nonce || "")) {
    throw new Error("transition_nonce_invalid");
  }
  const common = { databasePath, nonce: input.nonce, newBundle: validateBundle(input.newBundle) };
  if (input.rollbackMode === "offline_only") {
    return {
      ...common,
      legacyTarget: validateLegacyTarget(input.legacyTarget),
      rollbackMode: "offline_only"
    };
  }
  return { ...common, oldBundle: validateBundle(input.oldBundle) };
}

function validateBundle(bundle: ProductionBundleIdentity | undefined): ProductionBundleIdentity {
  if (!bundle || !/^[a-f0-9]{64}$/u.test(bundle.bundleDigest) || !/^[a-f0-9]{40}$/u.test(bundle.gitSha)) {
    throw new Error("transition_bundle_identity_invalid");
  }
  return { ...bundle, target: resolve(required(bundle.target, "transition_bundle_target_required")), version: required(bundle.version, "transition_bundle_version_required") };
}

function sameBundle(left: ProductionBundleIdentity | undefined, right: ProductionBundleIdentity | undefined): boolean {
  if (!left || !right) return false;
  return left?.bundleDigest === right.bundleDigest && left?.gitSha === right.gitSha &&
    left?.target === right.target && left?.version === right.version;
}

function validateLegacyTarget(identity: LegacyProductionTargetIdentity): LegacyProductionTargetIdentity {
  if (!identity || !/^\d+$/u.test(identity.device) || !/^\d+$/u.test(identity.inode)) {
    throw new Error("transition_legacy_target_identity_invalid");
  }
  return { ...identity, path: resolve(required(identity.path, "transition_legacy_target_required")) };
}

function sameLegacyTarget(left: LegacyProductionTargetIdentity, right: LegacyProductionTargetIdentity): boolean {
  return Boolean(left && right && left.path === right.path && left.device === right.device && left.inode === right.inode);
}

function parseDatabaseId(value: string | undefined): string {
  try {
    const parsed = JSON.parse(value || "null") as { databaseId?: unknown };
    if (typeof parsed?.databaseId === "string" && parsed.databaseId) return parsed.databaseId;
  } catch {
    // Converted to one stable transition error below.
  }
  throw new Error("transition_database_identity_invalid");
}

async function writeJournal(receipt: ProductionTransitionReceipt): Promise<void> {
  const path = productionTransitionJournalPath(receipt.databasePath);
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    const file = await open(temporary, "w", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function hashFile(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer);
  return digest.digest("hex");
}

function normalizeJournal(path: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA journal_mode = DELETE;");
  } finally {
    database.close();
  }
}

async function removeSidecars(path: string): Promise<void> {
  await Promise.all(["-journal", "-shm", "-wal"].map((suffix) => rm(`${path}${suffix}`, { force: true })));
}

async function rmDatabase(path: string): Promise<void> {
  await Promise.all([rm(path, { force: true }), removeSidecars(path)]);
}

function required(value: string | undefined, errorCode: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(errorCode);
  return value.trim();
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runProductionTransitionMaintenanceCli(argv = process.argv.slice(2)): Promise<unknown> {
  const action = argv[0];
  const requestIndex = argv.indexOf("--request");
  if (requestIndex < 0 || !argv[requestIndex + 1]) throw new Error("production transition maintenance requires --request JSON");
  const input = JSON.parse(argv[requestIndex + 1]) as ProductionTransitionInput;
  if (action === "prepare") return prepareProductionTransition(input);
  if (action === "restore") return restoreProductionTransition(input);
  if (action === "preflight") return preflightProductionTransition(input);
  if (action === "complete") {
    await completeProductionTransition(input);
    return { completed: true };
  }
  throw new Error(`unknown production transition maintenance action: ${action || "missing"}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProductionTransitionMaintenanceCli().then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error) => {
      process.stderr.write(`${errorMessage(error)}\n`);
      process.exitCode = 1;
    }
  );
}
