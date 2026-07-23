import { randomUUID } from "node:crypto";
import { access, lstat, readdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import {
  acquireDatabaseWriterLock,
  acquireLegacyDataDirectoryGuard,
  assertWritableDatabaseLocation
} from "../core/daemonOwnership.ts";
import {
  auditFailedV1Generation,
  invalidateFailedV1Generation,
  type FailedGenerationInvalidationBoundary,
  type FailedGenerationReceipt,
  type FailedGenerationRecoveryBackupEvidence
} from "./db/sessionArtifactRepository.ts";

export type ConsistentDatabaseBackupReceipt = {
  backupPath: string;
  databaseId: string;
  integrityResult: "ok";
  pagesCopied: number;
  sizeBytes: number;
};

export type MigrationDatabaseBackupReceipt = {
  backupPath: string;
  integrityResult: "ok";
  pagesCopied: number;
  sizeBytes: number;
};

export type FailedV1RecoveryRestoreReceipt = {
  artifactsRestored: number;
  auditHash: string;
  backupPath: string;
  backupPreserved: true;
  databaseId: string;
  integrityResult: "ok";
  runsRestored: number;
  sessionsRestored: number;
};

export type FailedV1RecoveryInvalidationReceipt = FailedGenerationReceipt;

export type DatabaseRestoreBoundary = "stage" | "verify_stage" | "before_promotion" | "verify_active";

export type DatabaseRestoreOptions = {
  onBoundary?: (boundary: DatabaseRestoreBoundary) => void;
};

export type DatabaseBackupBoundary = "backup" | "normalize" | "verify" | "finalize";

export type DatabaseBackupOptions = {
  onBoundary?: (boundary: DatabaseBackupBoundary) => void;
};

const exclusiveMaintenanceBrand = Symbol("exclusive_database_maintenance");
export type ExclusiveDatabaseMaintenance = {
  databasePath: string;
  [exclusiveMaintenanceBrand]: true;
};

/** Runtime proof that a recovery caller holds this module's unforgeable ownership brand. */
export function assertExclusiveDatabaseMaintenance(
  databasePath: string,
  ownership: ExclusiveDatabaseMaintenance,
  errorCode = "database_maintenance_exclusive_ownership_required"
): void {
  if (
    !ownership || ownership.databasePath !== resolve(databasePath) ||
    ownership[exclusiveMaintenanceBrand] !== true
  ) throw new Error(errorCode);
}

/** Mirrors daemon startup ownership: location, per-database lease, then legacy data-directory guard. */
export async function withExclusiveDatabaseMaintenance<T>(
  databasePath: string,
  callback: (ownership: ExclusiveDatabaseMaintenance) => Promise<T> | T
): Promise<T> {
  await access(databasePath);
  const dataDirectory = dirname(resolve(databasePath));
  await assertWritableDatabaseLocation(databasePath, dataDirectory);
  await assertNoDaemonRuntimeManifest(dataDirectory);
  const writerLease = await acquireDatabaseWriterLock(databasePath);
  let legacyGuard: Awaited<ReturnType<typeof acquireLegacyDataDirectoryGuard>> | undefined;
  try {
    legacyGuard = await acquireLegacyDataDirectoryGuard(dataDirectory, writerLease);
    // Repeat the runtime proof after both daemon-equivalent guards are held.
    // A malformed or stale manifest is still ownership ambiguity, so
    // maintenance never reclaims or ignores it automatically.
    await assertNoDaemonRuntimeManifest(dataDirectory);
    return await callback({
      databasePath: resolve(databasePath),
      [exclusiveMaintenanceBrand]: true
    });
  } finally {
    try {
      await legacyGuard?.release();
    } finally {
      await writerLease.release();
    }
  }
}

async function assertNoDaemonRuntimeManifest(dataDirectory: string): Promise<void> {
  const manifestPath = join(dataDirectory, "runtime", "daemon.json");
  let contents: string;
  try {
    const info = await lstat(manifestPath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`database_maintenance_daemon_manifest_invalid:${manifestPath}`);
    }
    contents = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`database_maintenance_daemon_manifest_invalid:${manifestPath}`);
  }
  const pid = parsed && typeof parsed === "object" && "pid" in parsed
    ? maintenanceManifestPid((parsed as { pid?: unknown }).pid)
    : undefined;
  if (!pid) throw new Error(`database_maintenance_daemon_manifest_invalid:${manifestPath}`);
  if (maintenanceManifestProcessIsAlive(pid)) {
    throw new Error(`database_maintenance_live_daemon_manifest:${manifestPath}:pid:${pid}`);
  }
  throw new Error(`database_maintenance_stale_daemon_manifest:${manifestPath}:pid:${pid}`);
}

function maintenanceManifestPid(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function maintenanceManifestProcessIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrno(error, "EPERM");
  }
}

/** Acquires full daemon-equivalent ownership before making the sole retained snapshot. */
export async function createSingleConsistentBackup(
  databasePath: string,
  options: DatabaseBackupOptions = {}
): Promise<ConsistentDatabaseBackupReceipt> {
  return withExclusiveDatabaseMaintenance(databasePath, (ownership) =>
    createSingleConsistentBackupInsideExclusiveMaintenance(databasePath, ownership, options)
  );
}

/** Caller must already hold `withExclusiveDatabaseMaintenance` for this exact path. */
export async function createSingleConsistentBackupInsideExclusiveMaintenance(
  databasePath: string,
  ownership: ExclusiveDatabaseMaintenance,
  options: DatabaseBackupOptions = {}
): Promise<ConsistentDatabaseBackupReceipt> {
  assertExclusiveDatabaseMaintenance(databasePath, ownership, "database_backup_exclusive_ownership_required");
  const directory = dirname(resolve(databasePath));
  const databaseName = basename(databasePath);
  const finalPrefix = `${databaseName}.backup-`;
  const finalPath = join(directory, `${finalPrefix}current`);
  const stagePath = join(directory, `.${databaseName}.recovery-stage-${randomUUID()}`);
  let source: DatabaseSync | undefined;
  let promoted = false;
  try {
    options.onBoundary?.("backup");
    source = new DatabaseSync(databasePath, { readOnly: true });
    const pagesCopied = await backup(source, stagePath);

    options.onBoundary?.("normalize");
    normalizeBackupJournal(stagePath);

    options.onBoundary?.("verify");
    const verified = verifyStagedBackup(stagePath);
    const sizeBytes = (await stat(stagePath)).size;

    options.onBoundary?.("finalize");
    await rename(stagePath, finalPath);
    promoted = true;
    await retainExactFinalSnapshot(directory, finalPrefix, finalPath);
    return {
      backupPath: finalPath,
      databaseId: verified.databaseId,
      integrityResult: "ok",
      pagesCopied,
      sizeBytes
    };
  } finally {
    source?.close();
    await removeDatabaseAndSidecars(stagePath);
    if (promoted) {
      await removeSidecars(finalPath);
      await assertNoDatabaseSidecars(finalPath, "database_backup_final_sidecar_present");
    }
  }
}

/** Caller must already hold the daemon startup writer lease and legacy directory guard. */
export async function createVerifiedMigrationBackupInsideDaemonStartup(
  databasePath: string,
  options: DatabaseBackupOptions = {}
): Promise<MigrationDatabaseBackupReceipt> {
  const directory = dirname(resolve(databasePath));
  const databaseName = basename(databasePath);
  const finalPrefix = `${databaseName}.backup-`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const finalPath = join(directory, `${finalPrefix}${timestamp}`);
  const stagePath = join(directory, `.${databaseName}.migration-backup-stage-${randomUUID()}`);
  let source: DatabaseSync | undefined;
  let promoted = false;
  try {
    options.onBoundary?.("backup");
    source = new DatabaseSync(databasePath, { readOnly: true });
    const pagesCopied = await backup(source, stagePath);

    options.onBoundary?.("normalize");
    normalizeBackupJournal(stagePath);

    options.onBoundary?.("verify");
    verifyStagedIntegrity(stagePath);
    const sizeBytes = (await stat(stagePath)).size;

    options.onBoundary?.("finalize");
    await rename(stagePath, finalPath);
    promoted = true;
    await retainExactFinalSnapshot(directory, finalPrefix, finalPath);
    return { backupPath: finalPath, integrityResult: "ok", pagesCopied, sizeBytes };
  } finally {
    source?.close();
    await removeDatabaseAndSidecars(stagePath);
    if (promoted) {
      await removeSidecars(finalPath);
      await assertNoDatabaseSidecars(finalPath, "database_backup_final_sidecar_present");
    }
  }
}

/** Invalidates the exact failed V1 population only after its prepared sibling recovery backup verifies. */
export async function invalidateFailedV1GenerationInsideExclusiveMaintenance(
  databasePath: string,
  expectedAuditHash: string,
  ownership: ExclusiveDatabaseMaintenance,
  options: { onMutationBoundary?: (boundary: FailedGenerationInvalidationBoundary) => void } = {}
): Promise<FailedV1RecoveryInvalidationReceipt> {
  const activePath = resolve(databasePath);
  if (ownership.databasePath !== activePath || ownership[exclusiveMaintenanceBrand] !== true) {
    throw new Error("database_invalidation_exclusive_ownership_required");
  }
  if (!/^[a-f0-9]{64}$/u.test(expectedAuditHash)) throw new Error("failed_v1_recovery_audit_hash_invalid");
  const recoveryBackup = await verifyFailedV1RecoveryBackupForInvalidation(activePath, expectedAuditHash);
  const database = new DatabaseSync(activePath);
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
    return invalidateFailedV1Generation(database, expectedAuditHash, recoveryBackup, options);
  } finally {
    database.close();
  }
}

/** Restores the one verified V1 recovery snapshot while daemon-equivalent ownership is held. */
export async function restoreFailedV1RecoveryBackupInsideExclusiveMaintenance(
  databasePath: string,
  backupPath: string,
  expectedAuditHash: string,
  ownership: ExclusiveDatabaseMaintenance,
  options: DatabaseRestoreOptions = {}
): Promise<FailedV1RecoveryRestoreReceipt> {
  const activePath = resolve(databasePath);
  if (ownership.databasePath !== activePath || ownership[exclusiveMaintenanceBrand] !== true) {
    throw new Error("database_restore_exclusive_ownership_required");
  }
  if (!/^[a-f0-9]{64}$/u.test(expectedAuditHash)) throw new Error("failed_v1_recovery_audit_hash_invalid");
  await assertRegularNonSymlinkPath(activePath, activePath, "database_restore_active_path_invalid");
  const expectedBackupPath = join(dirname(activePath), `${basename(activePath)}.backup-current`);
  await assertRegularNonSymlinkPath(backupPath, expectedBackupPath, "database_restore_backup_path_invalid");
  await assertNoDatabaseSidecars(expectedBackupPath, "database_restore_backup_sidecar_present");

  const active = verifyRecoveryDatabase(activePath, false);
  const backupVerification = verifyRecoveryDatabase(expectedBackupPath, true);
  if (active.databaseId !== backupVerification.databaseId) {
    throw new Error("database_restore_identity_mismatch");
  }
  if (backupVerification.audit?.auditHash !== expectedAuditHash) {
    throw new Error("database_restore_audit_hash_mismatch");
  }

  const stagePath = join(dirname(activePath), `.${basename(activePath)}.restore-stage-${randomUUID()}`);
  try {
    options.onBoundary?.("stage");
    const backupSource = new DatabaseSync(expectedBackupPath, { readOnly: true });
    try {
      await backup(backupSource, stagePath);
    } finally {
      backupSource.close();
    }
    normalizeBackupJournal(stagePath);

    options.onBoundary?.("verify_stage");
    const staged = verifyRecoveryDatabase(stagePath, true);
    if (staged.databaseId !== active.databaseId) throw new Error("database_restore_staged_identity_mismatch");
    if (staged.audit?.auditHash !== expectedAuditHash) throw new Error("database_restore_staged_audit_hash_mismatch");

    options.onBoundary?.("before_promotion");
    await removeSidecars(activePath);
    await rename(stagePath, activePath);

    options.onBoundary?.("verify_active");
    const restored = verifyRecoveryDatabase(activePath, true);
    if (restored.databaseId !== active.databaseId) throw new Error("database_restore_active_identity_mismatch");
    if (restored.audit?.auditHash !== expectedAuditHash) throw new Error("database_restore_active_audit_hash_mismatch");
    return {
      artifactsRestored: restored.audit.totalArtifacts,
      auditHash: restored.audit.auditHash,
      backupPath: expectedBackupPath,
      backupPreserved: true,
      databaseId: restored.databaseId,
      integrityResult: "ok",
      runsRestored: restored.audit.totalRuns,
      sessionsRestored: restored.audit.totalSessions
    };
  } finally {
    await removeDatabaseAndSidecars(stagePath);
  }
}

async function verifyFailedV1RecoveryBackupForInvalidation(
  activePath: string,
  expectedAuditHash: string
): Promise<FailedGenerationRecoveryBackupEvidence> {
  await assertRegularNonSymlinkPath(activePath, activePath, "database_invalidation_active_path_invalid");
  const backupPath = join(dirname(activePath), `${basename(activePath)}.backup-current`);
  await assertRegularNonSymlinkPath(backupPath, backupPath, "database_invalidation_backup_path_invalid");
  await assertNoDatabaseSidecars(backupPath, "database_invalidation_backup_sidecar_present");
  const before = await lstat(backupPath, { bigint: true });
  const active = verifyRecoveryDatabase(activePath, true);
  const backupVerification = verifyRecoveryDatabase(backupPath, true);
  if (active.databaseId !== backupVerification.databaseId) {
    throw new Error("database_invalidation_identity_mismatch");
  }
  if (active.audit?.auditHash !== expectedAuditHash) {
    throw new Error("database_invalidation_active_audit_hash_mismatch");
  }
  if (backupVerification.audit?.auditHash !== expectedAuditHash) {
    throw new Error("database_invalidation_backup_audit_hash_mismatch");
  }
  await assertNoDatabaseSidecars(backupPath, "database_invalidation_backup_sidecar_present");
  const after = await lstat(backupPath, { bigint: true });
  if (
    before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
  ) {
    throw new Error("database_invalidation_backup_changed_during_verification");
  }
  const audit = backupVerification.audit;
  if (!audit) throw new Error("database_invalidation_backup_audit_missing");
  const sizeBytes = Number(after.size);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error("database_invalidation_backup_size_invalid");
  }
  return {
    artifacts: audit.totalArtifacts,
    auditHash: audit.auditHash,
    backupPath,
    backupPreserved: true,
    databaseId: backupVerification.databaseId,
    device: String(after.dev),
    inode: String(after.ino),
    integrityResult: "ok",
    runs: audit.totalRuns,
    sessions: audit.totalSessions,
    sizeBytes
  };
}

function verifyStagedBackup(stagePath: string): { databaseId: string } {
  let verified: DatabaseSync | undefined;
  try {
    verified = new DatabaseSync(stagePath, { readOnly: true });
    verifyOpenDatabaseIntegrity(verified);
    const identityRow = verified.prepare(
      "SELECT setting_json AS value FROM app_settings WHERE setting_key = 'database_identity'"
    ).get() as { value: string } | undefined;
    return { databaseId: parseDatabaseId(identityRow?.value) };
  } finally {
    verified?.close();
  }
}

function verifyRecoveryDatabase(
  path: string,
  requireFailedV1Audit: boolean
): {
  audit?: ReturnType<typeof auditFailedV1Generation>;
  databaseId: string;
} {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    verifyOpenDatabaseIntegrity(database);
    const identityRow = database.prepare(
      "SELECT setting_json AS value FROM app_settings WHERE setting_key = 'database_identity'"
    ).get() as { value: string } | undefined;
    return {
      audit: requireFailedV1Audit ? auditFailedV1Generation(database) : undefined,
      databaseId: parseDatabaseId(identityRow?.value)
    };
  } finally {
    database.close();
  }
}

async function assertRegularNonSymlinkPath(path: string, expectedPath: string, errorCode: string): Promise<void> {
  const absolutePath = resolve(path);
  if (absolutePath !== expectedPath) throw new Error(errorCode);
  const info = await lstat(absolutePath).catch((error) => {
    if (isErrno(error, "ENOENT")) throw new Error(errorCode);
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(errorCode);
  if ((await realpath(absolutePath)) !== absolutePath) throw new Error(errorCode);
}

function normalizeBackupJournal(path: string): void {
  const normalizer = new DatabaseSync(path);
  try {
    normalizer.exec("PRAGMA journal_mode = DELETE;");
  } finally {
    normalizer.close();
  }
}

function verifyStagedIntegrity(stagePath: string): void {
  const verified = new DatabaseSync(stagePath, { readOnly: true });
  try {
    verifyOpenDatabaseIntegrity(verified);
  } finally {
    verified.close();
  }
}

function verifyOpenDatabaseIntegrity(database: DatabaseSync): void {
  const integrity = database.prepare("PRAGMA integrity_check;").all() as Array<Record<string, unknown>>;
  const results = integrity.flatMap((row) => Object.values(row));
  if (results.length !== 1 || results[0] !== "ok") {
    throw new Error(`database_backup_integrity_failed:${results.join(";")}`);
  }
}

async function retainExactFinalSnapshot(
  directory: string,
  prefix: string,
  retainedPath: string
): Promise<void> {
  const retainedName = basename(retainedPath);
  const stale = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.name.startsWith(prefix) && entry.name !== retainedName)
    .map((entry) => join(directory, entry.name));
  await Promise.all(stale.map((path) => rm(path, { force: true })));
  const retained = await lstat(retainedPath);
  if (!retained.isFile() || retained.isSymbolicLink()) {
    throw new Error("database_backup_promoted_snapshot_missing");
  }
}

async function removeDatabaseAndSidecars(path: string): Promise<void> {
  await Promise.all([rm(path, { force: true }), removeSidecars(path)]);
}

async function removeSidecars(path: string): Promise<void> {
  await Promise.all([rm(`${path}-journal`, { force: true }), rm(`${path}-shm`, { force: true }), rm(`${path}-wal`, { force: true })]);
}

async function assertNoDatabaseSidecars(path: string, errorCode: string): Promise<void> {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      await lstat(`${path}${suffix}`);
      throw new Error(`${errorCode}:${suffix.slice(1)}`);
    } catch (error) {
      if (isErrno(error, "ENOENT")) continue;
      throw error;
    }
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function parseDatabaseId(value: string | undefined): string {
  if (!value) throw new Error("database_backup_identity_missing");
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "databaseId" in parsed &&
      typeof parsed.databaseId === "string" &&
      parsed.databaseId
    ) {
      return parsed.databaseId;
    }
  } catch {
    // Converted to one stable recovery error below.
  }
  throw new Error("database_backup_identity_invalid");
}
