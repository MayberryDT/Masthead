import { describe, expect, test } from "vitest";
import type { GuidedAuthoringBundleV4 } from "../../../shared/guidedAuthoring.ts";
import type { DurableSessionEnrichment } from "../../../shared/sessionEnrichment.ts";
import { getGuidedAuthoringBundleV4Schema, parseGuidedAuthoringBundleV4 } from "../authoringSchemas.ts";

describe("guided authoring V4 schema", () => {
  test("accepts supported enrichment and an evidence-backed opportunity dismissal", () => {
    const bundle = validGuidedBundle();

    expect(parseGuidedAuthoringBundleV4(bundle)).toEqual(bundle);
    expect(getGuidedAuthoringBundleV4Schema()).toMatchObject({
      additionalProperties: false,
      properties: {
        artifacts: { type: "array" },
        assignmentId: { type: "string" },
        bundleVersion: { const: "workbench-authoring-v4" },
        evidenceRevision: { type: "string" },
        opportunityDispositions: { type: "array" },
        sessionEnrichments: { type: "array" }
      },
      required: [
        "bundleVersion",
        "assignmentId",
        "evidenceRevision",
        "sessionEnrichments",
        "opportunityDispositions",
        "artifacts"
      ],
      title: "GuidedAuthoringBundleV4",
      type: "object"
    });
  });

  test("accepts an authored opportunity linked to exactly one artifact draft of the same kind", () => {
    const bundle = validGuidedBundle();
    bundle.artifacts = [validAdrDraft()];
    bundle.opportunityDispositions = [{
      artifactDraftId: "draft:adr:one",
      artifactKind: "adr",
      disposition: "authored",
      evidenceRefs: ["message:a:5"],
      opportunityId: "opportunity:adr:one",
      rationale: "The selected session records a durable decision and the alternatives that were considered."
    }];

    expect(parseGuidedAuthoringBundleV4(bundle)).toEqual(bundle);
  });

  test("accepts a changed-kind opportunity linked to one artifact draft of the new kind", () => {
    const bundle = validGuidedBundle();
    bundle.artifacts = [validAdrDraft()];
    bundle.opportunityDispositions = [changedKindDisposition()];

    expect(parseGuidedAuthoringBundleV4(bundle)).toEqual(bundle);
  });

  test("accepts an opportunity merged into another persisted opportunity", () => {
    const bundle = validGuidedBundle();
    bundle.opportunityDispositions = [mergedDisposition()];

    expect(parseGuidedAuthoringBundleV4(bundle)).toEqual(bundle);
  });

  test("accepts an empty disposition array for an assignment with no opportunities", () => {
    const bundle = validGuidedBundle({ opportunities: [] });

    expect(parseGuidedAuthoringBundleV4(bundle)).toEqual(bundle);
  });

  test.each([
    ["session claim support", (bundle: Record<string, any>) => { bundle.sessionEnrichments[0].claimSupport = []; }],
    ["opportunity dispositions field", (bundle: Record<string, any>) => { delete bundle.opportunityDispositions; }],
    ["evidence revision", (bundle: Record<string, any>) => { bundle.evidenceRevision = ""; }]
  ])("rejects missing %s", (_label, mutate) => {
    const bundle = validGuidedBundle() as unknown as Record<string, any>;
    mutate(bundle);

    expect(() => parseGuidedAuthoringBundleV4(bundle)).toThrow("invalid_guided_authoring_bundle");
  });

  test.each([
    ["bundle", (bundle: Record<string, any>) => { bundle.unexpected = true; }],
    ["session enrichment", (bundle: Record<string, any>) => { bundle.sessionEnrichments[0].unexpected = true; }],
    ["claim support", (bundle: Record<string, any>) => { bundle.sessionEnrichments[0].claimSupport[0].unexpected = true; }],
    ["opportunity disposition", (bundle: Record<string, any>) => { bundle.opportunityDispositions[0].unexpected = true; }],
    ["artifact draft", (bundle: Record<string, any>) => {
      bundle.artifacts = [validAdrDraft()];
      bundle.artifacts[0].unexpected = true;
    }]
  ])("rejects an additional property on the %s", (_label, mutate) => {
    const bundle = validGuidedBundle() as unknown as Record<string, any>;
    mutate(bundle);

    expect(() => parseGuidedAuthoringBundleV4(bundle)).toThrow("invalid_guided_authoring_bundle");
  });

  test.each([
    ["assignment ID", (bundle: Record<string, any>) => { bundle.assignmentId = "   "; }],
    ["session ID", (bundle: Record<string, any>) => { bundle.sessionEnrichments[0].sessionId = ""; }],
    ["support path", (bundle: Record<string, any>) => { bundle.sessionEnrichments[0].claimSupport[0].path = ""; }],
    ["support evidence ref", (bundle: Record<string, any>) => { bundle.sessionEnrichments[0].claimSupport[0].evidenceRef = ""; }],
    ["support excerpt", (bundle: Record<string, any>) => { bundle.sessionEnrichments[0].claimSupport[0].excerpt = ""; }],
    ["opportunity ID", (bundle: Record<string, any>) => { bundle.opportunityDispositions[0].opportunityId = ""; }],
    ["disposition rationale", (bundle: Record<string, any>) => { bundle.opportunityDispositions[0].rationale = ""; }]
  ])("rejects a blank %s", (_label, mutate) => {
    const bundle = validGuidedBundle() as unknown as Record<string, any>;
    mutate(bundle);

    expect(() => parseGuidedAuthoringBundleV4(bundle)).toThrow("invalid_guided_authoring_bundle");
  });

  test("rejects an empty disposition evidence array", () => {
    const bundle = validGuidedBundle();
    bundle.opportunityDispositions[0]!.evidenceRefs = [];

    expect(() => parseGuidedAuthoringBundleV4(bundle)).toThrow("invalid_guided_authoring_bundle");
  });

  test.each(["sessionTitle", "sessionSummary", "sessionDossier"])(
    "accepts a claim support path below /%s",
    (root) => {
      const bundle = validGuidedBundle();
      bundle.sessionEnrichments[0]!.claimSupport[0]!.path = `/${root}/supported`;

      expect(parseGuidedAuthoringBundleV4(bundle)).toEqual(bundle);
    }
  );

  test.each(["title", "/artifact/title", "/session", "/sessionTitleish/text"])(
    "rejects the session support path %s",
    (path) => {
      const bundle = validGuidedBundle();
      bundle.sessionEnrichments[0]!.claimSupport[0]!.path = path;

      expect(() => parseGuidedAuthoringBundleV4(bundle)).toThrow("invalid_guided_authoring_bundle");
    }
  );

  test.each([
    ["session enrichment", (bundle: GuidedAuthoringBundleV4) => {
      bundle.sessionEnrichments.push(structuredClone(bundle.sessionEnrichments[0]!));
    }],
    ["opportunity disposition", (bundle: GuidedAuthoringBundleV4) => {
      bundle.opportunityDispositions.push(structuredClone(bundle.opportunityDispositions[0]!));
    }],
    ["artifact draft", (bundle: GuidedAuthoringBundleV4) => {
      bundle.artifacts = [validAdrDraft(), structuredClone(validAdrDraft())];
    }]
  ])("rejects a duplicate %s ID", (_label, mutate) => {
    const bundle = validGuidedBundle();
    mutate(bundle);

    expect(() => parseGuidedAuthoringBundleV4(bundle)).toThrow("invalid_guided_authoring_bundle");
  });

  test.each([
    ["authored without an artifact kind", authoredDisposition({ artifactKind: undefined })],
    ["authored without an artifact draft", authoredDisposition({ artifactDraftId: undefined })],
    ["changed kind without an artifact kind", changedKindDisposition({ artifactKind: undefined })],
    ["changed kind without an artifact draft", changedKindDisposition({ artifactDraftId: undefined })],
    ["merged without a target", mergedDisposition({ mergedIntoOpportunityId: undefined })],
    ["dismissed with artifact linkage", dismissedDisposition({ artifactDraftId: "draft:adr:one", artifactKind: "adr" })],
    ["dismissed with merge linkage", dismissedDisposition({ mergedIntoOpportunityId: "opportunity:other" })],
    ["merged with artifact linkage", mergedDisposition({ artifactDraftId: "draft:adr:one", artifactKind: "adr" })]
  ])("rejects %s", (_label, disposition) => {
    const bundle = validGuidedBundle();
    bundle.artifacts = [validAdrDraft()];
    bundle.opportunityDispositions = [disposition as GuidedAuthoringBundleV4["opportunityDispositions"][number]];

    expect(() => parseGuidedAuthoringBundleV4(bundle)).toThrow("invalid_guided_authoring_bundle");
  });

  test("defers artifact linkage to a missing draft to structured quality review", () => {
    const bundle = validGuidedBundle();
    bundle.opportunityDispositions = [authoredDisposition({ artifactDraftId: "draft:missing" })];

    expect(parseGuidedAuthoringBundleV4(bundle)).toEqual(bundle);
  });

  test("defers a linked draft kind mismatch to structured quality review", () => {
    const bundle = validGuidedBundle();
    bundle.artifacts = [validAdrDraft()];
    bundle.opportunityDispositions = [authoredDisposition({ artifactKind: "runbook" })];

    expect(parseGuidedAuthoringBundleV4(bundle)).toEqual(bundle);
  });

  test("defers reuse of one draft by multiple dispositions to structured quality review", () => {
    const bundle = validGuidedBundle();
    bundle.artifacts = [validAdrDraft()];
    bundle.opportunityDispositions = [
      authoredDisposition(),
      authoredDisposition({ opportunityId: "opportunity:adr:two" })
    ];

    expect(parseGuidedAuthoringBundleV4(bundle)).toEqual(bundle);
  });

  test("defers an unlinked submitted draft to structured quality review", () => {
    const bundle = validGuidedBundle();
    bundle.artifacts = [validAdrDraft()];

    expect(parseGuidedAuthoringBundleV4(bundle)).toEqual(bundle);
  });

  test.each([
    ["blank seed session ID", (draft: GuidedAuthoringBundleV4["artifacts"][number]) => {
      draft.seedSessionId = " ";
    }],
    ["blank provenance session ID", (draft: GuidedAuthoringBundleV4["artifacts"][number]) => {
      draft.provenanceSessionIds = ["session:a", ""];
    }],
    ["duplicate provenance session ID", (draft: GuidedAuthoringBundleV4["artifacts"][number]) => {
      draft.provenanceSessionIds = ["session:a", "session:a"];
    }]
  ])("rejects an artifact draft with a %s", (_label, mutate) => {
    const bundle = validGuidedBundle();
    const draft = validAdrDraft();
    mutate(draft);
    bundle.artifacts = [draft];
    bundle.opportunityDispositions = [authoredDisposition()];

    expect(() => parseGuidedAuthoringBundleV4(bundle)).toThrow("invalid_guided_authoring_bundle");
  });
});

function validGuidedBundle(
  options: { opportunities?: Array<"dismissed"> } = {}
): GuidedAuthoringBundleV4 {
  return {
    artifacts: [],
    assignmentId: "assignment:one",
    bundleVersion: "workbench-authoring-v4",
    evidenceRevision: "evidence:v4:one",
    opportunityDispositions: (options.opportunities ?? ["dismissed"]).map(() => dismissedDisposition()),
    sessionEnrichments: [{
      claimSupport: [
        support("/sessionTitle/text", "reuse", "The authoring daemon must remain bound to one local Masthead instance."),
        support("/sessionSummary/text", "outcome", "The selected session was converted into durable, evidence-backed knowledge."),
        support("/sessionDossier/purpose", "purpose", "The user asked for guided authoring that produces reusable artifacts."),
        support("/sessionDossier/outcome", "outcome", "The implementation defined one fail-closed V4 authoring contract."),
        support("/sessionDossier/keyWork/0", "change", "The V4 bundle records typed support for each substantive session claim."),
        support("/sessionDossier/blockers/0", "blocker", "No unresolved implementation blocker remained after the schema contract passed."),
        support("/sessionDossier/continuation/constraints/0", "continuation", "Future authoring must keep legacy V1 through V3 records audit-only.")
      ],
      enrichment: durableEnrichment(),
      sessionId: "session:a"
    }]
  };
}

function support(
  path: string,
  supportKind: GuidedAuthoringBundleV4["sessionEnrichments"][number]["claimSupport"][number]["supportKind"],
  excerpt: string
): GuidedAuthoringBundleV4["sessionEnrichments"][number]["claimSupport"][number] {
  return { evidenceRef: "message:a:5", excerpt, path, supportKind };
}

function durableEnrichment(): DurableSessionEnrichment {
  return {
    sessionDossier: {
      blockers: [],
      continuation: { constraints: ["Keep legacy authoring records audit-only."], openQuestions: [] },
      decisions: ["Keep V4 separate from the legacy authoring repository."],
      evidenceRefs: [],
      keyWork: ["Defined the V4 guided-authoring bundle and response DTOs."],
      outcome: "The V4 contract is strict while zero-opportunity assignments remain valid.",
      purpose: "Define a grounded, instance-bound authoring contract.",
      verification: {
        commands: ["npx vitest run src/workbench/authoring/__tests__/guidedAuthoringSchemas.test.ts"],
        evidenceRefs: [],
        failures: [],
        status: "passed",
        summary: "Focused schema tests passed."
      },
      warnings: []
    },
    sessionSummary: {
      confidence: "high",
      evidenceRefs: [],
      state: "completed",
      text: "Defined a strict guided-authoring contract with typed claim support."
    },
    sessionTitle: {
      basis: "dominant_work",
      confidence: "high",
      evidenceRefs: [],
      text: "Define guided authoring V4"
    },
    version: "session-capsule-v4"
  };
}

function dismissedDisposition(
  overrides: Record<string, unknown> = {}
): GuidedAuthoringBundleV4["opportunityDispositions"][number] {
  return {
    disposition: "dismissed",
    evidenceRefs: ["message:a:5"],
    opportunityId: "opportunity:runbook:one",
    rationale: "The evidence describes a one-time schema change and does not support an operational runbook.",
    ...overrides
  } as GuidedAuthoringBundleV4["opportunityDispositions"][number];
}

function authoredDisposition(overrides: Record<string, unknown> = {}) {
  return {
    artifactDraftId: "draft:adr:one",
    artifactKind: "adr",
    disposition: "authored",
    evidenceRefs: ["message:a:5"],
    opportunityId: "opportunity:adr:one",
    rationale: "The evidence records a durable authoring decision with alternatives and consequences.",
    ...overrides
  } as GuidedAuthoringBundleV4["opportunityDispositions"][number];
}

function changedKindDisposition(overrides: Record<string, unknown> = {}) {
  return {
    ...authoredDisposition(),
    disposition: "changed_kind",
    ...overrides
  } as GuidedAuthoringBundleV4["opportunityDispositions"][number];
}

function mergedDisposition(overrides: Record<string, unknown> = {}) {
  return {
    disposition: "merged",
    evidenceRefs: ["message:a:5"],
    mergedIntoOpportunityId: "opportunity:adr:other",
    opportunityId: "opportunity:adr:one",
    rationale: "The same supported decision is represented by the target opportunity.",
    ...overrides
  } as GuidedAuthoringBundleV4["opportunityDispositions"][number];
}

function validAdrDraft(): GuidedAuthoringBundleV4["artifacts"][number] {
  return {
    draftId: "draft:adr:one",
    kind: "adr",
    output: {
      alternatives: ["Continue with selection-scoped V3 authoring"],
      claimSupport: [{
        evidenceRef: "message:a:5",
        excerpt: "The daemon must guide one bounded assignment through complete evidence inspection.",
        path: "decision",
        supportKind: "decision"
      }],
      confidence: "high",
      consequences: ["Every published claim remains traceable to canonical evidence."],
      context: "Bulk deterministic dossiers were published without useful model enrichment.",
      decision: "Use daemon-owned guided authoring assignments.",
      evidenceRefs: ["message:a:5"],
      missingEvidence: [],
      provenanceSessionIds: ["session:a"],
      status: "accepted",
      title: "Adopt guided authoring assignments"
    },
    provenanceSessionIds: ["session:a"],
    seedSessionId: "session:a"
  };
}
