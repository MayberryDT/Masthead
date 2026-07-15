import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { adapterPayload, hash, isRecord, normalizeRole, readString } from "../generic/jsonlAdapterKit.ts";
import { quoteIdentifier, sqliteTables, withReadonlySqliteCopy } from "../generic/sqliteAdapterKit.ts";
import { streamJsonlLines } from "../generic/streamJsonl.ts";
import type { ParsedTranscriptUnit, TranscriptUnitPlan } from "../transcriptUnits.ts";
import { parsedTranscriptUnit } from "../transcriptUnits.ts";
import type { AdapterRecord, DiscoveredSource, IngestCursor } from "../types.ts";

type HermesRow = {
  cursorAfter?: AdapterRecord["cursorAfter"];
  inheritedSessionId?: string;
  locator: string;
  row: Record<string, unknown>;
};

type HermesRows = {
  lastUpdated?: string;
  rows: HermesRow[];
};

export async function planHermesTranscriptUnits(source: DiscoveredSource): Promise<TranscriptUnitPlan[]> {
  if (!source.path) return [];
  const info = await stat(source.path).catch(() => undefined);
  if (!info) return [{ runtime: "hermes", source, timestampBasis: "unknown", unitId: source.path }];
  const content = await readHermesRows(source);
  const sourceSessionId = sourceSessionIdFromRows(content.rows) ?? source.sourceSessionId ?? sessionIdFromHermesFilename(source.path);
  const latestMessageAt = newestTimestamp(
    content.rows.filter(({ row }) => isMessageRole(readString(row, ["role", "type"]))).map(({ row }) => observedAt(row))
  );
  const pathActivityAt = timestampFromHermesFilename(source.path);
  const semanticActivityAt = content.lastUpdated ?? latestMessageAt ?? pathActivityAt;

  return [
    {
      fileSizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      runtime: "hermes",
      semanticActivityAt,
      source: sourceSessionId ? { ...source, sourceSessionId } : source,
      sourceSessionId,
      timestampBasis: content.lastUpdated || latestMessageAt ? "semantic" : pathActivityAt ? "source_path" : "file_modified",
      unitId: `hermes:${sourceSessionId ?? source.path}`
    }
  ];
}

export async function parseHermesTranscriptUnit(unit: TranscriptUnitPlan, cursor?: IngestCursor): Promise<ParsedTranscriptUnit> {
  const source = unit.sourceSessionId ? { ...unit.source, sourceSessionId: unit.sourceSessionId } : unit.source;
  const content = await readHermesRows(source, cursor);
  const records = deduplicateRecords(
    content.rows.flatMap((entry) => recordFromRow(source, unit.sourceSessionId, entry))
  );
  return parsedTranscriptUnit({ ...unit, source }, records);
}

export async function* backfillHermesSource(source: DiscoveredSource, cursor?: IngestCursor): AsyncIterable<AdapterRecord> {
  for (const unit of await planHermesTranscriptUnits(source)) {
    const parsed = await parseHermesTranscriptUnit(unit, cursor);
    for (const record of parsed.records) yield record;
  }
}

export function sessionIdFromHermesFilename(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const name = basename(path).replace(/\.(jsonl|json)$/i, "").replace(/^session_/, "");
  return /^\d{8}_\d{6}(?:_.+)?$/.test(name) ? name : undefined;
}

async function readHermesRows(source: DiscoveredSource, cursor?: IngestCursor): Promise<HermesRows> {
  if (!source.path) return { rows: [] };
  if (source.sourceKind === "sqlite") return readSqliteRows(source.path);
  if (source.path.endsWith(".json") && !source.path.endsWith(".jsonl")) {
    try {
      return rowsFromJsonValue(JSON.parse(await readFile(source.path, "utf8")), `${source.path}:document`);
    } catch {
      return { rows: [] };
    }
  }
  return readJsonlRows(source, cursor);
}

async function readJsonlRows(source: DiscoveredSource, cursor?: IngestCursor): Promise<HermesRows> {
  if (!source.path) return { rows: [] };
  const info = await stat(source.path);
  const resumeOffset = cursor?.sourcePath === source.path && cursor.byteOffset <= info.size ? cursor.byteOffset : 0;
  const rows: HermesRow[] = [];
  let lastUpdated: string | undefined;
  for await (const line of streamJsonlLines(source.path, resumeOffset)) {
    let value: unknown;
    try {
      value = JSON.parse(line.raw);
    } catch {
      continue;
    }
    if (!isRecord(value)) continue;
    lastUpdated = newestTimestamp([lastUpdated, readTimestamp(value, ["last_updated"])]);
    rows.push({
      cursorAfter: {
        byteOffset: line.byteOffsetAfter,
        contentFingerprint: `${info.size}:${Math.trunc(info.mtimeMs)}`,
        modifiedAt: info.mtime.toISOString(),
        sourceId: source.sourceId,
        sourcePath: source.path,
        sourceSessionId: source.sourceSessionId ?? sessionIdFromHermesFilename(source.path)
      },
      locator: `${source.path}:${line.lineNumber}`,
      row: value
    });
  }
  return { lastUpdated, rows };
}

async function readSqliteRows(path: string): Promise<HermesRows> {
  return withReadonlySqliteCopy(path, (db) => {
    const rows: HermesRow[] = [];
    let lastUpdated: string | undefined;
    for (const table of sqliteTables(db)) {
      const values = db.prepare(`SELECT * FROM ${quoteIdentifier(table)} LIMIT 5000`).all() as Array<Record<string, unknown>>;
      for (const [index, rawRow] of values.entries()) {
        const value = sqliteJsonValue(rawRow) ?? rawRow;
        const parsed = rowsFromJsonValue(value, `${path}:${table}:${index}`);
        rows.push(...parsed.rows);
        lastUpdated = newestTimestamp([lastUpdated, parsed.lastUpdated]);
      }
    }
    return { lastUpdated, rows };
  }).catch(() => ({ rows: [] }));
}

function sqliteJsonValue(row: Record<string, unknown>): unknown {
  for (const key of ["value", "data", "json", "payload"]) {
    const value = row[key];
    if (typeof value !== "string") continue;
    try {
      return JSON.parse(value);
    } catch {
      // This is an ordinary relational value, not a JSON document.
    }
  }
  return undefined;
}

function rowsFromJsonValue(value: unknown, locator: string): HermesRows {
  if (!isRecord(value)) return { rows: [] };
  const inheritedSessionId = readString(value, ["session_id", "sessionId", "conversation_id", "conversationId"]);
  const lastUpdated = readTimestamp(value, ["last_updated"]);
  if (Array.isArray(value.messages)) {
    return {
      lastUpdated,
      rows: value.messages.filter(isRecord).map((row, index) => ({ inheritedSessionId, locator: `${locator}:message:${index}`, row }))
    };
  }
  return { lastUpdated, rows: [{ inheritedSessionId, locator, row: value }] };
}

function recordFromRow(source: DiscoveredSource, unitSessionId: string | undefined, entry: HermesRow): AdapterRecord[] {
  const row = entry.row;
  const role = readString(row, ["role", "type"]);
  if (role === "session_meta") return [];
  const sourceSessionId =
    readString(row, ["session_id", "sessionId", "conversation_id", "conversationId"]) ??
    entry.inheritedSessionId ??
    unitSessionId ??
    sessionIdFromHermesFilename(source.path);
  if (!sourceSessionId) return [];
  const timestamp = observedAt(row) ?? new Date(0).toISOString();
  const sourceWithSession = { ...source, sourceSessionId };

  if (role === "tool" && readString(row, ["name", "tool_name"]) && Object.hasOwn(row, "arguments")) {
    return [
      makeRecord(sourceWithSession, entry, timestamp, "tool_call", {
        arguments: toolArguments(row.arguments),
        callId: readString(row, ["tool_call_id", "call_id"]),
        observedAt: timestamp,
        sessionId: sourceSessionId,
        toolName: readString(row, ["name", "tool_name"])
      })
    ];
  }
  if (role === "tool" && readString(row, ["tool_call_id", "call_id"]) && textValue(row.content ?? row.output)) {
    return [
      makeRecord(sourceWithSession, entry, timestamp, "tool_result", {
        callId: readString(row, ["tool_call_id", "call_id"]),
        observedAt: timestamp,
        output: textValue(row.content ?? row.output),
        sessionId: sourceSessionId,
        status: readString(row, ["status"]) ?? "unknown",
        toolName: readString(row, ["name", "tool_name"])
      })
    ];
  }
  if (role === "user" || role === "assistant" || role === "system") {
    const text = textValue(row.content ?? row.text ?? row.message);
    if (!text) return [];
    return [
      makeRecord(sourceWithSession, entry, timestamp, "message", {
        observedAt: timestamp,
        role: normalizeRole(role),
        sessionId: sourceSessionId,
        text
      })
    ];
  }
  return [];
}

function makeRecord(
  source: DiscoveredSource,
  entry: HermesRow,
  observedAt: string,
  kind: AdapterRecord["normalized"]["kind"],
  value: Record<string, unknown>
): AdapterRecord {
  const payloadHash = hash(stableJson({ kind, value }));
  const sourceSessionId = String(value.sessionId);
  const sourceRecordKey = `hermes:${sourceSessionId}:${kind}:${observedAt}:${payloadHash}`;
  return {
    cursorAfter: entry.cursorAfter,
    diagnostics: [],
    normalized: adapterPayload(kind, source.confidence, source, value),
    observedAt,
    payload: entry.row,
    payloadHash,
    source,
    sourceRecordKey
  };
}

function deduplicateRecords(records: AdapterRecord[]): AdapterRecord[] {
  const deduplicated = new Map<string, AdapterRecord>();
  for (const record of records) {
    const value = record.normalized.value as Record<string, unknown>;
    const key = `${String(value.sessionId)}\0${record.normalized.kind}\0${record.observedAt}\0${record.payloadHash}`;
    const existing = deduplicated.get(key);
    if (!existing || record.sourceRecordKey.localeCompare(existing.sourceRecordKey) < 0) {
      deduplicated.set(key, record);
      continue;
    }
    if ((record.cursorAfter?.byteOffset ?? -1) > (existing.cursorAfter?.byteOffset ?? -1)) {
      existing.cursorAfter = record.cursorAfter;
    }
  }
  return [...deduplicated.values()];
}

function sourceSessionIdFromRows(rows: HermesRow[]): string | undefined {
  for (const { inheritedSessionId, row } of rows) {
    const sourceSessionId = readString(row, ["session_id", "sessionId", "conversation_id", "conversationId"]) ?? inheritedSessionId;
    if (sourceSessionId) return sourceSessionId;
  }
  return undefined;
}

function observedAt(row: Record<string, unknown>): string | undefined {
  return readTimestamp(row, ["timestamp", "created_at", "createdAt", "updated_at", "updatedAt", "time", "session_start"]);
}

function readTimestamp(row: Record<string, unknown>, keys: string[]): string | undefined {
  const value = readString(row, keys);
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

function timestampFromHermesFilename(path: string): string | undefined {
  const sessionId = sessionIdFromHermesFilename(path);
  const match = sessionId?.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  const value = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function newestTimestamp(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .toSorted((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function isMessageRole(role: string | undefined): boolean {
  return role === "user" || role === "assistant" || role === "system" || role === "tool";
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const text = value.map(textValue).filter((item): item is string => Boolean(item)).join("\n\n").trim();
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
    return isRecord(parsed) ? parsed : { raw: value };
  } catch {
    return { raw: value };
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}
