import type { RuntimeKind } from "../../adapters/types.ts";
import { stableRecordId } from "../identity.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type ImportSessionImpactKind = "created" | "updated" | "transcript_added" | "enriched";

export type ImportSessionImpactSummary = {
  sessionsAffected: number;
  sessionsCreated: number;
  sessionsUpdated: number;
  transcriptsAdded: number;
  transcriptSessions: number;
  enrichedSessions: number;
};

export function recordImportSessionImpact(
  db: MastheadDatabase,
  input: {
    importJobId: string;
    sourceId?: string;
    runtime: RuntimeKind;
    sessionId: string;
    impactKind: ImportSessionImpactKind;
    recordCount?: number;
    observedAt: string;
  }
): void {
  const impactId = stableRecordId("import_session_impact", [input.importJobId, input.sessionId, input.impactKind]);
  db.prepare(
    `INSERT INTO import_session_impacts (
      impact_id,
      import_job_id,
      source_id,
      runtime_kind,
      session_id,
      impact_kind,
      record_count,
      observed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(import_job_id, session_id, impact_kind) DO UPDATE SET
      record_count = import_session_impacts.record_count + excluded.record_count,
      observed_at = excluded.observed_at`
  ).run(
    impactId,
    input.importJobId,
    input.sourceId ?? null,
    input.runtime,
    input.sessionId,
    input.impactKind,
    input.recordCount ?? 1,
    input.observedAt
  );
}

export function summarizeImportSessionImpacts(db: MastheadDatabase, importJobId: string): ImportSessionImpactSummary {
  const rows = db
    .prepare(
      `SELECT impact_kind, COUNT(DISTINCT session_id) AS sessions, COALESCE(SUM(record_count), 0) AS records
      FROM import_session_impacts
      WHERE import_job_id = ?
      GROUP BY impact_kind`
    )
    .all(importJobId) as Array<{ impact_kind: ImportSessionImpactKind; sessions: number; records: number }>;
  const summary: ImportSessionImpactSummary = {
    enrichedSessions: 0,
    sessionsAffected: countDistinctImpactSessions(db, importJobId),
    sessionsCreated: 0,
    sessionsUpdated: 0,
    transcriptsAdded: 0,
    transcriptSessions: 0
  };
  for (const row of rows) {
    if (row.impact_kind === "created") summary.sessionsCreated = row.sessions;
    if (row.impact_kind === "updated") summary.sessionsUpdated = row.sessions;
    if (row.impact_kind === "transcript_added") {
      summary.transcriptsAdded = row.records;
      summary.transcriptSessions = row.sessions;
    }
    if (row.impact_kind === "enriched") summary.enrichedSessions = row.sessions;
  }
  return summary;
}

export function listImportImpactSessionIds(db: MastheadDatabase, importJobId: string, sourceId?: string): string[] {
  return (db.prepare(
    `SELECT DISTINCT session_id
    FROM import_session_impacts
    WHERE import_job_id = ?
      AND (? IS NULL OR source_id = ?)
    ORDER BY session_id`
  ).all(importJobId, sourceId ?? null, sourceId ?? null) as Array<{ session_id: string }>).map((row) => row.session_id);
}

function countDistinctImpactSessions(db: MastheadDatabase, importJobId: string): number {
  const row = db.prepare(
    `SELECT COUNT(DISTINCT session_id) AS count
    FROM import_session_impacts
    WHERE import_job_id = ?`
  ).get(importJobId) as { count: number } | undefined;
  return row?.count ?? 0;
}
