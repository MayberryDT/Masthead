import {
  getLogbookArtifactDetail,
  searchLogbookArtifacts,
  type LogbookArtifactDetailDto
} from "../daemon/db/logbookArtifactRepository.ts";
import type { ArtifactCapsule } from "../daemon/db/sessionArtifactRepository.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import {
  KNOWLEDGE_NOTICE,
  type KnowledgeArtifact,
  type KnowledgeDetailResult,
  type KnowledgeListItem,
  type KnowledgeSearchArgs,
  type KnowledgeSearchResult
} from "./types.ts";

export function searchKnowledge(db: MastheadDatabase, args: KnowledgeSearchArgs = {}): KnowledgeSearchResult {
  const result = searchLogbookArtifacts(db, {
    dateFrom: args.dateFrom,
    dateTo: args.dateTo,
    kind: args.kind,
    limit: args.limit ?? 10,
    offset: args.offset ?? 0,
    project: args.project,
    q: args.query
  });
  return {
    artifacts: result.artifacts.map(toListItem),
    ok: true,
    total: result.total
  };
}

/** Browse published knowledge without a text query (same store as search). */
export function listKnowledge(
  db: MastheadDatabase,
  args: Omit<KnowledgeSearchArgs, "query"> = {}
): KnowledgeSearchResult {
  return searchKnowledge(db, { ...args, query: undefined });
}

export function getKnowledge(db: MastheadDatabase, artifactId: string): KnowledgeDetailResult {
  const detail = getLogbookArtifactDetail(db, artifactId);
  if (!detail) return { artifact: null, ok: true };
  return { artifact: toKnowledgeArtifact(detail), ok: true };
}

function toListItem(capsule: ArtifactCapsule): KnowledgeListItem {
  return {
    artifactId: capsule.artifactId,
    confidence: capsule.confidence,
    highlight: capsule.highlight,
    kind: capsule.kind,
    project: capsule.project,
    provenanceLabel: capsule.provenanceLabel,
    provenanceSize: capsule.provenanceSize,
    publishedAt: capsule.publishedAt,
    signatureKey: capsule.signatureKey,
    status: capsule.status,
    summary: capsule.summary,
    title: capsule.title
  };
}

function toKnowledgeArtifact(detail: LogbookArtifactDetailDto): KnowledgeArtifact {
  const capsule = toListItem(detail.capsule);
  const sessionIds = [...detail.provenanceSessionIds];
  return {
    artifactId: capsule.artifactId,
    body: detail.body,
    capsule,
    confidence: detail.confidence,
    contentFingerprint: detail.contentFingerprint,
    createdAt: detail.createdAt,
    evidenceRefs: [...detail.evidenceRefs],
    highlight: capsule.highlight,
    kind: capsule.kind,
    lineageId: detail.lineageId,
    notice: KNOWLEDGE_NOTICE,
    project: capsule.project,
    provenance: {
      joinRationale: detail.joinRationale,
      provenanceLabel: capsule.provenanceLabel,
      provenanceSize: capsule.provenanceSize,
      sessionIds
    },
    provenanceSessionIds: sessionIds,
    publicationStatus: detail.publicationStatus,
    publishedAt: capsule.publishedAt,
    schemaVersion: detail.schemaVersion,
    signatureKey: detail.signatureKey,
    status: detail.status,
    summary: capsule.summary,
    title: capsule.title,
    updatedAt: detail.updatedAt
  };
}
