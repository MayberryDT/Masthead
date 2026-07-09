import type { KnowledgeFlowSummaryDto } from "../../shared/knowledgeFlow.ts";
import type { MastheadDatabase } from "./sqlite.ts";

type KnowledgeFlowSummaryRow = {
  capturedSessions: number;
  workbenchSessions: number;
  publishedArtifacts: number;
  automaticallyResolvedSessions: number;
};

export function getKnowledgeFlowSummary(db: MastheadDatabase): KnowledgeFlowSummaryDto {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sessions WHERE deleted_at IS NULL) AS capturedSessions,
      (SELECT COUNT(*)
       FROM workbench_session_state
       JOIN sessions ON sessions.session_id = workbench_session_state.session_id
       WHERE workbench_session_state.publication_status = 'publish_path'
         AND sessions.deleted_at IS NULL) AS workbenchSessions,
      (SELECT COUNT(*)
       FROM session_artifacts
       WHERE publication_status = 'published' AND status = 'current') AS publishedArtifacts,
      (SELECT COUNT(*)
       FROM workbench_session_state
       JOIN sessions ON sessions.session_id = workbench_session_state.session_id
       WHERE workbench_session_state.resolution_status = 'automatic_resolved'
         AND sessions.deleted_at IS NULL) AS automaticallyResolvedSessions
  `).get() as KnowledgeFlowSummaryRow;

  return {
    capturedSessions: Number(row.capturedSessions),
    workbenchSessions: Number(row.workbenchSessions),
    publishedArtifacts: Number(row.publishedArtifacts),
    automaticallyResolvedSessions: Number(row.automaticallyResolvedSessions)
  };
}
