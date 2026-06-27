import type { MastheadDatabase } from "./sqlite.ts";

export type UsageWindow = "today" | "24h" | "7d" | "30d" | "all";

type UsageRange = {
  from?: string;
  to: string;
  bucket: "hour" | "day";
};

export type UsageTotalsDto = {
  sessions: number;
  projects: number;
  runtimes: number;
  models: number;
  messages: number;
  toolCalls: number;
  fileEffects: number;
  mcpQueries: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenRows: number;
  tokenCoverageSessions: number;
  tokensPerMinute?: number;
};

export type UsageByModelDto = {
  model: string;
  provider?: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type UsageByProjectDto = {
  project: string;
  sessions: number;
  messages: number;
  toolCalls: number;
  fileEffects: number;
  totalTokens: number;
};

export type UsageByRuntimeDto = {
  runtime: string;
  sessions: number;
  messages: number;
  toolCalls: number;
  fileEffects: number;
  totalTokens: number;
};

export type UsageActivityPointDto = {
  bucketStart: string;
  sessions: number;
  messages: number;
  toolCalls: number;
  fileEffects: number;
  totalTokens: number;
};

export type UsageCoverageDto = {
  sources: number;
  importedSessions: number;
  sessionsWithTokenUsage: number;
  sessionsWithoutTokenUsage: number;
  currentEnrichments: number;
  mcpQueries: number;
};

export type UsageStatsDto = {
  window: UsageWindow;
  generatedAt: string;
  range: {
    from?: string;
    to: string;
  };
  totals: UsageTotalsDto;
  byModel: UsageByModelDto[];
  byProject: UsageByProjectDto[];
  byRuntime: UsageByRuntimeDto[];
  activity: UsageActivityPointDto[];
  coverage: UsageCoverageDto;
};

type SessionTotalsRow = {
  sessions: number;
  projects: number;
};

type TokenTotalsRow = {
  tokenRows: number;
  tokenCoverageSessions: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type CountRow = { count: number };

type UsageByModelRow = UsageByModelDto & { provider: string };
type ActivityMetric = Exclude<keyof UsageActivityPointDto, "bucketStart">;

const TOKEN_VALUE_PRESENT_SQL =
  "(model_usage.total_tokens IS NOT NULL OR model_usage.input_tokens IS NOT NULL OR model_usage.output_tokens IS NOT NULL)";
const TOKEN_TOTAL_SQL = "COALESCE(model_usage.total_tokens, COALESCE(model_usage.input_tokens, 0) + COALESCE(model_usage.output_tokens, 0))";

export function getSessionTokenTotals(db: MastheadDatabase, sessionIds: string[]): Map<string, number> {
  const uniqueSessionIds = [...new Set(sessionIds.filter(Boolean))];
  if (uniqueSessionIds.length === 0) return new Map();
  const placeholders = uniqueSessionIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT COALESCE(sessions.source_session_id, sessions.session_id) AS sessionId,
        COALESCE(SUM(${TOKEN_TOTAL_SQL}), 0) AS totalTokens
      FROM sessions
      JOIN model_usage ON model_usage.session_id = sessions.session_id
      WHERE sessions.deleted_at IS NULL
        AND (sessions.source_session_id IN (${placeholders}) OR sessions.session_id IN (${placeholders}))
        AND ${TOKEN_VALUE_PRESENT_SQL}
      GROUP BY COALESCE(sessions.source_session_id, sessions.session_id)`
    )
    .all(...uniqueSessionIds, ...uniqueSessionIds) as Array<{ sessionId: string; totalTokens: number }>;
  return new Map(rows.map((row) => [row.sessionId, Number(row.totalTokens) || 0]));
}

export function usageRangeForWindow(window: UsageWindow, now = new Date()): UsageRange {
  const to = now.toISOString();

  if (window === "all") return { to, bucket: "day" };

  if (window === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to, bucket: "hour" };
  }

  const hours = window === "24h" ? 24 : window === "7d" ? 24 * 7 : 24 * 30;
  const from = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
  return { from, to, bucket: window === "24h" ? "hour" : "day" };
}

export function getUsageStats(db: MastheadDatabase, window: UsageWindow, now = new Date()): UsageStatsDto {
  const usageRange = usageRangeForWindow(window, now);
  const range = { from: usageRange.from, to: usageRange.to };
  const tokenTotals = getTokenTotals(db, usageRange);
  const totals: UsageTotalsDto = {
    ...getSessionTotals(db, usageRange),
    fileEffects: countEventRows(db, "file_effects", "observed_at", usageRange),
    inputTokens: tokenTotals.inputTokens,
    mcpQueries: countMcpQueries(db, usageRange),
    messages: countEventRows(db, "messages", "observed_at", usageRange),
    models: countModels(db, usageRange),
    outputTokens: tokenTotals.outputTokens,
    runtimes: countRuntimes(db, usageRange),
    tokenCoverageSessions: tokenTotals.tokenCoverageSessions,
    tokenRows: tokenTotals.tokenRows,
    tokensPerMinute: tokensPerMinute(tokenTotals.totalTokens, usageRange.from, usageRange.to),
    toolCalls: countEventRows(db, "tool_calls", "started_at", usageRange),
    totalTokens: tokenTotals.totalTokens
  };

  if (totals.tokensPerMinute === undefined) {
    delete totals.tokensPerMinute;
  }

  return {
    activity: getUsageActivity(db, usageRange),
    byModel: getUsageByModel(db, usageRange),
    byProject: getUsageByProject(db, usageRange),
    byRuntime: getUsageByRuntime(db, usageRange),
    coverage: getUsageCoverage(db),
    generatedAt: usageRange.to,
    range,
    totals,
    window
  };
}

function getSessionTotals(db: MastheadDatabase, range: UsageRange): SessionTotalsRow {
  return db
    .prepare(
      `SELECT COUNT(*) AS sessions,
        COUNT(DISTINCT CASE WHEN project_label IS NOT NULL AND trim(project_label) <> '' THEN project_label END) AS projects
      FROM sessions
      WHERE deleted_at IS NULL
        AND (? IS NULL OR last_activity_at >= ?)
        AND last_activity_at <= ?`
    )
    .get(range.from ?? null, range.from ?? null, range.to) as SessionTotalsRow;
}

function countRuntimes(db: MastheadDatabase, range: UsageRange): number {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT runtimes.runtime_kind) AS count
      FROM sessions
      JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
      WHERE sessions.deleted_at IS NULL
        AND (? IS NULL OR sessions.last_activity_at >= ?)
        AND sessions.last_activity_at <= ?`
    )
    .get(range.from ?? null, range.from ?? null, range.to) as CountRow;
  return row.count;
}

function countModels(db: MastheadDatabase, range: UsageRange): number {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT model_usage.model) AS count
      FROM model_usage
      JOIN sessions ON sessions.session_id = model_usage.session_id
      WHERE sessions.deleted_at IS NULL
        AND model_usage.model IS NOT NULL
        AND trim(model_usage.model) <> ''
        AND ${TOKEN_VALUE_PRESENT_SQL}
        AND (? IS NULL OR model_usage.observed_at >= ?)
        AND model_usage.observed_at <= ?`
    )
    .get(range.from ?? null, range.from ?? null, range.to) as CountRow;
  return row.count;
}

function getTokenTotals(db: MastheadDatabase, range: UsageRange): TokenTotalsRow {
  return db
    .prepare(
      `SELECT COUNT(*) AS tokenRows,
        COUNT(DISTINCT model_usage.session_id) AS tokenCoverageSessions,
        COALESCE(SUM(COALESCE(model_usage.input_tokens, 0)), 0) AS inputTokens,
        COALESCE(SUM(COALESCE(model_usage.output_tokens, 0)), 0) AS outputTokens,
        COALESCE(SUM(${TOKEN_TOTAL_SQL}), 0) AS totalTokens
      FROM model_usage
      JOIN sessions ON sessions.session_id = model_usage.session_id
      WHERE sessions.deleted_at IS NULL
        AND ${TOKEN_VALUE_PRESENT_SQL}
        AND (? IS NULL OR model_usage.observed_at >= ?)
        AND model_usage.observed_at <= ?`
    )
    .get(range.from ?? null, range.from ?? null, range.to) as TokenTotalsRow;
}

function tokensPerMinute(totalTokens: number, from: string | undefined, to: string): number | undefined {
  if (totalTokens <= 0 || !from) return undefined;
  const minutes = Math.max(1, (Date.parse(to) - Date.parse(from)) / 60_000);
  return totalTokens / minutes;
}

function getUsageByModel(db: MastheadDatabase, range: UsageRange): UsageByModelDto[] {
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(trim(model_usage.model), ''), 'Unknown model') AS model,
        COALESCE(NULLIF(trim(model_usage.provider), ''), '') AS provider,
        COUNT(DISTINCT model_usage.session_id) AS sessions,
        COALESCE(SUM(COALESCE(model_usage.input_tokens, 0)), 0) AS inputTokens,
        COALESCE(SUM(COALESCE(model_usage.output_tokens, 0)), 0) AS outputTokens,
        COALESCE(SUM(${TOKEN_TOTAL_SQL}), 0) AS totalTokens
      FROM model_usage
      JOIN sessions ON sessions.session_id = model_usage.session_id
      WHERE sessions.deleted_at IS NULL
        AND ${TOKEN_VALUE_PRESENT_SQL}
        AND (? IS NULL OR model_usage.observed_at >= ?)
        AND model_usage.observed_at <= ?
      GROUP BY COALESCE(NULLIF(trim(model_usage.model), ''), 'Unknown model'), COALESCE(NULLIF(trim(model_usage.provider), ''), '')
      ORDER BY totalTokens DESC, sessions DESC, model ASC
      LIMIT 12`
    )
    .all(range.from ?? null, range.from ?? null, range.to) as UsageByModelRow[];

  return rows.map((row) => ({
    inputTokens: row.inputTokens,
    model: row.model,
    outputTokens: row.outputTokens,
    provider: row.provider || undefined,
    sessions: row.sessions,
    totalTokens: row.totalTokens
  }));
}

function getUsageByProject(db: MastheadDatabase, range: UsageRange): UsageByProjectDto[] {
  return db
    .prepare(
      `WITH scoped_sessions AS (
        SELECT session_id,
          COALESCE(NULLIF(trim(project_label), ''), 'Unknown project') AS project
        FROM sessions
        WHERE deleted_at IS NULL
          AND (? IS NULL OR last_activity_at >= ?)
          AND last_activity_at <= ?
      ),
      message_counts AS (
        SELECT session_id, COUNT(*) AS messages
        FROM messages
        WHERE (? IS NULL OR observed_at >= ?)
          AND observed_at <= ?
        GROUP BY session_id
      ),
      tool_counts AS (
        SELECT session_id, COUNT(*) AS toolCalls
        FROM tool_calls
        WHERE (? IS NULL OR started_at >= ?)
          AND started_at <= ?
        GROUP BY session_id
      ),
      file_counts AS (
        SELECT session_id, COUNT(*) AS fileEffects
        FROM file_effects
        WHERE (? IS NULL OR observed_at >= ?)
          AND observed_at <= ?
        GROUP BY session_id
      ),
      token_counts AS (
        SELECT model_usage.session_id, COALESCE(SUM(${TOKEN_TOTAL_SQL}), 0) AS totalTokens
        FROM model_usage AS model_usage
        WHERE ${TOKEN_VALUE_PRESENT_SQL}
          AND (? IS NULL OR model_usage.observed_at >= ?)
          AND model_usage.observed_at <= ?
        GROUP BY model_usage.session_id
      )
      SELECT scoped_sessions.project AS project,
        COUNT(*) AS sessions,
        COALESCE(SUM(message_counts.messages), 0) AS messages,
        COALESCE(SUM(tool_counts.toolCalls), 0) AS toolCalls,
        COALESCE(SUM(file_counts.fileEffects), 0) AS fileEffects,
        COALESCE(SUM(token_counts.totalTokens), 0) AS totalTokens
      FROM scoped_sessions
      LEFT JOIN message_counts ON message_counts.session_id = scoped_sessions.session_id
      LEFT JOIN tool_counts ON tool_counts.session_id = scoped_sessions.session_id
      LEFT JOIN file_counts ON file_counts.session_id = scoped_sessions.session_id
      LEFT JOIN token_counts ON token_counts.session_id = scoped_sessions.session_id
      GROUP BY scoped_sessions.project
      ORDER BY totalTokens DESC, sessions DESC, project ASC
      LIMIT 12`
    )
    .all(...repeatedRangeArgs(range, 5)) as UsageByProjectDto[];
}

function getUsageByRuntime(db: MastheadDatabase, range: UsageRange): UsageByRuntimeDto[] {
  return db
    .prepare(
      `WITH scoped_sessions AS (
        SELECT sessions.session_id,
          COALESCE(NULLIF(trim(runtimes.runtime_kind), ''), 'Unknown runtime') AS runtime
        FROM sessions
        JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
        WHERE sessions.deleted_at IS NULL
          AND (? IS NULL OR sessions.last_activity_at >= ?)
          AND sessions.last_activity_at <= ?
      ),
      message_counts AS (
        SELECT session_id, COUNT(*) AS messages
        FROM messages
        WHERE (? IS NULL OR observed_at >= ?)
          AND observed_at <= ?
        GROUP BY session_id
      ),
      tool_counts AS (
        SELECT session_id, COUNT(*) AS toolCalls
        FROM tool_calls
        WHERE (? IS NULL OR started_at >= ?)
          AND started_at <= ?
        GROUP BY session_id
      ),
      file_counts AS (
        SELECT session_id, COUNT(*) AS fileEffects
        FROM file_effects
        WHERE (? IS NULL OR observed_at >= ?)
          AND observed_at <= ?
        GROUP BY session_id
      ),
      token_counts AS (
        SELECT model_usage.session_id, COALESCE(SUM(${TOKEN_TOTAL_SQL}), 0) AS totalTokens
        FROM model_usage AS model_usage
        WHERE ${TOKEN_VALUE_PRESENT_SQL}
          AND (? IS NULL OR model_usage.observed_at >= ?)
          AND model_usage.observed_at <= ?
        GROUP BY model_usage.session_id
      )
      SELECT scoped_sessions.runtime AS runtime,
        COUNT(*) AS sessions,
        COALESCE(SUM(message_counts.messages), 0) AS messages,
        COALESCE(SUM(tool_counts.toolCalls), 0) AS toolCalls,
        COALESCE(SUM(file_counts.fileEffects), 0) AS fileEffects,
        COALESCE(SUM(token_counts.totalTokens), 0) AS totalTokens
      FROM scoped_sessions
      LEFT JOIN message_counts ON message_counts.session_id = scoped_sessions.session_id
      LEFT JOIN tool_counts ON tool_counts.session_id = scoped_sessions.session_id
      LEFT JOIN file_counts ON file_counts.session_id = scoped_sessions.session_id
      LEFT JOIN token_counts ON token_counts.session_id = scoped_sessions.session_id
      GROUP BY scoped_sessions.runtime
      ORDER BY totalTokens DESC, sessions DESC, runtime ASC
      LIMIT 12`
    )
    .all(...repeatedRangeArgs(range, 5)) as UsageByRuntimeDto[];
}

function getUsageActivity(db: MastheadDatabase, range: UsageRange): UsageActivityPointDto[] {
  const buckets = new Map<string, UsageActivityPointDto>();
  addActivityRows(db, buckets, "sessions", "last_activity_at", range, "sessions", "COUNT(*)", "sessions.deleted_at IS NULL");
  addActivityRows(
    db,
    buckets,
    "messages",
    "observed_at",
    range,
    "messages",
    "COUNT(*)",
    "sessions.deleted_at IS NULL"
  );
  addActivityRows(
    db,
    buckets,
    "tool_calls",
    "started_at",
    range,
    "toolCalls",
    "COUNT(*)",
    "sessions.deleted_at IS NULL"
  );
  addActivityRows(
    db,
    buckets,
    "file_effects",
    "observed_at",
    range,
    "fileEffects",
    "COUNT(*)",
    "sessions.deleted_at IS NULL"
  );
  addActivityRows(
    db,
    buckets,
    "model_usage",
    "observed_at",
    range,
    "totalTokens",
    `COALESCE(SUM(${TOKEN_TOTAL_SQL}), 0)`,
    `sessions.deleted_at IS NULL AND ${TOKEN_VALUE_PRESENT_SQL}`
  );

  return [...buckets.values()].sort((left, right) => left.bucketStart.localeCompare(right.bucketStart));
}

function addActivityRows(
  db: MastheadDatabase,
  buckets: Map<string, UsageActivityPointDto>,
  table: "sessions" | "messages" | "tool_calls" | "file_effects" | "model_usage",
  timestampColumn: "last_activity_at" | "observed_at" | "started_at",
  range: UsageRange,
  metric: ActivityMetric,
  aggregate: string,
  whereClause: string
): void {
  const qualifiedTimestamp = `${table}.${timestampColumn}`;
  const bucketExpression =
    range.bucket === "hour"
      ? `strftime('%Y-%m-%dT%H:00:00.000Z', ${qualifiedTimestamp})`
      : `strftime('%Y-%m-%dT00:00:00.000Z', ${qualifiedTimestamp})`;
  const fromClause = table === "sessions" ? "sessions" : `${table} JOIN sessions ON sessions.session_id = ${table}.session_id`;
  const rows = db
    .prepare(
      `SELECT ${bucketExpression} AS bucketStart,
        ${aggregate} AS value
      FROM ${fromClause}
      WHERE ${whereClause}
        AND ${qualifiedTimestamp} IS NOT NULL
        AND (? IS NULL OR ${qualifiedTimestamp} >= ?)
        AND ${qualifiedTimestamp} <= ?
      GROUP BY bucketStart`
    )
    .all(range.from ?? null, range.from ?? null, range.to) as Array<{ bucketStart: string; value: number }>;

  for (const row of rows) {
    const bucket = buckets.get(row.bucketStart) ?? emptyActivityPoint(row.bucketStart);
    bucket[metric] = row.value;
    buckets.set(row.bucketStart, bucket);
  }
}

function getUsageCoverage(db: MastheadDatabase): UsageCoverageDto {
  const sources = tableCount(db, "ingest_sources", "excluded_at IS NULL");
  const importedSessions = tableCount(db, "sessions", "deleted_at IS NULL");
  const sessionsWithTokenUsage = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT model_usage.session_id) AS count
        FROM model_usage
        JOIN sessions ON sessions.session_id = model_usage.session_id
        WHERE sessions.deleted_at IS NULL
          AND ${TOKEN_VALUE_PRESENT_SQL}`
      )
      .get() as CountRow
  ).count;
  const currentEnrichments = (
    db
      .prepare(
        `SELECT COUNT(*) AS count
        FROM session_enrichments
        JOIN sessions ON sessions.session_id = session_enrichments.session_id
        WHERE sessions.deleted_at IS NULL
          AND session_enrichments.status = 'current'`
      )
      .get() as CountRow
  ).count;

  return {
    currentEnrichments,
    importedSessions,
    mcpQueries: tableCount(db, "mcp_query_log"),
    sessionsWithTokenUsage,
    sessionsWithoutTokenUsage: Math.max(0, importedSessions - sessionsWithTokenUsage),
    sources
  };
}

function countEventRows(
  db: MastheadDatabase,
  table: "messages" | "tool_calls" | "file_effects",
  timestampColumn: "observed_at" | "started_at",
  range: UsageRange
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
      FROM ${table}
      JOIN sessions ON sessions.session_id = ${table}.session_id
      WHERE sessions.deleted_at IS NULL
        AND (? IS NULL OR ${table}.${timestampColumn} >= ?)
        AND ${table}.${timestampColumn} <= ?`
    )
    .get(range.from ?? null, range.from ?? null, range.to) as CountRow;
  return row.count;
}

function countMcpQueries(db: MastheadDatabase, range: UsageRange): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
      FROM mcp_query_log
      WHERE (? IS NULL OR requested_at >= ?)
        AND requested_at <= ?`
    )
    .get(range.from ?? null, range.from ?? null, range.to) as CountRow;
  return row.count;
}

function tableCount(db: MastheadDatabase, table: "ingest_sources" | "mcp_query_log" | "sessions", whereClause?: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}${whereClause ? ` WHERE ${whereClause}` : ""}`).get() as CountRow;
  return row.count;
}

function repeatedRangeArgs(range: UsageRange, count: number): Array<string | null> {
  const args: Array<string | null> = [];
  for (let index = 0; index < count; index += 1) {
    args.push(range.from ?? null, range.from ?? null, range.to);
  }
  return args;
}

function emptyActivityPoint(bucketStart: string): UsageActivityPointDto {
  return {
    bucketStart,
    fileEffects: 0,
    messages: 0,
    sessions: 0,
    toolCalls: 0,
    totalTokens: 0
  };
}
