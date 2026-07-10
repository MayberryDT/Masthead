export type WorkbenchAutomaticArtifactKind = "runbook" | "adr" | "incident_timeline";
export type WorkbenchAuthoredArtifactKind = "session_dossier" | WorkbenchAutomaticArtifactKind;
export type WorkbenchAuthoringRunStatus = "open" | "needs_revision" | "ready_to_finish" | "completed";

export type WorkbenchClaimEvidence = {
  path: string;
  evidenceRefs: string[];
};

export type WorkbenchAuthoringCapabilitiesDto = {
  capability: "artifact_authoring";
  protocol: "masthead.workbench.authoring/v1";
  transport: "daemon_http";
  command: string;
  databaseId: string;
  operations: ["open", "status", "evidence", "submit", "finish"];
  bundleVersion: "workbench-authoring-v1";
  evidencePolicy: "all_canonical_redacted_evidence";
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

export type WorkbenchAuthoringFinding = {
  code: string;
  message: string;
  severity: "error" | "warning";
  path?: string;
  sessionId?: string;
  artifactKind?: "session_enrichment" | WorkbenchAuthoredArtifactKind;
};

export type WorkbenchAuthoringReceipt = {
  runId: string;
  completedAt: string;
  publishedArtifactIds: string[];
  resolvedSessionIds: string[];
  notApplicable: Array<{ sessionId: string; kind: WorkbenchAutomaticArtifactKind }>;
  contributions: Array<{ sessionId: string; kind: WorkbenchAutomaticArtifactKind; artifactId: string }>;
};

export type WorkbenchAuthoringRunDto = {
  runId: string;
  actorId: string;
  databaseId: string;
  status: WorkbenchAuthoringRunStatus;
  evidenceRevision: string;
  sessionIds: string[];
  claimIds: string[];
  claimsExpireAt: string;
  claimStatus: "active" | "expired" | "conflicted" | "released";
  findings: WorkbenchAuthoringFinding[];
  bundle?: WorkbenchAuthoringBundle;
  receipt?: WorkbenchAuthoringReceipt;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
