import type { PublishedSessionDossierV1 } from "../shared/sessionDossier.ts";

export type EligibilityReason =
  | "unsupported_kind"
  | "not_current_logbook_page"
  | "unsupported_schema"
  | "current_enrichment_required"
  | "single_session_dossier_required";

export type StableEligibilityReason = Exclude<EligibilityReason, "not_current_logbook_page">;

export type EligibilityResult<Reason extends EligibilityReason = EligibilityReason> =
  | { eligible: true }
  | { eligible: false; reason: Reason };

export type LocalArtifactForPages = {
  artifactKind: string;
  status: string;
  publicationStatus: string;
  schemaVersion: string;
  content: PublishedSessionDossierV1;
  provenanceSessionIds: readonly string[];
};

export type StableArtifactForPages = Pick<
  LocalArtifactForPages,
  "artifactKind" | "schemaVersion" | "content" | "provenanceSessionIds"
>;

function ineligible<Reason extends EligibilityReason>(reason: Reason): EligibilityResult<Reason> {
  return { eligible: false, reason };
}

export function evaluateStableSessionDossierEligibility(
  input: StableArtifactForPages,
): EligibilityResult<StableEligibilityReason> {
  if (input.artifactKind !== "session_dossier") {
    return ineligible("unsupported_kind");
  }
  if (
    input.schemaVersion !== "canonical-session-dossier-v1" ||
    input.content.snapshotVersion !== "canonical-session-dossier-v1"
  ) {
    return ineligible("unsupported_schema");
  }
  if (
    input.content.enrichment.status !== "current" ||
    !input.content.durableEnrichment
  ) {
    return ineligible("current_enrichment_required");
  }
  if (input.provenanceSessionIds.length !== 1) {
    return ineligible("single_session_dossier_required");
  }
  return { eligible: true };
}

export function checkSessionDossierEligibility(
  input: LocalArtifactForPages,
): EligibilityResult {
  if (input.artifactKind !== "session_dossier") {
    return ineligible("unsupported_kind");
  }
  if (input.status !== "current" || input.publicationStatus !== "published") {
    return ineligible("not_current_logbook_page");
  }
  return evaluateStableSessionDossierEligibility(input);
}
