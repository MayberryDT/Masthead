import type { ChangeEvent } from "react";
import { searchHistory, type HistorySearchFilters, type HistorySession } from "../core/history";
import type { StoreRecord } from "../core/store";

type Props = {
  records: StoreRecord[];
  query: string;
  onQueryChange: (query: string) => void;
};

export function HistoryPanel({ records, query, onQueryChange }: Props) {
  const filters = filtersFromQuery(query);
  const result = searchHistory(records, filters);

  return (
    <section id="history" className="history-panel" aria-label="Local history">
      <header className="section-head">
        <div>
          <p className="mono-label">History</p>
          <h1>Local history</h1>
        </div>
        <strong>{result.sessions.length}</strong>
      </header>
      <label className="search-field history-search">
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
      <div className="history-results">
        {result.sessions.slice(0, maxVisibleHistorySessions).map((session) => (
          <article key={session.sessionId} className="history-item">
            <header>
              <div>
                <p className="mono-label">
                  {session.project} / {statusText(session.status)}
                </p>
                <h2>{historyHeadline(session)}</h2>
              </div>
              <span className="state-token">{outcomeText(session.outcome)}</span>
            </header>
            <dl className="history-facts">
              <div>
                <dt>Files</dt>
                <dd>{formatCount(session.changedPaths.length, "file changed", "files changed")}</dd>
              </div>
              <div>
                <dt>Commands</dt>
                <dd>{formatCount(Math.max(session.commands.length, session.commandIds.length), "command observed", "commands observed")}</dd>
              </div>
              <div>
                <dt>Alerts</dt>
                <dd>{formatCount(session.alertTypes.length, "follow-up signal", "follow-up signals")}</dd>
              </div>
              <div>
                <dt>Outcome</dt>
                <dd>{outcomeText(session.outcome)}</dd>
              </div>
              <div>
                <dt>Disposition</dt>
                <dd>{formatCount(session.dispositionStatuses.length, "review label", "review labels")}</dd>
              </div>
              <div>
                <dt>Records</dt>
                <dd>{session.records.length}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <p className="toolbar-result">
        Showing {Math.min(result.sessions.length, maxVisibleHistorySessions)} of {result.sessions.length}; searching{" "}
        {result.recordCount} local records
      </p>
    </section>
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
