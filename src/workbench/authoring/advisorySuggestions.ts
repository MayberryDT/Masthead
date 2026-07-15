import { stableRecordId } from "../../daemon/identity.ts";
import type { MastheadDatabase } from "../../daemon/db/sqlite.ts";
import type { WorkbenchArtifactSuggestionDto } from "../../shared/workbenchAuthoring.ts";
import { detectArtifactSuggestionSeeds } from "./artifactCandidates.ts";

/**
 * Returns deterministic hints for V3 authoring. Suggestions are read-only and
 * nonbinding: their IDs exist only to deduplicate detector output.
 */
export function getArtifactSuggestions(
  db: MastheadDatabase,
  sessionIds: string[]
): WorkbenchArtifactSuggestionDto[] {
  return detectArtifactSuggestionSeeds(db, sessionIds).map((seed) => ({
    advisory: true,
    evidenceRefs: seed.signalEvidenceRefs,
    kind: seed.kind,
    provenanceSessionIds: seed.provenanceSessionIds,
    ...(seed.signatureKey ? { signatureKey: seed.signatureKey } : {}),
    suggestionId: stableRecordId("artifact-suggestion", [
      seed.kind,
      ...seed.provenanceSessionIds,
      seed.signatureKey ?? "unsigned",
      seed.evidenceRevision
    ]),
    summary: seed.signalSummary
  }));
}
