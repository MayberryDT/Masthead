export type ConnectionState =
  | {
      state: "connecting";
    }
  | {
      state: "offline";
      error?: string;
    }
  | {
      state: "live";
      events: number;
      gitSnapshots: number;
      diagnostics: number;
      generatedAt: string;
    };

type Props = {
  connection: ConnectionState;
  projectionUrl: string;
  showDemoData: boolean;
  onToggleDemoData: () => void;
};

export function ConnectionStatus({ connection, projectionUrl, showDemoData, onToggleDemoData }: Props) {
  return (
    <section className={`connection-strip ${connection.state} ${showDemoData ? "demo" : ""}`} aria-label="Live connection">
      <div className="connection-primary">
        <span className="connection-dot" aria-hidden="true" />
        <div>
          <p className="mono-label">{showDemoData ? "Demo replay" : connectionEyebrow(connection)}</p>
          <strong className="connection-title">{showDemoData ? "Viewing demo data" : connectionTitle(connection)}</strong>
        </div>
      </div>

      <div className="connection-detail">
        <p>{showDemoData ? "Fixture sessions are isolated from live Codex capture." : connectionDetail(connection)}</p>
        <span>{projectionUrl}</span>
      </div>

      <div className="connection-metrics" aria-label="Connection metrics">
        {connection.state === "live" ? (
          <>
            <Metric label="Events" value={connection.events} />
            <Metric label="Git" value={connection.gitSnapshots} />
            <Metric label="Diagnostics" value={connection.diagnostics} />
          </>
        ) : (
          <>
            <Metric label="Events" value={0} />
            <Metric label="Git" value={0} />
            <Metric label="Diagnostics" value={0} />
          </>
        )}
      </div>

      <button type="button" className="ghost-pill" onClick={onToggleDemoData}>
        {showDemoData ? "Return live" : "Demo data"}
      </button>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span className="mono-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function connectionEyebrow(connection: ConnectionState): string {
  if (connection.state === "live") return "Live collector";
  if (connection.state === "offline") return "Collector offline";
  return "Connecting";
}

function connectionTitle(connection: ConnectionState): string {
  if (connection.state === "live") return "Real Codex sessions";
  if (connection.state === "offline") return "No live connection";
  return "Connecting to local collector";
}

function connectionDetail(connection: ConnectionState): string {
  if (connection.state === "live") {
    return `Last projection ${formatTime(connection.generatedAt)}.`;
  }
  if (connection.state === "offline") {
    return connection.error ? "Local collector is not responding." : "Local collector unavailable.";
  }
  return "Waiting for the local projection endpoint.";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
