import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { adapterPayload, hash, isRecord, normalizeRole } from "../generic/jsonlAdapterKit.ts";
import { createLocalAdapter, genericCodingProfile } from "../generic/localAdapterFactory.ts";
import type { AdapterRecord, DiscoveredSource, IngestCursor, SourceConfidence } from "../types.ts";
import { streamJsonlLines } from "../generic/streamJsonl.ts";
import { shortUserDerivedTitle } from "../userDerivedTitle.ts";
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

type OmpSessionIdentity = {
  sessionId: string;
  parentSourceSessionId?: string;
  childSessionId?: string;
};

async function* backfillOmpSource(source: DiscoveredSource, cursor?: IngestCursor): AsyncIterable<AdapterRecord> {
  if (!source.path) return;
  const identity = ompSessionIdentityFromSourcePath(source.path);
  if (!identity.sessionId) return;
  const info = await stat(source.path);
  const contentFingerprint = `${info.size}:${Math.trunc(info.mtimeMs)}`;
  const modifiedAt = info.mtime.toISOString();
  const resumeOffset = cursor && cursor.byteOffset <= info.size ? cursor.byteOffset : 0;

  // Empty harness titles: defer session until a user-derived label, or EOF.
  // Explicit harness titles still emit immediately. COALESCE keeps first non-null title.
  let pendingSession:
    | {
        lineNumber: number;
        rawLine: string;
        payload: Record<string, unknown>;
        observedAt: string;
        cwd?: string;
        explicitTitle?: string;
        cursorAfter: Omit<IngestCursor, "cursorId">;
      }
    | undefined;
  let userTitle: string | undefined;
  let sessionYielded = false;

  /** Mid-stream only when userTitle is set; force=true at EOF allows empty-title fallback. */
  const emitPendingSession = function* (options?: { force?: boolean }): Generator<AdapterRecord> {
    if (!pendingSession || sessionYielded) return;
    if (!userTitle && !options?.force) return;
    const title = pendingSession.explicitTitle ?? userTitle;
    const sessionRecord = record(
      source,
      pendingSession.lineNumber,
      "session",
      pendingSession.rawLine,
      pendingSession.observedAt,
      pendingSession.payload,
      "session",
      {
        cwd: pendingSession.cwd,
        observedAt: pendingSession.observedAt,
        sessionId: identity.sessionId,
        ...ompChildIdentity(identity),
        title
      }
    );
    sessionRecord.cursorAfter = pendingSession.cursorAfter;
    yield sessionRecord;
    sessionYielded = true;
  };

  for await (const line of streamJsonlLines(source.path, resumeOffset)) {
    const trimmed = line.raw.trim();
    if (!trimmed) continue;
    const cursorAfter = { byteOffset: line.byteOffsetAfter, contentFingerprint, modifiedAt, sourceId: source.sourceId, sourcePath: source.path };
    let payload: unknown;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      // Do not force-emit empty/weak session title on diagnostics; wait for user turn or EOF.
      yield { ...diagnosticRecord(source, line.lineNumber, trimmed, "jsonl_invalid_line"), cursorAfter };
      continue;
    }
    if (!isRecord(payload)) continue;

    if (payload.type === "session") {
      const observedAt = stringValue(payload.timestamp) ?? new Date(0).toISOString();
      const explicitTitle = stringValue(payload.title);
      if (explicitTitle) {
        const sessionRecord = record(source, line.lineNumber, "session", trimmed, observedAt, payload, "session", {
          cwd: stringValue(payload.cwd),
          observedAt,
          sessionId: identity.sessionId,
          ...ompChildIdentity(identity),
          title: explicitTitle
        });
        sessionRecord.cursorAfter = cursorAfter;
        sessionYielded = true;
        yield sessionRecord;
      } else {
        pendingSession = {
          lineNumber: line.lineNumber,
          rawLine: trimmed,
          payload,
          observedAt,
          cwd: stringValue(payload.cwd),
          explicitTitle,
          cursorAfter
        };
      }
      continue;
    }

    const records = ompRecordsFromPayload(source, identity, line.lineNumber, trimmed, payload);
    if (!userTitle) {
      for (const candidate of records) {
        if (candidate.normalized.kind !== "message") continue;
        const value = candidate.normalized.value as { role?: string; text?: string };
        if (value.role === "user" && typeof value.text === "string") {
          userTitle = shortUserDerivedTitle(value.text);
          if (userTitle) break;
        }
      }
    }
    // Emit only once userTitle is known (no-op while still waiting).
    yield* emitPendingSession();
    if (records.length > 0) records[records.length - 1]!.cursorAfter = cursorAfter;
    for (const item of records) yield item;
  }

  yield* emitPendingSession({ force: true });
}

function ompRecordsFromPayload(source: DiscoveredSource, identity: OmpSessionIdentity, lineNumber: number, rawLine: string, payload: Record<string, unknown>): AdapterRecord[] {
  if (payload.type === "session") {
    // Handled in backfillOmpSource so empty titles can wait for a user turn.
    return [];
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
        sessionId: identity.sessionId,
        ...ompChildIdentity(identity),
        status: message.isError === true ? "failed" : "succeeded",
        toolName: stringValue(message.toolName)
      })
    );
  } else if (role && text) {
    output.push(
      record(source, lineNumber, "message", rawLine, observedAt, payload, "message", {
        observedAt,
        role,
        sessionId: identity.sessionId,
        ...ompChildIdentity(identity),
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
        sessionId: identity.sessionId,
        ...ompChildIdentity(identity),
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
        sessionId: identity.sessionId,
        ...ompChildIdentity(identity),
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

function ompSessionIdentityFromSourcePath(path: string): OmpSessionIdentity {
  const base = basename(path).replace(/\.(jsonl|json)$/i, "");
  if (/^\d{4}-\d{2}-\d{2}T/.test(base)) return { sessionId: base };
  const parent = basename(dirname(path));
  if (/^\d{4}-\d{2}-\d{2}T/.test(parent)) return { sessionId: parent, parentSourceSessionId: parent, childSessionId: base.replace(/^__/, "") };
  return { sessionId: base };
}

function ompChildIdentity(identity: OmpSessionIdentity): { parentSourceSessionId?: string; childSessionId?: string } {
  return identity.parentSourceSessionId && identity.childSessionId
    ? { parentSourceSessionId: identity.parentSourceSessionId, childSessionId: identity.childSessionId }
    : {};
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
