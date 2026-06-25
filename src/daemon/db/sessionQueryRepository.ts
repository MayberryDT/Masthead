import { currentSessionEnrichmentViews, type SessionEnrichmentView } from "./enrichmentViewRepository.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type SessionListItemDto = {
  sessionId: string;
  sourceSessionId: string;
  title: string;
  objective?: string;
  outcome?: string;
  project?: string;
  runtime: string;
  models: string[];
  hostId: string;
  branch?: string;
  lifecycle: string;
  startedAt?: string;
  lastActivityAt: string;
  endedAt?: string;
  topics: string[];
  fileCount: number;
  toolCount: number;
  errorCount: number;
  enrichmentStatus?: "current" | "stale" | "failed" | "disabled" | "missing";
  unresolved: string[];
  snippet?: string;
  sourceConfidence: "authoritative" | "inferred" | "heuristic";
};

export type SessionQuery = {
  query?: string;
  runtime?: string;
  project?: string;
  model?: string;
  host?: string;
  state?: string;
  file?: string;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  cursor?: string;
  offset?: number;
  sort?: LogbookSort;
};

export type LogbookSort = "recent" | "oldest" | "duration_desc" | "files_desc" | "tools_desc" | "errors_desc" | "project";

export type SessionQueryResult = {
  sessions: SessionListItemDto[];
  total: number;
  nextCursor?: string;
};

export type SessionDetailDto = SessionListItemDto & {
  repoRoot?: string;
  worktreePath?: string;
  durationMs?: number;
  files: string[];
  tools: string[];
  sourceProvenance: {
    hostId: string;
    runtime: string;
    sourceSessionId: string;
    sourceConfidence: SessionListItemDto["sourceConfidence"];
  };
  mcpIncluded: boolean;
};

export type SessionExcerptDto = {
  excerptId: string;
  kind: "message" | "tool" | "checkpoint";
  role?: string;
  text: string;
  observedAt: string;
  sourceRef: unknown;
};

export type ProjectDto = {
  project: string;
  sessionCount: number;
};

type SessionRow = {
  sessionId: string;
  sourceSessionId: string;
  title: string | null;
  objective: string | null;
  outcome: string | null;
  project: string | null;
  runtime: string;
  hostId: string;
  branch: string | null;
  lifecycle: string;
  startedAt: string | null;
  lastActivityAt: string;
  endedAt: string | null;
  sourceConfidence: SessionListItemDto["sourceConfidence"];
  repoRoot?: string | null;
  worktreePath?: string | null;
  excludedFromMcpAt?: string | null;
  modelsJson: string | null;
  topicsJson: string | null;
  fileCount: number;
  toolCount: number;
  errorCount: number;
};

type Candidate = {
  sessionId: string;
  snippet: string;
};

type ExcerptRow = {
  excerptId: string;
  kind: SessionExcerptDto["kind"];
  role: string | null;
  text: string;
  observedAt: string;
  sourceRefJson: string;
};

export function querySessions(db: MastheadDatabase, query: SessionQuery): SessionQueryResult {
  const limit = clampLimit(query.limit, 50);
  const offset = cursorToOffset(query.cursor) ?? Math.max(0, query.offset ?? 0);
  const candidates = candidateSessions(db, query.query);
  if (candidates && candidates.length === 0) return { sessions: [], total: 0 };

  const snippetBySession = new Map(candidates?.map((candidate) => [candidate.sessionId, candidate.snippet]) ?? []);
  const candidateOrder = new Map(candidates?.map((candidate, index) => [candidate.sessionId, index]) ?? []);
  const rows = loadSessionRows(db, query, candidates?.map((candidate) => candidate.sessionId));
  const sortedRows = candidates && !query.sort
    ? rows.toSorted((left, right) => (candidateOrder.get(left.sessionId) ?? 0) - (candidateOrder.get(right.sessionId) ?? 0))
    : rows;
  const page = sortedRows.slice(offset, offset + limit);
  const enrichments = currentSessionEnrichmentViews(db, page.map((row) => row.sessionId));

  return {
    nextCursor: offset + limit < sortedRows.length ? String(offset + limit) : undefined,
    sessions: page.map((row) => rowToListItem(row, snippetBySession.get(row.sessionId), enrichments.get(row.sessionId))),
    total: sortedRows.length
  };
}

export function getSessionDetail(db: MastheadDatabase, sessionId: string): SessionDetailDto | undefined {
  const row = loadSessionRows(db, { limit: 1 }, [sessionId], { includeDeleted: false, includeDetailColumns: true })[0];
  if (!row) return undefined;
  const item = rowToListItem(row, undefined, currentSessionEnrichmentViews(db, [sessionId]).get(sessionId));
  const files = db
    .prepare("SELECT DISTINCT path AS value FROM file_effects WHERE session_id = ? ORDER BY path")
    .all(sessionId) as Array<{ value: string }>;
  const tools = db
    .prepare("SELECT DISTINCT tool_name AS value FROM tool_calls WHERE session_id = ? ORDER BY tool_name")
    .all(sessionId) as Array<{ value: string }>;
  return {
    ...item,
    durationMs: durationMs(row.startedAt, row.endedAt),
    files: files.map((file) => file.value),
    mcpIncluded: !row.excludedFromMcpAt,
    repoRoot: row.repoRoot ?? undefined,
    sourceProvenance: {
      hostId: row.hostId,
      runtime: row.runtime,
      sourceConfidence: row.sourceConfidence,
      sourceSessionId: row.sourceSessionId
    },
    tools: tools.map((tool) => tool.value),
    worktreePath: row.worktreePath ?? undefined
  };
}

export function getSessionExcerpts(
  db: MastheadDatabase,
  sessionId: string,
  options: { query?: string; limit: number }
): SessionExcerptDto[] {
  const limit = clampLimit(options.limit, 8);
  const textFilter = likePattern(options.query);
  const rows = db
    .prepare(
      `SELECT message_id AS excerptId,
        'message' AS kind,
        role,
        text_redacted AS text,
        observed_at AS observedAt,
        source_ref_json AS sourceRefJson
      FROM messages
      WHERE session_id = ?
        AND (? IS NULL OR lower(text_redacted) LIKE ?)
      UNION ALL
      SELECT tool_call_id AS excerptId,
        'tool' AS kind,
        NULL AS role,
        tool_name AS text,
        COALESCE(started_at, '') AS observedAt,
        source_ref_json AS sourceRefJson
      FROM tool_calls
      WHERE session_id = ?
        AND (? IS NULL OR lower(tool_name) LIKE ?)
      UNION ALL
      SELECT checkpoint_id AS excerptId,
        'checkpoint' AS kind,
        NULL AS role,
        summary AS text,
        observed_at AS observedAt,
        source_ref_json AS sourceRefJson
      FROM checkpoints
      WHERE session_id = ?
        AND (? IS NULL OR lower(summary) LIKE ?)
      ORDER BY observedAt DESC
      LIMIT ?`
    )
    .all(sessionId, textFilter, textFilter, sessionId, textFilter, textFilter, sessionId, textFilter, textFilter, limit) as ExcerptRow[];
  return rows.map((row) => ({
    excerptId: row.excerptId,
    kind: row.kind,
    observedAt: row.observedAt,
    role: row.role ?? undefined,
    sourceRef: parseJson(row.sourceRefJson),
    text: row.text
  }));
}

export function listProjects(db: MastheadDatabase): ProjectDto[] {
  return db
    .prepare(
      `SELECT project_label AS project, COUNT(*) AS sessionCount
      FROM sessions
      WHERE deleted_at IS NULL AND project_label IS NOT NULL AND trim(project_label) <> ''
      GROUP BY project_label
      ORDER BY lower(project_label)`
    )
    .all() as ProjectDto[];
}

function candidateSessions(db: MastheadDatabase, query: string | undefined): Candidate[] | undefined {
  const match = ftsQuery(query ?? "");
  if (!match) return undefined;
  return db
    .prepare(
      `SELECT session_id AS sessionId,
        snippet(session_search, 2, '<mark>', '</mark>', ' ', 12) AS snippet
      FROM session_search
      WHERE session_search MATCH ?
      ORDER BY rank
      LIMIT 5000`
    )
    .all(match) as Candidate[];
}

function loadSessionRows(
  db: MastheadDatabase,
  query: SessionQuery,
  candidateIds?: string[],
  options: { includeDeleted?: boolean; includeDetailColumns?: boolean } = {}
): SessionRow[] {
  const where: string[] = [];
  const params: Array<string | number | null> = [];

  if (!options.includeDeleted) where.push("sessions.deleted_at IS NULL");
  if (candidateIds) {
    where.push(`sessions.session_id IN (${candidateIds.map(() => "?").join(", ")})`);
    params.push(...candidateIds);
  }
  if (query.runtime) {
    where.push("lower(runtimes.runtime_kind) = lower(?)");
    params.push(query.runtime);
  }
  if (query.host) {
    where.push("(lower(sessions.host_id) = lower(?) OR lower(COALESCE(hosts.hostname, '')) = lower(?))");
    params.push(query.host, query.host);
  }
  if (query.state) {
    where.push("lower(sessions.lifecycle) = lower(?)");
    params.push(query.state);
  }
  if (query.model) {
    where.push(
      `EXISTS (
        SELECT 1 FROM model_usage
        WHERE model_usage.session_id = sessions.session_id
          AND lower(COALESCE(model_usage.model, '')) = lower(?)
      )`
    );
    params.push(query.model);
  }
  if (query.file) {
    where.push(
      `EXISTS (
        SELECT 1 FROM file_effects
        WHERE file_effects.session_id = sessions.session_id
          AND lower(file_effects.path) LIKE ?
      )`
    );
    params.push(`%${query.file.toLowerCase()}%`);
  }
  if (query.project) {
    where.push(
      `(lower(COALESCE(sessions.project_label, '')) LIKE ?
        OR EXISTS (
          SELECT 1 FROM session_aliases
          WHERE session_aliases.session_id = sessions.session_id
            AND lower(session_aliases.alias_value) LIKE ?
        ))`
    );
    const pattern = `%${query.project.toLowerCase()}%`;
    params.push(pattern, pattern);
  }
  if (query.dateFrom) {
    where.push("sessions.last_activity_at >= ?");
    params.push(query.dateFrom);
  }
  if (query.dateTo) {
    where.push("sessions.last_activity_at <= ?");
    params.push(query.dateTo);
  }

  return db
    .prepare(
      `SELECT
        sessions.session_id AS sessionId,
        sessions.source_session_id AS sourceSessionId,
        sessions.title AS title,
        sessions.objective AS objective,
        sessions.outcome_label AS outcome,
        sessions.project_label AS project,
        runtimes.runtime_kind AS runtime,
        sessions.host_id AS hostId,
        sessions.branch AS branch,
        sessions.lifecycle AS lifecycle,
        sessions.started_at AS startedAt,
        sessions.last_activity_at AS lastActivityAt,
        sessions.ended_at AS endedAt,
        sessions.source_confidence AS sourceConfidence,
        ${options.includeDetailColumns ? "sessions.repo_root AS repoRoot, sessions.worktree_path AS worktreePath, sessions.excluded_from_mcp_at AS excludedFromMcpAt," : ""}
        (SELECT json_group_array(model)
          FROM (SELECT DISTINCT model FROM model_usage WHERE session_id = sessions.session_id AND model IS NOT NULL AND trim(model) <> '' ORDER BY model)
        ) AS modelsJson,
        (SELECT json_group_array(topic)
          FROM (SELECT DISTINCT topic FROM session_topics WHERE session_id = sessions.session_id ORDER BY topic)
        ) AS topicsJson,
        (SELECT COUNT(DISTINCT path) FROM file_effects WHERE session_id = sessions.session_id) AS fileCount,
        (SELECT COUNT(DISTINCT tool_name) FROM tool_calls WHERE session_id = sessions.session_id) AS toolCount,
        (SELECT COUNT(*)
          FROM tool_results
          WHERE session_id = sessions.session_id
            AND lower(status) NOT IN ('succeeded', 'success', 'ok')
        ) AS errorCount
      FROM sessions
      JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
      JOIN hosts ON hosts.host_id = sessions.host_id
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ${sortOrderClause(query.sort)}`
    )
    .all(...params) as SessionRow[];
}

function sortOrderClause(sort: LogbookSort | undefined): string {
  if (sort === "oldest") return "ORDER BY sessions.last_activity_at ASC, sessions.session_id ASC";
  if (sort === "duration_desc") {
    return `ORDER BY
      CASE
        WHEN sessions.started_at IS NOT NULL AND sessions.ended_at IS NOT NULL
        THEN unixepoch(sessions.ended_at) - unixepoch(sessions.started_at)
        ELSE 0
      END DESC,
      sessions.last_activity_at DESC,
      sessions.session_id DESC`;
  }
  if (sort === "files_desc") return "ORDER BY fileCount DESC, sessions.last_activity_at DESC, sessions.session_id DESC";
  if (sort === "tools_desc") return "ORDER BY toolCount DESC, sessions.last_activity_at DESC, sessions.session_id DESC";
  if (sort === "errors_desc") return "ORDER BY errorCount DESC, sessions.last_activity_at DESC, sessions.session_id DESC";
  if (sort === "project") {
    return "ORDER BY lower(COALESCE(sessions.project_label, '')), sessions.last_activity_at DESC, sessions.session_id DESC";
  }
  return "ORDER BY sessions.last_activity_at DESC, sessions.session_id DESC";
}

function rowToListItem(row: SessionRow, snippet?: string, enrichment?: SessionEnrichmentView): SessionListItemDto {
  const topics = uniqueStrings([...(enrichment?.topics ?? []), ...parseJsonArray(row.topicsJson)]);
  return {
    branch: row.branch ?? undefined,
    endedAt: row.endedAt ?? undefined,
    enrichmentStatus: enrichment?.status ?? "missing",
    errorCount: row.errorCount,
    fileCount: row.fileCount,
    hostId: row.hostId,
    lastActivityAt: row.lastActivityAt,
    lifecycle: row.lifecycle,
    models: parseJsonArray(row.modelsJson),
    objective: enrichment?.objective ?? row.objective ?? undefined,
    outcome: enrichment?.outcome ?? row.outcome ?? undefined,
    project: row.project ?? undefined,
    runtime: row.runtime,
    sessionId: row.sessionId,
    snippet,
    sourceConfidence: row.sourceConfidence,
    sourceSessionId: row.sourceSessionId,
    startedAt: row.startedAt ?? undefined,
    title: enrichment?.title ?? row.title ?? row.objective ?? row.project ?? row.sourceSessionId,
    toolCount: row.toolCount,
    topics,
    unresolved: enrichment?.unresolved ?? []
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

function likePattern(query: string | undefined): string | null {
  const normalized = query?.trim().toLowerCase();
  return normalized ? `%${normalized}%` : null;
}

function clampLimit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.trunc(value), 100));
}

function cursorToOffset(cursor: string | undefined): number | undefined {
  if (!cursor) return undefined;
  const offset = Number.parseInt(cursor, 10);
  return Number.isFinite(offset) && offset >= 0 ? offset : undefined;
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

function durationMs(startedAt: string | null, endedAt: string | null): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;
  return end - start;
}
