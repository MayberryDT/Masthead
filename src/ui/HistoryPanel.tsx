import type { ChangeEvent } from "react";
import { searchHistory, type HistorySearchFilters, type HistorySession } from "../core/history";
import type { StoreRecord } from "../core/store";
import { Icon, type IconName } from "./icons/Icon";
import { iconWeights } from "./icons/icon-tokens";

type Props = {
  records?: StoreRecord[];
  sessions?: LogbookSession[];
  query: string;
  total?: number;
  loading?: boolean;
  onQueryChange: (query: string) => void;
};

export type LogbookSession = {
  sessionId: string;
  title: string;
  project?: string;
  runtime?: string;
  model?: string;
  host?: string;
  state?: string;
  snippet?: string;
  lastActivityAt?: string;
};

export function HistoryPanel({ records = [], sessions, query, total, loading = false, onQueryChange }: Props) {
  const filters = filtersFromQuery(query);
  const usesLogbookStore = sessions !== undefined || total !== undefined || loading;
  const result = usesLogbookStore ? undefined : searchHistory(records, filters);
  const visibleSessions = sessions ?? [];
  const legacySessions = result?.sessions ?? [];
  const visibleTotal = total ?? result?.sessions.length ?? visibleSessions.length;
  const recordCount = result?.recordCount ?? visibleTotal;
  const visibleCardCount = Math.min(usesLogbookStore ? visibleSessions.length : legacySessions.length, maxVisibleHistorySessions);

  return (
    <section id="history" className="history-panel surface-panel" aria-label="Logbook">
      <header className="surface-panel-head metal-surface">
        <div>
          <p className="mono-label">Logbook</p>
          <h1>Session memory</h1>
        </div>
        <strong className="surface-count">{visibleTotal}</strong>
      </header>

      <div className="surface-panel-toolbar">
        <label className="search-field history-search surface-search">
          <span className="mono-label">Search history</span>
          <input
            type="search"
            placeholder="Search project, status, files, commands, alerts, or outcome"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onQueryChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onQueryChange("");
            }}
          />
        </label>
        <div className="surface-panel-stats" aria-label="Logbook summary">
          <SummaryStat label="Indexed" value={visibleTotal} />
          <SummaryStat label="Showing" value={visibleCardCount} />
          <SummaryStat label="Records" value={recordCount} />
          <SummaryStat label="Mode" value={usesLogbookStore ? "SQLite" : "Local"} />
        </div>
      </div>

      {loading && visibleCardCount > 0 ? <p className="toolbar-result surface-status">Refreshing Logbook results...</p> : null}

      {loading && visibleCardCount === 0 ? (
        <EmptyPanel label="Logbook" title="Loading Logbook results" message="Session memory is being indexed." />
      ) : visibleCardCount === 0 ? (
        <EmptyPanel label="Logbook" title="No matching sessions" message="Try a broader query or refresh the session source." />
      ) : (
        <div className="history-results surface-card-grid">
          {usesLogbookStore
            ? visibleSessions
                .slice(0, maxVisibleHistorySessions)
                .map((session) => <LogbookSessionItem key={session.sessionId} session={session} />)
            : legacySessions
                .slice(0, maxVisibleHistorySessions)
                .map((session) => <LegacyHistoryItem key={session.sessionId} session={session} />)}
        </div>
      )}

      <p className="toolbar-result surface-status">
        Showing {visibleCardCount} of {visibleTotal}; searching {recordCount} local records
      </p>
    </section>
  );
}

function LogbookSessionItem({ session }: { session: LogbookSession }) {
  return (
    <article className={`history-item surface-data-card logbook-card metal-surface metal-card ${session.snippet ? "has-snippet" : ""}`.trim()}>
      <header className="surface-card-head">
        <span className="card-session-name" title={session.project ?? "Masthead"}>
          {session.project ?? "Masthead"}
        </span>
        <span className="card-harness">{runtimeLabel(session.runtime)}</span>
        <span className={`state-token ${stateToneClass(session.state)}`.trim()}>{statusLabel(session.state ?? "indexed")}</span>
      </header>

      <h2>{session.title}</h2>
      {session.snippet ? <HighlightedSnippet snippet={session.snippet} /> : null}

      <dl className="surface-card-facts history-facts">
        <SurfaceFact icon="logbook" label="Session" value={shortId(session.sessionId)} />
        <SurfaceFact icon="model" label="Model" value={session.model ?? "Not captured"} />
        <SurfaceFact icon="source" label="Host" value={session.host ?? "Local"} />
        <SurfaceFact icon="lastActivity" label="Activity" value={formatActivity(session.lastActivityAt)} />
      </dl>

      <span className="surface-card-rule" aria-hidden="true" />

      <footer className="surface-card-footer">
        <span className="card-footer-meta">
          <Icon name="lastActivity" size="inline" weight={iconWeights.inline} />
          Indexed
        </span>
        <span className="timestamp">{shortId(session.sessionId)}</span>
      </footer>
    </article>
  );
}

function HighlightedSnippet({ snippet }: { snippet: string }) {
  const parts = snippet.split(/(<mark>|<\/mark>)/g);
  let highlighted = false;

  return (
    <p className="history-snippet">
      {parts.map((part, index) => {
        if (part === "<mark>") {
          highlighted = true;
          return null;
        }
        if (part === "</mark>") {
          highlighted = false;
          return null;
        }
        if (!part) return null;
        return highlighted ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>;
      })}
    </p>
  );
}

function LegacyHistoryItem({ session }: { session: HistorySession }) {
  return (
    <article className={`history-item surface-data-card logbook-card metal-surface metal-card ${stateToneClass(session.outcome)}`.trim()}>
      <header className="surface-card-head">
        <span className="card-session-name" title={session.project}>
          {session.project}
        </span>
        <span className="card-harness">{statusText(session.status)}</span>
        <span className={`state-token ${stateToneClass(session.outcome)}`.trim()}>{outcomeText(session.outcome)}</span>
      </header>

      <h2>{historyHeadline(session)}</h2>

      <dl className="history-facts">
        <SurfaceFact icon="worktree" label="Files" value={formatCount(session.changedPaths.length, "file changed", "files changed")} />
        <SurfaceFact
          icon="runtime"
          label="Commands"
          value={formatCount(Math.max(session.commands.length, session.commandIds.length), "command observed", "commands observed")}
        />
        <SurfaceFact icon="alerts" label="Alerts" value={formatCount(session.alertTypes.length, "follow-up signal", "follow-up signals")} />
        <SurfaceFact icon="logbook" label="Records" value={String(session.records.length)} />
      </dl>

      <span className="surface-card-rule" aria-hidden="true" />

      <footer className="surface-card-footer">
        <span className="card-footer-meta">
          <Icon name="lastActivity" size="inline" weight={iconWeights.inline} />
          Outcome
        </span>
        <span>{outcomeText(session.outcome)}</span>
      </footer>
    </article>
  );
}

function SummaryStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="surface-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SurfaceFact({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div>
      <span className="fact-icon" aria-hidden="true">
        <Icon name={icon} size="cardMeta" weight={iconWeights.cardMeta} />
      </span>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EmptyPanel({ label, title, message }: { label: string; title: string; message: string }) {
  return (
    <div className="empty-session-state surface-empty-state">
      <p className="mono-label">{label}</p>
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
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

const maxVisibleHistorySessions = 6;

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

function statusText(status: HistorySession["status"]): string {
  return status.replaceAll("_", " ");
}

function outcomeText(outcome: HistorySession["outcome"]): string {
  return outcome.replaceAll("_", " ");
}

function formatCount(count: number, one: string, many: string): string {
  if (count === 0) return `No ${many}`;
  if (count === 1) return `1 ${one}`;
  return `${count} ${many}`;
}

function runtimeLabel(runtime: string | undefined): string {
  if (!runtime) return "Unknown";
  return runtime === "codex" ? "Codex" : runtime;
}

function statusLabel(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function stateToneClass(value: string | undefined): string {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("fail") || normalized.includes("attention") || normalized.includes("blocked")) return "attention";
  if (normalized.includes("unknown") || normalized.includes("pending")) return "neutral";
  return "";
}

function shortId(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatActivity(value: string | undefined): string {
  if (!value) return "Not captured";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
