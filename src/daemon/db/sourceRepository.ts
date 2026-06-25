import { stableRecordId } from "../identity.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type SourceExclusionInput = {
  exclusionKind: "source" | "project" | "path";
  pattern: string;
  reason: string;
  createdAt: string;
};

export function addSourceExclusion(db: MastheadDatabase, input: SourceExclusionInput): void {
  db.prepare(
    `INSERT INTO source_exclusions (exclusion_id, exclusion_kind, pattern, reason, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(exclusion_kind, pattern) DO UPDATE SET
      reason = excluded.reason,
      disabled_at = NULL`
  ).run(stableRecordId("exclusion", [input.exclusionKind, input.pattern]), input.exclusionKind, input.pattern, input.reason, input.createdAt);
}

export function sourceIsExcluded(db: MastheadDatabase, sourcePath: string): boolean {
  const rows = db.prepare("SELECT pattern FROM source_exclusions WHERE disabled_at IS NULL").all() as Array<{ pattern: string }>;
  return rows.some((row) => sourcePath.includes(row.pattern));
}

export function approveTranscriptImport(
  db: MastheadDatabase,
  input: {
    approvedAt: string;
    reason: string;
  }
): void {
  addSourceExclusion(db, {
    createdAt: input.approvedAt,
    exclusionKind: "source",
    pattern: "__masthead_transcript_import_approved__",
    reason: input.reason
  });
}

export function transcriptImportApproved(db: MastheadDatabase): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS approved
      FROM source_exclusions
      WHERE exclusion_kind = 'source'
        AND pattern = '__masthead_transcript_import_approved__'
        AND disabled_at IS NULL
      LIMIT 1`
    )
    .get() as { approved: number } | undefined;
  return Boolean(row);
}
