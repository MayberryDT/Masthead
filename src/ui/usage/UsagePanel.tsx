import type { UsageStatsDto, UsageWindow } from "../../app/daemonClient";
import { UsageActivityTable } from "./UsageActivityTable";
import { UsageBreakdownTable } from "./UsageBreakdownTable";
import { UsageSummaryStrip } from "./UsageSummaryStrip";
import { UsageHint } from "./UsageHint";
import { formatUsageNumber } from "./formatUsage";

type Props = {
  stats?: UsageStatsDto;
  window: UsageWindow;
  loading?: boolean;
  error?: string;
  onWindowChange: (window: UsageWindow) => void;
  onRetry: () => void;
};

const WINDOWS: Array<{ value: UsageWindow; label: string }> = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" }
];

export function UsagePanel({ stats, window, loading = false, error, onWindowChange, onRetry }: Props) {
  const empty = stats && stats.totals.sessions === 0;
  const noTokens = stats && stats.totals.sessions > 0 && stats.totals.tokenRows === 0;

  return (
    <div className="usage-panel">
      <div className="usage-toolbar" aria-label="Usage window">
        {WINDOWS.map((option) => (
          <button
            key={option.value}
            className={option.value === window ? "active" : ""}
            type="button"
            onClick={() => onWindowChange(option.value)}
          >
            {option.label}
          </button>
        ))}
        <button type="button" onClick={onRetry}>
          Refresh
        </button>
      </div>

      {error ? (
        <section className="usage-state error">
          <h2>Usage unavailable</h2>
          <p>{error}</p>
          <button type="button" onClick={onRetry}>Retry</button>
        </section>
      ) : null}

      {loading && !stats ? (
        <section className="usage-state">
          <h2>Loading usage</h2>
          <p>Reading canonical session statistics.</p>
        </section>
      ) : null}

      {empty ? (
        <section className="usage-state">
          <h2>No usage records yet.</h2>
          <p>Import Codex metadata and transcripts from Sources to populate usage.</p>
        </section>
      ) : null}

      {noTokens ? (
        <section className="usage-state">
          <h2>Token usage is not imported yet.</h2>
          <p>Sessions are indexed, but no token usage has been imported yet.</p>
        </section>
      ) : null}

      {stats ? (
        <>
          <UsageSummaryStrip stats={stats} />
          <section className="usage-grid">
            <UsageBreakdownTable title="By model" rows={stats.byModel} kind="model" />
            <UsageBreakdownTable title="By project" rows={stats.byProject} kind="project" />
            <UsageBreakdownTable title="By runtime" rows={stats.byRuntime} kind="runtime" />
            <UsageActivityTable rows={stats.activity} />
          </section>
          <section className="usage-coverage">
            <h2>Data coverage</h2>
            <dl>
              <div><dt><UsageHint label="Sources" tip="Known local sources contributing session data." /></dt><dd>{formatUsageNumber(stats.coverage.sources)}</dd></div>
              <div><dt><UsageHint label="Imported" tip="Canonical sessions currently imported into Masthead." /></dt><dd>{formatUsageNumber(stats.coverage.importedSessions)}</dd></div>
              <div><dt><UsageHint label="With tokens" tip="Imported sessions that include token usage rows." /></dt><dd>{formatUsageNumber(stats.coverage.sessionsWithTokenUsage)}</dd></div>
              <div><dt><UsageHint label="Without tokens" tip="Imported sessions that do not have token usage rows yet." /></dt><dd>{formatUsageNumber(stats.coverage.sessionsWithoutTokenUsage)}</dd></div>
              <div><dt><UsageHint label="Enriched" tip="Sessions with current generated enrichment data." /></dt><dd>{formatUsageNumber(stats.coverage.currentEnrichments)}</dd></div>
              <div><dt><UsageHint label="MCP queries" tip="Read-only MCP requests served by Masthead." /></dt><dd>{formatUsageNumber(stats.coverage.mcpQueries)}</dd></div>
            </dl>
          </section>
        </>
      ) : null}
    </div>
  );
}
