import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { AdapterRecord, DiscoveredSource, IngestCursor } from "../types.ts";

type CodexParseContext = {
  sourceSessionId?: string;
  cwd?: string;
  model?: string;
  completeOffset: number;
};

type NormalizedCodexRecord = {
  confidence: AdapterRecord["normalized"]["confidence"];
  kind: AdapterRecord["normalized"]["kind"];
  value: Record<string, unknown>;
};

export async function* parseCodexTranscript(source: DiscoveredSource, cursor?: IngestCursor): AsyncIterable<AdapterRecord> {
  if (!source.path) return;
  const stream = createReadStream(source.path, {
    encoding: "utf8",
    start: cursor?.byteOffset ?? 0
  });
  let offset = cursor?.byteOffset ?? 0;
  let buffer = "";
  const context: CodexParseContext = { completeOffset: offset };

  for await (const chunk of stream) {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      offset += Buffer.byteLength(line) + 1;
      if (line.trim()) yield recordFromLine(source, line, offset, context);
      context.completeOffset = offset;
      newline = buffer.indexOf("\n");
    }
  }
}

function recordFromLine(source: DiscoveredSource, line: string, offset: number, context: CodexParseContext): AdapterRecord {
  const parsed = safeJson(line);
  const observedAt = observedAtFor(parsed);
  const normalized = normalizeCodexRecord(parsed, observedAt, context);
  return {
    diagnostics: [],
    normalized: {
      confidence: normalized.confidence,
      kind: normalized.kind,
      sourceRef: {
        runtimeVersion: source.runtimeVersion,
        schemaVersion: source.schemaVersion,
        sourceKind: "jsonl",
        sourcePath: source.path
      },
      value: normalized.value
    },
    observedAt,
    payload: parsed,
    payloadHash: hashLine(line),
    source,
    sourceRecordKey: `${source.path}:${offset}`
  };
}

function normalizeCodexRecord(raw: Record<string, unknown>, observedAt: string, context: CodexParseContext): NormalizedCodexRecord {
  const payload = isRecord(raw.payload) ? raw.payload : undefined;
  const rawType = stringField(raw, ["type", "kind", "event"])?.toLowerCase() ?? "";

  if (rawType === "session_meta" && payload) {
    const sessionId = sourceSessionId(payload) ?? sourceSessionId(raw);
    if (sessionId) context.sourceSessionId = sessionId;
    context.cwd = stringField(payload, ["cwd", "project", "repo_root", "repoRoot"]) ?? context.cwd;
    context.model = stringField(payload, ["model", "modelName"]) ?? context.model;
    return {
      confidence: sessionId ? "authoritative" : "heuristic",
      kind: "session",
      value: withSessionContext(
        {
          cwd: context.cwd,
          model: context.model,
          sessionId,
          timestamp: observedAt
        },
        context
      )
    };
  }

  if (rawType === "response_item" && payload) {
    return normalizeResponseItem(payload, observedAt, context);
  }

  if (rawType === "event_msg") {
    const value = payload ?? raw;
    return {
      confidence: "inferred",
      kind: "runtime_signal",
      value: withSessionContext(
        {
          message: stringField(value, ["message", "msg", "text", "title"]),
          severity: stringField(value, ["severity", "level"]) ?? "info",
          signalKind: "event_msg",
          timestamp: observedAt
        },
        context
      )
    };
  }

  if (rawType === "compacted" || rawType === "checkpoint") {
    const value = payload ?? raw;
    return {
      confidence: "inferred",
      kind: "checkpoint",
      value: withSessionContext(
        {
          checkpointId: stringField(value, ["checkpoint_id", "checkpointId", "id"]),
          checkpointKind: rawType,
          summary: stringField(value, ["summary", "text", "message"]),
          timestamp: observedAt
        },
        context
      )
    };
  }

  if (rawType === "token_count") {
    return {
      confidence: "inferred",
      kind: "usage",
      value: withSessionContext(tokenCountValue(payload ?? raw, observedAt, context), context)
    };
  }

  return normalizeLegacyRecord(raw, observedAt, context);
}

function normalizeResponseItem(payload: Record<string, unknown>, observedAt: string, context: CodexParseContext): NormalizedCodexRecord {
  const itemType = stringField(payload, ["type", "kind"])?.toLowerCase() ?? "";
  if (itemType === "message" || "role" in payload) {
    const text = textFromContent(payload.content) ?? stringField(payload, ["content", "text", "message"]);
    return {
      confidence: "inferred",
      kind: "message",
      value: withSessionContext(
        {
          content: text,
          role: stringField(payload, ["role"]),
          text,
          timestamp: observedAt,
          type: "message"
        },
        context
      )
    };
  }

  if (itemType === "function_call") {
    const toolName = stringField(payload, ["name", "tool_name", "toolName"]);
    return {
      confidence: "inferred",
      kind: "tool_call",
      value: withSessionContext(
        {
          arguments: parseArguments(payload.arguments ?? payload.args ?? payload.input),
          callId: stringField(payload, ["call_id", "callId", "id"]),
          name: toolName,
          timestamp: observedAt,
          toolName
        },
        context
      )
    };
  }

  if (itemType === "function_call_output") {
    const output = textFromContent(payload.output) ?? textFromContent(payload.content) ?? stringField(payload, ["output", "content", "text"]);
    return {
      confidence: "inferred",
      kind: "tool_result",
      value: withSessionContext(
        {
          callId: stringField(payload, ["call_id", "callId", "id"]),
          content: output,
          output,
          timestamp: observedAt
        },
        context
      )
    };
  }

  return {
    confidence: "heuristic",
    kind: "event",
    value: withSessionContext({ ...payload, timestamp: observedAt }, context)
  };
}

function normalizeLegacyRecord(value: Record<string, unknown>, observedAt: string, context: CodexParseContext): NormalizedCodexRecord {
  const payload = isRecord(value.payload) ? value.payload : undefined;
  const message = payload && isRecord(payload.message) ? payload.message : undefined;
  if (message) {
    const text = textFromContent(message.content) ?? stringField(message, ["content", "text", "message"]);
    const sessionId = (payload ? sourceSessionId(payload) : undefined) ?? sourceSessionId(value) ?? context.sourceSessionId;
    return {
      confidence: "inferred",
      kind: "message",
      value: withSessionContext(
        {
          ...message,
          content: text,
          session_id: sessionId,
          sessionId,
          text,
          timestamp: observedAt
        },
        context
      )
    };
  }
  if (payload) {
    const type = (stringField(payload, ["type", "kind", "event", "item_type", "itemType"]) ?? stringField(value, ["type", "kind", "event"]))?.toLowerCase() ?? "";
    return {
      confidence: "inferred",
      kind: classifyLegacyKind(type, payload),
      value: withSessionContext(
        {
          ...payload,
          content: textFromContent(payload.content) ?? stringField(payload, ["content"]),
          timestamp: observedAt
        },
        context
      )
    };
  }

  const type = stringField(value, ["type", "kind", "event", "item_type", "itemType"])?.toLowerCase() ?? "";
  const text = textFromContent(value.content) ?? stringField(value, ["content", "text", "message"]);
  return {
    confidence: "inferred",
    kind: classifyLegacyKind(type, value),
    value: withSessionContext(
      {
        ...value,
        content: text ?? value.content,
        text,
        timestamp: observedAt
      },
      context
    )
  };
}

function classifyLegacyKind(type: string, value: Record<string, unknown>): AdapterRecord["normalized"]["kind"] {
  if (type === "function_call" || (type.includes("tool") && type.includes("call"))) return "tool_call";
  if (type === "function_call_output" || (type.includes("tool") && type.includes("result"))) return "tool_result";
  if (type.includes("usage") || "usage" in value) return "usage";
  if (type.includes("compact") || type.includes("checkpoint")) return "checkpoint";
  if (type.includes("message") || "role" in value) return "message";
  return "event";
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string" && content.trim()) return content;
  if (!Array.isArray(content)) return undefined;

  const text = content
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter((item) => ["input_text", "output_text", "text"].includes(String(item.type)))
    .map((item) => String(item.text ?? ""))
    .filter(Boolean)
    .join("\n");

  return text || undefined;
}

function tokenCountValue(value: Record<string, unknown>, observedAt: string, context: CodexParseContext): Record<string, unknown> {
  const inputTokens = numberField(value, ["input_tokens", "inputTokens"]);
  const outputTokens = numberField(value, ["output_tokens", "outputTokens"]);
  const totalTokens = numberField(value, ["total_tokens", "totalTokens"]) ?? sum(inputTokens, outputTokens);
  return {
    input_tokens: inputTokens,
    inputTokens,
    model: stringField(value, ["model", "modelName"]) ?? context.model,
    output_tokens: outputTokens,
    outputTokens,
    timestamp: observedAt,
    total_tokens: totalTokens,
    totalTokens
  };
}

function withSessionContext(value: Record<string, unknown>, context: CodexParseContext): Record<string, unknown> {
  const sessionId = stringField(value, ["sessionId", "session_id", "conversationId", "conversation_id"]) ?? context.sourceSessionId;
  return {
    ...value,
    cwd: stringField(value, ["cwd"]) ?? context.cwd,
    model: stringField(value, ["model", "modelName"]) ?? context.model,
    session_id: sessionId,
    sessionId
  };
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

function observedAtFor(value: Record<string, unknown>): string {
  const payload = isRecord(value.payload) ? value.payload : undefined;
  return (
    stringField(value, ["timestamp", "created_at", "createdAt", "time"]) ??
    (payload ? stringField(payload, ["timestamp", "created_at", "createdAt", "time"]) : undefined) ??
    new Date(0).toISOString()
  );
}

function sourceSessionId(value: Record<string, unknown>): string | undefined {
  return stringField(value, ["session_id", "sessionId", "conversation_id", "conversationId", "id"]);
}

function stringField(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

function numberField(value: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return undefined;
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function sum(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined && right === undefined) return undefined;
  return (left ?? 0) + (right ?? 0);
}

function hashLine(line: string): string {
  return createHash("sha256").update(line).digest("hex");
}
