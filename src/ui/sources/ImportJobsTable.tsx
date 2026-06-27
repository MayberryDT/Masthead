import type { ImportJob } from "../../app/daemonClient";
import { AppButton } from "../primitives/AppButton";
import { StatusBadge, type StatusBadgeTone } from "../primitives/StatusBadge";

type Props = {
  busy?: boolean;
  imports: ImportJob[];
  onCancelImport?: (importJobId: string) => void;
  onRetryImport?: (importJobId: string) => void;
};

export function ImportJobsTable({ busy = false, imports, onCancelImport, onRetryImport }: Props) {
  if (imports.length === 0) return null;
  return (
    <section className="import-jobs-section" aria-label="Import jobs">
      <p className="mono-label">IMPORT JOBS</p>
      <div className="import-jobs-table-frame">
        <table className="import-jobs-table">
          <thead>
            <tr>
              <th>Started</th>
              <th>Source</th>
              <th>Type</th>
              <th>Progress</th>
              <th>Current path</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {imports.map((job) => (
              <tr key={job.importJobId}>
                <td>{formatTime(job.updatedAt)}</td>
                <td>{job.sourceId}</td>
                <td>{job.importKind}</td>
                <td>{formatProgress(job)}</td>
                <td>{job.currentPath ?? "—"}</td>
                <td>
                  <StatusBadge tone={statusTone(job.status)}>{job.status}</StatusBadge>
                  {job.failureMessage ? <p className="surface-status import-job-failure">{job.failureMessage}</p> : null}
                </td>
                <td>{jobAction(job, { busy, onCancelImport, onRetryImport })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function jobAction(
  job: ImportJob,
  actions: Pick<Props, "busy" | "onCancelImport" | "onRetryImport">
) {
  if (job.status === "queued" || job.status === "running") {
    return (
      <AppButton
        variant="quiet"
        disabled={actions.busy || !actions.onCancelImport}
        onClick={() => actions.onCancelImport?.(job.importJobId)}
      >
        Cancel
      </AppButton>
    );
  }
  if (job.status === "cancelling") {
    return <span className="surface-status">Cancelling</span>;
  }
  if (job.status === "failed" || job.status === "cancelled") {
    return (
      <AppButton
        variant="quiet"
        disabled={actions.busy || !actions.onRetryImport}
        onClick={() => actions.onRetryImport?.(job.importJobId)}
      >
        Retry
      </AppButton>
    );
  }
  return <span className="surface-status">Complete</span>;
}

function formatProgress(job: ImportJob): string {
  const current = job.progressCurrent ?? job.processedCount ?? job.importedCount;
  const total = job.progressTotal ?? job.discoveredCount;
  const percent = job.progressPercent ?? (total > 0 ? Math.round((current / total) * 100) : undefined);
  const count = total > 0 ? `${current} / ${total}` : `${current}`;
  return percent === undefined ? count : `${count} (${percent}%)`;
}

function statusTone(status: ImportJob["status"]): StatusBadgeTone {
  if (status === "failed") return "danger";
  if (status === "running" || status === "cancelling") return "info";
  if (status === "queued") return "warning";
  if (status === "succeeded") return "active";
  return "neutral";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
