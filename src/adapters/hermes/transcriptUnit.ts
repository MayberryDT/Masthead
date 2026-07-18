import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { adapterPayload, hash, isRecord, normalizeRole, readString } from "../generic/jsonlAdapterKit.ts";
import { quoteIdentifier, sqliteTables, tableColumns, withReadonlySqliteCopy } from "../generic/sqliteAdapterKit.ts";
import { streamJsonlLines } from "../generic/streamJsonl.ts";
import type { ParsedTranscriptUnit, TranscriptUnitPlan } from "../transcriptUnits.ts";
import { parsedTranscriptUnit } from "../transcriptUnits.ts";
import type { AdapterDiagnostic, AdapterRecord, DiscoveredSource, IngestCursor } from "../types.ts";

const SQLITE_PAGE_SIZE = 1_000;
const HERMES_SQLITE_TABLES = ["sessions", "messages"] as const;

type HermesRow = {
  cursorAfter?: AdapterRecord["cursorAfter"];
  inheritedSessionId?: string;
  locator: string;
  row: Record<string, unknown>;
};

type HermesRows = {
  diagnostics?: AdapterDiagnostic[];
  lastUpdated?: string;
  rows: HermesRow[];
  scopedDiagnostics?: Array<{ diagnostic: AdapterDiagnostic; sourceSessionId?: string }>;
  startedAt?: string;
};

export async function planHermesTranscriptUnits(source: DiscoveredSource): Promise<TranscriptUnitPlan[]> {
  if (!source.path) return [];
  const info = await stat(source.path).catch(() => undefined);
  if (!info) return [{ runtime: "hermes", source, timestampBasis: "unknown", unitId: source.path }];
  const content = await readHermesRows(source);
  const pathActivityAt = timestampFromHermesFilename(source.path);
  const discoveredSessionIds = distinctSourceSessionIds(content.rows);
  const sourceSessionIds = discoveredSessionIds.length > 0
    ? discoveredSessionIds
    : [source.sourceSessionId ?? sessionIdFromHermesFilename(source.path)].filter((value): value is string => Boolean(value));
  const plannedSessionIds: Array<string | undefined> = sourceSessionIds.length > 0 ? sourceSessionIds : [undefined];

  return plannedSessionIds.map((sourceSessionId) => {
    const sessionRows = sourceSessionId ? rowsForSession(content.rows, sourceSessionId, source.sourceKind !== "sqlite") : content.rows;
    const latestMessageAt = newestTimestamp(
      sessionRows.filter(({ row }) => isMessageRole(readString(row, ["role", "type"]))).map(({ row }) => observedAt(row))
    );
    const sessionLastUpdated = newestTimestamp(sessionRows.map(({ row }) => readTimestamp(row, ["last_updated", "ended_at"])));
    const sessionStartedAt = newestTimestamp(sessionRows.map(({ row }) => readTimestamp(row, ["started_at", "session_start"])));
    const semanticActivityAt = source.sourceKind === "sqlite"
      ? sessionLastUpdated ?? latestMessageAt ?? sessionStartedAt ?? content.lastUpdated ?? content.startedAt ?? pathActivityAt
      : content.lastUpdated ?? latestMessageAt ?? content.startedAt ?? pathActivityAt;
    return {
      fileSizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      runtime: "hermes",
      semanticActivityAt,
      source: sourceSessionId ? { ...source, sourceSessionId } : source,
      sourceSessionId,
      timestampBasis: sessionLastUpdated || latestMessageAt || sessionStartedAt || content.lastUpdated || content.startedAt ? "semantic" : pathActivityAt ? "source_path" : "file_modified",
      unitId: `hermes:${sourceSessionId ?? source.path}`
    };
  });
}

export async function parseHermesTranscriptUnit(unit: TranscriptUnitPlan, cursor?: IngestCursor): Promise<ParsedTranscriptUnit> {
  const source = unit.sourceSessionId ? { ...unit.source, sourceSessionId: unit.sourceSessionId } : unit.source;
  const content = await readHermesRows(source, cursor);
  const scopedRows = unit.sourceSessionId
    ? rowsForSession(content.rows, unit.sourceSessionId, source.sourceKind !== "sqlite")
    : content.rows;
  const shapeDiagnostics = transcriptShapeDiagnostics(scopedRows, unit.sourceSessionId ?? sessionIdFromHermesFilename(source.path));
  const records = deduplicateRecords(
    scopedRows.flatMap((entry) => recordFromRow(source, unit.sourceSessionId, entry))
  );
  const parsed = parsedTranscriptUnit({ ...unit, source }, records);
  const scopedDiagnostics = (content.scopedDiagnostics ?? [])
    .filter(({ sourceSessionId }) => !sourceSessionId || !unit.sourceSessionId || sourceSessionId === unit.sourceSessionId)
    .map(({ diagnostic }) => diagnostic);
  const diagnostics = [...(content.diagnostics ?? []), ...scopedDiagnostics, ...shapeDiagnostics];
  if (!diagnostics.length) return parsed;
  return {
    ...parsed,
    completeness: records.length === 0 && diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "unrecognized" : "partial",
    diagnostics: [...parsed.diagnostics, ...diagnostics]
  };
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
    } catch (error) {
      return { diagnostics: [parseDiagnostic("hermes_invalid_json", `${source.path}:document`, error, "error")], rows: [] };
    }
  }
  return readJsonlRows(source, cursor);
}

async function readJsonlRows(source: DiscoveredSource, cursor?: IngestCursor): Promise<HermesRows> {
  if (!source.path) return { rows: [] };
  const info = await stat(source.path);
  const resumeOffset = cursor?.sourcePath === source.path && cursor.byteOffset <= info.size ? cursor.byteOffset : 0;
  const diagnostics: AdapterDiagnostic[] = [];
  const rows: HermesRow[] = [];
  let lastUpdated: string | undefined;
  for await (const line of streamJsonlLines(source.path, resumeOffset)) {
    let value: unknown;
    try {
      value = JSON.parse(line.raw);
    } catch (error) {
      diagnostics.push(parseDiagnostic("hermes_invalid_json", `${source.path}:${line.lineNumber}`, error));
      continue;
    }
    if (!isRecord(value) || Array.isArray(value)) {
      diagnostics.push(parseDiagnostic("hermes_non_object_row", `${source.path}:${line.lineNumber}`));
      continue;
    }
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
  return { diagnostics, lastUpdated, rows };
}

async function readSqliteRows(path: string): Promise<HermesRows> {
  return withReadonlySqliteCopy(path, (db) => {
    const diagnostics: AdapterDiagnostic[] = [];
    const rows: HermesRow[] = [];
    const scopedDiagnostics: Array<{ diagnostic: AdapterDiagnostic; sourceSessionId?: string }> = [];
    let lastUpdated: string | undefined;
    let startedAt: string | undefined;
    const availableTables = new Set(sqliteTables(db));
    for (const table of HERMES_SQLITE_TABLES) {
      if (!availableTables.has(table)) continue;
      let offset = 0;
      while (true) {
        let values: Array<Record<string, unknown>>;
        try {
          values = sqliteTablePage(db, table, offset);
        } catch (error) {
          diagnostics.push(sqliteQueryDiagnostic(table, error));
          break;
        }
        for (const [index, rawRow] of values.entries()) {
          const value = sqliteJsonValue(rawRow) ?? rawRow;
          const parsed = rowsFromJsonValue(value, `${path}:${table}:${offset + index}`);
          const sourceSessionId = readString(rawRow, ["session_id", "sessionId", "conversation_id", "conversationId"]);
          scopedDiagnostics.push(...(parsed.diagnostics ?? []).map((diagnostic) => ({ diagnostic, sourceSessionId })));
          rows.push(...parsed.rows);
          lastUpdated = newestTimestamp([lastUpdated, parsed.lastUpdated]);
          startedAt = newestTimestamp([startedAt, parsed.startedAt]);
        }
        if (values.length < SQLITE_PAGE_SIZE) break;
        offset += values.length;
      }
    }
    return { diagnostics, lastUpdated, rows, scopedDiagnostics, startedAt };
  }).catch((error) => ({ diagnostics: [sqliteQueryDiagnostic("database", error)], rows: [] }));
}

function sqliteTablePage(db: DatabaseSync, table: string, offset: number): Array<Record<string, unknown>> {
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql?: unknown } | undefined;
  const withoutRowid = typeof schema?.sql === "string" && /\bWITHOUT\s+ROWID\b/i.test(schema.sql);
  const orderBy = withoutRowid ? tableColumns(db, table).map(quoteIdentifier).join(", ") : "rowid";
  if (!orderBy) throw new Error("table has no deterministic ordering columns");
  return db
    .prepare(`SELECT * FROM ${quoteIdentifier(table)} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(SQLITE_PAGE_SIZE, offset) as Array<Record<string, unknown>>;
}

function sqliteQueryDiagnostic(table: string, error: unknown): AdapterDiagnostic {
  return {
    code: "hermes_sqlite_query_failed",
    details: error instanceof Error ? error.message : String(error),
    message: `Hermes SQLite table could not be read completely: ${table}.`,
    observedAt: new Date(0).toISOString(),
    severity: "error"
  };
}

function sqliteJsonValue(row: Record<string, unknown>): unknown {
  for (const key of ["value", "data", "json", "payload", "record", "content"]) {
    const value = row[key];
    if (typeof value !== "string") continue;
    try {
      const parsed = JSON.parse(value);
      if (isRecord(parsed)) return { ...row, ...parsed };
      if (key === "content" && typeof parsed === "string") return { ...row, content: parsed };
      return undefined;
    } catch {
      // This is an ordinary relational value, not a JSON document.
    }
  }
  return undefined;
}

function rowsFromJsonValue(value: unknown, locator: string): HermesRows {
  if (!isRecord(value) || Array.isArray(value)) return { diagnostics: [parseDiagnostic("hermes_non_object_row", locator)], rows: [] };
  const inheritedSessionId = readString(value, ["session_id", "sessionId", "conversation_id", "conversationId"]);
  const lastUpdated = newestTimestamp([readTimestamp(value, ["last_updated"]), readTimestamp(value, ["ended_at"])]);
  const startedAt = readTimestamp(value, ["started_at"]);
  if (Array.isArray(value.messages)) {
    const diagnostics: AdapterDiagnostic[] = [];
    const rows: HermesRow[] = [];
    for (const [index, row] of value.messages.entries()) {
      if (isRecord(row)) rows.push({ inheritedSessionId, locator: `${locator}:message:${index}`, row });
      else diagnostics.push(parseDiagnostic("hermes_non_object_row", `${locator}:message:${index}`));
    }
    return {
      diagnostics,
      lastUpdated,
      rows,
      startedAt
    };
  }
  return { lastUpdated, rows: [{ inheritedSessionId, locator, row: value }], startedAt };
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
    const records: AdapterRecord[] = [];
    const text = textValue(row.content ?? row.text ?? row.message);
    if (text) {
      records.push(makeRecord(sourceWithSession, entry, timestamp, "message", {
        observedAt: timestamp,
        role: normalizeRole(role),
        sessionId: sourceSessionId,
        text
      }));
    }
    const toolCalls = toolCallsValue(row.tool_calls);
    if (role === "assistant" && toolCalls) {
      for (const [index, value] of toolCalls.entries()) {
        if (!isRecord(value)) continue;
        const fn = isRecord(value.function) ? value.function : undefined;
        const toolName = readString(value, ["name"]) ?? readString(fn, ["name"]);
        if (!toolName) continue;
        const argumentsValue = value.arguments ?? fn?.arguments;
        records.push(makeRecord(sourceWithSession, entry, timestamp, "tool_call", {
          arguments: toolArguments(argumentsValue),
          callId: readString(value, ["id", "tool_call_id", "call_id"]) ?? stableToolCallId(sourceSessionId, timestamp, index, value),
          observedAt: timestamp,
          sessionId: sourceSessionId,
          toolName
        }));
      }
    }
    return records;
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

function distinctSourceSessionIds(rows: HermesRow[]): string[] {
  return [...new Set(rows.flatMap(({ inheritedSessionId, row }) => {
    const sourceSessionId = readString(row, ["session_id", "sessionId", "conversation_id", "conversationId"]) ?? inheritedSessionId;
    return sourceSessionId ? [sourceSessionId] : [];
  }))].toSorted();
}

function rowsForSession(rows: HermesRow[], sourceSessionId: string, includeUnidentified = false): HermesRow[] {
  return rows.filter(({ inheritedSessionId, row }) => {
    const rowSessionId = readString(row, ["session_id", "sessionId", "conversation_id", "conversationId"]) ?? inheritedSessionId;
    return rowSessionId === sourceSessionId || (includeUnidentified && !rowSessionId);
  });
}

function transcriptShapeDiagnostics(rows: HermesRow[], fallbackSessionId: string | undefined): AdapterDiagnostic[] {
  const diagnostics: AdapterDiagnostic[] = [];
  for (const entry of rows) {
    const role = readString(entry.row, ["role", "type"]);
    if (entry.locator.includes(":sessions:") || role === "session_meta") continue;
    const sourceSessionId = readString(entry.row, ["session_id", "sessionId", "conversation_id", "conversationId"])
      ?? entry.inheritedSessionId
      ?? fallbackSessionId;
    if (!sourceSessionId) diagnostics.push(parseDiagnostic("hermes_missing_identity", entry.locator));
    if (!role) {
      diagnostics.push(parseDiagnostic("hermes_unknown_shape", entry.locator));
      continue;
    }
    if (!isMessageRole(role)) {
      diagnostics.push(parseDiagnostic("hermes_unknown_role", entry.locator));
      continue;
    }
    if (sourceSessionId && recordFromRow(
      { confidence: "heuristic", runtime: "hermes", schemaVersion: "diagnostic", sourceId: "diagnostic", sourceKind: "sqlite" },
      sourceSessionId,
      entry
    ).length === 0) {
      diagnostics.push(parseDiagnostic("hermes_unknown_shape", entry.locator));
    }
  }
  return diagnostics;
}

function parseDiagnostic(
  code: string,
  locator: string,
  error?: unknown,
  severity: AdapterDiagnostic["severity"] = "warning"
): AdapterDiagnostic {
  return {
    code,
    ...(error ? { details: error instanceof Error ? error.message : String(error) } : {}),
    message: `Hermes transcript row could not be normalized: ${locator}.`,
    observedAt: new Date(0).toISOString(),
    severity
  };
}

function observedAt(row: Record<string, unknown>): string | undefined {
  return readTimestamp(row, ["timestamp", "created_at", "createdAt", "updated_at", "updatedAt", "time", "session_start"]);
}

function readTimestamp(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return unixTimestamp(value);
    if (typeof value !== "string" || !value.trim()) continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return unixTimestamp(numeric);
    if (Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  }
  return undefined;
}

function unixTimestamp(value: number): string | undefined {
  const milliseconds = Math.abs(value) < 1_000_000_000_000 ? value * 1_000 : value;
  const date = new Date(milliseconds);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : undefined;
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

function toolCallsValue(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function stableToolCallId(sourceSessionId: string, observedAt: string, index: number, value: Record<string, unknown>): string {
  return `hermes:${hash(stableJson({ index, observedAt, sourceSessionId, value })).slice(0, 24)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}
