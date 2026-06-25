import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type MastheadDatabase = DatabaseSync;

export async function openMastheadDatabase(databasePath: string): Promise<MastheadDatabase> {
  await mkdir(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 3000;");
  return db;
}
