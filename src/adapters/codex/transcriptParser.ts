import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { AdapterRecord, DiscoveredSource, IngestCursor } from "../types.ts";

export async function* parseCodexTranscript(source: DiscoveredSource, cursor?: IngestCursor): AsyncIterable<AdapterRecord> {
  if (!source.path) return;
  const stream = createReadStream(source.path, {
    encoding: "utf8",
    start: cursor?.byteOffset ?? 0
  });
  let offset = cursor?.byteOffset ?? 0;
  let buffer = "";
  for await (const chunk of stream) {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      offset += Buffer.byteLength(line) + 1;
      if (line.trim()) yield recordFromLine(source, line, offset);
      newline = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) {
    offset += Buffer.byteLength(buffer);
    yield recordFromLine(source, buffer, offset);
  }
}

function recordFromLine(source: DiscoveredSource, line: string, offset: number): AdapterRecord {
  const parsed = safeJson(line);
  const normalizedValue = normalizedRecordValue(parsed);
  const kind = classifyRecord(parsed, normalizedValue);
  const observedAt = stringField(parsed, ["timestamp", "created_at", "createdAt", "time"]) ?? new Date(0).toISOString();
  return {
    diagnostics: [],
    normalized: {
      confidence: "inferred",
      kind,
      sourceRef: {
        runtimeVersion: source.runtimeVersion,
        schemaVersion: source.schemaVersion,
        sourceKind: "jsonl",
        sourcePath: source.path
      },
      value: normalizedValue
    },
    observedAt,
    payload: parsed,
    payloadHash: hashLine(line),
    source,
    sourceRecordKey: `${source.path}:${offset}`
  };
}

function classifyRecord(raw: Record<string, unknown>, value: Record<string, unknown>): AdapterRecord["normalized"]["kind"] {
  const type = (stringField(value, ["type", "kind", "event", "item_type", "itemType"]) ?? stringField(raw, ["type", "kind", "event"]))?.toLowerCase() ?? "";
  if (type.includes("tool") && type.includes("call")) return "tool_call";
  if (type.includes("tool") && type.includes("result")) return "tool_result";
  if (type.includes("usage") || "usage" in value) return "usage";
  if (type.includes("compact") || type.includes("checkpoint")) return "checkpoint";
  if (type.includes("message") || "role" in value) return "message";
  return "event";
}

function normalizedRecordValue(value: Record<string, unknown>): Record<string, unknown> {
  const payload = isRecord(value.payload) ? value.payload : undefined;
  const message = payload && isRecord(payload.message) ? payload.message : undefined;
  if (message) {
    const sourcePayload = payload;
    return {
      ...message,
      session_id:
        (sourcePayload ? stringField(sourcePayload, ["session_id", "sessionId", "conversation_id", "conversationId"]) : undefined) ??
        stringField(value, ["session_id", "sessionId"]),
      timestamp: stringField(value, ["timestamp", "created_at", "createdAt", "time"])
    };
  }
  if (payload) {
    return {
      ...payload,
      timestamp: stringField(value, ["timestamp", "created_at", "createdAt", "time"])
    };
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeJson(line: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringField(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

function hashLine(line: string): string {
  return createHash("sha256").update(line).digest("hex");
}
