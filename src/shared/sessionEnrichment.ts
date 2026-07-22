import type { EvidenceRef } from "../core/types";

export type SessionEnrichmentVersion = "session-capsule-v4";

export type SessionTitleBasis =
  | "first_prompt"
  | "dominant_work"
  | "final_outcome"
  | "file_cluster"
  | "debug_target"
  | "fallback";

export type EnrichmentConfidence = "high" | "medium" | "low";

export type SessionSummaryState = "completed" | "blocked" | "partial" | "failed" | "paused" | "unknown";

export type DurableVerificationStatus = "passed" | "failed" | "mixed" | "missing" | "unknown";

export type SessionTitleEnrichment = {
  text: string;
  basis: SessionTitleBasis;
  confidence: EnrichmentConfidence;
  evidenceRefs: EvidenceRef[];
};

export type SessionSummaryEnrichment = {
  text: string;
  state: SessionSummaryState;
  confidence: EnrichmentConfidence;
  evidenceRefs: EvidenceRef[];
};

export type SessionDossierEnrichment = {
  purpose?: string;
  outcome?: string;
  keyWork: string[];
  decisions: string[];
  blockers: string[];
  verification: {
    status: DurableVerificationStatus;
    summary: string;
    commands: string[];
    failures: string[];
    evidenceRefs: EvidenceRef[];
  };
  continuation: {
    nextStep?: string;
    openQuestions: string[];
    constraints: string[];
  };
  evidenceRefs: EvidenceRef[];
  warnings: string[];
};

export type DurableSessionEnrichment = {
  version: SessionEnrichmentVersion;
  keywords: string[];
  sessionTitle: SessionTitleEnrichment;
  sessionSummary: SessionSummaryEnrichment;
  sessionDossier: SessionDossierEnrichment;
  generatedAt?: string;
  source?: "remote_model" | "deterministic" | "manual";
  promptVersion?: string;
  model?: string;
};

export function readableSessionEnrichmentKeywords(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((keyword): keyword is string => typeof keyword === "string")
    : [];
}

/** Keeps pre-keyword V4 capsules readable without inventing retrieval terms. */
export function normalizeDurableSessionEnrichment(
  enrichment: DurableSessionEnrichment
): DurableSessionEnrichment {
  const keywords = (enrichment as DurableSessionEnrichment & { keywords?: unknown }).keywords;
  return {
    ...enrichment,
    keywords: readableSessionEnrichmentKeywords(keywords)
  };
}
