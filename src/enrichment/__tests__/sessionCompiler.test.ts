import { describe, expect, test } from "vitest";
import { deterministicCapsuleFromFacts, fingerprintSessionFacts } from "../sessionCompiler.ts";

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
    expect(capsule.searchPhrases).toEqual(expect.arrayContaining(["Masthead", "src/daemon/main.ts"]));
    expect(fingerprintSessionFacts(facts)).toHaveLength(64);
  });
});
