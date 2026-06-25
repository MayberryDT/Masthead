import type { MastheadDatabase } from "./sqlite.ts";

export type LogbookSummaryDto = {
  sessions: number;
  projects: number;
  runtimes: Array<{ runtime: string; count: number }>;
  models: Array<{ model: string; count: number }>;
  lifecycles: Array<{ lifecycle: string; count: number }>;
  messages: number;
  toolCalls: number;
  fileEffects: number;
  earliestActivityAt?: string;
  latestActivityAt?: string;
};

type CountRow<T extends string> = Record<T, string> & { count: number };

export function getLogbookSummary(db: MastheadDatabase): LogbookSummaryDto {
  const sessionCounts = db
    .prepare(
      `SELECT
        COUNT(*) AS sessions,
        COUNT(DISTINCT CASE WHEN project_label IS NOT NULL AND trim(project_label) <> '' THEN project_label END) AS projects,
        MIN(COALESCE(started_at, last_activity_at)) AS earliestActivityAt,
        MAX(last_activity_at) AS latestActivityAt
      FROM sessions
      WHERE deleted_at IS NULL`
    )
    .get() as { sessions: number; projects: number; earliestActivityAt: string | null; latestActivityAt: string | null };

  const messages = countJoinedRows(db, "messages");
  const toolCalls = countJoinedRows(db, "tool_calls");
  const fileEffects = countJoinedRows(db, "file_effects");

  return {
    earliestActivityAt: sessionCounts.earliestActivityAt ?? undefined,
    fileEffects,
    latestActivityAt: sessionCounts.latestActivityAt ?? undefined,
    lifecycles: groupedCounts(db, "sessions.lifecycle", "lifecycle", "sessions", undefined),
    messages,
    models: groupedCounts(db, "model_usage.model", "model", "model_usage", "model_usage.session_id = sessions.session_id"),
    projects: sessionCounts.projects,
    runtimes: groupedCounts(db, "runtimes.runtime_kind", "runtime", "runtimes", "runtimes.runtime_id = sessions.runtime_id"),
    sessions: sessionCounts.sessions,
    toolCalls
  };
}

function groupedCounts<T extends "runtime" | "model" | "lifecycle">(
  db: MastheadDatabase,
  expression: string,
  alias: T,
  table: string,
  joinCondition: string | undefined
): Array<CountRow<T>> {
  const fromClause =
    table === "sessions"
      ? "sessions"
      : `sessions JOIN ${table} ON ${joinCondition}`;
  return db
    .prepare(
      `SELECT ${expression} AS ${alias}, COUNT(DISTINCT sessions.session_id) AS count
      FROM ${fromClause}
      WHERE sessions.deleted_at IS NULL
        AND ${expression} IS NOT NULL
        AND trim(${expression}) <> ''
      GROUP BY ${expression}
      ORDER BY lower(${expression})`
    )
    .all() as Array<CountRow<T>>;
}

function countJoinedRows(db: MastheadDatabase, table: "messages" | "tool_calls" | "file_effects"): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
      FROM ${table}
      JOIN sessions ON sessions.session_id = ${table}.session_id
      WHERE sessions.deleted_at IS NULL`
    )
    .get() as { count: number };
  return row.count;
}
