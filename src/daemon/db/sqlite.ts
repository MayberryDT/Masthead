import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type MastheadDatabase = DatabaseSync;
export type WalCheckpointMode = "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE";

export function withImmediateTransaction<T>(db: MastheadDatabase, callback: () => T): T {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = callback();
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export async function openMastheadDatabase(databasePath: string): Promise<MastheadDatabase> {
  await mkdir(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 3000;");
  return db;
}

export function checkpointMastheadDatabase(db: MastheadDatabase, mode: WalCheckpointMode = "PASSIVE"): void {
  db.prepare(`PRAGMA wal_checkpoint(${mode});`).all();
}

export function optimizeMastheadDatabase(db: MastheadDatabase): void {
  db.exec("PRAGMA optimize;");
}

export function quickCheckMastheadDatabase(db: MastheadDatabase): void {
  const rows = db.prepare("PRAGMA quick_check;").all() as Array<Record<string, unknown>>;
  const results = rows.flatMap((row) => Object.values(row));
  const failures = results.filter((value) => value !== "ok");
  if (failures.length > 0) {
    throw new Error(`SQLite quick_check failed: ${failures.join("; ")}`);
  }
}
