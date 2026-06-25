import type { SessionEnrichmentRecord } from "../../enrichment/types.ts";
import { stableRecordId } from "../identity.ts";
import type { MastheadDatabase } from "./sqlite.ts";

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
