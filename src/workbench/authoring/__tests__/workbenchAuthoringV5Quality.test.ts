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
import {
  applyWorkbenchAuthoringV5PackTitleDiversity,
  classifyWorkbenchAuthoringV5Session
} from "../workbenchAuthoringV5Quality.ts";

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

describe("workbenchAuthoringV5Quality — mechanical fill / factory sludge (2026-07-29)", () => {
  test("hard-rejects the factory fallback title used by masthead-fill-pack.mjs", () => {
    const outcome = classifyWorkbenchAuthoringV5Session(
      groundedSession({
        title: "Review the recorded implementation and approval work for the named project",
        description:
          "Recorded work: Review the recorded implementation and approval work for the named project",
        purpose:
          "Address the substantive request captured in the session: Review the recorded implementation and approval work for the named project",
        outcome: "The session retained the implementation or review outcome in its canonical transcript.",
        keywords: ["implementation", "evidence", "verification"],
        keyWork: [
          "Review the recorded implementation and approval work for the named project",
          "The session retained the implementation or review outcome in its canonical transcript."
        ]
      })
    );
    expect(outcome.disposition).toBe("hard_reject");
    const codes = outcome.findings.map(({ code }) => code);
    expect(codes).toContain("empty_or_generic_title");
    expect(codes).toContain("templated_request_echo");
    expect(codes).toContain("generic_keyword_bag");
  });

  test("hard-rejects Resolve the documented/reported implementation issue fallbacks", () => {
    for (const title of [
      "Resolve the documented project implementation issue",
      "Resolve the reported implementation issue"
    ]) {
      expect(codesOf(groundedSession({ title }))).toContain("empty_or_generic_title");
    }
  });

  test("hard-rejects Recorded work: / Address the substantive request template prose", () => {
    const outcome = classifyWorkbenchAuthoringV5Session(
      groundedSession({
        title: "Repair OAuth callback token validation",
        description: "Recorded work: Repair OAuth callback token validation",
        purpose: "Address the substantive request captured in the session: Repair OAuth callback token validation",
        outcome: "The session retained the implementation or review outcome in its canonical transcript."
      })
    );
    expect(outcome.disposition).toBe("hard_reject");
    expect(outcome.findings.map(({ code }) => code)).toContain("templated_request_echo");
  });

  test("hard-rejects the fixed implementation|evidence|verification keyword bag", () => {
    const outcome = classifyWorkbenchAuthoringV5Session(
      groundedSession({
        keywords: ["implementation", "evidence", "verification"]
      })
    );
    expect(outcome.disposition).toBe("hard_reject");
    expect(outcome.findings.map(({ code }) => code)).toContain("generic_keyword_bag");
  });

  test("pack-level duplicate titles hard-reject when three or more sessions share a title", () => {
    const sessions = [1, 2, 3, 4].map((n) =>
      groundedSession({
        sessionId: `session:dup:${n}`,
        title: n < 4 ? "Harden Workbench package-path clearance after hard reject" : "Ship Logbook search ranking fix",
        description:
          n < 4
            ? "Harden Workbench package-path clearance so hard-rejected sessions leave enrich."
            : "Ship Logbook search ranking so published artifacts surface first.",
        purpose:
          n < 4
            ? "Stop hard-rejected sessions from reappearing on the package path."
            : "Improve Logbook ranking for published artifacts.",
        outcome:
          n < 4
            ? "Hard-reject clearance removes sessions from the package path."
            : "Published artifacts rank above draft candidates.",
        keywords:
          n < 4
            ? ["workbench", "package-path", "hard-reject"]
            : ["logbook", "search", "ranking"]
      })
    );
    const baseOutcomes = sessions.map((session) => classifyWorkbenchAuthoringV5Session(session));
    // Without pack diversity, distinct good fields would be publishable.
    expect(baseOutcomes.filter((o) => o.disposition === "publishable").length).toBeGreaterThanOrEqual(3);

    const diversified = applyWorkbenchAuthoringV5PackTitleDiversity(baseOutcomes, sessions);
    const dupes = diversified.filter((o) => o.sessionId.startsWith("session:dup:") && o.sessionId !== "session:dup:4");
    expect(dupes).toHaveLength(3);
    for (const outcome of dupes) {
      expect(outcome.disposition).toBe("hard_reject");
      expect(outcome.findings.map(({ code }) => code)).toContain("duplicate_pack_title");
    }
    const unique = diversified.find((o) => o.sessionId === "session:dup:4");
    expect(unique?.findings.map(({ code }) => code) ?? []).not.toContain("duplicate_pack_title");
  });
});

describe("workbenchAuthoringV5Quality — Q4 hard-reject code list sync", () => {
  test("shared hard-reject list includes Q1/Q2 codes and is the sole classifier source", () => {
    expect(WORKBENCH_AUTHORING_V5_HARD_REJECT_CODES).toEqual(
      expect.arrayContaining([
        "instruction_or_policy_title",
        "approval_or_json_payload_description",
        "context_or_metadata_title",
        "empty_or_generic_title",
        "generic_keyword_bag",
        "duplicate_pack_title"
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
