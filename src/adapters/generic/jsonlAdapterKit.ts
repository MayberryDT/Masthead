import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AdapterRecord, DiscoveredSource, NormalizedAdapterPayload, SourceConfidence } from "../types.ts";

export type JsonlShapeProfile = {
  runtime: string;
  fallbackSessionId?: (source: DiscoveredSource) => string | undefined;
  ignoreUnrecognizedRecords?: boolean;
  sessionIdKeys: string[];
  observedAtKeys: string[];
  roleKeys: string[];
  textKeys: string[];
  toolNameKeys: string[];
  toolOutputKeys: string[];
  usageKeys: {
    model?: string[];
    inputTokens?: string[];
    outputTokens?: string[];
    totalTokens?: string[];
  };
};

export async function* backfillJsonlSource(
  source: DiscoveredSource,
  profile: JsonlShapeProfile,
  options: { confidence?: SourceConfidence } = {}
): AsyncIterable<AdapterRecord> {
  if (!source.path) return;
  const text = await readFile(source.path, "utf8");
  const confidence = options.confidence ?? "heuristic";
  let lineNumber = 0;

  for (const line of text.split("\n")) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      yield diagnosticRecord(source, lineNumber, trimmed, "jsonl_invalid_line");
      continue;
    }
    const normalized = normalizeJsonlPayload(payload, profile, source, confidence);
    if (!normalized) {
      if (profile.ignoreUnrecognizedRecords) continue;
      yield diagnosticRecord(source, lineNumber, trimmed, `${source.runtime}_schema_not_recognized`);
      continue;
    }
    yield {
      diagnostics: [],
      normalized,
      observedAt: readString(payload, profile.observedAtKeys) ?? new Date(0).toISOString(),
      payload,
      payloadHash: hash(trimmed),
      source,
      sourceRecordKey: `${source.path}:${lineNumber}`
    };
  }
}

export function normalizeJsonlPayload(
  payload: unknown,
  profile: JsonlShapeProfile,
  source: DiscoveredSource,
  confidence: SourceConfidence
): NormalizedAdapterPayload | undefined {
  if (!isRecord(payload)) return undefined;
  const sessionId = readString(payload, profile.sessionIdKeys) ?? profile.fallbackSessionId?.(source);
  if (!sessionId) return undefined;
  const observedAt = readString(payload, profile.observedAtKeys) ?? new Date(0).toISOString();
  const role = readString(payload, profile.roleKeys);
  const text = readText(payload, profile.textKeys);
  const toolName = readString(payload, profile.toolNameKeys);
  const toolOutput = readString(payload, profile.toolOutputKeys);

  if (role && text) return adapterPayload("message", confidence, source, { observedAt, role: normalizeRole(role), sessionId, text });
  if (toolName) return adapterPayload("tool_call", confidence, source, { arguments: {}, observedAt, sessionId, toolName });
  if (toolOutput) return adapterPayload("tool_result", confidence, source, { observedAt, output: toolOutput, sessionId, status: "unknown" });

  const totalTokens = readNumber(payload, profile.usageKeys.totalTokens ?? []);
  const inputTokens = readNumber(payload, profile.usageKeys.inputTokens ?? []);
  const outputTokens = readNumber(payload, profile.usageKeys.outputTokens ?? []);
  const model = readString(payload, profile.usageKeys.model ?? []);
  if (totalTokens !== undefined || inputTokens !== undefined || outputTokens !== undefined || model) {
    return adapterPayload("usage", confidence, source, { inputTokens, model, observedAt, outputTokens, sessionId, totalTokens });
  }

  return undefined;
}

export function adapterPayload(
  kind: NormalizedAdapterPayload["kind"],
  confidence: SourceConfidence,
  source: DiscoveredSource,
  value: unknown
): NormalizedAdapterPayload {
  return {
    confidence,
    kind,
    sourceRef: {
      endpoint: source.endpoint,
      runtimeVersion: source.runtimeVersion,
      schemaVersion: source.schemaVersion,
      sourceKind: source.sourceKind,
      sourcePath: source.path
    },
    value
  };
}

export function readString(payload: unknown, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readPath(payload, key);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function readText(payload: unknown, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readPath(payload, key);
    const text = textFromValue(value);
    if (text) return text;
  }
  return undefined;
}

function textFromValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const parts = value.map((item) => textFromContentPart(item)).filter((item): item is string => Boolean(item));
    const text = parts.join("\n\n").trim();
    return text || undefined;
  }
  if (!isRecord(value)) return undefined;
  const direct = readString(value, ["text", "content"]);
  if (direct) return direct;
  const nested = textFromValue(value.parts) ?? textFromValue(value.content);
  return nested;
}

function textFromContentPart(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!isRecord(value)) return undefined;
  const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
  if (type === "thinking" || type === "toolcall" || type === "tool_call") return undefined;
  return readString(value, ["text", "content"]);
}

export function readNumber(payload: unknown, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = readPath(payload, key);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

export function readPath(payload: unknown, path: string): unknown {
  let current = payload;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

export function normalizeRole(role: string): string {
  const lower = role.toLowerCase();
  if (lower.includes("user") || lower.includes("human")) return "user";
  if (lower.includes("assistant") || lower.includes("agent")) return "assistant";
  if (lower.includes("system")) return "system";
  if (lower.includes("tool")) return "tool";
  return lower;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function diagnosticRecord(source: DiscoveredSource, lineNumber: number, line: string, code: string): AdapterRecord {
  const now = new Date().toISOString();
  return {
    diagnostics: [{ code, message: "Detected, import blocked: schema not recognized.", observedAt: now, severity: "warning" }],
    normalized: adapterPayload("runtime_signal", "heuristic", source, {
      message: "Detected, import blocked: schema not recognized.",
      observedAt: now,
      severity: "warning",
      signalKind: "adapter_diagnostic"
    }),
    observedAt: now,
    payload: { lineNumber },
    payloadHash: hash(line),
    source,
    sourceRecordKey: `${source.path}:${lineNumber}:diagnostic`
  };
}
