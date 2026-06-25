import type { IngestCursor } from "../../adapters/types.ts";
import { stableRecordId } from "../identity.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export function upsertCursor(db: MastheadDatabase, cursor: Omit<IngestCursor, "cursorId">): void {
  const cursorId = stableRecordId("cursor", [cursor.sourceId, cursor.sourcePath ?? ""]);
  ensureCursorSource(db, cursor.sourceId, cursor.sourcePath);
  db.prepare(
    `INSERT INTO ingest_cursors (
      cursor_id,
      source_id,
      source_path,
      byte_offset,
      modified_at,
      content_fingerprint,
      source_session_id,
      cwd,
      model,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, source_path) DO UPDATE SET
      byte_offset = excluded.byte_offset,
      modified_at = excluded.modified_at,
      content_fingerprint = excluded.content_fingerprint,
      source_session_id = COALESCE(excluded.source_session_id, ingest_cursors.source_session_id),
      cwd = COALESCE(excluded.cwd, ingest_cursors.cwd),
      model = COALESCE(excluded.model, ingest_cursors.model),
      updated_at = excluded.updated_at`
  ).run(
    cursorId,
    cursor.sourceId,
    cursor.sourcePath ?? null,
    cursor.byteOffset,
    cursor.modifiedAt ?? null,
    cursor.contentFingerprint ?? null,
    cursor.sourceSessionId ?? null,
    cursor.cwd ?? null,
    cursor.model ?? null,
    new Date().toISOString()
  );
}

function ensureCursorSource(db: MastheadDatabase, sourceId: string, sourcePath: string | undefined): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id,
      adapter,
      source_kind,
      source_path,
      confidence,
      discovered_at,
      last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      source_path = COALESCE(ingest_sources.source_path, excluded.source_path),
      last_seen_at = excluded.last_seen_at`
  ).run(sourceId, "unknown", "jsonl", sourcePath ?? null, "inferred", now, now);
}

export function readCursor(db: MastheadDatabase, sourceId: string, sourcePath?: string): IngestCursor | undefined {
  return db
    .prepare(
      `SELECT cursor_id AS cursorId,
        source_id AS sourceId,
        source_path AS sourcePath,
        byte_offset AS byteOffset,
        modified_at AS modifiedAt,
        content_fingerprint AS contentFingerprint,
        source_session_id AS sourceSessionId,
        cwd AS cwd,
        model AS model
      FROM ingest_cursors
      WHERE source_id = ? AND source_path IS ?`
    )
    .get(sourceId, sourcePath ?? null) as IngestCursor | undefined;
}
