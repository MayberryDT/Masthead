import type { IngestCursor } from "../../adapters/types.ts";
import type { TranscriptUnitPlan } from "../../adapters/transcriptUnits.ts";
import type { ImportScopeDto, ImportUnitScopeReason } from "../../shared/sourceImport.ts";

export type ImportUnitScopeDecision = {
  include: boolean;
  reason: ImportUnitScopeReason;
};

export function decideImportUnitScope(input: {
  unit: Pick<TranscriptUnitPlan, "modifiedAt" | "semanticActivityAt">;
  cursor?: IngestCursor;
  generatedAt: string;
  scope: ImportScopeDto;
}): ImportUnitScopeDecision {
  if (input.scope.mode === "metadata_all" || input.scope.mode === "transcript_full" || input.scope.mode === "enrichment_missing") {
    return { include: true, reason: "full_archive" };
  }
  const candidateAt = input.unit.semanticActivityAt ?? input.unit.modifiedAt;
  const cutoff = Date.parse(input.generatedAt) - (input.scope.days ?? 30) * 86_400_000;
  if (candidateAt && Date.parse(candidateAt) >= cutoff) return { include: true, reason: "inside_recent_range" };
  if (!input.scope.includeChangedSinceCursor || !input.cursor) return { include: false, reason: "outside_recent_range" };
  const changed = Boolean(
    input.unit.modifiedAt && input.cursor.modifiedAt && input.unit.modifiedAt !== input.cursor.modifiedAt
  );
  return changed
    ? { include: true, reason: "changed_since_cursor" }
    : { include: false, reason: "outside_recent_range" };
}
