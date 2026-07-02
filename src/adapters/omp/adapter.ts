import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { adapterPayload, hash, isRecord, normalizeRole } from "../generic/jsonlAdapterKit.ts";
import { createLocalAdapter, genericCodingProfile } from "../generic/localAdapterFactory.ts";
import type { AdapterRecord, DiscoveredSource, SourceConfidence } from "../types.ts";
import { ompCandidatePaths } from "./discovery.ts";

const baseOmpAdapter = createLocalAdapter({
  runtime: "omp",
  candidatePaths: ompCandidatePaths,
  jsonlProfile: genericCodingProfile("omp")
});

export const ompAdapter = {
  ...baseOmpAdapter,
  backfill: backfillOmpSource
};

async function* backfillOmpSource(source: DiscoveredSource): AsyncIterable<AdapterRecord> {
  if (!source.path) return;
  const sessionId = ompSessionIdFromSourcePath(source.path);
  if (!sessionId) return;
  const text = await readFile(source.path, "utf8");
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
    if (!isRecord(payload)) continue;
    const records = ompRecordsFromPayload(source, sessionId, lineNumber, trimmed, payload);
    for (const record of records) yield record;
  }
}

function ompRecordsFromPayload(source: DiscoveredSource, sessionId: string, lineNumber: number, rawLine: string, payload: Record<string, unknown>): AdapterRecord[] {
  if (payload.type === "session") {
    const observedAt = stringValue(payload.timestamp) ?? new Date(0).toISOString();
    return [
      record(source, lineNumber, "session", rawLine, observedAt, payload, "session", {
        cwd: stringValue(payload.cwd),
        observedAt,
        sessionId,
        title: stringValue(payload.title)
      })
    ];
  }
  if (payload.type !== "message" || !isRecord(payload.message)) return [];

  const message = payload.message;
  const observedAt = stringValue(message.timestamp) ?? stringValue(payload.timestamp) ?? new Date(0).toISOString();
  const output: AdapterRecord[] = [];
  const role = normalizeRole(stringValue(message.role) ?? "");
  const parts = contentParts(message.content);
  const text = textFromContentParts(parts);

  if (role === "tool" && text) {
    output.push(
      record(source, lineNumber, "tool_result", rawLine, observedAt, payload, "tool_result", {
        callId: stringValue(message.toolCallId),
        observedAt,
        output: text,
        sessionId,
        status: message.isError === true ? "failed" : "succeeded",
        toolName: stringValue(message.toolName)
      })
    );
  } else if (role && text) {
    output.push(
      record(source, lineNumber, "message", rawLine, observedAt, payload, "message", {
        observedAt,
        role,
        sessionId,
        text
      })
    );
  }

  for (const [index, part] of parts.entries()) {
    if (stringValue(part.type) !== "toolCall") continue;
    output.push(
      record(source, lineNumber, `tool_call:${index}`, rawLine, observedAt, part, "tool_call", {
        arguments: isRecord(part.arguments) ? part.arguments : {},
        callId: stringValue(part.id),
        observedAt,
        sessionId,
        toolName: stringValue(part.name) ?? "tool"
      })
    );
  }

  const usage = usageValue(message.usage);
  if (usage || stringValue(message.model) || stringValue(message.provider)) {
    output.push(
      record(source, lineNumber, "usage", rawLine, observedAt, payload, "usage", {
        inputTokens: usage?.inputTokens,
        model: stringValue(message.model),
        observedAt,
        outputTokens: usage?.outputTokens,
        provider: stringValue(message.provider),
        sessionId,
        totalTokens: usage?.totalTokens
      })
    );
  }

  return output;
}

function record(
  source: DiscoveredSource,
  lineNumber: number,
  suffix: string,
  rawLine: string,
  observedAt: string,
  payload: unknown,
  kind: AdapterRecord["normalized"]["kind"],
  value: unknown
): AdapterRecord {
  return {
    diagnostics: [],
    normalized: adapterPayload(kind, confidence(source), source, value),
    observedAt,
    payload,
    payloadHash: hash(`${rawLine}\0${suffix}`),
    source,
    sourceRecordKey: `${source.path}:${lineNumber}:${suffix}`
  };
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

function ompSessionIdFromSourcePath(path: string): string {
  const base = basename(path).replace(/\.(jsonl|json)$/i, "");
  if (/^\d{4}-\d{2}-\d{2}T/.test(base)) return base;
  const parent = basename(dirname(path));
  if (/^\d{4}-\d{2}-\d{2}T/.test(parent)) return `${parent}:${base.replace(/^__/, "")}`;
  return base;
}

function contentParts(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function textFromContentParts(parts: Array<Record<string, unknown>>): string | undefined {
  const text = parts
    .filter((part) => stringValue(part.type) === "text" || (!stringValue(part.type) && stringValue(part.text)))
    .map((part) => stringValue(part.text))
    .filter((part): part is string => Boolean(part))
    .join("\n\n")
    .trim();
  return text || undefined;
}

function usageValue(value: unknown): { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = numberValue(value.input_tokens) ?? numberValue(value.inputTokens);
  const outputTokens = numberValue(value.output_tokens) ?? numberValue(value.outputTokens);
  const totalTokens = numberValue(value.total_tokens) ?? numberValue(value.totalTokens) ?? sumTokens(inputTokens, outputTokens);
  return inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined ? { inputTokens, outputTokens, totalTokens } : undefined;
}

function sumTokens(inputTokens: number | undefined, outputTokens: number | undefined): number | undefined {
  return inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function confidence(source: DiscoveredSource): SourceConfidence {
  return source.confidence ?? "heuristic";
}
