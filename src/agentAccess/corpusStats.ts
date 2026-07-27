import { getLogbookArtifactSummary } from "../daemon/db/logbookArtifactRepository.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import { coverage } from "../mcp/sessionRetrieval.ts";
import type { CorpusStats } from "./types.ts";

export function getCorpusStats(db: MastheadDatabase, options: { includeSessionCoverage?: boolean } = {}): CorpusStats {
  const summary = getLogbookArtifactSummary(db);
  const stats: CorpusStats = {
    byKind: summary.byKind,
    earliestPublishedAt: summary.earliestPublishedAt,
    latestPublishedAt: summary.latestPublishedAt,
    ok: true,
    projects: summary.projects,
    publishedArtifacts: summary.artifacts
  };
  if (options.includeSessionCoverage !== false) {
    const sessionCoverage = coverage(db);
    stats.fileEffects = sessionCoverage.fileEffects;
    stats.messages = sessionCoverage.messages;
    stats.sessions = sessionCoverage.sessions;
    stats.toolCalls = sessionCoverage.toolCalls;
  }
  return stats;
}
