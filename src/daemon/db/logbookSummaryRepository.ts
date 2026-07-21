import type { MastheadDatabase } from "./sqlite.ts";

export type LogbookSummaryDto = {
  artifacts: number;
  byKind: Record<"session_dossier" | "runbook" | "adr" | "incident_timeline", number>;
  projects: number;
  earliestPublishedAt?: string;
  latestPublishedAt?: string;
};

export const LOGBOOK_ARTIFACT_SUMMARY_SQL = `SELECT
  COUNT(*) AS artifacts,
  COALESCE(SUM(CASE WHEN artifact_kind = 'session_dossier' THEN 1 ELSE 0 END), 0) AS sessionDossiers,
  COALESCE(SUM(CASE WHEN artifact_kind = 'runbook' THEN 1 ELSE 0 END), 0) AS runbooks,
  COALESCE(SUM(CASE WHEN artifact_kind = 'adr' THEN 1 ELSE 0 END), 0) AS adrs,
  COALESCE(SUM(CASE WHEN artifact_kind = 'incident_timeline' THEN 1 ELSE 0 END), 0) AS incidentTimelines,
  COUNT(DISTINCT CASE WHEN project_label IS NOT NULL AND trim(project_label) <> '' THEN project_label END) AS projects,
  MIN(published_at) AS earliestPublishedAt,
  MAX(published_at) AS latestPublishedAt
FROM session_artifacts
WHERE status = 'current'
  AND publication_status = 'published'`;

type ArtifactSummaryRow = {
  artifacts: number;
  sessionDossiers: number;
  runbooks: number;
  adrs: number;
  incidentTimelines: number;
  projects: number;
  earliestPublishedAt: string | null;
  latestPublishedAt: string | null;
};

export function getLogbookSummary(db: MastheadDatabase): LogbookSummaryDto {
  const row = db.prepare(LOGBOOK_ARTIFACT_SUMMARY_SQL).get() as ArtifactSummaryRow;
  return {
    artifacts: row.artifacts,
    byKind: {
      session_dossier: row.sessionDossiers,
      runbook: row.runbooks,
      adr: row.adrs,
      incident_timeline: row.incidentTimelines
    },
    projects: row.projects,
    earliestPublishedAt: row.earliestPublishedAt ?? undefined,
    latestPublishedAt: row.latestPublishedAt ?? undefined
  };
}
