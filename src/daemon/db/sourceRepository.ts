import { stableRecordId } from "../identity.ts";
import { relative, resolve } from "node:path";
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

export function sourceIsExcluded(
  db: MastheadDatabase,
  input: string | { project?: string; sourceId?: string; sourcePath?: string }
): boolean {
  const sourcePath = typeof input === "string" ? input : input.sourcePath;
  const sourceId = typeof input === "string" ? undefined : input.sourceId;
  const project = typeof input === "string" ? undefined : input.project;
  const rows = db.prepare("SELECT exclusion_kind AS exclusionKind, pattern FROM source_exclusions WHERE disabled_at IS NULL").all() as Array<{
    exclusionKind: "source" | "project" | "path";
    pattern: string;
  }>;
  return rows.some((row) => {
    if (row.exclusionKind === "source") return Boolean(sourceId && sourceId === row.pattern);
    if (row.exclusionKind === "project") return Boolean(project && project === row.pattern);
    return Boolean(sourcePath && pathMatchesExclusion(sourcePath, row.pattern));
  });
}

function pathMatchesExclusion(sourcePath: string, pattern: string): boolean {
  const source = resolve(sourcePath);
  const excluded = resolve(pattern);
  const rel = relative(excluded, source);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/") && rel !== "..");
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
