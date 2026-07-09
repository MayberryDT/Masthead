import type { ImportCompletionReportDto, ImportJobStatus, ImportManifestSummaryDto, ImportScopeDto, ImportStage } from "./sourceImport.ts";

export type SetupStatus = "empty" | "scan_needed" | "scan_available" | "detected" | "connecting" | "importing" | "needs_attention" | "ready";

export type FoundSourceDto = {
  sourceId: string;
  runtime: string;
  label?: string;
  sourceKind?: string;
  confidence?: "authoritative" | "inferred" | "heuristic";
  path?: string;
  state?:
    | "importable"
    | "detected"
    | "connected"
    | "importing"
    | "syncing"
    | "ready"
    | "needs_attention"
    | "schema_unrecognized"
    | "transcript_approval_required";
  sessions?: number;
  discoveredSessions?: number;
  importable?: boolean;
  transcriptAvailable?: boolean;
  transcriptApproval?: {
    approved: boolean;
    required: boolean;
    summary?: string;
  };
};

export type SourcesOnboardingFoundSourceDto = FoundSourceDto;

export type HarnessScanSummaryDto = {
  scannedHarnesses: number;
  detectedHarnesses: number;
  foundSources: number;
};

export type SourceDiagnosticDto = {
  code: string;
  count?: number;
  message: string;
  severity: "info" | "warning" | "error";
  observedAt?: string;
  details?: string;
  path?: string;
  sampleSourceIds?: string[];
};

export type SourceObserverKind = "herdr";

export type SourceObserverCapabilityDto = {
  passivePaneEvidence: boolean;
  createsSessions: false;
  providesTranscript: false;
  providesTokens: false;
  providesModel: false;
  callsSocket: false;
};

export type SourceObserverPathDto = {
  path: string;
  exists: boolean;
  readable: boolean;
  kind: "file" | "directory" | "missing" | "other";
  byteCount: number;
  lastModifiedAt?: string;
  diagnostics: SourceDiagnosticDto[];
};

export type SourceObserverObservationDto = {
  observer: SourceObserverKind;
  kind: "server" | "socket" | "workspace" | "pane" | "focus" | "process" | "agent" | "exit" | "session_save";
  workspaceId?: string;
  paneId?: string;
  cwd?: string;
  pid?: number;
  pgid?: number;
  agentLabel?: string;
  mappedRuntime?: string;
  observedAt: string;
  confidence: "heuristic" | "inferred";
};

export type SourceObserverDto = {
  observer: SourceObserverKind;
  label: string;
  state: "available" | "degraded" | "not_detected";
  checkedPaths: SourceObserverPathDto[];
  diagnostics: SourceDiagnosticDto[];
  observations: SourceObserverObservationDto[];
  capabilities: SourceObserverCapabilityDto;
};

export type SourcesOnboardingAdapterScanDto = {
  runtime: string;
  state: "connected" | "degraded" | "not_detected" | "planned";
  summary: {
    foundSources: number;
    sessions: number;
  };
  diagnostics: SourceDiagnosticDto[];
  foundSources: FoundSourceDto[];
};

export type SourcesOnboardingScanDto = {
  scanId: string;
  generatedAt: string;
  status: "running" | "completed" | "failed";
  summary: HarnessScanSummaryDto;
  foundSources: FoundSourceDto[];
  adapters: SourcesOnboardingAdapterScanDto[];
  observers?: SourceObserverDto[];
};

export type ConnectedSourceDto = FoundSourceDto & {
  status?: "connected" | "importing" | "syncing" | "needs_attention" | "ready" | "schema_unrecognized" | "transcript_approval_required";
  state?: "connected" | "importing" | "syncing" | "ready" | "needs_attention" | "schema_unrecognized" | "transcript_approval_required";
  label?: string;
  sessions?: number;
  metadataSessions?: number;
  transcriptSessions?: number;
  enrichedSessions?: number;
  missingTranscripts?: number;
  missingEnrichment?: number;
  failedImports?: number;
  discoveredSessions?: number;
  importedSessions: number;
  importedRecords?: number;
  queuedRecords?: number;
  failureCount?: number;
  transcriptImportEnabled?: boolean;
  enrichmentEnabled?: boolean;
  mcpEnabled?: boolean;
  needsAttention?: Array<"transcript_import" | "enrichment" | "import_failures">;
  lastSyncAt?: string;
  detectedPath?: string;
  failures?: number;
  importedCount?: number;
  lastSync?: string;
  queuedCount?: number;
  sessionCount?: number;
};

export type SourcesSetupConnectedSourceDto = ConnectedSourceDto;

export type SourcesSetupCoverageDto = {
  sessions: number;
  transcripts?: number;
  enriched?: number;
  queued?: number;
  failures?: number;
  metadataSessions?: number;
  transcriptSessions?: number;
  enrichedSessions?: number;
  missingTranscripts?: number;
  missingEnrichment?: number;
  failedImports?: number;
  unrecognizedSources?: number;
};

export type SourcesAdvancedAdapterDto = {
  runtime: string;
  label?: string;
  state: "connected" | "degraded" | "disabled" | "not_detected" | "planned";
  discoveredSessions?: number;
  importedSessions?: number;
  failureCount?: number;
  sourceLocationCount?: number;
  diagnostics?: SourceDiagnosticDto[];
};

export type SourcesAdvancedImportDto = {
  importJobId: string;
  sourceId: string;
  importKind: "metadata" | "transcript" | "enrichment";
  status: ImportJobStatus;
  discoveredCount: number;
  processedCount?: number;
  importedCount: number;
  queuedCount: number;
  failureCount: number;
  updatedAt: string;
  currentPath?: string;
  failureMessage?: string;
  stage?: ImportStage;
  heartbeatAt?: string;
  totalWorkUnits?: number;
  completedWorkUnits?: number;
  failedWorkUnits?: number;
  skippedWorkUnits?: number;
  completionReport?: ImportCompletionReportDto;
};

export type SourcesAdvancedDto = {
  adapters: SourcesAdvancedAdapterDto[];
  imports: SourcesAdvancedImportDto[];
  sources: ConnectedSourceDto[];
  observers?: SourceObserverDto[];
};

export type SourcesSetupDto = {
  setupId: string;
  updatedAt: string;
  status: SetupStatus;
  connectedSources: ConnectedSourceDto[];
  coverage?: {
    sessions: number;
    metadataSessions?: number;
    transcriptSessions?: number;
    enrichedSessions?: number;
    missingTranscripts?: number;
    missingEnrichment?: number;
    failedImports?: number;
    unrecognizedSources?: number;
    enriched?: number;
    failures?: number;
    queued?: number;
    transcripts?: number;
  };
  enrichment?: {
    mode: "local" | "remote" | "skip";
    provider: "deterministic" | "openai" | "disabled";
    model?: string;
    current: number;
    missing: number;
    failed: number;
  };
  latestScan?: SourcesOnboardingScanDto;
  latestManifest?: ImportManifestSummaryDto;
  latestCompletionReport?: ImportCompletionReportDto;
  nextAction?: "connect_sources" | "approve_transcripts" | "build_library" | "sync" | "repair_missing_data" | "open_logbook" | "none";
  scan?: SourcesOnboardingScanDto;
  advanced: SourcesAdvancedDto;
};

export type SourcesSetupRunRequest = {
  runtimes?: string[];
  sourceIds?: string[];
  importMetadata?: boolean;
  queueEnrichment?: boolean;
  enrichmentMode?: "local" | "remote" | "skip";
  importScope?: ImportScopeDto;
};

export type SourcesSetupRunInput = SourcesSetupRunRequest;

export type SourcesSetupLiveCaptureAction = "install" | "test" | "uninstall" | "leave";

export type SourcesSetupLiveCaptureSelection = {
  runtime: string;
  action: SourcesSetupLiveCaptureAction;
};
