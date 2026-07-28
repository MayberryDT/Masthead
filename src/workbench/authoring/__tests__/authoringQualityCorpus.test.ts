import { describe, expect, test } from "vitest";
import {
  AGENTS_TITLE_HASH,
  APPROVAL_JSON_DESCRIPTION,
  AUTHORING_QUALITY_BAD_CORPUS_CASES,
  AUTHORING_QUALITY_CORPUS_CASES,
  AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES,
  AUTHORING_QUALITY_GOOD_CORPUS_CASES,
  AUTHORING_QUALITY_INSTRUCTION_TITLE_CASES,
  AUTHORING_QUALITY_JSON_DESCRIPTION_CASES,
  GOOD_AGENT_HANDOFF_TITLE,
  JSON_APPROVAL_DESCRIPTION,
  SYSTEM_REMINDER_TITLE,
  authoringQualityCorpusFieldPatch,
  type AuthoringQualityCorpusCase
} from "../__fixtures__/authoringQualityCorpus.ts";

const REQUIRED_KINDS = new Set([
  "instruction_title",
  "system_reminder_title",
  "json_approval_description",
  "good_session"
]);

function assertCaseShape(entry: AuthoringQualityCorpusCase): void {
  expect(entry.id.trim().length).toBeGreaterThan(0);
  expect(entry.fields.title.trim().length).toBeGreaterThan(0);
  expect(entry.fields.description.trim().length).toBeGreaterThan(0);
  expect(entry.fields.purpose.trim().length).toBeGreaterThan(0);
  expect(Array.isArray(entry.fields.keywords)).toBe(true);
  expect(entry.fields.keywords.length).toBeGreaterThan(0);
  if (entry.kind === "good_session") {
    expect(entry.ownerIssue).toBeNull();
    expect(entry.expectedEventualHardRejectCode).toBeNull();
  } else {
    expect(entry.ownerIssue).toMatch(/^Q[123]$/);
    expect(typeof entry.expectedEventualHardRejectCode).toBe("string");
    expect(entry.expectedEventualHardRejectCode!.trim().length).toBeGreaterThan(0);
  }
}

describe("authoring quality corpus fixtures (ISSUE-T1)", () => {
  test("exports a mixed corpus covering required incident shapes", () => {
    const kinds = new Set(AUTHORING_QUALITY_CORPUS_CASES.map((entry) => entry.kind));
    for (const kind of REQUIRED_KINDS) {
      expect(kinds.has(kind)).toBe(true);
    }
    expect(AUTHORING_QUALITY_BAD_CORPUS_CASES.length).toBeGreaterThanOrEqual(6);
    expect(AUTHORING_QUALITY_GOOD_CORPUS_CASES.length).toBeGreaterThanOrEqual(3);
    expect(AUTHORING_QUALITY_CORPUS_CASES.length).toBe(
      AUTHORING_QUALITY_BAD_CORPUS_CASES.length + AUTHORING_QUALITY_GOOD_CORPUS_CASES.length
    );
  });

  test("every case has a stable id and non-empty field surface", () => {
    const ids = AUTHORING_QUALITY_CORPUS_CASES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of AUTHORING_QUALITY_CORPUS_CASES) {
      assertCaseShape(entry);
    }
  });

  test("documents the exact # AGENTS title flood shape", () => {
    expect(AGENTS_TITLE_HASH.fields.title).toBe("# AGENTS");
    expect(AGENTS_TITLE_HASH.kind).toBe("instruction_title");
    expect(AGENTS_TITLE_HASH.ownerIssue).toBe("Q1");
    expect(AGENTS_TITLE_HASH.expectedEventualHardRejectCode).toBe(
      AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES.instructionOrPolicyTitle
    );
    expect(
      AUTHORING_QUALITY_INSTRUCTION_TITLE_CASES.some((entry) => entry.fields.title.startsWith("# AGENTS"))
    ).toBe(true);
  });

  test("documents system-reminder title variants", () => {
    expect(SYSTEM_REMINDER_TITLE.fields.title.startsWith("<system-reminder")).toBe(true);
    expect(
      AUTHORING_QUALITY_INSTRUCTION_TITLE_CASES.filter(
        (entry) => entry.kind === "system_reminder_title"
      ).length
    ).toBeGreaterThanOrEqual(1);
  });

  test("documents approval JSON description shapes", () => {
    expect(JSON_APPROVAL_DESCRIPTION.fields.description).toBe(APPROVAL_JSON_DESCRIPTION);
    expect(() => JSON.parse(APPROVAL_JSON_DESCRIPTION.trim())).not.toThrow();
    const parsed = JSON.parse(APPROVAL_JSON_DESCRIPTION) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      risk_level: expect.any(String),
      outcome: expect.stringMatching(/^(allow|deny)$/)
    });
    expect(AUTHORING_QUALITY_JSON_DESCRIPTION_CASES.length).toBeGreaterThanOrEqual(2);
    for (const entry of AUTHORING_QUALITY_JSON_DESCRIPTION_CASES) {
      expect(entry.ownerIssue).toBe("Q2");
      expect(entry.expectedEventualHardRejectCode).toBe(
        AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES.approvalOrJsonPayloadDescription
      );
      const trimmed = entry.fields.description.trim();
      expect(trimmed.startsWith("{")).toBe(true);
      expect(() => JSON.parse(trimmed)).not.toThrow();
    }
  });

  test("includes good title/description examples that mention agent without being instruction heads", () => {
    expect(GOOD_AGENT_HANDOFF_TITLE.fields.title.toLowerCase()).toContain("agent");
    expect(GOOD_AGENT_HANDOFF_TITLE.fields.title.startsWith("# AGENTS")).toBe(false);
    expect(GOOD_AGENT_HANDOFF_TITLE.expectedEventualHardRejectCode).toBeNull();
    for (const entry of AUTHORING_QUALITY_GOOD_CORPUS_CASES) {
      expect(entry.fields.description.split(/\s+/).length).toBeGreaterThan(8);
    }
  });

  test("field patch is mutable and does not alias fixture keywords", () => {
    const patch = authoringQualityCorpusFieldPatch(AGENTS_TITLE_HASH);
    patch.keywords.push("mutated");
    expect(AGENTS_TITLE_HASH.fields.keywords).not.toContain("mutated");
    expect(patch.title).toBe(AGENTS_TITLE_HASH.fields.title);
  });

  test("assigns exactly one planned hard-reject code owner per bad case", () => {
    for (const entry of AUTHORING_QUALITY_BAD_CORPUS_CASES) {
      const code = entry.expectedEventualHardRejectCode;
      expect(code).toBeTruthy();
      if (entry.kind === "json_approval_description") {
        expect(code).toBe(
          AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES.approvalOrJsonPayloadDescription
        );
        expect(entry.ownerIssue).toBe("Q2");
      } else {
        expect(code).toBe(AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES.instructionOrPolicyTitle);
        expect(entry.ownerIssue).toBe("Q1");
      }
    }
  });

  /**
   * Soft optional hook: if Q1–Q3 have already merged the planned codes into the live
   * hard-reject list, document that without failing when they are still missing.
   * Structure tests above remain the durable CI gate for T1.
   */
  test("documents planned codes without requiring classifier presence on base", async () => {
    const planned = Object.values(AUTHORING_QUALITY_EVENTUAL_HARD_REJECT_CODES);
    let liveCodes: readonly string[] = [];
    try {
      const shared = await import("../../../shared/workbenchAuthoringV5.ts");
      liveCodes = shared.WORKBENCH_AUTHORING_V5_HARD_REJECT_CODES;
    } catch {
      liveCodes = [];
    }
    for (const code of planned) {
      // Soft: log presence for humans; never fail CI when codes are not yet on base.
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
      void liveCodes.includes(code);
    }
    expect(planned).toEqual([
      "instruction_or_policy_title",
      "approval_or_json_payload_description"
    ]);
  });
});
