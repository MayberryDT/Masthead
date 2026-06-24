import { describe, expect, test } from "vitest";
import { validateLlmAttentionItem } from "../llmAttention";
import type { EvidenceRef } from "../types";

const evidence: EvidenceRef[] = [
  {
    id: "event-1",
    kind: "event",
    observedAt: "2026-06-23T02:00:00.000Z",
    source: "codex.fixture"
  },
  {
    id: "git-1",
    kind: "git_snapshot",
    observedAt: "2026-06-23T02:01:00.000Z",
    source: "git.observer"
  }
];

describe("LLM contextual attention validator", () => {
  test("accepts an inferred item only when all evidence refs are present", () => {
    const result = validateLlmAttentionItem(
      {
        title: "Auth task needs review",
        attention_reason: "The session touched auth files after tests ran.",
        support_level: "inferred",
        risk_labels: ["high-risk action"],
        evidence_refs: ["event-1", "git-1"],
        unknowns: ["No browser verification observed"],
        recommended_action: "Open the diff and rerun verification."
      },
      evidence
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.item.support).toBe("inferred");
      expect(result.item.evidence.map((ref) => ref.id)).toEqual(["event-1", "git-1"]);
    }
  });

  test("rejects zero-evidence contextual items", () => {
    const result = validateLlmAttentionItem(
      {
        title: "Looks risky",
        attention_reason: "The model feels uncertain.",
        support_level: "weak",
        risk_labels: ["needs review"],
        evidence_refs: [],
        unknowns: [],
        recommended_action: "Interrupt the session."
      },
      evidence
    );

    expect(result).toEqual({
      ok: false,
      reason: "llm_attention_requires_evidence"
    });
  });

  test("rejects evidence references that are not in the packet", () => {
    const result = validateLlmAttentionItem(
      {
        title: "Unsupported file claim",
        attention_reason: "Claims a file changed without evidence.",
        support_level: "inferred",
        risk_labels: ["needs review"],
        evidence_refs: ["missing-file-change"],
        unknowns: [],
        recommended_action: "Open the session."
      },
      evidence
    );

    expect(result).toEqual({
      ok: false,
      reason: "llm_attention_unknown_evidence_ref"
    });
  });
});
