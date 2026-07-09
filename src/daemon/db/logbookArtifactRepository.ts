import type { MastheadDatabase } from "./sqlite.ts";
import {
  getSessionArtifact,
  searchPublishedArtifactCapsules,
  type ArtifactCapsule,
  type SessionArtifactKind,
  type SessionArtifactRecord
} from "./sessionArtifactRepository.ts";

export type LogbookArtifactSearchQuery = {
  q?: string;
  kind?: SessionArtifactKind;
  project?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
};

export type LogbookArtifactDetailDto = {
  capsule: ArtifactCapsule;
  body: unknown;
  provenanceSessionIds: string[];
  joinRationale?: string;
  evidenceRefs: string[];
  confidence?: string;
  signatureKey?: string;
  lineageId: string;
  status: string;
  publicationStatus: string;
  schemaVersion: string;
  contentFingerprint: string;
  createdAt: string;
  updatedAt: string;
};

export type LogbookArtifactSummaryDto = {
  artifacts: number;
  byKind: Array<{ kind: string; count: number }>;
  projects: number;
  earliestPublishedAt?: string;
  latestPublishedAt?: string;
};

export function searchLogbookArtifacts(
  db: MastheadDatabase,
  query: LogbookArtifactSearchQuery = {}
): { artifacts: ArtifactCapsule[]; total: number } {
  return searchPublishedArtifactCapsules(db, query);
}

export function getLogbookArtifactDetail(db: MastheadDatabase, artifactId: string): LogbookArtifactDetailDto | undefined {
  const record = getSessionArtifact(db, artifactId);
  if (!record || record.publicationStatus !== "published" || record.status !== "current") return undefined;
  return toDetail(record);
}

export function getLogbookArtifactSummary(db: MastheadDatabase): LogbookArtifactSummaryDto {
  const totals = db
    .prepare(
      `SELECT
        COUNT(*) AS artifacts,
        COUNT(DISTINCT CASE WHEN project_label IS NOT NULL AND trim(project_label) <> '' THEN project_label END) AS projects,
        MIN(published_at) AS earliestPublishedAt,
        MAX(published_at) AS latestPublishedAt
      FROM session_artifacts
      WHERE publication_status = 'published'
        AND status = 'current'`
    )
    .get() as {
    artifacts: number;
    projects: number;
    earliestPublishedAt: string | null;
    latestPublishedAt: string | null;
  };

  const byKind = db
    .prepare(
      `SELECT artifact_kind AS kind, COUNT(*) AS count
       FROM session_artifacts
       WHERE publication_status = 'published' AND status = 'current'
       GROUP BY artifact_kind
       ORDER BY lower(artifact_kind)`
    )
    .all() as Array<{ kind: string; count: number }>;

  return {
    artifacts: totals.artifacts,
    byKind,
    earliestPublishedAt: totals.earliestPublishedAt ?? undefined,
    latestPublishedAt: totals.latestPublishedAt ?? undefined,
    projects: totals.projects
  };
}

function toDetail(record: SessionArtifactRecord): LogbookArtifactDetailDto {
  return {
    body: record.content,
    capsule: {
      artifactId: record.artifactId,
      confidence: record.confidence,
      highlight: record.highlight,
      kind: record.artifactKind,
      project: record.projectLabel,
      provenanceLabel:
        record.provenanceSessionIds.length === 1
          ? "1 session"
          : `${record.provenanceSessionIds.length} sessions`,
      provenanceSize: record.provenanceSessionIds.length,
      publishedAt: record.publishedAt,
      signatureKey: record.signatureKey,
      status: record.status,
      summary: record.summary ?? record.title ?? "",
      title: record.title ?? "Untitled artifact"
    },
    confidence: record.confidence,
    contentFingerprint: record.contentFingerprint,
    createdAt: record.createdAt,
    evidenceRefs: record.evidenceRefs,
    joinRationale: record.joinRationale,
    lineageId: record.lineageId,
    provenanceSessionIds: record.provenanceSessionIds,
    publicationStatus: record.publicationStatus,
    schemaVersion: record.schemaVersion,
    signatureKey: record.signatureKey,
    status: record.status,
    updatedAt: record.updatedAt
  };
}
