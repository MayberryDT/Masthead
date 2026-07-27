/**
 * Artifact-first agent access API.
 * Pure handlers over Logbook published artifacts + evidence.
 * MCP and HTTP catalogs should call this module rather than inventing a second model.
 */
export { getCorpusStats } from "./corpusStats.ts";
export { getEvidenceExcerpt, getEvidenceTranscript, type EvidenceArgs, type EvidenceRole } from "./evidence.ts";
export { getKnowledge, listKnowledge, searchKnowledge } from "./knowledge.ts";
export { getProvenance, sessionInArtifactProvenance } from "./provenance.ts";
export type {
  CorpusStats,
  KnowledgeArtifact,
  KnowledgeDetailResult,
  KnowledgeKind,
  KnowledgeListItem,
  KnowledgeSearchArgs,
  KnowledgeSearchResult,
  KnowledgeProvenance,
  ProvenanceResult
} from "./types.ts";
export { KNOWLEDGE_NOTICE } from "./types.ts";
