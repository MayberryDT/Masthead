import type { SetupRunLogEntry, SetupRunReport } from "../../app/sources/setupPlanRunner";
import { StatusBadge } from "../primitives/StatusBadge";

type SetupRunProgressProps = {
  logs: SetupRunLogEntry[];
  report?: SetupRunReport;
};

export function SetupRunProgress({ logs, report }: SetupRunProgressProps) {
  const runInProgress = !report;
  const visibleLogs = latestSetupRunEntries(logs);
  return (
    <section className="setup-run-progress" aria-label="Setup progress">
      <div className="source-detail-section-head">
        <div>
          <p className="mono-label">Setup progress</p>
          <h3>{report ? (report.status === "succeeded" ? "Setup complete" : "Needs attention") : "Running setup"}</h3>
        </div>
        {report ? <StatusBadge tone={report.status === "succeeded" ? "active" : "warning"}>{report.status.replaceAll("_", " ")}</StatusBadge> : null}
      </div>
      <ol className="setup-run-log">
        {visibleLogs.map((entry) => (
          <li className={`setup-run-log-entry ${entry.status}`} key={entry.id}>
            <span className="setup-run-status">
              {runInProgress && entry.status === "running" ? <span className="setup-run-spinner" aria-hidden="true" /> : null}
              <span>{entry.status.replaceAll("_", " ")}</span>
            </span>
            <div>
              <strong>{entry.label}</strong>
              <p>{entry.message}</p>
            </div>
            <time>{entry.timestamp}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}

function latestSetupRunEntries(logs: SetupRunLogEntry[]): SetupRunLogEntry[] {
  const latestById = new Map<string, SetupRunLogEntry>();
  const taskOrder: string[] = [];

  for (const entry of logs) {
    if (!latestById.has(entry.id)) {
      taskOrder.push(entry.id);
    }
    latestById.set(entry.id, entry);
  }

  return taskOrder.map((id) => latestById.get(id)).filter((entry): entry is SetupRunLogEntry => Boolean(entry));
}
