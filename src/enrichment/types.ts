import type { EvidenceRef } from "../core/types";

export type DerivedClaim = {
  text: string;
  support: "derived";
  evidence: EvidenceRef[];
};

export type SessionTitleSource = "session_title" | "objective" | "message" | "project" | "fallback";

export type SessionCapsule = {
  title: string;
  titleSource?: SessionTitleSource;
  objective?: string;
  liveSummary?: string;
  outcome?: string;
  topics: string[];
  technologies: string[];
  candidateDecisions: DerivedClaim[];
  unresolved: DerivedClaim[];
  searchPhrases: string[];
};

export type SessionEnrichmentKind = "live_summary" | "session_capsule" | "search_projection";
export type SessionEnrichmentStatus = "current" | "stale" | "failed" | "disabled";

export type SessionEnrichmentRecord = {
  enrichmentId: string;
  sessionId: string;
  enrichmentKind: SessionEnrichmentKind;
  status: SessionEnrichmentStatus;
  contentFingerprint: string;
  promptVersion: string;
  provider?: string;
  model?: string;
  generatedAt?: string;
  content?: SessionCapsule | { text: string } | { searchText: string };
  sourceRefs: EvidenceRef[];
  failureCode?: string;
  failureMessage?: string;
};
