import { basename } from "node:path";
import { adapterPayload, hash, isRecord, normalizeRole } from "../generic/jsonlAdapterKit.ts";
import { withReadonlySqliteCopy } from "../generic/sqliteAdapterKit.ts";
import type { ParsedTranscriptUnit, TranscriptUnitPlan } from "../transcriptUnits.ts";
import { parsedTranscriptUnit } from "../transcriptUnits.ts";
import type { AdapterRecord, DiscoveredSource, IngestCursor } from "../types.ts";

export async function planOpenCodeTranscriptUnits(source: DiscoveredSource): Promise<TranscriptUnitPlan[]> {
  if (!source.path) return [];
  const sessions = await withReadonlySqliteCopy(source.path, (db) => db.prepare(
    "SELECT * FROM session ORDER BY id"
  ).all() as Array<Record<string, unknown>>).catch(() => []);
  return sessions.map((session) => {
    const sourceSessionId = String(session.id);
    const semanticActivityAt = optionalTimestamp(session.time_updated) ?? optionalTimestamp(session.time_created);
    return {
      modifiedAt: semanticActivityAt,
      runtime: "opencode" as const,
      semanticActivityAt,
      source: { ...source, sourceSessionId },
      sourceSessionId,
      timestampBasis: "semantic" as const,
      unitId: `opencode:${sourceSessionId}`
    };
  });
}

export async function parseOpenCodeTranscriptUnit(unit: TranscriptUnitPlan, _cursor?: IngestCursor): Promise<ParsedTranscriptUnit> {
  const source = unit.sourceSessionId ? { ...unit.source, sourceSessionId: unit.sourceSessionId } : unit.source;
  const records = source.path && unit.sourceSessionId ? await readSession(source, unit.sourceSessionId) : [];
  return parsedTranscriptUnit({ ...unit, source }, records);
}

export async function* backfillOpenCodeSource(source: DiscoveredSource, cursor?: IngestCursor): AsyncIterable<AdapterRecord> {
  for (const unit of await planOpenCodeTranscriptUnits(source)) {
    const parsed = await parseOpenCodeTranscriptUnit(unit, cursor);
    for (const record of parsed.records) yield record;
  }
}

async function readSession(source: DiscoveredSource, sessionId: string): Promise<AdapterRecord[]> {
  return withReadonlySqliteCopy(source.path!, (db) => {
    const session = db.prepare("SELECT * FROM session WHERE id = ?").get(sessionId) as Record<string, unknown> | undefined;
    if (!session) return [];
    const messages = db.prepare("SELECT * FROM message WHERE session_id = ? ORDER BY time_created, id").all(sessionId) as Array<Record<string, unknown>>;
    const parts = db.prepare("SELECT * FROM part WHERE session_id = ? ORDER BY time_created, id").all(sessionId) as Array<Record<string, unknown>>;
    const partsByMessage = new Map<string, Array<Record<string, unknown>>>();
    for (const part of parts) {
      const id = stringValue(part.message_id);
      if (id) partsByMessage.set(id, [...(partsByMessage.get(id) ?? []), part]);
    }
    const observedAt = timestamp(session.time_created);
    const records: AdapterRecord[] = [record(source, sessionId, "session", observedAt, session, "session", {
      cwd: stringValue(session.directory), observedAt, project: projectFromDirectory(stringValue(session.directory)), sessionId, title: stringValue(session.title)
    })];
    for (const messageRow of messages) {
      const data = jsonObject(messageRow.data);
      const role = normalizeRole(stringValue(data?.role) ?? "");
      const messageId = stringValue(messageRow.id) ?? "message";
      const messageParts = partsByMessage.get(messageId) ?? [];
      const text = messageParts.map((part) => {
        const value = jsonObject(part.data);
        return value?.type === "text" ? stringValue(value.text) : undefined;
      }).filter((value): value is string => Boolean(value)).join("\n\n");
      const messageObservedAt = timestamp(messageRow.time_created);
      if (role && text) records.push(record(source, sessionId, `message:${messageId}`, messageObservedAt, messageRow, "message", { observedAt: messageObservedAt, role, sessionId, text }));
      for (const part of messageParts) records.push(...recordsFromPart(source, sessionId, messageId, messageObservedAt, part));
      const tokens = isRecord(data?.tokens) ? data.tokens : undefined;
      const model = isRecord(data?.model) ? data.model : undefined;
      const modelId = stringValue(data?.modelID) ?? stringValue(model?.modelID);
      const providerId = stringValue(data?.providerID) ?? stringValue(model?.providerID);
      const inputTokens = numberValue(tokens?.input);
      const outputTokens = numberValue(tokens?.output);
      const totalTokens = numberValue(tokens?.total) ??
        (inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined);
      if (tokens || modelId || providerId) records.push(record(source, sessionId, `usage:${messageId}`, messageObservedAt, messageRow, "usage", {
        inputTokens, model: modelId, observedAt: messageObservedAt,
        outputTokens, provider: providerId, sessionId, totalTokens
      }));
    }
    return records;
  });
}

function recordsFromPart(source: DiscoveredSource, sessionId: string, messageId: string, messageObservedAt: string, partRow: Record<string, unknown>): AdapterRecord[] {
  const part = jsonObject(partRow.data);
  if (!part) return [partDiagnostic(source, sessionId, messageId, partRow, messageObservedAt, "opencode_part_data_invalid", "OpenCode part data is not valid JSON.")];
  const type = stringValue(part.type);
  const partId = stringValue(partRow.id) ?? "part";
  if (type === "text") return [];
  if (type === "tool") {
    const state = isRecord(part.state) ? part.state : undefined;
    const callId = stringValue(part.callID);
    const toolName = stringValue(part.tool);
    if (!state || !callId || !toolName) {
      return [partDiagnostic(source, sessionId, `${messageId}:${partId}`, partRow, messageObservedAt, "opencode_tool_part_invalid", "OpenCode tool part is missing its call, tool, or state data.")];
    }
    const time = isRecord(state.time) ? state.time : undefined;
    const startedAt = timestampOr(time?.start, messageObservedAt);
    const output: AdapterRecord[] = [record(source, sessionId, `part:${partId}:tool_call`, startedAt, partRow, "tool_call", {
      arguments: isRecord(state.input) ? state.input : {}, callId, observedAt: startedAt, sessionId, toolName
    })];
    const status = stringValue(state.status);
    if (status === "completed" || status === "error") {
      const completedAt = timestampOr(time?.end, messageObservedAt);
      output.push(record(source, sessionId, `part:${partId}:tool_result`, completedAt, partRow, "tool_result", {
        callId, observedAt: completedAt, output: stringValue(status === "completed" ? state.output : state.error) ?? "", sessionId,
        status: status === "completed" ? "succeeded" : "failed", toolName
      }));
    }
    return output;
  }
  if (type === "reasoning" || type === "compaction" || type === "snapshot" || type === "patch") {
    return [record(source, sessionId, `part:${partId}:${type}`, messageObservedAt, partRow, "checkpoint", {
      checkpointId: partId, checkpointKind: type === "compaction" ? "compacted" : type, observedAt: messageObservedAt, sessionId,
      summary: type === "reasoning" ? "Reasoning checkpoint" : `OpenCode ${type} checkpoint`
    })];
  }
  if (["agent", "file", "retry", "step-finish", "step-start", "subtask"].includes(type ?? "")) {
    return [record(source, sessionId, `part:${partId}:${type}`, messageObservedAt, partRow, "runtime_signal", {
      message: `OpenCode ${type} part`, observedAt: messageObservedAt, sessionId, severity: type === "retry" ? "warning" : "info",
      signalKind: `opencode_${type!.replaceAll("-", "_")}`
    })];
  }
  return [partDiagnostic(source, sessionId, `${messageId}:${partId}`, partRow, messageObservedAt, "opencode_part_type_unrecognized", `Unrecognized OpenCode part type: ${type ?? "missing"}.`)];
}

function partDiagnostic(source: DiscoveredSource, sessionId: string, suffix: string, payload: unknown, observedAt: string, code: string, message: string): AdapterRecord {
  return {
    diagnostics: [{ code, message, observedAt, severity: "warning" }],
    normalized: adapterPayload("runtime_signal", source.confidence, source, { message, observedAt, sessionId, severity: "warning", signalKind: "adapter_diagnostic" }),
    observedAt, payload, payloadHash: hash(JSON.stringify(payload)), source, sourceRecordKey: `${source.path}:${sessionId}:${suffix}:diagnostic`
  };
}

function record(source: DiscoveredSource, sessionId: string, suffix: string, observedAt: string, payload: unknown, kind: AdapterRecord["normalized"]["kind"], value: Record<string, unknown>): AdapterRecord {
  return { diagnostics: [], normalized: adapterPayload(kind, source.confidence, source, value), observedAt, payload, payloadHash: hash(JSON.stringify(payload)), source, sourceRecordKey: `${source.path}:${sessionId}:${suffix}` };
}
function jsonObject(value: unknown): Record<string, unknown> | undefined { if (typeof value !== "string") return undefined; try { const parsed = JSON.parse(value); return isRecord(parsed) && !Array.isArray(parsed) ? parsed : undefined; } catch { return undefined; } }
function timestamp(value: unknown): string { const number = numberValue(value); return number !== undefined ? new Date(number < 1_000_000_000_000 ? number * 1_000 : number).toISOString() : new Date(0).toISOString(); }
function optionalTimestamp(value: unknown): string | undefined { return numberValue(value) === undefined ? undefined : timestamp(value); }
function timestampOr(value: unknown, fallback: string): string { return numberValue(value) === undefined ? fallback : timestamp(value); }
function projectFromDirectory(value: string | undefined): string | undefined { return value ? basename(value) : undefined; }
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
