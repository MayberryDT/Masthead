import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MastheadDatabase } from "./sqlite.ts";
import { randomUUID } from "node:crypto";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrations = [
  {
    version: 1,
    name: "001_initial",
    path: resolve(currentDir, "migrations/001_initial.sql")
  },
  {
    version: 2,
    name: "002_session_data_product",
    path: resolve(currentDir, "migrations/002_session_data_product.sql")
  },
  {
    version: 3,
    name: "003_session_sources",
    path: resolve(currentDir, "migrations/003_session_sources.sql")
  },
  {
    version: 4,
    name: "004_cursor_context",
    path: resolve(currentDir, "migrations/004_cursor_context.sql")
  },
  {
    version: 5,
    name: "005_import_progress",
    path: resolve(currentDir, "migrations/005_import_progress.sql")
  },
  {
    version: 6,
    name: "006_source_setup",
    path: resolve(currentDir, "migrations/006_source_setup.sql")
  },
  {
    version: 7,
    name: "007_live_projection_enrichment_indexes",
    path: resolve(currentDir, "migrations/007_live_projection_enrichment_indexes.sql")
  },
  {
    version: 8,
    name: "008_live_projection_usage_indexes",
    path: resolve(currentDir, "migrations/008_live_projection_usage_indexes.sql")
  },
  {
    version: 9,
    name: "009_import_ledger",
    path: resolve(currentDir, "migrations/009_import_ledger.sql")
  },
  {
    version: 10,
    name: "010_board_headline_frames",
    path: resolve(currentDir, "migrations/010_board_headline_frames.sql")
  },
  {
    version: 11,
    name: "011_board_headline_generations",
    path: resolve(currentDir, "migrations/011_board_headline_generations.sql")
  },
  {
    version: 13,
    name: "013_dossier_enrichment_indexes",
    path: resolve(currentDir, "migrations/013_dossier_enrichment_indexes.sql")
  }
];

export const CURRENT_SCHEMA_VERSION = migrations[migrations.length - 1]?.version ?? 0;

const criticalTables = [
  "raw_events",
  "ingest_sources",
  "ingest_cursors",
  "hosts",
  "runtimes",
  "sessions",
  "session_sources",
  "turns",
  "messages",
  "session_enrichments",
  "mcp_query_log",
  "session_search",
  "app_settings",
  "source_policies",
  "source_scan_runs",
  "source_setup_state",
  "runtime_policies",
  "import_manifests",
  "import_work_units",
  "import_failure_groups",
  "import_session_impacts",
  "legacy_migrations",
  "board_headline_frames",
  "board_headline_generations"
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

export function hasPendingMigrations(db: MastheadDatabase): boolean {
  const tables = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name)
  );
  if (!tables.has("schema_migrations")) return tables.size > 0;

  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((row) => row.version)
  );
  return migrations.some((migration) => !applied.has(migration.version));
}
export function getOrCreateDatabaseIdentity(db: MastheadDatabase): string {
  const row = db.prepare("SELECT setting_json AS value FROM app_settings WHERE setting_key = ?").get("database_identity") as
    | { value: string }
    | undefined;
  const existing = parseDatabaseIdentity(row?.value);
  if (existing) return existing;

  const databaseId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO app_settings(setting_key, setting_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_json = excluded.setting_json,
      updated_at = excluded.updated_at`
  ).run("database_identity", JSON.stringify({ databaseId, createdAt: now }), now);
  return databaseId;
}

function parseDatabaseIdentity(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "string" && parsed.trim()) return parsed;
    if (typeof parsed === "object" && parsed !== null && "databaseId" in parsed && typeof parsed.databaseId === "string") {
      return parsed.databaseId;
    }
  } catch {
    return undefined;
  }
  return undefined;
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
