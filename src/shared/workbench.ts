import type { RuntimeKind } from "../adapters/types.ts";

export type WorkbenchMissingSessionDto = {
  sessionId: string;
  title: string;
  project?: string;
  runtime: string;
  lifecycle: string;
  lastActivityAt: string;
  enrichmentStatus: "missing" | "stale" | "failed";
};

export type WorkbenchPublicationStatus = "publish_path" | "published" | "not_added_to_logbook";

export type CaptureQualityDisposition =
  | {
      disposition: "keep";
      reason: "meaningful_conversation" | "substantial_tool_work" | "durable_file_effect";
    }
  | { disposition: "review"; reason: "insufficient_evidence" }
  | { disposition: "suppress"; reason: "empty" | "hook_only" | "diagnostic_only" | "exact_duplicate" };

export type WorkbenchSuppressionCategory = "confirmed_noise" | "insufficient_evidence" | "manual_exclusion";
export type WorkbenchQualityDecisionSource = "automatic" | "user";

export type SessionImportHealthStatus = "complete" | "partial" | "repair_required";

export type SessionImportHealthDiagnosticDto = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
};

export type SessionImportHealthSummaryDto = {
  total: number;
  complete: number;
  partial: number;
  repairRequired: number;
  reasons: Array<{ reason: string; count: number }>;
  diagnostics: Array<SessionImportHealthDiagnosticDto & { count: number }>;
};

export type WorkbenchImportHealthSummaryDto = {
  ok: true;
  repairRequired: number;
  reasons: Array<{ reason: string; count: number }>;
  importJobIds: string[];
  repairImports?: Array<{
    importJobId: string;
    sourceId: string;
    runtime: RuntimeKind;
    repairRequired: number;
    reasons: Array<{ reason: string; count: number }>;
  }>;
};

export type WorkbenchNextAction =
  | "check_transcript"
  | "import_transcript"
  | "review_quality"
  | "enrich"
  | "create_dossier"
  | "publish"
  | "active"
  | "blocked"
  | "none";

export type WorkbenchActivityDto = {
  activityId: string;
  sessionId: string;
  eventType: string;
  eventAt: string;
  actorKind: string;
  actorId?: string;
  summary: string;
  details: Record<string, unknown>;
};

export type WorkbenchQueueSessionDto = {
  sessionId: string;
  compileReady: boolean;
  title: string;
  project?: string;
  runtime: string;
  lifecycle: string;
  lastActivityAt: string;
  publicationStatus: "publish_path" | "published";
  nextAction: WorkbenchNextAction;
  transcriptStatus: string;
  /** True only when the session also has usable canonical evidence for guided authoring. */
  canonicalEvidenceReady?: boolean;
  qualityStatus: string;
  sessionEnrichmentStatus: string;
  sessionDossierStatus: string;
  /** @deprecated Prefer runbookStatus */
  bugFixTraceStatus: string;
  runbookStatus?: string;
  adrStatus?: string;
  incidentTimelineStatus?: string;
  sessionPackageStatus?: string;
  resolutionStatus?: string;
  activeClaim?: { claimId: string; claimedBy: string; expiresAt: string };
  latestActivity?: WorkbenchActivityDto;
};

export type WorkbenchSessionsResponse = {
  ok: true;
  generatedAt: string;
  limit: number;
  offset: number;
  total: number;
  scope: "default";
  sessions: WorkbenchQueueSessionDto[];
};

/** An atomic selection of every current package-path session for Workbench bulk actions. */
export type WorkbenchSelectionSnapshotResponse = {
  ok: true;
  generatedAt: string;
  total: number;
  sessionIds: string[];
  compileReadySessionIds: string[];
};

export type WorkbenchActivityResponse = {
  ok: true;
  generatedAt: string;
  limit: number;
  activity: WorkbenchActivityDto[];
};

export type WorkbenchNotAddedSummaryDto = {
  ok: true;
  total: number;
  reasons: Array<{ reason: string; count: number }>;
};

export type WorkbenchNotAddedSessionDto = {
  sessionId: string;
  title: string;
  project?: string;
  runtime: string;
  lifecycle: string;
  lastActivityAt: string;
  reason: string;
};

export type WorkbenchNotAddedResponse = {
  ok: true;
  generatedAt: string;
  limit: number;
  sessions: WorkbenchNotAddedSessionDto[];
  total: number;
};

export type WorkbenchMissingSessionsResponse = {
  ok: true;
  generatedAt: string;
  limit: number;
  sessions: WorkbenchMissingSessionDto[];
};

export type WorkbenchEnrollMissingResponse = {
  ok: true;
  enrolled: number;
  heldForImportRepair: number;
  skippedExisting: number;
  enrolledSessionIds: string[];
  limit: number;
  generatedAt: string;
};
