import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { backup, DatabaseSync } from "node:sqlite";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSingleConsistentBackupInsideExclusiveMaintenance,
  type ExclusiveDatabaseMaintenance,
  withExclusiveDatabaseMaintenance
} from "./databaseBackup.ts";
import { CURRENT_SCHEMA_VERSION, migrateDatabase, validateCurrentDatabaseSchema } from "./db/schema.ts";
import { quickCheckMastheadDatabase } from "./db/sqlite.ts";

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

export type ProductionTransitionReceipt = {
  databaseId: string;
  databasePath: string;
  newBundle: ProductionBundleIdentity;
  nonce: string;
  oldBundle: ProductionBundleIdentity;
  schemaVersion: 1;
  snapshot: { path: string; sha256: string; sizeBytes: number };
  sourceMigrationLedger: Array<{ name: string; version: number }>;
  sourceSchemaFingerprint: string;
  sourceSchemaVersion: number;
  state: ProductionTransitionState;
  targetSchemaVersion: number;
  updatedAt: string;
};

export type ProductionTransitionInput = {
  databasePath: string;
  newBundle: ProductionBundleIdentity;
  nonce: string;
  oldBundle: ProductionBundleIdentity;
};

export type ProductionTransitionBoundary =
  | "snapshot_ready"
  | "after_migrate"
  | "before_restore_promotion"
  | "restored";

export type ProductionTransitionOptions = {
  onBoundary?: (boundary: ProductionTransitionBoundary, database?: DatabaseSync) => void;
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
    await cleanupAbandonedMigrationStagesInsideOwnership(input.databasePath);
    await assertCleanTransitionBoundary(input.databasePath);
    const activeBefore = verifyDatabase(input.databasePath);
    const backupReceipt = await createSingleConsistentBackupInsideExclusiveMaintenance(
      input.databasePath,
      ownership
    );
    if (backupReceipt.databaseId !== activeBefore.databaseId) throw new Error("transition_snapshot_identity_mismatch");
    const receipt: ProductionTransitionReceipt = {
      databaseId: activeBefore.databaseId,
      databasePath: input.databasePath,
      newBundle: input.newBundle,
      nonce: input.nonce,
      oldBundle: input.oldBundle,
      schemaVersion: 1,
      snapshot: {
        path: backupReceipt.backupPath,
        sha256: await hashFile(backupReceipt.backupPath),
        sizeBytes: backupReceipt.sizeBytes
      },
      sourceMigrationLedger: activeBefore.migrationLedger,
      sourceSchemaFingerprint: activeBefore.schemaFingerprint,
      sourceSchemaVersion: activeBefore.schemaVersion,
      state: "snapshot_ready",
      targetSchemaVersion: CURRENT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString()
    };
    await writeJournal(receipt);
    options.onBoundary?.("snapshot_ready");
    try {
      const database = new DatabaseSync(input.databasePath);
      try {
        database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
        migrateDatabase(database);
        quickCheckMastheadDatabase(database);
        validateCurrentDatabaseSchema(database);
        options.onBoundary?.("after_migrate", database);
      } finally {
        database.close();
      }
      const migrated = verifyDatabase(input.databasePath);
      if (migrated.databaseId !== receipt.databaseId) throw new Error("transition_migrated_identity_mismatch");
      if (migrated.schemaVersion !== CURRENT_SCHEMA_VERSION) throw new Error("transition_target_schema_mismatch");
      receipt.state = "ready_to_activate";
      receipt.updatedAt = new Date().toISOString();
      await writeJournal(receipt);
      return receipt;
    } catch (error) {
      try {
        await restoreSnapshotInsideOwnership(receipt, ownership, options);
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

export async function restoreProductionTransition(
  inputValue: ProductionTransitionInput,
  options: ProductionTransitionOptions = {}
): Promise<ProductionTransitionReceipt> {
  const input = validateInput(inputValue);
  return withExclusiveDatabaseMaintenance(input.databasePath, async (ownership) => {
    const receipt = await readAndValidateJournal(input);
    if (!["snapshot_ready", "ready_to_activate", "restoring", "restore_failed", "restored"].includes(receipt.state)) {
      throw new Error(`transition_restore_state_invalid:${receipt.state}`);
    }
    await restoreSnapshotInsideOwnership(receipt, ownership, options);
    return receipt;
  });
}

export async function completeProductionTransition(inputValue: ProductionTransitionInput): Promise<void> {
  const input = validateInput(inputValue);
  const receipt = await readAndValidateJournal(input);
  if (receipt.state !== "ready_to_activate" && receipt.state !== "restored") {
    throw new Error(`transition_complete_state_invalid:${receipt.state}`);
  }
  await rm(productionTransitionJournalPath(input.databasePath));
}

async function restoreSnapshotInsideOwnership(
  receipt: ProductionTransitionReceipt,
  ownership: ExclusiveDatabaseMaintenance,
  options: ProductionTransitionOptions
): Promise<void> {
  if (ownership.databasePath !== receipt.databasePath) throw new Error("transition_restore_ownership_mismatch");
  await verifySnapshot(receipt);
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
    const staged = verifyDatabase(stagePath);
    if (!matchesSourceDatabase(staged, receipt)) {
      throw new Error("transition_restore_stage_mismatch");
    }
    options.onBoundary?.("before_restore_promotion");
    await removeSidecars(receipt.databasePath);
    await rename(stagePath, receipt.databasePath);
    const restored = verifyDatabase(receipt.databasePath);
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

async function cleanupAbandonedMigrationStagesInsideOwnership(databasePath: string): Promise<void> {
  const directory = dirname(databasePath);
  const prefixes = [
    `.${basename(databasePath)}.migration-backup-stage-`,
    `.${basename(databasePath)}.recovery-stage-`
  ];
  const abandoned = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => prefixes.some((prefix) => entry.name.startsWith(prefix)));
  for (const entry of abandoned) {
    const path = join(directory, entry.name);
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
    receipt.schemaVersion !== 1 ||
    receipt.databasePath !== input.databasePath ||
    receipt.nonce !== input.nonce ||
    !sameBundle(receipt.oldBundle, input.oldBundle) ||
    !sameBundle(receipt.newBundle, input.newBundle) ||
    receipt.snapshot?.path !== join(dirname(input.databasePath), `${basename(input.databasePath)}.backup-current`)
  ) {
    throw new Error("transition_receipt_mismatch");
  }
  return receipt;
}

async function verifySnapshot(receipt: ProductionTransitionReceipt): Promise<void> {
  const info = await lstat(receipt.snapshot.path);
  if (!info.isFile() || info.isSymbolicLink() || await realpath(receipt.snapshot.path) !== receipt.snapshot.path) {
    throw new Error("transition_snapshot_path_invalid");
  }
  if (info.size !== receipt.snapshot.sizeBytes || await hashFile(receipt.snapshot.path) !== receipt.snapshot.sha256) {
    throw new Error("transition_snapshot_receipt_mismatch");
  }
  const verified = verifyDatabase(receipt.snapshot.path);
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

function verifyDatabase(path: string): VerifiedDatabase {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
    const results = integrity.flatMap((row) => Object.values(row));
    if (results.length !== 1 || results[0] !== "ok") throw new Error("transition_database_integrity_failed");
    quickCheckMastheadDatabase(database);
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

function matchesSourceDatabase(database: VerifiedDatabase, receipt: ProductionTransitionReceipt): boolean {
  return database.databaseId === receipt.databaseId &&
    database.schemaVersion === receipt.sourceSchemaVersion &&
    database.schemaFingerprint === receipt.sourceSchemaFingerprint &&
    JSON.stringify(database.migrationLedger) === JSON.stringify(receipt.sourceMigrationLedger);
}

function validateInput(input: ProductionTransitionInput): ProductionTransitionInput {
  const databasePath = resolve(required(input?.databasePath, "transition_database_path_required"));
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(input?.nonce || "")) {
    throw new Error("transition_nonce_invalid");
  }
  return {
    databasePath,
    nonce: input.nonce,
    oldBundle: validateBundle(input.oldBundle),
    newBundle: validateBundle(input.newBundle)
  };
}

function validateBundle(bundle: ProductionBundleIdentity): ProductionBundleIdentity {
  if (!bundle || !/^[a-f0-9]{64}$/u.test(bundle.bundleDigest) || !/^[a-f0-9]{40}$/u.test(bundle.gitSha)) {
    throw new Error("transition_bundle_identity_invalid");
  }
  return { ...bundle, target: resolve(required(bundle.target, "transition_bundle_target_required")), version: required(bundle.version, "transition_bundle_version_required") };
}

function sameBundle(left: ProductionBundleIdentity, right: ProductionBundleIdentity): boolean {
  return left?.bundleDigest === right.bundleDigest && left?.gitSha === right.gitSha &&
    left?.target === right.target && left?.version === right.version;
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
