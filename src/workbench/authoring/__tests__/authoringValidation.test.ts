import { describe, expect, test } from "vitest";
import type { SessionArtifactRecord } from "../../../daemon/db/sessionArtifactRepository.ts";
import type {
  WorkbenchAuthoringBundle,
  WorkbenchAuthoringBundleV2
} from "../../../shared/workbenchAuthoring.ts";
import {
  isWorkbenchAuthoringCapabilitiesDto,
  WORKBENCH_AUTHORING_OPERATIONS
} from "../../../shared/workbenchAuthoring.ts";
import { getWorkbenchSchema } from "../../schemas.ts";
import type { WorkbenchAuthoringValidationInput, WorkbenchValidationEvidence } from "../../types.ts";
import {
  getAuthoringBundleSchema,
  getAuthoringBundleV2Schema,
  getWorkbenchAuthoringOutputSchema,
  parseAuthoringBundleV2
} from "../authoringSchemas.ts";
import { validateAuthoringBundle, validateAuthoringBundleV2 } from "../authoringValidation.ts";

describe("Workbench authoring V3 capabilities", () => {
  test("advertises selection-scoped authoring while preserving the transport protocol", () => {
    const capabilities = {
      bundleVersion: "workbench-authoring-v3",
      capability: "artifact_authoring",
      command: "/opt/masthead/mastheadctl",
      databaseId: "database:test",
      evidencePolicy: "selected_session_canonical_evidence",
      maxSessionsPerRun: 12,
      operations: ["suggestions", "open", "status", "evidence", "context", "submit", "finish"],
      protocol: "masthead.workbench.authoring/v1",
      suggestionsAreBinding: false,
      transport: "daemon_http"
    };

    expect(WORKBENCH_AUTHORING_OPERATIONS).toEqual(capabilities.operations);
    expect(isWorkbenchAuthoringCapabilitiesDto(capabilities)).toBe(true);
    expect(isWorkbenchAuthoringCapabilitiesDto({
      ...capabilities,
      bundleVersion: "workbench-authoring-v2"
    })).toBe(false);
  });
});

describe("Workbench authoring V2 schemas", () => {
  test("accepts exactly one candidate-scoped optional artifact", () => {
    expect(parseAuthoringBundleV2(validV2Bundle())).toEqual(validV2Bundle());
    expect(getAuthoringBundleV2Schema()).toMatchObject({
      additionalProperties: false,
      properties: {
        artifact: { oneOf: expect.any(Array) },
        bundleVersion: { const: "workbench-authoring-v2" },
        candidateId: { type: "string" },
        evidenceRevision: { type: "string" },
        runId: { type: "string" }
      },
      required: ["bundleVersion", "runId", "candidateId", "evidenceRevision", "artifact"],
      title: "WorkbenchAuthoringBundleV2",
      type: "object"
    });
  });

  test("V2 bundles cannot contain an agent-authored dossier or V1 resolution fields", () => {
    for (const field of [
      "sessionPackages",
      "dossier",
      "enrichments",
      "notApplicable",
      "contributions",
      "artifacts"
    ] as const) {
      const bundle = { ...validV2Bundle(), [field]: [] };
      expect(() => parseAuthoringBundleV2(bundle)).toThrow(`unexpected_authoring_bundle_property:${field}`);
    }
  });

  test("V1 bundles are not accepted by the V2 parser", () => {
    expect(() => parseAuthoringBundleV2(validAuthoringBundle())).toThrow(
      "unsupported_authoring_bundle_version"
    );
  });

  test("adds claim evidence without mutating the V1 registry", () => {
    const v1 = getWorkbenchSchema("session_enrichment");
    const v2 = getWorkbenchAuthoringOutputSchema("session_enrichment");

    expect(v1.properties).not.toHaveProperty("claimEvidence");
    expect(v1.required).not.toContain("claimEvidence");
    expect(v2).toMatchObject({
      additionalProperties: false,
      properties: {
        claimEvidence: {
          items: {
            additionalProperties: false,
            properties: {
              evidenceRefs: { items: { type: "string" }, type: "array" },
              path: { type: "string" }
            },
            required: ["path", "evidenceRefs"],
            type: "object"
          },
          type: "array"
        }
      },
      required: expect.arrayContaining(["claimEvidence"]),
      title: "SessionEnrichmentOutputV2"
    });
  });

  test("returns the strict authoring bundle contract", () => {
    expect(getAuthoringBundleSchema()).toMatchObject({
      additionalProperties: false,
      properties: {
        artifacts: { type: "array" },
        bundleVersion: { const: "workbench-authoring-v1" },
        contributions: { type: "array" },
        evidenceRevision: { type: "string" },
        notApplicable: { type: "array" },
        runId: { type: "string" },
        sessionPackages: { type: "array" }
      },
      required: [
        "bundleVersion",
        "runId",
        "evidenceRevision",
        "sessionPackages",
        "artifacts",
        "notApplicable",
        "contributions"
      ],
      title: "WorkbenchAuthoringBundleV2",
      type: "object"
    });
  });
});

function validV2Bundle(): WorkbenchAuthoringBundleV2 {
  const artifact = validRunbookDraft();
  const { claimEvidence: _legacyClaimEvidence, ...output } = artifact.output;
  return {
    artifact: {
      ...artifact,
      output: {
        ...output,
        claimSupport: [
          {
            evidenceRef: "message:a:1",
            excerpt: "Canonical evidence supports the authored Workbench claim in this fixture.",
            path: "problemSignature.symptoms[0]",
            supportKind: "problem"
          },
          {
            evidenceRef: "message:a:1",
            excerpt: "Canonical evidence supports the authored Workbench claim in this fixture.",
            path: "problemSignature.errorStrings[0]",
            supportKind: "problem"
          },
          {
            evidenceRef: "message:a:1",
            excerpt: "Canonical evidence supports the authored Workbench claim in this fixture.",
            path: "problemSignature.affectedScope",
            supportKind: "problem"
          },
          {
            evidenceRef: "message:a:1",
            excerpt: "Canonical evidence supports the authored Workbench claim in this fixture.",
            path: "preconditions[0]",
            supportKind: "problem"
          },
          {
            evidenceRef: "message:a:1",
            excerpt: "Canonical evidence supports the authored Workbench claim in this fixture.",
            path: "reproSteps[0]",
            supportKind: "problem"
          },
          {
            evidenceRef: "message:a:1",
            excerpt: "Canonical evidence supports the authored Workbench claim in this fixture.",
            path: "fixSteps[0]",
            supportKind: "change"
          },
          {
            evidenceRef: "message:a:1",
            excerpt: "Changed validation behavior. Canonical evidence supports the authored Workbench claim in this fixture.",
            path: "commands[0]",
            supportKind: "change"
          },
          {
            evidenceRef: "message:a:1",
            excerpt: "Changed validation behavior. Canonical evidence supports the authored Workbench claim in this fixture.",
            path: "changedFiles[0]",
            supportKind: "change"
          },
          {
            evidenceRef: "message:a:1",
            excerpt: "Canonical evidence supports the authored Workbench claim in this fixture.",
            path: "environmentRequirements[0]",
            supportKind: "problem"
          },
          {
            evidenceRef: "message:a:1",
            excerpt: "Canonical evidence supports the authored Workbench claim in this fixture.",
            path: "rootCause",
            supportKind: "root_cause"
          },
          {
            evidenceRef: "message:a:1",
            excerpt: "Canonical evidence supports the authored Workbench claim in this fixture.",
            path: "preventionNotes[0]",
            supportKind: "remediation"
          },
          {
            evidenceRef: "tool_result:a:2",
            excerpt: "Focused authoring validation tests passed successfully.",
            path: "validationChecks[0]",
            supportKind: "verification"
          }
        ]
      }
    },
    bundleVersion: "workbench-authoring-v2",
    candidateId: "candidate:runbook:oauth",
    evidenceRevision: "sha256:evidence",
    runId: "authoring:run"
  };
}

describe("validateAuthoringBundle", () => {
  test("rejects unsupported authoring-protocol language through the V2 bundle boundary", () => {
    const bundle = validV2Bundle();
    bundle.artifact.output.fixSteps = ["Read every canonical evidence item through cursor pagination."];
    const evidence = validValidationInput(validAuthoringBundle()).evidenceByRef;

    const result = validateAuthoringBundleV2({
      bundle,
      coverageWarningsBySession: new Map(),
      evidenceByRef: evidence,
      publishedArtifacts: [],
      selectedSessionIds: ["session:a"]
    });

    expect(result).toMatchObject({ ok: false });
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "unsupported_authoring_protocol_language",
      path: "artifact.output.fixSteps[0]"
    }));
  });

  test("accepts a grounded bundle that resolves every automatic kind", () => {
    expect(validateAuthoringBundle(validValidationInput(validAuthoringBundle()))).toEqual({
      findings: [],
      ok: true
    });
  });

  test("rejects uncited claims and easy unsupported N/A decisions", () => {
    const bundle = validAuthoringBundle();
    bundle.sessionPackages[0]!.dossier.claimEvidence = [];
    bundle.notApplicable[0] = {
      evidenceRefs: [],
      kind: "adr",
      reason: "No ADR.",
      sessionId: "session:a"
    };

    const result = validateAuthoringBundle({
      bundle,
      coverageWarningsBySession: new Map(),
      evidenceByRef: new Map([
        ["message:a:1", validationEvidence("session:a", "message")],
        ["tool_result:a:2", validationEvidence("session:a", "tool_result", { exitCode: 0, status: "completed" })]
      ]),
      publishedArtifacts: [],
      selectedSessionIds: ["session:a"]
    });

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_claim_evidence", path: "sessionPackages[0].dossier.claimEvidence" }),
        expect.objectContaining({ code: "weak_not_applicable_reason", path: "notApplicable[0].reason" }),
        expect.objectContaining({ code: "not_applicable_without_evidence", path: "notApplicable[0].evidenceRefs" })
      ])
    );
  });

  test("requires every automatic kind to resolve exactly once", () => {
    const bundle = validAuthoringBundle();
    bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "incident_timeline");

    const result = validateAuthoringBundle(validValidationInput(bundle));

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        artifactKind: "incident_timeline",
        code: "unresolved_automatic_kind",
        sessionId: "session:a"
      })
    );

    bundle.notApplicable.push(
      notApplicable("session:a", "incident_timeline"),
      notApplicable("session:a", "incident_timeline")
    );
    const duplicate = validateAuthoringBundle(validValidationInput(bundle));
    expect(duplicate.findings).toContainEqual(
      expect.objectContaining({
        artifactKind: "incident_timeline",
        code: "duplicate_automatic_kind_resolution",
        path: "notApplicable[3]",
        sessionId: "session:a"
      })
    );
  });

  test("rejects disjoint automatic drafts with the same explicit signature", () => {
    const bundle = validAuthoringBundle(["session:a", "session:b"]);
    bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "runbook");
    const first = validRunbookDraft(["session:a"]);
    const second = validRunbookDraft(["session:b"]);
    first.output.signatureKey = "signature:oauth-callback";
    second.output.signatureKey = "  signature:oauth-callback  ";
    bundle.artifacts = [first, second];

    const result = validateAuthoringBundle(validValidationInput(bundle, ["session:a", "session:b"]));

    expect(result).toMatchObject({ ok: false });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        artifactKind: "runbook",
        code: "duplicate_artifact_signature",
        path: "artifacts[1].output.signatureKey",
        sessionId: "session:b"
      })
    );
    expect(
      result.findings.find((finding) => finding.code === "duplicate_artifact_signature")?.message
    ).toContain("one combined-provenance multi-session artifact");
  });

  test("rejects a present blank artifact signature", () => {
    const bundle = validAuthoringBundle();
    bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "runbook");
    const runbook = validRunbookDraft();
    runbook.output.signatureKey = " \t ";
    bundle.artifacts = [runbook];

    const result = validateAuthoringBundle(validValidationInput(bundle));

    expect(result).toMatchObject({ ok: false });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        artifactKind: "runbook",
        code: "blank_artifact_signature",
        path: "artifacts[0].output.signatureKey",
        sessionId: "session:a"
      })
    );
  });

  test("allows disjoint automatic drafts without explicit signatures", () => {
    const bundle = validAuthoringBundle(["session:a", "session:b"]);
    bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "runbook");
    bundle.artifacts = [validRunbookDraft(["session:a"]), validRunbookDraft(["session:b"])];

    expect(validateAuthoringBundle(validValidationInput(bundle, ["session:a", "session:b"]))).toEqual({
      findings: [],
      ok: true
    });
  });

  test("points duplicate session packages at the second original package index", () => {
    const bundle = validAuthoringBundle();
    const duplicate = bundle.sessionPackages[0]!;
    bundle.sessionPackages.unshift("malformed" as never);
    bundle.sessionPackages.push(duplicate);

    const result = validateAuthoringBundle(validValidationInput(bundle));

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "duplicate_session_package",
        path: "sessionPackages[2].sessionId",
        sessionId: "session:a"
      })
    );
  });

  test("rejects thin high confidence and explains sparse session coverage", () => {
    const bundle = validAuthoringBundle();
    bundle.sessionPackages[0]!.enrichment.evidenceRefs = ["message:a:1"];
    bundle.sessionPackages[0]!.enrichment.confidence = "high";
    bundle.sessionPackages[0]!.enrichment.missingEvidence = [];

    const result = validateAuthoringBundle({
      ...validValidationInput(bundle),
      coverageWarningsBySession: new Map([["session:a", ["No file effects were captured."]]])
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "high_confidence_without_support",
          path: "sessionPackages[0].enrichment.evidenceRefs"
        }),
        expect.objectContaining({
          code: "high_confidence_with_sparse_coverage",
          path: "sessionPackages[0].enrichment.confidence"
        }),
        expect.objectContaining({
          code: "missing_sparse_evidence_note",
          path: "sessionPackages[0].enrichment.missingEvidence"
        })
      ])
    );
    expect(result.ok).toBe(false);
  });

  test("allows sparse coverage warnings to submit at low confidence with missing-evidence notes", () => {
    const bundle = validAuthoringBundle();
    for (const output of [bundle.sessionPackages[0]!.enrichment, bundle.sessionPackages[0]!.dossier]) {
      output.confidence = "low";
      output.missingEvidence = ["No file effects were captured."];
    }

    const result = validateAuthoringBundle({
      ...validValidationInput(bundle),
      coverageWarningsBySession: new Map([["session:a", ["No file effects were captured."]]])
    });

    expect(result.ok).toBe(true);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "sparse_evidence_coverage", sessionId: "session:a", severity: "warning" })
    );
    expect(result.findings.every((finding) => finding.severity === "warning")).toBe(true);
  });

  test("requires a passed verification ref for a high-confidence runbook", () => {
    const bundle = validAuthoringBundle();
    bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "runbook");
    bundle.artifacts.push(validRunbookDraft());
    const input = validValidationInput(bundle);
    input.evidenceByRef.set("tool_result:a:2", validationEvidence("session:a", "tool_result", {
      exitCode: 1,
      status: "failed"
    }));

    const result = validateAuthoringBundle(input);

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        artifactKind: "runbook",
        code: "missing_passed_verification",
        path: "artifacts[0].output.claimEvidence"
      })
    );
  });

  test("validates claim paths, declared evidence, provenance, and strong multi-session joins", () => {
    const bundle = validAuthoringBundle(["session:a", "session:b"]);
    bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "runbook");
    const runbook = validRunbookDraft(["session:a", "session:b"]);
    runbook.output.joinRationale = "same project";
    runbook.output.claimEvidence = [
      { evidenceRefs: ["message:b:1"], path: "doesNotExist" },
      { evidenceRefs: ["message:b:1"], path: "rootCause" }
    ];
    runbook.output.evidenceRefs = ["message:a:1", "tool_result:a:2"];
    bundle.artifacts.push(runbook);

    const result = validateAuthoringBundle(validValidationInput(bundle, ["session:a", "session:b"]));

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "weak_join", path: "artifacts[0].output.joinRationale" }),
        expect.objectContaining({ code: "invalid_claim_path", path: "artifacts[0].output.claimEvidence[0].path" }),
        expect.objectContaining({
          code: "claim_evidence_outside_declared_evidence",
          path: "artifacts[0].output.claimEvidence[1].evidenceRefs[0]"
        })
      ])
    );
  });

  test("validates nested timeline evidence against canonical provenance", () => {
    const bundle = validAuthoringBundle();
    bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "incident_timeline");
    bundle.artifacts.push(validIncidentDraft("missing:timeline"));

    const result = validateAuthoringBundle(validValidationInput(bundle));

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "unknown_evidence_ref",
        path: "artifacts[0].output.timeline[0].evidenceRefs[0]"
      })
    );
  });

  test("requires selected provenance containing the artifact seed", () => {
    const bundle = validAuthoringBundle();
    bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "adr");
    bundle.artifacts.push({
      ...validAdrDraft(),
      provenanceSessionIds: ["session:b"],
      seedSessionId: "session:a"
    });

    const result = validateAuthoringBundle(validValidationInput(bundle));

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "seed_missing_from_provenance", path: "artifacts[0].provenanceSessionIds" }),
        expect.objectContaining({ code: "provenance_session_not_selected", path: "artifacts[0].provenanceSessionIds[0]" })
      ])
    );
  });

  test("rejects duplicate provenance IDs in both artifact draft and output", () => {
    const bundle = validAuthoringBundle();
    bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "runbook");
    bundle.artifacts.push(validRunbookDraft(["session:a", "session:a"]));

    const result = validateAuthoringBundle(validValidationInput(bundle));

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_provenance_session",
          path: "artifacts[0].provenanceSessionIds[1]"
        }),
        expect.objectContaining({
          code: "duplicate_provenance_session",
          path: "artifacts[0].output.provenanceSessionIds[1]"
        })
      ])
    );
  });

  test("rejects output provenance multiplicity mismatches before resolution accounting", () => {
    const bundle = validAuthoringBundle(["session:a", "session:b"]);
    bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "runbook");
    const runbook = validRunbookDraft(["session:a", "session:b"]);
    runbook.output.provenanceSessionIds = ["session:a", "session:b", "session:b"];
    bundle.artifacts.push(runbook);

    const result = validateAuthoringBundle(validValidationInput(bundle, ["session:a", "session:b"]));

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_provenance_session",
          path: "artifacts[0].output.provenanceSessionIds[2]"
        }),
        expect.objectContaining({
          code: "mismatched_output_provenance",
          path: "artifacts[0].output.provenanceSessionIds"
        })
      ])
    );
    expect(result.findings).not.toContainEqual(
      expect.objectContaining({ code: "duplicate_automatic_kind_resolution", sessionId: "session:b" })
    );
  });

  test("accepts only contributions to a current published artifact of the same kind containing the session", () => {
    const bundle = validAuthoringBundle();
    bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "adr");
    bundle.contributions.push({
      kind: "adr",
      publishedArtifactId: "artifact:adr",
      sessionId: "session:a"
    });

    const valid = validateAuthoringBundle({
      ...validValidationInput(bundle),
      publishedArtifacts: [publishedArtifact()]
    });
    expect(valid.ok).toBe(true);

    const invalid = validateAuthoringBundle({
      ...validValidationInput(bundle),
      publishedArtifacts: [{ ...publishedArtifact(), publicationStatus: "applied" }]
    });
    expect(invalid.findings).toContainEqual(
      expect.objectContaining({ code: "invalid_contribution", path: "contributions[0].publishedArtifactId" })
    );
  });

  test("rejects generic and duplicate titles, empty required text and claim-bearing arrays", () => {
    const bundle = validAuthoringBundle();
    bundle.sessionPackages[0]!.enrichment.title = "Work completed";
    bundle.sessionPackages[0]!.enrichment.summary = "Work completed";
    bundle.sessionPackages[0]!.dossier.outcome = " ";
    bundle.sessionPackages[0]!.dossier.keyDecisions = [];

    const result = validateAuthoringBundle(validValidationInput(bundle));

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "generic_title", path: "sessionPackages[0].enrichment.title" }),
        expect.objectContaining({ code: "duplicate_title_summary", path: "sessionPackages[0].enrichment.summary" }),
        expect.objectContaining({ code: "insufficient_specificity", path: "sessionPackages[0].dossier.outcome" }),
        expect.objectContaining({ code: "empty_claim_array", path: "sessionPackages[0].dossier.keyDecisions" })
      ])
    );
  });

  test("rejects whitespace-only claim-bearing strings as empty claims", () => {
    const bundle = validAuthoringBundle();
    bundle.sessionPackages[0]!.dossier.keyDecisions = [" "];
    bundle.sessionPackages[0]!.dossier.verification = ["   "];
    bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "runbook");
    const runbook = validRunbookDraft();
    runbook.output.fixSteps = ["\t"];
    bundle.artifacts.push(runbook);

    const result = validateAuthoringBundle(validValidationInput(bundle));

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "empty_claim_array", path: "sessionPackages[0].dossier.keyDecisions" }),
        expect.objectContaining({
          code: "insufficient_specificity",
          path: "sessionPackages[0].dossier.keyDecisions[0]"
        }),
        expect.objectContaining({ code: "empty_claim_array", path: "sessionPackages[0].dossier.verification" }),
        expect.objectContaining({
          code: "insufficient_specificity",
          path: "sessionPackages[0].dossier.verification[0]"
        }),
        expect.objectContaining({ code: "empty_claim_array", path: "artifacts[0].output.fixSteps" }),
        expect.objectContaining({ code: "insufficient_specificity", path: "artifacts[0].output.fixSteps[0]" })
      ])
    );
  });

  test("keeps finding paths aligned after malformed array entries", () => {
    const bundle = validAuthoringBundle();
    bundle.notApplicable.unshift("malformed" as never);
    bundle.notApplicable[1]!.reason = "Too short.";
    const claimEvidence = bundle.sessionPackages[0]!.dossier.claimEvidence as Array<{
      evidenceRefs: string[];
      path: string;
    }>;
    claimEvidence.unshift("malformed" as never);
    claimEvidence[1]!.path = "doesNotExist";

    const result = validateAuthoringBundle(validValidationInput(bundle));

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "weak_not_applicable_reason", path: "notApplicable[1].reason" }),
        expect.objectContaining({
          code: "invalid_claim_path",
          path: "sessionPackages[0].dossier.claimEvidence[1].path"
        })
      ])
    );
  });

  test("rejects secret-looking values from V2 authored output", () => {
    const bundle = validAuthoringBundle();
    bundle.sessionPackages[0]!.enrichment.summary =
      "Attempted to use OPENAI_API_KEY=sk-secretsecretsecretsecret while validating the bundle.";

    const result = validateAuthoringBundle(validValidationInput(bundle));

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "secret_detected",
        path: "sessionPackages[0].enrichment"
      })
    );
  });

  test("accepts canonical evidence refs containing 64-hex item IDs", () => {
    const sessionId = "session:a";
    const originalRef = messageRef(sessionId);
    const canonicalRef = `message:${"a".repeat(64)}`;
    const bundle = JSON.parse(
      JSON.stringify(validAuthoringBundle()).replaceAll(originalRef, canonicalRef)
    ) as WorkbenchAuthoringBundle;
    const input = validValidationInput(bundle);
    input.evidenceByRef.delete(originalRef);
    input.evidenceByRef.set(canonicalRef, validationEvidence(sessionId, "message"));

    const result = validateAuthoringBundle(input);

    expect(result.findings).not.toContainEqual(expect.objectContaining({ code: "secret_detected" }));
    expect(result.ok).toBe(true);
  });

  test("rejects own properties whose names exist only on Object.prototype", () => {
    const bundle = validAuthoringBundle();
    Object.defineProperty(bundle, "constructor", { enumerable: true, value: "unexpected" });

    const result = validateAuthoringBundle(validValidationInput(bundle));

    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "unexpected_property", path: "constructor" })
    );
  });
});

function validAuthoringBundle(sessionIds: string[] = ["session:a"]): WorkbenchAuthoringBundle {
  return {
    artifacts: [],
    bundleVersion: "workbench-authoring-v1",
    contributions: [],
    evidenceRevision: "sha256:evidence",
    notApplicable: sessionIds.flatMap((sessionId) =>
      (["runbook", "adr", "incident_timeline"] as const).map((kind) => notApplicable(sessionId, kind))
    ),
    runId: "authoring:run",
    sessionPackages: sessionIds.map((sessionId) => ({
      dossier: {
        approach: ["Added a strict schema and deterministic validation."],
        claimEvidence: [
          { evidenceRefs: [messageRef(sessionId)], path: "keyDecisions[0]" },
          { evidenceRefs: [messageRef(sessionId)], path: "outcome" },
          { evidenceRefs: [toolRef(sessionId)], path: "verification[0]" }
        ],
        commandsAndTools: [{ label: "npm test", purpose: "Run focused validation tests", status: "passed" }],
        confidence: "high",
        context: "Workbench agents need one inspectable authoring contract.",
        evidenceRefs: [messageRef(sessionId), toolRef(sessionId)],
        filesTouched: [{ label: "src/workbench/authoring/authoringValidation.ts", role: "validator" }],
        keyDecisions: ["Keep the V1 schema registry unchanged."],
        lessonsLearned: ["Field-addressed findings make revision deterministic."],
        missingEvidence: [],
        outcome: "The grounded V2 bundle validates successfully.",
        problemStatement: "Agent-authored artifacts need deterministic grounding checks.",
        risksOrGaps: [],
        title: "Validate grounded Workbench artifacts",
        verification: ["Focused validation tests passed."]
      },
      enrichment: {
        claimEvidence: [{ evidenceRefs: [messageRef(sessionId)], path: "outcome" }],
        confidence: "high",
        evidenceRefs: [messageRef(sessionId), toolRef(sessionId)],
        missingEvidence: [],
        outcome: "The authoring bundle is ready for deterministic validation.",
        searchPhrases: ["Workbench grounded authoring bundle"],
        summary: "Defined a grounded V2 bundle with deterministic, field-addressed validation findings.",
        technologies: ["TypeScript", "Vitest"],
        title: "Define grounded authoring bundle",
        topics: ["Workbench", "artifact authoring"],
        verificationSummary: "Focused tests passed."
      },
      sessionId
    }))
  };
}

function validRunbookDraft(provenanceSessionIds: string[] = ["session:a"]): WorkbenchAuthoringBundle["artifacts"][number] {
  const seedSessionId = provenanceSessionIds[0] ?? "session:a";
  return {
    kind: "runbook",
    output: {
      changedFiles: ["src/workbench/authoring/authoringValidation.ts"],
      claimEvidence: [
        { evidenceRefs: [messageRef(seedSessionId)], path: "fixSteps[0]" },
        { evidenceRefs: [messageRef(seedSessionId)], path: "rootCause" },
        { evidenceRefs: [toolRef(seedSessionId)], path: "validationChecks[0]" }
      ],
      commands: ["npm test"],
      confidence: "high",
      deadEnds: [],
      environmentRequirements: ["Node.js 24"],
      evidenceRefs: [messageRef(seedSessionId), toolRef(seedSessionId)],
      fixSteps: ["Validate the V2 bundle before applying artifacts."],
      ...(provenanceSessionIds.length > 1
        ? { joinRationale: "Shared failing validation and the same authored fix revision." }
        : {}),
      missingEvidence: [],
      preconditions: ["A claimed authoring run exists."],
      preventionNotes: ["Keep deterministic validation at the daemon boundary."],
      problemSignature: {
        affectedScope: "Workbench artifact authoring",
        errorStrings: ["missing_claim_evidence"],
        symptoms: ["Unsupported claims can be submitted"]
      },
      provenanceSessionIds,
      reproSteps: ["Submit a bundle with an unsupported claim."],
      risksOrGaps: [],
      rootCause: "The earlier contract had no field-addressed grounding envelope.",
      title: "Repair unsupported authoring claims",
      validationChecks: ["Focused authoring validation tests pass."]
    },
    provenanceSessionIds,
    seedSessionId
  };
}

function validAdrDraft(): WorkbenchAuthoringBundle["artifacts"][number] {
  return {
    kind: "adr",
    output: {
      alternatives: ["Mutate the V1 schema registry"],
      claimEvidence: [{ evidenceRefs: ["message:a:1"], path: "decision" }],
      confidence: "high",
      consequences: ["New authoring writes use kind-specific V2 schemas."],
      context: "Existing historical V1 artifacts must remain readable.",
      decision: "Build V2 output schemas from immutable V1 schemas.",
      evidenceRefs: ["message:a:1", "tool_result:a:2"],
      missingEvidence: [],
      provenanceSessionIds: ["session:a"],
      status: "accepted",
      title: "Preserve V1 authoring compatibility"
    },
    provenanceSessionIds: ["session:a"],
    seedSessionId: "session:a"
  };
}

function validIncidentDraft(timelineEvidenceRef = "message:a:1"): WorkbenchAuthoringBundle["artifacts"][number] {
  return {
    kind: "incident_timeline",
    output: {
      claimEvidence: [
        { evidenceRefs: ["message:a:1"], path: "timeline[0].summary" },
        { evidenceRefs: ["message:a:1"], path: "remediation[0]" }
      ],
      confidence: "high",
      contributingFactors: ["The bundle contract did not ground individual fields."],
      evidenceRefs: ["message:a:1", "tool_result:a:2"],
      impact: "Unsupported timeline claims could reach artifact application.",
      missingEvidence: [],
      prevention: ["Keep field-addressed validation in the authoring boundary."],
      provenanceSessionIds: ["session:a"],
      remediation: ["Reject timeline claims whose evidence is not canonical."],
      status: "resolved",
      symptom: "Timeline events accepted an unknown nested evidence reference.",
      timeline: [
        {
          at: "2026-07-10T12:00:00.000Z",
          evidenceRefs: [timelineEvidenceRef],
          summary: "The deterministic validator rejected unsupported timeline evidence."
        }
      ],
      title: "Reject unsupported timeline evidence"
    },
    provenanceSessionIds: ["session:a"],
    seedSessionId: "session:a"
  };
}

function validValidationInput(
  bundle: WorkbenchAuthoringBundle,
  sessionIds: string[] = ["session:a"]
): WorkbenchAuthoringValidationInput {
  return {
    bundle,
    coverageWarningsBySession: new Map<string, string[]>(),
    evidenceByRef: new Map<string, WorkbenchValidationEvidence>(
      sessionIds.flatMap((sessionId) => [
        [messageRef(sessionId), validationEvidence(sessionId, "message")],
        [toolRef(sessionId), validationEvidence(sessionId, "tool_result", { exitCode: 0, status: "completed" })]
      ])
    ),
    publishedArtifacts: [] as SessionArtifactRecord[],
    selectedSessionIds: sessionIds
  };
}

function validationEvidence(
  sessionId: string,
  kind: WorkbenchValidationEvidence["kind"],
  overrides: Partial<WorkbenchValidationEvidence> = {}
): WorkbenchValidationEvidence {
  return {
    kind,
    lowValue: false,
    observedAt: "2026-07-10T12:00:00.000Z",
    role: kind === "message" ? "assistant" : "tool",
    sessionId,
    text: kind === "tool_result"
      ? "Focused authoring validation tests passed successfully."
      : "Changed validation behavior. Canonical evidence supports the authored Workbench claim in this fixture.",
    ...overrides
  };
}

function notApplicable(
  sessionId: string,
  kind: "runbook" | "adr" | "incident_timeline"
): WorkbenchAuthoringBundle["notApplicable"][number] {
  return {
    evidenceRefs: [messageRef(sessionId)],
    kind,
    reason: `Reviewed the available evidence for ${kind}; it does not support a reusable artifact.`,
    sessionId
  };
}

function publishedArtifact(): SessionArtifactRecord {
  return {
    artifactId: "artifact:adr",
    artifactKind: "adr",
    confidence: "high",
    content: {},
    contentFingerprint: "fingerprint:adr",
    createdAt: "2026-07-10T12:00:00.000Z",
    createdBy: "agent:test",
    evidenceRefs: ["message:a:1"],
    lineageId: "lineage:adr",
    provenanceSessionIds: ["session:a", "session:historical"],
    publicationStatus: "published",
    publishedAt: "2026-07-10T12:01:00.000Z",
    schemaVersion: "adr-v2",
    sessionId: "session:historical",
    status: "current",
    title: "Preserve authoring compatibility",
    updatedAt: "2026-07-10T12:01:00.000Z",
    validation: { ok: true }
  };
}

function messageRef(sessionId: string): string {
  return `message:${sessionId.split(":").at(-1)}:1`;
}

function toolRef(sessionId: string): string {
  return `tool_result:${sessionId.split(":").at(-1)}:2`;
}
