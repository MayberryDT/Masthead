import type { EvidenceRef, SessionLifecycle, SessionOutcomeLabel } from "./types";

export type LlmOutcomeCandidate = {
  outcome: SessionOutcomeLabel;
  confidence: "high" | "medium" | "low";
  reason: string;
  evidence_refs: string[];
  missing_evidence: string[];
  recommended_next_action: string;
};

export type ValidatedLlmOutcomeCandidate = LlmOutcomeCandidate & {
  support: "inferred";
  evidence: EvidenceRef[];
};

export type LlmOutcomeValidationResult =
  | { ok: true; candidate: ValidatedLlmOutcomeCandidate }
  | {
      ok: false;
      reason:
        | "llm_outcome_requires_ended_lifecycle"
        | "llm_outcome_requires_evidence"
        | "llm_outcome_unknown_evidence_ref";
    };

export function validateLlmOutcomeCandidate(
  candidate: LlmOutcomeCandidate,
  availableEvidence: EvidenceRef[],
  context: { lifecycle: SessionLifecycle }
): LlmOutcomeValidationResult {
  if (context.lifecycle !== "ended") {
    return { ok: false, reason: "llm_outcome_requires_ended_lifecycle" };
  }

  if (candidate.evidence_refs.length === 0) {
    return { ok: false, reason: "llm_outcome_requires_evidence" };
  }

  const evidenceById = new Map(availableEvidence.map((ref) => [ref.id, ref]));
  const evidence: EvidenceRef[] = [];
  for (const evidenceId of candidate.evidence_refs) {
    const ref = evidenceById.get(evidenceId);
    if (!ref) {
      return { ok: false, reason: "llm_outcome_unknown_evidence_ref" };
    }
    evidence.push(ref);
  }

  return {
    ok: true,
    candidate: {
      ...candidate,
      support: "inferred",
      evidence
    }
  };
}
