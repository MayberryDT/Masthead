import type { EvidenceRef } from "../core/types";
import type { DurableSessionEnrichment } from "./sessionEnrichment";
import type { SessionTranscriptCoverage } from "./sessionTranscript";

export type DossierSourceConfidence = "authoritative" | "inferred" | "heuristic";

export type SessionDossierIdentity = {
  sessionId: string;
  sourceSessionId: string;
  project?: string;
  title: string;
  runtime: string;
  model?: string;
  models: string[];
  hostId: string;
  branch?: string;
  repoRoot?: string;
  worktreePath?: string;
  lifecycle: string;
  outcome?: string;
  startedAt?: string;
  endedAt?: string;
  lastActivityAt: string;
  durationMs?: number;
  sourceConfidence: DossierSourceConfidence;
};

export type SessionDossierNarrative = {
  objective?: string;
  firstUserPrompt?: string;
  latestUserPrompt?: string;
  finalAssistantMessage?: string;
  liveSummary?: string;
  outcome?: string;
  topics: string[];
  technologies: string[];
  unresolved: string[];
  narrativeDebug?: {
    titleSource?: string;
    subjectSource?: string;
    subjectConfidence?: string;
    provider?: string;
    model?: string;
    promptVersion?: string;
    providerStatus?: string;
    confidence?: "high" | "medium" | "low";
    missingEvidence?: string[];
    failureCode?: string;
    failureMessage?: string;
    latestFailedAttemptAt?: string;
    validationWarnings?: string[];
    sourceRefs: EvidenceRef[];
  };
};

export type SessionDossierFile = {
  fileEffectId: string;
  path: string;
  displayPath: string;
  basename: string;
  directory?: string;
  effectKind: string;
  staged: boolean;
  additions?: number;
  deletions?: number;
  observedAt: string;
  sourceRef: unknown;
};

export type SessionDossierTool = {
  toolCallId: string;
  toolName: string;
  category?: string;
  status?: string;
  exitCode?: number;
  startedAt?: string;
  completedAt?: string;
  outputPreview?: string;
  sourceRef: unknown;
};

export type SessionDossierVerification = {
  status: "passed" | "failed" | "mixed" | "missing" | "unknown";
  summary: string;
  commands: SessionDossierTool[];
};

export type SessionDossierAttention = {
  kind:
    | "approval"
    | "user_question"
    | "command_failure"
    | "conflict"
    | "missing_verification"
    | "high_risk_change"
    | "stalled"
    | "blocked";
  severity: "P0" | "P1" | "P2" | "P3";
  title: string;
  detail?: string;
  observedAt?: string;
  sourceRefs: EvidenceRef[];
};

export type SessionDossierExcerpt = {
  excerptId: string;
  kind: "message" | "tool" | "checkpoint" | "runtime_signal";
  role?: string;
  text: string;
  observedAt: string;
  sourceRef: unknown;
};

export type SessionDossierTimelineEvent = {
  eventId: string;
  kind: "session" | "user" | "assistant" | "tool" | "file" | "checkpoint" | "runtime_signal" | "attention";
  label: string;
  summary: string;
  observedAt: string;
  sourceRef?: unknown;
};

export type SessionDossierReuse = {
  mcpIncluded: boolean;
  sourceRuntime: string;
  sourceSessionId: string;
  sourceConfidence: DossierSourceConfidence;
  canonicalSessionId: string;
  copyableContext: string;
};

export type SessionDossierUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageRows: number;
};

export type SessionDossierCoverageLevel = "complete" | "partial" | "hook_only" | "metadata_only";

export type SessionDossierCoverageWarning = {
  code:
    | "transcript_missing"
    | "file_effects_missing"
    | "tool_details_partial"
    | "tokens_missing"
    | "verification_missing"
    | "low_value_hook_summaries";
  message: string;
  action?: {
    label: string;
    target: "sources" | "logbook" | "settings";
  };
};

export type SessionDossierCoverage = {
  level: SessionDossierCoverageLevel;
  warnings: SessionDossierCoverageWarning[];
  transcript: SessionTranscriptCoverage;
};

export type SessionDossierEnrichmentState = {
  status: "current" | "not_enriched" | "failed" | "enriching";
  generatedAt?: string;
  provider?: string;
  model?: string;
  failureCode?: string;
  failureMessage?: string;
};

export type SessionDossierManualEnrichmentJob = Omit<SessionDossierEnrichmentState, "status"> & {
  status: "enriching" | "current" | "failed";
  requestedAt: string;
  completedAt?: string;
};

export type SessionDossierDto = {
  identity: SessionDossierIdentity;
  enrichment: SessionDossierEnrichmentState;
  durableEnrichment?: DurableSessionEnrichment;
  coverage: SessionDossierCoverage;
  narrative: SessionDossierNarrative;
  files: SessionDossierFile[];
  tools: SessionDossierTool[];
  verification: SessionDossierVerification;
  attention: SessionDossierAttention[];
  excerpts: SessionDossierExcerpt[];
  timeline: SessionDossierTimelineEvent[];
  reuse: SessionDossierReuse;
  usage: SessionDossierUsage;
};
