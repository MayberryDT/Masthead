import { searchHistory, type HistorySearchFilters, type HistorySession } from "../core/history";
import type { StoreRecord } from "../core/store";
import type {
  AdapterStatus,
  ImportJob,
  LogbookSearchFilters,
  LogbookSort,
  LogbookSummary,
  SourceStatus
} from "../app/daemonClient";
import { LogbookFacets } from "./logbook/LogbookFacets";
import { LogbookTable } from "./logbook/LogbookTable";
import { LogbookToolbar } from "./logbook/LogbookToolbar";
import { AppButton } from "./primitives/AppButton";
import { PageHeader } from "./primitives/PageHeader";
import { StatStrip, type StatStripItem } from "./primitives/StatStrip";
import { StatusBadge } from "./primitives/StatusBadge";

type Props = {
  records?: StoreRecord[];
  loadState?: LogbookLoadState;
  refreshError?: string;
  sessions?: LogbookSession[];
  query: string;
  total?: number;
  nextCursor?: string;
  loading?: boolean;
  summary?: LogbookSummary;
  sort?: LogbookSort;
  filters?: LogbookFilterState;
  filterOptions?: LogbookFilterOptions;
  density?: "comfortable" | "compact";
  selectedSessionId?: string;
  sources?: SourceStatus[];
  adapters?: AdapterStatus[];
  imports?: ImportJob[];
  connectionState?: "live" | "offline" | "incompatible" | "connecting";
  importBusy?: boolean;
  onDensityToggle?: () => void;
  onFilterChange?: (filters: LogbookFilterState) => void;
  onImportMetadata?: (runtime: string) => void;
  onLoadMore?: () => void;
  onOpenSources?: () => void;
  onQueryChange: (query: string) => void;
  onRetry?: () => void;
  onSessionSelect?: (sessionId: string) => void;
  onSortChange?: (sort: LogbookSort) => void;
};

export type LogbookLoadState =
  | { state: "loading" }
  | { state: "ready"; sessions: LogbookSession[]; total: number; nextCursor?: string }
  | { state: "error"; message: string };

export type LogbookSession = {
  sessionId: string;
  sourceSessionId?: string;
  title: string;
  objective?: string;
  outcome?: string;
  project?: string;
  runtime?: string;
  model?: string;
  models?: string[];
  hostId?: string;
  host?: string;
  branch?: string;
  lifecycle?: string;
  state?: string;
  startedAt?: string;
  snippet?: string;
  lastActivityAt?: string;
  endedAt?: string;
  topics?: string[];
  fileCount?: number;
  toolCount?: number;
  errorCount?: number;
  sourceConfidence?: "authoritative" | "inferred" | "heuristic";
};

export type LogbookFilterState = Pick<LogbookSearchFilters, "runtime" | "project" | "model" | "state" | "dateFrom" | "dateTo" | "file">;

export type LogbookFilterOptions = {
  runtimes?: string[];
  models?: string[];
  lifecycles?: string[];
};

type EmptyReason = "no_sessions" | "sources_detected_not_imported" | "import_running" | "query_no_results" | "incompatible" | "offline";

type EmptyAction = {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "primary";
};

type SourceImportSummary = {
  detectedSources: number;
  discoveredSessions: number;
  importedSessions: number;
  metadataRuntime?: string;
};

export function HistoryPanel({
  adapters = [],
  connectionState = "live",
  density = "comfortable",
  filterOptions,
  filters = {},
  importBusy = false,
  imports = [],
  loadState,
  loading = false,
  nextCursor,
  onDensityToggle,
  onFilterChange,
  onImportMetadata,
  onLoadMore,
  onOpenSources,
  onQueryChange,
  onRetry,
  onSessionSelect,
  onSortChange,
  query,
  records = [],
  refreshError,
  selectedSessionId,
  sessions,
  sort = "recent",
  sources = [],
  summary,
  total
}: Props) {
  const legacyFilters = filtersFromQuery(query);
  const resolvedLoadState =
    loadState ??
    (sessions !== undefined || total !== undefined
      ? ({ state: "ready", sessions: sessions ?? [], total: total ?? sessions?.length ?? 0, nextCursor } satisfies LogbookLoadState)
      : loading
        ? ({ state: "loading" } satisfies LogbookLoadState)
        : undefined);
  const usesLogbookStore = resolvedLoadState !== undefined;
  const result = usesLogbookStore ? undefined : searchHistory(records, legacyFilters);
  const readyState = resolvedLoadState?.state === "ready" ? resolvedLoadState : undefined;
  const errorState = resolvedLoadState?.state === "error" ? resolvedLoadState : undefined;
  const loadingState = resolvedLoadState?.state === "loading";
  const canonicalSessions = readyState?.sessions ?? [];
  const legacySessions = result?.sessions ?? [];
  const tableSessions = usesLogbookStore ? canonicalSessions : legacySessions.map(legacyToLogbookSession);
  const visibleTotal = readyState?.total ?? result?.sessions.length ?? tableSessions.length;
  const recordCount = result?.recordCount ?? visibleTotal;
  const visibleNextCursor = readyState?.nextCursor ?? nextCursor;
  const isLoading = loading || loadingState;
  const sourceSummary = sourceImportSummary(sources, adapters);
  const activeFilters = activeFilterFacets(query, filters, sort, onQueryChange, onFilterChange, onSortChange);
  const hasActiveFilters = activeFilters.length > 0;
  const emptyReason = emptyReasonFor({
    activeImports: hasActiveImports(imports),
    connectionState,
    hasActiveFilters,
    sourceSummary,
    usesLogbookStore,
    visibleTotal
  });
  const emptyState = emptyStateFor(emptyReason, {
    activeFilters,
    importBusy,
    onClearFilters: () => {
      onQueryChange("");
      onFilterChange?.({});
      onSortChange?.("recent");
    },
    onImportMetadata,
    onOpenSources,
    onRetry,
    sourceSummary
  });
  const summaryItems = summaryItemsFor(summary, visibleTotal, recordCount);

  return (
    <section id="history" className="history-panel logbook-panel surface-panel" aria-label="Logbook">
      <PageHeader
        eyebrow="Logbook"
        title="Session library"
        description="Search and inspect durable agent-session history."
        trailing={<StatusBadge tone={errorState ? "danger" : "info"}>{formatCount(visibleTotal)} sessions</StatusBadge>}
      />

      <LogbookToolbar
        density={density}
        filters={filters}
        filterOptions={filterOptions}
        query={query}
        sort={sort}
        onDensityToggle={onDensityToggle ?? (() => undefined)}
        onFilterChange={onFilterChange ?? (() => undefined)}
        onQueryChange={onQueryChange}
        onSortChange={onSortChange ?? (() => undefined)}
      />
      <LogbookFacets facets={activeFilters} />
      <StatStrip items={summaryItems} label="Logbook summary" />

      {isLoading && tableSessions.length > 0 ? <p className="toolbar-result surface-status">Refreshing Logbook results...</p> : null}
      {refreshError && tableSessions.length > 0 ? <p className="toolbar-result surface-status">Logbook refresh failed: {refreshError}</p> : null}

      {errorState ? (
        <CanonicalErrorPanel message={errorState.message} onRetry={onRetry} />
      ) : isLoading && tableSessions.length === 0 ? (
        <LogbookSkeleton />
      ) : tableSessions.length === 0 ? (
        <EmptyPanel {...emptyState} />
      ) : (
        <LogbookTable
          density={density}
          sessions={tableSessions}
          selectedSessionId={selectedSessionId}
          onSelect={(sessionId) => onSessionSelect?.(sessionId)}
        />
      )}

      {usesLogbookStore && visibleNextCursor && onLoadMore ? (
        <button type="button" className="surface-secondary-action" onClick={onLoadMore} disabled={isLoading}>
          Load more
        </button>
      ) : null}

      {errorState ? null : (
        <p className="toolbar-result surface-status">
          Showing {tableSessions.length} of {visibleTotal}; searching {recordCount} {usesLogbookStore ? "canonical sessions" : "local records"}
        </p>
      )}
    </section>
  );
}

function CanonicalErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty-session-state surface-empty-state" role="status" data-empty-reason="incompatible">
      <p className="mono-label">Logbook</p>
      <h2>Logbook could not read the Masthead session database.</h2>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="surface-secondary-action" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

function LogbookSkeleton() {
  return (
    <div className="logbook-skeleton" aria-label="Loading Logbook results">
      {Array.from({ length: 6 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

function EmptyPanel({ actions = [], message, reason, support, title }: { reason: EmptyReason; title: string; message: string; support?: string; actions?: EmptyAction[] }) {
  return (
    <div className="empty-session-state surface-empty-state logbook-empty-state" role="status" data-empty-reason={reason}>
      <p className="mono-label">Logbook / {reason}</p>
      <h2>{title}</h2>
      <p>{message}</p>
      {support ? <p className="surface-status">{support}</p> : null}
      {actions.length > 0 ? (
        <div className="logbook-empty-actions">
          {actions.map((action) => (
            <AppButton key={action.label} variant={action.variant ?? "default"} onClick={action.onClick} disabled={!action.onClick || action.disabled}>
              {action.label}
            </AppButton>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function emptyReasonFor({
  activeImports,
  connectionState,
  hasActiveFilters,
  sourceSummary,
  usesLogbookStore,
  visibleTotal
}: {
  activeImports: boolean;
  connectionState: Props["connectionState"];
  hasActiveFilters: boolean;
  sourceSummary: SourceImportSummary;
  usesLogbookStore: boolean;
  visibleTotal: number;
}): EmptyReason {
  if (connectionState === "offline") return "offline";
  if (connectionState === "incompatible") return "incompatible";
  if (activeImports) return "import_running";
  if (usesLogbookStore && visibleTotal === 0 && hasActiveFilters) return "query_no_results";
  if (sourceSummary.detectedSources > 0 && sourceSummary.importedSessions === 0) return "sources_detected_not_imported";
  return "no_sessions";
}

function emptyStateFor(
  reason: EmptyReason,
  options: {
    activeFilters: Array<{ label: string; value: string }>;
    importBusy: boolean;
    onClearFilters: () => void;
    onImportMetadata?: (runtime: string) => void;
    onOpenSources?: () => void;
    onRetry?: () => void;
    sourceSummary: SourceImportSummary;
  }
): { reason: EmptyReason; title: string; message: string; support?: string; actions?: EmptyAction[] } {
  if (reason === "offline") {
    return {
      reason,
      title: "Logbook is offline.",
      message: "Masthead needs the local daemon before it can read canonical session history.",
      actions: [
        { label: "Retry connection", onClick: options.onRetry, variant: "primary" },
        { label: "Open Sources", onClick: options.onOpenSources }
      ]
    };
  }

  if (reason === "incompatible") {
    return {
      reason,
      title: "Logbook API is incompatible.",
      message: "The UI reached a daemon, but the canonical Logbook API shape does not match this build.",
      actions: [{ label: "Retry", onClick: options.onRetry, variant: "primary" }]
    };
  }

  if (reason === "import_running") {
    return {
      reason,
      title: "Import is building the Logbook.",
      message: "Session metadata is queued or importing. Results will appear here when the canonical rows finish indexing.",
      support: "Use Sources to inspect job progress or cancel a stuck import.",
      actions: [{ label: "Open Sources", onClick: options.onOpenSources, variant: "primary" }]
    };
  }

  if (reason === "query_no_results") {
    return {
      reason,
      title: "No sessions match these filters.",
      message: "The canonical Logbook has sessions, but none match the active search, facet, date, file, or sort criteria.",
      support: options.activeFilters.length > 0 ? `Active filters: ${options.activeFilters.map((facet) => `${facet.label} ${facet.value}`).join(", ")}` : undefined,
      actions: [{ label: "Clear filters", onClick: options.onClearFilters, variant: "primary" }]
    };
  }

  if (reason === "sources_detected_not_imported") {
    const runtime = options.sourceSummary.metadataRuntime;
    return {
      reason,
      title: "Sources are detected but not imported.",
      message: "Masthead found local agent history stores, but the Logbook only reads canonical imported metadata.",
      support: `${formatCount(options.sourceSummary.detectedSources)} sources detected; ${formatCount(options.sourceSummary.discoveredSessions)} sessions available to import.`,
      actions: [
        { label: "Import metadata", onClick: runtime && options.onImportMetadata ? () => options.onImportMetadata?.(runtime) : undefined, disabled: options.importBusy, variant: "primary" },
        { label: "Open Sources", onClick: options.onOpenSources }
      ]
    };
  }

  return {
    reason,
    title: "No sessions imported yet.",
    message: "Discover local Codex, Claude, or other agent sources, then import metadata to populate the canonical Logbook.",
    actions: [{ label: "Open Sources", onClick: options.onOpenSources, variant: "primary" }]
  };
}

function activeFilterFacets(
  query: string,
  filters: LogbookFilterState,
  sort: LogbookSort,
  onQueryChange: (query: string) => void,
  onFilterChange: Props["onFilterChange"],
  onSortChange: Props["onSortChange"]
) {
  const facets: Array<{ label: string; value: string; onRemove?: () => void }> = [];
  if (query) facets.push({ label: "Query", value: query, onRemove: () => onQueryChange("") });
  const addFilterFacet = (key: keyof LogbookFilterState, label: string) => {
    const value = filters[key];
    if (!value) return;
    facets.push({ label, value, onRemove: () => onFilterChange?.({ ...filters, [key]: undefined }) });
  };
  addFilterFacet("runtime", "Runtime");
  addFilterFacet("project", "Project");
  addFilterFacet("model", "Model");
  addFilterFacet("state", "Lifecycle");
  addFilterFacet("dateFrom", "From");
  addFilterFacet("dateTo", "To");
  addFilterFacet("file", "File");
  if (sort !== "recent") facets.push({ label: "Sort", value: sortLabel(sort), onRemove: () => onSortChange?.("recent") });
  return facets;
}

function sourceImportSummary(sources: SourceStatus[], adapters: AdapterStatus[]): SourceImportSummary {
  const sourceRows = sources.length > 0 ? sources : adapters.flatMap((adapter) => adapter.sourceLocations);
  const detectedSources = sourceRows.length;
  const discoveredSessions =
    sourceRows.length > 0
      ? sourceRows.reduce((total, source) => total + (source.discoveredSessions ?? source.sessionCount ?? 0), 0)
      : adapters.reduce((total, adapter) => total + adapter.discoveredSessions, 0);
  const importedSessions =
    sourceRows.length > 0
      ? sourceRows.reduce((total, source) => total + (source.importedSessions ?? source.importedCount ?? 0), 0)
      : adapters.reduce((total, adapter) => total + adapter.importedSessions, 0);
  const metadataRuntime =
    adapters.find((adapter) => adapter.policies.metadataImport && adapter.discoveredSessions > adapter.importedSessions)?.runtime ??
    sourceRows.find((source) => (source.discoveredSessions ?? source.sessionCount ?? 0) > (source.importedSessions ?? source.importedCount ?? 0))?.runtime ??
    adapters.find((adapter) => adapter.policies.metadataImport)?.runtime ??
    sourceRows[0]?.runtime;
  return { detectedSources, discoveredSessions, importedSessions, metadataRuntime };
}

function hasActiveImports(imports: ImportJob[]): boolean {
  return imports.some((job) => job.status === "queued" || job.status === "running");
}

function summaryItemsFor(summary: LogbookSummary | undefined, visibleTotal: number, recordCount: number): StatStripItem[] {
  if (!summary) {
    return [
      { label: "Sessions", value: formatCount(visibleTotal) },
      { label: "Projects", value: "n/a" },
      { label: "Harnesses", value: "n/a" },
      { label: "Records", value: formatCount(recordCount) }
    ];
  }

  return [
    { label: "Sessions", value: formatCount(summary.sessions) },
    { label: "Projects", value: formatCount(summary.projects) },
    { label: "Harnesses", value: formatCount(summary.runtimes.length) },
    { label: "Messages", value: formatCount(summary.messages) },
    { label: "Tool calls", value: formatCount(summary.toolCalls) },
    { label: "Date range", value: dateRange(summary.earliestActivityAt, summary.latestActivityAt) }
  ];
}

function legacyToLogbookSession(session: HistorySession): LogbookSession {
  return {
    errorCount: session.status === "failed" || session.outcome === "failed" ? 1 : 0,
    fileCount: session.changedPaths.length,
    lastActivityAt: session.records.at(-1)?.observedAt,
    lifecycle: session.status,
    project: session.project,
    runtime: "codex",
    sessionId: session.sessionId,
    sourceSessionId: session.sessionId,
    title: historyHeadline(session),
    toolCount: Math.max(session.commands.length, session.commandIds.length)
  };
}

export function filtersFromQuery(query: string): HistorySearchFilters {
  const filters: HistorySearchFilters = {};
  const free: string[] = [];

  for (const token of tokenizeQuery(query)) {
    const [rawKey, ...rawValueParts] = token.split(":");
    const value = rawValueParts.join(":");
    if (!value) {
      free.push(token);
      continue;
    }

    const key = rawKey.toLowerCase();
    if (key === "project") filters.project = value;
    else if (key === "session") filters.sessionId = value;
    else if (key === "file" || key === "path") filters.filePath = value;
    else if (key === "command" || key === "cmd") filters.command = value;
    else if (key === "status") filters.status = value as HistorySearchFilters["status"];
    else if (key === "branch") filters.branch = value;
    else if (key === "alert") filters.alertType = value as HistorySearchFilters["alertType"];
    else if (key === "conflict") filters.conflictType = value as HistorySearchFilters["conflictType"];
    else if (key === "outcome") filters.outcome = value as HistorySearchFilters["outcome"];
    else if (key === "disposition") filters.disposition = value as HistorySearchFilters["disposition"];
    else free.push(token);
  }

  if (free.length > 0 && !filters.project) filters.project = free.join(" ");
  return filters;
}

function tokenizeQuery(query: string): string[] {
  const tokens: string[] = [];
  const pattern = /(?:[^\s"]+:"[^"]*"|"[^"]*"|[^\s"]+)/g;
  for (const match of query.matchAll(pattern)) {
    const token = match[0];
    const separator = token.indexOf(":");
    if (separator !== -1 && token[separator + 1] === "\"") {
      tokens.push(`${token.slice(0, separator)}:${token.slice(separator + 2, token.endsWith("\"") ? -1 : undefined)}`);
    } else if (token.startsWith("\"") && token.endsWith("\"")) {
      tokens.push(token.slice(1, -1));
    } else {
      tokens.push(token);
    }
  }
  return tokens.filter(Boolean);
}

function historyHeadline(session: HistorySession): string {
  if (session.status === "waiting_for_approval") return "Approval was pending";
  if (session.status === "waiting_for_user") return "Input was pending";
  if (session.status === "failed" || session.outcome === "failed") return "Session needs follow-up";
  if (session.status === "completed_reviewed" || session.outcome === "completed") return "Session is complete";
  if (session.outcome === "needs_attention") return "Session needs review";
  return "Session activity recorded";
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function dateRange(earliest: string | undefined, latest: string | undefined): string {
  if (!earliest || !latest) return "n/a";
  return `${formatMonth(earliest)} - ${formatMonth(latest)}`;
}

function formatMonth(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: "short", year: "numeric" });
}

function sortLabel(sort: LogbookSort): string {
  if (sort === "duration_desc") return "Duration";
  if (sort === "files_desc") return "Files changed";
  if (sort === "tools_desc") return "Tool calls";
  if (sort === "errors_desc") return "Errors";
  return sort[0].toUpperCase() + sort.slice(1);
}
