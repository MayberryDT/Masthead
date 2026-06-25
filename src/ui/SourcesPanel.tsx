import type { SourceStatus } from "../app/daemonClient";

type Props = {
  sources: SourceStatus[];
  busy: boolean;
  status?: string;
  onRefresh: () => void;
  onImportCodexMetadata: () => void;
  onExcludePath: (path: string) => void;
};

export function SourcesPanel({ sources, busy, status, onRefresh, onImportCodexMetadata, onExcludePath }: Props) {
  return (
    <section id="sources" className="sources-panel" aria-label="Session sources">
      <header className="section-head">
        <div>
          <p className="mono-label">Sources</p>
          <h1>Session sources</h1>
        </div>
        <div className="sources-actions">
          <button type="button" onClick={onRefresh} disabled={busy}>
            Refresh
          </button>
          <button type="button" onClick={onImportCodexMetadata} disabled={busy}>
            Import Codex metadata
          </button>
        </div>
      </header>
      {status ? <p className="toolbar-result">{status}</p> : null}
      <div className="sources-list">
        {sources.map((source) => (
          <article className="source-item" key={source.sourceId}>
            <header>
              <div>
                <p className="mono-label">
                  {labelForRuntime(source.runtime)} / {source.sourceKind}
                </p>
                <h2>{source.path ?? source.detectedPath ?? source.sourceId}</h2>
              </div>
              <span className="state-token">{source.confidence}</span>
            </header>
            <dl className="history-facts">
              <div>
                <dt>Sessions</dt>
                <dd>{source.sessionCount ?? 0}</dd>
              </div>
              <div>
                <dt>Imported</dt>
                <dd>{source.importedCount ?? 0}</dd>
              </div>
              <div>
                <dt>Queued</dt>
                <dd>{source.queuedCount ?? 0}</dd>
              </div>
              <div>
                <dt>Failures</dt>
                <dd>{source.failures ?? 0}</dd>
              </div>
            </dl>
            {source.path ? (
              <button type="button" className="source-exclude-button" onClick={() => onExcludePath(source.path ?? "")} disabled={busy}>
                Exclude source
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function labelForRuntime(runtime: string): string {
  return runtime === "codex" ? "Codex" : runtime;
}
