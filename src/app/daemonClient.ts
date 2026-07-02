import { defaultLiveProjectionUrl } from "./liveProjectionClient";
import { getJson, postJson } from "./httpJsonClient";
import type { ReviewDisposition } from "../core/store";
import type { SessionDossierDto } from "../shared/sessionDossier";
import type { SessionSummaryEnrichment, SessionTitleEnrichment } from "../shared/sessionEnrichment";
import type { SessionTranscriptCoverage, SessionTranscriptItem, SessionTranscriptResult } from "../shared/sessionTranscript";
import type { SourcesAdvancedDto, SourcesOnboardingScanDto, SourcesSetupDto, SourcesSetupRunRequest } from "../shared/sourcesSetup";
import type { ImportCompletionReportDto, ImportJobStatus, ImportManifestSummaryDto, ImportStage, ImportWorkUnitDto, ImportWorkUnitStatus } from "../shared/sourceImport";

export type { SessionTranscriptCoverage, SessionTranscriptItem, SessionTranscriptResult };
export type { SourcesAdvancedDto, SourcesOnboardingScanDto, SourcesSetupDto, SourcesSetupRunRequest };

export type SessionTranscriptKindFilter = "all" | "user" | "assistant" | "tools" | "checkpoints" | "files" | "signals";

export type SourceStatus = {
  sourceId: string;
  runtime: string;
  sourceKind: string;
  path?: string;
  detectedPath?: string;
  discoveredSessions?: number;
  importedSessions?: number;
  importedRecords?: number;
  queuedRecords?: number;
  failureCount?: number;
  lastSyncAt?: string;
  transcriptImportEnabled?: boolean;
  enrichmentEnabled?: boolean;
  mcpEnabled?: boolean;
  sessionCount?: number;
  importedCount?: number;
  queuedCount?: number;
  failures?: number;
  lastSync?: string;
  confidence: "authoritative" | "inferred" | "heuristic";
  checkedPaths?: string[];
  diagnostics?: SourceDiagnostic[];
};

export type SourceDiagnostic = {
  code: string;
  count?: number;
  message: string;
  severity: "info" | "warning" | "error";
  observedAt?: string;
  details?: string;
  path?: string;
  sampleSourceIds?: string[];
};

export type AdapterStatus = {
  runtime: string;
  name?: string;
  description?: string;
  state: "connected" | "degraded" | "disabled" | "not_detected" | "planned";
  implementationState?: "active" | "planned";
  discoveredCount?: number;
  importedCount?: number;
  discoveredSessions: number;
  importedSessions: number;
  lastSyncAt?: string;
  checkedPaths?: string[];
  diagnostics?: SourceDiagnostic[];
  failureCount?: number;
  sourceLocationCount?: number;
  queuedRecords?: number;
  sourceLocations: SourceStatus[];
  policies: {
    metadataImport: boolean;
    transcriptImport: boolean;
    enrichment: boolean;
    mcpAccess: boolean;
  };
};

export type ImportJob = {
  importJobId: string;
  sourceId: string;
  importKind: "metadata" | "transcript" | "enrichment";
  status: ImportJobStatus;
  discoveredCount: number;
  importedCount: number;
  queuedCount: number;
  failureCount: number;
  updatedAt: string;
  failureMessage?: string;
  currentPath?: string;
  processedCount?: number;
  progressCurrent?: number;
  progressTotal?: number;
  progressPercent?: number;
  stage?: ImportStage;
  heartbeatAt?: string;
  totalWorkUnits?: number;
  completedWorkUnits?: number;
  failedWorkUnits?: number;
  skippedWorkUnits?: number;
  completionReport?: ImportCompletionReportDto;
};

export type ImportJobPage = {
  imports: ImportJob[];
  limit: number;
  offset: number;
  total: number;
};

export type SourceStatusPage = {
  limit: number;
  offset: number;
  sources: SourceStatus[];
  total: number;
};

export type AdapterImportActionResult = {
  imported?: number;
  importJobId?: string;
  job?: ImportJob;
  jobs?: ImportJob[];
  queued?: number;
  skipped?: number;
  sources?: number;
};

export type SourceScanResult = {
  scanId: string;
  generatedAt: string;
  adapters: Array<{
    runtime: string;
    label: string;
    state: AdapterStatus["state"];
    maturity: string;
    discoveredSessions: number;
    checkedPaths: Array<{
      path: string;
      exists: boolean;
      readable: boolean;
      kind: string;
      fileCount: number;
      byteCount: number;
      candidateSessionCount: number;
      diagnostics: SourceDiagnostic[];
    }>;
    diagnostics: SourceDiagnostic[];
    sources: SourceStatus[];
  }>;
};

export type ConnectSourcesResult = {
  jobs: ImportJob[];
  queued: number;
  skipped: Array<{ runtime: string; reason: string }>;
};

export type SourcesImportPreview = {
  runtime: string;
  summary: ImportManifestSummaryDto;
};

export type ImportWorkUnitPage = {
  units: ImportWorkUnitDto[];
  limit: number;
  offset: number;
};

export type SourceExclusionInput = {
  exclusionKind: "source" | "project" | "path";
  pattern: string;
  reason: string;
};

export type LogbookSearchResult = {
  sessions: LogbookSession[];
  total: number;
  nextCursor?: string;
};

export type LogbookSort = "recent" | "oldest" | "duration_desc" | "files_desc" | "tools_desc" | "errors_desc" | "project";

export type LogbookSummary = {
  sessions: number;
  projects: number;
  runtimes: Array<{ runtime: string; count: number }>;
  models: Array<{ model: string; count: number }>;
  lifecycles: Array<{ lifecycle: string; count: number }>;
  messages: number;
  toolCalls: number;
  fileEffects: number;
  earliestActivityAt?: string;
  latestActivityAt?: string;
};

export type UsageWindow = "today" | "24h" | "7d" | "30d" | "all";

export type UsageTotalsDto = {
  sessions: number;
  projects: number;
  runtimes: number;
  models: number;
  messages: number;
  toolCalls: number;
  fileEffects: number;
  mcpQueries: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenRows: number;
  tokenCoverageSessions: number;
  tokensPerMinute?: number;
};

export type UsageByModelDto = {
  model: string;
  provider?: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type UsageByProjectDto = {
  project: string;
  sessions: number;
  messages: number;
  toolCalls: number;
  fileEffects: number;
  totalTokens: number;
};

export type UsageByRuntimeDto = {
  runtime: string;
  sessions: number;
  messages: number;
  toolCalls: number;
  fileEffects: number;
  totalTokens: number;
};

export type UsageActivityPointDto = {
  bucketStart: string;
  sessions: number;
  messages: number;
  toolCalls: number;
  fileEffects: number;
  totalTokens: number;
};

export type UsageCoverageDto = {
  sources: number;
  importedSessions: number;
  sessionsWithTokenUsage: number;
  sessionsWithoutTokenUsage: number;
  currentEnrichments: number;
  mcpQueries: number;
};

export type UsageStatsDto = {
  window: UsageWindow;
  generatedAt: string;
  range: {
    from?: string;
    to: string;
  };
  totals: UsageTotalsDto;
  byModel: UsageByModelDto[];
  byProject: UsageByProjectDto[];
  byRuntime: UsageByRuntimeDto[];
  activity: UsageActivityPointDto[];
  coverage: UsageCoverageDto;
};

export type LogbookSession = {
  sessionId: string;
  sourceSessionId: string;
  title: string;
  objective?: string;
  outcome?: string;
  project?: string;
  runtime: string;
  models: string[];
  hostId: string;
  branch?: string;
  lifecycle: string;
  startedAt?: string;
  lastActivityAt: string;
  endedAt?: string;
  topics: string[];
  fileCount: number;
  toolCount: number;
  errorCount: number;
  enrichmentStatus?: "current" | "stale" | "failed" | "disabled" | "missing";
  sessionTitle?: SessionTitleEnrichment;
  sessionSummary?: SessionSummaryEnrichment;
  unresolved: string[];
  snippet?: string;
  sourceConfidence: "authoritative" | "inferred" | "heuristic";
};

export type LogbookSessionDetail = LogbookSession & {
  repoRoot?: string;
  worktreePath?: string;
  durationMs?: number;
  files: string[];
  tools: string[];
  sourceProvenance: {
    hostId: string;
    runtime: string;
    sourceSessionId: string;
    sourceConfidence: LogbookSession["sourceConfidence"];
  };
  mcpIncluded: boolean;
};

export type LogbookExcerpt = {
  excerptId: string;
  kind: "message" | "tool" | "checkpoint";
  role?: string;
  text: string;
  observedAt: string;
  sourceRef: unknown;
};

export type LogbookSearchFilters = {
  q?: string;
  runtime?: string;
  project?: string;
  model?: string;
  host?: string;
  state?: string;
  lifecycle?: string;
  file?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  cursor?: string;
  offset?: number;
  sort?: LogbookSort;
};

export type ProjectOption = {
  project: string;
  sessionCount: number;
};

export type RetentionClass =
  | "canonical_metadata"
  | "searchable_messages"
  | "raw_payloads"
  | "large_outputs"
  | "derived_indexes"
  | "audit_logs";

export type RetentionClassSummary = {
  records: number;
  retention: "indefinite" | "indefinite_configurable" | "configurable" | "short_configurable" | "rebuildable";
  description: string;
};

export type DataSummary = {
  sessions: number;
  rawEvents: number;
  messages: number;
  enrichments: number;
  sources: number;
  auditRows: number;
  tables: Record<string, number>;
  storageClasses: Record<RetentionClass, RetentionClassSummary>;
};


export type McpExclusionDto = {
  exclusionKind: "source" | "project" | "path";
  pattern: string;
  reason: string;
  createdAt: string;
};

export type McpSourcePolicyDto = {
  sourceId: string;
  runtime: string;
  path?: string;
  enabled: boolean;
  policySource: "source" | "global" | "default";
};

export type McpPermissionsDto = {
  globalAccessEnabled: boolean;
  allowed: string[];
  blocked: string[];
  exclusions: McpExclusionDto[];
  sourcePolicies: McpSourcePolicyDto[];
};

export type McpStatusDto = {
  ready: boolean;
  databasePath: string;
  mode: "stdio";
  readOnly: true;
  toolCount: number;
  queryCount: number;
  lastQueryAt?: string;
  globalAccessEnabled: boolean;
  permissions?: McpPermissionsDto;
};

export type McpToolDto = {
  name: string;
  purpose: string;
  arguments: string;
  dataReturned: string;
  permission: "Read only";
};

export type McpAuditRowDto = {
  mcpQueryId: string;
  toolName: string;
  requestedAt: string;
  resultCount: number;
  boundedBytes?: number;
  sessionIds: string[];
  status: "succeeded" | "failed" | "denied";
  failureMessage?: string;
};

export type SettingsOptionDto = {
  value: string;
  label: string;
};

export type CodexHookSettingsDto = {
  configPath: string;
  configExists: boolean;
  installed: boolean;
  missingEvents: string[];
  mismatchedEvents: string[];
  command: string;
  endpoint: string;
  latestBackupPath?: string;
  lastEventAt?: string;
  lastTest?: {
    testedAt: string;
    status: "passed" | "failed";
    message: string;
  };
  error?: string;
};

export type SettingsRuntimeIdentityDto = {
  product: "masthead";
  apiVersion: 1;
  schemaVersion: number;
  runtime: {
    mode: "primary";
    writable: true;
    host: string;
    port: number;
  };
  data: {
    databaseId: string;
    databasePath: string;
    dataDirectory: string;
    migrationState: "ready";
    storePath: string;
  };
  capabilities: string[];
};

export type SettingsStateDto = SettingsRuntimeIdentityDto & {
  hooks: CodexHookSettingsDto;
  enrichment: {
    provider: string;
    remoteModelEnabled: boolean;
    model: string;
    currentEnrichments: number;
    sessionCount: number;
    health: {
      complete: number;
      queued: number;
      failed: number;
      disabled: number;
      gitSnapshotsWithoutFileEffects?: number;
      repeatedFailedFingerprints?: number;
      sessionsWithMessagesButNoEffects?: number;
      status: "complete" | "partial" | "disabled";
      weakCurrentTitles?: number;
    };
  };
  privacy: {
    transcriptImportEnabled: boolean;
    mcpAccessEnabled: boolean;
    redactionEnabled: true;
  };
  storage: {
    databasePath: string;
    dataDirectory: string;
    storePath: string;
    dataSummary: DataSummary;
  };
  deletionTargets: {
    projects: SettingsOptionDto[];
    runtimes: SettingsOptionDto[];
    hosts: SettingsOptionDto[];
  };
};

export type DeleteMastheadDataScope =
  | { kind: "all" }
  | { kind: "raw_payloads" }
  | { kind: "session"; sessionId: string }
  | { kind: "project"; project: string }
  | { kind: "runtime"; runtime: string }
  | { kind: "host"; host: string };

export type DataLifecycleResult = {
  sessions: number;
  rawEvents: number;
  enrichments: number;
  auditRows: number;
};

export type DataLifecycleResponse = {
  preview: DataSummary;
  summary: DataSummary;
  result: Partial<DataLifecycleResult> & { rawEvents?: number };
};

export type SourcesSetupActionResult = {
  ok: true;
  setup: SourcesSetupDto;
  scan?: SourcesOnboardingScanDto;
  jobs?: ImportJob[];
  queued?: number;
  skipped?: Array<{ runtime: string; reason: string }>;
  repairs?: string[];
  message?: string;
};

export async function getSourcesSetup(
  baseUrl = defaultLiveProjectionUrl(),
  options: { signal?: AbortSignal } = {}
): Promise<SourcesSetupDto> {
  const body = await getJson<{ ok: true; setup: SourcesSetupDto }>(baseUrl, "/sources/setup", {
    label: "sources setup request",
    signal: options.signal
  });
  return body.setup;
}

export async function scanSourcesSetup(baseUrl = defaultLiveProjectionUrl()): Promise<SourcesSetupActionResult> {
  return postSourcesSetupAction(baseUrl, "/sources/setup/scan");
}

export async function runSourcesSetup(
  input: SourcesSetupRunRequest,
  baseUrl = defaultLiveProjectionUrl()
): Promise<SourcesSetupActionResult> {
  return postSourcesSetupAction(baseUrl, "/sources/setup/run", input);
}

export async function previewSourcesImport(
  baseUrl: string,
  input: SourcesSetupRunRequest
): Promise<SourcesImportPreview[]> {
  const url = new URL(baseUrl);
  url.pathname = "/sources/import/preview";
  url.search = "";
  const response = await fetch(url.toString(), {
    body: JSON.stringify(input),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  if (!response.ok) throw new Error(`sources import preview request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; previews: SourcesImportPreview[] };
  return body.previews;
}

export async function syncSources(
  baseUrl = defaultLiveProjectionUrl(),
  input?: SourcesSetupRunRequest
): Promise<SourcesSetupActionResult> {
  return postSourcesSetupAction(baseUrl, "/sources/sync", input);
}

export async function repairSources(
  baseUrl = defaultLiveProjectionUrl(),
  input?: Record<string, unknown>
): Promise<SourcesSetupActionResult> {
  return postSourcesSetupAction(baseUrl, "/sources/repair", input);
}

export async function getSourcesAdvanced(
  baseUrl = defaultLiveProjectionUrl(),
  options: { signal?: AbortSignal } = {}
): Promise<SourcesAdvancedDto> {
  const body = await getJson<{ ok: true; advanced: SourcesAdvancedDto }>(baseUrl, "/sources/advanced", {
    label: "sources advanced request",
    signal: options.signal
  });
  return body.advanced;
}

async function postSourcesSetupAction(baseUrl: string, pathname: string, input?: unknown): Promise<SourcesSetupActionResult> {
  return postJson<SourcesSetupActionResult>(baseUrl, pathname, { body: input, label: "sources setup action" });
}

export async function listSources(baseUrl = defaultLiveProjectionUrl()): Promise<SourceStatus[]> {
  const body = await getJson<{ ok: true; sources: SourceStatus[] }>(baseUrl, "/sources", { label: "sources request" });
  return body.sources;
}

export async function listAdapters(
  baseUrl = defaultLiveProjectionUrl(),
  options: { includeLocations?: boolean } = {}
): Promise<AdapterStatus[]> {
  const body = await getJson<{ ok: true; adapters: AdapterStatus[] }>(baseUrl, "/adapters", {
    label: "adapters request",
    query: { includeLocations: options.includeLocations }
  });
  return body.adapters;
}

export async function listAdapterSources(
  runtime: string,
  baseUrl = defaultLiveProjectionUrl(),
  options: { limit?: number; offset?: number; signal?: AbortSignal } = {}
): Promise<SourceStatusPage> {
  const body = await getJson<{ ok: true; limit: number; offset: number; sources: SourceStatus[]; total: number }>(
    baseUrl,
    `/adapters/${encodeURIComponent(runtime)}/sources`,
    {
      label: "adapter sources request",
      query: { limit: options.limit, offset: options.offset },
      signal: options.signal
    }
  );
  return {
    limit: body.limit,
    offset: body.offset,
    sources: body.sources,
    total: body.total
  };
}

export async function scanSources(baseUrl = defaultLiveProjectionUrl()): Promise<SourceScanResult> {
  const body = await postJson<{ ok: true; scan: SourceScanResult }>(baseUrl, "/sources/scan", { label: "source scan" });
  return body.scan;
}

export async function connectSources(
  input: {
    runtimes: string[];
    importMetadata: boolean;
    importTranscripts: boolean;
    queueEnrichment: boolean;
    transcriptApproved?: boolean;
  },
  baseUrl = defaultLiveProjectionUrl()
): Promise<ConnectSourcesResult> {
  return postJson<ConnectSourcesResult>(baseUrl, "/sources/connect", { body: input, label: "source connect" });
}

export async function importAdapterMetadata(
  runtime: string,
  baseUrl = defaultLiveProjectionUrl()
): Promise<AdapterImportActionResult> {
  return postAdapterImportAction(runtime, "import-metadata", "metadata import", baseUrl);
}

export async function importCodexMetadata(baseUrl = defaultLiveProjectionUrl()): Promise<AdapterImportActionResult> {
  return importAdapterMetadata("codex", baseUrl);
}

export async function approveAdapterTranscripts(runtime: string, baseUrl = defaultLiveProjectionUrl()): Promise<void> {
  await postAdapterImportAction(runtime, "approve-transcripts", "transcript approval", baseUrl);
}

export async function importAdapterTranscripts(
  runtime: string,
  baseUrl = defaultLiveProjectionUrl()
): Promise<AdapterImportActionResult> {
  return postAdapterImportAction(runtime, "import-transcripts", "transcript import", baseUrl);
}

export async function syncAdapter(runtime: string, baseUrl = defaultLiveProjectionUrl()): Promise<AdapterImportActionResult> {
  return postAdapterImportAction(runtime, "sync", "adapter sync", baseUrl);
}

export async function startImport(
  input: { sourceId: string; kind: ImportJob["importKind"] },
  baseUrl = defaultLiveProjectionUrl()
): Promise<ImportJob> {
  const body = await postJson<{ ok: true; job: ImportJob }>(baseUrl, "/imports", { body: input, label: "import request" });
  return body.job;
}

export async function listImports(
  baseUrl = defaultLiveProjectionUrl(),
  options: {
    adapterId?: string;
    limit?: number;
    offset?: number;
    signal?: AbortSignal;
    sourceId?: string;
    status?: ImportJob["status"] | "active";
  } = {}
): Promise<ImportJobPage> {
  const body = await getJson<{ ok: true; imports: ImportJob[]; limit?: number; offset?: number; total?: number }>(baseUrl, "/imports", {
    label: "imports request",
    query: {
      limit: options.limit,
      offset: options.offset,
      adapterId: options.adapterId,
      sourceId: options.sourceId,
      status: options.status
    },
    signal: options.signal
  });
  return {
    imports: body.imports,
    limit: body.limit ?? body.imports.length,
    offset: body.offset ?? 0,
    total: body.total ?? body.imports.length
  };
}

export async function listImportWorkUnits(
  baseUrl: string,
  importJobId: string,
  options: { limit?: number; offset?: number; status?: ImportWorkUnitStatus } = {}
): Promise<ImportWorkUnitPage> {
  const url = new URL(baseUrl);
  url.pathname = `/imports/${encodeURIComponent(importJobId)}/units`;
  url.search = "";
  if (options.limit !== undefined) url.searchParams.set("limit", String(options.limit));
  if (options.offset !== undefined) url.searchParams.set("offset", String(options.offset));
  if (options.status) url.searchParams.set("status", options.status);
  const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`import work units request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; units: ImportWorkUnitDto[]; limit: number; offset: number };
  return {
    limit: body.limit,
    offset: body.offset,
    units: body.units
  };
}

export async function getImportReport(baseUrl: string, importJobId: string): Promise<ImportCompletionReportDto | undefined> {
  const url = new URL(baseUrl);
  url.pathname = `/imports/${encodeURIComponent(importJobId)}/report`;
  url.search = "";
  const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`import report request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; report?: ImportCompletionReportDto };
  return body.report;
}

export async function cancelImport(importJobId: string, baseUrl = defaultLiveProjectionUrl()): Promise<ImportJob> {
  return postImportJobAction(importJobId, "cancel", "import cancel", baseUrl);
}

export async function retryImport(importJobId: string, baseUrl = defaultLiveProjectionUrl()): Promise<ImportJob> {
  return postImportJobAction(importJobId, "retry", "import retry", baseUrl);
}

async function postAdapterImportAction(
  runtime: string,
  action: "approve-transcripts" | "import-metadata" | "import-transcripts" | "sync",
  label: string,
  baseUrl: string
): Promise<AdapterImportActionResult> {
  return postJson<AdapterImportActionResult>(baseUrl, `/adapters/${encodeURIComponent(runtime)}/${action}`, { label });
}

async function postImportJobAction(
  importJobId: string,
  action: "cancel" | "retry",
  label: string,
  baseUrl: string
): Promise<ImportJob> {
  const body = await postJson<{ ok: true; job: ImportJob }>(baseUrl, `/imports/${encodeURIComponent(importJobId)}/${action}`, { label });
  return body.job;
}

export async function addSourceExclusion(input: SourceExclusionInput, baseUrl = defaultLiveProjectionUrl()): Promise<void> {
  await postJson<unknown>(baseUrl, "/sources/exclusions", { body: input, label: "source exclusion" });
}

export async function searchLogbook(
  input: string | LogbookSearchFilters,
  baseUrl = defaultLiveProjectionUrl(),
  options: { signal?: AbortSignal } = {}
): Promise<LogbookSearchResult> {
  const filters: LogbookSearchFilters = typeof input === "string" ? { q: input } : input;
  return getJson<LogbookSearchResult>(baseUrl, "/sessions", { label: "logbook search", query: filters, signal: options.signal });
}

export async function getLogbookSummary(baseUrl = defaultLiveProjectionUrl(), options: { signal?: AbortSignal } = {}): Promise<LogbookSummary> {
  const body = await getJson<{ ok: true; summary: LogbookSummary }>(baseUrl, "/logbook/summary", {
    label: "logbook summary",
    signal: options.signal
  });
  return body.summary;
}

export async function getUsageStats(
  baseUrl = defaultLiveProjectionUrl(),
  options: { window?: UsageWindow; signal?: AbortSignal } = {}
): Promise<UsageStatsDto> {
  const body = await getJson<{ ok: true; usage: UsageStatsDto }>(baseUrl, "/usage/summary", {
    label: "usage summary",
    query: { window: options.window ?? "today" },
    signal: options.signal
  });
  return body.usage;
}

export async function getLogbookSession(
  sessionId: string,
  baseUrl = defaultLiveProjectionUrl(),
  options: { signal?: AbortSignal } = {}
): Promise<LogbookSessionDetail> {
  const body = await getJson<{ ok: true; session: LogbookSessionDetail }>(baseUrl, `/sessions/${encodeURIComponent(sessionId)}`, {
    label: "session detail",
    signal: options.signal
  });
  return body.session;
}

export async function getLogbookSessionExcerpts(
  sessionId: string,
  input: { q?: string; limit?: number } = {},
  baseUrl = defaultLiveProjectionUrl(),
  options: { signal?: AbortSignal } = {}
): Promise<LogbookExcerpt[]> {
  const body = await getJson<{ ok: true; excerpts: LogbookExcerpt[] }>(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/excerpts`, {
    label: "session excerpts",
    query: input,
    signal: options.signal
  });
  return body.excerpts;
}

export async function getSessionDossier(
  sessionId: string,
  baseUrl = defaultLiveProjectionUrl(),
  options: { signal?: AbortSignal } = {}
): Promise<SessionDossierDto> {
  const body = await getJson<{ ok: true; dossier: SessionDossierDto }>(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/dossier`, {
    label: "session dossier",
    signal: options.signal
  });
  return body.dossier;
}

export async function getSessionTranscript(
  sessionId: string,
  input: {
    cursor?: string;
    limit?: number;
    kind?: SessionTranscriptKindFilter;
    q?: string;
  } = {},
  baseUrl = defaultLiveProjectionUrl(),
  options: { signal?: AbortSignal } = {}
): Promise<SessionTranscriptResult> {
  const body = await getJson<{ ok: true } & SessionTranscriptResult>(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/transcript`, {
    label: "session transcript",
    query: { cursor: input.cursor, limit: input.limit, kind: input.kind, q: input.q },
    signal: options.signal
  });
  return {
    coverage: body.coverage,
    items: body.items,
    nextCursor: body.nextCursor,
    total: body.total
  };
}

export async function listProjects(baseUrl = defaultLiveProjectionUrl(), options: { signal?: AbortSignal } = {}): Promise<ProjectOption[]> {
  const url = new URL(baseUrl);
  url.pathname = "/projects";
  url.search = "";
  const response = await fetch(url.toString(), { headers: { accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error(`projects request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; projects: ProjectOption[] };
  return body.projects;
}

export async function getMcpStatus(baseUrl = defaultLiveProjectionUrl(), options: { signal?: AbortSignal } = {}): Promise<McpStatusDto> {
  const url = new URL(baseUrl);
  url.pathname = "/mcp/status";
  url.search = "";
  const response = await fetch(url.toString(), { headers: { accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error(`MCP status request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; status: McpStatusDto };
  return body.status;
}

export async function listMcpTools(baseUrl = defaultLiveProjectionUrl(), options: { signal?: AbortSignal } = {}): Promise<McpToolDto[]> {
  const url = new URL(baseUrl);
  url.pathname = "/mcp/tools";
  url.search = "";
  const response = await fetch(url.toString(), { headers: { accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error(`MCP tools request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; tools: McpToolDto[] };
  return body.tools;
}

export async function listMcpAudit(
  baseUrl = defaultLiveProjectionUrl(),
  options: { limit?: number; signal?: AbortSignal } = {}
): Promise<McpAuditRowDto[]> {
  const url = new URL(baseUrl);
  url.pathname = "/mcp/audit";
  url.search = "";
  url.searchParams.set("limit", String(options.limit ?? 50));
  const response = await fetch(url.toString(), { headers: { accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error(`MCP audit request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; audit: McpAuditRowDto[] };
  return body.audit;
}

export async function getSettingsState(baseUrl = defaultLiveProjectionUrl(), options: { signal?: AbortSignal } = {}): Promise<SettingsStateDto> {
  const url = new URL(baseUrl);
  url.pathname = "/settings";
  url.search = "";
  const response = await fetch(url.toString(), { headers: { accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error(`settings request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; settings: SettingsStateDto };
  return body.settings;
}

export async function getCodexHookSettings(
  baseUrl = defaultLiveProjectionUrl(),
  options: { signal?: AbortSignal } = {}
): Promise<CodexHookSettingsDto> {
  const url = new URL(baseUrl);
  url.pathname = "/settings/hooks/codex";
  url.search = "";
  const response = await fetch(url.toString(), { headers: { accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error(`Codex hook settings request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; hooks: CodexHookSettingsDto };
  return body.hooks;
}

export async function installCodexHooks(baseUrl = defaultLiveProjectionUrl()): Promise<CodexHookSettingsDto> {
  return postCodexHookAction(baseUrl, "/settings/hooks/codex/install");
}

export async function uninstallCodexHooks(baseUrl = defaultLiveProjectionUrl()): Promise<CodexHookSettingsDto> {
  return postCodexHookAction(baseUrl, "/settings/hooks/codex/uninstall");
}

export async function testCodexHooks(baseUrl = defaultLiveProjectionUrl()): Promise<CodexHookSettingsDto> {
  return postCodexHookAction(baseUrl, "/settings/hooks/codex/test");
}

async function postCodexHookAction(baseUrl: string, pathname: string): Promise<CodexHookSettingsDto> {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  url.search = "";
  const response = await fetch(url.toString(), { headers: { accept: "application/json" }, method: "POST" });
  if (!response.ok) throw new Error(`Codex hook action failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; hooks: CodexHookSettingsDto };
  return body.hooks;
}

export async function getDataSummary(
  baseUrl = defaultLiveProjectionUrl(),
  scope?: DeleteMastheadDataScope,
  options: { databaseId?: string } = {}
): Promise<DataSummary> {
  const url = dataUrl(baseUrl, "/data/summary");
  if (scope) addScopeSearchParams(url, scope);
  if (options.databaseId) url.searchParams.set("databaseId", options.databaseId);
  const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`data summary request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; summary: DataSummary };
  return body.summary;
}

export async function applyDefaultRetention(
  baseUrl = defaultLiveProjectionUrl(),
  options: { databaseId?: string } = {}
): Promise<DataLifecycleResponse> {
  const response = await fetch(dataUrl(baseUrl, "/data/retention/default").toString(), {
    body: JSON.stringify({ databaseId: options.databaseId }),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  if (!response.ok) throw new Error(`default retention failed: ${response.status}`);
  return response.json() as Promise<DataLifecycleResponse>;
}

export async function deleteMastheadData(
  scope: DeleteMastheadDataScope = { kind: "all" },
  baseUrl = defaultLiveProjectionUrl(),
  options: { databaseId?: string } = {}
): Promise<DataLifecycleResponse> {
  const response = await fetch(dataUrl(baseUrl, "/data/delete").toString(), {
    body: JSON.stringify({ databaseId: options.databaseId, scope }),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  if (!response.ok) throw new Error(`data delete failed: ${response.status}`);
  return response.json() as Promise<DataLifecycleResponse>;
}

export async function exportMastheadData(baseUrl = defaultLiveProjectionUrl()): Promise<unknown> {
  const response = await fetch(dataUrl(baseUrl, "/data/export").toString(), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`data export failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; export: unknown };
  return body.export;
}

function dataUrl(baseUrl: string, pathname: string): URL {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  url.search = "";
  return url;
}

function addScopeSearchParams(url: URL, scope: DeleteMastheadDataScope): void {
  url.searchParams.set("kind", scope.kind);
  if (scope.kind === "session") url.searchParams.set("sessionId", scope.sessionId);
  if (scope.kind === "project") url.searchParams.set("project", scope.project);
  if (scope.kind === "runtime") url.searchParams.set("runtime", scope.runtime);
  if (scope.kind === "host") url.searchParams.set("host", scope.host);
}

export async function listReviewDispositions(baseUrl = defaultLiveProjectionUrl()): Promise<ReviewDisposition[]> {
  const url = new URL(baseUrl);
  url.pathname = "/review-dispositions";
  url.search = "";
  const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`review dispositions request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; dispositions: ReviewDisposition[] };
  return body.dispositions;
}

export async function saveReviewDisposition(disposition: ReviewDisposition, baseUrl = defaultLiveProjectionUrl()): Promise<void> {
  const url = new URL(baseUrl);
  url.pathname = "/review-dispositions";
  url.search = "";
  const response = await fetch(url.toString(), {
    body: JSON.stringify(disposition),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  if (!response.ok) throw new Error(`review disposition save failed: ${response.status}`);
}
