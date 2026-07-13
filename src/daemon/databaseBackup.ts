import { randomUUID } from "node:crypto";
import { access, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import {
  acquireDatabaseWriterLock,
  acquireLegacyDataDirectoryGuard,
  assertWritableDatabaseLocation
} from "../core/daemonOwnership.ts";

export type ConsistentDatabaseBackupReceipt = {
  backupPath: string;
  databaseId: string;
  integrityResult: "ok";
  pagesCopied: number;
  sizeBytes: number;
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

/** Mirrors daemon startup ownership: location, per-database lease, then legacy data-directory guard. */
export async function withExclusiveDatabaseMaintenance<T>(
  databasePath: string,
  callback: (ownership: ExclusiveDatabaseMaintenance) => Promise<T> | T
): Promise<T> {
  await access(databasePath);
  const dataDirectory = dirname(resolve(databasePath));
  await assertWritableDatabaseLocation(databasePath, dataDirectory);
  const writerLease = await acquireDatabaseWriterLock(databasePath);
  let legacyGuard: Awaited<ReturnType<typeof acquireLegacyDataDirectoryGuard>> | undefined;
  try {
    legacyGuard = await acquireLegacyDataDirectoryGuard(dataDirectory);
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
  if (ownership.databasePath !== resolve(databasePath) || ownership[exclusiveMaintenanceBrand] !== true) {
    throw new Error("database_backup_exclusive_ownership_required");
  }
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
    const normalizer = new DatabaseSync(stagePath);
    try {
      normalizer.exec("PRAGMA journal_mode = DELETE;");
    } finally {
      normalizer.close();
    }

    options.onBoundary?.("verify");
    const verified = verifyStagedBackup(stagePath);
    const sizeBytes = (await stat(stagePath)).size;

    options.onBoundary?.("finalize");
    await rename(stagePath, finalPath);
    promoted = true;
    await removeStaleFinalSnapshots(directory, finalPrefix, basename(finalPath));
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
      await Promise.all([
        rm(`${finalPath}-journal`, { force: true }),
        rm(`${finalPath}-shm`, { force: true }),
        rm(`${finalPath}-wal`, { force: true })
      ]);
    }
  }
}

function verifyStagedBackup(stagePath: string): { databaseId: string } {
  let verified: DatabaseSync | undefined;
  try {
    verified = new DatabaseSync(stagePath, { readOnly: true });
    const integrity = verified.prepare("PRAGMA integrity_check;").all() as Array<Record<string, unknown>>;
    const results = integrity.flatMap((row) => Object.values(row));
    if (results.length !== 1 || results[0] !== "ok") {
      throw new Error(`database_backup_integrity_failed:${results.join(";")}`);
    }
    const identityRow = verified.prepare(
      "SELECT setting_json AS value FROM app_settings WHERE setting_key = 'database_identity'"
    ).get() as { value: string } | undefined;
    return { databaseId: parseDatabaseId(identityRow?.value) };
  } finally {
    verified?.close();
  }
}

async function removeStaleFinalSnapshots(
  directory: string,
  prefix: string,
  retainedName: string
): Promise<void> {
  const stale = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name !== retainedName)
    .map((entry) => join(directory, entry.name));
  await Promise.all(stale.map((path) => rm(path, { force: true })));
}

async function removeDatabaseAndSidecars(path: string): Promise<void> {
  await Promise.all([
    rm(path, { force: true }),
    rm(`${path}-journal`, { force: true }),
    rm(`${path}-shm`, { force: true }),
    rm(`${path}-wal`, { force: true })
  ]);
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
