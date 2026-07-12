import { open, stat } from "node:fs/promises";
import { basename } from "node:path";
import type {
  AdapterRecord,
  DiscoveredSource,
  DiscoveryContext,
  IngestCursor,
  NormalizedAdapterPayload,
  SessionAdapter,
  SourceInventory
} from "../types.ts";
import { adapterPayload, hash, isRecord, normalizeRole, readNumber, readPath, readString } from "../generic/jsonlAdapterKit.ts";
import { discoverLocalSources } from "../generic/localAdapterFactory.ts";
import { codexCandidatePaths } from "./discovery.ts";
import { streamJsonlLines } from "../generic/streamJsonl.ts";

export const codexAdapter: SessionAdapter = {
  runtime: "codex",
  discover: async (context: DiscoveryContext) => {
    const sources = await discoverLocalSources(context, { runtime: "codex", candidatePaths: codexCandidatePaths });
    return Promise.all(sources.map(withCodexSourceSessionId));
  },
  inspect: inspectCodexSource,
  backfill: backfillCodexSource,
  async *watch() {
    return;
  }
};

async function withCodexSourceSessionId(source: DiscoveredSource): Promise<DiscoveredSource> {
  if (!source.path) return source;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(source.path, "r");
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    for (const line of buffer.subarray(0, bytesRead).toString("utf8").split("\n")) {
      try {
        const payload = JSON.parse(line) as unknown;
        if (!isRecord(payload) || readString(payload, ["type"]) !== "session_meta") continue;
        const body = readPath(payload, "payload");
        if (!isRecord(body)) continue;
        const sourceSessionId = readString(body, ["id", "session_id", "sessionId"]);
        if (sourceSessionId) return { ...source, sourceSessionId };
      } catch {
        // Discovery is best-effort; the full importer records malformed-line diagnostics.
      }
    }
  } catch {
    return source;
  } finally {
    await handle?.close();
  }
  return source;
}

async function inspectCodexSource(source: DiscoveredSource): Promise<SourceInventory> {
  const info = source.path ? await stat(source.path) : undefined;
  return {
    failures: [],
    recordCount: info?.isFile() ? 1 : 0,
    sessionCount: info?.isFile() ? 1 : 0,
    source
  };
}

async function* backfillCodexSource(source: DiscoveredSource, cursor?: IngestCursor): AsyncIterable<AdapterRecord> {
  if (!source.path) return;
  const info = await stat(source.path);
  const contentFingerprint = `${info.size}:${Math.trunc(info.mtimeMs)}`;
  const modifiedAt = info.mtime.toISOString();
  let sourceSessionId = cursor?.sourceSessionId ?? sessionIdFromPath(source.path);
  let cwd = cursor?.cwd;
  let model = cursor?.model;

  const resumeOffset = cursor && cursor.byteOffset <= info.size ? cursor.byteOffset : 0;
  for await (const line of streamJsonlLines(source.path, resumeOffset)) {
    const trimmed = line.raw.trim();
    if (!trimmed) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      yield diagnosticRecord(source, line.lineNumber, trimmed, "codex_jsonl_invalid_line", cursorAfter(line.byteOffsetAfter));
      continue;
    }
    if (!isRecord(payload)) continue;
    const observedAt = readString(payload, ["timestamp", "observedAt", "created_at"]) ?? new Date(0).toISOString();
    const type = readString(payload, ["type"]);
    const body = readPath(payload, "payload");
    if (type === "session_meta" && isRecord(body)) {
      sourceSessionId = readString(body, ["id", "session_id", "sessionId"]) ?? sourceSessionId;
      cwd = readString(body, ["cwd", "repo_root", "repoRoot"]);
      model = readString(body, ["model", "model_provider"]);
      yield record(source, line.lineNumber, observedAt, payload, adapterPayload("session", source.confidence, source, {
        cwd,
        model,
        observedAt,
        sessionId: sourceSessionId,
        title: cwd ? basename(cwd) : "Codex session"
      }), cursorAfter(line.byteOffsetAfter));
      continue;
    }
    if (!sourceSessionId || !isRecord(body)) continue;

    const normalized = normalizedCodexPayload(source, sourceSessionId, observedAt, body, { cwd, model });
    if (normalized) yield record(source, line.lineNumber, observedAt, payload, normalized, cursorAfter(line.byteOffsetAfter));
  }

  function cursorAfter(byteOffset: number): Omit<IngestCursor, "cursorId"> {
    return { byteOffset, contentFingerprint, cwd, model, modifiedAt, sourceId: source.sourceId, sourcePath: source.path, sourceSessionId };
  }
}

function normalizedCodexPayload(
  source: DiscoveredSource,
  sessionId: string,
  observedAt: string,
  body: Record<string, unknown>,
  context: { cwd?: string; model?: string }
): NormalizedAdapterPayload | undefined {
  const bodyType = readString(body, ["type"]);
  if (bodyType === "message") {
    const role = readString(body, ["role"]);
    const text = contentText(body.content);
    if (role && text) {
      return adapterPayload("message", source.confidence, source, {
        observedAt,
        role: normalizeRole(role),
        sessionId,
        text
      });
    }
  }
  if (bodyType === "function_call") {
    return adapterPayload("tool_call", source.confidence, source, {
      arguments: parseArguments(body.arguments),
      callId: readString(body, ["call_id"]),
      observedAt,
      sessionId,
      toolName: readString(body, ["name"]) ?? "tool"
    });
  }
  if (bodyType === "function_call_output") {
    return adapterPayload("tool_result", source.confidence, source, {
      callId: readString(body, ["call_id"]),
      observedAt,
      output: contentText(body.output) ?? "",
      sessionId,
      status: "completed"
    });
  }
  if (bodyType === "token_count") {
    const usage = readPath(body, "info.last_token_usage");
    return adapterPayload("usage", source.confidence, source, {
      inputTokens: readNumber(usage, ["input_tokens"]),
      model: context.model,
      observedAt,
      outputTokens: readNumber(usage, ["output_tokens"]),
      sessionId,
      totalTokens: readNumber(usage, ["total_tokens"])
    });
  }
  return undefined;
}

function record(
  source: DiscoveredSource,
  lineNumber: number,
  observedAt: string,
  payload: unknown,
  normalized: NormalizedAdapterPayload,
  cursorAfter?: Omit<IngestCursor, "cursorId">
): AdapterRecord {
  const serialized = JSON.stringify(payload);
  return {
    diagnostics: [],
    cursorAfter,
    normalized,
    observedAt,
    payload,
    payloadHash: hash(serialized),
    source,
    sourceRecordKey: `${source.path}:${lineNumber}`
  };
}

function diagnosticRecord(source: DiscoveredSource, lineNumber: number, line: string, code: string, cursorAfter?: Omit<IngestCursor, "cursorId">): AdapterRecord {
  const observedAt = new Date().toISOString();
  return {
    diagnostics: [{ code, message: "Codex transcript line could not be parsed.", observedAt, severity: "warning" }],
    cursorAfter,
    normalized: adapterPayload("runtime_signal", "heuristic", source, {
      message: "Codex transcript line could not be parsed.",
      observedAt,
      severity: "warning",
      signalKind: "adapter_diagnostic"
    }),
    observedAt,
    payload: { lineNumber },
    payloadHash: hash(line),
    source,
    sourceRecordKey: `${source.path}:${lineNumber}:diagnostic`
  };
}

function contentText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!Array.isArray(value)) return undefined;
  const text = value
    .flatMap((part) => {
      if (typeof part === "string") return [part];
      if (!isRecord(part)) return [];
      const type = readString(part, ["type"]);
      if (type === "input_text" || type === "output_text" || type === "text") return [readString(part, ["text"]) ?? ""];
      return [];
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return text || undefined;
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { redacted: value };
  }
}

function sessionIdFromPath(path: string): string {
  return basename(path).replace(/\.jsonl$/i, "");
}
