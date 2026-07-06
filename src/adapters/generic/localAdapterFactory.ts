import { readdir, stat, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { AdapterRecord, DiscoveredSource, DiscoveryContext, IngestCursor, RuntimeKind, SessionAdapter, SourceInventory } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";
import {
  backfillJsonlSource,
  normalizeJsonlPayload,
  type JsonlShapeProfile,
  adapterPayload,
  hash,
  isRecord,
  normalizeRole,
  readString,
  readPath
} from "./jsonlAdapterKit.ts";
import { quoteIdentifier, sqliteTables, tableColumns, withReadonlySqliteCopy } from "./sqliteAdapterKit.ts";

export type LocalAdapterOptions = {
  runtime: RuntimeKind;
  candidatePaths: (context: DiscoveryContext) => AdapterPathCandidate[];
  jsonlProfile?: JsonlShapeProfile;
  markdown?: boolean;
};

export function createLocalAdapter(options: LocalAdapterOptions): SessionAdapter {
  return {
    runtime: options.runtime,
    discover: (context) => discoverLocalSources(context, options),
    inspect: inspectLocalSource,
    backfill: (source, cursor) => backfillLocalSource(source, cursor, options),
    async *watch() {
      return;
    }
  };
}

export async function discoverLocalSources(context: DiscoveryContext, options: LocalAdapterOptions): Promise<DiscoveredSource[]> {
  const sources: DiscoveredSource[] = [];
  for (const candidate of options.candidatePaths(context)) {
    try {
      const path = candidatePath(context, candidate);
      const info = await stat(path);
      if (info.isFile()) {
        sources.push(sourceFromCandidate(options.runtime, candidate, path));
      } else if (info.isDirectory()) {
        const files = await candidateFiles(path, candidate.maxDepth ?? 4, candidate.contentKind);
        for (const file of files) sources.push(sourceFromCandidate(options.runtime, candidate, file));
      }
    } catch {
      // Missing or unreadable candidates are reported by preflight, not discovery.
    }
  }
  return sources;
}

async function inspectLocalSource(source: DiscoveredSource): Promise<SourceInventory> {
  return {
    failures: [],
    recordCount: 0,
    sessionCount: source.path ? 1 : 0,
    source
  };
}

async function* backfillLocalSource(source: DiscoveredSource, _cursor: IngestCursor | undefined, options: LocalAdapterOptions): AsyncIterable<AdapterRecord> {
  if (!source.path) return;
  if (source.sourceKind === "jsonl" && options.jsonlProfile) {
    if (source.path.endsWith(".json") && !source.path.endsWith(".jsonl")) {
      yield* backfillJsonDocumentSource(source, options.jsonlProfile);
      return;
    }
    yield* backfillJsonlSource(source, options.jsonlProfile, { confidence: source.confidence });
    return;
  }
  if (options.markdown && (source.path.endsWith(".md") || source.path.endsWith(".markdown") || source.path.includes("history"))) {
    yield* backfillMarkdownSource(source);
    return;
  }
  if (source.sourceKind === "sqlite" && options.jsonlProfile) {
    yield* backfillSqliteSource(source, options.jsonlProfile);
    return;
  }
  yield diagnosticRecord(source, `${source.runtime}_schema_not_recognized`);
}

async function* backfillJsonDocumentSource(source: DiscoveredSource, profile: JsonlShapeProfile): AsyncIterable<AdapterRecord> {
  if (!source.path) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(source.path, "utf8"));
  } catch {
    yield diagnosticRecord(source, "json_invalid_document");
    return;
  }

  const records = recordsFromJsonDocument(source, profile, parsed);
  if (records.length === 0) {
    const normalized = normalizeJsonlPayload(parsed, profile, source, source.confidence);
    if (normalized) {
      const observedAt = readString(parsed, profile.observedAtKeys) ?? new Date(0).toISOString();
      yield adapterRecord(source, `${source.path}:document`, observedAt, parsed, normalized);
      return;
    }
    yield diagnosticRecord(source, `${source.runtime}_schema_not_recognized`);
    return;
  }

  for (const record of records) yield record;
}

async function* backfillSqliteSource(source: DiscoveredSource, profile: JsonlShapeProfile): AsyncIterable<AdapterRecord> {
  if (!source.path) return;
  const records = await withReadonlySqliteCopy(source.path, (db) => {
    const output: AdapterRecord[] = [];
    for (const table of sqliteTables(db)) {
      const columns = tableColumns(db, table);
      const lowerColumns = new Map(columns.map((column) => [column.toLowerCase(), column]));
      const keyColumn = firstColumn(lowerColumns, ["key", "name", "id"]);
      const valueColumn = firstColumn(lowerColumns, ["value", "data", "json", "payload"]);
      if (keyColumn && valueColumn) {
        const rows = db
          .prepare(`SELECT ${quoteIdentifier(keyColumn)} AS key, ${quoteIdentifier(valueColumn)} AS value FROM ${quoteIdentifier(table)} LIMIT 5000`)
          .all() as Array<{ key: unknown; value: unknown }>;
        for (let index = 0; index < rows.length; index += 1) {
          output.push(...recordsFromSqliteJsonValue(source, profile, table, index, rows[index].value));
        }
        continue;
      }

      const sessionColumn = firstColumn(lowerColumns, ["sessionid", "session_id", "conversationid", "conversation_id"]);
      const roleColumn = firstColumn(lowerColumns, ["role", "speaker", "type"]);
      const textColumn = firstColumn(lowerColumns, ["content", "text", "message"]);
      const observedColumn = firstColumn(lowerColumns, ["timestamp", "createdat", "created_at", "observedat", "observed_at", "time"]);
      if (sessionColumn && roleColumn && textColumn) {
        const rows = db
          .prepare(
            `SELECT ${quoteIdentifier(sessionColumn)} AS sessionId, ${quoteIdentifier(roleColumn)} AS role, ${quoteIdentifier(textColumn)} AS text${
              observedColumn ? `, ${quoteIdentifier(observedColumn)} AS observedAt` : ""
            } FROM ${quoteIdentifier(table)} LIMIT 5000`
          )
          .all() as Array<{ observedAt?: unknown; role: unknown; sessionId: unknown; text: unknown }>;
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          const sessionId = stringValue(row.sessionId);
          const role = stringValue(row.role);
          const text = stringValue(row.text);
          if (!sessionId || !role || !text) continue;
          const observedAt = stringValue(row.observedAt) ?? new Date(0).toISOString();
          output.push(adapterRecord(source, `${source.path}:${table}:${index}`, observedAt, { role, sessionId, text }, adapterPayload("message", source.confidence, source, { observedAt, role: normalizeRole(role), sessionId, text })));
        }
      }
    }
    return output;
  }).catch(() => [diagnosticRecord(source, `${source.runtime}_sqlite_unreadable`)]);

  if (records.length === 0) {
    yield diagnosticRecord(source, `${source.runtime}_schema_not_recognized`);
    return;
  }
  for (const record of records) yield record;
}

function recordsFromJsonDocument(source: DiscoveredSource, profile: JsonlShapeProfile, value: unknown): AdapterRecord[] {
  if (!isRecord(value)) return [];
  const sessionId = readString(value, profile.sessionIdKeys) ?? profile.fallbackSessionId?.(source);
  if (!sessionId) return [];
  const documentObservedAt = readString(value, profile.observedAtKeys) ?? new Date(0).toISOString();
  const messages = jsonValueMessagesWithTimestamps(value, profile, documentObservedAt);
  return messages.map((message, index) =>
    adapterRecord(
      source,
      `${source.path}:message:${index + 1}`,
      message.observedAt,
      message.payload,
      adapterPayload("message", source.confidence, source, {
        observedAt: message.observedAt,
        role: normalizeRole(message.role),
        sessionId,
        text: message.text
      })
    )
  );
}

function recordsFromSqliteJsonValue(source: DiscoveredSource, profile: JsonlShapeProfile, table: string, index: number, value: unknown): AdapterRecord[] {
  const text = sqliteValueText(value);
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const sourceRecordKey = `${source.path}:${table}:${index}`;
  const normalized = normalizeJsonlPayload(parsed, profile, source, source.confidence);
  if (normalized && normalized.kind !== "event") {
    const observedAt = stringValue(readPath(normalized.value, "observedAt")) ?? new Date(0).toISOString();
    return [adapterRecord(source, sourceRecordKey, observedAt, parsed, normalized)];
  }
  const messages = jsonValueMessages(parsed);
  const sessionId = stringValue(readPath(parsed, "conversationId")) ?? stringValue(readPath(parsed, "conversation_id")) ?? stringValue(readPath(parsed, "sessionId")) ?? stringValue(readPath(parsed, "session_id")) ?? stringValue(readPath(parsed, "id"));
  if (!sessionId || messages.length === 0) return [];
  const observedAt = stringValue(readPath(parsed, "timestamp")) ?? stringValue(readPath(parsed, "createdAt")) ?? stringValue(readPath(parsed, "created_at")) ?? new Date(0).toISOString();
  return messages.map((message, messageIndex) =>
    adapterRecord(
      source,
      `${sourceRecordKey}:${messageIndex}`,
      observedAt,
      message,
      adapterPayload("message", source.confidence, source, {
        observedAt,
        role: normalizeRole(message.role),
        sessionId,
        text: message.text
      })
    )
  );
}

function jsonValueMessagesWithTimestamps(value: unknown, profile: JsonlShapeProfile, fallbackObservedAt: string): Array<{ observedAt: string; payload: unknown; role: string; text: string }> {
  const candidates = [readPath(value, "messages"), readPath(value, "conversation"), readPath(value, "tabs.0.bubbles")];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const messages = candidate
      .filter(isRecord)
      .map((item) => ({
        observedAt: readString(item, profile.observedAtKeys) ?? fallbackObservedAt,
        payload: item,
        role: stringValue(item.role) ?? stringValue(item.speaker) ?? stringValue(item.type) ?? "",
        text: messageText(item)
      }))
      .filter((item) => item.role && item.text);
    if (messages.length > 0) return messages;
  }
  return [];
}

async function* backfillMarkdownSource(source: DiscoveredSource): AsyncIterable<AdapterRecord> {
  if (!source.path) return;
  const text = await readFile(source.path, "utf8");
  const blocks = markdownRoleBlocks(text);
  if (blocks.length === 0) {
    yield diagnosticRecord(source, `${source.runtime}_schema_not_recognized`);
    return;
  }
  const observedAt = new Date(0).toISOString();
  const sessionId = `file:${hash(source.path)}`;
  let index = 0;
  for (const block of blocks) {
    index += 1;
    const role = normalizeRole(block.role);
    const body = block.text;
    yield {
      diagnostics: [],
      normalized: adapterPayload("message", source.confidence, source, { observedAt, role, sessionId, text: body }),
      observedAt,
      payload: { role, text: body },
      payloadHash: hash(`${role}\0${body}`),
      source,
      sourceRecordKey: `${source.path}:${index}`
    };
  }
}

function markdownRoleBlocks(text: string): Array<{ role: string; text: string }> {
  const blocks: Array<{ role: string; text: string }> = [];
  let currentRole: string | undefined;
  let currentLines: string[] = [];
  const flush = () => {
    const body = currentLines.join("\n").trim();
    if (currentRole && body) blocks.push({ role: currentRole, text: body });
    currentLines = [];
  };

  for (const line of text.split(/\r?\n/)) {
    const role = line.match(/^\s*(?:#{1,6}\s*)?(USER|HUMAN|ASSISTANT|AGENT)\s*$/i)?.[1];
    if (role) {
      flush();
      currentRole = role;
      continue;
    }
    if (currentRole) currentLines.push(line);
  }
  flush();
  return blocks;
}

export function genericCodingProfile(runtime: string): JsonlShapeProfile {
  const isHermes = runtime === "hermes";
  const isOmp = runtime === "omp";
  return {
    fallbackSessionId: isHermes || isOmp ? sessionIdFromSourcePath : undefined,
    ignoreUnrecognizedRecords: isHermes || isOmp,
    runtime,
    observedAtKeys: isOmp
      ? ["message.timestamp", "timestamp", "createdAt", "created_at", "updatedAt", "observedAt", "time", "session_start", "started_at", "last_updated"]
      : ["timestamp", "createdAt", "created_at", "updatedAt", "observedAt", "time", "session_start", "started_at", "last_updated"],
    roleKeys: isOmp ? ["message.role", "role", "speaker"] : ["role", "type", "message.role", "speaker"],
    sessionIdKeys: isOmp
      ? ["sessionId", "session_id", "conversationId", "conversation_id", "uuid", "parentSessionId", "parent_session_id"]
      : ["sessionId", "session_id", "conversationId", "conversation_id", "uuid", "id", "parentSessionId", "parent_session_id"],
    textKeys: ["message.content", "content", "text", "message.text", "summary", "output"],
    toolNameKeys: ["toolName", "tool_name", "name", "tool"],
    toolOutputKeys: ["toolOutput", "tool_output", "result", "output"],
    usageKeys: {
      inputTokens: ["usage.input_tokens", "usage.inputTokens", "inputTokens", "input_tokens"],
      model: ["model", "message.model"],
      outputTokens: ["usage.output_tokens", "usage.outputTokens", "outputTokens", "output_tokens"],
      totalTokens: ["usage.total_tokens", "usage.totalTokens", "totalTokens", "total_tokens"]
    }
  };
}

function sessionIdFromSourcePath(source: DiscoveredSource): string | undefined {
  if (!source.path) return undefined;
  const base = basename(source.path).replace(/\.(jsonl|json)$/i, "");
  if (source.runtime === "omp") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(base)) return base;
    const parent = basename(dirname(source.path));
    if (/^\d{4}-\d{2}-\d{2}T/.test(parent)) return `${parent}:${base.replace(/^__/, "")}`;
  }
  return base;
}

export function jsonValueMessages(value: unknown): Array<{ role: string; text: string }> {
  const candidates = [readPath(value, "messages"), readPath(value, "conversation"), readPath(value, "tabs.0.bubbles")];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const messages = candidate
      .filter(isRecord)
      .map((item) => ({
        role: String(item.role ?? item.speaker ?? item.type ?? ""),
        text: String(item.content ?? item.text ?? item.message ?? "")
      }))
      .filter((item) => item.role && item.text);
    if (messages.length > 0) return messages;
  }
  return [];
}

function sourceFromCandidate(runtime: RuntimeKind, candidate: AdapterPathCandidate, path: string): DiscoveredSource {
  return {
    confidence: candidate.confidence,
    path,
    runtime,
    schemaVersion: `${runtime}-${candidate.contentKind}`,
    sourceId: `${runtime}:${hash(path)}`,
    sourceKind: candidate.sourceKind
  };
}

function candidatePath(context: DiscoveryContext, candidate: AdapterPathCandidate): string {
  return isAbsolute(candidate.relativePath) ? candidate.relativePath : resolve(context.homeDir, candidate.relativePath);
}

async function candidateFiles(directory: string, maxDepth: number, contentKind: AdapterPathCandidate["contentKind"]): Promise<string[]> {
  if (maxDepth < 0) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(entry.name)) files.push(...(await candidateFiles(path, maxDepth - 1, contentKind)));
    } else if (entry.isFile() && matchesKind(path, contentKind)) {
      files.push(path);
    }
  }
  return files;
}

function shouldSkipDirectory(name: string): boolean {
  return new Set([".cache", ".git", ".next", ".turbo", "build", "dist", "node_modules", "target", "vendor"]).has(name);
}

function matchesKind(path: string, contentKind: AdapterPathCandidate["contentKind"]): boolean {
  const name = basename(path);
  const lowerPath = path.toLowerCase();
  const lowerName = name.toLowerCase();
  if (contentKind === "sqlite-file") return name.endsWith(".sqlite") || name.endsWith(".db") || name === "state.vscdb";
  if (contentKind === "jsonl-tree" || contentKind === "jsonl-file") {
    if (lowerName.endsWith(".jsonl")) return true;
    if (!lowerName.endsWith(".json")) return false;
    if (lowerName === "package.json" || lowerName === "tsconfig.json" || lowerName === "workspace.json") return false;
    if (lowerName.startsWith("request_dump")) return false;
    return /session|conversation|chat|history|transcript|message|run|event|diff|composer/.test(lowerPath);
  }
  if (contentKind === "markdown-files") return lowerName.endsWith(".md") || lowerName.endsWith(".markdown");
  return (
    lowerName.endsWith(".jsonl") ||
    (lowerName.endsWith(".json") && lowerName !== "package.json") ||
    lowerName.endsWith(".db") ||
    lowerName.endsWith(".sqlite") ||
    lowerName.endsWith(".md") ||
    lowerName.includes("history")
  );
}

function adapterRecord(source: DiscoveredSource, sourceRecordKey: string, observedAt: string, payload: unknown, normalized: AdapterRecord["normalized"]): AdapterRecord {
  return {
    diagnostics: [],
    normalized,
    observedAt,
    payload,
    payloadHash: hash(JSON.stringify(payload)),
    source,
    sourceRecordKey
  };
}

function firstColumn(columns: Map<string, string>, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const column = columns.get(candidate.toLowerCase());
    if (column) return column;
  }
  return undefined;
}

function sqliteValueText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return undefined;
}

function messageText(value: Record<string, unknown>): string {
  const content = value.content ?? value.text ?? value.message;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (isRecord(part)) return stringValue(part.text) ?? stringValue(part.content) ?? "";
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function diagnosticRecord(source: DiscoveredSource, code: string): AdapterRecord {
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
    payload: {},
    payloadHash: hash(code),
    source,
    sourceRecordKey: `${source.sourceId}:diagnostic`
  };
}
