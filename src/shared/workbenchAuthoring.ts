import type { SessionTranscriptItem } from "./sessionTranscript.ts";

export type WorkbenchAutomaticArtifactKind = "runbook" | "adr" | "incident_timeline";
export type WorkbenchAuthoredArtifactKind = "session_dossier" | WorkbenchAutomaticArtifactKind;
export type WorkbenchAuthoringRunStatus = "open" | "needs_revision" | "ready_to_finish" | "completed";

export type WorkbenchClaimEvidence = {
  path: string;
  evidenceRefs: string[];
};

export type WorkbenchClaimSupport = {
  path: string;
  evidenceRef: string;
  excerpt: string;
  supportKind:
    | "problem"
    | "decision"
    | "alternative"
    | "change"
    | "verification"
    | "timeline"
    | "remediation"
    | "root_cause";
};

export type WorkbenchAuthoringContractVersion =
  | "workbench-authoring-v1"
  | "workbench-authoring-v2";

type WorkbenchAuthoringCapabilitiesBase = {
  capability: "artifact_authoring";
  protocol: "masthead.workbench.authoring/v1";
  transport: "daemon_http";
  command: string;
  databaseId: string;
};

export type WorkbenchAuthoringCapabilitiesDto = WorkbenchAuthoringCapabilitiesBase & ({
  operations: ["candidates", "open", "status", "evidence", "submit", "finish"];
  bundleVersion: "workbench-authoring-v2";
  evidencePolicy: "candidate_scoped_canonical_evidence";
  evidenceRequirements: {
    runbook: ["problem", "change", "verification"];
    adr: ["context", "decision", "alternatives"];
    incident_timeline: ["symptom", "ordered_events", "remediation"];
  };
} | {
  operations: ["open", "status", "evidence", "submit", "finish"];
  bundleVersion: "workbench-authoring-v1";
  evidencePolicy: "all_canonical_redacted_evidence";
});

export const WORKBENCH_AUTHORING_OPERATIONS = ["candidates", "open", "status", "evidence", "submit", "finish"] as const;

export type WorkbenchArtifactCandidateStatus = "pending" | "claimed" | "published" | "dismissed" | "superseded";

export type WorkbenchArtifactCandidateDto = {
  candidateId: string;
  kind: WorkbenchAutomaticArtifactKind;
  origin: "automatic" | "proposal";
  seedSessionId: string;
  provenanceSessionIds: string[];
  signalEvidenceRefs: string[];
  signalSummary: string;
  signatureKey?: string;
  evidenceRevision: string;
  supersedesCandidateId?: string;
  status: WorkbenchArtifactCandidateStatus;
  dismissalReason?: string;
  dismissalEvidenceRefs?: string[];
  createdAt: string;
  updatedAt: string;
};

export type WorkbenchArtifactCandidatePageDto = {
  candidates: WorkbenchArtifactCandidateDto[];
  nextCursor?: string;
};

export function isWorkbenchAuthoringCapabilitiesDto(
  value: unknown,
  options: { expectedCommand?: string } = {}
): value is WorkbenchAuthoringCapabilitiesDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const capabilities = value as Record<string, unknown>;
  const command = typeof capabilities.command === "string" ? capabilities.command.trim() : "";
  return (
    capabilities.capability === "artifact_authoring" &&
    capabilities.protocol === "masthead.workbench.authoring/v1" &&
    capabilities.transport === "daemon_http" &&
    capabilities.bundleVersion === "workbench-authoring-v2" &&
    capabilities.evidencePolicy === "candidate_scoped_canonical_evidence" &&
    hasExactEvidenceRequirements(capabilities.evidenceRequirements) &&
    typeof capabilities.databaseId === "string" &&
    Boolean(capabilities.databaseId.trim()) &&
    capabilities.databaseId === capabilities.databaseId.trim() &&
    capabilities.command === command &&
    isAbsoluteAuthoringCommand(command) &&
    (!options.expectedCommand || command === options.expectedCommand) &&
    hasExactAuthoringOperations(capabilities.operations)
  );
}

function hasExactEvidenceRequirements(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const requirements = value as Record<string, unknown>;
  return (
    hasExactStrings(requirements.runbook, ["problem", "change", "verification"]) &&
    hasExactStrings(requirements.adr, ["context", "decision", "alternatives"]) &&
    hasExactStrings(requirements.incident_timeline, ["symptom", "ordered_events", "remediation"])
  );
}

function hasExactStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && expected.every((item, index) => value[index] === item);
}

export function isAbsoluteAuthoringCommand(command: string | undefined): boolean {
  const value = command?.trim() ?? "";
  return value.startsWith("/") || /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value);
}

function hasExactAuthoringOperations(operations: unknown): boolean {
  return (
    Array.isArray(operations) &&
    operations.length === WORKBENCH_AUTHORING_OPERATIONS.length &&
    WORKBENCH_AUTHORING_OPERATIONS.every((operation, index) => operations[index] === operation)
  );
}

export type WorkbenchAuthoringEvidenceManifest = {
  evidenceRevision: string;
  sessions: Array<{
    sessionId: string;
    totalItems: number;
    firstObservedAt?: string;
    lastObservedAt?: string;
    coverage: {
      messages: number;
      userMessages: number;
      assistantMessages: number;
      toolCalls: number;
      toolResults: number;
      fileEffects: number;
      checkpoints: number;
      runtimeSignals: number;
    };
    kindCounts: Array<{ kind: string; count: number }>;
    warnings: string[];
  }>;
};

export type WorkbenchAuthoringEvidencePage = {
  evidenceRevision: string;
  sessionId: string;
  total: number;
  items: SessionTranscriptItem[];
  nextCursor?: string;
};

export type WorkbenchSessionPackageDraft = {
  sessionId: string;
  enrichment: Record<string, unknown>;
  dossier: Record<string, unknown>;
};

export type WorkbenchArtifactDraft = {
  kind: WorkbenchAutomaticArtifactKind;
  seedSessionId: string;
  provenanceSessionIds: string[];
  output: Record<string, unknown>;
};

export type WorkbenchNotApplicableDecision = {
  sessionId: string;
  kind: WorkbenchAutomaticArtifactKind;
  reason: string;
  evidenceRefs: string[];
};

export type WorkbenchContributionDecision = {
  sessionId: string;
  kind: WorkbenchAutomaticArtifactKind;
  publishedArtifactId: string;
};

export type WorkbenchAuthoringBundle = {
  bundleVersion: "workbench-authoring-v1";
  runId: string;
  evidenceRevision: string;
  sessionPackages: WorkbenchSessionPackageDraft[];
  artifacts: WorkbenchArtifactDraft[];
  notApplicable: WorkbenchNotApplicableDecision[];
  contributions: WorkbenchContributionDecision[];
};

export type WorkbenchAuthoringBundleV2 = {
  bundleVersion: "workbench-authoring-v2";
  runId: string;
  candidateId: string;
  evidenceRevision: string;
  artifact: WorkbenchArtifactDraft;
};

export type WorkbenchStoredAuthoringBundle = WorkbenchAuthoringBundle | WorkbenchAuthoringBundleV2;

export type WorkbenchAuthoringFinding = {
  code: string;
  message: string;
  severity: "error" | "warning";
  path?: string;
  sessionId?: string;
  artifactKind?: "session_enrichment" | WorkbenchAuthoredArtifactKind;
};

type WorkbenchAuthoringReceiptBase = {
  runId: string;
  completedAt: string;
  publishedArtifactIds: string[];
  resolvedSessionIds: string[];
  contributions: Array<{ sessionId: string; kind: WorkbenchAutomaticArtifactKind; artifactId: string }>;
};

export type WorkbenchAuthoringReceiptV1 = WorkbenchAuthoringReceiptBase & {
  contractVersion: "workbench-authoring-v1";
  notApplicable: Array<{ sessionId: string; kind: WorkbenchAutomaticArtifactKind }>;
};

export type WorkbenchAuthoringReceiptV2 = WorkbenchAuthoringReceiptBase & {
  contractVersion: "workbench-authoring-v2";
  candidateId: string;
  dossierArtifactIds: string[];
  optionalArtifact: { artifactId: string; kind: WorkbenchAutomaticArtifactKind };
  provenanceSessionIds: string[];
};

export type WorkbenchAuthoringReceipt = WorkbenchAuthoringReceiptV1 | WorkbenchAuthoringReceiptV2;

export type WorkbenchAuthoringRunDto = {
  runId: string;
  actorId: string;
  databaseId: string;
  status: WorkbenchAuthoringRunStatus;
  contractVersion: WorkbenchAuthoringContractVersion;
  candidateId?: string;
  evidenceRevision: string;
  sessionIds: string[];
  claimIds: string[];
  claimsExpireAt: string;
  claimStatus: "active" | "expired" | "conflicted" | "released";
  findings: WorkbenchAuthoringFinding[];
  bundle?: WorkbenchStoredAuthoringBundle;
  receipt?: WorkbenchAuthoringReceipt;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
