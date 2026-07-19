import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export async function withReadonlySqliteCopy<T>(dbPath: string, fn: (db: DatabaseSync) => T): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-sqlite-copy-"));
  const copyPath = join(tempDir, basename(dbPath));
  try {
    await copyFile(dbPath, copyPath);
    await Promise.all(["-wal", "-shm"].map(async (suffix) => {
      try {
        await copyFile(`${dbPath}${suffix}`, `${copyPath}${suffix}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }));
    const db = new DatabaseSync(copyPath, { readOnly: true });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

export function sqliteTables(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String((row as { name: string }).name));
}

export function tableColumns(db: DatabaseSync, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
    .all()
    .map((row) => String((row as { name: string }).name));
}

export function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
