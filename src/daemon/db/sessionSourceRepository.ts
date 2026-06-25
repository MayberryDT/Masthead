import type { MastheadDatabase } from "./sqlite.ts";

export type SessionSourceInput = {
  sessionId: string;
  sourceId: string;
  observedAt: string;
  importedRecordCount?: number;
};

export function upsertSessionSource(db: MastheadDatabase, input: SessionSourceInput): void {
  db.prepare(
    `INSERT INTO session_sources (
      session_id, source_id, first_seen_at, last_seen_at, imported_record_count
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id, source_id) DO UPDATE SET
      last_seen_at = excluded.last_seen_at,
      imported_record_count = session_sources.imported_record_count + excluded.imported_record_count`
  ).run(input.sessionId, input.sourceId, input.observedAt, input.observedAt, input.importedRecordCount ?? 1);
}

export function countDistinctSessionsForSource(db: MastheadDatabase, sourceId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT session_id) AS count
      FROM session_sources
      WHERE source_id = ?`
    )
    .get(sourceId) as { count: number };
  return row.count;
}
