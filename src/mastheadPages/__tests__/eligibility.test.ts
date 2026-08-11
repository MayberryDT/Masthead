import { describe, expect, test } from "vitest";

import {
  checkSessionDossierEligibility,
  type LocalArtifactForPages,
} from "../eligibility.ts";
import type { PublishedSessionDossierV1 } from "../../shared/sessionDossier.ts";
import type { EvidenceRef } from "../../core/types.ts";

const narrativeRef: EvidenceRef = {
  id: "msg:1",
  kind: "event",
  observedAt: "2026-08-11T10:00:00.000Z",
  source: "test",
};

function durableEnrichment() {
  return {
    version: "session-capsule-v4" as const,
    keywords: ["projection"],
    sessionTitle: {
      text: "Public projection title",
      basis: "dominant_work" as const,
      confidence: "high" as const,
      evidenceRefs: [narrativeRef],
    },
    sessionSummary: {
      text: "Public projection summary.",
      state: "completed" as const,
      confidence: "high" as const,
      evidenceRefs: [narrativeRef],
    },
    sessionDossier: {
      purpose: "Ship the public projection.",
      outcome: "Allowlisted PageRevisionV1 is produced.",
      keyWork: ["Built the projector"],
      decisions: ["No prompt fallback"],
      blockers: [],
      verification: {
        status: "passed" as const,
        summary: "Projection tests passed.",
        commands: ["npm test"],
        failures: [],
        evidenceRefs: [narrativeRef],
      },
      continuation: {
        nextStep: "Wire evidence selection",
        openQuestions: [],
        constraints: [],
      },
      evidenceRefs: [narrativeRef],
      warnings: [],
    },
  };
}

function eligibleDossier(): PublishedSessionDossierV1 {
  return {
    snapshotVersion: "canonical-session-dossier-v1",
    capturedAt: "2026-08-11T12:00:00.000Z",
    identity: {
      sessionId: "session:private-alpha",
      sourceSessionId: "source:private-alpha",
      title: "Private identity title",
      runtime: "codex",
      models: ["gpt-test"],
      hostId: "host:test",
      repoRoot: "/home/secret/repo",
      lastActivityAt: "2026-08-11T12:00:00.000Z",
      lifecycle: "ended",
      startedAt: "2026-08-11T10:00:00.000Z",
      endedAt: "2026-08-11T12:00:00.000Z",
      sourceConfidence: "authoritative",
    },
    enrichment: { status: "current", generatedAt: "2026-08-11T11:00:00.000Z" },
    durableEnrichment: durableEnrichment(),
    coverage: {
      level: "complete",
      warnings: [],
      transcript: {
        hasUsableTranscript: true,
        messages: 1,
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 0,
        toolResults: 0,
        fileEffects: 0,
        checkpoints: 0,
        runtimeSignals: 0,
        lowValueItems: 0,
      },
    },
    narrative: {
      firstUserPrompt: "SECRET_FIRST_PROMPT_DO_NOT_LEAK",
      latestUserPrompt: "SECRET_LATEST_PROMPT",
      finalAssistantMessage: "SECRET_ASSISTANT",
      topics: ["public-alpha"],
      technologies: ["typescript"],
      unresolved: [],
    },
    files: [],
    tools: [],
    verification: { status: "passed", summary: "ok", commands: [] },
    attention: [],
    excerpts: [],
    timeline: [],
    reuse: {
      mcpIncluded: false,
      sourceRuntime: "codex",
      sourceSessionId: "source:private-alpha",
      sourceConfidence: "authoritative",
      canonicalSessionId: "session:private-alpha",
      copyableContext: "private",
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, usageRows: 1 },
  };
}

function eligibleArtifact(
  overrides: Partial<LocalArtifactForPages> = {},
): LocalArtifactForPages {
  return {
    artifactKind: "session_dossier",
    status: "current",
    publicationStatus: "published",
    schemaVersion: "canonical-session-dossier-v1",
    content: eligibleDossier(),
    provenanceSessionIds: ["session:private-alpha"],
    ...overrides,
  };
}

describe("checkSessionDossierEligibility", () => {
  test("accepts a current published canonical session dossier with enrichment", () => {
    expect(checkSessionDossierEligibility(eligibleArtifact())).toEqual({
      eligible: true,
    });
  });

  test("rejects unsupported artifact kinds", () => {
    expect(
      checkSessionDossierEligibility(
        eligibleArtifact({ artifactKind: "runbook" }),
      ),
    ).toEqual({ eligible: false, reason: "unsupported_kind" });
  });

  test("rejects non-current or unpublished logbook pages", () => {
    expect(
      checkSessionDossierEligibility(
        eligibleArtifact({ status: "superseded" }),
      ),
    ).toEqual({ eligible: false, reason: "not_current_logbook_page" });
    expect(
      checkSessionDossierEligibility(
        eligibleArtifact({ publicationStatus: "draft" }),
      ),
    ).toEqual({ eligible: false, reason: "not_current_logbook_page" });
  });

  test("rejects unsupported schemas and snapshot versions", () => {
    expect(
      checkSessionDossierEligibility(
        eligibleArtifact({ schemaVersion: "legacy-dossier-v0" }),
      ),
    ).toEqual({ eligible: false, reason: "unsupported_schema" });

    const content = eligibleDossier();
    (content as { snapshotVersion: string }).snapshotVersion = "other-v1";
    expect(
      checkSessionDossierEligibility(eligibleArtifact({ content })),
    ).toEqual({ eligible: false, reason: "unsupported_schema" });
  });

  test("requires current durable enrichment", () => {
    const missing = eligibleDossier();
    delete missing.durableEnrichment;
    expect(
      checkSessionDossierEligibility(eligibleArtifact({ content: missing })),
    ).toEqual({ eligible: false, reason: "current_enrichment_required" });

    const stale = eligibleDossier();
    stale.enrichment = { status: "not_enriched" };
    expect(
      checkSessionDossierEligibility(eligibleArtifact({ content: stale })),
    ).toEqual({ eligible: false, reason: "current_enrichment_required" });
  });

  test("requires exactly one provenance session", () => {
    expect(
      checkSessionDossierEligibility(
        eligibleArtifact({ provenanceSessionIds: [] }),
      ),
    ).toEqual({ eligible: false, reason: "single_session_dossier_required" });
    expect(
      checkSessionDossierEligibility(
        eligibleArtifact({
          provenanceSessionIds: ["session:a", "session:b"],
        }),
      ),
    ).toEqual({ eligible: false, reason: "single_session_dossier_required" });
  });
});
