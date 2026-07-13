import { backup, DatabaseSync } from "node:sqlite";
import { access, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { acquireDatabaseWriterLock } from "../core/daemonOwnership.ts";

export type ConsistentDatabaseBackupReceipt = {
  backupPath: string;
  databaseId: string;
  integrityResult: "ok";
  pagesCopied: number;
  sizeBytes: number;
};

/**
 * Creates the sole retained Masthead database snapshot through SQLite's online
 * backup API. Acquiring the canonical writer lease both refuses a live daemon
 * and prevents a new writer from starting while the snapshot is made.
 */
export async function createSingleConsistentBackup(
  databasePath: string
): Promise<ConsistentDatabaseBackupReceipt> {
  await access(databasePath);
  const writerLease = await acquireDatabaseWriterLock(databasePath);
  let source: DatabaseSync | undefined;
  try {
    const directory = dirname(databasePath);
    const prefix = `${basename(databasePath)}.backup-`;
    const oldSnapshots = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
      .map((entry) => join(directory, entry.name));
    await Promise.all(oldSnapshots.map((path) => rm(path, { force: true })));

    const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
    const backupPath = join(directory, `${prefix}${stamp}`);
    source = new DatabaseSync(databasePath, { readOnly: true });
    const pagesCopied = await backup(source, backupPath);

    // A WAL-mode source can transfer that persistent journal setting. Normalize
    // the standalone snapshot before the required read-only reopen so later
    // audits do not create retained -wal/-shm companions.
    const normalizer = new DatabaseSync(backupPath);
    try {
      normalizer.exec("PRAGMA journal_mode = DELETE;");
    } finally {
      normalizer.close();
    }

    let verified: DatabaseSync | undefined;
    let receipt: ConsistentDatabaseBackupReceipt | undefined;
    try {
      verified = new DatabaseSync(backupPath, { readOnly: true });
      const integrity = verified.prepare("PRAGMA integrity_check;").all() as Array<Record<string, unknown>>;
      const results = integrity.flatMap((row) => Object.values(row));
      if (results.length !== 1 || results[0] !== "ok") {
        throw new Error(`database_backup_integrity_failed:${results.join(";")}`);
      }
      const identityRow = verified.prepare(
        "SELECT setting_json AS value FROM app_settings WHERE setting_key = 'database_identity'"
      ).get() as { value: string } | undefined;
      const databaseId = parseDatabaseId(identityRow?.value);
      const sizeBytes = (await stat(backupPath)).size;
      receipt = { backupPath, databaseId, integrityResult: "ok", pagesCopied, sizeBytes };
    } catch (error) {
      await rm(backupPath, { force: true });
      throw error;
    } finally {
      verified?.close();
    }
    await Promise.all([
      rm(`${backupPath}-shm`, { force: true }),
      rm(`${backupPath}-wal`, { force: true })
    ]);
    return receipt!;
  } finally {
    source?.close();
    await writerLease.release();
  }
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
