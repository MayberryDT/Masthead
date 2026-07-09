import type { MastheadDatabase } from "./sqlite.ts";

export function publishedWorkbenchSessionSql(sessionAlias = "sessions"): string {
  return `EXISTS (
    SELECT 1
    FROM workbench_session_state published_workbench_state
    WHERE published_workbench_state.session_id = ${sessionAlias}.session_id
      AND published_workbench_state.publication_status = 'published'
  )`;
}

export function workbenchSessionIsPublished(db: MastheadDatabase, sessionId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1
      FROM sessions
      WHERE sessions.session_id = ?
        AND ${publishedWorkbenchSessionSql("sessions")}
      LIMIT 1`
    )
    .get(sessionId);
  return Boolean(row);
}
