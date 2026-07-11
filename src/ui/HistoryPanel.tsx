import { useEffect, useRef, useState, type PointerEvent } from "react";
import { searchHistory, type HistorySearchFilters, type HistorySession } from "../core/history";
import type { StoreRecord } from "../core/store";
import type {
  AdapterStatus,
  LogbookSort,
  SourceStatus
} from "../app/daemonClient";
import type { SessionSummaryEnrichment, SessionTitleEnrichment } from "../shared/sessionEnrichment";
import { LogbookFacets } from "./logbook/LogbookFacets";
import type { LogbookInspectorArtifact } from "../app/logbook/logbookInspectorModel";
import { LogbookInspector } from "./logbook/LogbookInspector";
import { LogbookTable } from "./logbook/LogbookTable";
import { LogbookToolbar } from "./logbook/LogbookToolbar";
import { logbookColumns } from "./logbook/logbookColumns";
import { Icon } from "./icons/Icon";
import { iconWeights } from "./icons/icon-tokens";
import { AppButton } from "./primitives/AppButton";

type Props = {
  records?: StoreRecord[];
  loadState?: LogbookLoadState;
  refreshError?: string;
  sessions?: LogbookSession[];
  query: string;
  total?: number;
  nextCursor?: string;
  loading?: boolean;
  sort?: LogbookSort;
  filters?: LogbookFilterState;
  filterOptions?: LogbookFilterOptions;
  density?: "comfortable" | "compact";
  selectedSessionId?: string;
  selectedArtifact?: LogbookInspectorArtifact;
  detailError?: string;
  detailLoading?: boolean;
  onCloseDetail?: () => void;
  sources?: SourceStatus[];
  adapters?: AdapterStatus[];
  connectionState?: "live" | "offline" | "incompatible" | "connecting";
  importBusy?: boolean;
  onFilterChange?: (filters: LogbookFilterState) => void;
  onImportMetadata?: (runtime: string) => void;
  onOpenSources?: () => void;
  onPageChange?: (pageIndex: number) => void;
  onQueryChange: (query: string) => void;
  onRetry?: () => void;
  onSessionSelect?: (sessionId: string) => void;
  onSortChange?: (sort: LogbookSort) => void;
  pageIndex?: number;
  pageSize?: number;
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
  enrichmentStatus?: "current" | "stale" | "failed" | "disabled" | "missing";
  sessionTitle?: SessionTitleEnrichment;
  sessionSummary?: SessionSummaryEnrichment;
  sourceConfidence?: "authoritative" | "inferred" | "heuristic";
};

export type LogbookFilterState = {
  kind?: string | string[];
  project?: string | string[];
  dateFrom?: string;
  dateTo?: string;
};

export type LogbookFilterOptions = {
  projects?: string[];
};

type EmptyReason = "no_sessions" | "sources_detected_not_imported" | "query_no_results" | "incompatible" | "offline";

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
  density = "compact",
  filterOptions,
  filters = {},
  importBusy = false,
  loadState,
  loading = false,
  nextCursor,
  onFilterChange,
  onImportMetadata,
  onOpenSources,
  onPageChange,
  onQueryChange,
  onRetry,
  onSessionSelect,
  onSortChange,
  pageIndex = 0,
  pageSize = 100,
  query,
  records = [],
  detailError,
  detailLoading = false,
  onCloseDetail,
  refreshError,
  selectedArtifact,
  selectedSessionId,
  sessions,
  sort = "recent",
  sources = [],
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
  const isLoading = loading || loadingState;
  const [optimisticPageIndex, setOptimisticPageIndex] = useState<number>();
  const totalPages = Math.max(1, Math.ceil(visibleTotal / pageSize));
  const requestedPageIndex = optimisticPageIndex ?? pageIndex;
  const visiblePageIndex = Math.min(Math.max(0, requestedPageIndex), totalPages - 1);
  const isOptimisticPaging = optimisticPageIndex !== undefined && (isLoading || pageIndex !== optimisticPageIndex);
  const wasLoadingRef = useRef(isLoading);
  const shouldAnimateLoadedPage = wasLoadingRef.current && !isLoading && !isOptimisticPaging && tableSessions.length > 0;
  useEffect(() => {
    wasLoadingRef.current = isLoading;
  }, [isLoading]);
  const showPagination = usesLogbookStore && Boolean(onPageChange) && visibleTotal > 0;
  const handlePageChange = (nextPageIndex: number) => {
    const boundedPageIndex = Math.min(Math.max(0, nextPageIndex), totalPages - 1);
    if (boundedPageIndex === visiblePageIndex) return;
    setOptimisticPageIndex(boundedPageIndex);
    onPageChange?.(boundedPageIndex);
  };
  const sourceSummary = sourceImportSummary(sources, adapters);
  const activeFilters = activeFilterFacets(query, filters, onQueryChange, onFilterChange);
  const hasActiveFilters = activeFilters.length > 0;
  const hasLogbookMeta = hasActiveFilters || Boolean(refreshError && tableSessions.length > 0);
  const isFirstRunLoading = isLoading && tableSessions.length === 0 && !errorState;
  const isPageLoading = (isLoading || isOptimisticPaging) && tableSessions.length > 0 && !errorState;
  useEffect(() => {
    if (optimisticPageIndex === undefined) return;
    if (!isOptimisticPaging || errorState) setOptimisticPageIndex(undefined);
  }, [errorState, isOptimisticPaging, optimisticPageIndex]);
  const emptyReason = emptyReasonFor({
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
  const logbookFooterClassName = [
    "logbook-footer",
    "observability-toolbar",
    "metal-toolbar",
    showPagination ? "has-pagination" : "",
    isFirstRunLoading ? "logbook-skeleton-footer" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section id="history" className={`history-panel logbook-panel surface-panel${hasLogbookMeta ? " has-meta" : ""}`} aria-label="Logbook">

      <LogbookToolbar
        filters={filters}
        filterOptions={filterOptions}
        query={query}
        sort={sort}
        onFilterChange={onFilterChange ?? (() => undefined)}
        onQueryChange={onQueryChange}
        onSortChange={onSortChange ?? (() => undefined)}
      />
      {hasLogbookMeta ? (
        <div className="logbook-meta">
          <LogbookFacets facets={activeFilters} />
          {refreshError && tableSessions.length > 0 ? <p className="toolbar-result surface-status">Logbook refresh failed: {refreshError}</p> : null}
        </div>
      ) : null}

      {errorState ? (
        <CanonicalErrorPanel message={errorState.message} onRetry={onRetry} />
      ) : isLoading && tableSessions.length === 0 ? (
        <LogbookSkeleton />
      ) : isPageLoading ? (
        <LogbookSkeleton mode="page" />
      ) : tableSessions.length === 0 ? (
        <EmptyPanel {...emptyState} />
      ) : (
        <div className={`logbook-master-detail${selectedSessionId || detailLoading ? " has-detail" : ""}`.trim()}>
          <div className="logbook-master-detail-list">
            <LogbookTable
              animateOnMount={shouldAnimateLoadedPage}
              density={density}
              sessions={tableSessions}
              selectedSessionId={selectedSessionId}
              updating={isLoading}
              onSelect={(sessionId) => onSessionSelect?.(sessionId)}
            />
          </div>
          {selectedSessionId || detailLoading || detailError ? (
            <div className="logbook-master-detail-inspector">
              <LogbookInspector
                artifact={selectedArtifact}
                error={detailError}
                loading={detailLoading}
                onClose={onCloseDetail ?? (() => undefined)}
              />
            </div>
          ) : null}
        </div>
      )}

      {!errorState && (showPagination || isFirstRunLoading) ? (
        <div className={logbookFooterClassName}>
          {isFirstRunLoading ? (
            <LogbookPaginationSkeleton />
          ) : showPagination ? (
            <LogbookPagination
              disabled={isLoading || isOptimisticPaging}
              pageIndex={visiblePageIndex}
              pageSize={pageSize}
              total={visibleTotal}
              onPageChange={handlePageChange}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function LogbookPagination({
  disabled,
  onPageChange,
  pageIndex,
  pageSize,
  total
}: {
  disabled: boolean;
  onPageChange: (pageIndex: number) => void;
  pageIndex: number;
  pageSize: number;
  total: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isFirst = pageIndex <= 0;
  const isLast = pageIndex >= totalPages - 1;
  const pointerStartedPageChangeRef = useRef(false);
  const goToPage = (nextPageIndex: number) => {
    onPageChange(Math.min(Math.max(0, nextPageIndex), totalPages - 1));
  };
  const handlePointerPageChange = (nextPageIndex: number) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" || event.pointerType === "touch" || event.pointerType === "pen") {
      pointerStartedPageChangeRef.current = true;
      goToPage(nextPageIndex);
    }
  };
  const handleClickPageChange = (nextPageIndex: number) => () => {
    if (pointerStartedPageChangeRef.current) {
      pointerStartedPageChangeRef.current = false;
      return;
    }
    goToPage(nextPageIndex);
  };

  return (
    <nav className="logbook-pagination" aria-label="Logbook pagination">
      <div className="logbook-pagination-controls">
        <button type="button" className="logbook-page-button toolbar-icon-button" aria-label="First page" disabled={disabled || isFirst} onPointerDown={handlePointerPageChange(0)} onClick={handleClickPageChange(0)}>
          <Icon name="pageFirst" size="toolbar" weight={iconWeights.toolbar} />
        </button>
        <button type="button" className="logbook-page-button toolbar-icon-button" aria-label="Previous page" disabled={disabled || isFirst} onPointerDown={handlePointerPageChange(pageIndex - 1)} onClick={handleClickPageChange(pageIndex - 1)}>
          <Icon name="pagePrevious" size="toolbar" weight={iconWeights.toolbar} />
        </button>
        <span className="logbook-pagination-page">
          Page {pageIndex + 1} of {totalPages}
        </span>
        <button type="button" className="logbook-page-button toolbar-icon-button" aria-label="Next page" disabled={disabled || isLast} onPointerDown={handlePointerPageChange(pageIndex + 1)} onClick={handleClickPageChange(pageIndex + 1)}>
          <Icon name="pageNext" size="toolbar" weight={iconWeights.toolbar} />
        </button>
        <button type="button" className="logbook-page-button toolbar-icon-button" aria-label="Last page" disabled={disabled || isLast} onPointerDown={handlePointerPageChange(totalPages - 1)} onClick={handleClickPageChange(totalPages - 1)}>
          <Icon name="pageLast" size="toolbar" weight={iconWeights.toolbar} />
        </button>
      </div>
    </nav>
  );
}

function LogbookPaginationSkeleton() {
  return (
    <nav className="logbook-pagination logbook-pagination-skeleton" aria-hidden="true">
      <div className="logbook-pagination-controls">
        <span className="logbook-page-button toolbar-icon-button" />
        <span className="logbook-page-button toolbar-icon-button" />
        <span className="logbook-skeleton-line logbook-skeleton-page" />
        <span className="logbook-page-button toolbar-icon-button" />
        <span className="logbook-page-button toolbar-icon-button" />
      </div>
    </nav>
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

function LogbookSkeleton({ mode = "initial" }: { mode?: "initial" | "page" }) {
  const isPageLoading = mode === "page";
  const skeletonRows = Array.from({ length: isPageLoading ? 16 : 24 }, (_, index) => index);

  return (
    <div
      className={`logbook-loading-state logbook-table-wrap logbook-skeleton-table-frame ${isPageLoading ? "logbook-page-loading" : ""}`.trim()}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={isPageLoading ? "Loading next Logbook page" : "Loading published artifacts"}
    >
      {isPageLoading ? null : (
        <div className="logbook-loading-copy" aria-hidden="true">
          <p className="mono-label">Logbook</p>
          <strong>Loading published artifacts</strong>
          <span>Hydrating the published artifact index.</span>
        </div>
      )}
      <table className="logbook-table compact logbook-skeleton-table" aria-hidden="true">
        <thead>
          <tr>
            {logbookColumns.map((column) => (
              <th key={column.key} scope="col" className={column.className}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {skeletonRows.map((row) => (
            <tr key={row} className="logbook-row compact logbook-skeleton-row">
              {logbookColumns.map((column, columnIndex) => (
                <td key={column.key} className={column.className}>
                  <span className={`logbook-skeleton-line skeleton-${columnIndex + 1}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <aside className="logbook-loading-inspector sr-only" aria-hidden="true" hidden>
        <span />
        <strong />
        <div />
        <div />
        <div />
      </aside>
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
  connectionState,
  hasActiveFilters,
  sourceSummary,
  usesLogbookStore,
  visibleTotal
}: {
  connectionState: Props["connectionState"];
  hasActiveFilters: boolean;
  sourceSummary: SourceImportSummary;
  usesLogbookStore: boolean;
  visibleTotal: number;
}): EmptyReason {
  if (connectionState === "offline") return "offline";
  if (connectionState === "incompatible") return "incompatible";
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
      message: "Masthead needs the local daemon before it can read published artifacts.",
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

  if (reason === "query_no_results") {
    return {
      reason,
      title: "No artifacts match these filters.",
      message: "The Logbook has published artifacts, but none match the active search, facet, date, or sort criteria.",
      support: options.activeFilters.length > 0 ? `Active filters: ${options.activeFilters.map((facet) => `${facet.label} ${facet.value}`).join(", ")}` : undefined,
      actions: [{ label: "Clear filters", onClick: options.onClearFilters, variant: "primary" }]
    };
  }

  if (reason === "sources_detected_not_imported") {
    const runtime = options.sourceSummary.metadataRuntime;
    return {
      reason,
      title: "Sources are detected but not imported.",
      message: "Masthead found local agent history stores. Import metadata, then compile and publish from Workbench to populate the Logbook.",
      support: `${formatCount(options.sourceSummary.detectedSources)} sources detected; ${formatCount(options.sourceSummary.discoveredSessions)} sessions available to import.`,
      actions: [
        { label: "Import metadata", onClick: runtime && options.onImportMetadata ? () => options.onImportMetadata?.(runtime) : undefined, disabled: options.importBusy, variant: "primary" },
        { label: "Open Sources", onClick: options.onOpenSources }
      ]
    };
  }

  return {
    reason,
    title: "No published artifacts yet.",
    message: "Compile and publish from Workbench.",
    actions: [{ label: "Open Sources", onClick: options.onOpenSources, variant: "primary" }]
  };
}

function activeFilterFacets(
  query: string,
  filters: LogbookFilterState,
  onQueryChange: (query: string) => void,
  onFilterChange: Props["onFilterChange"]
) {
  const facets: Array<{ label: string; value: string; onRemove?: () => void }> = [];
  if (query) facets.push({ label: "Query", value: query, onRemove: () => onQueryChange("") });

  const addMultiFilterFacet = (
    key: "kind" | "project",
    label: string,
    formatValue: (value: string) => string = (value) => value
  ) => {
    const raw = filters[key];
    const values = Array.isArray(raw) ? raw.filter(Boolean) : raw ? [raw] : [];
    for (const value of values) {
      facets.push({
        label,
        value: formatValue(value),
        onRemove: () => {
          const remaining = values.filter((item) => item !== value);
          onFilterChange?.({
            ...filters,
            [key]: remaining.length > 0 ? remaining : undefined
          });
        }
      });
    }
  };

  addMultiFilterFacet("kind", "Kind", kindFacetLabel);
  addMultiFilterFacet("project", "Project");

  if (filters.dateFrom) {
    facets.push({
      label: "From",
      value: filters.dateFrom,
      onRemove: () => onFilterChange?.({ ...filters, dateFrom: undefined })
    });
  }
  if (filters.dateTo) {
    facets.push({
      label: "To",
      value: filters.dateTo,
      onRemove: () => onFilterChange?.({ ...filters, dateTo: undefined })
    });
  }
  return facets;
}

function kindFacetLabel(kind: string): string {
  if (kind === "session_dossier") return "Session dossier";
  if (kind === "runbook") return "Runbook";
  if (kind === "adr") return "ADR";
  if (kind === "incident_timeline") return "Incident timeline";
  return kind;
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

function legacyToLogbookSession(session: HistorySession): LogbookSession {
  return {
    errorCount: session.status === "failed" || session.outcome === "failed" ? 1 : 0,
    fileCount: session.changedPaths.length,
    lastActivityAt: session.records.at(-1)?.observedAt,
    lifecycle: session.status,
    project: session.project,
    runtime: "claude_code",
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
