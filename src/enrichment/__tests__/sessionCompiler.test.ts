import { describe, expect, test } from "vitest";
import { deterministicCapsuleFromFacts, fingerprintSessionFacts, SESSION_CAPSULE_PROMPT_VERSION } from "../sessionCompiler.ts";

describe("session compiler", () => {
  test("creates deterministic capsule without assigning process truth to the model", () => {
    const facts = {
      commands: ["npm test -- --run src/core/__tests__/ingestServer.test.ts"],
      evidence: [{ id: "event-1", kind: "event" as const, observedAt: "2026-06-24T12:00:00.000Z", source: "codex.hook" }],
      files: ["src/daemon/main.ts"],
      messages: ["Turn this roadmap into an implementation plan."],
      project: "Masthead",
      sessionId: "session-1",
      title: "Masthead data layer"
    };

    const capsule = deterministicCapsuleFromFacts(facts);

    expect(capsule.title).toBe("Masthead data layer");
    expect(capsule.confidence).toBe("medium");
    expect(capsule.missingEvidence).toContain("narrative facts");
    expect(capsule.providerStatus).toBe("success");
    expect(capsule.searchPhrases).toEqual(expect.arrayContaining(["Masthead", "src/daemon/main.ts"]));
    expect(fingerprintSessionFacts(facts)).toHaveLength(64);
  });

  test("uses v4 capsule prompt contract", () => {
    expect(SESSION_CAPSULE_PROMPT_VERSION).toBe("session-capsule-v4");
  });

  test("fingerprint changes only when transcript evidence changes", () => {
    const baseFacts = {
      assistantEvidence: ["Updated the Dossier summary copy."],
      commands: ["npm test"],
      evidence: [],
      files: ["src/ui/session-dossier/SessionDossier.tsx"],
      messages: ["Update Dossier summary copy."],
      narrative: {
        buildFailed: false,
        buildPassed: false,
        checkpointSummaries: [],
        commands: [],
        coverage: {
          assistantMessages: 1,
          fileEffects: 1,
          hasUsableTranscript: true,
          level: "complete" as const,
          messageCount: 2,
          tokenUsageRows: 1,
          toolCalls: 1,
          userMessages: 1
        },
        deployMentioned: false,
        eventSummaries: [],
        fileBasenames: ["SessionDossier"],
        fileDirectories: ["src/ui"],
        files: [],
        firstUserPrompt: "Update Dossier summary copy.",
        finalAssistantMessage: "Updated the Dossier summary copy.",
        sessionId: "session-fingerprint",
        sourceSessionId: "source-fingerprint",
        technologies: ["TypeScript"],
        testsFailed: false,
        testsPassed: true,
        topics: ["dossier"]
      },
      project: "Masthead",
      sessionId: "session-fingerprint",
      sourceSessionId: "source-fingerprint",
      title: "Codex hook event",
      userEvidence: ["Update Dossier summary copy."]
    };

    const unchangedTranscript = {
      ...baseFacts,
      commands: ["npm test", "git status"],
      files: ["src/ui/session-dossier/SessionDossier.tsx", "src/styles/session-dossier.css"],
      narrative: {
        ...baseFacts.narrative,
        commands: [{ name: "git status" }],
        fileBasenames: ["SessionDossier", "session-dossier"],
        tokenUsageRows: 10
      }
    };
    const changedTranscript = {
      ...baseFacts,
      assistantEvidence: [...baseFacts.assistantEvidence, "Added a stable Enriching data loading state."]
    };

    expect(fingerprintSessionFacts(unchangedTranscript)).toBe(fingerprintSessionFacts(baseFacts));
    expect(fingerprintSessionFacts(changedTranscript)).not.toBe(fingerprintSessionFacts(baseFacts));
  });

  test("deterministic capsules include durable title, summary, and dossier fields", () => {
    const capsule = deterministicCapsuleFromFacts({
      commands: ["npm test"],
      evidence: [],
      files: ["src/ui/logbook/LogbookRow.tsx"],
      messages: ["Implement durable Logbook session title enrichment."],
      project: "Masthead",
      sessionId: "session-durable",
      sourceSessionId: "source-durable",
      title: "Codex session"
    });

    expect(capsule.sessionTitle?.text).toBe("durable Logbook session title enrichment");
    expect(capsule.sessionSummary?.text).toMatch(/Imported historical|Defined|Added|Updated/);
    expect(capsule.sessionDossier?.verification.status).toMatch(/passed|failed|mixed|missing|unknown/);
    expect(capsule.durableEnrichment?.version).toBe("session-capsule-v4");
  });
});
