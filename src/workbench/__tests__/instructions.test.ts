import { describe, expect, test } from "vitest";
import { workbenchInstructions } from "../instructions.ts";

describe("workbenchInstructions", () => {
  test("returns a full agent guidance contract for session enrichment", () => {
    const instructions = workbenchInstructions({ kind: "session_enrichment", scope: "missing" });

    expect(instructions).toContain("Agent guidance contract");
    expect(instructions).toContain("Evidence rules");
    expect(instructions).toContain("Confidence rubric");
    expect(instructions).toContain("Automatic handoff completion");
    expect(instructions).toContain("Field rules for session_enrichment");
    expect(instructions).toContain("title: use the dominant concrete work");
    expect(instructions).toContain("searchPhrases: include phrases a future agent would search for");
    expect(instructions).toContain("Validate with evidence");
  });

  test("returns first-class guidance for session dossier artifacts", () => {
    const instructions = workbenchInstructions({ kind: "session_dossier", scope: "session:abc" });

    expect(instructions).toContain("Field rules for session_dossier");
    expect(instructions).toContain("problemStatement: describe the user-visible problem or objective");
    expect(instructions).toContain("keyDecisions: include only decisions with direct evidence support");
    expect(instructions).toContain("lessonsLearned: include reusable takeaways");
  });

  test("returns first-class guidance for runbook artifacts", () => {
    const instructions = workbenchInstructions({ kind: "runbook", scope: "candidates" });

    expect(instructions).toContain("Field rules for runbook");
    expect(instructions).toContain("problemSignature");
    expect(instructions).toContain("deadEnds");
    expect(instructions).toContain("Signature-bounded expansion");
  });
});
