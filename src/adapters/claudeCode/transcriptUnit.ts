import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { adapterPayload, hash, isRecord, normalizeRole } from "../generic/jsonlAdapterKit.ts";
import { streamJsonlLines } from "../generic/streamJsonl.ts";
import type { ParsedTranscriptUnit, TranscriptUnitPlan } from "../transcriptUnits.ts";
import { parsedTranscriptUnit } from "../transcriptUnits.ts";
import type { AdapterRecord, DiscoveredSource, IngestCursor } from "../types.ts";

const IGNORED_ROW_TYPES = new Set([
  "attachment",
  "file-history-snapshot",
  "last-prompt",
  "mode",
  "permission-mode",
  "queue-operation"
]);

export async function planClaudeCodeTranscriptUnits(source: DiscoveredSource): Promise<TranscriptUnitPlan[]> {
  if (!source.path) return [];
  const info = await stat(source.path).catch(() => undefined);
  const sourceSessionId = source.sourceSessionId ?? basename(source.path).replace(/\.jsonl$/i, "");
  return [{
    fileSizeBytes: info?.size,
    modifiedAt: info?.mtime.toISOString(),
    runtime: "claude_code",
    source: { ...source, sourceSessionId },
    sourceSessionId,
    timestampBasis: "file_modified",
    unitId: `claude_code:${sourceSessionId}`
  }];
}

export async function parseClaudeCodeTranscriptUnit(unit: TranscriptUnitPlan, cursor?: IngestCursor): Promise<ParsedTranscriptUnit> {
  const source = unit.sourceSessionId ? { ...unit.source, sourceSessionId: unit.sourceSessionId } : unit.source;
  const records = await claudeCodeRecords(source, cursor);
  return parsedTranscriptUnit({ ...unit, source }, records);
}

export async function* backfillClaudeCodeSource(source: DiscoveredSource, cursor?: IngestCursor): AsyncIterable<AdapterRecord> {
  for (const unit of await planClaudeCodeTranscriptUnits(source)) {
    const parsed = await parseClaudeCodeTranscriptUnit(unit, cursor);
    for (const record of parsed.records) yield record;
  }
}

async function claudeCodeRecords(source: DiscoveredSource, cursor?: IngestCursor): Promise<AdapterRecord[]> {
  if (!source.path) return [];
  const info = await stat(source.path);
  const resumeOffset = cursor?.sourcePath === source.path && cursor.byteOffset <= info.size ? cursor.byteOffset : 0;
  const contentFingerprint = `${info.size}:${Math.trunc(info.mtimeMs)}`;
  const records: AdapterRecord[] = [];
  let sessionId = source.sourceSessionId ?? basename(source.path).replace(/\.jsonl$/i, "");
  let cwd: string | undefined;
  let title: string | undefined;
  let sessionObservedAt: string | undefined;

  for await (const line of streamJsonlLines(source.path, resumeOffset)) {
    const raw = line.raw.trim();
    if (!raw) continue;
    const cursorAfter = {
      byteOffset: line.byteOffsetAfter,
      contentFingerprint,
      modifiedAt: info.mtime.toISOString(),
      sourceId: source.sourceId,
      sourcePath: source.path,
      sourceSessionId: sessionId,
      cwd
    };
    let row: unknown;
    try {
      row = JSON.parse(raw);
    } catch {
      records.push(diagnosticRecord(source, line.lineNumber, raw, "claude_code_jsonl_invalid_line", cursorAfter));
      continue;
    }
    if (!isRecord(row) || Array.isArray(row)) {
      records.push(diagnosticRecord(source, line.lineNumber, raw, "claude_code_non_object_row", cursorAfter));
      continue;
    }
    sessionId = stringValue(row.sessionId) ?? sessionId;
    cwd = stringValue(row.cwd) ?? cwd;
    sessionObservedAt = stringValue(row.timestamp) ?? sessionObservedAt;
    const type = stringValue(row.type);
    if (type === "ai-title") {
      title = stringValue(row.aiTitle) ?? title;
      continue;
    }
    if (IGNORED_ROW_TYPES.has(type ?? "")) continue;
    const normalized = recordsFromEnvelope(source, sessionId, line.lineNumber, raw, row);
    if (normalized.length === 0 && type !== "system") {
      records.push(diagnosticRecord(source, line.lineNumber, raw, "claude_code_schema_not_recognized", cursorAfter));
      continue;
    }
    if (normalized.length > 0) normalized[normalized.length - 1]!.cursorAfter = cursorAfter;
    records.push(...normalized);
  }

  const observedAt = sessionObservedAt ?? info.mtime.toISOString();
  records.push(makeRecord(source, "session", observedAt, { sessionId, cwd, title }, "session", {
    sessionId,
    cwd,
    observedAt,
    project: cwd ? basename(cwd) : undefined,
    title: title ?? (cwd ? basename(cwd) : undefined)
  }));
  return records;
}

function recordsFromEnvelope(source: DiscoveredSource, sessionId: string, lineNumber: number, raw: string, row: Record<string, unknown>): AdapterRecord[] {
  const type = stringValue(row.type);
  const message = isRecord(row.message) ? row.message : undefined;
  const observedAt = stringValue(row.timestamp) ?? new Date(0).toISOString();
  if ((type === "user" || type === "assistant") && message) {
    const role = normalizeRole(stringValue(message.role) ?? type);
    const content = Array.isArray(message.content) ? message.content : [message.content];
    const output: AdapterRecord[] = [];
    const text = content.map(textPart).filter((value): value is string => Boolean(value)).join("\n\n").trim();
    if (text) output.push(makeRecord(source, `${lineNumber}:message`, observedAt, row, "message", { observedAt, role, sessionId, text }));
    for (const [index, part] of content.entries()) {
      if (!isRecord(part)) continue;
      if (part.type === "tool_use") {
        output.push(makeRecord(source, `${lineNumber}:tool_call:${index}`, observedAt, part, "tool_call", {
          arguments: isRecord(part.input) ? part.input : {}, callId: stringValue(part.id), observedAt, sessionId, toolName: stringValue(part.name) ?? "tool"
        }));
      }
      if (part.type === "tool_result") {
        output.push(makeRecord(source, `${lineNumber}:tool_result:${index}`, observedAt, part, "tool_result", {
          callId: stringValue(part.tool_use_id), observedAt, output: textValue(part.content) ?? "", sessionId,
          status: part.is_error === true ? "failed" : "succeeded"
        }));
      }
    }
    const usage = isRecord(message.usage) ? message.usage : undefined;
    if (usage || stringValue(message.model)) {
      output.push(makeRecord(source, `${lineNumber}:usage`, observedAt, message, "usage", {
        inputTokens: numberValue(usage?.input_tokens), model: stringValue(message.model), observedAt,
        outputTokens: numberValue(usage?.output_tokens), sessionId
      }));
    }
    return output;
  }
  if (type === "system") {
    const text = textValue(row.content);
    return text ? [makeRecord(source, `${lineNumber}:message`, observedAt, row, "message", { observedAt, role: "system", sessionId, text })] : [];
  }
  return [];
}

function makeRecord(source: DiscoveredSource, suffix: string, observedAt: string, payload: unknown, kind: AdapterRecord["normalized"]["kind"], value: Record<string, unknown>): AdapterRecord {
  return { diagnostics: [], normalized: adapterPayload(kind, source.confidence, source, value), observedAt, payload, payloadHash: hash(JSON.stringify(payload)), source, sourceRecordKey: `${source.path}:${suffix}` };
}

function diagnosticRecord(source: DiscoveredSource, lineNumber: number, raw: string, code: string, cursorAfter: AdapterRecord["cursorAfter"]): AdapterRecord {
  const observedAt = new Date(0).toISOString();
  const message = "Claude Code transcript row could not be normalized.";
  return { cursorAfter, diagnostics: [{ code, message, observedAt, severity: "warning" }], normalized: adapterPayload("runtime_signal", source.confidence, source, { message, observedAt, severity: "warning", signalKind: "adapter_diagnostic" }), observedAt, payload: { lineNumber }, payloadHash: hash(raw), source, sourceRecordKey: `${source.path}:${lineNumber}:diagnostic` };
}

function textPart(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!isRecord(value) || value.type !== "text") return undefined;
  return stringValue(value.text);
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) return value.map(textValue).filter((part): part is string => Boolean(part)).join("\n\n") || undefined;
  if (!isRecord(value)) return undefined;
  return textValue(value.text) ?? textValue(value.content);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
