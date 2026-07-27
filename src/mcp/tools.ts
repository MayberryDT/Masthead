import {
  getCorpusStats,
  getEvidenceExcerpt,
  getEvidenceTranscript,
  getKnowledge,
  getProvenance,
  listKnowledge,
  searchKnowledge,
  type EvidenceRole,
  type KnowledgeKind,
  type KnowledgeSearchArgs
} from "../agentAccess/index.ts";
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

export type SearchKnowledgeArgs = KnowledgeSearchArgs;

/** Artifact-first primary search. */
export function searchKnowledgeTool(db: MastheadDatabase, args: SearchKnowledgeArgs) {
  const result = searchKnowledge(db, args);
  logMcpQuery(db, {
    requestedAt: new Date().toISOString(),
    resultCount: result.artifacts.length,
    sessionIds: [],
    status: "succeeded",
    toolName: "search_knowledge"
  });
  return result;
}

export function listKnowledgeTool(db: MastheadDatabase, args: Omit<SearchKnowledgeArgs, "query"> = {}) {
  const result = listKnowledge(db, args);
  logMcpQuery(db, {
    requestedAt: new Date().toISOString(),
    resultCount: result.artifacts.length,
    sessionIds: [],
    status: "succeeded",
    toolName: "list_knowledge"
  });
  return result;
}

export function getKnowledgeTool(db: MastheadDatabase, args: { artifactId: string }) {
  const result = getKnowledge(db, args.artifactId);
  logMcpQuery(db, {
    requestedAt: new Date().toISOString(),
    resultCount: result.artifact ? 1 : 0,
    sessionIds: result.artifact?.provenanceSessionIds ?? [],
    status: "succeeded",
    toolName: "get_knowledge"
  });
  return result;
}

export function getProvenanceTool(db: MastheadDatabase, args: { artifactId: string }) {
  const result = getProvenance(db, args.artifactId);
  const sessionIds = "provenance" in result ? result.provenance.sessionIds : [];
  logMcpQuery(db, {
    requestedAt: new Date().toISOString(),
    resultCount: sessionIds.length,
    sessionIds,
    status: "succeeded",
    toolName: "get_provenance"
  });
  return result;
}

export function getEvidenceExcerptTool(
  db: MastheadDatabase,
  args: { sessionId: string; artifactId?: string; query?: string; limit?: number; maxBytes?: number }
) {
  const result = getEvidenceExcerpt(db, args);
  logMcpQuery(db, {
    boundedBytes: result.maxBytes,
    requestedAt: new Date().toISOString(),
    resultCount: result.excerpts?.length ?? 0,
    sessionIds: [args.sessionId],
    status: "succeeded",
    toolName: "get_evidence_excerpt"
  });
  return result;
}

export function getEvidenceTranscriptTool(
  db: MastheadDatabase,
  args: { sessionId: string; artifactId?: string; limit?: number; maxBytes?: number; role?: EvidenceRole }
) {
  const result = getEvidenceTranscript(db, args);
  logMcpQuery(db, {
    boundedBytes: result.maxBytes,
    requestedAt: new Date().toISOString(),
    resultCount: result.items.length,
    sessionIds: [args.sessionId],
    status: "succeeded",
    toolName: "get_evidence_transcript"
  });
  return result;
}

export function getCorpusStatsTool(db: MastheadDatabase) {
  const result = getCorpusStats(db);
  logMcpQuery(db, {
    requestedAt: new Date().toISOString(),
    resultCount: result.publishedArtifacts,
    sessionIds: [],
    status: "succeeded",
    toolName: "get_corpus_stats"
  });
  return result;
}

/** @deprecated v1 alias — prefer search_knowledge */
export function searchArtifactsTool(
  db: MastheadDatabase,
  args: { query?: string; kind?: KnowledgeKind; project?: string; limit?: number; offset?: number }
) {
  const result = searchKnowledge(db, args);
  logMcpQuery(db, {
    requestedAt: new Date().toISOString(),
    resultCount: result.artifacts.length,
    sessionIds: [],
    status: "succeeded",
    toolName: "search_artifacts"
  });
  // v1 shape without ok flag for older clients that only read artifacts/total
  return { artifacts: result.artifacts, total: result.total };
}

/** @deprecated v1 alias — prefer get_knowledge; detail now includes artifactId */
export function getArtifactTool(db: MastheadDatabase, args: { artifactId: string }) {
  const result = getKnowledge(db, args.artifactId);
  logMcpQuery(db, {
    requestedAt: new Date().toISOString(),
    resultCount: result.artifact ? 1 : 0,
    sessionIds: result.artifact?.provenanceSessionIds ?? [],
    status: "succeeded",
    toolName: "get_artifact"
  });
  return { artifact: result.artifact };
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
  const result = getEvidenceTranscript(db, {
    limit: args.limit,
    maxBytes: args.maxBytes,
    role: args.role,
    sessionId: args.sessionId
  });
  logMcpQuery(db, {
    boundedBytes: result.maxBytes,
    requestedAt: new Date().toISOString(),
    resultCount: result.items.length,
    sessionIds: [args.sessionId],
    status: "succeeded",
    toolName: "get_session_transcript"
  });
  // preserve v1 shape
  return {
    coverage: result.coverage,
    items: result.items,
    nextCursor: result.nextCursor,
    sessionId: result.sessionId,
    sourceRefs: result.sourceRefs,
    total: result.total
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
