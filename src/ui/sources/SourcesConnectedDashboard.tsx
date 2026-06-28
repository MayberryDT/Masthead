import type { AdapterStatus } from "../../app/daemonClient";
import { harnessForRuntime } from "../../adapters/harnessCatalog";
import type { RuntimeKind } from "../../adapters/types";
import type { SourcesSetupConnectedSourceDto, SourcesSetupCoverageDto } from "../../shared/sourcesSetup";
import { AppButton } from "../primitives/AppButton";

type Props = {
  adapters: AdapterStatus[];
  connectedSources?: SourcesSetupConnectedSourceDto[];
  coverage?: SourcesSetupCoverageDto;
  busy?: boolean;
  status?: string;
  onAddSource: () => void;
  onOpenLogbook?: () => void;
  onRepairMissingData: () => void;
  onShowAdvanced: () => void;
  onSyncSources: () => void;
};

const CONNECTED_SOURCE_PREVIEW_LIMIT = 12;

export function SourcesConnectedDashboard({
  adapters,
  busy = false,
  connectedSources,
  coverage: setupCoverage,
  onAddSource,
  onOpenLogbook,
  onRepairMissingData,
  onShowAdvanced,
  onSyncSources,
  status
}: Props) {
  const rows = connectedSources?.length ? connectedSources.map(sourceRowFromSetup) : adapters.map(sourceRowFromAdapter);
  const visibleRows = rows.slice(0, CONNECTED_SOURCE_PREVIEW_LIMIT);
  const coverage = setupCoverage ? normalizeSetupCoverage(setupCoverage) : coverageFromAdapters(adapters);
  const hasSyncTarget = adapters.length > 0 || rows.length > 0;
  return (
    <section className="sources-connected-dashboard" aria-label="Connected sources">
      <div className="sources-action-bar">
        <div>
          <p className="mono-label">Sources</p>
          <h2>Connected sources</h2>
          <p className="surface-status">{coverage.sessions} sessions · {coverage.transcripts} transcript sessions · {coverage.enriched} enriched</p>
        </div>
        <div className="sources-action-group">
          <AppButton type="button" onClick={onAddSource} disabled={busy}>
            Add source
          </AppButton>
          <AppButton type="button" variant="primary" onClick={onSyncSources} disabled={busy || !hasSyncTarget}>
            Sync sources
          </AppButton>
          <AppButton type="button" variant="quiet" onClick={onRepairMissingData} disabled={busy || !hasSyncTarget}>
            Repair missing data
          </AppButton>
          {onOpenLogbook ? (
            <AppButton type="button" variant="quiet" onClick={onOpenLogbook}>
              Open Logbook
            </AppButton>
          ) : null}
          <AppButton type="button" variant="quiet" onClick={onShowAdvanced}>
            Advanced diagnostics
          </AppButton>
        </div>
      </div>

      <dl className="sources-action-summary" aria-label="Source coverage summary">
        <div>
          <dt>Sessions</dt>
          <dd>{coverage.sessions}</dd>
        </div>
        <div>
          <dt>Transcripts</dt>
          <dd>{coverage.transcripts}</dd>
        </div>
        <div>
          <dt>Enriched</dt>
          <dd>{coverage.enriched}</dd>
        </div>
        <div>
          <dt>Queued</dt>
          <dd>{coverage.queued}</dd>
        </div>
        <div>
          <dt>Issues</dt>
          <dd>{coverage.failures}</dd>
        </div>
      </dl>

      {rows.length > CONNECTED_SOURCE_PREVIEW_LIMIT ? (
        <p className="surface-status">
          Showing {CONNECTED_SOURCE_PREVIEW_LIMIT} of {rows.length} connected source records. Open Advanced diagnostics for the full source inventory.
        </p>
      ) : null}

      <div className="source-adapter-grid connected-source-grid">
        {visibleRows.map((source) => (
          <article className="adapter-card connected-source-card" key={source.key}>
            <div className="adapter-card-head">
              <div>
                <p className="mono-label">{source.runtime}</p>
                <h3>{source.label}</h3>
              </div>
              <span className={`source-state ${source.state}`}>{source.state.replaceAll("_", " ")}</span>
            </div>
            <dl className="adapter-stat-grid">
              <div>
                <dt>Sessions</dt>
                <dd>{source.sessions}</dd>
              </div>
              <div>
                <dt>Locations</dt>
                <dd>{source.locations}</dd>
              </div>
              <div>
                <dt>Queued</dt>
                <dd>{source.queued}</dd>
              </div>
              <div>
                <dt>Issues</dt>
                <dd>{source.failures}</dd>
              </div>
            </dl>
            {source.lastSyncAt ? <p className="surface-status">Last sync {new Date(source.lastSyncAt).toLocaleString()}</p> : null}
          </article>
        ))}
      </div>
      {status ? <p className="sources-status surface-status">{status}</p> : null}
    </section>
  );
}

type SourceRow = {
  failures: number;
  key: string;
  label: string;
  lastSyncAt?: string;
  locations: number;
  queued: number;
  runtime: string;
  sessions: number;
  state: string;
};

function coverageFromAdapters(adapters: AdapterStatus[]) {
  return adapters.reduce(
    (totals, adapter) => ({
      enriched: totals.enriched + (adapter.policies.enrichment ? adapter.importedSessions : 0),
      failures: totals.failures + (adapter.failureCount ?? 0),
      queued: totals.queued + (adapter.queuedRecords ?? 0),
      sessions: totals.sessions + (adapter.importedSessions || adapter.discoveredSessions || 0),
      transcripts: totals.transcripts + (adapter.policies.transcriptImport ? adapter.importedSessions : 0)
    }),
    { enriched: 0, failures: 0, queued: 0, sessions: 0, transcripts: 0 }
  );
}

function normalizeSetupCoverage(coverage: SourcesSetupCoverageDto) {
  return {
    enriched: coverage.enriched ?? coverage.enrichedSessions ?? 0,
    failures: coverage.failures ?? coverage.failedImports ?? 0,
    queued: coverage.queued ?? 0,
    sessions: coverage.sessions,
    transcripts: coverage.transcripts ?? coverage.transcriptSessions ?? 0
  };
}

function sourceRowFromAdapter(adapter: AdapterStatus): SourceRow {
  return {
    failures: adapter.failureCount ?? 0,
    key: adapter.runtime,
    label: adapter.name ?? harnessForRuntime(adapter.runtime as RuntimeKind)?.label ?? adapter.runtime,
    lastSyncAt: adapter.lastSyncAt,
    locations: adapter.sourceLocationCount ?? adapter.sourceLocations.length,
    queued: adapter.queuedRecords ?? 0,
    runtime: adapter.runtime,
    sessions: adapter.importedSessions || adapter.discoveredSessions || 0,
    state: adapter.state
  };
}

function sourceRowFromSetup(source: SourcesSetupConnectedSourceDto): SourceRow {
  return {
    failures: source.failureCount ?? source.failures ?? 0,
    key: source.sourceId,
    label: source.label ?? source.runtime,
    lastSyncAt: source.lastSyncAt ?? source.lastSync,
    locations: source.path || source.detectedPath ? 1 : 0,
    queued: source.queuedRecords ?? source.queuedCount ?? 0,
    runtime: source.runtime,
    sessions: source.importedSessions ?? source.metadataSessions ?? source.discoveredSessions ?? source.sessions ?? source.sessionCount ?? source.importedCount ?? 0,
    state: source.state ?? source.status ?? "connected"
  };
}
