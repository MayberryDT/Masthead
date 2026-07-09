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

const schemas: Record<WorkbenchOutputKind, WorkbenchJsonSchema> = {
  bug_fix_trace: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    properties: {
      affectedStack: stringArray,
      confidence,
      evidenceRefs: stringArray,
      failedHypotheses: stringArray,
      fixSummary: stringField,
      missingEvidence: stringArray,
      patchShape: stringArray,
      preventionNotes: stringArray,
      reproduction: stringField,
      risksOrGaps: stringArray,
      rootCause: stringField,
      symptom: stringField,
      title: stringField,
      verification: stringArray
    },
    required: [
      "title",
      "symptom",
      "affectedStack",
      "failedHypotheses",
      "fixSummary",
      "patchShape",
      "verification",
      "preventionNotes",
      "evidenceRefs",
      "confidence",
      "missingEvidence"
    ],
    title: "BugFixTraceArtifact",
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
  return ["session_enrichment", "session_dossier", "bug_fix_trace"];
}

export function getWorkbenchSchema(kind: WorkbenchOutputKind): WorkbenchJsonSchema {
  const schema = schemas[kind];
  if (!schema) throw new Error(`Unknown Workbench schema kind: ${kind}`);
  return schema;
}

export function isWorkbenchOutputKind(value: string | undefined): value is WorkbenchOutputKind {
  return value === "session_enrichment" || value === "session_dossier" || value === "bug_fix_trace";
}
