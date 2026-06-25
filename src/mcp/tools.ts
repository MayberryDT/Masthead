import { logMcpQuery } from "../daemon/db/mcpAuditRepository.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import {
  coverage,
  getMcpProjectHistory,
  getMcpSession,
  getMcpSessionExcerpt,
  listMcpProjectSessions,
  searchMcpSessions
} from "./sessionRetrieval.ts";

export type SearchSessionsArgs = {
  query: string;
  project?: string;
  runtime?: string;
  model?: string;
  host?: string;
  state?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};

export function searchSessionsTool(db: MastheadDatabase, args: SearchSessionsArgs) {
  const result = searchMcpSessions(db, { ...args, limit: args.limit ?? 10 });
  logMcpQuery(db, {
    requestedAt: new Date().toISOString(),
    resultCount: result.sessions.length,
    sessionIds: result.sessions.map((session) => session.sessionId),
    status: "succeeded",
    toolName: "search_sessions"
  });
  return result;
}

export function getSessionExcerptTool(
  db: MastheadDatabase,
  args: { sessionId: string; query?: string; limit?: number; maxBytes?: number }
) {
  const result = getMcpSessionExcerpt(db, args);
  logMcpQuery(db, {
    boundedBytes: args.maxBytes ?? 8_000,
    requestedAt: new Date().toISOString(),
    resultCount: result.excerpts.length,
    sessionIds: [args.sessionId],
    status: "succeeded",
    toolName: "get_session_excerpt"
  });
  return result;
}

export function getSessionTool(db: MastheadDatabase, args: { sessionId: string; maxBytes?: number }) {
  const result = getMcpSession(db, args.sessionId, args.maxBytes ?? 8_000);
  logMcpQuery(db, {
    boundedBytes: args.maxBytes ?? 8_000,
    requestedAt: new Date().toISOString(),
    resultCount: result.session ? 1 : 0,
    sessionIds: [args.sessionId],
    status: "succeeded",
    toolName: "get_session"
  });
  return result;
}

export function listProjectSessionsTool(db: MastheadDatabase, args: { project: string; limit?: number }) {
  const sessions = listMcpProjectSessions(db, args.project, args.limit ?? 25);
  logMcpQuery(db, {
    requestedAt: new Date().toISOString(),
    resultCount: sessions.length,
    sessionIds: sessions.map((session) => session.sessionId),
    status: "succeeded",
    toolName: "list_project_sessions"
  });
  return { sessions };
}

export function getProjectHistoryTool(db: MastheadDatabase, args: { project: string; limit?: number }) {
  const result = getMcpProjectHistory(db, args.project, args.limit ?? 25);
  logMcpQuery(db, {
    requestedAt: new Date().toISOString(),
    resultCount: result.sessions.length,
    sessionIds: result.sessions.map((session) => session.sessionId),
    status: "succeeded",
    toolName: "get_project_history"
  });
  return result;
}

export function getMastheadCoverageTool(db: MastheadDatabase) {
  const result = coverage(db);
  logMcpQuery(db, {
    requestedAt: new Date().toISOString(),
    resultCount: result.sessions,
    sessionIds: [],
    status: "succeeded",
    toolName: "get_masthead_coverage"
  });
  return result;
}
