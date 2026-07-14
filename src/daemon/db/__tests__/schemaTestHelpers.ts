import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MastheadDatabase } from "../sqlite.ts";

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export function migrateTestDatabaseThrough(db: MastheadDatabase, throughVersion: number): void {
  db.exec(
    "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL);"
  );
  for (const filename of readdirSync(migrationsDirectory).filter((name) => /^\d{3}_.+\.sql$/u.test(name)).sort()) {
    const version = Number(filename.slice(0, 3));
    if (version > throughVersion) break;
    db.exec(readFileSync(join(migrationsDirectory, filename), "utf8"));
    db.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
      .run(version, filename.slice(0, -4), "2026-07-13T12:00:00.000Z");
  }
}
