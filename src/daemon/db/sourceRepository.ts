import { stableRecordId } from "../identity.ts";
import { setSourcePolicy, sourcePolicyEnabled } from "./sourcePolicyRepository.ts";
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
  setSourcePolicy(db, {
    decidedAt: input.approvedAt,
    enabled: true,
    policyKind: "transcript_import",
    reason: input.reason
  });
}

export function transcriptImportApproved(db: MastheadDatabase): boolean {
  return sourcePolicyEnabled(db, "transcript_import");
}
