import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import {
  enrollWorkbenchSession,
  type WorkbenchActor
} from "../daemon/db/workbenchPipelineRepository.ts";

export type MissingImportedWorkbenchReconciliationResult = {
  enrolled: number;
  enrolledSessionIds: string[];
  heldForImportRepair: number;
  limit: number;
  skippedExisting: number;
};

type MissingSessionRow = {
  sessionId: string;
};

const LATEST_MISSING_IMPORT_HEALTH_CTE = `WITH ranked_health AS (
  SELECT session_id, status,
    ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY updated_at DESC, work_unit_id DESC) AS rank
  FROM session_import_health
  WHERE session_id IS NOT NULL
), missing_sessions AS (
  SELECT sessions.session_id AS sessionId, latest_health.status AS healthStatus,
    sessions.last_activity_at AS lastActivityAt,
    sessions.updated_at AS updatedAt,
    sessions.created_at AS createdAt
  FROM sessions
  LEFT JOIN workbench_session_state ON workbench_session_state.session_id = sessions.session_id
  LEFT JOIN ranked_health latest_health
    ON latest_health.session_id = sessions.session_id AND latest_health.rank = 1
  WHERE sessions.deleted_at IS NULL
    AND workbench_session_state.session_id IS NULL
)`;

export function reconcileMissingImportedWorkbenchSessions(
  db: MastheadDatabase,
  input: { actor: WorkbenchActor; limit?: number }
): MissingImportedWorkbenchReconciliationResult {
  // Enrollment is intentionally lightweight. Transcript reconciliation can
  // read and hash an entire historical session, so it belongs to import and
  // explicit transcript work, never behind a Workbench toolbar button.
  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 100), 250));
  const skippedExisting = countExistingWorkbenchSessions(db);
  const heldForImportRepair = countMissingSessionsHeldForImportRepair(db);
  const missing = listReconcilableMissingSessions(db, limit);
  const enrolledSessionIds: string[] = [];

  for (const row of missing) {
    const state = enrollWorkbenchSession(db, { actor: input.actor, sessionId: row.sessionId }).state;
    if (state) enrolledSessionIds.push(row.sessionId);
  }

  return {
    enrolled: enrolledSessionIds.length,
    enrolledSessionIds,
    heldForImportRepair,
    limit,
    skippedExisting
  };
}

function countExistingWorkbenchSessions(db: MastheadDatabase): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS count
     FROM sessions
     JOIN workbench_session_state ON workbench_session_state.session_id = sessions.session_id
     WHERE sessions.deleted_at IS NULL`
  ).get() as { count: number };
  return row.count;
}

function countMissingSessionsHeldForImportRepair(db: MastheadDatabase): number {
  const row = db.prepare(
    `${LATEST_MISSING_IMPORT_HEALTH_CTE}
     SELECT COUNT(*) AS count
     FROM missing_sessions
     WHERE healthStatus IN ('partial', 'repair_required')`
  ).get() as { count: number };
  return row.count;
}

function listReconcilableMissingSessions(db: MastheadDatabase, limit: number): MissingSessionRow[] {
  return db.prepare(
    `${LATEST_MISSING_IMPORT_HEALTH_CTE}
     SELECT sessionId
     FROM missing_sessions
     WHERE COALESCE(healthStatus, 'complete') = 'complete'
     ORDER BY COALESCE(lastActivityAt, updatedAt, createdAt) DESC, sessionId DESC
     LIMIT ?`
  ).all(limit) as MissingSessionRow[];
}
