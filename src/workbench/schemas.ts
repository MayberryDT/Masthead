import type { WorkbenchOutputKind } from "./types.ts";

export type WorkbenchJsonSchema = {
  $schema: string;
  title: string;
  type: "object";
  additionalProperties: false;
  required: string[];
  properties: Record<string, unknown>;
};

const confidence = { enum: ["high", "medium", "low"] };
const stringArray = { type: "array", items: { type: "string" } };
const stringField = { type: "string" };

const mastheadEnvelope = {
  title: stringField,
  confidence,
  evidenceRefs: stringArray,
  missingEvidence: stringArray,
  provenanceSessionIds: stringArray,
  joinRationale: stringField,
  signatureKey: stringField
};

const schemas: Record<WorkbenchOutputKind, WorkbenchJsonSchema> = {
  runbook: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    properties: {
      ...mastheadEnvelope,
      problemSignature: {
        type: "object",
        additionalProperties: false,
        required: ["symptoms", "errorStrings", "affectedScope"],
        properties: {
          symptoms: stringArray,
          errorStrings: stringArray,
          affectedScope: stringField
        }
      },
      preconditions: stringArray,
      reproSteps: stringArray,
      deadEnds: stringArray,
      fixSteps: stringArray,
      commands: stringArray,
      changedFiles: stringArray,
      validationChecks: stringArray,
      environmentRequirements: stringArray,
      rootCause: stringField,
      preventionNotes: stringArray,
      risksOrGaps: stringArray
    },
    required: [
      "title",
      "confidence",
      "evidenceRefs",
      "missingEvidence",
      "provenanceSessionIds",
      "problemSignature",
      "preconditions",
      "reproSteps",
      "deadEnds",
      "fixSteps",
      "commands",
      "changedFiles",
      "validationChecks",
      "environmentRequirements",
      "rootCause",
      "preventionNotes",
      "risksOrGaps"
    ],
    title: "RunbookArtifact",
    type: "object"
  },
  adr: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    properties: {
      ...mastheadEnvelope,
      status: stringField,
      context: stringField,
      decision: stringField,
      alternatives: stringArray,
      consequences: stringArray,
      affectedPaths: stringArray,
      supersedes: stringArray
    },
    required: [
      "title",
      "confidence",
      "evidenceRefs",
      "missingEvidence",
      "provenanceSessionIds",
      "status",
      "context",
      "decision",
      "alternatives",
      "consequences"
    ],
    title: "AdrArtifact",
    type: "object"
  },
  incident_timeline: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    properties: {
      ...mastheadEnvelope,
      symptom: stringField,
      impact: stringField,
      timeline: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["at", "summary", "evidenceRefs"],
          properties: {
            at: stringField,
            summary: stringField,
            evidenceRefs: stringArray
          }
        }
      },
      rootCause: stringField,
      contributingFactors: stringArray,
      remediation: stringArray,
      prevention: stringArray,
      status: stringField
    },
    required: [
      "title",
      "confidence",
      "evidenceRefs",
      "missingEvidence",
      "provenanceSessionIds",
      "symptom",
      "impact",
      "timeline",
      "contributingFactors",
      "remediation",
      "prevention",
      "status"
    ],
    title: "IncidentTimelineArtifact",
    type: "object"
  },
  session_dossier: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    properties: {
      approach: stringArray,
      commandsAndTools: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label"],
          properties: {
            label: stringField,
            purpose: stringField,
            status: stringField
          }
        }
      },
      confidence,
      context: stringField,
      evidenceRefs: stringArray,
      filesTouched: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "role"],
          properties: {
            label: stringField,
            role: stringField
          }
        }
      },
      keyDecisions: stringArray,
      lessonsLearned: stringArray,
      missingEvidence: stringArray,
      objective: stringField,
      outcome: stringField,
      problemStatement: stringField,
      risksOrGaps: stringArray,
      title: stringField,
      verification: stringArray
    },
    required: [
      "title",
      "problemStatement",
      "context",
      "approach",
      "keyDecisions",
      "filesTouched",
      "commandsAndTools",
      "outcome",
      "verification",
      "risksOrGaps",
      "lessonsLearned",
      "evidenceRefs",
      "confidence",
      "missingEvidence"
    ],
    title: "SessionDossierArtifact",
    type: "object"
  },
  session_enrichment: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    properties: {
      confidence,
      evidenceRefs: stringArray,
      filesSummary: stringField,
      missingEvidence: stringArray,
      outcome: stringField,
      searchPhrases: stringArray,
      summary: stringField,
      technologies: stringArray,
      title: stringField,
      toolsSummary: stringField,
      topics: stringArray,
      verificationSummary: stringField
    },
    required: ["title", "summary", "topics", "technologies", "searchPhrases", "confidence", "missingEvidence", "evidenceRefs"],
    title: "SessionEnrichmentOutput",
    type: "object"
  }
};

export function listWorkbenchSchemaKinds(): WorkbenchOutputKind[] {
  return ["session_enrichment", "session_dossier", "runbook", "adr", "incident_timeline"];
}

export function getWorkbenchSchema(kind: WorkbenchOutputKind): WorkbenchJsonSchema {
  const schema = schemas[kind];
  if (!schema) throw new Error(`Unknown Workbench schema kind: ${kind}`);
  return schema;
}

export function isWorkbenchOutputKind(value: string | undefined): value is WorkbenchOutputKind {
  return (
    value === "session_enrichment" ||
    value === "session_dossier" ||
    value === "runbook" ||
    value === "adr" ||
    value === "incident_timeline"
  );
}

export function isWorkbenchArtifactKind(value: string | undefined): value is Exclude<WorkbenchOutputKind, "session_enrichment"> {
  return value === "session_dossier" || value === "runbook" || value === "adr" || value === "incident_timeline";
}

export function isMultiSessionCapableKind(kind: WorkbenchOutputKind): boolean {
  return kind === "runbook" || kind === "adr" || kind === "incident_timeline";
}
