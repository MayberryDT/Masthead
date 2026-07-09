export type WorkbenchOutputKind = "session_enrichment" | "session_dossier" | "bug_fix_trace";
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
  packetVersion: "workbench-evidence-v1";
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
  }>;
  files: Array<{
    ref: string;
    path: string;
    displayPath: string;
    effectKind?: string;
    additions?: number;
    deletions?: number;
  }>;
  tools: Array<{
    ref: string;
    name: string;
    status?: string;
    exitCode?: number;
    outputPreview?: string;
    observedAt?: string;
  }>;
  verification: Array<{
    ref: string;
    label: string;
    status: "passed" | "failed" | "unknown";
    evidence: string;
  }>;
  timeline: Array<{
    ref: string;
    kind: string;
    summary: string;
    observedAt: string;
  }>;
  sourceRefs: string[];
  warnings: string[];
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

