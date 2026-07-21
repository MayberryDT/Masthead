import { describe, expect, test } from "vitest";
import type { EvidenceRef } from "../../../core/types.ts";
import type { GuidedAuthoringBundleV4 } from "../../../shared/guidedAuthoring.ts";
import type { DurableSessionEnrichment } from "../../../shared/sessionEnrichment.ts";
import type { SessionDossierDto } from "../../../shared/sessionDossier.ts";
import type { WorkbenchClaimSupport } from "../../../shared/workbenchAuthoring.ts";
import type { WorkbenchValidationEvidence } from "../../types.ts";
import {
  FAILED_V3_TEMPLATE_EXPECTED_FINDING_CODES,
  failedV3TemplateBundle
} from "../__fixtures__/failedV3TemplateCampaign.ts";
import {
  GUIDED_RUBRIC_AXIS_PATHS,
  mapGuidedArtifactQualityFinding,
  validateGuidedAuthoringDraft,
  type GuidedAuthoringValidationInput
} from "../guidedAuthoringQuality.ts";

const at = "2026-07-19T12:00:00.000Z";
const ref = (id: string): EvidenceRef => ({ id, kind: "event", observedAt: at, source: "fixture" });

export const GUIDED_FINDING_IDENTITY_CASES = [
  {
    name: "assignment envelope",
    input: () => { const input = validInput(); input.bundle.assignmentId = "wrong"; return input; },
    expected: [{ code: "guided_assignment_mismatch", message: "Bundle assignment does not match the trusted assignment.", severity: "error", path: "/assignmentId" }]
  },
  {
    name: "evidence revision envelope",
    input: () => { const input = validInput(); input.bundle.evidenceRevision = "wrong"; return input; },
    expected: [{ code: "guided_evidence_revision_mismatch", message: "Bundle evidence revision does not match the assignment evidence revision.", severity: "error", path: "/evidenceRevision" }]
  },
  {
    name: "coverage",
    input: () => { const input = validInput(); input.coverage[0]!.accessedItems = 0; return input; },
    expected: [{ code: "incomplete_evidence_inspection", message: "Assignment session evidence inspection is incomplete or stale.", severity: "error", path: "/sessionEnrichments/0", sessionId: "session:a" }]
  },
  {
    name: "missing verification disclosure",
    input: () => { const input = validInput(); input.bundle.sessionEnrichments[0]!.enrichment.sessionSummary.state = "completed"; input.bundle.sessionEnrichments[0]!.enrichment.sessionDossier.verification.status = "unknown"; input.bundle.sessionEnrichments[0]!.enrichment.sessionDossier.warnings = []; return input; },
    expected: [{ code: "unsupported_completion", message: "Keep this required session enrichment and report verification honestly: cite supported passed/failed verification, or use missing/unknown verification with an explicit 'Verification not run.' warning. Session completion state describes the work outcome separately from verification status. Use a pure 'Verification not run.' session summary only when canonical evidence supports no outcome or key work.", severity: "error", path: "/sessionEnrichments/0/enrichment/sessionSummary/state", sessionId: "session:a" }]
  },
  {
    name: "claim path",
    input: () => { const input = validInput(); input.bundle.sessionEnrichments[0]!.claimSupport[0]!.path = "/unknown"; return input; },
    expected: [
      { code: "invalid_session_claim_path", message: "Claim support path must resolve to one canonical substantive session field.", severity: "error", path: "/sessionEnrichments/0/claimSupport/0/path", sessionId: "session:a" },
      { code: "missing_session_claim_support", message: "Claim-bearing session field requires one valid reuse support.", severity: "error", path: "/sessionEnrichments/0/enrichment/sessionTitle/text", sessionId: "session:a" }
    ]
  },
  {
    name: "claim kind",
    input: () => { const input = validInput(); input.bundle.sessionEnrichments[0]!.claimSupport[0]!.supportKind = "purpose"; return input; },
    expected: [
      { code: "invalid_session_support_kind", message: "Claim support requires the reuse support kind.", severity: "error", path: "/sessionEnrichments/0/claimSupport/0/supportKind", sessionId: "session:a" },
      { code: "missing_session_claim_support", message: "Claim-bearing session field requires one valid reuse support.", severity: "error", path: "/sessionEnrichments/0/enrichment/sessionTitle/text", sessionId: "session:a" }
    ]
  },
  {
    name: "enrichment delta",
    input: () => {
      const input = validInput();
      const canonical = structuredClone(input.canonicalDossiersBySession.get("session:a")!);
      canonical.durableEnrichment = structuredClone(input.bundle.sessionEnrichments[0]!.enrichment);
      input.canonicalDossiersBySession = new Map([["session:a", canonical]]);
      return input;
    },
    expected: [{ code: "negligible_enrichment_delta", message: "Session enrichment must add supported session-specific headline and dossier information.", severity: "error", path: "/sessionEnrichments/0/enrichment", sessionId: "session:a" }]
  },
  {
    name: "session protocol",
    input: () => { const input = validInput(); input.bundle.sessionEnrichments[0]!.enrichment.sessionDossier.purpose = "Run workbench author save to complete this request."; return input; },
    expected: [{ code: "protocol_leakage", message: "Human-facing artifact text contains unsupported guided-authoring protocol language: workbench author save.", severity: "error", path: "/sessionEnrichments/0/enrichment/sessionDossier/purpose", sessionId: "session:a" }]
  },
  {
    name: "session duplicate",
    input: duplicateSessionInput,
    expected: [{ code: "duplicate_session_template", message: "Session enrichment duplicates a prior request session template.", severity: "error", path: "/sessionEnrichments/1/enrichment", sessionId: "session:b" }]
  },
  {
    name: "missing opportunity",
    input: () => { const input = opportunityInput(); return input; },
    expected: [{ code: "missing_opportunity_disposition", message: "Persisted opportunity is missing its disposition.", severity: "error", path: "/opportunityDispositions/0", opportunityId: "opportunity:a" }]
  },
  {
    name: "opportunity evidence",
    input: () => {
      const input = validAdrInput();
      input.bundle.opportunityDispositions[0]!.evidenceRefs = ["evidence:foreign"];
      input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:foreign", evidence("session:foreign", "Foreign evidence cannot resolve this opportunity."));
      return input;
    },
    expected: [{ code: "invalid_opportunity_evidence", message: "Disposition evidence must belong to the persisted opportunity.", severity: "error", path: "/opportunityDispositions/0/evidenceRefs/0", opportunityId: "opportunity:a", artifactDraftId: "draft:adr" }]
  },
  {
    name: "missing artifact link",
    input: () => {
      const input = opportunityInput();
      input.bundle.opportunityDispositions = [{ opportunityId: "opportunity:a", disposition: "authored", rationale: "The operational evidence supports a reusable verified procedure.", evidenceRefs: ["evidence:a"], artifactDraftId: "draft:missing", artifactKind: "runbook" }];
      return input;
    },
    expected: [{ code: "invalid_opportunity_artifact_link", message: "Disposition must link exactly one submitted artifact draft.", severity: "error", path: "/opportunityDispositions/0/artifactDraftId", opportunityId: "opportunity:a", artifactDraftId: "draft:missing" }]
  },
  {
    name: "invalid merge",
    input: () => {
      const input = opportunityInput();
      input.bundle.opportunityDispositions = [{ opportunityId: "opportunity:a", disposition: "merged", rationale: "Merge the same supported procedure into its related opportunity.", evidenceRefs: ["evidence:a"], mergedIntoOpportunityId: "opportunity:a" }];
      return input;
    },
    expected: [{ code: "invalid_opportunity_merge", message: "Merged opportunity must terminate at one artifact with complete union provenance.", severity: "error", path: "/opportunityDispositions/0/mergedIntoOpportunityId", opportunityId: "opportunity:a" }]
  },
  {
    name: "unlinked artifact",
    input: () => {
      const input = validInput();
      input.bundle.artifacts = [{ draftId: "draft:loose", kind: "adr", seedSessionId: "session:a", provenanceSessionIds: ["session:a"], output: { provenanceSessionIds: ["session:a"] } }];
      return input;
    },
    expected: [{ code: "unexpected_artifact_draft", message: "Submitted artifact draft is not linked by exactly one opportunity disposition.", severity: "error", path: "/artifacts/0", sessionId: "session:a", artifactDraftId: "draft:loose", artifactKind: "adr" }]
  },
  {
    name: "artifact rubric and quality mapping",
    input: () => {
      const input = validAdrInput();
      const supports = input.bundle.artifacts[0]!.output.claimSupport as Array<{ path: string }>;
      input.bundle.artifacts[0]!.output.claimSupport = supports.filter(({ path }) => path !== "context");
      return input;
    },
    expected: [
      { code: "incomplete_artifact_rubric", message: "Guided adr draft is missing the context reuse axis.", severity: "error", path: "/artifacts/0/output/context", sessionId: "session:a", artifactDraftId: "draft:adr", artifactKind: "adr" },
      { code: "missing_claim_support", message: "Populated claim-bearing field requires canonical claim support: context.", severity: "error", path: "/artifacts/0/output/context", sessionId: "session:a", artifactDraftId: "draft:adr", artifactKind: "adr" }
    ]
  },
  {
    name: "artifact quality mapping without a source path",
    input: () => {
      const input = validAdrInput();
      delete input.bundle.artifacts[0]!.output.alternatives;
      input.bundle.artifacts[0]!.output.claimSupport = (input.bundle.artifacts[0]!.output.claimSupport as Array<{ path: string }>).filter(({ path }) => !path.startsWith("alternatives"));
      return input;
    },
    expected: [
      { code: "missing_required_support_kind", message: "adr requires at least one valid alternative support entry.", severity: "error", path: "/artifacts/0/output", sessionId: "session:a", artifactDraftId: "draft:adr", artifactKind: "adr" },
      { code: "incomplete_artifact_rubric", message: "Guided adr draft is missing the alternatives actually considered reuse axis.", severity: "error", path: "/artifacts/0/output/alternatives", sessionId: "session:a", artifactDraftId: "draft:adr", artifactKind: "adr" }
    ]
  },
  {
    name: "artifact protocol mapping",
    input: () => { const input = validAdrInput(); input.bundle.artifacts[0]!.output.decision = "Run workbench author save before accepting the decision."; return input; },
    expected: [{ code: "protocol_leakage", message: "Human-facing artifact text contains unsupported guided-authoring protocol language: workbench author save.", severity: "error", path: "/artifacts/0/output/decision", sessionId: "session:a", artifactDraftId: "draft:adr", artifactKind: "adr" }]
  },
  {
    name: "raw evidence placeholder",
    input: () => { const input = validAdrInput(); input.bundle.artifacts[0]!.output.decision = "Refer to the session for the durable decision."; return input; },
    expected: [{ code: "artifact_requires_raw_evidence", message: "Required artifact field contains a raw-evidence placeholder and is not independently reusable.", severity: "error", path: "/artifacts/0/output/decision", sessionId: "session:a", artifactDraftId: "draft:adr", artifactKind: "adr" }]
  },
  {
    name: "request-wide artifact duplicate",
    input: () => {
      const input = validAdrInput();
      const duplicate = structuredClone(input.bundle.artifacts[0]!);
      duplicate.draftId = "draft:accepted";
      input.requestAcceptedDrafts = [{
        assignmentId: "assignment:prior", draftRevision: 1, evidenceRevision: "revision:prior",
        draft: { bundleVersion: "workbench-authoring-v4", assignmentId: "assignment:prior", evidenceRevision: "revision:prior", sessionEnrichments: [], opportunityDispositions: [], artifacts: [duplicate] }
      }];
      return input;
    },
    expected: [{ code: "duplicate_artifact_content", message: "Optional artifact duplicates substantive content from another request draft.", severity: "error", path: "/artifacts/0/output", sessionId: "session:a", artifactDraftId: "draft:adr", artifactKind: "adr" }]
  }
] satisfies Array<{ name: string; input: () => GuidedAuthoringValidationInput; expected: Array<Record<string, unknown>> }>;

describe("validateGuidedAuthoringDraft", () => {
  test.each(GUIDED_FINDING_IDENTITY_CASES)("emits exact finding identity: $name", ({ input, expected }) => {
    expect(validateGuidedAuthoringDraft(input()).findings).toEqual(expected);
  });

  test("rejects the production bulk-template failure shape", () => {
    const result = validateGuidedAuthoringDraft(failedTemplateInput());
    expect(result.accepted).toBe(false);
    expect(result.findings.map(({ code }) => code).filter((code, index, all) => all.indexOf(code) === index))
      .toEqual(FAILED_V3_TEMPLATE_EXPECTED_FINDING_CODES);
  });

  test("accepts a specific sparse dossier when every claim is inspected and grounded", () => {
    expect(validateGuidedAuthoringDraft(validInput())).toEqual({ accepted: true, findings: [] });
  });

  test("rejects user-request evidence relabeled as session outcome, change, or verification support", () => {
    const input = validInput();
    const session = input.bundle.sessionEnrichments[0]!;
    const userRequest = [
      "Implement a pure validator with stable field-specific quality findings.",
      "Change the guided authoring quality module and verify the focused tests pass."
    ].join(" ");
    input.evidenceByRef = new Map([["evidence:a", evidence("session:a", userRequest)]]);
    session.enrichment.sessionSummary.text = "Implemented a pure validator with stable field-specific quality findings; verification was not run.";
    session.enrichment.sessionSummary.evidenceRefs = [ref("evidence:a")];
    session.enrichment.sessionDossier.outcome = "Implemented a pure validator with stable field-specific quality findings.";
    session.enrichment.sessionDossier.keyWork = ["Changed the guided authoring quality module."];
    session.enrichment.sessionDossier.evidenceRefs = [ref("evidence:a")];
    session.enrichment.sessionDossier.verification = {
      status: "missing",
      summary: "Verification was not run after the requested validator changes.",
      commands: [],
      failures: [],
      evidenceRefs: [ref("evidence:a")]
    };
    session.claimSupport = [
      support("/sessionTitle/text", "reuse", "Implement a pure validator with stable field-specific quality findings."),
      support("/sessionSummary/text", "outcome", "Implement a pure validator with stable field-specific quality findings."),
      support("/sessionDossier/purpose", "purpose", "Implement a pure validator with stable field-specific quality findings."),
      support("/sessionDossier/outcome", "outcome", "Implement a pure validator with stable field-specific quality findings."),
      support("/sessionDossier/keyWork/0", "change", "Change the guided authoring quality module and verify the focused tests pass."),
      support("/sessionDossier/verification/summary", "verification", "Change the guided authoring quality module and verify the focused tests pass.")
    ];

    const result = validateGuidedAuthoringDraft(input);

    expect(result.accepted).toBe(false);
    expect(result.findings.filter(({ code }) => code === "invalid_session_support_evidence")).toEqual([
      {
        code: "invalid_session_support_evidence",
        message: "Session outcome support must come from canonical evidence that records work or a result, not a user request.",
        severity: "error",
        path: "/sessionEnrichments/0/claimSupport/1/evidenceRef",
        sessionId: "session:a"
      },
      {
        code: "invalid_session_support_evidence",
        message: "Session outcome support must come from canonical evidence that records work or a result, not a user request.",
        severity: "error",
        path: "/sessionEnrichments/0/claimSupport/3/evidenceRef",
        sessionId: "session:a"
      },
      {
        code: "invalid_session_support_evidence",
        message: "Session change support must come from canonical evidence that records performed work, not a user request.",
        severity: "error",
        path: "/sessionEnrichments/0/claimSupport/4/evidenceRef",
        sessionId: "session:a"
      },
      {
        code: "invalid_session_support_evidence",
        message: "Session verification support must come from canonical evidence that records a verification result or boundary, not a user request.",
        severity: "error",
        path: "/sessionEnrichments/0/claimSupport/5/evidenceRef",
        sessionId: "session:a"
      }
    ]);
  });

  test("emits exact envelope and missing-session finding identities in stable order", () => {
    const input = validInput();
    input.bundle.assignmentId = "assignment:tampered";
    input.bundle.evidenceRevision = "revision:stale";
    input.bundle.sessionEnrichments = [];
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([
      {
        code: "guided_assignment_mismatch",
        message: "Bundle assignment does not match the trusted assignment.",
        severity: "error",
        path: "/assignmentId"
      },
      {
        code: "guided_evidence_revision_mismatch",
        message: "Bundle evidence revision does not match the assignment evidence revision.",
        severity: "error",
        path: "/evidenceRevision"
      },
      {
        code: "missing_session_enrichment",
        message: "Assignment session is missing its enrichment draft.",
        severity: "error",
        path: "/sessionEnrichments/0",
        sessionId: "session:a"
      }
    ]);
  });

  test("rejects wrong support kind, undeclared evidence, and an absent excerpt at exact pointers", () => {
    const input = validInput();
    input.bundle.sessionEnrichments[0]!.claimSupport[0] = {
      path: "/sessionTitle/text",
      evidenceRef: "evidence:other",
      excerpt: "This excerpt does not occur in canonical evidence.",
      supportKind: "purpose"
    };
    input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:other", evidence("session:a", "Unrelated canonical content."));
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([
      { code: "claim_support_ref_not_declared", message: "Claim support evidence ref must be declared by the supported durable field owner.", severity: "error", path: "/sessionEnrichments/0/claimSupport/0/evidenceRef", sessionId: "session:a" },
      { code: "unsupported_claim_excerpt", message: "Claim support must quote at least 20 normalized characters verbatim from canonical evidence.", severity: "error", path: "/sessionEnrichments/0/claimSupport/0/excerpt", sessionId: "session:a" },
      { code: "invalid_session_support_kind", message: "Claim support requires the reuse support kind.", severity: "error", path: "/sessionEnrichments/0/claimSupport/0/supportKind", sessionId: "session:a" },
      { code: "missing_session_claim_support", message: "Claim-bearing session field requires one valid reuse support.", severity: "error", path: "/sessionEnrichments/0/enrichment/sessionTitle/text", sessionId: "session:a" }
    ]);
  });

  test("rejects unsupported completion and guided protocol leakage", () => {
    const input = validInput();
    const enrichment = input.bundle.sessionEnrichments[0]!.enrichment;
    enrichment.sessionSummary.state = "completed";
    enrichment.sessionDossier.verification.status = "unknown";
    enrichment.sessionDossier.warnings = [];
    enrichment.sessionDossier.purpose = "I reviewed all evidence before running workbench author save.";
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([
      protocolFinding("/sessionEnrichments/0/enrichment/sessionDossier/purpose", "I reviewed all evidence", { sessionId: "session:a" }),
      protocolFinding("/sessionEnrichments/0/enrichment/sessionDossier/purpose", "workbench author save", { sessionId: "session:a" }),
      { code: "unsupported_completion", message: "Keep this required session enrichment and report verification honestly: cite supported passed/failed verification, or use missing/unknown verification with an explicit 'Verification not run.' warning. Session completion state describes the work outcome separately from verification status. Use a pure 'Verification not run.' session summary only when canonical evidence supports no outcome or key work.", severity: "error", path: "/sessionEnrichments/0/enrichment/sessionSummary/state", sessionId: "session:a" }
    ]);
  });

  test("requires every persisted opportunity to have a disposition", () => {
    const input = validInput();
    input.assignment.opportunityIds = ["opportunity:a"];
    input.opportunities = [{
      opportunityId: "opportunity:a",
      suggestedKind: "runbook",
      signalStrength: "high",
      summary: "Repeated recovery procedure needs verification and rollback guidance.",
      evidenceRefs: ["evidence:a"],
      provenanceSessionIds: ["session:a"]
    }];
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
      code: "missing_opportunity_disposition",
      message: "Persisted opportunity is missing its disposition.",
      severity: "error",
      path: "/opportunityDispositions/0",
      opportunityId: "opportunity:a"
    }]);
  });

  test("rejects an empty opportunity evidence list with exact identity", () => {
    const input = validAdrInput();
    input.bundle.opportunityDispositions[0]!.evidenceRefs = [];
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
      code: "invalid_opportunity_evidence",
      message: "Disposition must cite persisted opportunity evidence.",
      severity: "error",
      path: "/opportunityDispositions/0/evidenceRefs",
      opportunityId: "opportunity:a",
      artifactDraftId: "draft:adr"
    }]);
  });

  test("requires an authored disposition to resolve to one matching draft", () => {
    const input = opportunityInput();
    input.bundle.opportunityDispositions = [{
      opportunityId: "opportunity:a",
      disposition: "authored",
      rationale: "The repeated recovery procedure has a reusable operational trigger and verification sequence.",
      evidenceRefs: ["evidence:a"],
      artifactDraftId: "draft:missing",
      artifactKind: "runbook"
    }];
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
      code: "invalid_opportunity_artifact_link",
      message: "Disposition must link exactly one submitted artifact draft.",
      severity: "error",
      path: "/opportunityDispositions/0/artifactDraftId",
      opportunityId: "opportunity:a",
      artifactDraftId: "draft:missing"
    }]);
  });

  test("reports an unlinked draft at its envelope without unrelated rubric noise", () => {
    const input = validInput();
    input.bundle.artifacts = [{
      draftId: "draft:unlinked",
      kind: "runbook",
      seedSessionId: "session:a",
      provenanceSessionIds: ["session:a"],
      output: { provenanceSessionIds: ["session:a"], claimSupport: [] }
    }];
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
      code: "unexpected_artifact_draft",
      message: "Submitted artifact draft is not linked by exactly one opportunity disposition.",
      severity: "error",
      path: "/artifacts/0",
      sessionId: "session:a",
      artifactDraftId: "draft:unlinked",
      artifactKind: "runbook"
    }]);
  });

  test("exports the exact stable guided rubric axis pointers", () => {
    expect(GUIDED_RUBRIC_AXIS_PATHS).toEqual({
      runbook: {
        trigger: "/problemSignature",
        preconditions: "/preconditions",
        performed_steps: "/fixSteps",
        expected_results_and_verification: "/validationChecks",
        failure_or_rollback_handling: "/risksOrGaps"
      },
      adr: {
        context: "/context",
        decision: "/decision",
        alternatives: "/alternatives",
        consequences: "/consequences",
        reversal_conditions: "/consequences"
      },
      incident_timeline: {
        symptom_and_impact: "/impact",
        timeline: "/timeline",
        root_cause: "/rootCause",
        contributing_factors: "/contributingFactors",
        remediation: "/remediation",
        recovery_verification: "/status"
      }
    });
  });

  test("requires failed and mixed verification narratives to disclose the failure", () => {
    for (const status of ["failed", "mixed"] as const) {
      const input = validInput();
      const draft = input.bundle.sessionEnrichments[0]!;
      draft.enrichment.sessionSummary.state = "failed";
      draft.enrichment.sessionDossier.verification = {
        status,
        summary: "The verification command produced a conclusive result.",
        commands: [], failures: [], evidenceRefs: [ref("evidence:verification-boundary")]
      };
      draft.claimSupport.push({
        ...support(
          "/sessionDossier/verification/summary",
          "verification",
          "The verification command produced a conclusive result."
        ),
        evidenceRef: "evidence:verification-boundary"
      });
      input.evidenceByRef = new Map(input.evidenceByRef).set(
        "evidence:verification-boundary",
        {
          ...evidence("session:a", "The verification command produced a conclusive result."),
          role: "assistant"
        }
      );
      expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
        code: "unsupported_completion",
        message: "Keep this required session enrichment and report verification honestly: cite supported passed/failed verification, or use missing/unknown verification with an explicit 'Verification not run.' warning. Session completion state describes the work outcome separately from verification status. Use a pure 'Verification not run.' session summary only when canonical evidence supports no outcome or key work.",
        severity: "error",
        path: "/sessionEnrichments/0/enrichment/sessionSummary/state",
        sessionId: "session:a"
      }]);
    }
  });

  test("treats a pure missing-verification boundary as epistemic metadata, not an unsupported outcome claim", () => {
    const input = validInput();
    const draft = input.bundle.sessionEnrichments[0]!;
    draft.enrichment.sessionDossier.outcome = "";
    draft.enrichment.sessionSummary = {
      ...draft.enrichment.sessionSummary,
      text: "Verification not run.",
      state: "unknown",
      confidence: "low"
    };
    draft.enrichment.sessionDossier.verification.status = "unknown";
    draft.enrichment.sessionDossier.warnings = ["Verification not run."];
    draft.claimSupport = draft.claimSupport.filter(({ path }) =>
      path !== "/sessionSummary/text" && path !== "/sessionDossier/outcome"
    );

    expect(validateGuidedAuthoringDraft(input)).toEqual({ accepted: true, findings: [] });

    draft.enrichment.sessionSummary.evidenceRefs = [ref("evidence:missing-verification")];
    input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:missing-verification", {
      ...evidence("session:a", "Verification not run."),
      role: "assistant"
    });

    expect(validateGuidedAuthoringDraft(input)).toEqual({ accepted: true, findings: [] });

    draft.enrichment.sessionSummary.text = "No verification was run, and no outcome was captured beyond the request.";
    expect(validateGuidedAuthoringDraft(input)).toEqual({ accepted: true, findings: [] });

    for (const unsupportedOutcome of [
      "Implemented the requested change; verification not run.",
      "Built the endpoint; verification not run.",
      "Deployment failed and was not verified."
    ]) {
      draft.enrichment.sessionSummary.text = unsupportedOutcome;
      expect(validateGuidedAuthoringDraft(input).findings).toEqual(expect.arrayContaining([expect.objectContaining({
        code: "missing_session_claim_support",
        path: "/sessionEnrichments/0/enrichment/sessionSummary/text",
        sessionId: "session:a"
      })]));
    }
  });

  test("rejects the v17 warning-only sparse capsule with an empty high-confidence summary", () => {
    const input = validInput();
    const draft = input.bundle.sessionEnrichments[0]!;
    draft.enrichment.sessionSummary = {
      ...draft.enrichment.sessionSummary,
      text: "",
      state: "unknown",
      confidence: "high",
      evidenceRefs: []
    };
    draft.enrichment.sessionDossier.outcome = "";
    draft.enrichment.sessionDossier.keyWork = [];
    draft.enrichment.sessionDossier.verification = {
      status: "missing",
      summary: "",
      commands: [],
      failures: [],
      evidenceRefs: []
    };
    draft.enrichment.sessionDossier.warnings = ["Verification not run."];
    draft.claimSupport = draft.claimSupport.filter(({ path }) =>
      path !== "/sessionSummary/text" && path !== "/sessionDossier/outcome" &&
      !path.startsWith("/sessionDossier/keyWork/")
    );

    expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
      code: "unsupported_completion",
      message: "A sparse capsule with unknown work state and no supported outcome, key work, or verification result cannot claim high summary confidence. Set sessionSummary.confidence to low unless canonical evidence supports a more specific result.",
      severity: "error",
      path: "/sessionEnrichments/0/enrichment/sessionSummary/confidence",
      sessionId: "session:a"
    }, {
      code: "missing_session_claim_support",
      message: "Every session capsule requires a nonblank sessionSummary.text. State supported work or results when present; when none is supported and verification is missing or unknown, write a direct pure boundary such as 'Verification not run.' instead of relying on a warning.",
      severity: "error",
      path: "/sessionEnrichments/0/enrichment/sessionSummary/text",
      sessionId: "session:a"
    }]);
  });

  test("requires the capsule summary to carry a supported dossier result instead of hiding it behind a pure verification boundary", () => {
    const input = validInput();
    const draft = input.bundle.sessionEnrichments[0]!;
    draft.enrichment.sessionSummary = {
      ...draft.enrichment.sessionSummary,
      text: "Verification not run.",
      state: "completed",
      evidenceRefs: []
    };
    draft.enrichment.sessionDossier.verification.status = "unknown";
    draft.enrichment.sessionDossier.warnings = ["Verification not run."];
    draft.claimSupport = draft.claimSupport.filter(({ path }) => path !== "/sessionSummary/text");

    expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
      code: "missing_session_claim_support",
      message: "Session summary must state the specific supported work or result already present in the dossier. Keep missing or unknown verification explicit in verification status and warnings, and use it only as a caveat; a pure 'Verification not run.' summary is reserved for sessions with no supported outcome or key work.",
      severity: "error",
      path: "/sessionEnrichments/0/enrichment/sessionSummary/text",
      sessionId: "session:a"
    }]);

    draft.enrichment.sessionDossier.outcome = "";
    draft.claimSupport = draft.claimSupport.filter(({ path }) => path !== "/sessionDossier/outcome");
    draft.enrichment.sessionDossier.keyWork = ["Implemented a pure validator with stable field-specific quality findings."];
    draft.claimSupport.push({
      ...support(
        "/sessionDossier/keyWork/0",
        "change",
        "Implemented a pure validator with stable field-specific quality findings; verification was not run."
      ),
      evidenceRef: "evidence:result"
    });

    expect(validateGuidedAuthoringDraft(input).findings).toContainEqual(expect.objectContaining({
      code: "missing_session_claim_support",
      path: "/sessionEnrichments/0/enrichment/sessionSummary/text"
    }));
  });

  test("keeps work completion state separate from missing verification status", () => {
    const input = validInput();
    input.bundle.sessionEnrichments[0]!.enrichment.sessionSummary.state = "completed";
    input.bundle.sessionEnrichments[0]!.enrichment.sessionDossier.verification.status = "unknown";

    expect(validateGuidedAuthoringDraft(input)).toEqual({ accepted: true, findings: [] });
  });

  test("rejects an unknown work state when supported session evidence carries a result", () => {
    const input = validInput();
    input.bundle.sessionEnrichments[0]!.enrichment.sessionSummary.state = "unknown";
    input.bundle.sessionEnrichments[0]!.enrichment.sessionDossier.verification.status = "missing";
    input.bundle.sessionEnrichments[0]!.enrichment.sessionDossier.warnings = ["Verification not run."];

    expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
      code: "unsupported_completion",
      message: "Supported outcome, key work, or result-bearing summary requires a known work state. Set sessionSummary.state to completed, partial, blocked, failed, or paused from the work evidence; keep missing or unknown verification separate in the dossier verification status and warnings.",
      severity: "error",
      path: "/sessionEnrichments/0/enrichment/sessionSummary/state",
      sessionId: "session:a"
    }]);
  });

  test.each(["completed", "partial", "blocked"] as const)(
    "accepts supported result state %s independently from verification not run",
    (state) => {
      const input = validInput();
      input.bundle.sessionEnrichments[0]!.enrichment.sessionSummary.state = state;
      input.bundle.sessionEnrichments[0]!.enrichment.sessionDossier.verification.status = "unknown";
      input.bundle.sessionEnrichments[0]!.enrichment.sessionDossier.warnings = ["Verification not run."];

      expect(validateGuidedAuthoringDraft(input)).toEqual({ accepted: true, findings: [] });
    }
  );

  test("rejects an unknown verification boundary when canonical session evidence records a successful check", () => {
    const input = validInput();
    input.bundle.sessionEnrichments[0]!.enrichment.sessionDossier.evidenceRefs.push(ref("evidence:successful-check"));
    input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:successful-check", {
      ...evidence("session:a", "Schema probe 49 passed because the summary index was present after reconciliation."),
      kind: "tool_result",
      role: "tool",
      toolName: "sqlite_schema_probe",
      status: "succeeded",
      exitCode: 0
    });

    expect(validateGuidedAuthoringDraft(input).findings).toContainEqual({
      code: "unsupported_completion",
      message: "Canonical session evidence records successful verification. Preserve that result with passed status, a specific verification summary, and direct verification claim support instead of reporting verification as missing or unknown.",
      severity: "error",
      path: "/sessionEnrichments/0/enrichment/sessionDossier/verification/status",
      sessionId: "session:a"
    });
  });

  test("requires a dossier decision when high-signal decision evidence belongs to the session", () => {
    const input = validAdrInput();
    input.opportunities[0]!.evidenceRefs.push("evidence:explicit-decision");
    input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:explicit-decision", {
      ...evidence("session:a", "Decision: adopt local SQLite as the canonical session store; a hosted database would break offline operation."),
      role: "assistant"
    });

    expect(validateGuidedAuthoringDraft(input).findings).toContainEqual({
      code: "missing_session_claim_support",
      message: "High-signal canonical decision evidence requires at least one specific, directly supported session dossier decision.",
      severity: "error",
      path: "/sessionEnrichments/0/enrichment/sessionDossier/decisions",
      sessionId: "session:a"
    });
  });

  test("rejects optional-artifact process narration in human-facing dossier fields", () => {
    const input = validInput();
    const metaNarration = "Completed the evidence review without creating reusable optional-artifact claims.";
    input.bundle.sessionEnrichments[0]!.enrichment.sessionDossier.outcome =
      metaNarration;
    input.bundle.sessionEnrichments[0]!.enrichment.sessionDossier.evidenceRefs.push(ref("evidence:meta-narration"));
    const outcomeSupport = input.bundle.sessionEnrichments[0]!.claimSupport
      .find(({ path }) => path === "/sessionDossier/outcome")!;
    outcomeSupport.evidenceRef = "evidence:meta-narration";
    outcomeSupport.excerpt = metaNarration;
    input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:meta-narration", {
      ...evidence("session:a", metaNarration),
      role: "assistant"
    });

    expect(validateGuidedAuthoringDraft(input).findings).toContainEqual({
      code: "protocol_leakage",
      message: "Human-facing artifact text contains unsupported guided-authoring protocol language: reusable optional-artifact claims.",
      severity: "error",
      path: "/sessionEnrichments/0/enrichment/sessionDossier/outcome",
      sessionId: "session:a"
    });
  });

  test("rejects the v16 evidence-framed verification disclaimer with direct author guidance", () => {
    const input = validInput();
    const v16Summary = "Completed the Workbench activity label rename; the evidence records no specific verification result.";
    const draft = input.bundle.sessionEnrichments[0]!;
    draft.enrichment.sessionSummary.text = v16Summary;
    draft.enrichment.sessionSummary.evidenceRefs = [ref("evidence:v16-summary")];
    const summarySupport = draft.claimSupport.find(({ path }) => path === "/sessionSummary/text")!;
    summarySupport.evidenceRef = "evidence:v16-summary";
    summarySupport.excerpt = v16Summary;
    input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:v16-summary", {
      ...evidence("session:a", v16Summary),
      role: "assistant"
    });

    expect(validateGuidedAuthoringDraft(input).findings).toContainEqual({
      code: "protocol_leakage",
      message: "State the verification boundary directly in human-facing prose: use 'Verification not run.' when no verification result exists; do not narrate what the evidence records, shows, contains, or fails to establish.",
      severity: "error",
      path: "/sessionEnrichments/0/enrichment/sessionSummary/text",
      sessionId: "session:a"
    });
  });

  test("does not scan canonical raw evidence for presentation-only verification disclaimers", () => {
    const input = validInput();
    input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:raw-meta", {
      ...evidence("session:a", "The canonical evidence does not establish a verification result."),
      role: "assistant"
    });

    expect(validateGuidedAuthoringDraft(input)).toEqual({ accepted: true, findings: [] });
  });

  test("rejects quality opportunity definitions and merge targets outside the persisted assignment", () => {
    const input = opportunityInput();
    input.opportunities.push({
      opportunityId: "opportunity:foreign",
      suggestedKind: "runbook",
      signalStrength: "high",
      summary: "Foreign procedure definition.",
      evidenceRefs: ["evidence:a"],
      provenanceSessionIds: ["session:a"]
    });
    input.bundle.opportunityDispositions = [{
      opportunityId: "opportunity:a",
      disposition: "merged",
      rationale: "Merge the same operational evidence into the related procedure.",
      evidenceRefs: ["evidence:a"],
      mergedIntoOpportunityId: "opportunity:foreign"
    }];
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([
      { code: "invalid_opportunity_merge", message: "Merged opportunity must terminate at one artifact with complete union provenance.", severity: "error", path: "/opportunityDispositions/0/mergedIntoOpportunityId", opportunityId: "opportunity:a" },
      { code: "unexpected_opportunity_disposition", message: "Quality opportunity definition is outside the persisted assignment opportunities.", severity: "error", path: "/opportunityDispositions/1", opportunityId: "opportunity:foreign" }
    ]);
  });

  test("rejects extra coverage and canonical dossier membership with exact structured findings", () => {
    const input = validInput();
    input.coverage.push({ sessionId: "session:z", evidenceRevision: "revision:a", accessedItems: 1, totalItems: 1, complete: true });
    input.canonicalDossiersBySession = new Map(input.canonicalDossiersBySession).set("session:y", dossier());
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([
      {
        code: "incomplete_evidence_inspection",
        message: "Canonical dossier input includes a session outside the assignment.",
        severity: "error",
        path: "/sessionEnrichments/1",
        sessionId: "session:y"
      },
      {
        code: "incomplete_evidence_inspection",
        message: "Evidence coverage includes a session outside the assignment.",
        severity: "error",
        path: "/sessionEnrichments/1",
        sessionId: "session:z"
      }
    ]);
  });

  test.each([
    ["missing", (input: GuidedAuthoringValidationInput) => { input.coverage = []; }],
    ["repeated", (input: GuidedAuthoringValidationInput) => { input.coverage.push({ ...input.coverage[0]! }); }],
    ["stale", (input: GuidedAuthoringValidationInput) => { input.coverage[0]!.evidenceRevision = "revision:stale"; }],
    ["empty", (input: GuidedAuthoringValidationInput) => { input.coverage[0]!.totalItems = 0; input.coverage[0]!.accessedItems = 0; }],
    ["partial", (input: GuidedAuthoringValidationInput) => { input.coverage[0]!.accessedItems = 0; }],
    ["incomplete", (input: GuidedAuthoringValidationInput) => { input.coverage[0]!.complete = false; }]
  ] as const)("emits the exact coverage identity for %s coverage", (_name, mutate) => {
    const input = validInput();
    mutate(input);
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
      code: "incomplete_evidence_inspection",
      message: "Assignment session evidence inspection is incomplete or stale.",
      severity: "error",
      path: "/sessionEnrichments/0",
      sessionId: "session:a"
    }]);
  });

  test("requires distinct deficiency and applicability axes for changed kind", () => {
    const input = validIncidentInput();
    input.opportunities[0] = {
      ...input.opportunities[0]!,
      suggestedKind: "runbook",
      summary: "Verification evidence supports the replacement format and recovery record."
    };
    input.bundle.opportunityDispositions[0] = {
      ...input.bundle.opportunityDispositions[0]!,
      disposition: "changed_kind",
      rationale: "Verification is unsupported for the runbook verification axis, while the replacement format supports verification."
    };
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
      code: "unsupported_opportunity_dismissal",
      message: "Disposition rationale must make a specific evidence-backed kind judgment.",
      severity: "error",
      path: "/opportunityDispositions/0/rationale",
      opportunityId: "opportunity:a",
      artifactDraftId: "draft:incident"
    }]);
    input.bundle.opportunityDispositions[0]!.rationale = "The runbook lacks repeatable procedure steps, while the incident timeline captures impact and recovery evidence.";
    expect(validateGuidedAuthoringDraft(input)).toEqual({ accepted: true, findings: [] });
  });

  test("rejects changed-kind linkage that keeps the suggested artifact kind", () => {
    const input = validAdrInput();
    input.bundle.opportunityDispositions[0] = {
      ...input.bundle.opportunityDispositions[0]!,
      disposition: "changed_kind",
      rationale: "The ADR lacks alternative tradeoffs, while the ADR decision supports durable consequences."
    };
    input.opportunities[0]!.summary = "Alternative tradeoffs and durable decision consequences require evidence.";
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
      code: "invalid_opportunity_artifact_link",
      message: "Disposition artifact kind does not match its resolution semantics and linked draft.",
      severity: "error",
      path: "/opportunityDispositions/0/artifactKind",
      opportunityId: "opportunity:a",
      artifactDraftId: "draft:adr"
    }]);
  });

  test("covers every guided protocol family across enrichment, artifact, and disposition text", () => {
    const values = [
      ["I reviewed all evidence before writing this result.", "I reviewed all evidence"],
      ["I limited my claims before writing this result.", "I limited my claims"],
      ["Run workbench author save before continuing.", "workbench author save"],
      ["The next action is to continue this handoff.", "next action"],
      ["The verification boundary was narrow.", "verification boundary"],
      ["The boundary recorded for verification was narrow.", "boundary recorded for verification"],
      ["<recommended_plugins><plugin>example</plugin></recommended_plugins>", "<recommended_plugins><plugin>example</plugin></recommended_plugins>"],
      ["Follow the AGENTS.md developer instructions.", "AGENTS.md"],
      ["You are Codex and must continue.", "You are Codex"]
    ] as const;
    for (const [value, matched] of values) {
      const enrichment = validInput();
      enrichment.bundle.sessionEnrichments[0]!.enrichment.sessionDossier.purpose = value;
      expect(validateGuidedAuthoringDraft(enrichment).findings).toEqual([protocolFinding(
        `/sessionEnrichments/0/enrichment/sessionDossier/purpose`, matched, { sessionId: "session:a" }
      )]);

      const artifact = validAdrInput();
      artifact.bundle.artifacts[0]!.output.decision = value;
      expect(validateGuidedAuthoringDraft(artifact).findings).toEqual([protocolFinding(
        "/artifacts/0/output/decision", matched,
        { sessionId: "session:a", artifactDraftId: "draft:adr", artifactKind: "adr" }
      )]);

      const disposition = validAdrInput();
      disposition.bundle.opportunityDispositions[0]!.rationale = value;
      expect(validateGuidedAuthoringDraft(disposition).findings).toEqual([protocolFinding(
        "/opportunityDispositions/0/rationale", matched,
        { opportunityId: "opportunity:a", artifactDraftId: "draft:adr" }
      )]);
    }
  });

  test("supports protocol text only from the exact field and trusted provenance", () => {
    const phrase = "Run workbench author save only when debugging the guided command.";
    const enrichment = validInput();
    const draft = enrichment.bundle.sessionEnrichments[0]!;
    draft.enrichment.sessionDossier.purpose = phrase;
    draft.claimSupport.find(({ path }) => path === "/sessionDossier/purpose")!.excerpt = phrase;
    enrichment.evidenceByRef = new Map(enrichment.evidenceByRef).set("evidence:a", evidence("session:a", `${enrichment.evidenceByRef.get("evidence:a")!.text} ${phrase}`));
    expect(validateGuidedAuthoringDraft(enrichment).findings).toEqual([]);

    const adjacent = validInput();
    adjacent.bundle.sessionEnrichments[0]!.enrichment.sessionDossier.purpose = phrase;
    adjacent.bundle.sessionEnrichments[0]!.claimSupport.find(({ path }) => path === "/sessionDossier/outcome")!.excerpt = phrase;
    adjacent.evidenceByRef = new Map(adjacent.evidenceByRef).set("evidence:result", {
      ...evidence("session:a", `${adjacent.evidenceByRef.get("evidence:result")!.text} ${phrase}`),
      role: "assistant"
    });
    expect(validateGuidedAuthoringDraft(adjacent).findings).toEqual([
      { code: "negligible_enrichment_delta", message: "Session enrichment must add supported session-specific headline and dossier information.", severity: "error", path: "/sessionEnrichments/0/enrichment", sessionId: "session:a" },
      protocolFinding("/sessionEnrichments/0/enrichment/sessionDossier/purpose", "workbench author save", { sessionId: "session:a" })
    ]);

    const artifact = validAdrInput();
    artifact.bundle.artifacts[0]!.output.decision = phrase;
    const decisionSupport = (artifact.bundle.artifacts[0]!.output.claimSupport as WorkbenchClaimSupport[]).find(({ path }) => path === "decision")!;
    decisionSupport.evidenceRef = "evidence:foreign";
    decisionSupport.excerpt = phrase;
    artifact.evidenceByRef = new Map(artifact.evidenceByRef).set("evidence:foreign", evidence("session:foreign", phrase));
    expect(validateGuidedAuthoringDraft(artifact).findings).toEqual([
      { code: "incomplete_artifact_rubric", message: "Guided adr draft is missing the durable decision reuse axis.", severity: "error", path: "/artifacts/0/output/decision", sessionId: "session:a", artifactDraftId: "draft:adr", artifactKind: "adr" },
      { code: "invalid_support_kind_evidence", message: "decision support is not backed by the required canonical evidence class.", severity: "error", path: "/artifacts/0/output/decision", sessionId: "session:a", artifactDraftId: "draft:adr", artifactKind: "adr" },
      protocolFinding("/artifacts/0/output/decision", "workbench author save", { sessionId: "session:a", artifactDraftId: "draft:adr", artifactKind: "adr" })
    ]);

    const supportedArtifact = validAdrInput();
    supportedArtifact.bundle.artifacts[0]!.output.decision = phrase;
    const supportedDecision = (supportedArtifact.bundle.artifacts[0]!.output.claimSupport as WorkbenchClaimSupport[]).find(({ path }) => path === "decision")!;
    supportedDecision.excerpt = phrase;
    supportedArtifact.evidenceByRef = new Map(supportedArtifact.evidenceByRef).set("evidence:a", evidence("session:a", `${supportedArtifact.evidenceByRef.get("evidence:a")!.text} ${phrase}`));
    expect(validateGuidedAuthoringDraft(supportedArtifact).findings).toEqual([]);

    const disposition = validAdrInput();
    disposition.bundle.opportunityDispositions[0]!.rationale = phrase;
    disposition.bundle.opportunityDispositions[0]!.evidenceRefs = ["evidence:foreign"];
    disposition.evidenceByRef = new Map(disposition.evidenceByRef).set("evidence:foreign", evidence("session:a", phrase));
    expect(validateGuidedAuthoringDraft(disposition).findings).toEqual([
      { code: "invalid_opportunity_evidence", message: "Disposition evidence must belong to the persisted opportunity.", severity: "error", path: "/opportunityDispositions/0/evidenceRefs/0", opportunityId: "opportunity:a", artifactDraftId: "draft:adr" },
      protocolFinding("/opportunityDispositions/0/rationale", "workbench author save", { opportunityId: "opportunity:a", artifactDraftId: "draft:adr" })
    ]);

    const supportedDisposition = validAdrInput();
    supportedDisposition.bundle.opportunityDispositions[0]!.rationale = phrase;
    supportedDisposition.evidenceByRef = new Map(supportedDisposition.evidenceByRef).set("evidence:a", evidence("session:a", `${supportedDisposition.evidenceByRef.get("evidence:a")!.text} ${phrase}`));
    expect(validateGuidedAuthoringDraft(supportedDisposition).findings).toEqual([]);
  });

  test("does not treat nearby generic product vocabulary as guided protocol leakage", () => {
    const value = "The Masthead CLI prompt configures an agent plugin for repository work.";
    const enrichment = validInput();
    enrichment.bundle.sessionEnrichments[0]!.enrichment.sessionDossier.purpose = value;
    const artifact = validAdrInput();
    artifact.bundle.artifacts[0]!.output.decision = value;
    const disposition = validAdrInput();
    disposition.bundle.opportunityDispositions[0]!.rationale = value;
    for (const input of [enrichment, artifact, disposition]) {
      expect(validateGuidedAuthoringDraft(input).findings).toEqual([]);
    }
  });

  test.each([
    ["noncanonical", "/sessionDossier/keyWork/00"],
    ["unresolved", "/sessionDossier/keyWork/99"],
    ["unknown", "/sessionDossier/unknown"]
  ])("rejects %s claim pointers with exact identity", (_name, path) => {
    const input = validInput();
    input.bundle.sessionEnrichments[0]!.claimSupport[0]!.path = path;
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([
      { code: "invalid_session_claim_path", message: "Claim support path must resolve to one canonical substantive session field.", severity: "error", path: "/sessionEnrichments/0/claimSupport/0/path", sessionId: "session:a" },
      { code: "missing_session_claim_support", message: "Claim-bearing session field requires one valid reuse support.", severity: "error", path: "/sessionEnrichments/0/enrichment/sessionTitle/text", sessionId: "session:a" }
    ]);
  });

  test("rejects duplicate claim path/ref pairs after the first occurrence", () => {
    const input = validInput();
    input.bundle.sessionEnrichments[0]!.claimSupport.push(structuredClone(input.bundle.sessionEnrichments[0]!.claimSupport[0]!));
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
      code: "invalid_session_claim_path",
      message: "Claim support path must resolve to one canonical substantive session field.",
      severity: "error",
      path: "/sessionEnrichments/0/claimSupport/4/path",
      sessionId: "session:a"
    }]);
  });

  test("distinguishes a missing claim-support evidence ref from cross-session evidence ownership", () => {
    const missing = validInput();
    missing.bundle.sessionEnrichments[0]!.claimSupport[0]!.evidenceRef = "evidence:missing";
    expect(validateGuidedAuthoringDraft(missing).findings).toEqual([
      { code: "claim_support_ref_not_declared", message: "Claim support evidence ref must be declared by the supported durable field owner.", severity: "error", path: "/sessionEnrichments/0/claimSupport/0/evidenceRef", sessionId: "session:a" },
      { code: "evidence_outside_session", message: "Claim support evidence must belong to the enriched session.", severity: "error", path: "/sessionEnrichments/0/claimSupport/0/evidenceRef", sessionId: "session:a" },
      { code: "unsupported_claim_excerpt", message: "Claim support must quote at least 20 normalized characters verbatim from canonical evidence.", severity: "error", path: "/sessionEnrichments/0/claimSupport/0/excerpt", sessionId: "session:a" },
      { code: "missing_session_claim_support", message: "Claim-bearing session field requires one valid reuse support.", severity: "error", path: "/sessionEnrichments/0/enrichment/sessionTitle/text", sessionId: "session:a" }
    ]);

    const crossSession = validInput();
    crossSession.bundle.sessionEnrichments[0]!.claimSupport[0]!.evidenceRef = "evidence:foreign";
    crossSession.evidenceByRef = new Map(crossSession.evidenceByRef).set(
      "evidence:foreign",
      evidence("session:foreign", crossSession.bundle.sessionEnrichments[0]!.claimSupport[0]!.excerpt)
    );
    expect(validateGuidedAuthoringDraft(crossSession).findings).toEqual([
      { code: "claim_support_ref_not_declared", message: "Claim support evidence ref must be declared by the supported durable field owner.", severity: "error", path: "/sessionEnrichments/0/claimSupport/0/evidenceRef", sessionId: "session:a" },
      { code: "evidence_outside_session", message: "Claim support evidence must belong to the enriched session.", severity: "error", path: "/sessionEnrichments/0/claimSupport/0/evidenceRef", sessionId: "session:a" },
      { code: "missing_session_claim_support", message: "Claim-bearing session field requires one valid reuse support.", severity: "error", path: "/sessionEnrichments/0/enrichment/sessionTitle/text", sessionId: "session:a" }
    ]);
  });

  test.each([
    ["short", "too short"],
    ["absent", "This sufficiently long excerpt is absent from the canonical evidence text."]
  ])("rejects %s support excerpts at the excerpt pointer", (_name, excerpt) => {
    const input = validInput();
    input.bundle.sessionEnrichments[0]!.claimSupport[0]!.excerpt = excerpt;
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([
      { code: "unsupported_claim_excerpt", message: "Claim support must quote at least 20 normalized characters verbatim from canonical evidence.", severity: "error", path: "/sessionEnrichments/0/claimSupport/0/excerpt", sessionId: "session:a" },
      { code: "missing_session_claim_support", message: "Claim-bearing session field requires one valid reuse support.", severity: "error", path: "/sessionEnrichments/0/enrichment/sessionTitle/text", sessionId: "session:a" }
    ]);
  });

  test.each([
    ["missing", "evidence:missing", undefined],
    ["cross-session", "evidence:foreign", evidence("session:foreign", "Foreign canonical evidence remains outside this assignment session.")]
  ] as const)("rejects %s durable evidence refs at the owner pointer", (_name, evidenceId, foreignEvidence) => {
    const input = validInput();
    input.bundle.sessionEnrichments[0]!.enrichment.sessionTitle.evidenceRefs = [ref(evidenceId)];
    if (foreignEvidence) input.evidenceByRef = new Map(input.evidenceByRef).set(evidenceId, foreignEvidence);
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([
      { code: "claim_support_ref_not_declared", message: "Claim support evidence ref must be declared by the supported durable field owner.", severity: "error", path: "/sessionEnrichments/0/claimSupport/0/evidenceRef", sessionId: "session:a" },
      { code: "evidence_outside_session", message: "Durable evidence ref must belong to the enriched session.", severity: "error", path: "/sessionEnrichments/0/enrichment/sessionTitle/evidenceRefs/0", sessionId: "session:a" },
      { code: "missing_session_claim_support", message: "Claim-bearing session field requires one valid reuse support.", severity: "error", path: "/sessionEnrichments/0/enrichment/sessionTitle/text", sessionId: "session:a" }
    ]);
  });

  test("accepts every honest completion-matrix branch", () => {
    for (const status of ["missing", "unknown"] as const) {
      const input = validInput();
      input.bundle.sessionEnrichments[0]!.enrichment.sessionSummary.state = status === "missing" ? "completed" : "partial";
      input.bundle.sessionEnrichments[0]!.enrichment.sessionDossier.verification.status = status;
      expect(validateGuidedAuthoringDraft(input)).toEqual({ accepted: true, findings: [] });
    }
    for (const status of ["failed", "mixed"] as const) {
      const input = validInput();
      const draft = input.bundle.sessionEnrichments[0]!;
      draft.enrichment.sessionSummary.state = "failed";
      draft.enrichment.sessionDossier.verification = { status, summary: "Verification failed with a supported test error.", commands: [], failures: [], evidenceRefs: [ref("evidence:verification-failure")] };
      draft.claimSupport.push({
        ...support("/sessionDossier/verification/summary", "verification", "Verification failed with a supported test error."),
        evidenceRef: "evidence:verification-failure"
      });
      input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:verification-failure", {
        ...evidence("session:a", "Verification failed with a supported test error."),
        role: "assistant"
      });
      expect(validateGuidedAuthoringDraft(input)).toEqual({ accepted: true, findings: [] });
    }
    const passed = validInput();
    const passedDraft = passed.bundle.sessionEnrichments[0]!;
    passedDraft.enrichment.sessionSummary.state = "completed";
    passedDraft.enrichment.sessionDossier.verification = { status: "passed", summary: "Guided quality tests passed successfully.", commands: [], failures: [], evidenceRefs: [ref("evidence:verify")] };
    passedDraft.claimSupport.push({ path: "/sessionDossier/verification/summary", supportKind: "verification", evidenceRef: "evidence:verify", excerpt: "Guided quality tests passed successfully." });
    passed.evidenceByRef = new Map(passed.evidenceByRef).set("evidence:verify", { ...evidence("session:a", "Guided quality tests passed successfully."), kind: "tool_result", role: "tool", status: "succeeded", exitCode: 0, toolName: "vitest" });
    expect(validateGuidedAuthoringDraft(passed)).toEqual({ accepted: true, findings: [] });
  });

  test("detects a session template copied from an accepted earlier assignment", () => {
    const input = validInput();
    const historical = structuredClone(input.bundle.sessionEnrichments[0]!);
    historical.sessionId = "session:historical";
    input.requestAcceptedDrafts = [{
      assignmentId: "assignment:historical", draftRevision: 2, evidenceRevision: "revision:historical",
      draft: { bundleVersion: "workbench-authoring-v4", assignmentId: "assignment:historical", evidenceRevision: "revision:historical", sessionEnrichments: [historical], opportunityDispositions: [], artifacts: [] }
    }];
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
      code: "duplicate_session_template",
      message: "Session enrichment duplicates a prior request session template.",
      severity: "error",
      path: "/sessionEnrichments/0/enrichment",
      sessionId: "session:a"
    }]);
  });

  test("emits exact missing, wrong, and reused artifact-link identities", () => {
    const wrong = validAdrInput();
    wrong.bundle.opportunityDispositions[0]!.artifactKind = "runbook";
    expect(validateGuidedAuthoringDraft(wrong).findings).toEqual([{
      code: "invalid_opportunity_artifact_link",
      message: "Disposition artifact kind does not match its resolution semantics and linked draft.",
      severity: "error",
      path: "/opportunityDispositions/0/artifactKind",
      opportunityId: "opportunity:a",
      artifactDraftId: "draft:adr"
    }]);

    const reused = validAdrInput();
    reused.assignment.opportunityIds.push("opportunity:b");
    reused.opportunities.push({ ...reused.opportunities[0]!, opportunityId: "opportunity:b" });
    reused.bundle.opportunityDispositions.push({ ...reused.bundle.opportunityDispositions[0]!, opportunityId: "opportunity:b" });
    expect(validateGuidedAuthoringDraft(reused).findings).toEqual([{
      code: "invalid_opportunity_artifact_link",
      message: "Disposition must link exactly one submitted artifact draft.",
      severity: "error",
      path: "/opportunityDispositions/1/artifactDraftId",
      opportunityId: "opportunity:b",
      artifactDraftId: "draft:adr"
    }]);
  });

  test("emits each linked-artifact provenance pointer exactly", () => {
    const cases: Array<[string, (input: GuidedAuthoringValidationInput) => void, string, string]> = [
      ["seed", (input) => { input.bundle.artifacts[0]!.seedSessionId = "session:foreign"; }, "/artifacts/0/seedSessionId", "Linked artifact seed must be an assignment provenance member."],
      ["envelope", (input) => { input.bundle.artifacts[0]!.provenanceSessionIds.push("session:foreign"); }, "/artifacts/0/provenanceSessionIds", "Linked artifact provenance must include the persisted opportunity provenance within the assignment."],
      ["output", (input) => { input.bundle.artifacts[0]!.output.provenanceSessionIds = []; }, "/artifacts/0/output/provenanceSessionIds", "Artifact envelope and output provenance must match exactly."]
    ];
    for (const [_name, mutate, path, message] of cases) {
      const input = validAdrInput();
      mutate(input);
      const artifact = input.bundle.artifacts[0]!;
      expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
        code: "invalid_opportunity_artifact_link",
        message,
        severity: "error",
        path,
        sessionId: artifact.seedSessionId,
        opportunityId: "opportunity:a",
        artifactDraftId: "draft:adr",
        artifactKind: "adr"
      }]);
    }
  });

  test("distinguishes a linked seed outside the assignment from a seed omitted by envelope provenance", () => {
    const outside = validAdrInput();
    outside.bundle.artifacts[0]!.seedSessionId = "session:foreign";
    expect(validateGuidedAuthoringDraft(outside).findings).toEqual([{
      code: "invalid_opportunity_artifact_link",
      message: "Linked artifact seed must be an assignment provenance member.",
      severity: "error",
      path: "/artifacts/0/seedSessionId",
      sessionId: "session:foreign",
      opportunityId: "opportunity:a",
      artifactDraftId: "draft:adr",
      artifactKind: "adr"
    }]);

    const omitted = isolatedTwoSessionAdrLink({ seedSessionId: "session:a", artifactProvenance: ["session:b"], opportunityProvenance: ["session:b"] });
    expect(validateGuidedAuthoringDraft(omitted).findings).toEqual([{
      code: "invalid_opportunity_artifact_link",
      message: "Linked artifact seed must be an assignment provenance member.",
      severity: "error",
      path: "/artifacts/0/seedSessionId",
      sessionId: "session:a",
      opportunityId: "opportunity:b",
      artifactDraftId: "draft:isolated",
      artifactKind: "adr"
    }]);
  });

  test("distinguishes outside-assignment envelope provenance from omitted required opportunity provenance", () => {
    const outside = validAdrInput();
    outside.bundle.artifacts[0]!.provenanceSessionIds.push("session:foreign");
    outside.bundle.artifacts[0]!.output.provenanceSessionIds = ["session:a", "session:foreign"];
    expect(validateGuidedAuthoringDraft(outside).findings).toEqual([{
      code: "invalid_opportunity_artifact_link",
      message: "Linked artifact provenance must include the persisted opportunity provenance within the assignment.",
      severity: "error",
      path: "/artifacts/0/provenanceSessionIds",
      sessionId: "session:a",
      opportunityId: "opportunity:a",
      artifactDraftId: "draft:adr",
      artifactKind: "adr"
    }]);

    const omitted = isolatedTwoSessionAdrLink({ seedSessionId: "session:a", artifactProvenance: ["session:a"], opportunityProvenance: ["session:a", "session:b"] });
    expect(validateGuidedAuthoringDraft(omitted).findings).toEqual([{
      code: "invalid_opportunity_artifact_link",
      message: "Linked artifact provenance must include the persisted opportunity provenance within the assignment.",
      severity: "error",
      path: "/artifacts/0/provenanceSessionIds",
      sessionId: "session:a",
      opportunityId: "opportunity:b",
      artifactDraftId: "draft:isolated",
      artifactKind: "adr"
    }]);
  });

  test("distinguishes an opportunity-listed ref with a foreign owner from a ref absent from the opportunity", () => {
    const foreignOwner = validAdrInput();
    foreignOwner.opportunities[0]!.evidenceRefs = ["evidence:opportunity"];
    foreignOwner.bundle.opportunityDispositions[0]!.evidenceRefs = ["evidence:opportunity"];
    foreignOwner.evidenceByRef = new Map(foreignOwner.evidenceByRef).set("evidence:opportunity", evidence("session:foreign", "Foreign owner evidence is listed but outside persisted opportunity provenance."));
    expect(validateGuidedAuthoringDraft(foreignOwner).findings).toEqual([{
      code: "invalid_opportunity_evidence",
      message: "Disposition evidence must belong to the persisted opportunity.",
      severity: "error",
      path: "/opportunityDispositions/0/evidenceRefs/0",
      opportunityId: "opportunity:a",
      artifactDraftId: "draft:adr"
    }]);

    const absent = validAdrInput();
    absent.bundle.opportunityDispositions[0]!.evidenceRefs = ["evidence:absent-from-opportunity"];
    absent.evidenceByRef = new Map(absent.evidenceByRef).set("evidence:absent-from-opportunity", evidence("session:a", "Session-owned evidence is absent from the persisted opportunity evidence set."));
    expect(validateGuidedAuthoringDraft(absent).findings).toEqual([{
      code: "invalid_opportunity_evidence",
      message: "Disposition evidence must belong to the persisted opportunity.",
      severity: "error",
      path: "/opportunityDispositions/0/evidenceRefs/0",
      opportunityId: "opportunity:a",
      artifactDraftId: "draft:adr"
    }]);
  });

  test("rejects missing, cyclic, and dismissal-terminal merges", () => {
    const missing = opportunityInput();
    missing.bundle.opportunityDispositions = [{ opportunityId: "opportunity:a", disposition: "merged", rationale: "Merge the supported procedure evidence into the related target.", evidenceRefs: ["evidence:a"], mergedIntoOpportunityId: "opportunity:missing" }];
    expect(validateGuidedAuthoringDraft(missing).findings).toEqual([{
      code: "invalid_opportunity_merge",
      message: "Merged opportunity must terminate at one artifact with complete union provenance.",
      severity: "error",
      path: "/opportunityDispositions/0/mergedIntoOpportunityId",
      opportunityId: "opportunity:a"
    }]);

    const cycle = opportunityInput();
    cycle.assignment.opportunityIds.push("opportunity:b");
    cycle.opportunities.push({ ...cycle.opportunities[0]!, opportunityId: "opportunity:b" });
    cycle.bundle.opportunityDispositions = [
      { opportunityId: "opportunity:a", disposition: "merged", rationale: "Merge supported procedure evidence into opportunity B.", evidenceRefs: ["evidence:a"], mergedIntoOpportunityId: "opportunity:b" },
      { opportunityId: "opportunity:b", disposition: "merged", rationale: "Merge supported procedure evidence into opportunity A.", evidenceRefs: ["evidence:a"], mergedIntoOpportunityId: "opportunity:a" }
    ];
    expect(validateGuidedAuthoringDraft(cycle).findings).toEqual([
      { code: "invalid_opportunity_merge", message: "Merged opportunity must terminate at one artifact with complete union provenance.", severity: "error", path: "/opportunityDispositions/0/mergedIntoOpportunityId", opportunityId: "opportunity:a" },
      { code: "invalid_opportunity_merge", message: "Merged opportunity must terminate at one artifact with complete union provenance.", severity: "error", path: "/opportunityDispositions/1/mergedIntoOpportunityId", opportunityId: "opportunity:b" }
    ]);

    const dismissed = opportunityInput();
    dismissed.assignment.opportunityIds.push("opportunity:b");
    dismissed.opportunities.push({ ...dismissed.opportunities[0]!, opportunityId: "opportunity:b" });
    dismissed.bundle.opportunityDispositions = [
      { opportunityId: "opportunity:a", disposition: "merged", rationale: "Merge supported procedure evidence into the related judgment.", evidenceRefs: ["evidence:a"], mergedIntoOpportunityId: "opportunity:b" },
      { opportunityId: "opportunity:b", disposition: "dismissed", rationale: "The recovery procedure lacks repeatable operational steps and rollback verification evidence.", evidenceRefs: ["evidence:a"] }
    ];
    expect(validateGuidedAuthoringDraft(dismissed).findings).toEqual([{
      code: "invalid_opportunity_merge",
      message: "Merged opportunity must terminate at one artifact with complete union provenance.",
      severity: "error",
      path: "/opportunityDispositions/0/mergedIntoOpportunityId",
      opportunityId: "opportunity:a"
    }]);
  });

  test("rejects a merge whose terminal artifact omits merged opportunity provenance", () => {
    const input = twoSessionDistinctInput();
    input.assignment.opportunityIds = ["opportunity:a", "opportunity:b"];
    input.opportunities = [
      { opportunityId: "opportunity:a", suggestedKind: "adr", signalStrength: "high", summary: "Decision evidence from session A.", evidenceRefs: ["evidence:a"], provenanceSessionIds: ["session:a"] },
      { opportunityId: "opportunity:b", suggestedKind: "adr", signalStrength: "high", summary: "Decision evidence from session B.", evidenceRefs: ["evidence:b"], provenanceSessionIds: ["session:b"] }
    ];
    const artifact = structuredClone(validAdrInput().bundle.artifacts[0]!);
    artifact.draftId = "draft:b";
    artifact.seedSessionId = "session:b";
    artifact.provenanceSessionIds = ["session:b"];
    artifact.output.provenanceSessionIds = ["session:b"];
    (artifact.output.claimSupport as WorkbenchClaimSupport[]).forEach((support) => {
      support.evidenceRef = "evidence:b";
      support.excerpt = "Recover database migration index collision after the failed retry.";
    });
    input.bundle.artifacts = [artifact];
    input.bundle.opportunityDispositions = [
      { opportunityId: "opportunity:a", disposition: "merged", rationale: "Merge decision evidence into the related terminal decision.", evidenceRefs: ["evidence:a"], mergedIntoOpportunityId: "opportunity:b" },
      { opportunityId: "opportunity:b", disposition: "authored", rationale: "Author the durable decision from the persisted evidence.", evidenceRefs: ["evidence:b"], artifactDraftId: "draft:b", artifactKind: "adr" }
    ];
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
      code: "invalid_opportunity_merge",
      message: "Merged opportunity must terminate at one artifact with complete union provenance.",
      severity: "error",
      path: "/opportunityDispositions/0/mergedIntoOpportunityId",
      opportunityId: "opportunity:a"
    }]);
  });

  test("orders and identifies duplicate submitted artifact content", () => {
    const input = validAdrInput();
    input.assignment.opportunityIds.push("opportunity:b");
    input.opportunities.push({ ...input.opportunities[0]!, opportunityId: "opportunity:b" });
    const second = structuredClone(input.bundle.artifacts[0]!);
    second.draftId = "draft:adr:b";
    input.bundle.artifacts.push(second);
    input.bundle.opportunityDispositions.push({ ...input.bundle.opportunityDispositions[0]!, opportunityId: "opportunity:b", artifactDraftId: "draft:adr:b" });
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
      code: "duplicate_artifact_content",
      message: "Optional artifact duplicates substantive content from another request draft.",
      severity: "error",
      path: "/artifacts/1/output",
      sessionId: "session:a",
      artifactDraftId: "draft:adr:b",
      artifactKind: "adr"
    }]);
  });

  test.each([
    ["unsupported_claim_excerpt", "unsupported_claim_excerpt"],
    ["missing_claim_support", "missing_claim_support"],
    ["missing_required_support_kind", "missing_required_support_kind"],
    ["missing_root_cause_support", "missing_root_cause_support"],
    ["invalid_support_kind_evidence", "invalid_support_kind_evidence"],
    ["invalid_timeline_order", "invalid_timeline_order"],
    ["invalid_timeline_support", "invalid_timeline_support"],
    ["unsupported_authoring_protocol_language", "protocol_leakage"],
    ["authoring_protocol_leakage", "protocol_leakage"],
    ["duplicate_human_content", "duplicate_artifact_content"]
  ] as const)("maps artifact quality %s with exact source and missing-source pointers", (sourceCode, guidedCode) => {
    const artifact = validAdrInput().bundle.artifacts[0]!;
    for (const [path, expectedPath] of [["field[0].value", "/artifacts/2/output/field/0/value"], [undefined, "/artifacts/2/output"]] as const) {
      expect(mapGuidedArtifactQualityFinding({
        artifact,
        artifactOrdinal: 2,
        finding: { code: sourceCode, message: "Synthetic artifact quality finding.", ...(path ? { path } : {}) }
      })).toEqual({
        code: guidedCode,
        message: "Synthetic artifact quality finding.",
        severity: "error",
        path: expectedPath,
        sessionId: "session:a",
        artifactDraftId: "draft:adr",
        artifactKind: "adr"
      });
    }
  });

  test.each([
    ["runbook", "The operational procedure lacks repeatable steps, trigger conditions, and rollback verification evidence."],
    ["adr", "The evidence records no durable decision, alternative tradeoff, consequence, or reversal condition."],
    ["incident_timeline", "The evidence contains no incident impact, timeline, root cause, remediation, or recovery event."]
  ] as const)("accepts a specific evidence-backed %s dismissal rationale", (kind, rationale) => {
    const input = validInput();
    input.assignment.opportunityIds = ["opportunity:a"];
    input.opportunities = [{ opportunityId: "opportunity:a", suggestedKind: kind, signalStrength: "medium", summary: rationale, evidenceRefs: ["evidence:a"], provenanceSessionIds: ["session:a"] }];
    input.bundle.opportunityDispositions = [{ opportunityId: "opportunity:a", disposition: "dismissed", rationale, evidenceRefs: ["evidence:a"] }];
    input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:a", evidence("session:a", `${input.evidenceByRef.get("evidence:a")!.text} ${rationale}`));
    expect(validateGuidedAuthoringDraft(input)).toEqual({ accepted: true, findings: [] });
  });

  test("rejects daemon scaffold sentinels in artifact metadata and an authored disposition", () => {
    const input = validAdrInput();
    input.bundle.opportunityDispositions[0]!.rationale = "REPLACE_WITH_EVIDENCE_BACKED_DISPOSITION_RATIONALE";
    input.bundle.artifacts[0]!.output.title = "REPLACE_WITH_SPECIFIC_ARTIFACT_TITLE";
    input.bundle.artifacts[0]!.output.missingEvidence = ["REPLACE_WITH_ANY_MISSING_EVIDENCE_BOUNDARY"];

    expect(validateGuidedAuthoringDraft(input).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "unsupported_opportunity_dismissal",
        path: "/opportunityDispositions/0/rationale",
        opportunityId: "opportunity:a"
      }),
      expect.objectContaining({
        code: "artifact_requires_raw_evidence",
        path: "/artifacts/0/output/title",
        artifactDraftId: "draft:adr"
      }),
      expect.objectContaining({
        code: "artifact_requires_raw_evidence",
        path: "/artifacts/0/output/missingEvidence/0",
        artifactDraftId: "draft:adr"
      })
    ]));
  });

  test("rejects dismissing a high-signal incident opportunity whose two trusted evidence refs supply every reuse axis", () => {
    const input = validInput();
    input.assignment.opportunityIds = ["opportunity:incident"];
    input.opportunities = [{
      opportunityId: "opportunity:incident",
      suggestedKind: "incident_timeline",
      signalStrength: "high",
      summary: "A stale writer lease incident has impact, cause, remediation, and verified recovery evidence.",
      evidenceRefs: ["incident:diagnosis", "incident:recovery"],
      provenanceSessionIds: ["session:a"]
    }];
    input.evidenceByRef = new Map(input.evidenceByRef)
      .set("incident:diagnosis", evidence("session:a", "Publishing was blocked and all daemon writes were unavailable; investigation identified a stale writer lease owned by the prior daemon process."))
      .set("incident:recovery", evidence("session:a", "Cleared the stale writer lease, restarted the daemon writer process, database integrity passed, writer health recovered, and publication succeeded exactly once."));
    input.bundle.opportunityDispositions = [{
      opportunityId: "opportunity:incident",
      disposition: "dismissed",
      rationale: "The incident evidence supposedly lacks a reusable recovery timeline and verified remediation boundary.",
      evidenceRefs: ["incident:diagnosis"]
    }];

    expect(validateGuidedAuthoringDraft(input).findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "unsupported_opportunity_dismissal",
        path: "/opportunityDispositions/0/rationale",
        opportunityId: "opportunity:incident"
      })
    ]));
  });

  test("requires rubric support to be grounded in artifact provenance", () => {
    const input = validAdrInput();
    const artifact = input.bundle.artifacts[0]!;
    const supports = artifact.output.claimSupport as Array<Record<string, unknown>>;
    supports.find(({ path }) => path === "context")!.evidenceRef = "evidence:foreign";
    input.evidenceByRef = new Map(input.evidenceByRef).set(
      "evidence:foreign",
      evidence("session:foreign", input.evidenceByRef.get("evidence:a")!.text)
    );
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([
      {
        code: "incomplete_artifact_rubric",
        message: "Guided adr draft is missing the context reuse axis.",
        severity: "error",
        path: "/artifacts/0/output/context",
        sessionId: "session:a",
        artifactDraftId: "draft:adr",
        artifactKind: "adr"
      },
      {
        code: "invalid_support_kind_evidence",
        message: "problem support is not backed by the required canonical evidence class.",
        severity: "error",
        path: "/artifacts/0/output/context",
        sessionId: "session:a",
        artifactDraftId: "draft:adr",
        artifactKind: "adr"
      }
    ]);
  });

  test("keeps runbook expected results distinct from positive verification", () => {
    const input = validRunbookInput();
    const verification = input.evidenceByRef.get("evidence:verify")!;
    input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:artifact-verify", {
      ...verification, status: "failed", exitCode: 1
    });
    const artifactVerification = (input.bundle.artifacts[0]!.output.claimSupport as WorkbenchClaimSupport[])
      .find(({ path }) => path === "validationChecks[0]")!;
    artifactVerification.evidenceRef = "evidence:artifact-verify";
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([
      { code: "incomplete_artifact_rubric", message: "Guided runbook draft is missing the verification reuse axis.", severity: "error", path: "/artifacts/0/output/validationChecks", sessionId: "session:a", artifactDraftId: "draft:runbook", artifactKind: "runbook" },
      { code: "invalid_support_kind_evidence", message: "verification support is not backed by the required canonical evidence class.", severity: "error", path: "/artifacts/0/output/validationChecks/0", sessionId: "session:a", artifactDraftId: "draft:runbook", artifactKind: "runbook" }
    ]);
  });

  test("allows a bare file effect to support changedFiles but not runbook performed steps", () => {
    const input = validRunbookInput();
    const artifact = input.bundle.artifacts[0]!;
    artifact.output.changedFiles = ["auth/callback.ts"];
    input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:file", {
      ...evidence("session:a", "auth/callback.ts\nunstaged"),
      kind: "file_effect",
      label: "modified",
      role: "tool"
    });
    const supports = artifact.output.claimSupport as Array<ReturnType<typeof artifactSupport>>;
    supports.find(({ path }) => path === "fixSteps[0]")!.evidenceRef = "evidence:file";
    supports.find(({ path }) => path === "fixSteps[0]")!.excerpt = "auth/callback.ts\nunstaged";
    supports.push({
      ...artifactSupport("changedFiles[0]", "change", "auth/callback.ts\nunstaged"),
      evidenceRef: "evidence:file"
    });

    const findings = validateGuidedAuthoringDraft(input).findings;

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "incomplete_artifact_rubric",
        path: "/artifacts/0/output/fixSteps"
      }),
      expect.objectContaining({
        code: "invalid_support_kind_evidence",
        path: "/artifacts/0/output/fixSteps/0"
      })
    ]));
    expect(findings.some(({ path }) => path?.includes("changedFiles"))).toBe(false);
  });

  test("requires a runbook fix step to preserve every essential action clause in its cited evidence", () => {
    const input = validRunbookInput();
    const artifact = input.bundle.artifacts[0]!;
    const performed = [
      "Cleared the stale nonce in auth/callback.ts",
      "bound a replacement to the pending authorization request",
      "retried callback validation"
    ].join(", ");
    input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:change", {
      ...evidence("session:a", performed),
      role: "assistant"
    });
    artifact.output.fixSteps = [
      "Modify auth/callback.ts to replace the stale nonce before retrying callback validation."
    ];
    const fixSupport = (artifact.output.claimSupport as Array<ReturnType<typeof artifactSupport>>)
      .find(({ path }) => path === "fixSteps[0]")!;
    fixSupport.excerpt = "Cleared the stale nonce in auth/callback.ts";

    expect(validateGuidedAuthoringDraft(input).findings).toContainEqual({
      code: "incomplete_artifact_rubric",
      message: "Guided runbook fix step omits an essential performed-action clause from its cited evidence: bound a replacement to the pending authorization request.",
      severity: "error",
      path: "/artifacts/0/output/fixSteps/0",
      sessionId: "session:a",
      artifactDraftId: "draft:runbook",
      artifactKind: "runbook"
    });
  });

  test("accepts a runbook fix step that preserves every essential action clause", () => {
    const input = validRunbookInput();
    const artifact = input.bundle.artifacts[0]!;
    const performed = [
      "Cleared the stale nonce in auth/callback.ts",
      "bound a replacement to the pending authorization request",
      "retried callback validation"
    ].join(", ");
    input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:change", {
      ...evidence("session:a", performed),
      role: "assistant"
    });
    artifact.output.fixSteps = [
      "Clear the stale nonce in auth/callback.ts, bind its replacement to the pending authorization request, and retry callback validation."
    ];
    const fixSupport = (artifact.output.claimSupport as Array<ReturnType<typeof artifactSupport>>)
      .find(({ path }) => path === "fixSteps[0]")!;
    fixSupport.excerpt = performed;

    expect(validateGuidedAuthoringDraft(input)).toEqual({ accepted: true, findings: [] });
  });

  test("scans runbook root cause placeholders but ignores structural refs", () => {
    const input = validRunbookInput();
    const output = input.bundle.artifacts[0]!.output;
    output.rootCause = "See transcript for the root cause.";
    output.evidenceRefs = ["TBD"];
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
        code: "artifact_requires_raw_evidence",
        message: "Required artifact field contains a raw-evidence placeholder and is not independently reusable.",
        severity: "error",
        path: "/artifacts/0/output/rootCause",
        sessionId: "session:a",
        artifactDraftId: "draft:runbook",
        artifactKind: "runbook"
      }, {
        code: "missing_claim_support",
        message: "Populated claim-bearing field requires canonical claim support: rootCause.",
        severity: "error",
        path: "/artifacts/0/output/rootCause",
        sessionId: "session:a",
        artifactDraftId: "draft:runbook",
        artifactKind: "runbook"
      }, {
        code: "missing_root_cause_support",
        message: "A causal root-cause assertion requires direct root_cause support; otherwise state that root cause is unknown.",
        severity: "error",
        path: "/artifacts/0/output/rootCause",
        sessionId: "session:a",
        artifactDraftId: "draft:runbook",
        artifactKind: "runbook"
      }]);
  });

  test.each(["runbook", "incident_timeline"] as const)(
    "requires %s to preserve direct canonical root-cause evidence instead of retreating to unknown",
    (kind) => {
      const input = kind === "runbook" ? validRunbookInput() : validIncidentInput();
      const artifact = input.bundle.artifacts[0]!;
      const directCause = "OAuth callback validation failed because the stored state nonce was stale.";
      input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:direct-cause", {
        ...evidence("session:a", directCause),
        kind: "tool_result",
        role: "tool"
      });
      input.opportunities[0]!.evidenceRefs.push("evidence:direct-cause");
      artifact.output.rootCause = "The root cause remains unknown from the available canonical evidence.";
      artifact.output.claimSupport = (artifact.output.claimSupport as WorkbenchClaimSupport[])
        .filter(({ path }) => path !== "rootCause");

      expect(validateGuidedAuthoringDraft(input).findings).toContainEqual({
        code: "missing_root_cause_support",
        message: "Direct canonical evidence establishes a root cause for this opportunity. Preserve the causal statement in rootCause and cite it with root_cause claim support; fix an invalid supportKind instead of deleting the supported field or replacing it with unknown.",
        severity: "error",
        path: "/artifacts/0/output/rootCause",
        sessionId: "session:a",
        artifactDraftId: kind === "runbook" ? "draft:runbook" : "draft:incident",
        artifactKind: kind
      });

      artifact.output.rootCause = "OAuth callback validation failed because the stored state nonce was stale.";
      (artifact.output.claimSupport as WorkbenchClaimSupport[]).push({
        evidenceRef: "evidence:direct-cause",
        excerpt: directCause,
        path: "rootCause",
        supportKind: "root_cause"
      });
      expect(validateGuidedAuthoringDraft(input)).toEqual({ accepted: true, findings: [] });
    }
  );

  test("allows explicit unknown root cause when canonical evidence records correlation without causality", () => {
    const input = validRunbookInput();
    const ambiguous = "Callback validation failed while the stored nonce was stale, but canonical evidence did not establish causality.";
    input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:ambiguous-cause", {
      ...evidence("session:a", ambiguous),
      role: "assistant"
    });
    input.opportunities[0]!.evidenceRefs.push("evidence:ambiguous-cause");

    expect(validateGuidedAuthoringDraft(input)).toEqual({ accepted: true, findings: [] });
  });

  test("keeps the direct-cause finding after an invalid support kind is removed with the field", () => {
    const input = validRunbookInput();
    const artifact = input.bundle.artifacts[0]!;
    const directCause = "OAuth callback validation failed because the stored state nonce was stale.";
    input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:direct-cause", {
      ...evidence("session:a", directCause),
      role: "assistant"
    });
    input.opportunities[0]!.evidenceRefs.push("evidence:direct-cause");
    delete artifact.output.rootCause;
    artifact.output.claimSupport = (artifact.output.claimSupport as WorkbenchClaimSupport[])
      .filter(({ path }) => path !== "rootCause");

    expect(validateGuidedAuthoringDraft(input).findings).toContainEqual(expect.objectContaining({
      code: "missing_root_cause_support",
      message: expect.stringContaining("fix an invalid supportKind instead of deleting the supported field"),
      path: "/artifacts/0/output/rootCause"
    }));
  });

  test("rejects a conditional rollback rule copied into runbook dead ends", () => {
    const input = validRunbookInput();
    const artifact = input.bundle.artifacts[0]!;
    const rollback = "If the replacement nonce can be replayed, restore the previous callback handler and stop.";
    input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:rollback-rule", {
      ...evidence("session:a", rollback),
      role: "assistant"
    });
    artifact.output.deadEnds = [rollback];
    (artifact.output.claimSupport as WorkbenchClaimSupport[]).push({
      evidenceRef: "evidence:rollback-rule",
      excerpt: rollback,
      path: "deadEnds[0]",
      supportKind: "problem"
    });

    expect(validateGuidedAuthoringDraft(input).findings).toContainEqual({
      code: "incomplete_artifact_rubric",
      message: "Runbook deadEnds must record an approach that canonical evidence says was actually attempted and failed or abandoned. Move conditional rollback or failure handling to risksOrGaps and remove the duplicate deadEnds entry.",
      severity: "error",
      path: "/artifacts/0/output/deadEnds/0",
      sessionId: "session:a",
      artifactDraftId: "draft:runbook",
      artifactKind: "runbook"
    });
  });

  test("accepts a runbook dead end backed by an approach that was attempted and abandoned", () => {
    const input = validRunbookInput();
    const artifact = input.bundle.artifacts[0]!;
    const failedAttempt = "Tried restarting the callback handler, but it failed again and was abandoned.";
    input.evidenceByRef = new Map(input.evidenceByRef).set("evidence:failed-attempt", {
      ...evidence("session:a", failedAttempt),
      role: "assistant"
    });
    artifact.output.deadEnds = ["Restarting the callback handler failed again and was abandoned."];
    (artifact.output.claimSupport as WorkbenchClaimSupport[]).push({
      evidenceRef: "evidence:failed-attempt",
      excerpt: failedAttempt,
      path: "deadEnds[0]",
      supportKind: "problem"
    });

    expect(validateGuidedAuthoringDraft(input)).toEqual({ accepted: true, findings: [] });
  });

  test("enforces incident chronology, explicit unknown root cause, and terminal recovery", () => {
    expect(validateGuidedAuthoringDraft(validIncidentInput())).toEqual({ accepted: true, findings: [] });
    const input = validIncidentInput();
    const output = input.bundle.artifacts[0]!.output;
    output.timeline = [{ ...(output.timeline as Array<Record<string, unknown>>)[0], at: "not-a-time" }];
    output.rootCause = "Maybe something in the database.";
    output.status = "complete";
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([
      { code: "incomplete_artifact_rubric", message: "Guided incident_timeline draft is missing the root cause reuse axis.", severity: "error", path: "/artifacts/0/output/rootCause", sessionId: "session:a", artifactDraftId: "draft:incident", artifactKind: "incident_timeline" },
      { code: "missing_claim_support", message: "Populated claim-bearing field requires canonical claim support: rootCause.", severity: "error", path: "/artifacts/0/output/rootCause", sessionId: "session:a", artifactDraftId: "draft:incident", artifactKind: "incident_timeline" },
      { code: "missing_root_cause_support", message: "A causal root-cause assertion requires direct root_cause support; otherwise state that root cause is unknown.", severity: "error", path: "/artifacts/0/output/rootCause", sessionId: "session:a", artifactDraftId: "draft:incident", artifactKind: "incident_timeline" },
      { code: "incomplete_artifact_rubric", message: "Keep this supported incident timeline. Set status to recovered, resolved, or closed, then support status with the exact canonical recovery checkpoint that records passed, recovered, restored, or exactly-once verification; do not delete the artifact or dismiss its opportunity to escape this finding.", severity: "error", path: "/artifacts/0/output/status", sessionId: "session:a", artifactDraftId: "draft:incident", artifactKind: "incident_timeline" },
      { code: "incomplete_artifact_rubric", message: "Guided incident_timeline draft is missing the ordered events reuse axis.", severity: "error", path: "/artifacts/0/output/timeline", sessionId: "session:a", artifactDraftId: "draft:incident", artifactKind: "incident_timeline" },
      { code: "invalid_timeline_order", message: "Incident timeline entries must have valid timestamps in chronological order.", severity: "error", path: "/artifacts/0/output/timeline/0/at", sessionId: "session:a", artifactDraftId: "draft:incident", artifactKind: "incident_timeline" }
    ]);
  });

  test.each(rubricIdentityCases())("emits exact guided rubric leaf identity: $name", ({ input, expected }) => {
    expect(validateGuidedAuthoringDraft(input()).findings).toEqual(expected);
  });

  test("orders scrambled finding families by the declared total comparator", () => {
    const input = validInput();
    input.bundle.assignmentId = "assignment:wrong";
    input.bundle.evidenceRevision = "revision:wrong";
    input.coverage[0]!.complete = false;
    input.bundle.sessionEnrichments.push({
      ...structuredClone(input.bundle.sessionEnrichments[0]!),
      sessionId: "session:unexpected"
    });
    input.assignment.opportunityIds = ["opportunity:missing"];
    input.opportunities = [{
      opportunityId: "opportunity:missing", suggestedKind: "adr", signalStrength: "high",
      summary: "A durable decision requires alternatives and consequences.",
      evidenceRefs: ["evidence:a"], provenanceSessionIds: ["session:a"]
    }];
    input.bundle.artifacts = [{
      draftId: "draft:unlinked", kind: "adr", seedSessionId: "session:a",
      provenanceSessionIds: ["session:a"], output: { provenanceSessionIds: ["session:a"] }
    }];
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([
      { code: "guided_assignment_mismatch", message: "Bundle assignment does not match the trusted assignment.", severity: "error", path: "/assignmentId" },
      { code: "guided_evidence_revision_mismatch", message: "Bundle evidence revision does not match the assignment evidence revision.", severity: "error", path: "/evidenceRevision" },
      { code: "incomplete_evidence_inspection", message: "Assignment session evidence inspection is incomplete or stale.", severity: "error", path: "/sessionEnrichments/0", sessionId: "session:a" },
      { code: "unexpected_session_enrichment", message: "Submitted session enrichment is outside the assignment.", severity: "error", path: "/sessionEnrichments/1", sessionId: "session:unexpected" },
      { code: "unexpected_artifact_draft", message: "Submitted artifact draft is not linked by exactly one opportunity disposition.", severity: "error", path: "/artifacts/0", sessionId: "session:a", artifactDraftId: "draft:unlinked", artifactKind: "adr" },
      { code: "missing_opportunity_disposition", message: "Persisted opportunity is missing its disposition.", severity: "error", path: "/opportunityDispositions/0", opportunityId: "opportunity:missing" }
    ]);
  });

  test("chooses the duplicate loser by assignment order when bundle order is scrambled", () => {
    const input = duplicateSessionInput();
    input.bundle.sessionEnrichments.reverse();
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([{
      code: "duplicate_session_template",
      message: "Session enrichment duplicates a prior request session template.",
      severity: "error",
      path: "/sessionEnrichments/0/enrichment",
      sessionId: "session:b"
    }]);
  });

  test("orders artifact findings by seed assignment session before submitted artifact index", () => {
    const input = duplicateSessionInput();
    input.bundle.artifacts = [
      { draftId: "draft:b", kind: "adr", seedSessionId: "session:b", provenanceSessionIds: ["session:b"], output: {} },
      { draftId: "draft:a", kind: "adr", seedSessionId: "session:a", provenanceSessionIds: ["session:a"], output: {} }
    ];
    expect(validateGuidedAuthoringDraft(input).findings).toEqual([
      {
        code: "duplicate_session_template",
        message: "Session enrichment duplicates a prior request session template.",
        severity: "error",
        path: "/sessionEnrichments/1/enrichment",
        sessionId: "session:b"
      },
      {
        code: "unexpected_artifact_draft",
        message: "Submitted artifact draft is not linked by exactly one opportunity disposition.",
        severity: "error",
        path: "/artifacts/1",
        sessionId: "session:a",
        artifactDraftId: "draft:a",
        artifactKind: "adr"
      },
      {
        code: "unexpected_artifact_draft",
        message: "Submitted artifact draft is not linked by exactly one opportunity disposition.",
        severity: "error",
        path: "/artifacts/0",
        sessionId: "session:b",
        artifactDraftId: "draft:b",
        artifactKind: "adr"
      },
      {
        code: "duplicate_artifact_content",
        message: "Optional artifact duplicates substantive content from another request draft.",
        severity: "error",
        path: "/artifacts/1/output",
        sessionId: "session:a",
        artifactDraftId: "draft:a",
        artifactKind: "adr"
      }
    ]);
  });
});

function opportunityInput(): GuidedAuthoringValidationInput {
  const input = validInput();
  input.assignment.opportunityIds = ["opportunity:a"];
  input.opportunities = [{
    opportunityId: "opportunity:a",
    suggestedKind: "runbook",
    signalStrength: "high",
    summary: "Repeated recovery procedure needs verification and rollback guidance.",
    evidenceRefs: ["evidence:a"],
    provenanceSessionIds: ["session:a"]
  }];
  return input;
}

function duplicateSessionInput(): GuidedAuthoringValidationInput {
  const input = validInput();
  const second = structuredClone(input.bundle.sessionEnrichments[0]!);
  second.sessionId = "session:b";
  second.claimSupport.forEach((support) => {
    support.evidenceRef = support.evidenceRef === "evidence:result" ? "evidence:b:result" : "evidence:b";
  });
  second.enrichment.sessionTitle.evidenceRefs = [ref("evidence:b")];
  second.enrichment.sessionSummary.evidenceRefs = [ref("evidence:b:result")];
  second.enrichment.sessionDossier.evidenceRefs = [ref("evidence:b"), ref("evidence:b:result")];
  input.bundle.sessionEnrichments.push(second);
  input.assignment.sessionIds.push("session:b");
  input.canonicalDossiersBySession = new Map(input.canonicalDossiersBySession).set("session:b", {
    ...dossier(), identity: { ...dossier().identity, sessionId: "session:b" }
  } as SessionDossierDto);
  input.evidenceByRef = new Map(input.evidenceByRef)
    .set("evidence:b", evidence("session:b", input.evidenceByRef.get("evidence:a")!.text))
    .set("evidence:b:result", {
      ...evidence("session:b", input.evidenceByRef.get("evidence:result")!.text),
      role: "assistant"
    });
  input.coverage.push({ sessionId: "session:b", evidenceRevision: "revision:a", accessedItems: 1, totalItems: 1, complete: true });
  return input;
}

function twoSessionDistinctInput(): GuidedAuthoringValidationInput {
  const input = duplicateSessionInput();
  const second = input.bundle.sessionEnrichments.find(({ sessionId }) => sessionId === "session:b")!;
  second.enrichment.sessionTitle.text = "Recover database migration index collision";
  second.enrichment.sessionSummary.text = "Repaired a migration retry after an index collision; verification was not run.";
  second.enrichment.sessionDossier.purpose = "Repair a failed database migration after an index collision.";
  second.enrichment.sessionDossier.outcome = "The migration retry now handles the existing index safely.";
  const text = [
    "Recover database migration index collision after the failed retry.",
    "Repaired a migration retry after an index collision; verification was not run.",
    "Repair a failed database migration after an index collision.",
    "The migration retry now handles the existing index safely."
  ].join(" ");
  input.evidenceByRef = new Map(input.evidenceByRef)
    .set("evidence:b", evidence("session:b", text))
    .set("evidence:b:result", { ...evidence("session:b", text), role: "assistant" });
  second.claimSupport[0]!.excerpt = "Recover database migration index collision after the failed retry.";
  second.claimSupport[1]!.excerpt = "Repaired a migration retry after an index collision; verification was not run.";
  second.claimSupport[2]!.excerpt = "Repair a failed database migration after an index collision.";
  second.claimSupport[3]!.excerpt = "The migration retry now handles the existing index safely.";
  return input;
}

function isolatedTwoSessionAdrLink(options: {
  seedSessionId: string;
  artifactProvenance: string[];
  opportunityProvenance: string[];
}): GuidedAuthoringValidationInput {
  const input = twoSessionDistinctInput();
  const supportSessionId = options.artifactProvenance[0]!;
  const supportEvidenceRef = supportSessionId === "session:b" ? "evidence:b" : "evidence:a";
  const supportExcerpt = supportSessionId === "session:b"
    ? "Recover database migration index collision after the failed retry."
    : "Implemented a pure validator with stable field-specific quality findings; verification was not run.";
  const opportunitySessionId = options.opportunityProvenance[0]!;
  const opportunityEvidenceRef = opportunitySessionId === "session:b" ? "evidence:b" : "evidence:a";

  input.assignment.opportunityIds = ["opportunity:b"];
  input.opportunities = [{
    opportunityId: "opportunity:b",
    suggestedKind: "adr",
    signalStrength: "high",
    summary: "A durable decision records alternatives, consequences, and when to revisit the choice.",
    evidenceRefs: [opportunityEvidenceRef],
    provenanceSessionIds: options.opportunityProvenance
  }];
  input.bundle.opportunityDispositions = [{
    opportunityId: "opportunity:b",
    disposition: "authored",
    rationale: "The evidence supports a durable decision with alternatives and consequences.",
    evidenceRefs: [opportunityEvidenceRef],
    artifactDraftId: "draft:isolated",
    artifactKind: "adr"
  }];

  const artifact = structuredClone(validAdrInput().bundle.artifacts[0]!);
  artifact.draftId = "draft:isolated";
  artifact.seedSessionId = options.seedSessionId;
  artifact.provenanceSessionIds = options.artifactProvenance;
  const output = artifact.output as {
    provenanceSessionIds: string[];
    claimSupport: Array<{ evidenceRef: string; excerpt: string }>;
  };
  output.provenanceSessionIds = options.artifactProvenance;
  output.claimSupport.forEach((support) => {
    support.evidenceRef = supportEvidenceRef;
    support.excerpt = supportExcerpt;
  });
  input.bundle.artifacts = [artifact];
  return input;
}

function validAdrInput(): GuidedAuthoringValidationInput {
  const input = opportunityInput();
  input.opportunities[0] = {
    ...input.opportunities[0]!,
    suggestedKind: "adr",
    summary: "A durable decision records alternatives, consequences, and when to revisit the choice."
  };
  input.bundle.opportunityDispositions = [{
    opportunityId: "opportunity:a",
    disposition: "authored",
    rationale: "The evidence supports a durable decision with alternatives and consequences.",
    evidenceRefs: ["evidence:a"],
    artifactDraftId: "draft:adr",
    artifactKind: "adr"
  }];
  const excerpt = "Implemented a pure validator with stable field-specific quality findings; verification was not run.";
  input.bundle.artifacts = [{
    draftId: "draft:adr",
    kind: "adr",
    seedSessionId: "session:a",
    provenanceSessionIds: ["session:a"],
    output: {
      title: "Adopt pure guided authoring quality validation",
      context: "Bulk authoring required grounded, field-specific review findings.",
      decision: "Adopt one pure guided authoring quality validator.",
      status: "accepted",
      alternatives: ["Continue accepting deterministic session templates."],
      consequences: ["Revisit this decision if grounded review cannot remain deterministic."],
      provenanceSessionIds: ["session:a"],
      claimSupport: [
        artifactSupport("context", "problem", excerpt),
        artifactSupport("decision", "decision", excerpt),
        artifactSupport("status", "decision", excerpt),
        artifactSupport("alternatives[0]", "alternative", excerpt),
        artifactSupport("consequences[0]", "decision", excerpt)
      ]
    }
  }];
  return input;
}

function validRunbookInput(): GuidedAuthoringValidationInput {
  const input = opportunityInput();
  input.bundle.opportunityDispositions = [{
    opportunityId: "opportunity:a", disposition: "authored",
    rationale: "The evidence supports a reusable operational procedure with verification and rollback.",
    evidenceRefs: ["evidence:a"], artifactDraftId: "draft:runbook", artifactKind: "runbook"
  }];
  input.evidenceByRef = new Map(input.evidenceByRef)
    .set("evidence:change", { ...evidence("session:a", "modified the guided quality validator implementation safely"), role: "assistant" })
    .set("evidence:verify", { ...evidence("session:a", "Guided quality tests passed successfully with all checks verified."), kind: "tool_result", role: "assistant", toolName: "vitest", status: "succeeded", exitCode: 0 });
  markSessionVerificationPassed(input, "evidence:verify", "Guided quality tests passed successfully with all checks verified.");
  input.bundle.artifacts = [{
    draftId: "draft:runbook", kind: "runbook", seedSessionId: "session:a", provenanceSessionIds: ["session:a"],
    output: {
      title: "Validate guided authoring quality",
      problemSignature: { affectedScope: "Guided authoring draft quality review" },
      preconditions: ["A persisted guided assignment is ready for review."],
      fixSteps: ["Run the pure validator against the submitted assignment bundle."],
      validationChecks: ["Confirm the focused guided quality test suite passes."],
      risksOrGaps: ["On failure, rollback the draft and request a grounded revision."],
      rootCause: "The root cause remains unknown from the available canonical evidence.",
      provenanceSessionIds: ["session:a"],
      claimSupport: [
        artifactSupport("problemSignature.affectedScope", "problem", "User requested a focused repository quality validator for guided authoring."),
        artifactSupport("preconditions[0]", "problem", "User requested a focused repository quality validator for guided authoring."),
        { ...artifactSupport("fixSteps[0]", "change", "modified the guided quality validator implementation safely"), evidenceRef: "evidence:change" },
        { ...artifactSupport("validationChecks[0]", "verification", "Guided quality tests passed successfully with all checks verified."), evidenceRef: "evidence:verify" },
        artifactSupport("risksOrGaps[0]", "problem", "User requested a focused repository quality validator for guided authoring.")
      ]
    }
  }];
  return input;
}

function validIncidentInput(): GuidedAuthoringValidationInput {
  const input = opportunityInput();
  input.opportunities[0] = { ...input.opportunities[0]!, suggestedKind: "incident_timeline" };
  input.bundle.opportunityDispositions = [{
    opportunityId: "opportunity:a", disposition: "authored",
    rationale: "The evidence supports an incident timeline with remediation and recovery verification.",
    evidenceRefs: ["evidence:a"], artifactDraftId: "draft:incident", artifactKind: "incident_timeline"
  }];
  input.evidenceByRef = new Map(input.evidenceByRef)
    .set("evidence:timeline", { ...evidence("session:a", "Guided draft validation failed before the quality correction was applied."), observedAt: "2026-07-19T12:01:00.000Z" })
    .set("evidence:remediation", { ...evidence("session:a", "Implemented the grounded validator correction and reran the quality checks."), kind: "file_effect", role: "assistant", label: "modified" })
    .set("evidence:recovery", { ...evidence("session:a", "Guided incident recovery tests passed and verification succeeded."), kind: "tool_result", role: "assistant", toolName: "vitest", status: "succeeded", exitCode: 0 });
  markSessionVerificationPassed(input, "evidence:recovery", "Guided incident recovery tests passed and verification succeeded.");
  input.bundle.artifacts = [{
    draftId: "draft:incident", kind: "incident_timeline", seedSessionId: "session:a", provenanceSessionIds: ["session:a"],
    output: {
      title: "Guided authoring quality failure",
      symptom: "Guided drafts could pass without grounded rubric evidence.",
      impact: "Published knowledge could require reopening raw session evidence.",
      timeline: [{ at: "2026-07-19T12:01:00.000Z", summary: "Guided draft validation failed before correction.", evidenceRefs: ["evidence:timeline"] }],
      rootCause: "The root cause remains unknown from the available canonical evidence.",
      contributingFactors: ["Rubric checks trusted support shape without validating provenance."],
      remediation: ["Implemented grounded support checks for every guided rubric axis."],
      status: "recovered",
      provenanceSessionIds: ["session:a"],
      claimSupport: [
        artifactSupport("symptom", "problem", "User requested a focused repository quality validator for guided authoring."),
        artifactSupport("impact", "problem", "User requested a focused repository quality validator for guided authoring."),
        { ...artifactSupport("timeline[0].summary", "timeline", "Guided draft validation failed before the quality correction was applied."), evidenceRef: "evidence:timeline" },
        artifactSupport("contributingFactors[0]", "problem", "User requested a focused repository quality validator for guided authoring."),
        { ...artifactSupport("remediation[0]", "remediation", "Implemented the grounded validator correction and reran the quality checks."), evidenceRef: "evidence:remediation" },
        { ...artifactSupport("status", "verification", "Guided incident recovery tests passed and verification succeeded."), evidenceRef: "evidence:recovery" }
      ]
    }
  }];
  return input;
}

function rubricIdentityCases(): Array<{ name: string; input: () => GuidedAuthoringValidationInput; expected: Array<Record<string, unknown>> }> {
  const remove = (kind: "runbook" | "adr" | "incident_timeline", field: string, paths: string[]) => () => {
    const input = kind === "runbook" ? validRunbookInput() : kind === "adr" ? validAdrInput() : validIncidentInput();
    delete input.bundle.artifacts[0]!.output[field];
    const supports = input.bundle.artifacts[0]!.output.claimSupport as Array<{ path: string }>;
    input.bundle.artifacts[0]!.output.claimSupport = supports.filter((support) => !paths.some((path) => support.path === path || support.path.startsWith(`${path}[`) || support.path.startsWith(`${path}.`)));
    return input;
  };
  const expected = (kind: "runbook" | "adr" | "incident_timeline", draftId: string, path: string, ...axes: string[]) => axes.map((axis) => ({
    code: "incomplete_artifact_rubric",
    message: kind === "runbook" && axis === "failure or rollback handling"
      ? "Guided runbook draft needs failure handling. Add failure, fallback, recovery, revert, or rollback guidance in deadEnds, risksOrGaps, or preventionNotes, then support that exact field with a verbatim canonical evidence excerpt."
      : kind === "incident_timeline" && axis === "recovery verification"
        ? "Keep this supported incident timeline. Set status to recovered, resolved, or closed, then support status with the exact canonical recovery checkpoint that records passed, recovered, restored, or exactly-once verification; do not delete the artifact or dismiss its opportunity to escape this finding."
        : `Guided ${kind} draft is missing the ${axis} reuse axis.`,
    severity: "error",
    path: `/artifacts/0/output${path}`,
    sessionId: "session:a",
    artifactDraftId: draftId,
    artifactKind: kind
  }));
  const missingKind = (kind: "runbook" | "adr" | "incident_timeline", draftId: string, supportKind: string) => ({
    code: "missing_required_support_kind",
    message: `${kind} requires at least one valid ${supportKind} support entry.`,
    severity: "error",
    path: "/artifacts/0/output",
    sessionId: "session:a",
    artifactDraftId: draftId,
    artifactKind: kind
  });
  const missingRootCause = (kind: "runbook" | "incident_timeline", draftId: string) => ({
    code: "missing_root_cause_support",
    message: "A causal root-cause assertion requires direct root_cause support; otherwise state that root cause is unknown.",
    severity: "error",
    path: "/artifacts/0/output/rootCause",
    sessionId: "session:a",
    artifactDraftId: draftId,
    artifactKind: kind
  });
  return [
    { name: "runbook trigger", input: remove("runbook", "problemSignature", ["problemSignature"]), expected: expected("runbook", "draft:runbook", "/problemSignature", "trigger") },
    { name: "runbook preconditions", input: remove("runbook", "preconditions", ["preconditions"]), expected: expected("runbook", "draft:runbook", "/preconditions", "preconditions") },
    { name: "runbook performed steps", input: remove("runbook", "fixSteps", ["fixSteps"]), expected: [missingKind("runbook", "draft:runbook", "change"), ...expected("runbook", "draft:runbook", "/fixSteps", "performed steps")] },
    { name: "runbook expected and verification", input: remove("runbook", "validationChecks", ["validationChecks"]), expected: [missingKind("runbook", "draft:runbook", "verification"), ...expected("runbook", "draft:runbook", "/validationChecks", "expected results", "verification")] },
    { name: "runbook rollback", input: remove("runbook", "risksOrGaps", ["risksOrGaps"]), expected: expected("runbook", "draft:runbook", "/risksOrGaps", "failure or rollback handling") },
    { name: "adr context", input: remove("adr", "context", ["context"]), expected: expected("adr", "draft:adr", "/context", "context") },
    { name: "adr decision", input: remove("adr", "decision", ["decision"]), expected: expected("adr", "draft:adr", "/decision", "durable decision") },
    { name: "adr alternatives", input: remove("adr", "alternatives", ["alternatives"]), expected: [missingKind("adr", "draft:adr", "alternative"), ...expected("adr", "draft:adr", "/alternatives", "alternatives actually considered")] },
    { name: "adr consequences and reversal", input: remove("adr", "consequences", ["consequences"]), expected: expected("adr", "draft:adr", "/consequences", "consequences", "reversal conditions") },
    { name: "incident symptom", input: () => { const input = remove("incident_timeline", "impact", ["impact"])(); delete input.bundle.artifacts[0]!.output.symptom; input.bundle.artifacts[0]!.output.claimSupport = (input.bundle.artifacts[0]!.output.claimSupport as Array<{ path: string }>).filter(({ path }) => path !== "symptom"); return input; }, expected: expected("incident_timeline", "draft:incident", "/impact", "symptoms or impact") },
    { name: "incident timeline", input: remove("incident_timeline", "timeline", ["timeline"]), expected: [missingKind("incident_timeline", "draft:incident", "timeline"), ...expected("incident_timeline", "draft:incident", "/timeline", "ordered events")] },
    { name: "incident root cause", input: remove("incident_timeline", "rootCause", ["rootCause"]), expected: [...expected("incident_timeline", "draft:incident", "/rootCause", "root cause"), missingRootCause("incident_timeline", "draft:incident")] },
    { name: "incident factors", input: remove("incident_timeline", "contributingFactors", ["contributingFactors"]), expected: expected("incident_timeline", "draft:incident", "/contributingFactors", "contributing factors") },
    { name: "incident remediation", input: remove("incident_timeline", "remediation", ["remediation"]), expected: [missingKind("incident_timeline", "draft:incident", "remediation"), ...expected("incident_timeline", "draft:incident", "/remediation", "remediation")] },
    { name: "incident recovery", input: remove("incident_timeline", "status", ["status"]), expected: expected("incident_timeline", "draft:incident", "/status", "recovery verification") }
  ];
}

function artifactSupport(path: string, supportKind: GuidedAuthoringBundleV4["sessionEnrichments"][number]["claimSupport"][number]["supportKind"], excerpt: string) {
  return { path, supportKind, evidenceRef: "evidence:a", excerpt };
}

function markSessionVerificationPassed(
  input: GuidedAuthoringValidationInput,
  evidenceRef: string,
  excerpt: string
): void {
  const draft = input.bundle.sessionEnrichments[0]!;
  draft.enrichment.sessionSummary = {
    ...draft.enrichment.sessionSummary,
    text: excerpt,
    state: "completed",
    evidenceRefs: [ref(evidenceRef)]
  };
  draft.enrichment.sessionDossier.verification = {
    status: "passed",
    summary: excerpt,
    commands: [],
    failures: [],
    evidenceRefs: [ref(evidenceRef)]
  };
  draft.enrichment.sessionDossier.warnings = [];
  const summarySupport = draft.claimSupport.find(({ path }) => path === "/sessionSummary/text")!;
  summarySupport.evidenceRef = evidenceRef;
  summarySupport.excerpt = excerpt;
  draft.claimSupport.push({
    path: "/sessionDossier/verification/summary",
    supportKind: "verification",
    evidenceRef,
    excerpt
  });
}

function protocolFinding(
  path: string,
  matched: string,
  identity: Partial<{
    sessionId: string;
    opportunityId: string;
    artifactDraftId: string;
    artifactKind: "runbook" | "adr" | "incident_timeline";
  }>
) {
  return {
    code: "protocol_leakage",
    message: `Human-facing artifact text contains unsupported guided-authoring protocol language: ${matched}.`,
    severity: "error",
    path,
    ...identity
  };
}

function failedTemplateInput(): GuidedAuthoringValidationInput {
  const sessions = Array.from({ length: 12 }, (_, index) => ({
    sessionId: `session:template:${index}`,
    title: "Process selected authoring request",
    request: "Publish enriched session dossiers and identify reusable operational knowledge",
    evidence: [
      { id: `evidence:${index}:first`, text: "Publish enriched session dossiers and identify reusable operational knowledge for the selected work." },
      { id: `evidence:${index}:middle`, text: "The implementation changed a session-specific component and recorded its local result." },
      { id: `evidence:${index}:last`, text: "The selected authoring request reached a final response without a recorded verification run." }
    ]
  }));
  const opportunities = (["runbook", "adr", "incident"] as const).map((kind, index) => ({
    opportunityId: `opportunity:${kind}`,
    evidenceRefs: [`evidence:${index}:middle`],
    suggestedKind: kind === "incident" ? "incident_timeline" as const : kind,
    signalStrength: "high" as const,
    summary: kind === "runbook"
      ? "Repeated operational procedure needs trigger verification and rollback details."
      : kind === "adr"
        ? "Durable decision needs alternatives consequences and reversal conditions."
        : "Production incident needs impact timeline root cause remediation and recovery verification.",
    provenanceSessionIds: [`session:template:${index}`]
  }));
  const bundle = failedV3TemplateBundle({
    assignmentId: "assignment:template",
    evidenceRevision: "revision:template",
    sessions,
    opportunities
  });
  return {
    bundle,
    assignment: {
      assignmentId: "assignment:template",
      requestId: "request:template",
      evidenceRevision: "revision:template",
      sessionIds: sessions.map(({ sessionId }) => sessionId),
      opportunityIds: opportunities.map(({ opportunityId }) => opportunityId)
    },
    canonicalDossiersBySession: new Map(sessions.map((session) => [session.sessionId, {
      ...dossier(), identity: { ...dossier().identity, sessionId: session.sessionId }
    } as SessionDossierDto])),
    evidenceByRef: new Map(sessions.flatMap((session) => session.evidence.map((item) => [item.id, evidence(session.sessionId, item.text)]))),
    coverage: sessions.map(({ sessionId }) => ({
      sessionId, evidenceRevision: "revision:template", accessedItems: 2, totalItems: 3, complete: false
    })),
    opportunities,
    requestAcceptedDrafts: []
  };
}

function validInput(): GuidedAuthoringValidationInput {
  const enrichment = validEnrichment();
  const bundle: GuidedAuthoringBundleV4 = {
    bundleVersion: "workbench-authoring-v4",
    assignmentId: "assignment:a",
    evidenceRevision: "revision:a",
    sessionEnrichments: [{
      sessionId: "session:a",
      enrichment,
      claimSupport: [
        support("/sessionTitle/text", "reuse", "User requested a focused repository quality validator for guided authoring."),
        { ...support("/sessionSummary/text", "outcome", "Implemented a pure validator with stable field-specific quality findings; verification was not run."), evidenceRef: "evidence:result" },
        support("/sessionDossier/purpose", "purpose", "User requested a focused repository quality validator for guided authoring."),
        { ...support("/sessionDossier/outcome", "outcome", "Implemented a pure validator with stable field-specific quality findings; verification was not run."), evidenceRef: "evidence:result" }
      ]
    }],
    opportunityDispositions: [],
    artifacts: []
  };
  return {
    bundle,
    assignment: {
      assignmentId: "assignment:a",
      requestId: "request:a",
      evidenceRevision: "revision:a",
      sessionIds: ["session:a"],
      opportunityIds: []
    },
    canonicalDossiersBySession: new Map([["session:a", dossier()]]),
    evidenceByRef: new Map([
      ["evidence:a", evidence("session:a", [
        "User requested a focused repository quality validator for guided authoring.",
        "Implemented a pure validator with stable field-specific quality findings; verification was not run."
      ].join(" "))],
      ["evidence:result", {
        ...evidence("session:a", "Implemented a pure validator with stable field-specific quality findings; verification was not run."),
        role: "assistant"
      }]
    ]),
    coverage: [{
      sessionId: "session:a",
      evidenceRevision: "revision:a",
      accessedItems: 1,
      totalItems: 1,
      complete: true
    }],
    opportunities: [],
    requestAcceptedDrafts: []
  };
}

function validEnrichment(): DurableSessionEnrichment {
  return {
    version: "session-capsule-v4",
    sessionTitle: {
      text: "Build grounded guided quality validation",
      basis: "dominant_work",
      confidence: "high",
      evidenceRefs: [ref("evidence:a")]
    },
    sessionSummary: {
      text: "Implemented a pure validator with stable field-specific quality findings; verification was not run.",
      state: "partial",
      confidence: "high",
      evidenceRefs: [ref("evidence:result")]
    },
    sessionDossier: {
      purpose: "User requested a focused repository quality validator for guided authoring.",
      outcome: "Implemented a pure validator with stable field-specific quality findings.",
      keyWork: [], decisions: [], blockers: [],
      verification: { status: "missing", summary: "", commands: [], failures: [], evidenceRefs: [] },
      continuation: { openQuestions: [], constraints: [] },
      evidenceRefs: [ref("evidence:a"), ref("evidence:result")],
      warnings: ["Verification not run for this partial implementation fixture."]
    }
  };
}

function support(path: string, supportKind: GuidedAuthoringBundleV4["sessionEnrichments"][number]["claimSupport"][number]["supportKind"], excerpt: string) {
  return { path, supportKind, evidenceRef: "evidence:a", excerpt };
}

function evidence(sessionId: string, text: string): WorkbenchValidationEvidence {
  return { sessionId, kind: "message", role: "user", text, observedAt: at, lowValue: false };
}

function dossier(): SessionDossierDto {
  return {
    identity: { sessionId: "session:a" },
    enrichment: { status: "not_enriched" },
    coverage: { level: "complete", warnings: [], transcript: {} },
    narrative: {}, files: [], tools: [], verification: {}, attention: [], excerpts: [], timeline: [], reuse: {},
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, usageRows: 0 }, artifacts: []
  } as unknown as SessionDossierDto;
}
