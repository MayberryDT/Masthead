import type { DiscoveredSource } from "../../adapters/types.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";

export type SourceStatusDto = {
  sourceId: string;
  runtime: string;
  sourceKind: string;
  path?: string;
  confidence: "authoritative" | "inferred" | "heuristic";
  discoveredSessions: number;
  importedSessions: number;
  importedRecords: number;
  queuedRecords: number;
  failureCount: number;
  lastSyncAt?: string;
  transcriptImportEnabled: boolean;
  enrichmentEnabled: boolean;
  mcpEnabled: boolean;
  sessionCount?: number;
  importedCount?: number;
  queuedCount?: number;
  failures?: number;
  lastSync?: string;
};

type SourceRow = {
  source_id: string;
  adapter: string;
  source_kind: string;
  source_path: string | null;
  confidence: SourceStatusDto["confidence"];
};

type CountsRow = {
  importedRecords: number | null;
  queuedRecords: number | null;
  failureCount: number | null;
  lastSyncAt: string | null;
};

export function getSourceStatuses(db: MastheadDatabase, discoveredSources: DiscoveredSource[] = []): SourceStatusDto[] {
  upsertDiscoveredSources(db, discoveredSources);
  const rows = db.prepare("SELECT source_id, adapter, source_kind, source_path, confidence FROM ingest_sources ORDER BY source_id").all() as SourceRow[];
  return rows.map((row) => {
    const counts = importCounts(db, row.source_id);
    const importedSessions = importedSessionCount(db, row.adapter);
    const discoveredSessions = Math.max(importedSessions, counts.importedRecords ?? 0);
    const status = {
      confidence: row.confidence,
      discoveredSessions,
      enrichmentEnabled: policyEnabled(db, row.source_id, "enrichment"),
      failureCount: counts.failureCount ?? 0,
      importedRecords: counts.importedRecords ?? 0,
      importedSessions,
      lastSyncAt: counts.lastSyncAt ?? undefined,
      mcpEnabled: policyEnabled(db, row.source_id, "mcp_access", true),
      path: row.source_path ?? undefined,
      queuedRecords: counts.queuedRecords ?? 0,
      runtime: row.adapter,
      sourceId: row.source_id,
      sourceKind: row.source_kind,
      transcriptImportEnabled: policyEnabled(db, row.source_id, "transcript_import")
    } satisfies SourceStatusDto;
    return {
      ...status,
      failures: status.failureCount,
      importedCount: status.importedRecords,
      lastSync: status.lastSyncAt,
      queuedCount: status.queuedRecords,
      sessionCount: status.discoveredSessions
    };
  });
}

function upsertDiscoveredSources(db: MastheadDatabase, sources: DiscoveredSource[]): void {
  if (sources.length === 0) return;
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, endpoint, schema_version, runtime_version, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      source_path = excluded.source_path,
      endpoint = excluded.endpoint,
      schema_version = excluded.schema_version,
      runtime_version = excluded.runtime_version,
      confidence = excluded.confidence,
      last_seen_at = excluded.last_seen_at`
  );
  for (const source of sources) {
    insert.run(
      source.sourceId,
      source.runtime,
      source.sourceKind,
      source.path ?? null,
      source.endpoint ?? null,
      source.schemaVersion ?? null,
      source.runtimeVersion ?? null,
      source.confidence,
      now,
      now
    );
  }
}

function importCounts(db: MastheadDatabase, sourceId: string): CountsRow {
  return db
    .prepare(
      `SELECT
        COALESCE(SUM(imported_count), 0) AS importedRecords,
        COALESCE(SUM(queued_count), 0) AS queuedRecords,
        COALESCE(SUM(failure_count), 0) AS failureCount,
        MAX(updated_at) AS lastSyncAt
      FROM import_jobs
      WHERE source_id = ?`
    )
    .get(sourceId) as CountsRow;
}

function importedSessionCount(db: MastheadDatabase, runtime: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS count
        FROM sessions
        JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
        WHERE sessions.deleted_at IS NULL
          AND runtimes.runtime_kind = ?`
      )
      .get(runtime) as { count: number }
  ).count;
}

function policyEnabled(db: MastheadDatabase, sourceId: string, policyKind: string, defaultValue = false): boolean {
  const row = db
    .prepare(
      `SELECT enabled
      FROM source_policies
      WHERE policy_kind = ?
        AND (source_id = ? OR source_id IS NULL)
      ORDER BY source_id IS NOT NULL DESC, decided_at DESC
      LIMIT 1`
    )
    .get(policyKind, sourceId) as { enabled: number } | undefined;
  return row ? row.enabled === 1 : defaultValue;
}
