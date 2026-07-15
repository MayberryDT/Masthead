import type { RuntimeKind, SourceConfidence, SourceKind } from "../adapters/types.ts";
import type { SessionImportHealthSummaryDto } from "./workbench.ts";

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
export type ImportUnitScopeReason =
  | "full_archive"
  | "inside_recent_range"
  | "changed_since_cursor"
  | "outside_recent_range"
  | "deferred_by_unit_limit";

export type ImportAnomalyCode =
  | "record_id_session_explosion"
  | "conversation_roles_missing"
  | "schema_rejection_dominates"
  | "out_of_range_sessions"
  | "tool_evidence_not_normalized"
  | "epoch_timestamp_dominates";

export type ImportAnomaly = {
  code: ImportAnomalyCode;
  severity: "warning" | "error";
  count: number;
  message: string;
};

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
  recordsRecognized: number;
  recordsRejected: number;
  sessionsFinalized: number;
  sessionsRepairRequired: number;
  sessionsSuppressed: number;
  sessionsOnPackagePath: number;
  outOfRangeSessions: number;
  timestampBasis: Record<ImportTimestampBasis, number>;
  cappedUnits: number;
  anomalies: ImportAnomaly[];
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
  importHealth?: SessionImportHealthSummaryDto;
  nextActions: Array<"retry_failed_units" | "import_full_archive" | "approve_transcripts" | "run_enrichment" | "open_logbook" | "repair_import">;
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

export function latestImportCompletionReportsByRuntime(
  jobs: ReadonlyArray<{ completionReport?: ImportCompletionReportDto }>
): ImportCompletionReportDto[] {
  const latest = new Map<RuntimeKind, ImportCompletionReportDto>();
  for (const job of jobs) {
    const report = job.completionReport;
    if (!report) continue;
    const current = latest.get(report.runtime);
    if (!current || completionReportTime(report) > completionReportTime(current)) latest.set(report.runtime, report);
  }
  return [...latest.values()].toSorted((left, right) => completionReportTime(right) - completionReportTime(left));
}

function completionReportTime(report: ImportCompletionReportDto): number {
  const time = Date.parse(report.generatedAt);
  return Number.isFinite(time) ? time : 0;
}
