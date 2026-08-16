import { checkSessionDossierEligibility } from "../../mastheadPages/eligibility.ts";
import type { PublishedSessionDossierV1 } from "../../shared/sessionDossier.ts";
import type { MastheadDatabase } from "./sqlite.ts";
import {
  buildMastheadPagesSelectionSql,
  capMastheadPagesSelectionLimit,
  mastheadPagesLegacyCandidateWindowSize
} from "./mastheadPagesEligibilityRepository.ts";
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

/**
 * Resolve at most `limit` current eligible session_dossier artifact IDs for Masthead Pages
 * selection, in deterministic published_at/updated_at/id order, without paging 100-row searches.
 */
export function listEligibleMastheadPagesArtifactIds(
  db: MastheadDatabase,
  query: LogbookArtifactSearchQuery = {},
  limit = 500
): string[] {
  const capped = capMastheadPagesSelectionLimit(limit);
  const sql = buildMastheadPagesSelectionSql(query);

  // Single oversampled read, then filter eligibility in-process (enrichment / provenance).
  const rows = db
    .prepare(
      `SELECT session_artifacts.artifact_id AS artifactId
       ${sql.from}
       WHERE ${sql.predicates.join(" AND ")}
       ORDER BY ${sql.ordering}
       LIMIT ?`
    )
    .all(...sql.params, mastheadPagesLegacyCandidateWindowSize(capped)) as Array<{ artifactId: string }>;

  const ids: string[] = [];
  for (const row of rows) {
    if (ids.length >= capped) break;
    if (isEligibleMastheadPagesArtifact(db, row.artifactId)) {
      ids.push(row.artifactId);
    }
  }
  return ids;
}


function isEligibleMastheadPagesArtifact(db: MastheadDatabase, artifactId: string): boolean {
  const detail = getLogbookArtifactDetail(db, artifactId);
  if (!detail) return false;
  if (typeof detail.body !== "object" || detail.body === null) return false;
  const result = checkSessionDossierEligibility({
    artifactKind: detail.capsule.kind,
    status: detail.status,
    publicationStatus: detail.publicationStatus,
    schemaVersion: detail.schemaVersion,
    content: detail.body as PublishedSessionDossierV1,
    provenanceSessionIds: detail.provenanceSessionIds
  });
  return result.eligible;
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
