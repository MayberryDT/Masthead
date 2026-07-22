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
    version: 12,
    name: "012_board_headline_frame_refresh_keys",
    path: resolve(currentDir, "migrations/012_board_headline_frame_refresh_keys.sql")
  },
  {
    version: 13,
    name: "013_dossier_enrichment_indexes",
    path: resolve(currentDir, "migrations/013_dossier_enrichment_indexes.sql")
  },
  {
    version: 14,
    name: "014_live_state_reports",
    path: resolve(currentDir, "migrations/014_live_state_reports.sql")
  },
  {
    version: 15,
    name: "015_workbench_runs",
    path: resolve(currentDir, "migrations/015_workbench_runs.sql")
  },
  {
    version: 16,
    name: "016_session_artifacts",
    path: resolve(currentDir, "migrations/016_session_artifacts.sql")
  },
  {
    version: 17,
    name: "017_workbench_pipeline",
    path: resolve(currentDir, "migrations/017_workbench_pipeline.sql")
  },
  {
    version: 18,
    name: "018_artifact_first_logbook",
    path: resolve(currentDir, "migrations/018_artifact_first_logbook.sql")
  },
  {
    version: 19,
    name: "019_workbench_authoring_runs",
    path: resolve(currentDir, "migrations/019_workbench_authoring_runs.sql")
  },
  {
    version: 20,
    name: "020_normalize_workbench_optional_statuses",
    path: resolve(currentDir, "migrations/020_normalize_workbench_optional_statuses.sql")
  },
  {
    version: 21,
    name: "021_artifact_body_search",
    path: resolve(currentDir, "migrations/021_artifact_body_search.sql")
  },
  {
    version: 22,
    name: "022_workbench_authoring_v2",
    path: resolve(currentDir, "migrations/022_workbench_authoring_v2.sql")
  },
  {
    version: 23,
    name: "023_workbench_artifact_candidates",
    path: resolve(currentDir, "migrations/023_workbench_artifact_candidates.sql")
  },
  {
    version: 24,
    name: "024_artifact_candidate_detector_revision",
    path: resolve(currentDir, "migrations/024_artifact_candidate_detector_revision.sql")
  },
  {
    version: 25,
    name: "025_import_unit_scope",
    path: resolve(currentDir, "migrations/025_import_unit_scope.sql")
  },
  {
    version: 26,
    name: "026_session_import_health",
    path: resolve(currentDir, "migrations/026_session_import_health.sql")
  },
  {
    version: 27,
    name: "027_workbench_suppression_provenance",
    path: resolve(currentDir, "migrations/027_workbench_suppression_provenance.sql")
  },
  {
    version: 28,
    name: "028_session_transcript_fingerprints",
    path: resolve(currentDir, "migrations/028_session_transcript_fingerprints.sql")
  },
  {
    version: 29,
    name: "029_import_repair_replacements",
    path: resolve(currentDir, "migrations/029_import_repair_replacements.sql")
  },
  {
    version: 30,
    name: "030_session_search_rowids",
    path: resolve(currentDir, "migrations/030_session_search_rowids.sql")
  },
  {
    version: 31,
    name: "031_guided_authoring",
    path: resolve(currentDir, "migrations/031_guided_authoring.sql")
  },
  {
    version: 32,
    name: "032_guided_enrichment_provenance",
    path: resolve(currentDir, "migrations/032_guided_enrichment_provenance.sql")
  },
  {
    version: 33,
    name: "033_data_revisions",
    path: resolve(currentDir, "migrations/033_data_revisions.sql")
  },
  {
    version: 34,
    name: "034_artifact_first_summary",
    path: resolve(currentDir, "migrations/034_artifact_first_summary.sql")
  },
  {
    version: 35,
    name: "035_artifact_skill_search",
    path: resolve(currentDir, "migrations/035_artifact_skill_search.sql")
  }
];

export const CURRENT_SCHEMA_VERSION = migrations[migrations.length - 1]?.version ?? 0;

export function validateCurrentDatabaseSchema(db: MastheadDatabase): void {
  const applied = db.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all() as Array<{
    name: string;
    version: number;
  }>;
  if (
    applied.length !== migrations.length ||
    applied.some((row, index) => row.version !== migrations[index]?.version || row.name !== migrations[index]?.name)
  ) {
    throw new Error("Database schema migration ledger does not exactly match the current target schema.");
  }
  validateCriticalTables(db);
}

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
  "session_search_rowids",
  "app_settings",
  "source_policies",
  "source_scan_runs",
  "source_setup_state",
  "runtime_policies",
  "import_manifests",
  "import_work_units",
  "import_failure_groups",
  "import_session_impacts",
  "session_import_health",
  "import_repair_replacements",
  "session_transcript_fingerprints",
  "legacy_migrations",
  "board_headline_frames",
  "board_headline_generations",
  "live_state_reports",
  "workbench_runs",
  "session_artifacts",
  "session_artifact_search",
  "session_artifact_provenance",
  "workbench_session_state",
  "workbench_activity",
  "workbench_claims",
  "workbench_authoring_runs",
  "workbench_authoring_run_sessions",
  "workbench_artifact_candidates",
  "workbench_artifact_candidate_provenance",
  "workbench_artifact_candidate_signature_members",
  "workbench_artifact_candidate_source_revisions",
  "workbench_artifact_candidate_scans",
  "guided_authoring_requests",
  "guided_authoring_request_sessions",
  "guided_authoring_opportunities",
  "guided_authoring_assignments",
  "guided_authoring_assignment_sessions",
  "guided_authoring_assignment_opportunities",
  "guided_authoring_evidence_access",
  "guided_authoring_draft_reviews",
  "guided_authoring_operator_reviews",
  "guided_authoring_enrichment_provenance",
  "masthead_data_revisions"
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
  repairHistoricalSchemaDrift(db);
  validateCriticalTables(db);
}

/**
 * Applies every unapplied migration inside a transaction already owned by the
 * caller. Recovery tooling uses this to make schema cutover and data mutation
 * one rollback boundary; this function never begins or commits a transaction.
 */
export function applyPendingMigrationsInTransaction(db: MastheadDatabase): void {
  if (!db.isTransaction) throw new Error("schema_migration_transaction_required");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL);");
  const appliedRows = db.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all() as Array<{
    name: string;
    version: number;
  }>;
  const knownByVersion = new Map(migrations.map((migration) => [migration.version, migration.name]));
  for (const row of appliedRows) {
    if (knownByVersion.get(row.version) !== row.name) {
      throw new Error(`schema_migration_ledger_mismatch:${row.version}:${row.name}`);
    }
  }
  const applied = new Set(appliedRows.map((row) => row.version));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.exec(readFileSync(migration.path, "utf8"));
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
      migration.version,
      migration.name,
      new Date().toISOString()
    );
  }
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

function repairHistoricalSchemaDrift(db: MastheadDatabase): void {
  if (!tableExists(db, "board_headline_frames")) return;

  if (!tableHasColumn(db, "board_headline_frames", "refresh_key_hash")) {
    db.exec("ALTER TABLE board_headline_frames ADD COLUMN refresh_key_hash TEXT;");
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_board_headline_frames_refresh_key
    ON board_headline_frames(source_session_id, refresh_key_hash, generated_at DESC);`
  );
}

function tableExists(db: MastheadDatabase, tableName: string): boolean {
  const row = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type IN ('table', 'virtual') AND name = ?").get(tableName) as
    | { found: number }
    | undefined;
  return Boolean(row);
}

function tableHasColumn(db: MastheadDatabase, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName});`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}
