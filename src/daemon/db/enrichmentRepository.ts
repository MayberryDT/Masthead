import type { SessionEnrichmentRecord } from "../../enrichment/types.ts";
import { stableRecordId } from "../identity.ts";
import type { MastheadDatabase } from "./sqlite.ts";

type SessionEnrichmentRow = {
  enrichmentId: string;
  sessionId: string;
  enrichmentKind: SessionEnrichmentRecord["enrichmentKind"];
  status: SessionEnrichmentRecord["status"];
  contentFingerprint: string;
  promptVersion: string;
  provider: string | null;
  model: string | null;
  generatedAt: string | null;
  contentJson: string | null;
  sourceRefsJson: string;
  failureCode: string | null;
  failureMessage: string | null;
};

export function upsertSessionEnrichment(db: MastheadDatabase, record: Omit<SessionEnrichmentRecord, "enrichmentId">): string {
  const enrichmentId = stableRecordId("enrichment", [
    record.sessionId,
    record.enrichmentKind,
    record.promptVersion,
    record.contentFingerprint
  ]);
  db.prepare(
    `INSERT INTO session_enrichments (
      enrichment_id,
      session_id,
      enrichment_kind,
      status,
      content_fingerprint,
      prompt_version,
      provider,
      model,
      generated_at,
      content_json,
      source_refs_json,
      failure_code,
      failure_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, enrichment_kind, prompt_version, content_fingerprint) DO UPDATE SET
      status = excluded.status,
      provider = excluded.provider,
      model = excluded.model,
      generated_at = excluded.generated_at,
      content_json = excluded.content_json,
      source_refs_json = excluded.source_refs_json,
      failure_code = excluded.failure_code,
      failure_message = excluded.failure_message`
  ).run(
    enrichmentId,
    record.sessionId,
    record.enrichmentKind,
    record.status,
    record.contentFingerprint,
    record.promptVersion,
    record.provider ?? null,
    record.model ?? null,
    record.generatedAt ?? null,
    record.content ? JSON.stringify(record.content) : null,
    JSON.stringify(record.sourceRefs),
    record.failureCode ?? null,
    record.failureMessage ?? null
  );
  return enrichmentId;
}

export function readSessionEnrichment(db: MastheadDatabase, enrichmentId: string): SessionEnrichmentRecord | undefined {
  const row = db
    .prepare(
      `SELECT
        enrichment_id AS enrichmentId,
        session_id AS sessionId,
        enrichment_kind AS enrichmentKind,
        status,
        content_fingerprint AS contentFingerprint,
        prompt_version AS promptVersion,
        provider,
        model,
        generated_at AS generatedAt,
        content_json AS contentJson,
        source_refs_json AS sourceRefsJson,
        failure_code AS failureCode,
        failure_message AS failureMessage
      FROM session_enrichments
      WHERE enrichment_id = ?`
    )
    .get(enrichmentId) as SessionEnrichmentRow | undefined;
  return row ? rowToRecord(row) : undefined;
}

export function readCurrentSessionEnrichment(
  db: MastheadDatabase,
  sessionId: string,
  enrichmentKind: SessionEnrichmentRecord["enrichmentKind"],
  promptVersion?: string
): SessionEnrichmentRecord | undefined {
  const promptClause = promptVersion ? "AND prompt_version = ?" : "";
  const params = promptVersion ? [sessionId, enrichmentKind, promptVersion] : [sessionId, enrichmentKind];
  const row = db
    .prepare(
      `SELECT
        enrichment_id AS enrichmentId,
        session_id AS sessionId,
        enrichment_kind AS enrichmentKind,
        status,
        content_fingerprint AS contentFingerprint,
        prompt_version AS promptVersion,
        provider,
        model,
        generated_at AS generatedAt,
        content_json AS contentJson,
        source_refs_json AS sourceRefsJson,
        failure_code AS failureCode,
        failure_message AS failureMessage
      FROM session_enrichments
      WHERE session_id = ?
        AND enrichment_kind = ?
        AND status = 'current'
        ${promptClause}
      ORDER BY COALESCE(generated_at, '') DESC, enrichment_id DESC
      LIMIT 1`
    )
    .get(...params) as SessionEnrichmentRow | undefined;
  return row ? rowToRecord(row) : undefined;
}

export function readLatestFailedSessionEnrichment(
  db: MastheadDatabase,
  sessionId: string,
  enrichmentKind: SessionEnrichmentRecord["enrichmentKind"],
  promptVersion?: string
): SessionEnrichmentRecord | undefined {
  const promptClause = promptVersion ? "AND prompt_version = ?" : "";
  const params = promptVersion ? [sessionId, enrichmentKind, promptVersion] : [sessionId, enrichmentKind];
  const row = db
    .prepare(
      `SELECT
        enrichment_id AS enrichmentId,
        session_id AS sessionId,
        enrichment_kind AS enrichmentKind,
        status,
        content_fingerprint AS contentFingerprint,
        prompt_version AS promptVersion,
        provider,
        model,
        generated_at AS generatedAt,
        content_json AS contentJson,
        source_refs_json AS sourceRefsJson,
        failure_code AS failureCode,
        failure_message AS failureMessage
      FROM session_enrichments
      WHERE session_id = ?
        AND enrichment_kind = ?
        AND status = 'failed'
        ${promptClause}
      ORDER BY COALESCE(generated_at, '') DESC, enrichment_id DESC
      LIMIT 1`
    )
    .get(...params) as SessionEnrichmentRow | undefined;
  return row ? rowToRecord(row) : undefined;
}

export function markStaleCurrentSessionEnrichments(
  db: MastheadDatabase,
  options: {
    sessionId: string;
    enrichmentKind: SessionEnrichmentRecord["enrichmentKind"];
    promptVersion: string;
    exceptContentFingerprint?: string;
  }
): void {
  db.prepare(
    `UPDATE session_enrichments
    SET status = 'stale'
    WHERE session_id = ?
      AND enrichment_kind = ?
      AND prompt_version = ?
      AND status = 'current'
      AND (? IS NULL OR content_fingerprint <> ?)`
  ).run(
    options.sessionId,
    options.enrichmentKind,
    options.promptVersion,
    options.exceptContentFingerprint ?? null,
    options.exceptContentFingerprint ?? null
  );
}

function rowToRecord(row: SessionEnrichmentRow): SessionEnrichmentRecord {
  return {
    content: parseJson(row.contentJson),
    contentFingerprint: row.contentFingerprint,
    enrichmentId: row.enrichmentId,
    enrichmentKind: row.enrichmentKind,
    failureCode: row.failureCode ?? undefined,
    failureMessage: row.failureMessage ?? undefined,
    generatedAt: row.generatedAt ?? undefined,
    model: row.model ?? undefined,
    promptVersion: row.promptVersion,
    provider: row.provider ?? undefined,
    sessionId: row.sessionId,
    sourceRefs: parseJson(row.sourceRefsJson) ?? [],
    status: row.status
  };
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  return JSON.parse(value) as T;
}
