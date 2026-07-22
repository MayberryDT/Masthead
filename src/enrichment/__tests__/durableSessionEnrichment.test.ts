import { describe, expect, test } from "vitest";
import type { EvidenceRef } from "../../core/types.ts";
import type { DurableSessionEnrichment, SessionTitleEnrichment } from "../../shared/sessionEnrichment.ts";
import {
  buildProviderEvidenceCatalog,
  fallbackDurableSessionEnrichment,
  mergeDurableProviderOutput,
  validateSessionSummaryText,
  validateSessionTitleText
} from "../durableSessionEnrichment.ts";
import type { SessionCapsule } from "../types.ts";

describe("durable session enrichment", () => {
  test("SessionCapsule can carry durable Logbook and Dossier enrichment", () => {
    const title: SessionTitleEnrichment = {
      basis: "dominant_work",
      confidence: "high",
      evidenceRefs: [],
      text: "Durable Logbook title structure"
    };
    const durable: DurableSessionEnrichment = {
      keywords: ["durable enrichment"],
      sessionDossier: {
        blockers: [],
        continuation: {
          constraints: [],
          openQuestions: []
        },
        decisions: [],
        evidenceRefs: [],
        keyWork: ["Added durable enrichment fields."],
        verification: {
          commands: [],
          evidenceRefs: [],
          failures: [],
          status: "unknown",
          summary: "Verification evidence has not been captured."
        },
        warnings: []
      },
      sessionSummary: {
        confidence: "high",
        evidenceRefs: [],
        state: "completed",
        text: "Added durable session enrichment fields for Logbook and Dossier records."
      },
      sessionTitle: title,
      version: "session-capsule-v4"
    };
    const capsule: SessionCapsule = {
      candidateDecisions: [],
      durableEnrichment: durable,
      searchPhrases: [],
      sessionDossier: durable.sessionDossier,
      sessionSummary: durable.sessionSummary,
      sessionTitle: title,
      technologies: [],
      title: "Durable Logbook title structure",
      topics: [],
      unresolved: []
    };

    expect(capsule.sessionTitle?.text).toBe("Durable Logbook title structure");
    expect(capsule.durableEnrichment?.version).toBe("session-capsule-v4");
  });

  test("validates stable durable session titles", () => {
    expect(validateSessionTitleText("Board motion tier implementation").ok).toBe(true);
    expect(validateSessionTitleText("Session title enrichment structure").ok).toBe(true);
    expect(validateSessionTitleText("UI changes").ok).toBe(false);
    expect(validateSessionTitleText("Session had recent activity.").ok).toBe(false);
    expect(validateSessionTitleText("npm run typecheck").ok).toBe(false);
    expect(validateSessionTitleText("Secret token repair").ok).toBe(false);
  });

  test("validates archival session summaries", () => {
    expect(validateSessionSummaryText("Defined stable Logbook titles as durable noun phrases separate from rotating Board headlines.").ok).toBe(true);
    expect(validateSessionSummaryText("The session had recent activity.").ok).toBe(false);
    expect(validateSessionSummaryText("Work is being updated around the UI.").ok).toBe(false);
    expect(validateSessionSummaryText("I found the root cause and fixed the Settings hash route cleanup.").ok).toBe(false);
    expect(validateSessionSummaryText("Missing punctuation").ok).toBe(false);
  });

  test("builds low-confidence fallback durable enrichment from sparse facts", () => {
    const fallback = fallbackDurableSessionEnrichment({
      commands: [],
      evidence: [],
      files: [],
      messages: [],
      project: "Masthead",
      sessionId: "session-1",
      sourceSessionId: "source-1",
      title: "Codex session"
    });

    expect(fallback.sessionTitle).toMatchObject({
      basis: "fallback",
      confidence: "low",
      text: "Masthead imported evidence"
    });
    expect(fallback.sessionSummary.state).toBe("unknown");
    expect(fallback.sessionDossier.warnings).toContain("Durable enrichment used a low-confidence fallback.");
    expect(fallback.keywords).toEqual([]);
  });

  test("merges provider durable fields with exact evidence ID mapping", () => {
    const evidence: EvidenceRef[] = [
      { id: "event-1", kind: "event", observedAt: "2026-07-02T07:00:00.000Z", source: "codex.history" },
      { id: "event-2", kind: "file_change", observedAt: "2026-07-02T07:01:00.000Z", source: "codex.hook" }
    ];
    const fallback = fallbackDurableSessionEnrichment({
      commands: ["npm test"],
      evidence,
      files: ["src/enrichment/openAIProvider.ts"],
      messages: ["Repair durable title parsing."],
      project: "Masthead",
      sessionId: "session-provider-merge",
      sourceSessionId: "source-provider-merge",
      title: "Codex session"
    });

    const merged = mergeDurableProviderOutput(
      fallback,
      {
        sessionDossier: {
          blockers: [],
          continuation: {
            constraints: [],
            nextStep: "Wire parsed durable fields into provider output.",
            openQuestions: []
          },
          decisions: [],
          evidenceRefIds: ["event-1", "missing-event"],
          keyWork: ["Validated provider evidence references."],
          outcome: "Provider evidence references are validated before storage.",
          purpose: "Repair durable title parsing.",
          verification: {
            commands: ["vitest"],
            evidenceRefIds: ["event-1"],
            failures: [],
            status: "passed",
            summary: "Provider parsing tests passed."
          },
          warnings: []
        },
        sessionSummary: {
          confidence: "high",
          evidenceRefIds: ["event-1"],
          state: "completed",
          text: "Repaired durable title parsing so provider evidence references are validated before storage."
        },
        sessionTitle: {
          basis: "dominant_work",
          confidence: "high",
          evidenceRefIds: ["event-1", "missing-event"],
          text: "Durable title parsing repair"
        }
      },
      buildProviderEvidenceCatalog(evidence)
    );

    expect(merged.sessionTitle.text).toBe("Durable title parsing repair");
    expect(merged.sessionTitle.evidenceRefs).toEqual([evidence[0]]);
    expect(merged.sessionDossier.evidenceRefs).toEqual([evidence[0]]);
  });

  test("drops sensitive provider-controlled dossier fields", () => {
    const fallback = fallbackDurableSessionEnrichment({
      commands: [],
      evidence: [],
      files: [],
      messages: ["Repair durable field filtering."],
      project: "Masthead",
      sessionId: "session-sensitive-dossier",
      sourceSessionId: "source-sensitive-dossier",
      title: "Codex session"
    });

    const merged = mergeDurableProviderOutput(
      fallback,
      {
        sessionDossier: {
          blockers: ["Contact tyler@example.com for the next step."],
          continuation: {
            constraints: ["Do not reveal github_pat_11AAAAAAA0BBBBBBBB1CCCCCCCC2DDDDDDDD3EEEEEEEE4."],
            nextStep: "Use xoxb-123456789012-abcdefghijklmnop in Slack.",
            openQuestions: ["Is AKIAIOSFODNN7EXAMPLE still active?"]
          },
          decisions: ["Store 0123456789abcdef0123456789abcdef in the dossier."],
          evidenceRefIds: [],
          keyWork: ["Filtered sensitive provider dossier fields."],
          outcome: "Filtered provider dossier fields before persistence.",
          purpose: "Repair durable field filtering.",
          verification: {
            commands: ["vitest"],
            evidenceRefIds: [],
            failures: [],
            status: "passed",
            summary: "Provider parsing test used tyler@example.com."
          },
          warnings: ["Provider mentioned github_pat_11AAAAAAA0BBBBBBBB1CCCCCCCC2DDDDDDDD3EEEEEEEE4."]
        }
      },
      []
    );

    expect(merged.sessionDossier.keyWork).toEqual(["Filtered sensitive provider dossier fields."]);
    expect(merged.sessionDossier.outcome).toBe("Filtered provider dossier fields before persistence.");
    expect(merged.sessionDossier.purpose).toBe("Repair durable field filtering.");
    expect(merged.sessionDossier.blockers).toEqual([]);
    expect(merged.sessionDossier.decisions).toEqual([]);
    expect(merged.sessionDossier.continuation).toEqual({
      constraints: [],
      nextStep: undefined,
      openQuestions: []
    });
    expect(merged.sessionDossier.verification.summary).toBe(fallback.sessionDossier.verification.summary);
    expect(merged.sessionDossier.warnings).toEqual([]);
  });
});
