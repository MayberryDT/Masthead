import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MastheadDatabase } from "./sqlite.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrations = [
  {
    version: 1,
    name: "001_initial",
    path: resolve(currentDir, "migrations/001_initial.sql")
  }
];

const criticalTables = [
  "raw_events",
  "ingest_sources",
  "ingest_cursors",
  "hosts",
  "runtimes",
  "sessions",
  "turns",
  "messages",
  "session_enrichments",
  "mcp_query_log",
  "session_search"
];

export function migrateDatabase(db: MastheadDatabase): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL);");
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((row) => row.version)
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const sql = readFileSync(migration.path, "utf8");
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        new Date().toISOString()
      );
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }
  validateCriticalTables(db);
}

function validateCriticalTables(db: MastheadDatabase): void {
  const existing = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual')").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name)
  );
  const missing = criticalTables.filter((table) => !existing.has(table));
  if (missing.length > 0) {
    throw new Error(`Database schema is missing critical tables: ${missing.join(", ")}`);
  }
}
