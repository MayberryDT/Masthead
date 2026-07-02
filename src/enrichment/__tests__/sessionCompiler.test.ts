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
