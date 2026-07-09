import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import { publishedWorkbenchSessionSql } from "../daemon/db/workbenchPublicationSql.ts";

export function mcpSessionPolicySql(sessionAlias = "sessions"): string {
  return `${sessionAlias}.deleted_at IS NULL
    AND ${publishedWorkbenchSessionSql(sessionAlias)}
    AND ${sessionAlias}.excluded_from_mcp_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM source_policies global_mcp_policy
      WHERE global_mcp_policy.policy_kind = 'mcp_access'
        AND global_mcp_policy.source_id IS NULL
        AND global_mcp_policy.enabled = 0
    )
    AND NOT EXISTS (
      SELECT 1
      FROM session_aliases mcp_session_aliases
      JOIN source_policies source_mcp_policy
        ON source_mcp_policy.source_id = mcp_session_aliases.source_id
       AND source_mcp_policy.policy_kind = 'mcp_access'
       AND source_mcp_policy.enabled = 0
      WHERE mcp_session_aliases.session_id = ${sessionAlias}.session_id
    )`;
}

export function sessionMcpAllowed(db: MastheadDatabase, sessionId: string): boolean {
  const row = db
    .prepare(
      `SELECT sessions.session_id
      FROM sessions
      WHERE sessions.session_id = ?
        AND ${mcpSessionPolicySql("sessions")}
      LIMIT 1`
    )
    .get(sessionId) as { session_id: string } | undefined;
  return Boolean(row);
}
