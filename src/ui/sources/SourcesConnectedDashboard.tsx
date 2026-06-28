import type { AdapterStatus } from "../../app/daemonClient";
import { AppButton } from "../primitives/AppButton";

type Props = {
  adapters: AdapterStatus[];
  busy?: boolean;
  status?: string;
  onAddSource: () => void;
  onRepairMissingData: () => void;
  onShowAdvanced: () => void;
  onSyncSources: () => void;
};

export function SourcesConnectedDashboard({ adapters, busy = false, onAddSource, onRepairMissingData, onShowAdvanced, onSyncSources, status }: Props) {
  const coverage = coverageFromAdapters(adapters);
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
          <AppButton type="button" variant="primary" onClick={onSyncSources} disabled={busy || adapters.length === 0}>
            Sync sources
          </AppButton>
          <AppButton type="button" variant="quiet" onClick={onRepairMissingData} disabled={busy || adapters.length === 0}>
            Repair missing data
          </AppButton>
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

      <div className="source-adapter-grid connected-source-grid">
        {adapters.map((adapter) => (
          <article className="adapter-card connected-source-card" key={adapter.runtime}>
            <div className="adapter-card-head">
              <div>
                <p className="mono-label">{adapter.runtime}</p>
                <h3>{adapter.name ?? adapter.runtime}</h3>
              </div>
              <span className={`source-state ${adapter.state}`}>{adapter.state.replaceAll("_", " ")}</span>
            </div>
            <dl className="adapter-stat-grid">
              <div>
                <dt>Sessions</dt>
                <dd>{adapter.importedSessions || adapter.discoveredSessions || 0}</dd>
              </div>
              <div>
                <dt>Locations</dt>
                <dd>{adapter.sourceLocationCount ?? adapter.sourceLocations.length}</dd>
              </div>
              <div>
                <dt>Queued</dt>
                <dd>{adapter.queuedRecords ?? 0}</dd>
              </div>
              <div>
                <dt>Issues</dt>
                <dd>{adapter.failureCount ?? 0}</dd>
              </div>
            </dl>
            {adapter.lastSyncAt ? <p className="surface-status">Last sync {new Date(adapter.lastSyncAt).toLocaleString()}</p> : null}
          </article>
        ))}
      </div>
      {status ? <p className="sources-status surface-status">{status}</p> : null}
    </section>
  );
}

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
