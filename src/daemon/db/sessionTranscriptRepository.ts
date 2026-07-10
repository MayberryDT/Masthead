import type {
  SessionTranscriptCoverage,
  SessionTranscriptItem,
  SessionTranscriptKind,
  SessionTranscriptOrder,
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
  order?: SessionTranscriptOrder;
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
  argumentsRedactedJson: string | null;
  detailsJson: string | null;
  staged: number | null;
  additions: number | null;
  deletions: number | null;
};

type CountRow = {
  count: number;
};

type MessageCoverageRow = {
  assistantMessages: number;
  lowValueMessages: number;
  messages: number;
  userMessages: number;
};

type TranscriptSelectPart = {
  sql: string;
  params: Array<number | string>;
};

export function getSessionTranscript(db: MastheadDatabase, query: SessionTranscriptQuery): SessionTranscriptResult {
  const page = getTranscriptPage(db, query, false);
  return {
    coverage: getTranscriptCoverage(db, query.sessionId),
    ...page
  };
}

export function getCompleteSessionTranscriptPage(
  db: MastheadDatabase,
  query: SessionTranscriptQuery
): Pick<SessionTranscriptResult, "items" | "nextCursor" | "total"> {
  return getTranscriptPage(db, query, true);
}

function getTranscriptPage(
  db: MastheadDatabase,
  query: SessionTranscriptQuery,
  preserveFullText: boolean
): Pick<SessionTranscriptResult, "items" | "nextCursor" | "total"> {
  const limit = normalizeLimit(query.limit);
  const offset = cursorToOffset(query.cursor);
  const total = countTranscriptItems(db, query);
  const items = getTranscriptItems(db, query, limit, offset, preserveFullText);
  const nextOffset = offset + items.length;
  return {
    items,
    nextCursor: nextOffset < total ? String(nextOffset) : undefined,
    total
  };
}

export function getTranscriptCoverage(db: MastheadDatabase, sessionId: string): SessionTranscriptCoverage {
  const messages = db
    .prepare(
      `SELECT
        COUNT(*) AS messages,
        SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS userMessages,
        SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) AS assistantMessages,
        SUM(CASE WHEN ${lowValueCondition("text_redacted")} THEN 1 ELSE 0 END) AS lowValueMessages
      FROM messages
      WHERE session_id = ?`
    )
    .get(sessionId) as MessageCoverageRow;
  const messageCount = Number(messages.messages) || 0;
  const userMessages = Number(messages.userMessages) || 0;
  const assistantMessages = Number(messages.assistantMessages) || 0;
  const lowValueMessages = Number(messages.lowValueMessages) || 0;
  return {
    assistantMessages,
    checkpoints: countRows(db, "checkpoints", sessionId),
    fileEffects: countRows(db, "file_effects", sessionId),
    hasUsableTranscript: userMessages + assistantMessages > 0 && lowValueMessages < messageCount,
    lowValueItems: countLowValueTranscriptItems(db, sessionId),
    messages: messageCount,
    runtimeSignals: countRows(db, "runtime_signals", sessionId),
    toolCalls: countRows(db, "tool_calls", sessionId),
    toolResults: countRows(db, "tool_results", sessionId),
    userMessages
  };
}

export function* iterateSessionTranscriptItems(
  db: MastheadDatabase,
  query: Pick<SessionTranscriptQuery, "order" | "sessionId">
): Generator<SessionTranscriptItem> {
  const parts = transcriptSelectParts(query, true);
  if (parts.length === 0) return;
  const direction = query.order === "desc" ? "DESC" : "ASC";
  const rows = db
    .prepare(
      `SELECT itemId, sessionId, kind, role, label, text, observedAt, sourceRefJson, status, exitCode, toolName,
        argumentsRedactedJson, detailsJson, staged, additions, deletions
      FROM (${parts.map((part) => part.sql).join(" UNION ALL ")})
      ORDER BY observedAt ${direction}, itemId ${direction}`
    )
    .iterate(...parts.flatMap((part) => part.params)) as Iterable<TranscriptRow>;
  for (const row of rows) yield normalizeTranscriptItem(row, true);
}

function getTranscriptItems(
  db: MastheadDatabase,
  query: Pick<SessionTranscriptQuery, "kind" | "order" | "q" | "sessionId">,
  limit: number,
  offset: number,
  preserveFullText: boolean
): SessionTranscriptItem[] {
  const parts = transcriptSelectParts(query, preserveFullText);
  if (parts.length === 0) return [];
  const direction = query.order === "desc" ? "DESC" : "ASC";
  const rows = db
    .prepare(
      `SELECT itemId, sessionId, kind, role, label, text, observedAt, sourceRefJson, status, exitCode, toolName,
        argumentsRedactedJson, detailsJson, staged, additions, deletions
      FROM (${parts.map((part) => part.sql).join(" UNION ALL ")})
      ORDER BY observedAt ${direction}, itemId ${direction}
      LIMIT ? OFFSET ?`
    )
    .all(...parts.flatMap((part) => part.params), limit, offset) as TranscriptRow[];
  return rows.map((row) => normalizeTranscriptItem(row, preserveFullText));
}

function countTranscriptItems(db: MastheadDatabase, query: Pick<SessionTranscriptQuery, "kind" | "q" | "sessionId">): number {
  return transcriptCountParts(query).reduce((total, part) => {
    const row = db.prepare(part.sql).get(...part.params) as CountRow;
    return total + (Number(row.count) || 0);
  }, 0);
}

function transcriptSelectParts(
  query: Pick<SessionTranscriptQuery, "kind" | "q" | "sessionId">,
  preserveFullText = false
): TranscriptSelectPart[] {
  const kind = query.kind ?? "all";
  const parts: TranscriptSelectPart[] = [];
  if (["all", "user", "assistant"].includes(kind)) parts.push(messageSelectPart(query.sessionId, kind, query.q));
  if (["all", "tools"].includes(kind)) {
    parts.push(toolCallSelectPart(query.sessionId, query.q));
    parts.push(toolResultSelectPart(query.sessionId, query.q, preserveFullText));
  }
  if (["all", "checkpoints"].includes(kind)) parts.push(checkpointSelectPart(query.sessionId, query.q));
  if (["all", "signals"].includes(kind)) parts.push(runtimeSignalSelectPart(query.sessionId, query.q));
  if (["all", "files"].includes(kind)) parts.push(fileEffectSelectPart(query.sessionId, query.q));
  return parts;
}

function transcriptCountParts(query: Pick<SessionTranscriptQuery, "kind" | "q" | "sessionId">): TranscriptSelectPart[] {
  return transcriptSelectParts(query).map((part) => ({
    params: part.params,
    sql: `SELECT COUNT(*) AS count FROM (${part.sql})`
  }));
}

function messageSelectPart(sessionId: string, kind: string, query?: string): TranscriptSelectPart {
  const clauses = ["session_id = ?"];
  const params: Array<number | string> = [sessionId];
  if (kind === "user" || kind === "assistant") {
    clauses.push("role = ?");
    params.push(kind);
  }
  addTextQuery(clauses, params, query, "text_redacted");
  return {
    params,
    sql: `SELECT message_id AS itemId,
        session_id AS sessionId,
        'message' AS kind,
        role,
        role AS label,
        text_redacted AS text,
        observed_at AS observedAt,
        source_ref_json AS sourceRefJson,
        NULL AS status,
        NULL AS exitCode,
        NULL AS toolName,
        NULL AS argumentsRedactedJson,
        NULL AS detailsJson,
        NULL AS staged,
        NULL AS additions,
        NULL AS deletions
      FROM messages
      WHERE ${clauses.join(" AND ")}`
  };
}

function toolCallSelectPart(sessionId: string, query?: string): TranscriptSelectPart {
  const clauses = ["session_id = ?"];
  const params: Array<number | string> = [sessionId];
  addTextQuery(clauses, params, query, "COALESCE(tool_name, '') || ' ' || COALESCE(arguments_redacted_json, '')");
  return {
    params,
    sql: `SELECT tool_call_id AS itemId,
        session_id AS sessionId,
        'tool_call' AS kind,
        'tool' AS role,
        tool_name AS label,
        COALESCE(tool_name, 'Tool call') AS text,
        COALESCE(started_at, '') AS observedAt,
        source_ref_json AS sourceRefJson,
        NULL AS status,
        NULL AS exitCode,
        tool_name AS toolName,
        arguments_redacted_json AS argumentsRedactedJson,
        NULL AS detailsJson,
        NULL AS staged,
        NULL AS additions,
        NULL AS deletions
      FROM tool_calls
      WHERE ${clauses.join(" AND ")}`
  };
}

function toolResultSelectPart(sessionId: string, query?: string, preserveFullText = false): TranscriptSelectPart {
  const clauses = ["session_id = ?"];
  const params: Array<number | string> = [sessionId];
  addTextQuery(clauses, params, query, "COALESCE(output_redacted, status)");
  return {
    params,
    sql: `SELECT tool_result_id AS itemId,
        session_id AS sessionId,
        'tool_result' AS kind,
        'tool' AS role,
        status AS label,
        ${preserveFullText ? "COALESCE(output_redacted, status, '')" : "SUBSTR(COALESCE(output_redacted, status, ''), 1, 801)"} AS text,
        COALESCE(completed_at, '') AS observedAt,
        source_ref_json AS sourceRefJson,
        status,
        exit_code AS exitCode,
        NULL AS toolName,
        NULL AS argumentsRedactedJson,
        NULL AS detailsJson,
        NULL AS staged,
        NULL AS additions,
        NULL AS deletions
      FROM tool_results
      WHERE ${clauses.join(" AND ")}`
  };
}

function checkpointSelectPart(sessionId: string, query?: string): TranscriptSelectPart {
  const clauses = ["session_id = ?"];
  const params: Array<number | string> = [sessionId];
  addTextQuery(clauses, params, query, "summary");
  return {
    params,
    sql: `SELECT checkpoint_id AS itemId,
        session_id AS sessionId,
        'checkpoint' AS kind,
        'system' AS role,
        checkpoint_kind AS label,
        summary AS text,
        observed_at AS observedAt,
        source_ref_json AS sourceRefJson,
        NULL AS status,
        NULL AS exitCode,
        NULL AS toolName,
        NULL AS argumentsRedactedJson,
        NULL AS detailsJson,
        NULL AS staged,
        NULL AS additions,
        NULL AS deletions
      FROM checkpoints
      WHERE ${clauses.join(" AND ")}`
  };
}

function runtimeSignalSelectPart(sessionId: string, query?: string): TranscriptSelectPart {
  const clauses = ["session_id = ?"];
  const params: Array<number | string> = [sessionId];
  addTextQuery(clauses, params, query, "COALESCE(title, '') || ' ' || COALESCE(details_json, '')");
  return {
    params,
    sql: `SELECT signal_id AS itemId,
        session_id AS sessionId,
        'runtime_signal' AS kind,
        'system' AS role,
        signal_kind AS label,
        title AS text,
        observed_at AS observedAt,
        source_ref_json AS sourceRefJson,
        severity AS status,
        NULL AS exitCode,
        NULL AS toolName,
        NULL AS argumentsRedactedJson,
        details_json AS detailsJson,
        NULL AS staged,
        NULL AS additions,
        NULL AS deletions
      FROM runtime_signals
      WHERE ${clauses.join(" AND ")}`
  };
}

function fileEffectSelectPart(sessionId: string, query?: string): TranscriptSelectPart {
  const clauses = ["session_id = ?"];
  const params: Array<number | string> = [sessionId];
  addTextQuery(
    clauses,
    params,
    query,
    `COALESCE(path, '') || ' ' || COALESCE(effect_kind, '') || ' ' ||
      CASE staged WHEN 1 THEN 'staged' WHEN 0 THEN 'unstaged' ELSE '' END || ' ' ||
      COALESCE(CAST(additions AS TEXT) || ' additions', '') || ' ' ||
      COALESCE(CAST(deletions AS TEXT) || ' deletions', '')`
  );
  return {
    params,
    sql: `SELECT file_effect_id AS itemId,
        session_id AS sessionId,
        'file_effect' AS kind,
        'tool' AS role,
        effect_kind AS label,
        path AS text,
        observed_at AS observedAt,
        source_ref_json AS sourceRefJson,
        NULL AS status,
        NULL AS exitCode,
        NULL AS toolName,
        NULL AS argumentsRedactedJson,
        NULL AS detailsJson,
        staged,
        additions,
        deletions
      FROM file_effects
      WHERE ${clauses.join(" AND ")}`
  };
}

function normalizeTranscriptItem(row: TranscriptRow, preserveFullText = false): SessionTranscriptItem {
  const baseText = row.text ?? row.label ?? "";
  const completeText = completeCanonicalText(row, baseText);
  const text = preserveFullText ? completeText : preview(completeText);
  const lowValue = isLowValueText(baseText) || isLowValueText(row.label ?? "");
  return {
    ...(row.additions === null ? {} : { additions: row.additions }),
    ...(row.argumentsRedactedJson === null ? {} : { argumentsRedacted: parseJson(row.argumentsRedactedJson) }),
    collapsedByDefault: row.kind === "tool_result" && text.length > 240 ? true : undefined,
    ...(row.deletions === null ? {} : { deletions: row.deletions }),
    ...(row.detailsJson === null ? {} : { details: parseJson(row.detailsJson) }),
    exitCode: row.exitCode ?? undefined,
    ...(row.kind === "file_effect" ? { filePath: baseText } : {}),
    itemId: `${itemPrefix(row.kind)}:${row.itemId}`,
    kind: row.kind,
    label: row.label ?? labelForKind(row.kind),
    lowValue,
    observedAt: row.observedAt ?? "",
    role: normalizeRole(row.role),
    sessionId: row.sessionId,
    sourceRef: parseJson(row.sourceRefJson),
    ...(row.staged === null ? {} : { staged: row.staged !== 0 }),
    status: row.status ?? undefined,
    text,
    toolName: row.toolName ?? undefined
  };
}

function completeCanonicalText(row: TranscriptRow, baseText: string): string {
  if (row.kind === "tool_call" && row.argumentsRedactedJson !== null) {
    return `${baseText}\nArguments: ${row.argumentsRedactedJson}`;
  }
  if (row.kind === "runtime_signal" && row.detailsJson !== null) {
    return `${baseText}\nDetails: ${row.detailsJson}`;
  }
  if (row.kind === "file_effect") {
    const details = [
      row.staged === 1 ? "staged" : row.staged === 0 ? "unstaged" : undefined,
      row.additions === null ? undefined : `${row.additions} additions`,
      row.deletions === null ? undefined : `${row.deletions} deletions`
    ].filter((value): value is string => value !== undefined);
    return details.length > 0 ? `${baseText}\n${details.join("; ")}` : baseText;
  }
  return baseText;
}

function addTextQuery(clauses: string[], params: Array<number | string>, query: string | undefined, column: string): void {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return;
  clauses.push(`lower(${column}) LIKE ?`);
  params.push(`%${normalized}%`);
}

function countLowValueTranscriptItems(db: MastheadDatabase, sessionId: string): number {
  return (
    countLowValueRows(db, "messages", sessionId, lowValueCondition("text_redacted")) +
    countLowValueRows(db, "tool_calls", sessionId, lowValueCondition("COALESCE(tool_name, 'Tool call')")) +
    countLowValueRows(db, "tool_results", sessionId, `(${lowValueCondition("output_redacted")} OR ${lowValueCondition("status")})`) +
    countLowValueRows(db, "checkpoints", sessionId, lowValueCondition("summary")) +
    countLowValueRows(db, "runtime_signals", sessionId, lowValueCondition("title")) +
    countLowValueRows(db, "file_effects", sessionId, lowValueCondition("path"))
  );
}

function countLowValueRows(db: MastheadDatabase, table: string, sessionId: string, condition: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id = ? AND ${condition}`).get(sessionId) as CountRow).count;
}

function lowValueCondition(expression: string): string {
  const normalized = `lower(trim(substr(COALESCE(${expression}, ''), 1, 820)))`;
  return `(${normalized} IN ('codex hook event', 'runtime signal', 'tool call', 'shell', 'unknown') OR ${normalized} LIKE 'codex hook event:%')`;
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
  return Math.max(1, Math.min(Math.trunc(value), 250));
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
