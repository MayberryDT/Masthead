import { describe, expect, test } from "vitest";
import { validateWorkbenchOutput } from "../validation.ts";
import type { WorkbenchEvidencePacket } from "../types.ts";

const evidencePacket: WorkbenchEvidencePacket = {
  coverage: {
    assistantMessages: 1,
    checkpoints: 0,
    fileEffects: 1,
    hasUsableTranscript: true,
    messages: 2,
    tokenUsageRows: 0,
    toolCalls: 1,
    toolResults: 1,
    userMessages: 1
  },
  files: [{ displayPath: "src/cli/workbench.ts", path: "src/cli/workbench.ts", ref: "file:1" }],
  packetVersion: "workbench-evidence-v1",
  session: {
    lastActivityAt: "2026-07-07T00:00:00.000Z",
    lifecycle: "ended",
    models: ["gpt-5"],
    runtime: "codex",
    sessionId: "session:abc",
    sourceSessionId: "source:abc"
  },
  sourceRefs: ["message:1", "file:1", "tool:1"],
  timeline: [],
  tools: [{ name: "npm test", ref: "tool:1", status: "passed" }],
  transcript: [{ observedAt: "2026-07-07T00:00:00.000Z", ref: "message:1", role: "assistant", text: "Implemented CLI workbench routing." }],
  verification: [{ evidence: "npm test passed", label: "npm test", ref: "tool:1", status: "passed" }],
  warnings: []
};

const validSessionEnrichment = {
  confidence: "high",
  evidenceRefs: ["message:1", "file:1", "tool:1"],
  missingEvidence: [],
  searchPhrases: ["masthead CLI workbench"],
  summary: "Added CLI Workbench command routing and database path resolution.",
  technologies: ["TypeScript", "Vitest"],
  title: "Add Workbench CLI foundation",
  topics: ["CLI", "Workbench"],
  verificationSummary: "npm test passed."
};

describe("validateWorkbenchOutput", () => {
  test("accepts valid session enrichment output", () => {
    expect(validateWorkbenchOutput("session_enrichment", validSessionEnrichment, evidencePacket)).toEqual({
      errors: [],
      ok: true,
      warnings: []
    });
  });

  test("rejects missing evidence refs", () => {
    const result = validateWorkbenchOutput("session_enrichment", { ...validSessionEnrichment, evidenceRefs: ["missing:1"] }, evidencePacket);

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({ code: "unknown_evidence_ref", message: "Evidence ref is not present in the packet: missing:1" });
  });

  test("rejects malformed field types and extra properties", () => {
    const result = validateWorkbenchOutput(
      "session_enrichment",
      {
        ...validSessionEnrichment,
        extra: "not allowed",
        topics: ["CLI", 42]
      },
      evidencePacket
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { code: "unexpected_property", message: "Unexpected field: extra" },
        { code: "invalid_type", message: "Field topics[1] must be a string." }
      ])
    );
  });

  test("rejects malformed dossier item shapes", () => {
    const result = validateWorkbenchOutput(
      "session_dossier",
      {
        approach: ["Added CLI tests"],
        commandsAndTools: [{ label: 42 }],
        confidence: "medium",
        context: "Workbench validation",
        evidenceRefs: ["message:1"],
        filesTouched: [{ label: "src/workbench/validation.ts" }],
        keyDecisions: [],
        lessonsLearned: [],
        missingEvidence: [],
        outcome: "Validation rejects malformed data.",
        problemStatement: "Agent outputs need structure.",
        risksOrGaps: [],
        title: "Validate Workbench output",
        verification: ["npm test"]
      },
      evidencePacket
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { code: "missing_required", message: "Missing required field: filesTouched[0].role" },
        { code: "invalid_type", message: "Field commandsAndTools[0].label must be a string." }
      ])
    );
  });

  test("rejects generic titles", () => {
    const result = validateWorkbenchOutput("session_enrichment", { ...validSessionEnrichment, title: "Work completed" }, evidencePacket);

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({ code: "generic_title", message: "Title is too generic: Work completed" });
  });

  test("rejects secret-looking values", () => {
    const result = validateWorkbenchOutput(
      "session_enrichment",
      { ...validSessionEnrichment, summary: "Used OPENAI_API_KEY=sk-secretsecretsecretsecret in a command." },
      evidencePacket
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({ code: "secret_detected", message: "Output contains secret-looking values." });
  });

  test("warns when high confidence lacks evidence coverage", () => {
    const result = validateWorkbenchOutput("session_enrichment", { ...validSessionEnrichment, evidenceRefs: ["message:1"] }, evidencePacket);

    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual({
      code: "thin_evidence",
      message: "High-confidence output should cite more than one evidence ref when packet coverage is partial."
    });
  });

  test("rejects fake not-applicable runbook artifacts", () => {
    const result = validateWorkbenchOutput("runbook", {
      notApplicable: true,
      reason: "no bug evidence"
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([{ code: "unexpected_property", message: "Unexpected field: notApplicable" }]));
  });

  test("rejects weak multi-session join rationale", () => {
    const result = validateWorkbenchOutput("runbook", {
      changedFiles: [],
      commands: [],
      confidence: "medium",
      deadEnds: [],
      environmentRequirements: [],
      evidenceRefs: ["message:1", "message:2"],
      fixSteps: ["restart service"],
      joinRationale: "same project",
      missingEvidence: [],
      preconditions: [],
      preventionNotes: [],
      problemSignature: { affectedScope: "svc", errorStrings: ["ECONNRESET"], symptoms: ["timeout"] },
      provenanceSessionIds: ["session:a", "session:b"],
      reproSteps: ["hit endpoint"],
      risksOrGaps: [],
      rootCause: "",
      title: "Timeout under load",
      validationChecks: ["curl health"]
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === "weak_join")).toBe(true);
  });
});
