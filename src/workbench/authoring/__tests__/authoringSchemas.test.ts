import { describe, expect, test } from "vitest";
import type {
  WorkbenchArtifactDraft,
  WorkbenchAuthoringBundleV3
} from "../../../shared/workbenchAuthoring.ts";
import type { DurableSessionEnrichment } from "../../../shared/sessionEnrichment.ts";
import { getAuthoringBundleV3Schema, parseAuthoringBundleV3 } from "../authoringSchemas.ts";

describe("Workbench authoring V3 schema", () => {
  test("accepts required session enrichment with no optional artifacts", () => {
    const bundle = validBundle();

    expect(parseAuthoringBundleV3(bundle)).toEqual(bundle);
    expect(getAuthoringBundleV3Schema()).toMatchObject({
      additionalProperties: false,
      properties: {
        artifacts: { type: "array" },
        bundleVersion: { const: "workbench-authoring-v3" },
        evidenceRevision: { type: "string" },
        runId: { type: "string" },
        sessionEnrichments: { type: "array" }
      },
      required: ["bundleVersion", "runId", "evidenceRevision", "sessionEnrichments", "artifacts"],
      title: "WorkbenchAuthoringBundleV3",
      type: "object"
    });
  });

  test("accepts multiple different optional artifact kinds with verbatim claim support", () => {
    const bundle = validBundle();
    bundle.artifacts = [validAdrDraft(), validIncidentTimelineDraft()];

    expect(parseAuthoringBundleV3(bundle)).toEqual(bundle);
  });

  test.each(["sessionDossiers", "candidateId", "notApplicable", "contributions"])(
    "rejects the forbidden %s property",
    (property) => {
      const bundle = { ...validBundle(), [property]: [] };

      expect(() => parseAuthoringBundleV3(bundle)).toThrow(
        `unexpected_authoring_bundle_property:${property}`
      );
    }
  );

  test("rejects agent-authored dossier bodies", () => {
    const bundle = validBundle();
    bundle.artifacts = [{
      kind: "session_dossier",
      output: {},
      provenanceSessionIds: ["session:a"],
      seedSessionId: "session:a"
    } as never];

    expect(() => parseAuthoringBundleV3(bundle)).toThrow("invalid_authoring_bundle:artifacts[0]");
  });

  test("requires an enrichment object for every session enrichment entry", () => {
    const bundle = validBundle();
    bundle.sessionEnrichments = [{ sessionId: "session:a" } as never];

    expect(() => parseAuthoringBundleV3(bundle)).toThrow(
      "invalid_authoring_bundle:sessionEnrichments[0].enrichment"
    );
  });
});

function validBundle(): WorkbenchAuthoringBundleV3 {
  return {
    artifacts: [],
    bundleVersion: "workbench-authoring-v3",
    evidenceRevision: "evidence:v3",
    runId: "authoring:v3",
    sessionEnrichments: [{
      enrichment: durableEnrichment("Restore agent-led authoring"),
      sessionId: "session:a"
    }]
  };
}

function durableEnrichment(title: string): DurableSessionEnrichment {
  return {
    sessionDossier: {
      blockers: [],
      continuation: { constraints: [], openQuestions: [] },
      decisions: ["Use a selection-scoped authoring contract."],
      evidenceRefs: [],
      keyWork: ["Defined the V3 authoring contract."],
      verification: {
        commands: ["npx vitest run"],
        evidenceRefs: [],
        failures: [],
        status: "passed",
        summary: "Focused tests passed."
      },
      warnings: []
    },
    sessionSummary: {
      confidence: "high",
      evidenceRefs: [],
      state: "completed",
      text: "Restored agent-led selection-scoped authoring."
    },
    sessionTitle: {
      basis: "dominant_work",
      confidence: "high",
      evidenceRefs: [],
      text: title
    },
    version: "session-capsule-v4"
  };
}

function validAdrDraft(): WorkbenchArtifactDraft {
  return {
    kind: "adr",
    output: {
      alternatives: ["Keep candidate-scoped authoring"],
      claimSupport: [{
        evidenceRef: "message:a:1",
        excerpt: "The selected sessions should drive one authoring run.",
        path: "decision",
        supportKind: "decision"
      }],
      confidence: "high",
      consequences: ["Selected sessions receive durable enrichment."],
      context: "The Workbench selection is the collaboration boundary.",
      decision: "Author one bundle for the selected sessions.",
      evidenceRefs: ["message:a:1"],
      missingEvidence: [],
      provenanceSessionIds: ["session:a"],
      status: "accepted",
      title: "Use selection-scoped authoring"
    },
    provenanceSessionIds: ["session:a"],
    seedSessionId: "session:a"
  };
}

function validIncidentTimelineDraft(): WorkbenchArtifactDraft {
  return {
    kind: "incident_timeline",
    output: {
      claimSupport: [{
        evidenceRef: "message:a:1",
        excerpt: "Candidate-only authoring prevented the selected-session workflow.",
        path: "symptom",
        supportKind: "problem"
      }],
      confidence: "high",
      contributingFactors: [],
      evidenceRefs: ["message:a:1"],
      impact: "Selected sessions could not be authored together.",
      missingEvidence: [],
      prevention: ["Keep selection-scoped schema coverage."],
      provenanceSessionIds: ["session:a"],
      remediation: ["Introduce the V3 authoring bundle."],
      status: "resolved",
      symptom: "Candidate-only authoring blocked the selection workflow.",
      timeline: [{
        at: "2026-07-14T00:00:00.000Z",
        evidenceRefs: ["message:a:1"],
        summary: "The V3 contract restored selection-scoped authoring."
      }],
      title: "Restore selected-session authoring"
    },
    provenanceSessionIds: ["session:a"],
    seedSessionId: "session:a"
  };
}
