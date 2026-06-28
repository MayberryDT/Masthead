import { AppButton } from "../primitives/AppButton";

type Props = {
  busy?: boolean;
  status?: string;
  onConnectSources: () => void;
  onShowAdvanced: () => void;
};

export function SourcesEmptyState({ busy = false, onConnectSources, onShowAdvanced, status }: Props) {
  return (
    <section className="empty-session-state sources-empty-state" aria-label="No sources connected">
      <p className="mono-label">Sources</p>
      <h2>No sources connected</h2>
      <p>
        Masthead builds a private local session library from your AI coding tools. Connect local sources to import transcripts, normalize sessions, and enrich them for Logbook and MCP.
      </p>
      <div className="surface-actions">
        <AppButton type="button" variant="primary" onClick={onConnectSources} disabled={busy}>
          Connect sources
        </AppButton>
        <AppButton type="button" variant="quiet" onClick={onShowAdvanced}>
          Advanced diagnostics
        </AppButton>
      </div>
      <p className="surface-status">Local only · No cloud sync required · Transcript import requires approval</p>
      {status ? <p className="sources-status surface-status">{status}</p> : null}
    </section>
  );
}
