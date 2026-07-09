import { currentSessionEnrichmentView, currentSessionEnrichmentViews } from "./enrichmentViewRepository.ts";
import type { MastheadDatabase } from "./sqlite.ts";
import { publishedWorkbenchSessionSql } from "./workbenchPublicationSql.ts";

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

type EnrichmentRow = {
  enrichmentKind: string;
  contentJson: string | null;
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
    .prepare(
      `SELECT role || ': ' || text_redacted AS text, observedAt, messageId
      FROM (
        SELECT message_id AS messageId, role, text_redacted, observed_at AS observedAt
        FROM messages
        WHERE session_id = ?
        ORDER BY observed_at ASC, message_id ASC
        LIMIT 40
      )
      UNION
      SELECT role || ': ' || text_redacted AS text, observedAt, messageId
      FROM (
        SELECT message_id AS messageId, role, text_redacted, observed_at AS observedAt
        FROM messages
        WHERE session_id = ?
        ORDER BY observed_at DESC, message_id DESC
        LIMIT 80
      )
      ORDER BY observedAt ASC, messageId ASC`
    )
    .all(sessionId, sessionId) as TextRow[];
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
  const enrichments = db
    .prepare(
      `SELECT enrichment_kind AS enrichmentKind, content_json AS contentJson
      FROM session_enrichments
      WHERE session_id = ?
        AND status = 'current'
        AND enrichment_kind IN ('session_capsule', 'live_summary', 'search_projection')`
    )
    .all(sessionId) as EnrichmentRow[];
  const enrichmentText = enrichments.flatMap((row) => textFromEnrichment(row.contentJson));
  const enrichmentView = currentSessionEnrichmentView(db, sessionId);

  const title = enrichmentView?.title ?? session.title ?? session.objective ?? session.projectLabel ?? session.sourceSessionId;
  indexSessionSearch(db, {
    capsule: joinText([session.objective, session.outcomeLabel, ...signals.map((row) => row.text), ...enrichmentText]),
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
      ...usage.map((row) => row.text),
      ...enrichmentText
    ]),
    projectAliases: session.projectLabel ?? "",
    sessionId,
    tags: joinText([session.runtimeKind, session.lifecycle, session.outcomeLabel, ...enrichmentText]),
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
      `SELECT session_search.session_id AS sessionId,
        session_search.title,
        snippet(session_search, 2, '<mark>', '</mark>', ' ', 12) AS snippet
      FROM session_search
      JOIN sessions ON sessions.session_id = session_search.session_id
      WHERE session_search MATCH ?
        AND ${publishedWorkbenchSessionSql("sessions")}
      ORDER BY rank
      LIMIT ? OFFSET ?`
    )
    .all(match, limit, offset) as Array<{ sessionId: string; title: string; snippet: string }>;
  const total = (
    db.prepare(
      `SELECT COUNT(*) AS count
      FROM session_search
      JOIN sessions ON sessions.session_id = session_search.session_id
      WHERE session_search MATCH ?
        AND ${publishedWorkbenchSessionSql("sessions")}`
    ).get(match) as { count: number }
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
        AND ${publishedWorkbenchSessionSql("sessions")}
      ORDER BY last_activity_at DESC
      LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as Array<{ sessionId: string; title: string; snippet: string }>;
  const enrichments = currentSessionEnrichmentViews(db, rows.map((row) => row.sessionId));
  const total = (
    db.prepare(
      `SELECT COUNT(*) AS count
      FROM sessions
      WHERE deleted_at IS NULL
        AND ${publishedWorkbenchSessionSql("sessions")}`
    ).get() as { count: number }
  ).count;
  return {
    sessions: rows.map((row) => ({
      ...row,
      title: enrichments.get(row.sessionId)?.title ?? row.title
    })),
    total
  };
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

function textFromEnrichment(contentJson: string | null): string[] {
  if (!contentJson) return [];
  try {
    const content = JSON.parse(contentJson) as unknown;
    if (!isRecord(content)) return [];
    return [
      stringField(content, "title"),
      stringField(content, "objective"),
      stringField(content, "liveSummary"),
      stringField(content, "outcome"),
      stringField(content, "searchSummary"),
      stringField(content, "filesChangedSummary"),
      stringField(content, "commandsSummary"),
      stringField(content, "verificationSummary"),
      ...durableText(content),
      stringField(content, "text"),
      stringField(content, "searchText"),
      ...stringArrayField(content, "topics"),
      ...stringArrayField(content, "technologies"),
      ...stringArrayField(content, "searchPhrases"),
      ...claimTextArray(content, "candidateDecisions"),
      ...claimTextArray(content, "unresolved")
    ].filter((value): value is string => Boolean(value?.trim()));
  } catch {
    return [];
  }
}

function durableText(record: Record<string, unknown>): string[] {
  const sessionTitle = isRecord(record.sessionTitle) ? record.sessionTitle : undefined;
  const sessionSummary = isRecord(record.sessionSummary) ? record.sessionSummary : undefined;
  const sessionDossier = isRecord(record.sessionDossier) ? record.sessionDossier : undefined;
  const verification = isRecord(sessionDossier?.verification) ? sessionDossier.verification : undefined;
  const continuation = isRecord(sessionDossier?.continuation) ? sessionDossier.continuation : undefined;
  return [
    stringField(sessionTitle ?? {}, "text"),
    stringField(sessionSummary ?? {}, "text"),
    stringField(sessionDossier ?? {}, "purpose"),
    stringField(sessionDossier ?? {}, "outcome"),
    ...stringArrayField(sessionDossier ?? {}, "keyWork"),
    ...stringArrayField(sessionDossier ?? {}, "decisions"),
    ...stringArrayField(sessionDossier ?? {}, "blockers"),
    stringField(verification ?? {}, "summary"),
    ...stringArrayField(verification ?? {}, "commands"),
    ...stringArrayField(verification ?? {}, "failures"),
    stringField(continuation ?? {}, "nextStep"),
    ...stringArrayField(continuation ?? {}, "openQuestions"),
    ...stringArrayField(continuation ?? {}, "constraints")
  ].filter(isString);
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}

function stringArrayField(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function claimTextArray(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  if (!Array.isArray(value)) return [];
  return value.map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : undefined)).filter(isString);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
