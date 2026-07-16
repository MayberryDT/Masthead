import { getWorkbenchSchema, type WorkbenchJsonSchema } from "../schemas.ts";
import type { WorkbenchOutputKind } from "../types.ts";
import type {
  WorkbenchAuthoringBundleV2,
  WorkbenchAuthoringBundleV3
} from "../../shared/workbenchAuthoring.ts";

const stringField = { type: "string" };
const stringArray = { items: stringField, type: "array" };
const automaticKinds = ["runbook", "adr", "incident_timeline"] as const;
const confidence = { enum: ["high", "medium", "low"] };
const evidenceRef = {
  additionalProperties: false,
  properties: {
    id: stringField,
    kind: { enum: ["event", "command", "git_snapshot", "file_change", "conflict", "redaction"] },
    observedAt: stringField,
    source: stringField
  },
  required: ["id", "kind", "observedAt", "source"],
  type: "object"
};
const evidenceRefArray = { items: evidenceRef, type: "array" };

const durableSessionEnrichment = {
  additionalProperties: false,
  properties: {
    generatedAt: stringField,
    model: stringField,
    promptVersion: stringField,
    sessionDossier: {
      additionalProperties: false,
      properties: {
        blockers: stringArray,
        continuation: {
          additionalProperties: false,
          properties: {
            constraints: stringArray,
            nextStep: stringField,
            openQuestions: stringArray
          },
          required: ["openQuestions", "constraints"],
          type: "object"
        },
        decisions: stringArray,
        evidenceRefs: evidenceRefArray,
        keyWork: stringArray,
        outcome: stringField,
        purpose: stringField,
        verification: {
          additionalProperties: false,
          properties: {
            commands: stringArray,
            evidenceRefs: evidenceRefArray,
            failures: stringArray,
            status: { enum: ["passed", "failed", "mixed", "missing", "unknown"] },
            summary: stringField
          },
          required: ["status", "summary", "commands", "failures", "evidenceRefs"],
          type: "object"
        },
        warnings: stringArray
      },
      required: [
        "keyWork",
        "decisions",
        "blockers",
        "verification",
        "continuation",
        "evidenceRefs",
        "warnings"
      ],
      type: "object"
    },
    sessionSummary: {
      additionalProperties: false,
      properties: {
        confidence,
        evidenceRefs: evidenceRefArray,
        state: { enum: ["completed", "blocked", "partial", "failed", "paused", "unknown"] },
        text: stringField
      },
      required: ["text", "state", "confidence", "evidenceRefs"],
      type: "object"
    },
    sessionTitle: {
      additionalProperties: false,
      properties: {
        basis: { enum: ["first_prompt", "dominant_work", "final_outcome", "file_cluster", "debug_target", "fallback"] },
        confidence,
        evidenceRefs: evidenceRefArray,
        text: stringField
      },
      required: ["text", "basis", "confidence", "evidenceRefs"],
      type: "object"
    },
    source: { enum: ["remote_model", "deterministic", "manual"] },
    version: { const: "session-capsule-v4" }
  },
  required: ["version", "sessionTitle", "sessionSummary", "sessionDossier"],
  type: "object"
};

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

const claimSupport = {
  items: {
    additionalProperties: false,
    properties: {
      evidenceRef: stringField,
      excerpt: stringField,
      path: stringField,
      supportKind: {
        enum: ["problem", "decision", "alternative", "change", "verification", "timeline", "remediation", "root_cause"]
      }
    },
    required: ["path", "evidenceRef", "excerpt", "supportKind"],
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

export function getWorkbenchAuthoringOutputV2Schema(kind: WorkbenchOutputKind): WorkbenchJsonSchema {
  const v1 = getWorkbenchSchema(kind);
  return {
    ...v1,
    properties: {
      ...v1.properties,
      claimSupport
    },
    required: [...v1.required, "claimSupport"],
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

export function getAuthoringBundleV2Schema(): WorkbenchJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    properties: {
      artifact: {
        oneOf: automaticKinds.map((kind) => ({
          additionalProperties: false,
          properties: {
            kind: { const: kind },
            output: getWorkbenchAuthoringOutputV2Schema(kind),
            provenanceSessionIds: stringArray,
            seedSessionId: stringField
          },
          required: ["kind", "seedSessionId", "provenanceSessionIds", "output"],
          type: "object"
        }))
      },
      bundleVersion: { const: "workbench-authoring-v2" },
      candidateId: stringField,
      evidenceRevision: stringField,
      runId: stringField
    },
    required: ["bundleVersion", "runId", "candidateId", "evidenceRevision", "artifact"],
    title: "WorkbenchAuthoringBundleV2",
    type: "object"
  };
}

export function getAuthoringBundleV3Schema(): WorkbenchJsonSchema {
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
              output: getWorkbenchAuthoringOutputV2Schema(kind),
              provenanceSessionIds: stringArray,
              seedSessionId: stringField
            },
            required: ["kind", "seedSessionId", "provenanceSessionIds", "output"],
            type: "object"
          }))
        },
        type: "array"
      },
      bundleVersion: { const: "workbench-authoring-v3" },
      evidenceRevision: stringField,
      runId: stringField,
      sessionEnrichments: {
        items: {
          additionalProperties: false,
          properties: {
            enrichment: durableSessionEnrichment,
            sessionId: stringField
          },
          required: ["sessionId", "enrichment"],
          type: "object"
        },
        type: "array"
      }
    },
    required: ["bundleVersion", "runId", "evidenceRevision", "sessionEnrichments", "artifacts"],
    title: "WorkbenchAuthoringBundleV3",
    type: "object"
  };
}

export function parseAuthoringBundleV2(value: unknown): WorkbenchAuthoringBundleV2 {
  if (!isRecord(value) || value.bundleVersion !== "workbench-authoring-v2") {
    throw new Error("unsupported_authoring_bundle_version");
  }
  const schema = getAuthoringBundleV2Schema();
  const unexpected = Object.keys(value).find((key) => !Object.hasOwn(schema.properties, key));
  if (unexpected) throw new Error(`unexpected_authoring_bundle_property:${unexpected}`);
  const invalidPath = firstInvalidSchemaPath(value, schema, "");
  if (invalidPath) throw new Error(`invalid_authoring_bundle:${invalidPath}`);
  for (const field of ["runId", "candidateId", "evidenceRevision"] as const) {
    if (!(value[field] as string).trim()) throw new Error(`invalid_authoring_bundle:${field}`);
  }
  return value as WorkbenchAuthoringBundleV2;
}

export function parseAuthoringBundleV3(value: unknown): WorkbenchAuthoringBundleV3 {
  if (!isRecord(value) || value.bundleVersion !== "workbench-authoring-v3") {
    throw new Error("unsupported_authoring_bundle_version");
  }
  const schema = getAuthoringBundleV3Schema();
  const unexpected = Object.keys(value).find((key) => !Object.hasOwn(schema.properties, key));
  if (unexpected) throw new Error(`unexpected_authoring_bundle_property:${unexpected}`);
  const invalidPath = firstInvalidSchemaPath(value, schema, "");
  if (invalidPath) throw new Error(`invalid_authoring_bundle:${invalidPath}`);
  for (const field of ["runId", "evidenceRevision"] as const) {
    if (!(value[field] as string).trim()) throw new Error(`invalid_authoring_bundle:${field}`);
  }
  return value as WorkbenchAuthoringBundleV3;
}

function firstInvalidSchemaPath(value: unknown, definition: unknown, path: string): string | undefined {
  if (!isRecord(definition)) return undefined;
  if ("oneOf" in definition && Array.isArray(definition.oneOf)) {
    const selected = definition.oneOf.find(
      (option) =>
        isRecord(option) &&
        isRecord(option.properties) &&
        isRecord(option.properties.kind) &&
        isRecord(value) &&
        option.properties.kind.const === value.kind
    );
    return selected ? firstInvalidSchemaPath(value, selected, path) : path || "artifact";
  }
  if ("const" in definition) return value === definition.const ? undefined : path;
  if ("enum" in definition && Array.isArray(definition.enum)) {
    return definition.enum.includes(value) ? undefined : path;
  }
  if (definition.type === "string") return typeof value === "string" ? undefined : path;
  if (definition.type === "array") {
    if (!Array.isArray(value)) return path;
    for (let index = 0; index < value.length; index += 1) {
      const invalid = firstInvalidSchemaPath(value[index], definition.items, `${path}[${index}]`);
      if (invalid) return invalid;
    }
    return undefined;
  }
  if (definition.type !== "object") return undefined;
  if (!isRecord(value)) return path || "bundle";
  const properties = isRecord(definition.properties) ? definition.properties : {};
  const required = Array.isArray(definition.required) ? definition.required : [];
  for (const field of required) {
    if (typeof field === "string" && !Object.hasOwn(value, field)) return path ? `${path}.${field}` : field;
  }
  if (definition.additionalProperties === false) {
    const extra = Object.keys(value).find((key) => !Object.hasOwn(properties, key));
    if (extra) return path ? `${path}.${extra}` : extra;
  }
  for (const [field, propertyDefinition] of Object.entries(properties)) {
    if (!Object.hasOwn(value, field)) continue;
    const invalid = firstInvalidSchemaPath(
      value[field],
      propertyDefinition,
      path ? `${path}.${field}` : field
    );
    if (invalid) return invalid;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
