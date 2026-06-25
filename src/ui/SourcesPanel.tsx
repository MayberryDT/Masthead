import type { SourceStatus } from "../app/daemonClient";
import { Icon, type IconName } from "./icons/Icon";
import { iconWeights } from "./icons/icon-tokens";

type Props = {
  sources: SourceStatus[];
  busy: boolean;
  status?: string;
  onRefresh: () => void;
  onImportCodexMetadata: () => void;
  onExcludePath: (path: string) => void;
};

export function SourcesPanel({ sources, busy, status, onRefresh, onImportCodexMetadata, onExcludePath }: Props) {
  const totals = sourceTotals(sources);

  return (
    <section id="sources" className="sources-panel surface-panel" aria-label="Session sources">
      <header className="surface-panel-head metal-surface">
        <div>
          <p className="mono-label">Sources</p>
          <h1>Data intake</h1>
        </div>
        <strong className="surface-count">{sources.length}</strong>
      </header>

      <div className="surface-panel-toolbar sources-toolbar">
        <div className="sources-actions">
          <button className="surface-action-button" type="button" onClick={onRefresh} disabled={busy}>
            <Icon name="recentActivity" size="inline" weight={iconWeights.inline} />
            Refresh
          </button>
          <button className="surface-action-button" type="button" onClick={onImportCodexMetadata} disabled={busy}>
            <Icon name="source" size="inline" weight={iconWeights.inline} />
            Import Codex metadata
          </button>
        </div>

        <div className="surface-panel-stats sources-stats" aria-label="Source summary">
          <SummaryStat label="Sources" value={sources.length} />
          <SummaryStat label="Sessions" value={totals.sessions} />
          <SummaryStat label="Imported" value={totals.imported} />
          <SummaryStat label="Queued" value={totals.queued} />
          <SummaryStat label="Failures" value={totals.failures} />
        </div>
      </div>

      {status ? <p className="toolbar-result surface-status">{status}</p> : null}

      {sources.length === 0 ? (
        <div className="empty-session-state surface-empty-state">
          <p className="mono-label">Sources</p>
          <h2>{busy ? "Scanning sources" : "No sources detected"}</h2>
          <p>{busy ? "Masthead is checking the local source index." : "Refresh or import Codex metadata to populate this intake view."}</p>
        </div>
      ) : (
        <div className="sources-list surface-card-grid">
          {sources.map((source) => (
            <SourceCard key={source.sourceId} source={source} busy={busy} onExcludePath={onExcludePath} />
          ))}
        </div>
      )}
    </section>
  );
}

function SourceCard({
  source,
  busy,
  onExcludePath
}: {
  source: SourceStatus;
  busy: boolean;
  onExcludePath: (path: string) => void;
}) {
  const sourcePath = source.path ?? source.detectedPath ?? source.sourceId;

  return (
    <article className={`source-item surface-data-card surface-fixed-card source-card metal-surface metal-card ${sourceToneClass(source)}`.trim()}>
      <header className="surface-card-head">
        <span className="card-session-name" title={`${labelForRuntime(source.runtime)} / ${sourceKindLabel(source.sourceKind)}`}>
          {labelForRuntime(source.runtime)}
        </span>
        <span className="card-harness">{sourceKindLabel(source.sourceKind)}</span>
        <span className={`state-token ${confidenceToneClass(source.confidence)}`.trim()}>{confidenceLabel(source.confidence)}</span>
      </header>

      <h2 title={sourcePath}>{sourcePath}</h2>

      <dl className="surface-card-facts history-facts">
        <SurfaceFact icon="sessions" label="Sessions" value={formatNumber(source.sessionCount ?? 0)} />
        <SurfaceFact icon="logbook" label="Imported" value={formatNumber(source.importedCount ?? 0)} />
        <SurfaceFact icon="recentActivity" label="Queued" value={formatNumber(source.queuedCount ?? 0)} />
        <SurfaceFact icon="alerts" label="Failures" value={formatNumber(source.failures ?? 0)} />
      </dl>

      <span className="surface-card-rule" aria-hidden="true" />

      <footer className="surface-card-footer">
        <span className="card-footer-meta">
          <Icon name="lastActivity" size="inline" weight={iconWeights.inline} />
          {formatLastSync(source.lastSync)}
        </span>
        {source.path ? (
          <button type="button" className="source-exclude-button" onClick={() => onExcludePath(source.path ?? "")} disabled={busy}>
            Exclude
          </button>
        ) : (
          <span className="timestamp">{shortId(source.sourceId)}</span>
        )}
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

function labelForRuntime(runtime: string): string {
  return runtime === "codex" ? "Codex" : runtime;
}

function sourceTotals(sources: SourceStatus[]) {
  return sources.reduce(
    (totals, source) => ({
      sessions: totals.sessions + (source.sessionCount ?? 0),
      imported: totals.imported + (source.importedCount ?? 0),
      queued: totals.queued + (source.queuedCount ?? 0),
      failures: totals.failures + (source.failures ?? 0)
    }),
    { sessions: 0, imported: 0, queued: 0, failures: 0 }
  );
}

function sourceToneClass(source: SourceStatus): string {
  if ((source.failures ?? 0) > 0) return "attention";
  if (source.confidence === "heuristic") return "inferred";
  return "healthy";
}

function confidenceToneClass(confidence: SourceStatus["confidence"]): string {
  if (confidence === "authoritative") return "";
  if (confidence === "heuristic") return "attention";
  return "neutral";
}

function confidenceLabel(confidence: SourceStatus["confidence"]): string {
  return confidence[0].toUpperCase() + confidence.slice(1);
}

function sourceKindLabel(sourceKind: string): string {
  return sourceKind.toUpperCase();
}

function formatLastSync(value: string | undefined): string {
  if (!value) return "Not synced";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `Synced ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function shortId(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}
