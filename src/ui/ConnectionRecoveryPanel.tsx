import type { MastheadConnectionState } from "../app/connection/MastheadConnectionProvider";
import { AppButton } from "./primitives/AppButton";

type ConnectionRecoveryPanelProps = {
  connection: MastheadConnectionState;
  onRetry: () => void;
  onStart: () => void;
  retryLabel?: string;
};

type RecoveryCopy = {
  eyebrow: string;
  title: string;
  detail: string;
  status: string;
  tone: "live" | "offline" | "connecting";
  startLabel?: string;
  retryLabel: string;
};

export function ConnectionRecoveryPanel({ connection, onRetry, onStart, retryLabel }: ConnectionRecoveryPanelProps) {
  const copy = recoveryCopy(connection);
  const message = messageFrom(connection);
  return (
    <section className={`connection-strip ${copy.tone}`} aria-label="Connection recovery">
      <div className="connection-primary">
        <span className="connection-dot" aria-hidden="true" />
        <div>
          <p className="mono-label">{copy.eyebrow}</p>
          <strong className="connection-title">{copy.title}</strong>
        </div>
      </div>

      <div className="connection-detail">
        <p>{copy.detail}</p>
        {message ? <span>{message}</span> : null}
      </div>

      <span className="source-token">{copy.status}</span>

      <div className="nav-actions">
        {copy.startLabel ? (
          <AppButton variant="primary" onClick={onStart}>
            {copy.startLabel}
          </AppButton>
        ) : null}
        <AppButton variant="quiet" onClick={onRetry}>
          {retryLabel ?? copy.retryLabel}
        </AppButton>
      </div>
    </section>
  );
}

function recoveryCopy(connection: MastheadConnectionState): RecoveryCopy {
  const state = connection.state as string;

  if (state === "incompatible") {
    return {
      eyebrow: "Connection blocked",
      title: "Legacy daemon detected",
      detail:
        "Masthead reached a daemon, but its /health response is from an older collector. Start a compatible collector before using live control surfaces.",
      status: "Incompatible",
      tone: "offline",
      startLabel: "Start compatible collector",
      retryLabel: "Check again"
    };
  }

  if (state === "offline") {
    return {
      eyebrow: "Collector offline",
      title: "No Masthead daemon is responding",
      detail: "The local projection endpoint is unreachable. Start the collector, then retry the connection check.",
      status: "Offline",
      tone: "offline",
      startLabel: "Start collector",
      retryLabel: "Retry"
    };
  }

  if (state === "read_only") {
    return {
      eyebrow: "Read-only bridge",
      title: "Live data is available without write access",
      detail:
        "Masthead can read the projection, but mutating daemon actions stay disabled until a writable collector is available.",
      status: "Read only",
      tone: "live",
      startLabel: "Start writable collector",
      retryLabel: "Recheck access"
    };
  }

  if (state === "checking" || state === "probing") {
    return {
      eyebrow: "Checking connection",
      title: "Probing the Masthead daemon",
      detail: "Masthead is checking the active projection URL before enabling live recovery actions.",
      status: "Probing",
      tone: "connecting",
      retryLabel: "Check now"
    };
  }

  return {
    eyebrow: "Connection ready",
    title: "Masthead daemon is ready",
    detail: "Live projection data is reachable. If this surface still looks stale, run a recovery check.",
    status: state === "ready" ? "Ready" : "Connected",
    tone: "live",
    retryLabel: "Refresh status"
  };
}

function messageFrom(connection: MastheadConnectionState): string | undefined {
  if ("message" in connection && typeof connection.message === "string" && connection.message.trim().length > 0) {
    return connection.message;
  }
  if ("error" in connection && typeof connection.error === "string" && connection.error.trim().length > 0) {
    return connection.error;
  }

  return undefined;
}
