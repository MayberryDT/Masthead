import { describe, expect, test } from "vitest";
import type { SessionArtifactRecord } from "../../../daemon/db/sessionArtifactRepository.ts";
import type { WorkbenchClaimSupport } from "../../../shared/workbenchAuthoring.ts";
import type { WorkbenchValidationEvidence } from "../../types.ts";
import {
  GUIDED_V4_PROTOCOL_PATTERNS,
  findDuplicateHumanContent,
  findUnsupportedProtocolFields,
  findUnsupportedProtocolLanguage,
  isPositiveVerificationEvidence,
  validateArtifactQuality,
  validateClaimSupport
} from "../artifactQuality.ts";
import { hasLaterNegativeVerificationOutcome } from "../verificationSemantics.ts";

const MESSAGE = "message:session:a:problem";
const ACTION = "message:session:a:change";
const CHANGE = "file_effect:session:a:change";
const PASSED = "tool_result:session:a:passed";
const ADR = "message:session:a:adr";
const JOIN_A = "message:session:a:join";
const JOIN_B = "message:session:b:join";

const RUNBOOK_CLAIM_PATHS = [
  "problemSignature.symptoms[0]",
  "problemSignature.errorStrings[0]",
  "problemSignature.affectedScope",
  "preconditions[0]",
  "reproSteps[0]",
  "deadEnds[0]",
  "fixSteps[0]",
  "commands[0]",
  "changedFiles[0]",
  "validationChecks[0]",
  "environmentRequirements[0]",
  "rootCause",
  "preventionNotes[0]",
  "risksOrGaps[0]"
] as const;

const ADR_CLAIM_PATHS = [
  "context",
  "decision",
  "status",
  "alternatives[0]",
  "consequences[0]",
  "affectedPaths[0]",
  "supersedes[0]",
  "supersedes[1]"
] as const;

const INCIDENT_CLAIM_PATHS = [
  "symptom",
  "impact",
  "timeline[0].summary",
  "timeline[1].summary",
  "rootCause",
  "contributingFactors[0]",
  "remediation[0]",
  "prevention[0]",
  "status"
] as const;

describe("artifact claim support", () => {
  test("rejects the 1,283-dossier authoring-protocol template pattern", () => {
    const output = {
      approach: ["Read every canonical evidence item through cursor pagination."],
      outcome: "The canonical redacted record was fully reviewed."
    };

    expect(findUnsupportedProtocolLanguage(output, [], fixtureEvidence())).toContainEqual(
      expect.objectContaining({ code: "unsupported_authoring_protocol_language", path: "approach[0]" })
    );
  });

  test.each([
    "I reviewed every item and limited assertions.",
    "Read all canonical evidence through pagination.",
    "Kept claims single session and avoided unsupported joins."
  ])("rejects semantic authoring self-process leakage: %s", (value) => {
    expect(findUnsupportedProtocolLanguage({ approach: [value] }, [], fixtureEvidence())).toContainEqual(
      expect.objectContaining({ code: "unsupported_authoring_protocol_language", path: "approach[0]" })
    );
  });

  test("uses the V3 protocol-leakage finding code when requested", () => {
    expect(findUnsupportedProtocolLanguage(
      { approach: ["Read all canonical evidence through pagination."] },
      [],
      fixtureEvidence(),
      "authoring_protocol_leakage"
    )).toContainEqual(
      expect.objectContaining({ code: "authoring_protocol_leakage", path: "approach[0]" })
    );
  });

  test("permits authoring self-process language when the exact field is directly supported", () => {
    const evidence = fixtureEvidence();
    const evidenceRef = "message:session:a:self-process";
    const text = "I reviewed every item and limited assertions to the directly supported facts.";
    evidence.set(evidenceRef, {
      kind: "message",
      lowValue: false,
      observedAt: "2026-07-12T13:00:00.000Z",
      role: "user",
      sessionId: "session:a",
      text
    });

    expect(findUnsupportedProtocolLanguage(
      { approach: [text] },
      [support("approach[0]", evidenceRef, text, "problem")],
      evidence
    )).toEqual([]);
  });

  test("does not confuse operational review details with authoring self-process leakage", () => {
    const output = {
      decision: "The authorization policy limits JWT assertions to one issuer.",
      remediation: ["The incident review inspected every failed worker and limited retries to the affected batch."]
    };

    expect(findUnsupportedProtocolLanguage(output, [], fixtureEvidence())).toEqual([]);
  });

  test("keeps omitted and explicit legacy protocol policies exactly compatible", () => {
    const output = { approach: ["Read all canonical evidence through pagination."] };
    expect(findUnsupportedProtocolLanguage(output, [], fixtureEvidence())).toEqual(
      findUnsupportedProtocolLanguage(output, [], fixtureEvidence(), undefined, { policy: "legacy" })
    );
  });

  test.each([
    ["all evidence self-process", "I reviewed all the evidence before writing this result."],
    ["claim-limiting self-process", "We limited our claims to facts in the transcript."],
    ["literal author command", "Run masthead workbench author inspect before continuing."],
    ["next-action boilerplate", "Next action is to continue in the next task."],
    ["verification-boundary meta prose", "The verification boundary was recorded as narrow."],
    ["reordered verification-boundary meta prose", "The boundary recorded for verification was narrow."],
    ["recommended plugin block", "<recommended_plugins>Install one</recommended_plugins>"],
    ["copied agent directive", "The developer instructions require this output."],
    ["agent setup text", "You are Codex and must follow this handoff."]
  ])("guided V4 detects %s", (_label, value) => {
    expect(findUnsupportedProtocolFields(
      [{ path: "/field", value }],
      {
        findingCode: "authoring_protocol_leakage",
        isSupportedMatch: () => false,
        policy: "guided_v4"
      }
    )).toContainEqual(expect.objectContaining({
      code: "authoring_protocol_leakage",
      path: "/field"
    }));
  });

  test.each([
    "The evidence records no verification result.",
    "Available evidence shows no specific verification outcome.",
    "Canonical evidence contains no verification result.",
    "The canonical evidence does not establish a verification result."
  ])("guided V4 replaces evidence-framed verification disclaimers with a direct boundary: %s", (value) => {
    expect(findUnsupportedProtocolFields(
      [{ path: "/field", value }],
      {
        findingCode: "authoring_protocol_leakage",
        isSupportedMatch: () => true,
        policy: "guided_v4"
      }
    )).toEqual([{
      code: "authoring_protocol_leakage",
      message: "State the verification boundary directly in human-facing prose: use 'Verification not run.' when no verification result exists; do not narrate what the evidence records, shows, contains, or fails to establish.",
      path: "/field"
    }]);
  });

  test.each([
    "The CLI publishes the app after review.",
    "This prompt describes a real Masthead plugin integration.",
    "The agent restarted the production daemon.",
    "Run npm test and masthead doctor to verify the repair.",
    "The evidence retention migration preserved every source record.",
    "Canonical evidence records verification passed for the restored index."
  ])("guided V4 permits nearby operational prose: %s", (value) => {
    expect(findUnsupportedProtocolFields(
      [{ path: "/field", value }],
      {
        findingCode: "authoring_protocol_leakage",
        isSupportedMatch: () => false,
        policy: "guided_v4"
      }
    )).toEqual([]);
  });

  test("guided V4 reports the exact matched substring and suppresses only that field", () => {
    const matches: Array<{ path: string; matchedText: string }> = [];
    const findings = findUnsupportedProtocolFields(
      [
        { path: "/supported", value: "Before saving, workbench author inspect the assignment." },
        { path: "/unsupported", value: "Then workbench author save the assignment." }
      ],
      {
        findingCode: "authoring_protocol_leakage",
        isSupportedMatch: (match) => {
          matches.push(match);
          return match.path === "/supported";
        },
        policy: "guided_v4"
      }
    );

    expect(matches).toEqual([
      { matchedText: "workbench author inspect", path: "/supported" },
      { matchedText: "workbench author save", path: "/unsupported" }
    ]);
    expect(findings).toEqual([
      expect.objectContaining({ path: "/unsupported" })
    ]);
  });

  test("guided artifact suppression requires same-field evidence from artifact provenance", () => {
    const evidenceRef = "message:session:a:guided-protocol";
    const text = "The incident transcript says to run workbench author inspect before recovery.";
    const evidence = new Map(fixtureEvidence()).set(evidenceRef, {
      kind: "message" as const,
      lowValue: false,
      observedAt: "2026-07-12T13:00:00.000Z",
      role: "user" as const,
      sessionId: "session:a",
      text
    });
    const supports = [support("approach[0]", evidenceRef, text, "problem")];

    expect(findUnsupportedProtocolLanguage(
      { approach: [text] },
      supports,
      evidence,
      "authoring_protocol_leakage",
      { policy: "guided_v4", provenanceSessionIds: ["session:a"] }
    )).toEqual([]);
    expect(findUnsupportedProtocolLanguage(
      { approach: [text] },
      supports,
      evidence,
      "authoring_protocol_leakage",
      { policy: "guided_v4", provenanceSessionIds: ["session:b"] }
    )).toContainEqual(expect.objectContaining({ path: "approach[0]" }));
  });

  test("guided artifact protocol suppression cannot borrow support from an adjacent field", () => {
    const evidenceRef = "message:session:a:guided-protocol-adjacent";
    const text = "The transcript says to run workbench author inspect before recovery.";
    const evidence = new Map(fixtureEvidence()).set(evidenceRef, {
      kind: "message" as const,
      lowValue: false,
      observedAt: "2026-07-12T13:00:00.000Z",
      role: "user" as const,
      sessionId: "session:a",
      text
    });

    expect(findUnsupportedProtocolLanguage(
      { approach: [text], outcome: text },
      [support("outcome", evidenceRef, text, "problem")],
      evidence,
      "authoring_protocol_leakage",
      { policy: "guided_v4", provenanceSessionIds: ["session:a"] }
    )).toContainEqual(expect.objectContaining({ path: "approach[0]" }));
  });

  test("exports every executable guided protocol pattern", () => {
    expect(GUIDED_V4_PROTOCOL_PATTERNS).toHaveLength(10);
  });

  test("exports the canonical positive-verification predicate and accepts readonly evidence maps", () => {
    const evidenceByRef: ReadonlyMap<string, WorkbenchValidationEvidence> = fixtureEvidence();
    const verificationSupport = validRunbookSupports().find(
      (entry) => entry.supportKind === "verification"
    )!;

    expect(isPositiveVerificationEvidence(
      verificationSupport,
      evidenceByRef.get(verificationSupport.evidenceRef)!
    )).toBe(true);
    expect(validateClaimSupport(validRunbook(), [verificationSupport], evidenceByRef)).toEqual([]);
  });

  test("accepts an assistant completion that records npm run verify passed", () => {
    const text = "Nothing left to do. The worktree was clean and npm run verify passed before push.";

    expect(isPositiveVerificationEvidence({
      path: "/sessionDossier/verification/summary",
      supportKind: "verification",
      evidenceRef: "message:session:a:verify",
      excerpt: text
    }, {
      kind: "message",
      lowValue: false,
      observedAt: "2026-06-26T06:31:52.842Z",
      role: "assistant",
      sessionId: "session:a",
      text
    })).toBe(true);
  });

  test("accepts a healthy report that explicitly says no empty-state failure remains", () => {
    const text = "What I verified: the health endpoint returned 200, system health was healthy, and no empty-state failure remained.";

    expect(isPositiveVerificationEvidence({
      path: "/sessionDossier/verification/summary",
      supportKind: "verification",
      evidenceRef: "message:session:a:health",
      excerpt: text
    }, {
      kind: "message",
      lowValue: false,
      observedAt: "2026-04-20T05:22:15.439Z",
      role: "assistant",
      sessionId: "session:a",
      text
    })).toBe(true);
  });

  test("does not treat a quoted negation of an old failure as a current failed verification", () => {
    const text = "I verified hermes-agent is running and health is healthy. The issue is not ‘Jarvis failed to restart’; its warning only reads like an error/panic message.";

    expect(isPositiveVerificationEvidence({
      path: "/sessionDossier/verification/summary",
      supportKind: "verification",
      evidenceRef: "message:session:a:restart",
      excerpt: text
    }, {
      kind: "message",
      lowValue: false,
      observedAt: "2026-06-26T06:31:52.842Z",
      role: "assistant",
      sessionId: "session:a",
      text
    })).toBe(true);
  });

  test("preserves a recorded passing result when a legacy transcript later records a final successful rerun", () => {
    const excerpt = "Verification in the 3002 checkout: npm run test passed: 12 tests.";
    const transcript = [
      "### Session update", "", "**agent**:", excerpt,
      "Final unit tests: npm run test error (no output).",
      "Final unit tests: npm run test passed: 12 tests."
    ].join("\n");

    expect(hasLaterNegativeVerificationOutcome(transcript, excerpt)).toBe(false);
  });

  test("rejects a normalized excerpt shorter than 20 characters or absent from cited evidence", () => {
    const output = { rootCause: "The callback state check rejected the request." };
    const findings = validateClaimSupport(
      output,
      [
        support("rootCause", MESSAGE, "too short", "root_cause"),
        support("rootCause", MESSAGE, "A sentence that never appeared in the evidence.", "root_cause")
      ],
      fixtureEvidence()
    );

    expect(findings.filter((finding) => finding.code === "unsupported_claim_excerpt")).toHaveLength(2);
  });

  test("accepts a 20+ character excerpt after whitespace normalization", () => {
    const output = { rootCause: "The callback state check rejected the request." };
    const findings = validateClaimSupport(
      output,
      [support("rootCause", MESSAGE, "OAuth callback state\n  validation rejected the request", "root_cause")],
      fixtureEvidence()
    );

    expect(findings).toEqual([]);
  });

  test("requires exact support for every populated runbook claim field and element", () => {
    for (const path of RUNBOOK_CLAIM_PATHS) {
      const quality = validateArtifactQuality({
        evidenceByRef: fixtureEvidence(),
        kind: "runbook",
        output: validRunbook(),
        provenanceSessionIds: ["session:a"],
        supports: validRunbookSupports().filter((entry) => entry.path !== path)
      });

      expect(quality).toContainEqual(
        expect.objectContaining({ code: "missing_claim_support", path })
      );
    }
  });

  test("accepts a fully supported runbook without treating structural metadata as claims", () => {
    expect(validateArtifactQuality({
      evidenceByRef: fixtureEvidence(),
      kind: "runbook",
      output: {
        ...validRunbook(),
        confidence: "high",
        evidenceRefs: [MESSAGE, CHANGE, PASSED],
        joinRationale: "The same callback failure signature joins these sessions.",
        missingEvidence: [],
        provenanceSessionIds: ["session:a"],
        signatureKey: "oauth-callback-state"
      },
      provenanceSessionIds: ["session:a"],
      supports: validRunbookSupports()
    })).toEqual([]);
  });

  test("requires exact support for every populated ADR claim field and element", () => {
    for (const path of ADR_CLAIM_PATHS) {
      const quality = validateArtifactQuality({
        evidenceByRef: fixtureEvidence(),
        kind: "adr",
        output: validAdr(),
        provenanceSessionIds: ["session:a"],
        supports: validAdrSupports().filter((entry) => entry.path !== path)
      });

      expect(quality).toContainEqual(
        expect.objectContaining({ code: "missing_claim_support", path })
      );
    }
  });

  test("accepts a fully supported ADR while leaving only envelope metadata ungrounded", () => {
    expect(validateArtifactQuality({
      evidenceByRef: fixtureEvidence(),
      kind: "adr",
      output: validAdr(),
      provenanceSessionIds: ["session:a"],
      supports: validAdrSupports()
    })).toEqual([]);
  });

  test.each(["status", "supersedes[0]", "supersedes[1]"])(
    "requires decision support for ADR status and lineage: %s",
    (path) => {
      const supports = validAdrSupports().map((entry) => entry.path === path
        ? { ...entry, supportKind: "problem" as const }
        : entry);

      expect(validateArtifactQuality({
        evidenceByRef: fixtureEvidence(),
        kind: "adr",
        output: validAdr(),
        provenanceSessionIds: ["session:a"],
        supports
      })).toContainEqual(expect.objectContaining({
        code: "invalid_support_kind_evidence",
        path
      }));
    }
  );

  test("requires exact support for every populated incident claim field and element", () => {
    for (const path of INCIDENT_CLAIM_PATHS) {
      const quality = validateArtifactQuality({
        evidenceByRef: fixtureEvidence(),
        kind: "incident_timeline",
        output: validIncident(),
        provenanceSessionIds: ["session:a"],
        supports: validIncidentSupports().filter((entry) => entry.path !== path)
      });

      expect(quality).toContainEqual(
        expect.objectContaining({ code: "missing_claim_support", path })
      );
    }
  });

  test("accepts a fully supported incident without treating timeline metadata as claims", () => {
    expect(validateArtifactQuality({
      evidenceByRef: fixtureEvidence(),
      kind: "incident_timeline",
      output: validIncident(),
      provenanceSessionIds: ["session:a"],
      supports: validIncidentSupports()
    })).toEqual([]);
  });

  test.each(["resolved", "recovered", "closed"])(
    "requires verification support for terminal incident status: %s",
    (status) => {
      const output = { ...validIncident(), status };
      const wrongSupports = validIncidentSupports().map((entry) => entry.path === "status"
        ? support("status", MESSAGE, "OAuth callback state validation rejected the request.", "problem")
        : entry);

      expect(validateArtifactQuality({
        evidenceByRef: fixtureEvidence(),
        kind: "incident_timeline",
        output,
        provenanceSessionIds: ["session:a"],
        supports: wrongSupports
      })).toContainEqual(expect.objectContaining({
        code: "invalid_support_kind_evidence",
        path: "status"
      }));

      expect(validateArtifactQuality({
        evidenceByRef: fixtureEvidence(),
        kind: "incident_timeline",
        output,
        provenanceSessionIds: ["session:a"],
        supports: validIncidentSupports()
      })).toEqual([]);
    }
  );

  test.each(["open", "ongoing", "active"])(
    "requires problem support for active incident status: %s",
    (status) => {
      const output = { ...validIncident(), status };
      const problemStatus = support(
        "status",
        MESSAGE,
        "OAuth callback state validation rejected the request.",
        "problem"
      );
      const correctSupports = validIncidentSupports().map((entry) => entry.path === "status" ? problemStatus : entry);

      expect(validateArtifactQuality({
        evidenceByRef: fixtureEvidence(),
        kind: "incident_timeline",
        output,
        provenanceSessionIds: ["session:a"],
        supports: validIncidentSupports()
      })).toContainEqual(expect.objectContaining({
        code: "invalid_support_kind_evidence",
        path: "status"
      }));

      expect(validateArtifactQuality({
        evidenceByRef: fixtureEvidence(),
        kind: "incident_timeline",
        output,
        provenanceSessionIds: ["session:a"],
        supports: correctSupports
      })).toEqual([]);
    }
  );

  test.each([
    ["runbook", "problem"],
    ["adr", "decision"],
    ["incident_timeline", "problem"]
  ] as const)(
    "requires %s join-rationale support from every provenance session",
    (kind, joinSupportKind) => {
      const output = {
        ...(kind === "runbook" ? validRunbook() : kind === "adr" ? validAdr() : validIncident()),
        joinRationale: "Both sessions recorded the same OAuth callback state mismatch signature.",
        provenanceSessionIds: ["session:a", "session:b"]
      };
      const baseSupports = kind === "runbook"
        ? validRunbookSupports()
        : kind === "adr"
          ? validAdrSupports()
          : validIncidentSupports();
      const joinSupportA = support(
        "joinRationale",
        JOIN_A,
        "Session A recorded the OAuth callback state mismatch signature.",
        joinSupportKind
      );
      const joinSupportB = support(
        "joinRationale",
        JOIN_B,
        "Session B recorded the OAuth callback state mismatch signature.",
        joinSupportKind
      );
      const wrongJoinSupportB: WorkbenchClaimSupport = {
        ...joinSupportB,
        supportKind: joinSupportKind === "decision" ? "problem" : "decision"
      };

      expect(validateArtifactQuality({
        evidenceByRef: fixtureEvidence(),
        kind,
        output,
        provenanceSessionIds: ["session:a", "session:b"],
        supports: [...baseSupports, joinSupportA, wrongJoinSupportB]
      })).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "invalid_support_kind_evidence", path: "joinRationale" }),
        expect.objectContaining({
          code: "missing_claim_support",
          message: expect.stringContaining("session:b"),
          path: "joinRationale"
        })
      ]));

      expect(validateArtifactQuality({
        evidenceByRef: fixtureEvidence(),
        kind,
        output,
        provenanceSessionIds: ["session:a", "session:b"],
        supports: [...baseSupports, joinSupportA, joinSupportB]
      })).toEqual([]);
    }
  );

  test("rejects a runbook verification supported only by a failed command", () => {
    const evidence = fixtureEvidence();
    evidence.set("tool_result:session:a:failed", {
      ...evidence.get(PASSED)!,
      exitCode: 1,
      status: "failed",
      text: "Focused authoring validation tests failed with exit code one."
    });
    const supports = validRunbookSupports().map((entry) =>
      entry.supportKind === "verification"
        ? support(
            "validationChecks[0]",
            "tool_result:session:a:failed",
            "Focused authoring validation tests failed with exit code one.",
            "verification"
          )
        : entry
    );

    expect(validateArtifactQuality({
      evidenceByRef: evidence,
      kind: "runbook",
      output: validRunbook(),
      provenanceSessionIds: ["session:a"],
      supports
    })).toContainEqual(expect.objectContaining({
      code: "invalid_support_kind_evidence",
      path: "validationChecks[0]"
    }));
  });

  test("rejects a successful command whose verification text records a negative outcome", () => {
    const evidence = fixtureEvidence();
    evidence.set("tool_result:session:a:false-positive", {
      ...evidence.get(PASSED)!,
      text: "Verification tests failed; failure reproduced successfully."
    });
    const supports = validRunbookSupports().map((entry) => entry.supportKind === "verification"
      ? support(
          "validationChecks[0]",
          "tool_result:session:a:false-positive",
          "Verification tests failed; failure reproduced successfully.",
          "verification"
        )
      : entry);

    expect(validateArtifactQuality({
      evidenceByRef: evidence,
      kind: "runbook",
      output: validRunbook(),
      provenanceSessionIds: ["session:a"],
      supports
    })).toContainEqual(expect.objectContaining({ code: "invalid_support_kind_evidence", path: "validationChecks[0]" }));
  });

  test("rejects contradictory verification status, exit code, and nonzero failure counts", () => {
    const cases: WorkbenchValidationEvidence[] = [
      { ...fixtureEvidence().get(PASSED)!, exitCode: 1, status: "passed" },
      { ...fixtureEvidence().get(PASSED)!, exitCode: 0, status: "failed" },
      { ...fixtureEvidence().get(PASSED)!, text: "Verification tests completed with failures: 2." },
      { ...fixtureEvidence().get(PASSED)!, text: "Verification did not pass and was not successful." },
      { ...fixtureEvidence().get(PASSED)!, text: "Zero verification tests passed." },
      { ...fixtureEvidence().get(PASSED)!, text: "No production health check passed." }
    ];

    for (const [index, evidence] of cases.entries()) {
      const ref = `tool_result:session:a:contradiction:${index}`;
      const evidenceByRef = fixtureEvidence();
      evidenceByRef.set(ref, evidence);
      const supports = validRunbookSupports().map((entry) => entry.supportKind === "verification"
        ? support("validationChecks[0]", ref, evidence.text, "verification")
        : entry);
      expect(validateArtifactQuality({
        evidenceByRef,
        kind: "runbook",
        output: validRunbook(),
        provenanceSessionIds: ["session:a"],
        supports
      })).toContainEqual(expect.objectContaining({
        code: "invalid_support_kind_evidence",
        path: "validationChecks[0]"
      }));
    }
  });

  test("accepts an explicit positive verification checkpoint", () => {
    const supports = validRunbookSupports().map((entry) => entry.supportKind === "verification"
      ? support(
          "validationChecks[0]",
          "checkpoint:session:a:passed",
          "Focused callback regression checkpoint verified the repaired behavior.",
          "verification"
        )
      : entry);

    expect(validateArtifactQuality({
      evidenceByRef: fixtureEvidence(),
      kind: "runbook",
      output: validRunbook(),
      provenanceSessionIds: ["session:a"],
      supports
    })).not.toContainEqual(expect.objectContaining({ code: "invalid_support_kind_evidence", path: "validationChecks[0]" }));
  });

  test("rejects checkpoint labels that only contain a positive verification substring", () => {
    for (const label of ["not_verified", "verification_failed_then_verified"]) {
      const ref = `checkpoint:session:a:${label}`;
      const evidenceByRef = fixtureEvidence();
      evidenceByRef.set(ref, {
        ...evidenceByRef.get("checkpoint:session:a:passed")!,
        label
      });
      const supports = validRunbookSupports().map((entry) => entry.supportKind === "verification"
        ? support(
            "validationChecks[0]",
            ref,
            "Focused callback regression checkpoint verified the repaired behavior.",
            "verification"
          )
        : entry);

      expect(validateArtifactQuality({
        evidenceByRef,
        kind: "runbook",
        output: validRunbook(),
        provenanceSessionIds: ["session:a"],
        supports
      })).toContainEqual(expect.objectContaining({
        code: "invalid_support_kind_evidence",
        path: "validationChecks[0]"
      }));
    }
  });

  test("accepts a passed verification tool result when exit code is unavailable", () => {
    const evidenceByRef = fixtureEvidence();
    evidenceByRef.set("tool_result:session:a:no-exit", {
      ...evidenceByRef.get(PASSED)!,
      exitCode: undefined,
      status: "passed"
    });
    const supports = validRunbookSupports().map((entry) => entry.supportKind === "verification"
      ? support(
          "validationChecks[0]",
          "tool_result:session:a:no-exit",
          "Focused authoring validation tests passed with 24 assertions.",
          "verification"
        )
      : entry);

    expect(validateArtifactQuality({
      evidenceByRef,
      kind: "runbook",
      output: validRunbook(),
      provenanceSessionIds: ["session:a"],
      supports
    })).not.toContainEqual(expect.objectContaining({ code: "invalid_support_kind_evidence", path: "validationChecks[0]" }));
  });

  test("accepts grounded change and verification claims from an assistant completion receipt", () => {
    const ref = "message:session:a:procedure-complete";
    const text = "I installed the scheduled report job and configured the opener script. Verification passed: the report opened and no report server remains.";
    const evidenceByRef = fixtureEvidence();
    evidenceByRef.set(ref, {
      kind: "message",
      lowValue: false,
      observedAt: "2026-07-12T12:20:00.000Z",
      role: "assistant",
      sessionId: "session:a",
      text
    });
    const supports = validRunbookSupports().map((entry) => {
      if (entry.supportKind === "change") {
        return support(
          "fixSteps[0]",
          ref,
          "I installed the scheduled report job and configured the opener script.",
          "change"
        );
      }
      if (entry.supportKind === "verification") {
        return support(
          "validationChecks[0]",
          ref,
          "Verification passed: the report opened and no report server remains.",
          "verification"
        );
      }
      return entry;
    });

    expect(validateArtifactQuality({
      evidenceByRef,
      kind: "runbook",
      output: validRunbook(),
      provenanceSessionIds: ["session:a"],
      supports
    })).not.toContainEqual(expect.objectContaining({ code: "invalid_support_kind_evidence" }));
  });

  test.each([
    "Final production health check failed.",
    "End-to-end verification remains untested and unresolved."
  ])("rejects cherry-picked assistant verification before a later negative outcome: %s", (laterOutcome) => {
    const ref = "message:session:a:verification-regressed";
    const excerpt = "What I verified:\n- Callback regression checks passed.";
    const evidenceByRef = fixtureEvidence();
    evidenceByRef.set(ref, {
      kind: "message",
      lowValue: false,
      observedAt: "2026-07-12T12:20:00.000Z",
      role: "assistant",
      sessionId: "session:a",
      text: `${excerpt}\nFinal status:\n- ${laterOutcome}`
    });
    const supports = validRunbookSupports().map((entry) => entry.supportKind === "verification"
      ? support("validationChecks[0]", ref, excerpt, "verification")
      : entry);

    expect(validateArtifactQuality({
      evidenceByRef,
      kind: "runbook",
      output: validRunbook(),
      provenanceSessionIds: ["session:a"],
      supports
    })).toContainEqual(expect.objectContaining({
      code: "invalid_support_kind_evidence",
      path: "validationChecks[0]"
    }));
  });

  test("accepts a clean final verification section after an earlier failure narrative", () => {
    const ref = "message:session:a:verification-recovered";
    const excerpt = [
      "Post-fix verification:",
      "- Callback regression checks passed.",
      "- The service is healthy."
    ].join("\n");
    const evidenceByRef = fixtureEvidence();
    evidenceByRef.set(ref, {
      kind: "message",
      lowValue: false,
      observedAt: "2026-07-12T12:20:00.000Z",
      role: "assistant",
      sessionId: "session:a",
      text: `The initial production verification failed with two errors.\n${excerpt}`
    });
    const supports = validRunbookSupports().map((entry) => entry.supportKind === "verification"
      ? support("validationChecks[0]", ref, excerpt, "verification")
      : entry);

    expect(validateArtifactQuality({
      evidenceByRef,
      kind: "runbook",
      output: validRunbook(),
      provenanceSessionIds: ["session:a"],
      supports
    })).not.toContainEqual(expect.objectContaining({
      code: "invalid_support_kind_evidence",
      path: "validationChecks[0]"
    }));
  });

  test("rejects an assistant message that leaves end-to-end verification unresolved", () => {
    const ref = "message:session:a:procedure-partial";
    const text = "I patched the notification hint, but end-to-end verification remains untested and unresolved.";
    const evidenceByRef = fixtureEvidence();
    evidenceByRef.set(ref, {
      kind: "message",
      lowValue: false,
      observedAt: "2026-07-12T12:20:00.000Z",
      role: "assistant",
      sessionId: "session:a",
      text
    });
    const supports = validRunbookSupports().map((entry) => entry.supportKind === "verification"
      ? support("validationChecks[0]", ref, text, "verification")
      : entry);

    expect(validateArtifactQuality({
      evidenceByRef,
      kind: "runbook",
      output: validRunbook(),
      provenanceSessionIds: ["session:a"],
      supports
    })).toContainEqual(expect.objectContaining({
      code: "invalid_support_kind_evidence",
      path: "validationChecks[0]"
    }));
  });

  test("requires action support to be a command or explicit assistant change statement", () => {
    const supports = validRunbookSupports().map((entry) =>
      entry.supportKind === "change"
        ? support("fixSteps[0]", MESSAGE, "OAuth callback state validation rejected the request.", "change")
        : entry
    );

    expect(validateArtifactQuality({
      evidenceByRef: fixtureEvidence(),
      kind: "runbook",
      output: validRunbook(),
      provenanceSessionIds: ["session:a"],
      supports
    })).toContainEqual(expect.objectContaining({ code: "invalid_support_kind_evidence", path: "fixSteps[0]" }));
  });

  test("requires incident timeline support to be timestamped and chronologically ordered", () => {
    const output = validIncident();
    output.timeline = [...output.timeline].reverse();

    expect(validateArtifactQuality({
      evidenceByRef: fixtureEvidence(),
      kind: "incident_timeline",
      output,
      provenanceSessionIds: ["session:a"],
      supports: validIncidentSupports()
    })).toContainEqual(expect.objectContaining({ code: "invalid_timeline_order", path: "timeline[1].at" }));
  });

  test("rejects ordered authored timestamps backed by reverse-chronological evidence", () => {
    const supports = validIncidentSupports().map((entry) => {
      if (entry.path === "timeline[0].summary") return { ...entry, evidenceRef: "message:session:a:remediation", excerpt: "Remediation added deterministic callback state validation before token exchange." };
      if (entry.path === "timeline[1].summary") return { ...entry, evidenceRef: MESSAGE, excerpt: "OAuth callback state validation rejected the request." };
      return entry;
    });

    expect(validateArtifactQuality({
      evidenceByRef: fixtureEvidence(),
      kind: "incident_timeline",
      output: validIncident(),
      provenanceSessionIds: ["session:a"],
      supports
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_timeline_order", path: "timeline[0].at" }),
      expect.objectContaining({ code: "invalid_timeline_order", path: "timeline[1].at" })
    ]));
  });

  test("requires each timeline support ref to be visible on that exact timeline entry", () => {
    const output = validIncident();
    output.timeline[0]!.evidenceRefs = ["message:session:a:remediation"];

    expect(validateArtifactQuality({
      evidenceByRef: fixtureEvidence(),
      kind: "incident_timeline",
      output,
      provenanceSessionIds: ["session:a"],
      supports: validIncidentSupports()
    })).toContainEqual(expect.objectContaining({
      code: "invalid_timeline_support",
      path: "timeline[0].evidenceRefs"
    }));
  });

  test("allows an explicit unknown root cause but requires root_cause support for a causal assertion", () => {
    const unknown = validRunbook();
    unknown.rootCause = "Unknown from the available canonical evidence.";
    expect(validateArtifactQuality({
      evidenceByRef: fixtureEvidence(),
      kind: "runbook",
      output: unknown,
      provenanceSessionIds: ["session:a"],
      supports: validRunbookSupports().filter((entry) => entry.supportKind !== "root_cause")
    })).not.toContainEqual(expect.objectContaining({ code: "missing_root_cause_support" }));

    expect(validateArtifactQuality({
      evidenceByRef: fixtureEvidence(),
      kind: "runbook",
      output: validRunbook(),
      provenanceSessionIds: ["session:a"],
      supports: validRunbookSupports().filter((entry) => entry.supportKind !== "root_cause")
    })).toContainEqual(expect.objectContaining({ code: "missing_root_cause_support", path: "rootCause" }));
  });

  test("rejects a blank root cause even when direct root_cause support is supplied", () => {
    for (const kind of ["runbook", "incident_timeline"] as const) {
      const output = kind === "runbook" ? validRunbook() : validIncident();
      output.rootCause = "   ";
      const supports = kind === "runbook"
        ? validRunbookSupports()
        : [
            ...validIncidentSupports(),
            support(
              "rootCause",
              MESSAGE,
              "The prior validator accepted unsupported root cause claims.",
              "root_cause"
            )
          ];

      expect(validateArtifactQuality({
        evidenceByRef: fixtureEvidence(),
        kind,
        output,
        provenanceSessionIds: ["session:a"],
        supports
      })).toContainEqual(expect.objectContaining({ code: "missing_root_cause_support", path: "rootCause" }));
    }
  });

  test("does not treat an unknown causal mechanism as an explicit uncertainty statement", () => {
    const causal = validRunbook();
    causal.rootCause = "An unknown cache defect caused the callback failure.";

    expect(validateArtifactQuality({
      evidenceByRef: fixtureEvidence(),
      kind: "runbook",
      output: causal,
      provenanceSessionIds: ["session:a"],
      supports: validRunbookSupports().filter((entry) => entry.supportKind !== "root_cause")
    })).toContainEqual(expect.objectContaining({ code: "missing_root_cause_support", path: "rootCause" }));
  });

  test("does not allow a causal assertion after an uncertainty sentence", () => {
    const causal = validRunbook();
    causal.rootCause = "Root cause is unknown. A cache defect caused the callback failure.";

    expect(validateArtifactQuality({
      evidenceByRef: fixtureEvidence(),
      kind: "runbook",
      output: causal,
      provenanceSessionIds: ["session:a"],
      supports: validRunbookSupports().filter((entry) => entry.supportKind !== "root_cause")
    })).toContainEqual(expect.objectContaining({ code: "missing_root_cause_support", path: "rootCause" }));
  });

  test("requires incidents without root-cause support to state that root cause is unknown", () => {
    const incident = validIncident();

    expect(validateArtifactQuality({
      evidenceByRef: fixtureEvidence(),
      kind: "incident_timeline",
      output: incident,
      provenanceSessionIds: ["session:a"],
      supports: validIncidentSupports().filter((entry) => entry.supportKind !== "root_cause")
    })).toContainEqual(expect.objectContaining({ code: "missing_root_cause_support", path: "rootCause" }));
  });

  test("does not impose a root-cause field on ADRs", () => {
    const evidenceByRef = fixtureEvidence();
    const output = {
      alternatives: ["Keep the legacy claim envelope unchanged."],
      decision: "Require exact claim support on every V2 artifact.",
      title: "Require exact V2 claim support"
    };

    expect(validateArtifactQuality({
      evidenceByRef,
      kind: "adr",
      output,
      provenanceSessionIds: ["session:a"],
      supports: [
        support("decision", MESSAGE, "The prior validator accepted unsupported root cause claims.", "decision"),
        support("alternatives[0]", MESSAGE, "OAuth callback state validation rejected the request.", "alternative")
      ]
    })).not.toContainEqual(expect.objectContaining({ code: "missing_root_cause_support" }));
  });

  test("permits real Masthead authoring language when that exact field is directly supported", () => {
    const evidence = fixtureEvidence();
    evidence.set("message:session:a:manifest", {
      kind: "message",
      lowValue: false,
      observedAt: "2026-07-12T13:00:00.000Z",
      role: "user",
      sessionId: "session:a",
      text: "Masthead must keep the evidence manifest visible during an authoring run."
    });
    const output = { context: "Keep the evidence manifest visible during an authoring run." };
    const supports = [support(
      "context",
      "message:session:a:manifest",
      "keep the evidence manifest visible during an authoring run",
      "problem"
    )];

    expect(findUnsupportedProtocolLanguage(output, supports, evidence)).toEqual([]);
  });
});

describe("duplicate substantive human content", () => {
  test("rejects identical candidate outputs and disjoint recent current artifacts", () => {
    const output = validRunbook();
    const recent = recentArtifact(output, ["session:z"]);
    const findings = findDuplicateHumanContent(
      [
        { candidateId: "candidate:a", kind: "runbook", output, provenanceSessionIds: ["session:a"] },
        { candidateId: "candidate:b", kind: "runbook", output: structuredClone(output), provenanceSessionIds: ["session:b"] }
      ],
      [recent]
    );

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate_human_content", candidateId: "candidate:b" }),
      expect.objectContaining({ code: "duplicate_human_content", artifactId: recent.artifactId })
    ]));
  });

  test("excludes canonical dossiers and permits matching current content with overlapping provenance", () => {
    const output = validRunbook();
    const sameProvenance = recentArtifact(output, ["session:a"]);
    const dossier = { ...recentArtifact(output, ["session:z"]), artifactKind: "session_dossier" as const };

    expect(findDuplicateHumanContent(
      [{ candidateId: "candidate:a", kind: "runbook", output, provenanceSessionIds: ["session:a"] }],
      [sameProvenance, dossier]
    )).toEqual([]);
  });
});

function support(
  path: string,
  evidenceRef: string,
  excerpt: string,
  supportKind: WorkbenchClaimSupport["supportKind"]
): WorkbenchClaimSupport {
  return { evidenceRef, excerpt, path, supportKind };
}

function fixtureEvidence(): Map<string, WorkbenchValidationEvidence> {
  return new Map([
    [MESSAGE, {
      kind: "message",
      lowValue: false,
      observedAt: "2026-07-12T12:00:00.000Z",
      role: "user",
      sessionId: "session:a",
      text: [
        "OAuth callback state validation rejected the request.",
        "The response contained invalid callback state in OAuth callback handling.",
        "OAuth callback handling is enabled.",
        "Submit a callback with stale state to reproduce the failure.",
        "Retrying token exchange without validating state did not work.",
        "Production callback configuration is required.",
        "Validate state before token exchange for every callback.",
        "Legacy clients can still send invalid callback state.",
        "Users could not complete OAuth sign-in.",
        "Callback retries amplified the sign-in failures.",
        "Reject callbacks whose state does not match the initiating request.",
        "The prior validator accepted unsupported root cause claims."
      ].join(" ")
    }],
    [CHANGE, {
      kind: "file_effect",
      lowValue: false,
      observedAt: "2026-07-12T12:05:00.000Z",
      role: "tool",
      sessionId: "session:a",
      text: "Changed src/auth/callback.ts to validate callback state before token exchange. Ran npm test -- auth-callback after the change."
    }],
    [ACTION, {
      kind: "message",
      lowValue: false,
      observedAt: "2026-07-12T12:06:00.000Z",
      role: "assistant",
      sessionId: "session:a",
      text: "Changed callback validation before token exchange and ran npm test -- auth-callback after the change."
    }],
    [PASSED, {
      exitCode: 0,
      kind: "tool_result",
      lowValue: false,
      observedAt: "2026-07-12T12:10:00.000Z",
      role: "tool",
      sessionId: "session:a",
      status: "passed",
      text: "Focused authoring validation tests passed with 24 assertions."
    }],
    ["checkpoint:session:a:passed", {
      kind: "checkpoint",
      label: "verification_passed",
      lowValue: false,
      observedAt: "2026-07-12T12:11:00.000Z",
      role: "system",
      sessionId: "session:a",
      text: "Focused callback regression checkpoint verified the repaired behavior."
    }],
    ["message:session:a:remediation", {
      kind: "message",
      lowValue: false,
      observedAt: "2026-07-12T12:15:00.000Z",
      role: "assistant",
      sessionId: "session:a",
      text: "Remediation added deterministic callback state validation before token exchange."
    }],
    [ADR, {
      kind: "message",
      lowValue: false,
      observedAt: "2026-07-12T12:30:00.000Z",
      role: "user",
      sessionId: "session:a",
      text: [
        "The callback contract accepted invalid state because decisions were not evidence-bound.",
        "Keep the legacy claim envelope unchanged was considered and rejected.",
        "Require exact claim support on every V2 artifact.",
        "Unsupported artifacts now fail validation before publication.",
        "src/workbench/authoring/artifactQuality.ts is affected.",
        "The evidence-backed decision status is accepted.",
        "This decision supersedes adr:legacy-claim-envelope.",
        "This decision also supersedes adr:implicit-support-contract."
      ].join(" ")
    }],
    [JOIN_A, {
      kind: "message",
      lowValue: false,
      observedAt: "2026-07-12T12:40:00.000Z",
      role: "user",
      sessionId: "session:a",
      text: "Session A recorded the OAuth callback state mismatch signature."
    }],
    [JOIN_B, {
      kind: "message",
      lowValue: false,
      observedAt: "2026-07-12T12:41:00.000Z",
      role: "user",
      sessionId: "session:b",
      text: "Session B recorded the OAuth callback state mismatch signature."
    }]
  ]);
}

function validRunbook(): Record<string, unknown> & { rootCause: string } {
  return {
    changedFiles: ["src/auth/callback.ts"],
    commands: ["npm test -- auth-callback"],
    deadEnds: ["Retrying token exchange without validating state did not work."],
    environmentRequirements: ["Production callback configuration is required."],
    fixSteps: ["Validate callback state before exchanging the authorization code."],
    preconditions: ["OAuth callback handling is enabled."],
    preventionNotes: ["Validate state before token exchange for every callback."],
    problemSignature: {
      affectedScope: "OAuth callback handling",
      errorStrings: ["invalid callback state"],
      symptoms: ["OAuth callback state validation rejected the request."]
    },
    reproSteps: ["Submit a callback with stale state to reproduce the failure."],
    risksOrGaps: ["Legacy clients can still send invalid callback state."],
    rootCause: "The prior validator accepted unsupported root cause claims.",
    title: "Repair OAuth callback validation",
    validationChecks: ["Focused authoring validation tests passed with 24 assertions."]
  };
}

function validRunbookSupports(): WorkbenchClaimSupport[] {
  return [
    support("problemSignature.symptoms[0]", MESSAGE, "OAuth callback state validation rejected the request.", "problem"),
    support("problemSignature.errorStrings[0]", MESSAGE, "The response contained invalid callback state in OAuth callback handling.", "problem"),
    support("problemSignature.affectedScope", MESSAGE, "The response contained invalid callback state in OAuth callback handling.", "problem"),
    support("preconditions[0]", MESSAGE, "OAuth callback handling is enabled.", "problem"),
    support("reproSteps[0]", MESSAGE, "Submit a callback with stale state to reproduce the failure.", "problem"),
    support("deadEnds[0]", MESSAGE, "Retrying token exchange without validating state did not work.", "problem"),
    support("fixSteps[0]", ACTION, "Changed callback validation before token exchange", "change"),
    support("commands[0]", ACTION, "ran npm test -- auth-callback after the change.", "change"),
    support("changedFiles[0]", CHANGE, "Changed src/auth/callback.ts to validate callback state before token exchange.", "change"),
    support("environmentRequirements[0]", MESSAGE, "Production callback configuration is required.", "problem"),
    support("rootCause", MESSAGE, "The prior validator accepted unsupported root cause claims.", "root_cause"),
    support("preventionNotes[0]", MESSAGE, "Validate state before token exchange for every callback.", "remediation"),
    support("risksOrGaps[0]", MESSAGE, "Legacy clients can still send invalid callback state.", "problem"),
    support("validationChecks[0]", PASSED, "Focused authoring validation tests passed with 24 assertions.", "verification")
  ];
}

function validAdr(): Record<string, unknown> {
  return {
    affectedPaths: ["src/workbench/authoring/artifactQuality.ts"],
    alternatives: ["Keep the legacy claim envelope unchanged."],
    confidence: "high",
    consequences: ["Unsupported artifacts now fail validation before publication."],
    context: "The callback contract accepted invalid state because decisions were not evidence-bound.",
    decision: "Require exact claim support on every V2 artifact.",
    evidenceRefs: [ADR],
    missingEvidence: [],
    provenanceSessionIds: ["session:a"],
    status: "accepted",
    supersedes: ["adr:legacy-claim-envelope", "adr:implicit-support-contract"],
    title: "Require exact V2 claim support"
  };
}

function validAdrSupports(): WorkbenchClaimSupport[] {
  return [
    support("context", ADR, "The callback contract accepted invalid state because decisions were not evidence-bound.", "problem"),
    support("decision", ADR, "Require exact claim support on every V2 artifact.", "decision"),
    support("status", ADR, "The evidence-backed decision status is accepted.", "decision"),
    support("alternatives[0]", ADR, "Keep the legacy claim envelope unchanged was considered and rejected.", "alternative"),
    support("consequences[0]", ADR, "Unsupported artifacts now fail validation before publication.", "decision"),
    support("affectedPaths[0]", ADR, "src/workbench/authoring/artifactQuality.ts is affected.", "decision"),
    support("supersedes[0]", ADR, "This decision supersedes adr:legacy-claim-envelope.", "decision"),
    support("supersedes[1]", ADR, "This decision also supersedes adr:implicit-support-contract.", "decision")
  ];
}

function validIncident(): Record<string, unknown> & {
  timeline: Array<{ at: string; evidenceRefs: string[]; summary: string }>;
} {
  return {
    contributingFactors: ["Callback retries amplified the sign-in failures."],
    impact: "Users could not complete OAuth sign-in.",
    prevention: ["Reject callbacks whose state does not match the initiating request."],
    remediation: ["Remediation added deterministic callback state validation before token exchange."],
    rootCause: "The prior validator accepted unsupported root cause claims.",
    status: "resolved",
    symptom: "OAuth callback state validation rejected the request.",
    timeline: [
      {
        at: "2026-07-12T12:00:00.000Z",
        evidenceRefs: [MESSAGE],
        summary: "OAuth callback state validation rejected the request."
      },
      {
        at: "2026-07-12T12:15:00.000Z",
        evidenceRefs: ["message:session:a:remediation"],
        summary: "Remediation added deterministic callback state validation before token exchange."
      }
    ],
    title: "OAuth callback validation incident"
  };
}

function validIncidentSupports(): WorkbenchClaimSupport[] {
  return [
    support("symptom", MESSAGE, "OAuth callback state validation rejected the request.", "problem"),
    support("impact", MESSAGE, "Users could not complete OAuth sign-in.", "problem"),
    support("timeline[0].summary", MESSAGE, "OAuth callback state validation rejected the request.", "timeline"),
    support(
      "timeline[1].summary",
      "message:session:a:remediation",
      "Remediation added deterministic callback state validation before token exchange.",
      "timeline"
    ),
    support(
      "remediation[0]",
      "message:session:a:remediation",
      "Remediation added deterministic callback state validation before token exchange.",
      "remediation"
    ),
    support("rootCause", MESSAGE, "The prior validator accepted unsupported root cause claims.", "root_cause"),
    support("contributingFactors[0]", MESSAGE, "Callback retries amplified the sign-in failures.", "problem"),
    support("prevention[0]", MESSAGE, "Reject callbacks whose state does not match the initiating request.", "remediation"),
    support("status", PASSED, "Focused authoring validation tests passed with 24 assertions.", "verification")
  ];
}

function recentArtifact(output: Record<string, unknown>, provenanceSessionIds: string[]): SessionArtifactRecord {
  return {
    artifactId: "artifact:recent",
    artifactKind: "runbook",
    confidence: "high",
    content: output,
    contentFingerprint: "stored-fingerprint",
    createdAt: "2026-07-12T12:00:00.000Z",
    createdBy: "workbench_authoring:test",
    evidenceRefs: [],
    lineageId: "lineage:recent",
    provenanceSessionIds,
    publicationStatus: "published",
    publishedAt: "2026-07-12T12:00:00.000Z",
    schemaVersion: "runbook-v2",
    sessionId: provenanceSessionIds[0]!,
    status: "current",
    title: String(output.title),
    updatedAt: "2026-07-12T12:00:00.000Z",
    validation: { ok: true }
  };
}
