import type { SetupRunLogEntry, SetupRunReport } from "../../app/sources/setupPlanRunner";
import { StatusBadge } from "../primitives/StatusBadge";

type SetupRunProgressProps = {
  logs: SetupRunLogEntry[];
  report?: SetupRunReport;
};

export function SetupRunProgress({ logs, report }: SetupRunProgressProps) {
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
        {logs.map((entry, index) => (
          <li className={`setup-run-log-entry ${entry.status}`} key={`${entry.id}:${index}`}>
            <span>{entry.status.replaceAll("_", " ")}</span>
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
