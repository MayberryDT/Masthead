import type { RuntimeKind, SourceConfidence, SourceKind } from "../adapters/types.ts";

export type ImportJobKind = "metadata" | "transcript" | "enrichment";
export type ImportJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "succeeded_with_issues"
  | "failed"
  | "cancelled"
  | "cancelling";

export type ImportScopeMode = "metadata_all" | "transcript_recent" | "transcript_full" | "enrichment_missing";

export type ImportScopeDto = {
  mode: ImportScopeMode;
  days?: number;
  includeChangedSinceCursor: boolean;
  unitLimit?: number;
};

export type ImportStage =
  | "queued"
  | "manifest"
  | "metadata"
  | "transcript"
  | "normalization"
  | "enrichment"
  | "completion";

export type ImportVisibilityState = ImportJobStatus | "stalled";

export type ImportWorkUnitStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "succeeded_with_issues"
  | "failed"
  | "skipped"
  | "cancelled";

export type ImportFailureKind =
  | "unreadable"
  | "locked"
  | "malformed"
  | "schema_drift"
  | "normalization"
  | "excluded"
  | "unknown";

export type ImportManifestSummaryDto = {
  manifestId: string;
  importJobId: string;
  runtime: RuntimeKind;
  sourceId?: string;
  importKind: ImportJobKind;
  scope: ImportScopeDto;
  generatedAt: string;
  totalUnits: number;
  includedUnits: number;
  cappedUnits: number;
  excludedUnits: number;
  totalBytes: number;
  estimatedRecords?: number;
};

export type ImportWorkUnitKind = "metadata_source" | "transcript_file" | "source_session" | "enrichment_session";
export type ImportTimestampBasis = "semantic" | "source_path" | "file_modified" | "unknown";
export type ImportUnitScopeReason = "full_archive" | "inside_recent_range" | "changed_since_cursor" | "outside_recent_range";

export type ImportWorkUnitDto = {
  workUnitId: string;
  manifestId: string;
  importJobId: string;
  runtime: RuntimeKind;
  sourceId: string;
  sourceKind: SourceKind;
  confidence: SourceConfidence;
  schemaVersion?: string;
  unitKind: ImportWorkUnitKind;
  sourcePath?: string;
  sourceSessionId?: string;
  status: ImportWorkUnitStatus;
  statusReason?: string;
  fileSizeBytes?: number;
  modifiedAt?: string;
  semanticActivityAt?: string;
  timestampBasis: ImportTimestampBasis;
  scopeReason?: ImportUnitScopeReason;
  estimatedRecords?: number;
  processedRecords: number;
  importedRecords: number;
  skippedRecords: number;
  failedRecords: number;
  heartbeatAt?: string;
  startedAt?: string;
  finishedAt?: string;
  failureGroupId?: string;
  cursorAfter?: unknown;
};

export type ImportFailureGroupDto = {
  failureGroupId: string;
  importJobId: string;
  manifestId?: string;
  runtime: RuntimeKind;
  failureKind: ImportFailureKind;
  code: string;
  message: string;
  retryable: boolean;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  samplePaths: string[];
};

export type ImportCompletionReportDto = {
  importJobId: string;
  runtime: RuntimeKind;
  status: ImportVisibilityState;
  generatedAt: string;
  sessionsDiscovered: number;
  sessionsHydrated?: number;
  sessionsCreated: number;
  sessionsUpdated: number;
  transcriptsImported: number;
  recordsImported: number;
  recordsSkipped: number;
  recordsFailed: number;
  logbookSearchableSessions: number;
  dossierReadySessions: number;
  enrichedSessions: number;
  mcpVisibleSessions: number;
  failedUnits: number;
  skippedUnits: number;
  sourceUnitsDiscovered?: number;
  sourceUnitsHydrated?: number;
  sourceUnitsDeferred?: number;
  sourceUnitsFailed?: number;
  sourceUnitsRemaining?: number;
  nextActions: Array<"retry_failed_units" | "import_full_archive" | "approve_transcripts" | "run_enrichment" | "open_logbook">;
};

export function deriveImportVisibilityState(
  job: { status: string; heartbeatAt?: string; updatedAt: string },
  now = Date.now(),
  stalledAfterMs = 30_000
): ImportVisibilityState {
  if (job.status !== "running") return job.status as ImportVisibilityState;
  const heartbeat = new Date(job.heartbeatAt ?? job.updatedAt).getTime();
  if (!Number.isFinite(heartbeat)) return job.status as ImportVisibilityState;
  return now - heartbeat > stalledAfterMs ? "stalled" : (job.status as ImportVisibilityState);
}
