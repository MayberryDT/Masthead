import type { AttentionItem, EvidenceRef } from "./types";

export type LlmAttentionCandidate = {
  title: string;
  attention_reason: string;
  support_level: "observed" | "inferred" | "weak";
  risk_labels: string[];
  evidence_refs: string[];
  unknowns: string[];
  recommended_action: string;
};

export type LlmAttentionValidationResult =
  | { ok: true; item: AttentionItem }
  | { ok: false; reason: "llm_attention_requires_evidence" | "llm_attention_unknown_evidence_ref" };

export function validateLlmAttentionItem(
  candidate: LlmAttentionCandidate,
  availableEvidence: EvidenceRef[],
  options: { sessionId?: string; project?: string; createdAt?: string } = {}
): LlmAttentionValidationResult {
  if (candidate.evidence_refs.length === 0) {
    return { ok: false, reason: "llm_attention_requires_evidence" };
  }

  const evidenceById = new Map(availableEvidence.map((evidence) => [evidence.id, evidence]));
  const evidence: EvidenceRef[] = [];
  for (const evidenceId of candidate.evidence_refs) {
    const ref = evidenceById.get(evidenceId);
    if (!ref) {
      return { ok: false, reason: "llm_attention_unknown_evidence_ref" };
    }
    evidence.push(ref);
  }

  return {
    ok: true,
    item: {
      itemId: `llm:${candidate.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      sessionId: options.sessionId ?? "contextual",
      project: options.project ?? "Unknown project",
      type: "stale_verification",
      severity: candidate.support_level === "weak" ? "P3" : "P2",
      title: candidate.title,
      createdAt: options.createdAt ?? new Date(0).toISOString(),
      affectedPaths: [],
      affectedCommandIds: [],
      evidence,
      support: "inferred",
      suggestedNextAction: candidate.recommended_action
    }
  };
}
