import { defaultLiveProjectionUrl } from "./liveProjectionClient";
import type { ReviewDisposition } from "../core/store";

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
};

export type AdapterStatus = {
  runtime: string;
  state: "connected" | "degraded" | "disabled" | "not_detected";
  discoveredSessions: number;
  importedSessions: number;
  lastSyncAt?: string;
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
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  discoveredCount: number;
  importedCount: number;
  queuedCount: number;
  failureCount: number;
  updatedAt: string;
  failureMessage?: string;
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
  file?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  cursor?: string;
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

export async function listSources(baseUrl = defaultLiveProjectionUrl()): Promise<SourceStatus[]> {
  const url = new URL(baseUrl);
  url.pathname = "/sources";
  url.search = "";
  const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`sources request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; sources: SourceStatus[] };
  return body.sources;
}

export async function listAdapters(baseUrl = defaultLiveProjectionUrl()): Promise<AdapterStatus[]> {
  const url = new URL(baseUrl);
  url.pathname = "/adapters";
  url.search = "";
  const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`adapters request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; adapters: AdapterStatus[] };
  return body.adapters;
}

export async function importCodexMetadata(baseUrl = defaultLiveProjectionUrl()): Promise<{ imported: number; sources: number }> {
  const url = new URL(baseUrl);
  url.pathname = "/sources/codex/import-metadata";
  url.search = "";
  const response = await fetch(url.toString(), { method: "POST", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`codex metadata import failed: ${response.status}`);
  return response.json() as Promise<{ imported: number; sources: number }>;
}

export async function startImport(
  input: { sourceId: string; kind: ImportJob["importKind"] },
  baseUrl = defaultLiveProjectionUrl()
): Promise<ImportJob> {
  const url = new URL(baseUrl);
  url.pathname = "/imports";
  url.search = "";
  const response = await fetch(url.toString(), {
    body: JSON.stringify(input),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  if (!response.ok) throw new Error(`import request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; job: ImportJob };
  return body.job;
}

export async function listImports(baseUrl = defaultLiveProjectionUrl()): Promise<ImportJob[]> {
  const url = new URL(baseUrl);
  url.pathname = "/imports";
  url.search = "";
  const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`imports request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; imports: ImportJob[] };
  return body.imports;
}

export async function addSourceExclusion(input: SourceExclusionInput, baseUrl = defaultLiveProjectionUrl()): Promise<void> {
  const url = new URL(baseUrl);
  url.pathname = "/sources/exclusions";
  url.search = "";
  const response = await fetch(url.toString(), {
    body: JSON.stringify(input),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  if (!response.ok) throw new Error(`source exclusion failed: ${response.status}`);
}

export async function searchLogbook(
  input: string | LogbookSearchFilters,
  baseUrl = defaultLiveProjectionUrl(),
  options: { signal?: AbortSignal } = {}
): Promise<LogbookSearchResult> {
  const url = new URL(baseUrl);
  url.pathname = "/sessions";
  url.search = "";
  const filters: LogbookSearchFilters = typeof input === "string" ? { q: input } : input;
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") url.searchParams.set(key === "q" ? "q" : key, String(value));
  }
  const response = await fetch(url.toString(), { headers: { accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error(`logbook search failed: ${response.status}`);
  return response.json() as Promise<LogbookSearchResult>;
}

export async function getLogbookSummary(baseUrl = defaultLiveProjectionUrl(), options: { signal?: AbortSignal } = {}): Promise<LogbookSummary> {
  const url = new URL(baseUrl);
  url.pathname = "/logbook/summary";
  url.search = "";
  const response = await fetch(url.toString(), { headers: { accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error(`logbook summary failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; summary: LogbookSummary };
  return body.summary;
}

export async function getLogbookSession(
  sessionId: string,
  baseUrl = defaultLiveProjectionUrl(),
  options: { signal?: AbortSignal } = {}
): Promise<LogbookSessionDetail> {
  const url = new URL(baseUrl);
  url.pathname = `/sessions/${encodeURIComponent(sessionId)}`;
  url.search = "";
  const response = await fetch(url.toString(), { headers: { accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error(`session detail failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; session: LogbookSessionDetail };
  return body.session;
}

export async function getLogbookSessionExcerpts(
  sessionId: string,
  input: { q?: string; limit?: number } = {},
  baseUrl = defaultLiveProjectionUrl(),
  options: { signal?: AbortSignal } = {}
): Promise<LogbookExcerpt[]> {
  const url = new URL(baseUrl);
  url.pathname = `/sessions/${encodeURIComponent(sessionId)}/excerpts`;
  url.search = "";
  if (input.q) url.searchParams.set("q", input.q);
  if (input.limit) url.searchParams.set("limit", String(input.limit));
  const response = await fetch(url.toString(), { headers: { accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error(`session excerpts failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; excerpts: LogbookExcerpt[] };
  return body.excerpts;
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

export async function getDataSummary(baseUrl = defaultLiveProjectionUrl(), scope?: DeleteMastheadDataScope): Promise<DataSummary> {
  const url = dataUrl(baseUrl, "/data/summary");
  if (scope) addScopeSearchParams(url, scope);
  const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`data summary request failed: ${response.status}`);
  const body = (await response.json()) as { ok: true; summary: DataSummary };
  return body.summary;
}

export async function applyDefaultRetention(baseUrl = defaultLiveProjectionUrl()): Promise<DataLifecycleResponse> {
  const response = await fetch(dataUrl(baseUrl, "/data/retention/default").toString(), {
    headers: { accept: "application/json" },
    method: "POST"
  });
  if (!response.ok) throw new Error(`default retention failed: ${response.status}`);
  return response.json() as Promise<DataLifecycleResponse>;
}

export async function deleteMastheadData(
  scope: DeleteMastheadDataScope = { kind: "all" },
  baseUrl = defaultLiveProjectionUrl()
): Promise<DataLifecycleResponse> {
  const response = await fetch(dataUrl(baseUrl, "/data/delete").toString(), {
    body: JSON.stringify({ scope }),
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
