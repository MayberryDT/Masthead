import { searchHistory, type HistorySearchFilters, type HistorySession } from "../core/history";
import type { StoreRecord } from "../core/store";
import type { LogbookSort, LogbookSummary } from "../app/daemonClient";
import { LogbookFacets } from "./logbook/LogbookFacets";
import { LogbookTable } from "./logbook/LogbookTable";
import { LogbookToolbar } from "./logbook/LogbookToolbar";
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
  density?: "comfortable" | "compact";
  selectedSessionId?: string;
  onDensityToggle?: () => void;
  onQueryChange: (query: string) => void;
  onLoadMore?: () => void;
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

export function HistoryPanel({
  density = "comfortable",
  loadState,
  loading = false,
  nextCursor,
  onDensityToggle,
  onLoadMore,
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
  summary,
  total
}: Props) {
  const filters = filtersFromQuery(query);
  const resolvedLoadState =
    loadState ??
    (sessions !== undefined || total !== undefined
      ? ({ state: "ready", sessions: sessions ?? [], total: total ?? sessions?.length ?? 0, nextCursor } satisfies LogbookLoadState)
      : loading
        ? ({ state: "loading" } satisfies LogbookLoadState)
        : undefined);
  const usesLogbookStore = resolvedLoadState !== undefined;
  const result = usesLogbookStore ? undefined : searchHistory(records, filters);
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
        query={query}
        sort={sort}
        onDensityToggle={onDensityToggle ?? (() => undefined)}
        onQueryChange={onQueryChange}
        onSortChange={onSortChange ?? (() => undefined)}
      />
      <LogbookFacets facets={query ? [{ label: "Query", value: query, onRemove: () => onQueryChange("") }] : []} />
      <StatStrip items={summaryItems} label="Logbook summary" />

      {isLoading && tableSessions.length > 0 ? <p className="toolbar-result surface-status">Refreshing Logbook results...</p> : null}
      {refreshError && tableSessions.length > 0 ? <p className="toolbar-result surface-status">Logbook refresh failed: {refreshError}</p> : null}

      {errorState ? (
        <CanonicalErrorPanel message={errorState.message} onRetry={onRetry} />
      ) : isLoading && tableSessions.length === 0 ? (
        <LogbookSkeleton />
      ) : tableSessions.length === 0 ? (
        <EmptyPanel title="No matching sessions" message="Try a broader query or refresh the session source." />
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
    <div className="empty-session-state surface-empty-state" role="status">
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

function EmptyPanel({ title, message }: { title: string; message: string }) {
  return (
    <div className="empty-session-state surface-empty-state">
      <p className="mono-label">Logbook</p>
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
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
