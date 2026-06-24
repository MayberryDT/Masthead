import { describe, expect, test } from "vitest";
import { validateLlmOutcomeCandidate } from "../outcomeClassifier";
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

describe("LLM outcome candidate validator", () => {
  test("accepts an ended-session candidate only when all evidence refs are present", () => {
    const result = validateLlmOutcomeCandidate(
      {
        outcome: "needs_attention",
        confidence: "medium",
        reason: "Files changed after the last observed verification.",
        evidence_refs: ["event-1", "git-1"],
        missing_evidence: ["No fresh test command observed"],
        recommended_next_action: "Open the diff and rerun verification."
      },
      evidence,
      { lifecycle: "ended" }
    );

    expect(result).toMatchObject({
      ok: true,
      candidate: {
        outcome: "needs_attention",
        support: "inferred"
      }
    });
  });

  test("rejects zero-evidence candidates", () => {
    const result = validateLlmOutcomeCandidate(
      {
        outcome: "completed",
        confidence: "high",
        reason: "The model thinks it is done.",
        evidence_refs: [],
        missing_evidence: [],
        recommended_next_action: "Mark reviewed."
      },
      evidence,
      { lifecycle: "ended" }
    );

    expect(result).toEqual({ ok: false, reason: "llm_outcome_requires_evidence" });
  });

  test("rejects evidence refs that are not in the packet", () => {
    const result = validateLlmOutcomeCandidate(
      {
        outcome: "failed",
        confidence: "medium",
        reason: "Claims a failed command without evidence.",
        evidence_refs: ["missing-command"],
        missing_evidence: [],
        recommended_next_action: "Inspect the failed command."
      },
      evidence,
      { lifecycle: "ended" }
    );

    expect(result).toEqual({ ok: false, reason: "llm_outcome_unknown_evidence_ref" });
  });

  test("rejects candidates that try to classify running sessions", () => {
    const result = validateLlmOutcomeCandidate(
      {
        outcome: "completed",
        confidence: "high",
        reason: "The session appears successful.",
        evidence_refs: ["event-1"],
        missing_evidence: [],
        recommended_next_action: "Move to history."
      },
      evidence,
      { lifecycle: "running" }
    );

    expect(result).toEqual({ ok: false, reason: "llm_outcome_requires_ended_lifecycle" });
  });
});
