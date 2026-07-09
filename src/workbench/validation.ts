import { redactText } from "../core/redaction.ts";
import { getWorkbenchSchema, isWorkbenchOutputKind } from "./schemas.ts";
import type { WorkbenchEvidencePacket, WorkbenchOutputKind, WorkbenchValidationIssue, WorkbenchValidationResult } from "./types.ts";

const GENERIC_TITLES = new Set(["updated files", "session work", "recent activity", "codex hook event", "masthead session", "work completed", "done"]);

export function validateWorkbenchOutput(
  kind: WorkbenchOutputKind,
  output: unknown,
  evidencePacket?: WorkbenchEvidencePacket
): WorkbenchValidationResult {
  const errors: WorkbenchValidationIssue[] = [];
  const warnings: WorkbenchValidationIssue[] = [];

  if (!isWorkbenchOutputKind(kind)) {
    return {
      errors: [{ code: "unknown_kind", message: `Unknown Workbench schema kind: ${kind}` }],
      ok: false,
      warnings
    };
  }

  if (!isRecord(output)) {
    return {
      errors: [{ code: "invalid_output", message: "Workbench output must be a JSON object." }],
      ok: false,
      warnings
    };
  }

  const schema = getWorkbenchSchema(kind);
  errors.push(...validateSchemaObject(output, schema));
  for (const required of schema.required) {
    if (!(required in output)) errors.push({ code: "missing_required", message: `Missing required field: ${required}` });
  }

  const title = stringField(output, "title");
  if (title !== undefined && GENERIC_TITLES.has(title.trim().toLowerCase())) {
    errors.push({ code: "generic_title", message: `Title is too generic: ${title}` });
  }

  const evidenceRefs = stringArrayField(output, "evidenceRefs");
  if (evidenceRefs && evidencePacket) {
    const knownRefs = evidenceRefsForPacket(evidencePacket);
    for (const ref of evidenceRefs) {
      if (!knownRefs.has(ref)) errors.push({ code: "unknown_evidence_ref", message: `Evidence ref is not present in the packet: ${ref}` });
    }
    if (output.confidence === "high" && evidenceRefs.length <= 1) {
      warnings.push({
        code: "thin_evidence",
        message: "High-confidence output should cite more than one evidence ref when packet coverage is partial."
      });
    }
  }

  if (containsUnredactedSecret(output)) {
    errors.push({ code: "secret_detected", message: "Output contains secret-looking values." });
  }

  return { errors, ok: errors.length === 0, warnings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
}

function evidenceRefsForPacket(packet: WorkbenchEvidencePacket): Set<string> {
  return new Set([
    ...packet.sourceRefs,
    ...packet.transcript.map((entry) => entry.ref),
    ...packet.files.map((entry) => entry.ref),
    ...packet.tools.map((entry) => entry.ref),
    ...packet.verification.map((entry) => entry.ref),
    ...packet.timeline.map((entry) => entry.ref)
  ]);
}

function containsUnredactedSecret(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return Boolean(serialized && redactText(serialized) !== serialized);
}

function validateSchemaObject(record: Record<string, unknown>, schema: { properties: Record<string, unknown>; additionalProperties: boolean }): WorkbenchValidationIssue[] {
  const issues: WorkbenchValidationIssue[] = [];
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(record)) {
      if (!(key in schema.properties)) issues.push({ code: "unexpected_property", message: `Unexpected field: ${key}` });
    }
  }
  for (const [key, definition] of Object.entries(schema.properties)) {
    if (!(key in record)) continue;
    issues.push(...validateValue(key, record[key], definition));
  }
  return issues;
}

function validateValue(path: string, value: unknown, definition: unknown): WorkbenchValidationIssue[] {
  if (!isRecord(definition)) return [];
  if ("enum" in definition && Array.isArray(definition.enum) && !definition.enum.includes(value)) {
    return [{ code: "invalid_type", message: `Field ${path} must be one of: ${definition.enum.join(", ")}.` }];
  }
  if (definition.type === "string") {
    return typeof value === "string" ? [] : [{ code: "invalid_type", message: `Field ${path} must be a string.` }];
  }
  if (definition.type === "array") {
    if (!Array.isArray(value)) return [{ code: "invalid_type", message: `Field ${path} must be an array.` }];
    return value.flatMap((entry, index) => validateArrayItem(`${path}[${index}]`, entry, definition.items));
  }
  if (definition.type === "object") {
    if (!isRecord(value)) return [{ code: "invalid_type", message: `Field ${path} must be an object.` }];
    return validateNestedObject(path, value, definition);
  }
  return [];
}

function validateArrayItem(path: string, value: unknown, definition: unknown): WorkbenchValidationIssue[] {
  if (!isRecord(definition)) return [];
  if (definition.type === "string") {
    return typeof value === "string" ? [] : [{ code: "invalid_type", message: `Field ${path} must be a string.` }];
  }
  if (definition.type === "object") {
    if (!isRecord(value)) return [{ code: "invalid_type", message: `Field ${path} must be an object.` }];
    return validateNestedObject(path, value, definition);
  }
  return [];
}

function validateNestedObject(path: string, value: Record<string, unknown>, definition: Record<string, unknown>): WorkbenchValidationIssue[] {
  const issues: WorkbenchValidationIssue[] = [];
  const properties = isRecord(definition.properties) ? definition.properties : {};
  const required = Array.isArray(definition.required) ? definition.required.filter((entry): entry is string => typeof entry === "string") : [];
  for (const key of required) {
    if (!(key in value)) issues.push({ code: "missing_required", message: `Missing required field: ${path}.${key}` });
  }
  if (definition.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) issues.push({ code: "unexpected_property", message: `Unexpected field: ${path}.${key}` });
    }
  }
  for (const [key, propertyDefinition] of Object.entries(properties)) {
    if (key in value) issues.push(...validateValue(`${path}.${key}`, value[key], propertyDefinition));
  }
  return issues;
}
