import { logMcpQuery } from "../daemon/db/mcpAuditRepository.ts";
import { getLogbookArtifactDetail, searchLogbookArtifacts } from "../daemon/db/logbookArtifactRepository.ts";
import { getSessionTranscript } from "../daemon/db/sessionTranscriptRepository.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import type { SessionArtifactKind } from "../daemon/db/sessionArtifactRepository.ts";
import { sessionMcpAllowed } from "./policy.ts";
import {
  coverage,
  getMcpProjectHistory,
  getMcpSession,
  getMcpSessionExcerpt,
  listMcpProjectSessions,
  searchMcpSessions
} from "./sessionRetrieval.ts";
import type { SessionTranscriptItem } from "../shared/sessionTranscript.ts";

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

export type SearchArtifactsArgs = {
  query?: string;
  kind?: SessionArtifactKind;
  project?: string;
  limit?: number;
  offset?: number;
};

export function searchArtifactsTool(db: MastheadDatabase, args: SearchArtifactsArgs) {
  const result = searchLogbookArtifacts(db, {
    kind: args.kind,
    limit: args.limit ?? 10,
    offset: args.offset ?? 0,
    project: args.project,
    q: args.query
  });
  logMcpQuery(db, {
    requestedAt: new Date().toISOString(),
    resultCount: result.artifacts.length,
    sessionIds: result.artifacts.flatMap((artifact) => []),
    status: "succeeded",
    toolName: "search_artifacts"
  });
  return result;
}

export function getArtifactTool(db: MastheadDatabase, args: { artifactId: string }) {
  const artifact = getLogbookArtifactDetail(db, args.artifactId);
  logMcpQuery(db, {
    requestedAt: new Date().toISOString(),
    resultCount: artifact ? 1 : 0,
    sessionIds: artifact?.provenanceSessionIds ?? [],
    status: "succeeded",
    toolName: "get_artifact"
  });
  return { artifact };
}

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

export function getSessionTranscriptTool(
  db: MastheadDatabase,
  args: { sessionId: string; limit?: number; maxBytes?: number; role?: "user" | "assistant" | "tool" | "all" }
) {
  const maxBytes = clampMaxBytes(args.maxBytes);
  if (!sessionMcpAllowed(db, args.sessionId)) {
    const result = { coverage: undefined, items: [], nextCursor: undefined, sessionId: args.sessionId, sourceRefs: [], total: 0 };
    logMcpQuery(db, {
      boundedBytes: maxBytes,
      requestedAt: new Date().toISOString(),
      resultCount: 0,
      sessionIds: [args.sessionId],
      status: "succeeded",
      toolName: "get_session_transcript"
    });
    return result;
  }
  const transcript = getSessionTranscript(db, {
    kind: transcriptKind(args.role),
    limit: args.limit,
    sessionId: args.sessionId
  });
  const items = transcript.items.map((item) => boundTranscriptItem(item, maxBytes));
  logMcpQuery(db, {
    boundedBytes: maxBytes,
    requestedAt: new Date().toISOString(),
    resultCount: items.length,
    sessionIds: [args.sessionId],
    status: "succeeded",
    toolName: "get_session_transcript"
  });
  return {
    coverage: transcript.coverage,
    items,
    nextCursor: transcript.nextCursor,
    sessionId: args.sessionId,
    sourceRefs: items.map((item) => item.sourceRef),
    total: transcript.total
  };
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

function transcriptKind(role: "user" | "assistant" | "tool" | "all" | undefined) {
  if (role === "user" || role === "assistant") return role;
  if (role === "tool") return "tools";
  return "all";
}

function boundTranscriptItem(item: SessionTranscriptItem, maxBytes: number): SessionTranscriptItem {
  return {
    ...item,
    ...(item.narrativeText === undefined ? {} : { narrativeText: boundText(item.narrativeText, maxBytes) }),
    text: boundText(item.text, maxBytes)
  };
}

function boundText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let output = "";
  for (const char of text) {
    if (Buffer.byteLength(`${output}${char}`, "utf8") > maxBytes) break;
    output += char;
  }
  return output;
}

function clampMaxBytes(maxBytes: number | undefined): number {
  if (!Number.isInteger(maxBytes)) return 8_000;
  return Math.max(1, Math.min(maxBytes as number, 16_000));
}
