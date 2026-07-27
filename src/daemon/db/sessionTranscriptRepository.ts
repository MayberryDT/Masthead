import { projectSourceMessageNarrative } from "../../adapters/messageNarrative.ts";
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
export type SessionTranscriptRowIdCutoffs = {
  messages: number;
  toolCalls: number;
  toolResults: number;
  checkpoints: number;
  runtimeSignals: number;
  fileEffects: number;
};

export type SessionTranscriptQuery = {
  sessionId: string;
  cursor?: string;
  limit?: number;
  kind?: SessionTranscriptKindFilter;
  order?: SessionTranscriptOrder;
  q?: string;
  rowIdCutoffs?: SessionTranscriptRowIdCutoffs;
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

type MessageTextRow = {
  text: string;
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
  const runtimeKind = sessionRuntimeKind(db, sessionId);
  const messages = db
    .prepare(
      `SELECT
        COUNT(*) AS messages,
        SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS userMessages,
        SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) AS assistantMessages,
        SUM(CASE WHEN ${genericLowValueCondition("text_redacted")} THEN 1 ELSE 0 END) AS lowValueMessages
      FROM messages
      WHERE session_id = ?`
    )
    .get(sessionId) as MessageCoverageRow;
  const messageCount = Number(messages.messages) || 0;
  const userMessages = Number(messages.userMessages) || 0;
  const assistantMessages = Number(messages.assistantMessages) || 0;
  const lowValueMessages =
    (Number(messages.lowValueMessages) || 0) +
    countSourceControlOnlyMessages(db, sessionId, runtimeKind);
  return {
    assistantMessages,
    checkpoints: countRows(db, "checkpoints", sessionId),
    fileEffects: countRows(db, "file_effects", sessionId),
    hasUsableTranscript: userMessages + assistantMessages > 0 && lowValueMessages < messageCount,
    lowValueItems: countLowValueTranscriptItems(db, sessionId, lowValueMessages),
    messages: messageCount,
    runtimeSignals: countRows(db, "runtime_signals", sessionId),
    toolCalls: countRows(db, "tool_calls", sessionId),
    toolResults: countRows(db, "tool_results", sessionId),
    userMessages
  };
}

export function* iterateSessionTranscriptItems(
  db: MastheadDatabase,
  query: Pick<SessionTranscriptQuery, "order" | "rowIdCutoffs" | "sessionId">
): Generator<SessionTranscriptItem> {
  const runtimeKind = sessionRuntimeKind(db, query.sessionId);
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
  for (const row of rows) yield normalizeTranscriptItem(row, true, runtimeKind);
}

function getTranscriptItems(
  db: MastheadDatabase,
  query: Pick<SessionTranscriptQuery, "kind" | "order" | "q" | "sessionId">,
  limit: number,
  offset: number,
  preserveFullText: boolean
): SessionTranscriptItem[] {
  const runtimeKind = sessionRuntimeKind(db, query.sessionId);
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
  return rows.map((row) => normalizeTranscriptItem(row, preserveFullText, runtimeKind));
}

function countTranscriptItems(db: MastheadDatabase, query: Pick<SessionTranscriptQuery, "kind" | "q" | "sessionId">): number {
  return transcriptCountParts(query).reduce((total, part) => {
    const row = db.prepare(part.sql).get(...part.params) as CountRow;
    return total + (Number(row.count) || 0);
  }, 0);
}

function transcriptSelectParts(
  query: Pick<SessionTranscriptQuery, "kind" | "q" | "rowIdCutoffs" | "sessionId">,
  preserveFullText = false
): TranscriptSelectPart[] {
  const kind = query.kind ?? "all";
  const parts: TranscriptSelectPart[] = [];
  if (["all", "user", "assistant"].includes(kind)) parts.push(messageSelectPart(query.sessionId, kind, query.q, query.rowIdCutoffs?.messages));
  if (["all", "tools"].includes(kind)) {
    parts.push(toolCallSelectPart(query.sessionId, query.q, query.rowIdCutoffs?.toolCalls));
    parts.push(toolResultSelectPart(query.sessionId, query.q, preserveFullText, query.rowIdCutoffs?.toolResults));
  }
  if (["all", "checkpoints"].includes(kind)) parts.push(checkpointSelectPart(query.sessionId, query.q, query.rowIdCutoffs?.checkpoints));
  if (["all", "signals"].includes(kind)) parts.push(runtimeSignalSelectPart(query.sessionId, query.q, query.rowIdCutoffs?.runtimeSignals));
  if (["all", "files"].includes(kind)) parts.push(fileEffectSelectPart(query.sessionId, query.q, query.rowIdCutoffs?.fileEffects));
  return parts;
}

function transcriptCountParts(query: Pick<SessionTranscriptQuery, "kind" | "q" | "sessionId">): TranscriptSelectPart[] {
  return transcriptSelectParts(query).map((part) => ({
    params: part.params,
    sql: `SELECT COUNT(*) AS count FROM (${part.sql})`
  }));
}

function messageSelectPart(sessionId: string, kind: string, query?: string, cutoff?: number): TranscriptSelectPart {
  const clauses = ["session_id = ?"];
  const params: Array<number | string> = [sessionId];
  if (kind === "user" || kind === "assistant") {
    clauses.push("role = ?");
    params.push(kind);
  }
  addRowIdCutoff(clauses, params, cutoff, "rowid");
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

function toolCallSelectPart(sessionId: string, query?: string, cutoff?: number): TranscriptSelectPart {
  const clauses = ["session_id = ?"];
  const params: Array<number | string> = [sessionId];
  addRowIdCutoff(clauses, params, cutoff, "rowid");
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

function toolResultSelectPart(sessionId: string, query?: string, preserveFullText = false, cutoff?: number): TranscriptSelectPart {
  const clauses = ["tool_results.session_id = ?"];
  const params: Array<number | string> = [sessionId];
  addRowIdCutoff(clauses, params, cutoff, "tool_results.rowid");
  addTextQuery(clauses, params, query, "COALESCE(tool_results.output_redacted, tool_results.status)");
  return {
    params,
    sql: `SELECT tool_results.tool_result_id AS itemId,
        tool_results.session_id AS sessionId,
        'tool_result' AS kind,
        'tool' AS role,
        tool_results.status AS label,
        ${preserveFullText ? "COALESCE(tool_results.output_redacted, tool_results.status, '')" : "SUBSTR(COALESCE(tool_results.output_redacted, tool_results.status, ''), 1, 801)"} AS text,
        COALESCE(tool_results.completed_at, '') AS observedAt,
        tool_results.source_ref_json AS sourceRefJson,
        tool_results.status,
        tool_results.exit_code AS exitCode,
        tool_calls.tool_name AS toolName,
        NULL AS argumentsRedactedJson,
        NULL AS detailsJson,
        NULL AS staged,
        NULL AS additions,
        NULL AS deletions
      FROM tool_results
      JOIN tool_calls ON tool_calls.tool_call_id = tool_results.tool_call_id
      WHERE ${clauses.join(" AND ")}`
  };
}

function checkpointSelectPart(sessionId: string, query?: string, cutoff?: number): TranscriptSelectPart {
  const clauses = ["session_id = ?"];
  const params: Array<number | string> = [sessionId];
  addRowIdCutoff(clauses, params, cutoff, "rowid");
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

function runtimeSignalSelectPart(sessionId: string, query?: string, cutoff?: number): TranscriptSelectPart {
  const clauses = ["session_id = ?"];
  const params: Array<number | string> = [sessionId];
  addRowIdCutoff(clauses, params, cutoff, "rowid");
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

function fileEffectSelectPart(sessionId: string, query?: string, cutoff?: number): TranscriptSelectPart {
  const clauses = ["session_id = ?"];
  const params: Array<number | string> = [sessionId];
  addRowIdCutoff(clauses, params, cutoff, "rowid");
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

function normalizeTranscriptItem(
  row: TranscriptRow,
  preserveFullText = false,
  runtimeKind?: string
): SessionTranscriptItem {
  const baseText = row.text ?? row.label ?? "";
  const completeText = completeCanonicalText(row, baseText);
  const text = preserveFullText ? completeText : preview(completeText);
  const narrative = row.kind === "message"
    ? projectSourceMessageNarrative(runtimeKind, baseText)
    : undefined;
  const narrativeText = narrative
    ? (preserveFullText ? narrative.text : preview(narrative.text))
    : undefined;
  const lowValue =
    isGenericLowValueText(baseText) ||
    isGenericLowValueText(row.label ?? "") ||
    narrative?.controlOnly === true;
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
    ...(narrativeText !== undefined && narrativeText !== text ? { narrativeText } : {}),
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

function addRowIdCutoff(
  clauses: string[],
  params: Array<number | string>,
  cutoff: number | undefined,
  column: string
): void {
  if (cutoff === undefined) return;
  clauses.push(`${column} <= ?`);
  params.push(cutoff);
}

function countLowValueTranscriptItems(
  db: MastheadDatabase,
  sessionId: string,
  lowValueMessages: number
): number {
  return (
    lowValueMessages +
    countLowValueRows(db, "tool_calls", sessionId, genericLowValueCondition("COALESCE(tool_name, 'Tool call')")) +
    countLowValueRows(db, "tool_results", sessionId, `(${genericLowValueCondition("output_redacted")} OR ${genericLowValueCondition("status")})`) +
    countLowValueRows(db, "checkpoints", sessionId, genericLowValueCondition("summary")) +
    countLowValueRows(db, "runtime_signals", sessionId, genericLowValueCondition("title")) +
    countLowValueRows(db, "file_effects", sessionId, genericLowValueCondition("path"))
  );
}

function countSourceControlOnlyMessages(
  db: MastheadDatabase,
  sessionId: string,
  runtimeKind: string | undefined
): number {
  if (!runtimeKind) return 0;
  const rows = db
    .prepare(
      `SELECT text_redacted AS text
       FROM messages
       WHERE session_id = ?
         AND (ltrim(text_redacted, char(9) || char(10) || char(13) || ' ') LIKE '<%'
           OR lower(ltrim(text_redacted, char(9) || char(10) || char(13) || ' ')) LIKE '# agents.md instructions%')`
    )
    .all(sessionId) as MessageTextRow[];
  return rows.filter((row) => projectSourceMessageNarrative(runtimeKind, row.text).controlOnly).length;
}

function countLowValueRows(db: MastheadDatabase, table: string, sessionId: string, condition: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id = ? AND ${condition}`).get(sessionId) as CountRow).count;
}

function genericLowValueCondition(expression: string): string {
  const normalized = `lower(trim(substr(COALESCE(${expression}, ''), 1, 820), char(9) || char(10) || char(13) || ' '))`;
  return `(${normalized} IN ('codex hook event', 'runtime signal', 'tool call', 'shell', 'unknown')
    OR ${normalized} LIKE 'codex hook event:%')`;
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

function isGenericLowValueText(text: string): boolean {
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

function sessionRuntimeKind(db: MastheadDatabase, sessionId: string): string | undefined {
  const row = db
    .prepare(
      `SELECT runtimes.runtime_kind AS runtimeKind
       FROM sessions
       JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
       WHERE sessions.session_id = ?`
    )
    .get(sessionId) as { runtimeKind: string } | undefined;
  return row?.runtimeKind;
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
