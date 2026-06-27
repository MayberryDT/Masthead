import type {
  SessionTranscriptCoverage,
  SessionTranscriptItem,
  SessionTranscriptKind,
  SessionTranscriptResult,
  SessionTranscriptRole
} from "../../shared/sessionTranscript.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type SessionTranscriptKindFilter = "all" | "user" | "assistant" | "tools" | "checkpoints" | "files" | "signals";

export type SessionTranscriptQuery = {
  sessionId: string;
  cursor?: string;
  limit?: number;
  kind?: SessionTranscriptKindFilter;
  q?: string;
};

type TranscriptRow = {
  itemId: string;
  sessionId: string;
  kind: SessionTranscriptKind;
  role: SessionTranscriptRole;
  label: string | null;
  text: string | null;
  observedAt: string | null;
  sourceRefJson: string | null;
  status: string | null;
  exitCode: number | null;
  toolName: string | null;
};

type CountRow = {
  count: number;
};

type MessageCoverageRow = {
  role: string;
  text: string;
};

export function getSessionTranscript(db: MastheadDatabase, query: SessionTranscriptQuery): SessionTranscriptResult {
  const limit = normalizeLimit(query.limit);
  const offset = cursorToOffset(query.cursor);
  const allItems = getTranscriptItems(db, query);
  const items = allItems.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    coverage: getTranscriptCoverage(db, query.sessionId),
    items,
    nextCursor: nextOffset < allItems.length ? String(nextOffset) : undefined,
    total: allItems.length
  };
}

export function getTranscriptCoverage(db: MastheadDatabase, sessionId: string): SessionTranscriptCoverage {
  const messages = db
    .prepare("SELECT role, text_redacted AS text FROM messages WHERE session_id = ?")
    .all(sessionId) as MessageCoverageRow[];
  const lowValueMessages = messages.filter((message) => isLowValueText(message.text)).length;
  const userMessages = messages.filter((message) => message.role === "user").length;
  const assistantMessages = messages.filter((message) => message.role === "assistant").length;
  const lowValueItems = getTranscriptItems(db, { sessionId }).filter((item) => item.lowValue).length;
  return {
    assistantMessages,
    checkpoints: countRows(db, "checkpoints", sessionId),
    fileEffects: countRows(db, "file_effects", sessionId),
    hasUsableTranscript: userMessages + assistantMessages > 0 && lowValueMessages < messages.length,
    lowValueItems,
    messages: messages.length,
    runtimeSignals: countRows(db, "runtime_signals", sessionId),
    toolCalls: countRows(db, "tool_calls", sessionId),
    toolResults: countRows(db, "tool_results", sessionId),
    userMessages
  };
}

function getTranscriptItems(db: MastheadDatabase, query: Pick<SessionTranscriptQuery, "kind" | "q" | "sessionId">): SessionTranscriptItem[] {
  const kind = query.kind ?? "all";
  const rows = [
    ...(["all", "user", "assistant"].includes(kind) ? getMessageRows(db, query.sessionId, kind, query.q) : []),
    ...(["all", "tools"].includes(kind) ? getToolCallRows(db, query.sessionId, query.q) : []),
    ...(["all", "tools"].includes(kind) ? getToolResultRows(db, query.sessionId, query.q) : []),
    ...(["all", "checkpoints"].includes(kind) ? getCheckpointRows(db, query.sessionId, query.q) : []),
    ...(["all", "signals"].includes(kind) ? getRuntimeSignalRows(db, query.sessionId, query.q) : []),
    ...(["all", "files"].includes(kind) ? getFileEffectRows(db, query.sessionId, query.q) : [])
  ];
  return rows
    .map(normalizeTranscriptItem)
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.itemId.localeCompare(b.itemId));
}

function getMessageRows(db: MastheadDatabase, sessionId: string, kind: string, query?: string): TranscriptRow[] {
  const clauses = ["session_id = ?"];
  const params: string[] = [sessionId];
  if (kind === "user" || kind === "assistant") {
    clauses.push("role = ?");
    params.push(kind);
  }
  addTextQuery(clauses, params, query, "text_redacted");
  return db
    .prepare(
      `SELECT message_id AS itemId,
        session_id AS sessionId,
        'message' AS kind,
        role,
        role AS label,
        text_redacted AS text,
        observed_at AS observedAt,
        source_ref_json AS sourceRefJson,
        NULL AS status,
        NULL AS exitCode,
        NULL AS toolName
      FROM messages
      WHERE ${clauses.join(" AND ")}`
    )
    .all(...params) as TranscriptRow[];
}

function getToolCallRows(db: MastheadDatabase, sessionId: string, query?: string): TranscriptRow[] {
  const clauses = ["session_id = ?"];
  const params: string[] = [sessionId];
  addTextQuery(clauses, params, query, "tool_name");
  return db
    .prepare(
      `SELECT tool_call_id AS itemId,
        session_id AS sessionId,
        'tool_call' AS kind,
        'tool' AS role,
        tool_name AS label,
        COALESCE(tool_name, 'Tool call') AS text,
        COALESCE(started_at, '') AS observedAt,
        source_ref_json AS sourceRefJson,
        NULL AS status,
        NULL AS exitCode,
        tool_name AS toolName
      FROM tool_calls
      WHERE ${clauses.join(" AND ")}`
    )
    .all(...params) as TranscriptRow[];
}

function getToolResultRows(db: MastheadDatabase, sessionId: string, query?: string): TranscriptRow[] {
  const clauses = ["session_id = ?"];
  const params: string[] = [sessionId];
  addTextQuery(clauses, params, query, "COALESCE(output_redacted, status)");
  return db
    .prepare(
      `SELECT tool_result_id AS itemId,
        session_id AS sessionId,
        'tool_result' AS kind,
        'tool' AS role,
        status AS label,
        COALESCE(output_redacted, status) AS text,
        COALESCE(completed_at, '') AS observedAt,
        source_ref_json AS sourceRefJson,
        status,
        exit_code AS exitCode,
        NULL AS toolName
      FROM tool_results
      WHERE ${clauses.join(" AND ")}`
    )
    .all(...params) as TranscriptRow[];
}

function getCheckpointRows(db: MastheadDatabase, sessionId: string, query?: string): TranscriptRow[] {
  const clauses = ["session_id = ?"];
  const params: string[] = [sessionId];
  addTextQuery(clauses, params, query, "summary");
  return db
    .prepare(
      `SELECT checkpoint_id AS itemId,
        session_id AS sessionId,
        'checkpoint' AS kind,
        'system' AS role,
        checkpoint_kind AS label,
        summary AS text,
        observed_at AS observedAt,
        source_ref_json AS sourceRefJson,
        NULL AS status,
        NULL AS exitCode,
        NULL AS toolName
      FROM checkpoints
      WHERE ${clauses.join(" AND ")}`
    )
    .all(...params) as TranscriptRow[];
}

function getRuntimeSignalRows(db: MastheadDatabase, sessionId: string, query?: string): TranscriptRow[] {
  const clauses = ["session_id = ?"];
  const params: string[] = [sessionId];
  addTextQuery(clauses, params, query, "title");
  return db
    .prepare(
      `SELECT signal_id AS itemId,
        session_id AS sessionId,
        'runtime_signal' AS kind,
        'system' AS role,
        signal_kind AS label,
        title AS text,
        observed_at AS observedAt,
        source_ref_json AS sourceRefJson,
        severity AS status,
        NULL AS exitCode,
        NULL AS toolName
      FROM runtime_signals
      WHERE ${clauses.join(" AND ")}`
    )
    .all(...params) as TranscriptRow[];
}

function getFileEffectRows(db: MastheadDatabase, sessionId: string, query?: string): TranscriptRow[] {
  const clauses = ["session_id = ?"];
  const params: string[] = [sessionId];
  addTextQuery(clauses, params, query, "path");
  return db
    .prepare(
      `SELECT file_effect_id AS itemId,
        session_id AS sessionId,
        'file_effect' AS kind,
        'tool' AS role,
        effect_kind AS label,
        path AS text,
        observed_at AS observedAt,
        source_ref_json AS sourceRefJson,
        NULL AS status,
        NULL AS exitCode,
        NULL AS toolName
      FROM file_effects
      WHERE ${clauses.join(" AND ")}`
    )
    .all(...params) as TranscriptRow[];
}

function normalizeTranscriptItem(row: TranscriptRow): SessionTranscriptItem {
  const text = preview(row.text ?? row.label ?? "");
  const lowValue = isLowValueText(text) || isLowValueText(row.label ?? "");
  return {
    collapsedByDefault: row.kind === "tool_result" && text.length > 240 ? true : undefined,
    exitCode: row.exitCode ?? undefined,
    itemId: `${itemPrefix(row.kind)}:${row.itemId}`,
    kind: row.kind,
    label: row.label ?? labelForKind(row.kind),
    lowValue,
    observedAt: row.observedAt ?? "",
    role: normalizeRole(row.role),
    sessionId: row.sessionId,
    sourceRef: parseJson(row.sourceRefJson),
    status: row.status ?? undefined,
    text,
    toolName: row.toolName ?? undefined
  };
}

function addTextQuery(clauses: string[], params: string[], query: string | undefined, column: string): void {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return;
  clauses.push(`lower(${column}) LIKE ?`);
  params.push(`%${normalized}%`);
}

function countRows(db: MastheadDatabase, table: string, sessionId: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id = ?`).get(sessionId) as CountRow).count;
}

function cursorToOffset(cursor?: string): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeLimit(value = 100): number {
  return Math.max(1, Math.min(Math.trunc(value), 200));
}

function preview(value: string, max = 800): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1).trim()}…` : normalized;
}

function isLowValueText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    normalized === "codex hook event" ||
    normalized.startsWith("codex hook event:") ||
    normalized === "runtime signal" ||
    normalized === "tool call" ||
    normalized === "shell" ||
    normalized === "unknown"
  );
}

function itemPrefix(kind: SessionTranscriptKind): string {
  if (kind === "message") return "message";
  if (kind === "tool_call") return "tool_call";
  if (kind === "tool_result") return "tool_result";
  if (kind === "checkpoint") return "checkpoint";
  if (kind === "runtime_signal") return "signal";
  return "file";
}

function labelForKind(kind: SessionTranscriptKind): string {
  if (kind === "tool_call") return "Tool call";
  if (kind === "tool_result") return "Tool result";
  if (kind === "runtime_signal") return "Runtime signal";
  if (kind === "file_effect") return "File";
  return kind;
}

function normalizeRole(role: string): SessionTranscriptRole {
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") return role;
  return "unknown";
}

function parseJson(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
