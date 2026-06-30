import type { EvidenceRef } from "../core/types";

export type DerivedClaim = {
  text: string;
  support: "derived";
  evidence: EvidenceRef[];
};

export type SessionTitleSource = "user" | "llm" | "deterministic" | "session_title" | "objective" | "message" | "project" | "fallback";
export type NarrativeConfidence = "high" | "medium" | "low";

export type SessionNarrativeSubject = {
  label: string;
  source:
    | "objective"
    | "first_user_prompt"
    | "final_assistant_message"
    | "checkpoint"
    | "latest_feedback"
    | "stored_title"
    | "file_cluster"
    | "branch"
    | "project"
    | "fallback";
  confidence: NarrativeConfidence;
};

export type SessionCapsule = {
  title: string;
  titleSource?: SessionTitleSource;
  confidence?: "high" | "medium" | "low";
  missingEvidence?: string[];
  providerStatus?: string;
  subject?: SessionNarrativeSubject;
  action?: string;
  object?: string;
  objective?: string;
  liveSummary?: string;
  outcome?: string;
  searchSummary?: string;
  topics: string[];
  technologies: string[];
  filesChangedSummary?: string;
  commandsSummary?: string;
  verificationSummary?: string;
  candidateDecisions: DerivedClaim[];
  unresolved: DerivedClaim[];
  searchPhrases: string[];
  validationWarnings?: string[];
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
