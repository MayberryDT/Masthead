import type { SessionArtifactKind } from "../daemon/db/sessionArtifactRepository.ts";

export type KnowledgeKind = SessionArtifactKind;

export type KnowledgeSearchArgs = {
  query?: string;
  kind?: KnowledgeKind;
  project?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
};

export type KnowledgeListItem = {
  artifactId: string;
  kind: KnowledgeKind;
  title: string;
  summary: string;
  highlight?: string;
  project?: string;
  confidence?: string;
  status: string;
  publishedAt?: string;
  provenanceSize: number;
  provenanceLabel: string;
  signatureKey?: string;
};

export type KnowledgeProvenance = {
  sessionIds: string[];
  joinRationale?: string;
  provenanceLabel: string;
  provenanceSize: number;
};

export type KnowledgeArtifact = {
  artifactId: string;
  kind: KnowledgeKind;
  title: string;
  summary: string;
  status: string;
  publicationStatus: string;
  publishedAt?: string;
  lineageId: string;
  contentFingerprint: string;
  schemaVersion: string;
  confidence?: string;
  signatureKey?: string;
  project?: string;
  highlight?: string;
  body: unknown;
  capsule: KnowledgeListItem;
  evidenceRefs: string[];
  provenance: KnowledgeProvenance;
  /** @deprecated Prefer provenance.sessionIds; kept for v1 clients. */
  provenanceSessionIds: string[];
  createdAt: string;
  updatedAt: string;
  notice: string;
};

export type KnowledgeSearchResult = {
  ok: true;
  artifacts: KnowledgeListItem[];
  total: number;
};

export type KnowledgeDetailResult = {
  ok: true;
  artifact: KnowledgeArtifact | null;
};

export type ProvenanceResult = {
  ok: true;
  artifactId: string;
  kind: KnowledgeKind;
  title: string;
  provenance: KnowledgeProvenance;
};

export type CorpusStats = {
  ok: true;
  publishedArtifacts: number;
  byKind: Array<{ kind: string; count: number }>;
  projects: number;
  earliestPublishedAt?: string;
  latestPublishedAt?: string;
  sessions?: number;
  messages?: number;
  toolCalls?: number;
  fileEffects?: number;
};

export const KNOWLEDGE_NOTICE =
  "Published Logbook knowledge. Verify claims against provenance evidence tools before reuse.";
