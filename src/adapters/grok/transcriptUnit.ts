import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { adapterPayload, hash, isRecord, normalizeRole } from "../generic/jsonlAdapterKit.ts";
import { streamJsonlLines } from "../generic/streamJsonl.ts";
import type { ParsedTranscriptUnit, TranscriptUnitPlan } from "../transcriptUnits.ts";
import { parsedTranscriptUnit } from "../transcriptUnits.ts";
import type { AdapterDiagnostic, AdapterRecord, DiscoveredSource, IngestCursor, SourceConfidence } from "../types.ts";

const CHAT_HISTORY_FILE = "chat_history.jsonl";
const SUMMARY_FILE = "summary.json";
const KNOWN_AUXILIARY_FILES = new Set([
  "feedback.jsonl",
  "plan.json",
  "rewind_points.jsonl",
  "signals.json",
  "updates.jsonl"
]);
const TIMESTAMP_KEYS = new Set(["created_at", "createdAt", "observed_at", "observedAt", "time", "timestamp", "updated_at", "updatedAt"]);

export async function planGrokTranscriptUnits(source: DiscoveredSource): Promise<TranscriptUnitPlan[]> {
  const chatPaths = await grokChatHistoryPaths(source);
  return Promise.all(chatPaths.map((chatPath) => planGrokConversation(source, chatPath)));
}

async function planGrokConversation(source: DiscoveredSource, chatPath: string): Promise<TranscriptUnitPlan> {
  const conversationDir = dirname(chatPath);
  const conversationId = basename(conversationDir);
  const files = await regularFiles(conversationDir);
  const newestFileMtime = newestTimestamp(files.map((file) => file.modifiedAt));
  const semanticActivityAt = newestTimestamp([
    ...(await semanticTimestampsFromJson(join(conversationDir, SUMMARY_FILE))),
    ...(await semanticTimestampsFromJsonl(chatPath))
  ]);
  const chatInfo = files.find((file) => file.path === chatPath);

  return {
    fileSizeBytes: chatInfo?.size,
    modifiedAt: newestFileMtime,
    runtime: "grok",
    semanticActivityAt,
    source: { ...source, path: chatPath, sourceSessionId: conversationId },
    sourceSessionId: conversationId,
    timestampBasis: semanticActivityAt ? "semantic" : "file_modified",
    unitId: `grok:${conversationId}`
  };
}

export async function parseGrokTranscriptUnit(unit: TranscriptUnitPlan, cursor?: IngestCursor): Promise<ParsedTranscriptUnit> {
  const conversationId = unit.sourceSessionId;
  const path = unit.source.path;
  if (!conversationId || !path) return emptyParsedUnit(unit, "grok_conversation_identity_missing", "error");

  const records = await grokRecords(path, conversationId, unit.source, cursor?.sourcePath === path ? cursor : undefined);
  const auxiliaryDiagnostics = await knownAuxiliaryDiagnostics(dirname(path));
  const parsed = parsedTranscriptUnit(unit, records);
  return {
    ...parsed,
    diagnostics: [...parsed.diagnostics, ...auxiliaryDiagnostics]
  };
}

export async function* backfillGrokSource(source: DiscoveredSource, cursor?: IngestCursor): AsyncIterable<AdapterRecord> {
  const planned = await planGrokTranscriptUnits(source);
  const units = planned.length > 0 ? planned : legacyFlatUnit(source);
  for (const unit of units) {
    const parsed = await parseGrokTranscriptUnit(unit, cursor);
    for (const record of parsed.records) yield record;
  }
}

async function grokRecords(path: string, conversationId: string, source: DiscoveredSource, cursor?: IngestCursor): Promise<AdapterRecord[]> {
  const info = await stat(path);
  const contentFingerprint = `${info.size}:${Math.trunc(info.mtimeMs)}`;
  const modifiedAt = info.mtime.toISOString();
  const resumeOffset = cursor && cursor.byteOffset <= info.size ? cursor.byteOffset : 0;
  const records: AdapterRecord[] = [];

  for await (const line of streamJsonlLines(path, resumeOffset)) {
    const raw = line.raw.trim();
    if (!raw) continue;
    const cursorAfter = {
      byteOffset: line.byteOffsetAfter,
      contentFingerprint,
      modifiedAt,
      sourceId: source.sourceId,
      sourcePath: path,
      sourceSessionId: conversationId
    };
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      records.push({ ...diagnosticRecord(source, line.lineNumber, raw, "jsonl_invalid_line", "Invalid JSON in Grok chat history."), cursorAfter });
      continue;
    }
    if (!isRecord(payload)) {
      records.push({ ...diagnosticRecord(source, line.lineNumber, raw, "grok_record_type_unrecognized", "Grok transcript row is not an object."), cursorAfter });
      continue;
    }

    const rowRecords = recordsFromRow(source, conversationId, line.lineNumber, raw, payload);
    if (rowRecords.length > 0) rowRecords[rowRecords.length - 1].cursorAfter = cursorAfter;
    records.push(...rowRecords);
  }
  return records;
}

function recordsFromRow(
  source: DiscoveredSource,
  conversationId: string,
  lineNumber: number,
  raw: string,
  row: Record<string, unknown>
): AdapterRecord[] {
  const type = stringValue(row.type) ?? stringValue(row.role);
  const observedAt = semanticTimestamps(row).at(-1) ?? new Date(0).toISOString();
  switch (type) {
    case "system":
    case "user":
    case "assistant": {
      const output: AdapterRecord[] = [];
      const text = textValue(row.content) ?? textValue(row.text) ?? "";
      output.push(
        record(source, lineNumber, "message", raw, observedAt, row, "message", {
          observedAt,
          role: normalizeRole(type),
          sessionId: conversationId,
          text
        })
      );
      if (type === "assistant" && Array.isArray(row.tool_calls)) {
        for (const [index, value] of row.tool_calls.entries()) {
          if (!isRecord(value)) continue;
          const toolName = stringValue(value.name) ?? (isRecord(value.function) ? stringValue(value.function.name) : undefined) ?? "tool";
          const argumentsValue = value.arguments ?? (isRecord(value.function) ? value.function.arguments : undefined);
          output.push(
            record(source, lineNumber, `tool_call:${index}`, raw, observedAt, value, "tool_call", {
              arguments: toolArguments(argumentsValue),
              callId: stringValue(value.id),
              observedAt,
              sessionId: conversationId,
              toolName
            })
          );
        }
      }
      return output;
    }
    case "reasoning":
      return [
        record(source, lineNumber, "checkpoint", raw, observedAt, row, "checkpoint", {
          checkpointId: stringValue(row.id),
          checkpointKind: "reasoning",
          observedAt,
          sessionId: conversationId,
          summary: textValue(row.summary) ?? "Reasoning checkpoint"
        })
      ];
    case "tool_result":
      return [
        record(source, lineNumber, "tool_result", raw, observedAt, row, "tool_result", {
          callId: stringValue(row.tool_call_id) ?? stringValue(row.call_id),
          observedAt,
          output: textValue(row.content) ?? textValue(row.output) ?? "",
          sessionId: conversationId,
          status: row.is_error === true ? "failed" : stringValue(row.status) ?? "succeeded",
          toolName: stringValue(row.name) ?? stringValue(row.tool_name)
        })
      ];
    case "backend_tool_call": {
      const kind = isRecord(row.kind) ? row.kind : undefined;
      const action = kind?.action;
      return [
        record(source, lineNumber, "tool_call", raw, observedAt, row, "tool_call", {
          arguments: toolArguments(action),
          callId: stringValue(kind?.id),
          observedAt,
          sessionId: conversationId,
          status: stringValue(kind?.status),
          toolName:
            stringValue(kind?.tool_type) ??
            (isRecord(action) ? stringValue(action.type) : undefined) ??
            stringValue(row.kind) ??
            "backend_tool"
        })
      ];
    }
    default:
      return [
        diagnosticRecord(
          source,
          lineNumber,
          raw,
          "grok_record_type_unrecognized",
          `Unrecognized Grok transcript record type: ${type ?? "missing"}.`
        )
      ];
  }
}

function record(
  source: DiscoveredSource,
  lineNumber: number,
  suffix: string,
  raw: string,
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
    payloadHash: hash(`${raw}\0${suffix}`),
    source,
    sourceRecordKey: `${source.path}:${lineNumber}:${suffix}`
  };
}

function diagnosticRecord(
  source: DiscoveredSource,
  lineNumber: number,
  raw: string,
  code: string,
  message: string
): AdapterRecord {
  const observedAt = new Date(0).toISOString();
  return {
    diagnostics: [{ code, message, observedAt, severity: "warning" }],
    normalized: adapterPayload("runtime_signal", confidence(source), source, {
      message,
      observedAt,
      severity: "warning",
      signalKind: "adapter_diagnostic"
    }),
    observedAt,
    payload: { lineNumber },
    payloadHash: hash(raw),
    source,
    sourceRecordKey: `${source.path}:${lineNumber}:diagnostic`
  };
}

async function grokChatHistoryPaths(source: DiscoveredSource): Promise<string[]> {
  if (!source.path) return [];
  const info = await stat(source.path).catch(() => undefined);
  if (!info) return [];
  if (info.isDirectory()) return findChatHistoryFiles(source.path);
  if (basename(source.path) === CHAT_HISTORY_FILE) return [source.path];
  const sibling = join(dirname(source.path), CHAT_HISTORY_FILE);
  return (await stat(sibling).catch(() => undefined))?.isFile() ? [sibling] : [];
}

async function findChatHistoryFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await findChatHistoryFiles(path)));
    else if (entry.isFile() && entry.name === CHAT_HISTORY_FILE) paths.push(path);
  }
  return paths;
}

function legacyFlatUnit(source: DiscoveredSource): TranscriptUnitPlan[] {
  if (!source.path || basename(source.path) === CHAT_HISTORY_FILE) return [];
  const sourceSessionId = source.sourceSessionId ?? basename(source.path).replace(/\.(jsonl|json)$/i, "");
  return [
    {
      runtime: "grok",
      source,
      sourceSessionId,
      timestampBasis: "file_modified",
      unitId: `grok:${sourceSessionId}`
    }
  ];
}

async function regularFiles(directory: string): Promise<Array<{ modifiedAt: string; path: string; size: number }>> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const path = join(directory, entry.name);
        const info = await stat(path);
        return { modifiedAt: info.mtime.toISOString(), path, size: info.size };
      })
  );
  return files;
}

async function semanticTimestampsFromJson(path: string): Promise<string[]> {
  try {
    return semanticTimestamps(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return [];
  }
}

async function semanticTimestampsFromJsonl(path: string): Promise<string[]> {
  const timestamps: string[] = [];
  try {
    for await (const line of streamJsonlLines(path)) {
      try {
        timestamps.push(...semanticTimestamps(JSON.parse(line.raw)));
      } catch {
        // Parsing diagnostics are emitted while the transcript unit is read.
      }
    }
  } catch {
    return [];
  }
  return timestamps;
}

function semanticTimestamps(value: unknown): string[] {
  const timestamps: string[] = [];
  visit(value, (key, candidate) => {
    if (!TIMESTAMP_KEYS.has(key) || typeof candidate !== "string" || !Number.isFinite(Date.parse(candidate))) return;
    timestamps.push(new Date(candidate).toISOString());
  });
  return timestamps.toSorted((left, right) => Date.parse(left) - Date.parse(right));
}

function visit(value: unknown, callback: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, callback);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    callback(key, child);
    visit(child, callback);
  }
}

async function knownAuxiliaryDiagnostics(directory: string): Promise<AdapterDiagnostic[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && KNOWN_AUXILIARY_FILES.has(entry.name))
    .map((entry) => ({
      code: "grok_auxiliary_file_ignored",
      details: entry.name,
      message: `Ignored known Grok auxiliary file: ${entry.name}.`,
      observedAt: new Date(0).toISOString(),
      severity: "info" as const
    }));
}

function newestTimestamp(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .toSorted((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const text = value.map(textValue).filter((part): part is string => Boolean(part)).join("\n\n").trim();
    return text || undefined;
  }
  if (!isRecord(value)) return undefined;
  return textValue(value.text) ?? textValue(value.content);
}

function toolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return { raw: value };
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function confidence(source: DiscoveredSource): SourceConfidence {
  return source.confidence ?? "heuristic";
}

function emptyParsedUnit(unit: TranscriptUnitPlan, code: string, severity: AdapterDiagnostic["severity"]): ParsedTranscriptUnit {
  const diagnostic = { code, message: "Grok transcript unit has no stable conversation identity.", observedAt: new Date(0).toISOString(), severity };
  return {
    completeness: "unrecognized",
    diagnostics: [diagnostic],
    records: [],
    sourceSessionIds: [],
    unit
  };
}
