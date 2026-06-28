import { AppButton } from "../primitives/AppButton";

type Props = {
  busy?: boolean;
  status?: string;
  onConnectSources: () => void;
};

export function SourcesEmptyState({ busy = false, onConnectSources, status }: Props) {
  return (
    <section className="empty-session-state sources-empty-state" aria-label="No sources set up">
      <p className="mono-label">Sources</p>
      <h2>No sources set up</h2>
      <p>
        Capture new sessions now, or optionally import past sessions from local harness history.
      </p>
      <div className="surface-actions">
        <AppButton type="button" variant="primary" onClick={onConnectSources} disabled={busy}>
          Set up sources
        </AppButton>
      </div>
      <p className="surface-status">Local only / Live capture can start without historical import / Transcript import requires approval</p>
      {status ? <p className="sources-status surface-status">{status}</p> : null}
    </section>
  );
}
