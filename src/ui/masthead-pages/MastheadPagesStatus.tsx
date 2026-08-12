import type { MastheadPagesConnectionState } from "../../app/desktopBridge";
import type { MastheadPagesPublicationOutcome } from "../../app/mastheadPages/types";

type Props = {
  connection?: MastheadPagesConnectionState;
  outcome?: MastheadPagesPublicationOutcome;
  error?: string;
};

export function MastheadPagesStatus({ connection, error, outcome }: Props) {
  return (
    <div className="masthead-pages-status" aria-label="Masthead Pages status">
      <p className="mono-label">Connection</p>
      <p>{connectionLabel(connection)}</p>
      {outcome && outcome.kind !== "idle" ? (
        <div className="masthead-pages-status-outcome" role="status">
          <p className="mono-label">Publication</p>
          <p>{outcomeLabel(outcome)}</p>
          {outcome.kind === "published" && outcome.friendlyUrl ? (
            <p>
              <a href={outcome.friendlyUrl} rel="noreferrer" target="_blank">
                {outcome.friendlyUrl}
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="masthead-pages-status-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function connectionLabel(connection?: MastheadPagesConnectionState): string {
  if (!connection) return "Desktop unavailable";
  if (connection.status === "disconnected") return "Disconnected";
  if (connection.status === "secure_storage_unavailable") {
    return `Secure storage unavailable (${connection.reason})`;
  }
  const handle = connection.account.handle ? `@${connection.account.handle}` : connection.account.accountId;
  return `Connected as ${handle} · ${connection.account.publisherAccess}`;
}

function outcomeLabel(outcome: MastheadPagesPublicationOutcome): string {
  if (outcome.kind === "publishing") return "Publishing to Masthead Pages…";
  if (outcome.kind === "removing") return "Removing from Masthead Pages…";
  if (outcome.kind === "published") {
    return outcome.result.status === "idempotent-replay"
      ? "Already published (idempotent replay)."
      : "Published to Masthead Pages.";
  }
  if (outcome.kind === "removed") {
    return "Removed from Masthead Pages. Local Logbook content is unchanged.";
  }
  if (outcome.kind === "failed") {
    return outcome.retryable ? `Operation failed (retryable): ${outcome.message}` : `Operation failed: ${outcome.message}`;
  }
  return "";
}
