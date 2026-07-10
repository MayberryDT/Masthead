import { getWorkbenchSchema, type WorkbenchJsonSchema } from "../schemas.ts";
import type { WorkbenchOutputKind } from "../types.ts";

const stringField = { type: "string" };
const stringArray = { items: stringField, type: "array" };
const automaticKinds = ["runbook", "adr", "incident_timeline"] as const;

const claimEvidence = {
  items: {
    additionalProperties: false,
    properties: {
      evidenceRefs: stringArray,
      path: stringField
    },
    required: ["path", "evidenceRefs"],
    type: "object"
  },
  type: "array"
};

export function getWorkbenchAuthoringOutputSchema(kind: WorkbenchOutputKind): WorkbenchJsonSchema {
  const v1 = getWorkbenchSchema(kind);
  return {
    ...v1,
    properties: {
      ...v1.properties,
      claimEvidence
    },
    required: [...v1.required, "claimEvidence"],
    title: `${v1.title}V2`
  };
}

export function getAuthoringBundleSchema(): WorkbenchJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    properties: {
      artifacts: {
        items: {
          oneOf: automaticKinds.map((kind) => ({
            additionalProperties: false,
            properties: {
              kind: { const: kind },
              output: getWorkbenchAuthoringOutputSchema(kind),
              provenanceSessionIds: stringArray,
              seedSessionId: stringField
            },
            required: ["kind", "seedSessionId", "provenanceSessionIds", "output"],
            type: "object"
          }))
        },
        type: "array"
      },
      bundleVersion: { const: "workbench-authoring-v1" },
      contributions: {
        items: {
          additionalProperties: false,
          properties: {
            kind: { enum: automaticKinds },
            publishedArtifactId: stringField,
            sessionId: stringField
          },
          required: ["sessionId", "kind", "publishedArtifactId"],
          type: "object"
        },
        type: "array"
      },
      evidenceRevision: stringField,
      notApplicable: {
        items: {
          additionalProperties: false,
          properties: {
            evidenceRefs: stringArray,
            kind: { enum: automaticKinds },
            reason: stringField,
            sessionId: stringField
          },
          required: ["sessionId", "kind", "reason", "evidenceRefs"],
          type: "object"
        },
        type: "array"
      },
      runId: stringField,
      sessionPackages: {
        items: {
          additionalProperties: false,
          properties: {
            dossier: getWorkbenchAuthoringOutputSchema("session_dossier"),
            enrichment: getWorkbenchAuthoringOutputSchema("session_enrichment"),
            sessionId: stringField
          },
          required: ["sessionId", "enrichment", "dossier"],
          type: "object"
        },
        type: "array"
      }
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
  };
}
