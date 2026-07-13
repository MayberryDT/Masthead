import type { SessionArtifactRecord } from "../daemon/db/sessionArtifactRepository.ts";
import type { SessionTranscriptItem } from "../shared/sessionTranscript.ts";
import type {
  WorkbenchAuthoringBundle,
  WorkbenchAuthoringFinding,
  WorkbenchClaimEvidence,
  WorkbenchClaimSupport
} from "../shared/workbenchAuthoring.ts";

export type WorkbenchOutputKind =
  | "session_enrichment"
  | "session_dossier"
  | "runbook"
  | "adr"
  | "incident_timeline";

export type WorkbenchArtifactKind = Exclude<WorkbenchOutputKind, "session_enrichment">;

export type WorkbenchConfidence = "high" | "medium" | "low";

export type SessionEnrichmentOutput = {
  title: string;
  summary: string;
  outcome?: string;
  topics: string[];
  technologies: string[];
  filesSummary?: string;
  toolsSummary?: string;
  verificationSummary?: string;
  searchPhrases: string[];
  confidence: WorkbenchConfidence;
  missingEvidence: string[];
  evidenceRefs: string[];
};

export type WorkbenchGroundedOutput = {
  title: string;
  confidence: WorkbenchConfidence;
  evidenceRefs: string[];
  claimEvidence: WorkbenchClaimEvidence[];
  missingEvidence: string[];
};

export type SessionEnrichmentOutputV2 = SessionEnrichmentOutput & WorkbenchGroundedOutput;

export type WorkbenchAuthoringOutputV2 = Record<string, unknown> &
  Omit<WorkbenchGroundedOutput, "claimEvidence"> & {
    claimSupport: WorkbenchClaimSupport[];
  };

export type WorkbenchValidationEvidence = {
  sessionId: string;
  kind: SessionTranscriptItem["kind"];
  role: SessionTranscriptItem["role"];
  text: string;
  observedAt: string;
  label?: string;
  toolName?: string;
  status?: string;
  exitCode?: number;
  lowValue: boolean;
};

export type WorkbenchAuthoringValidationInput = {
  bundle: WorkbenchAuthoringBundle;
  selectedSessionIds: string[];
  evidenceByRef: Map<string, WorkbenchValidationEvidence>;
  coverageWarningsBySession: Map<string, string[]>;
  publishedArtifacts: SessionArtifactRecord[];
};

export type WorkbenchAuthoringFindingCode =
  | "blank_artifact_signature"
  | "claim_evidence_outside_declared_evidence"
  | "duplicate_automatic_kind_resolution"
  | "duplicate_artifact_signature"
  | "duplicate_provenance_session"
  | "duplicate_session_package"
  | "duplicate_title_summary"
  | "empty_claim_array"
  | "evidence_outside_declared_evidence"
  | "evidence_outside_provenance"
  | "generic_title"
  | "high_confidence_with_sparse_coverage"
  | "high_confidence_without_support"
  | "insufficient_specificity"
  | "invalid_bundle"
  | "invalid_claim_path"
  | "invalid_contribution"
  | "invalid_type"
  | "mismatched_output_provenance"
  | "missing_claim_evidence"
  | "missing_join_rationale"
  | "missing_passed_verification"
  | "missing_required"
  | "missing_session_package"
  | "missing_sparse_evidence_note"
  | "missing_claim_support"
  | "missing_required_support_kind"
  | "missing_root_cause_support"
  | "not_applicable_without_evidence"
  | "provenance_session_not_selected"
  | "seed_missing_from_provenance"
  | "secret_detected"
  | "sparse_evidence_coverage"
  | "unexpected_automatic_resolution"
  | "unexpected_property"
  | "unexpected_session_package"
  | "unknown_evidence_ref"
  | "unsupported_authoring_protocol_language"
  | "unsupported_claim_excerpt"
  | "invalid_support_kind_evidence"
  | "invalid_timeline_order"
  | "invalid_timeline_support"
  | "duplicate_human_content"
  | "unresolved_automatic_kind"
  | "weak_join"
  | "weak_not_applicable_reason";

export type WorkbenchAuthoringFindingV2 = Omit<WorkbenchAuthoringFinding, "code"> & {
  code: WorkbenchAuthoringFindingCode;
};

export type WorkbenchAuthoringValidationResult = {
  ok: boolean;
  findings: WorkbenchAuthoringFindingV2[];
};

export type WorkbenchEvidencePacket = {
  packetVersion: "workbench-evidence-v1" | "workbench-evidence-multi-v1";
  session: {
    sessionId: string;
    sourceSessionId: string;
    project?: string;
    runtime: string;
    models: string[];
    lifecycle: string;
    startedAt?: string;
    endedAt?: string;
    lastActivityAt: string;
  };
  /** Present for multi-session packets: full declared provenance set. */
  provenanceSessionIds?: string[];
  sessions?: Array<WorkbenchEvidencePacket["session"]>;
  coverage: {
    hasUsableTranscript: boolean;
    messages: number;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    toolResults: number;
    fileEffects: number;
    checkpoints: number;
    tokenUsageRows: number;
  };
  transcript: Array<{
    ref: string;
    role: "user" | "assistant" | "system" | "tool" | "unknown";
    text: string;
    observedAt: string;
    sessionId?: string;
  }>;
  files: Array<{
    ref: string;
    path: string;
    displayPath: string;
    effectKind?: string;
    additions?: number;
    deletions?: number;
    sessionId?: string;
  }>;
  tools: Array<{
    ref: string;
    name: string;
    status?: string;
    exitCode?: number;
    outputPreview?: string;
    observedAt?: string;
    sessionId?: string;
  }>;
  verification: Array<{
    ref: string;
    label: string;
    status: "passed" | "failed" | "unknown";
    evidence: string;
    sessionId?: string;
  }>;
  timeline: Array<{
    ref: string;
    kind: string;
    summary: string;
    observedAt: string;
    sessionId?: string;
  }>;
  sourceRefs: string[];
  warnings: string[];
};

export type ProvenanceCandidateSummary = {
  sessionId: string;
  project?: string;
  runtime: string;
  title?: string;
  lastActivityAt: string;
  topics: string[];
  errorHints: string[];
  fileHints: string[];
};

export type WorkbenchValidationIssue = {
  code: string;
  message: string;
};

export type WorkbenchValidationResult = {
  ok: boolean;
  errors: WorkbenchValidationIssue[];
  warnings: WorkbenchValidationIssue[];
};
