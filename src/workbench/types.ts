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
