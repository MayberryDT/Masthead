import type { MastheadDatabase } from "./sqlite.ts";

export type SessionSearchDocument = {
  sessionId: string;
  title: string;
  capsule: string;
  firstPrompt: string;
  finalResponse: string;
  normalizedText: string;
  commands: string;
  toolNames: string;
  filePaths: string;
  projectAliases: string;
  tags: string;
};

export type SessionSearchQuery = {
  query: string;
  runtime?: string;
  project?: string;
  host?: string;
  state?: string;
  limit: number;
  offset?: number;
};

export type SessionSearchResult = {
  sessions: Array<{
    sessionId: string;
    title: string;
    snippet: string;
  }>;
  total: number;
};

type CanonicalSessionRow = {
  sessionId: string;
  title: string | null;
  objective: string | null;
  projectLabel: string | null;
  sourceSessionId: string;
  lifecycle: string;
  outcomeLabel: string | null;
  branch: string | null;
  repoRoot: string | null;
  worktreePath: string | null;
  hostId: string;
  runtimeKind: string;
  runtimeVersion: string | null;
};

type TextRow = {
  text: string;
};

export function indexSessionSearch(db: MastheadDatabase, document: SessionSearchDocument): void {
  db.prepare("DELETE FROM session_search WHERE session_id = ?").run(document.sessionId);
  db.prepare(
    `INSERT INTO session_search (
      session_id,
      title,
      capsule,
      first_prompt,
      final_response,
      normalized_text,
      commands,
      tool_names,
      file_paths,
      project_aliases,
      tags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    document.sessionId,
    document.title,
    document.capsule,
    document.firstPrompt,
    document.finalResponse,
    document.normalizedText,
    document.commands,
    document.toolNames,
    document.filePaths,
    document.projectAliases,
    document.tags
  );
}

export function indexCanonicalSessionSearch(db: MastheadDatabase, sessionId: string): void {
  const session = db
    .prepare(
      `SELECT
        sessions.session_id AS sessionId,
        sessions.title AS title,
        sessions.objective AS objective,
        sessions.project_label AS projectLabel,
        sessions.source_session_id AS sourceSessionId,
        sessions.lifecycle AS lifecycle,
        sessions.outcome_label AS outcomeLabel,
        sessions.branch AS branch,
        sessions.repo_root AS repoRoot,
        sessions.worktree_path AS worktreePath,
        sessions.host_id AS hostId,
        runtimes.runtime_kind AS runtimeKind,
        runtimes.runtime_version AS runtimeVersion
      FROM sessions
      JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
      WHERE sessions.session_id = ?`
    )
    .get(sessionId) as CanonicalSessionRow | undefined;
  if (!session) return;

  const messages = db
    .prepare("SELECT role || ': ' || text_redacted AS text FROM messages WHERE session_id = ? ORDER BY observed_at ASC")
    .all(sessionId) as TextRow[];
  const userMessages = db
    .prepare("SELECT text_redacted AS text FROM messages WHERE session_id = ? AND role = 'user' ORDER BY observed_at ASC LIMIT 1")
    .all(sessionId) as TextRow[];
  const assistantMessages = db
    .prepare("SELECT text_redacted AS text FROM messages WHERE session_id = ? AND role IN ('assistant', 'system') ORDER BY observed_at DESC LIMIT 1")
    .all(sessionId) as TextRow[];
  const toolNames = db
    .prepare("SELECT DISTINCT tool_name AS text FROM tool_calls WHERE session_id = ? ORDER BY tool_name")
    .all(sessionId) as TextRow[];
  const filePaths = db
    .prepare("SELECT DISTINCT path AS text FROM file_effects WHERE session_id = ? ORDER BY path")
    .all(sessionId) as TextRow[];
  const signals = db
    .prepare("SELECT signal_kind || ' ' || title AS text FROM runtime_signals WHERE session_id = ? ORDER BY observed_at ASC")
    .all(sessionId) as TextRow[];
  const usage = db
    .prepare("SELECT DISTINCT COALESCE(model, '') || ' ' || COALESCE(provider, '') AS text FROM model_usage WHERE session_id = ?")
    .all(sessionId) as TextRow[];

  const title = session.title ?? session.objective ?? session.projectLabel ?? session.sourceSessionId;
  indexSessionSearch(db, {
    capsule: joinText([session.objective, session.outcomeLabel, ...signals.map((row) => row.text)]),
    commands: joinText(toolNames.map((row) => row.text)),
    filePaths: joinText(filePaths.map((row) => row.text)),
    finalResponse: assistantMessages[0]?.text ?? "",
    firstPrompt: userMessages[0]?.text ?? "",
    normalizedText: joinText([
      session.projectLabel,
      session.sourceSessionId,
      session.lifecycle,
      session.outcomeLabel,
      session.branch,
      session.repoRoot,
      session.worktreePath,
      session.hostId,
      session.runtimeKind,
      session.runtimeVersion,
      ...messages.map((row) => row.text),
      ...usage.map((row) => row.text)
    ]),
    projectAliases: session.projectLabel ?? "",
    sessionId,
    tags: joinText([session.runtimeKind, session.lifecycle, session.outcomeLabel]),
    title,
    toolNames: joinText(toolNames.map((row) => row.text))
  });
}

export function searchSessions(db: MastheadDatabase, query: SessionSearchQuery): SessionSearchResult {
  const limit = Math.max(1, Math.min(query.limit, 100));
  const offset = Math.max(0, query.offset ?? 0);
  const match = ftsQuery(query.query);
  if (!match) return listRecentSessions(db, limit, offset);

  const rows = db
    .prepare(
      `SELECT session_id AS sessionId,
        title,
        snippet(session_search, 2, '<mark>', '</mark>', ' ', 12) AS snippet
      FROM session_search
      WHERE session_search MATCH ?
      ORDER BY rank
      LIMIT ? OFFSET ?`
    )
    .all(match, limit, offset) as Array<{ sessionId: string; title: string; snippet: string }>;
  const total = (
    db.prepare("SELECT COUNT(*) AS count FROM session_search WHERE session_search MATCH ?").get(match) as { count: number }
  ).count;
  return { sessions: rows, total };
}

function listRecentSessions(db: MastheadDatabase, limit: number, offset: number): SessionSearchResult {
  const rows = db
    .prepare(
      `SELECT
        session_id AS sessionId,
        COALESCE(title, objective, project_label, source_session_id, session_id) AS title,
        '' AS snippet
      FROM sessions
      WHERE deleted_at IS NULL
      ORDER BY last_activity_at DESC
      LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as Array<{ sessionId: string; title: string; snippet: string }>;
  const total = (db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE deleted_at IS NULL").get() as { count: number }).count;
  return { sessions: rows, total };
}

function ftsQuery(query: string): string | undefined {
  const terms = query
    .trim()
    .split(/\s+/)
    .map((term) => term.replaceAll('"', '""'))
    .filter(Boolean);
  if (terms.length === 0) return undefined;
  return terms.map((term) => `"${term}"`).join(" ");
}

function joinText(values: Array<string | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value?.trim())).join(" ");
}
