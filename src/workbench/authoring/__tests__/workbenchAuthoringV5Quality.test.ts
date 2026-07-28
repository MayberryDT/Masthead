import { describe, expect, test } from "vitest";
import {
  WORKBENCH_AUTHORING_V5_HARD_REJECT_CODES,
  WORKBENCH_AUTHORING_V5_SOFT_FLAG_CODES,
  type WorkbenchAuthoringV5Draft
} from "../../../shared/workbenchAuthoringV5.ts";
import {
  APPROVAL_OR_JSON_DESCRIPTION_BAD,
  APPROVAL_OR_JSON_DESCRIPTION_GOOD,
  CONTEXT_OR_METADATA_TITLE_BAD,
  CONTEXT_OR_METADATA_TITLE_GOOD,
  INSTRUCTION_OR_POLICY_TITLE_BAD,
  INSTRUCTION_OR_POLICY_TITLE_GOOD
} from "../__fixtures__/v5InstructionAndJsonQuality.ts";
import { classifyWorkbenchAuthoringV5Session } from "../workbenchAuthoringV5Quality.ts";

const EVIDENCE_ID = "ev:user:1";

function groundedSession(
  overrides: Partial<WorkbenchAuthoringV5Draft["sessions"][number]["fields"]> & {
    sessionId?: string;
  } = {}
): WorkbenchAuthoringV5Draft["sessions"][number] {
  const sessionId = overrides.sessionId ?? "session:quality:1";
  const {
    sessionId: _ignored,
    title = "Repair OAuth callback token validation",
    description = "Repaired OAuth callback validation and added unit tests for the redirect path.",
    keywords = ["oauth", "callback", "validation"],
    purpose = "Fix broken OAuth redirect state binding after login.",
    outcome = "Callback state validation is enforced and covered by tests.",
    keyWork = [
      "Bound callback state to the signed request nonce.",
      "Added regression tests for invalid state rejection."
    ],
    decisions = ["Keep the callback state bound to the signed request."],
    verification = {
      status: "passed" as const,
      summary: "Unit tests for callback state validation passed."
    },
    evidenceRefs = {
      title: [EVIDENCE_ID],
      description: [EVIDENCE_ID],
      purpose: [EVIDENCE_ID],
      outcome: [EVIDENCE_ID],
      keyWork: [EVIDENCE_ID],
      verification: [EVIDENCE_ID]
    },
    ...rest
  } = overrides;

  return {
    sessionId,
    fields: {
      title,
      description,
      keywords,
      purpose,
      outcome,
      keyWork,
      decisions,
      verification,
      evidenceRefs,
      ...rest
    },
    evidenceCatalog: [
      {
        id: EVIDENCE_ID,
        itemId: EVIDENCE_ID,
        kind: "message",
        observedAt: "2026-07-28T12:00:00.000Z",
        role: "user",
        text: "Please fix OAuth callback token validation and add tests.",
        source: "canonical"
      }
    ]
  };
}

function codesOf(session: WorkbenchAuthoringV5Draft["sessions"][number]): string[] {
  return classifyWorkbenchAuthoringV5Session(session).findings.map(({ code }) => code);
}

describe("workbenchAuthoringV5Quality — Q1 instruction/policy titles", () => {
  test.each(INSTRUCTION_OR_POLICY_TITLE_BAD)(
    "hard-rejects title %j with instruction_or_policy_title only among title codes",
    ({ title, code }) => {
      const outcome = classifyWorkbenchAuthoringV5Session(groundedSession({ title }));
      expect(outcome.disposition).toBe("hard_reject");
      expect(outcome.findings.map(({ code: c }) => c)).toContain(code);
      // Coordinate: Q1 owns these patterns — do not also emit context_or_metadata_title.
      expect(outcome.findings.map(({ code: c }) => c)).not.toContain("context_or_metadata_title");
    }
  );

  test.each(INSTRUCTION_OR_POLICY_TITLE_GOOD)(
    "does not reject legitimate title solely for agent prose: %s",
    (title) => {
      const outcome = classifyWorkbenchAuthoringV5Session(groundedSession({ title }));
      expect(codesOf(groundedSession({ title }))).not.toContain("instruction_or_policy_title");
      expect(outcome.findings.map(({ code }) => code)).not.toContain("instruction_or_policy_title");
    }
  );
});

describe("workbenchAuthoringV5Quality — Q2 approval/JSON payloads", () => {
  test.each(APPROVAL_OR_JSON_DESCRIPTION_BAD)(
    "hard-rejects JSON/approval payload fields",
    (fixture) => {
      const session = groundedSession({
        title: "title" in fixture && fixture.title
          ? fixture.title
          : "Repair OAuth callback token validation",
        description: fixture.description
      });
      const outcome = classifyWorkbenchAuthoringV5Session(session);
      expect(outcome.disposition).toBe("hard_reject");
      expect(outcome.findings.map(({ code }) => code)).toContain(fixture.code);
    }
  );

  test.each(APPROVAL_OR_JSON_DESCRIPTION_GOOD)(
    "allows normal multi-sentence description: %s",
    (description) => {
      expect(codesOf(groundedSession({ description }))).not.toContain(
        "approval_or_json_payload_description"
      );
    }
  );
});

describe("workbenchAuthoringV5Quality — Q3 context/metadata title heuristics", () => {
  test.each(CONTEXT_OR_METADATA_TITLE_BAD)(
    "hard-rejects metadata title %j with single coordinated code",
    ({ title, code }) => {
      const outcome = classifyWorkbenchAuthoringV5Session(groundedSession({ title }));
      expect(outcome.disposition).toBe("hard_reject");
      expect(outcome.findings.map(({ code: c }) => c)).toContain(code);
      // Q3 fixtures must not also pick up Q1 instruction code.
      expect(outcome.findings.map(({ code: c }) => c)).not.toContain("instruction_or_policy_title");
    }
  );

  test.each(CONTEXT_OR_METADATA_TITLE_GOOD)(
    "does not fire context_or_metadata_title on ordinary product title: %s",
    (title) => {
      expect(codesOf(groundedSession({ title }))).not.toContain("context_or_metadata_title");
    }
  );
});

describe("workbenchAuthoringV5Quality — Q4 hard-reject code list sync", () => {
  test("shared hard-reject list includes Q1/Q2 codes and is the sole classifier source", () => {
    expect(WORKBENCH_AUTHORING_V5_HARD_REJECT_CODES).toEqual(
      expect.arrayContaining([
        "instruction_or_policy_title",
        "approval_or_json_payload_description",
        "context_or_metadata_title",
        "empty_or_generic_title"
      ])
    );
    expect(WORKBENCH_AUTHORING_V5_SOFT_FLAG_CODES).not.toContain("instruction_or_policy_title");
    expect(WORKBENCH_AUTHORING_V5_SOFT_FLAG_CODES).not.toContain(
      "approval_or_json_payload_description"
    );

    // Classifier disposition uses the shared export — unknown codes must not hard-reject alone.
    const softOnly = classifyWorkbenchAuthoringV5Session(
      groundedSession({
        keyWork: ["Updated code."],
        verification: { status: "passed", summary: "Looks okay." }
      })
    );
    expect(softOnly.disposition).toBe("soft_flag");
    for (const { code } of softOnly.findings) {
      expect(WORKBENCH_AUTHORING_V5_HARD_REJECT_CODES).not.toContain(code);
      expect(WORKBENCH_AUTHORING_V5_SOFT_FLAG_CODES).toContain(code);
    }
  });

  test("publishable grounded session has no findings", () => {
    const outcome = classifyWorkbenchAuthoringV5Session(groundedSession());
    expect(outcome).toMatchObject({ disposition: "publishable", findings: [] });
  });
});
