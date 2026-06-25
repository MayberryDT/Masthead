import type { ImportJob } from "../../app/daemonClient";
import { AppButton } from "../primitives/AppButton";
import { StatusBadge } from "../primitives/StatusBadge";

type Props = {
  imports: ImportJob[];
};

export function ImportJobsTable({ imports }: Props) {
  if (imports.length === 0) return null;
  return (
    <section className="import-jobs-section" aria-label="Import jobs">
      <p className="mono-label">IMPORT JOBS</p>
      <table className="import-jobs-table">
        <thead>
          <tr>
            <th>Started</th>
            <th>Source</th>
            <th>Type</th>
            <th>Progress</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {imports.map((job) => (
            <tr key={job.importJobId}>
              <td>{formatTime(job.updatedAt)}</td>
              <td title={job.sourceId}>{job.sourceId}</td>
              <td>{job.importKind}</td>
              <td>
                {job.importedCount} / {job.discoveredCount}
              </td>
              <td>
                <StatusBadge tone={job.status === "failed" ? "danger" : job.status === "running" ? "info" : "neutral"}>{job.status}</StatusBadge>
              </td>
              <td>
                <AppButton variant="quiet">{job.status === "failed" ? "Retry" : "View"}</AppButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
