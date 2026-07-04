import type { MastheadConnectionState } from "../app/connection/MastheadConnectionProvider";
import { AppButton } from "./primitives/AppButton";

export type ConnectorActionView = {
  state: "idle" | "starting" | "started" | "unsupported" | "error";
  message?: string;
};

export type CollectorStartupLogEntry = {
  id: string;
  label: string;
  detail?: string;
  state: "pending" | "running" | "done" | "error";
};

type ConnectionRecoveryPanelProps = {
  connection: MastheadConnectionState;
  action?: ConnectorActionView;
  onRetry: () => void;
  onStart: () => void;
  retryLabel?: string;
  startupLog?: CollectorStartupLogEntry[];
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

export function ConnectionRecoveryPanel({ action, connection, onRetry, onStart, retryLabel, startupLog }: ConnectionRecoveryPanelProps) {
  const copy = recoveryCopy(connection, action);
  const message = messageFrom(connection);
  const hasStartupLog = startupLog !== undefined && startupLog.length > 0;
  const showStartup = action?.state !== undefined ? action.state !== "idle" || hasStartupLog : hasStartupLog;
  return (
    <section className={`connection-strip connection-recovery observability-toolbar metal-toolbar ${copy.tone}`} aria-label="Connection recovery">
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
          <AppButton variant="primary" onClick={onStart} disabled={action?.state === "starting"}>
            {copy.startLabel}
          </AppButton>
        ) : null}
        <AppButton variant="quiet" onClick={onRetry}>
          {retryLabel ?? copy.retryLabel}
        </AppButton>
      </div>

      {showStartup ? <ConnectionStartupStatus action={action} startupLog={startupLog ?? []} /> : null}
    </section>
  );
}

function ConnectionStartupStatus({ action, startupLog }: { action?: ConnectorActionView; startupLog: CollectorStartupLogEntry[] }) {
  const actionState = action?.state ?? "idle";
  const actionLabel = connectorActionLabel(actionState);
  const actionMessage = action?.message ?? actionLabel;

  return (
    <div className="connection-startup" aria-live={actionState === "starting" ? "polite" : undefined}>
      <div className="connection-startup-status">
        <span className={`connection-startup-dot ${actionState}`} aria-hidden="true" />
        <span className="mono-label">Collector startup</span>
        <strong>{actionLabel}</strong>
        {actionMessage !== actionLabel ? <span>{actionMessage}</span> : null}
      </div>

      {startupLog.length > 0 ? (
        <ol className="connection-startup-list" aria-label="Collector startup log">
          {startupLog.map((entry) => (
            <li key={entry.id} className={`connection-startup-entry ${entry.state}`}>
              <span className={`connection-startup-dot ${entry.state}`} aria-hidden="true" />
              <span className="connection-startup-copy">
                <span className="connection-startup-label">{entry.label}</span>
                {entry.detail ? <span className="connection-startup-detail">{entry.detail}</span> : null}
              </span>
              <span className="connection-startup-state">{startupLogStateLabel(entry.state)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function recoveryCopy(connection: MastheadConnectionState, action?: ConnectorActionView): RecoveryCopy {
  if (action?.state === "error") {
    return {
      eyebrow: "Collector startup failed",
      title: "Masthead could not finish connecting",
      detail: action.message ?? "The local collector startup reached an error before live surfaces could connect.",
      status: "Startup error",
      tone: "offline",
      startLabel: "Start collector",
      retryLabel: "Retry"
    };
  }

  if (action?.state === "unsupported") {
    return {
      eyebrow: "Collector startup unavailable",
      title: "This shell cannot start the collector",
      detail: action.message ?? "Start the local collector outside this app, then check the connection again.",
      status: "Unsupported",
      tone: "offline",
      retryLabel: "Check again"
    };
  }

  if (action?.state === "starting") {
    return {
      eyebrow: "Starting collector",
      title: "Masthead is starting the local collector",
      detail: action.message ?? "The app is requesting the bundled collector and connecting live surfaces.",
      status: "Starting",
      tone: "connecting",
      startLabel: "Start collector",
      retryLabel: "Check now"
    };
  }

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

function connectorActionLabel(state: ConnectorActionView["state"]): string {
  switch (state) {
    case "starting":
      return "Starting";
    case "started":
      return "Started";
    case "unsupported":
      return "Unsupported";
    case "error":
      return "Error";
    case "idle":
      return "Idle";
  }
}

function startupLogStateLabel(state: CollectorStartupLogEntry["state"]): string {
  switch (state) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "done":
      return "Done";
    case "error":
      return "Error";
  }
}
