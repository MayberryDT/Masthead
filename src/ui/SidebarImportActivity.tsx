import type { ImportJob } from "../app/daemonClient";
import { latestImportCompletionReportsByRuntime } from "../shared/sourceImport";

export function SidebarImportActivity({ imports }: { imports: ImportJob[] }) {
  const active = imports.filter((job) => job.status === "queued" || job.status === "running" || job.status === "cancelling");
  const issueReports = latestImportCompletionReportsByRuntime(imports).filter(
    (report) => report.sessionsRepairRequired > 0 || report.recordsRejected > 0 || report.cappedUnits > 0 || report.anomalies.length > 0
  );
  if (active.length === 0 && issueReports.length === 0) return null;

  const current = active.find((job) => job.status === "running" || job.status === "cancelling");
  const waiting = active.filter((job) => job.status === "queued").length;
  const discoveredTotal = current?.totalWorkUnits ?? 0;
  const outsideThisPass = current?.skippedWorkUnits ?? 0;
  const selectedTotal = Math.max(0, discoveredTotal - outsideThisPass);
  const completed = current?.completedWorkUnits ?? 0;
  const remaining = Math.max(0, selectedTotal - completed - (current?.failedWorkUnits ?? 0));
  const progress = selectedTotal > 0 ? Math.min(100, (completed / selectedTotal) * 100) : 0;

  return (
    <aside className={`sidebar-import-activity ${current ? "is-updating" : "is-health"}`} aria-label="History import activity">
      <div className="sidebar-import-heading">
        <span>{current ? "Updating history" : "Import health"}</span>
        {current ? <span className="sidebar-import-live" aria-hidden="true" /> : null}
      </div>
      {current ? (
        <>
          <p className="sidebar-import-command">$ {runtimeLabel(current.sourceId)} {completed.toLocaleString()} / {(discoveredTotal || selectedTotal).toLocaleString()} discovered</p>
          <p className="sidebar-import-detail">
            {selectedTotal.toLocaleString()} scheduled · {remaining.toLocaleString()} remaining
          </p>
          {outsideThisPass > 0 ? <p className="sidebar-import-scope">{outsideThisPass.toLocaleString()} outside this pass</p> : null}
          <div className="sidebar-import-progress" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
        </>
      ) : (
        <p className="sidebar-import-command">$ Waiting to start</p>
      )}
      {waiting > 0 ? <p className="sidebar-import-waiting">{waiting} harness{waiting === 1 ? "" : "es"} waiting</p> : null}
      {issueReports.map((report) => (
        <div className="sidebar-import-receipt" key={report.importJobId}>
          <strong>{runtimeLabel(`${report.runtime}:receipt`)}</strong>
          <span>{report.recordsRecognized.toLocaleString()} recognized · {report.recordsRejected.toLocaleString()} rejected</span>
          <span>{report.sessionsFinalized.toLocaleString()} canonical · {report.sessionsOnPackagePath.toLocaleString()} package · {report.sessionsRepairRequired.toLocaleString()} repair</span>
          <span>{report.sessionsSuppressed.toLocaleString()} noise · {report.cappedUnits.toLocaleString()} capped</span>
        </div>
      ))}
    </aside>
  );
}

function runtimeLabel(sourceId: string): string {
  const runtime = sourceId.split(":", 1)[0];
  const labels: Record<string, string> = {
    claude_code: "Claude Code",
    codex: "Codex",
    cursor: "Cursor",
    grok: "Grok Build",
    hermes: "Hermes",
    omp: "Oh My Pi",
    opencode: "OpenCode",
    pi: "Pi"
  };
  return labels[runtime] ?? runtime.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
