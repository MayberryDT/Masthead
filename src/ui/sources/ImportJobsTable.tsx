import type { ImportJob } from "../../app/daemonClient";
import { harnessForRuntime } from "../../adapters/harnessCatalog";
import type { RuntimeKind } from "../../adapters/types";
import { AppButton } from "../primitives/AppButton";
import { StatusBadge, type StatusBadgeTone } from "../primitives/StatusBadge";

type Props = {
  busy?: boolean;
  imports: ImportJob[];
  nowMs?: number;
  onCancelImport?: (importJobId: string) => void;
  onRetryImport?: (importJobId: string) => void;
  staleAfterMs?: number;
  total?: number;
};

export function ImportJobsTable({
  busy = false,
  imports,
  nowMs = Date.now(),
  onCancelImport,
  onRetryImport,
  staleAfterMs = 30_000,
  total = imports.length
}: Props) {
  if (imports.length === 0) return null;
  const groups = groupImportJobs(imports, nowMs, staleAfterMs);
  const visibleCount = Math.min(total, imports.length);
  return (
    <section className="import-jobs-section" aria-label="Import jobs">
      <div className="import-jobs-header">
        <h2 className="import-jobs-title">Import activity</h2>
        <dl className="import-jobs-summary" aria-label="Import queue summary">
          <div>
            <dt>Visible</dt>
            <dd>{groups.length}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{visibleCount}</dd>
          </div>
        </dl>
      </div>
      <div className="import-jobs-table-frame">
        <table className="import-jobs-table">
          <thead>
            <tr>
              <th>Harness</th>
              <th>Type</th>
              <th>Stage</th>
              <th>Progress</th>
              <th>Jobs</th>
              <th>Heartbeat</th>
              <th>Summary</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr className={`import-job-group-row ${group.stale ? "is-stale" : ""}`} key={group.key}>
                <td>
                  <strong>{group.harnessLabel}</strong>
                  <span>{group.locationSummary}</span>
                </td>
                <td>{group.importKind}</td>
                <td>{group.stage}</td>
                <td>{group.progress}</td>
                <td>{group.jobCount} {group.jobCount === 1 ? "job" : "jobs"}</td>
                <td>{group.heartbeatLabel}</td>
                <td>{group.summary}</td>
                <td>
                  <StatusBadge tone={group.stale ? "warning" : statusTone(group.status)}>{group.status.replaceAll("_", " ")}</StatusBadge>
                  {group.failureMessage ? <p className="surface-status import-job-failure">{group.failureMessage}</p> : null}
                </td>
                <td>{groupAction(group, { busy, onCancelImport, onRetryImport })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type ImportJobGroup = {
  failureMessage?: string;
  harnessLabel: string;
  heartbeatLabel: string;
  importKind: ImportJob["importKind"];
  jobCount: number;
  key: string;
  locationSummary: string;
  progress: string;
  retryJobId?: string;
  cancelJobId?: string;
  stage: string;
  stale: boolean;
  status: ImportJob["status"];
  summary: string;
};

function groupAction(
  group: ImportJobGroup,
  actions: Pick<Props, "busy" | "onCancelImport" | "onRetryImport">
) {
  if (group.cancelJobId) {
    const cancelJobId = group.cancelJobId;
    return (
      <AppButton
        variant="quiet"
        disabled={actions.busy || !actions.onCancelImport}
        onClick={() => actions.onCancelImport?.(cancelJobId)}
      >
        Cancel
      </AppButton>
    );
  }
  if (group.status === "cancelling") {
    return <span className="surface-status">Cancelling</span>;
  }
  if (group.retryJobId) {
    const retryJobId = group.retryJobId;
    return (
      <AppButton
        variant="quiet"
        disabled={actions.busy || !actions.onRetryImport}
        onClick={() => actions.onRetryImport?.(retryJobId)}
      >
        Retry
      </AppButton>
    );
  }
  return <span className="surface-status">Complete</span>;
}

function groupImportJobs(imports: ImportJob[], nowMs: number, staleAfterMs: number): ImportJobGroup[] {
  const grouped = new Map<string, ImportJob[]>();
  for (const job of imports) {
    const key = `${runtimeFromSourceId(job.sourceId)}:${job.importKind}`;
    grouped.set(key, [...(grouped.get(key) ?? []), job]);
  }

  return Array.from(grouped.entries()).map(([key, jobs]) => {
    const sorted = jobs.toSorted((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
    const active = sorted.find((job) => job.status === "running" || job.status === "queued" || job.status === "cancelling");
    const primary = active ?? sorted[0];
    const runtime = runtimeFromSourceId(primary.sourceId);
    const countSource = active ? [primary] : jobs;
    const failed = sum(countSource, (job) => job.failedWorkUnits ?? job.failureCount);
    const skipped = sum(countSource, (job) => job.skippedWorkUnits ?? 0);
    const imported = sum(countSource, (job) => job.importedCount);
    const completedUnits = sum(countSource, (job) => job.completedWorkUnits ?? 0);
    const totalUnits = sum(countSource, (job) => job.totalWorkUnits ?? 0);
    const pending = sum(countSource, (job) => Math.max(0, job.queuedCount));
    const heartbeatAt = active ? active.heartbeatAt ?? active.updatedAt : latest(jobs.map((job) => job.heartbeatAt ?? job.updatedAt));
    const stale = Boolean(active && active.status === "running" && heartbeatAt && nowMs - timestamp(heartbeatAt) > staleAfterMs);
    const retryJob = sorted.find((job) => job.status === "failed" || job.status === "cancelled" || job.status === "succeeded_with_issues");
    const cancelJob = sorted.find((job) => job.status === "running" || job.status === "queued");
    const basename = primary.currentPath ? pathBasename(primary.currentPath) : undefined;

    return {
      cancelJobId: cancelJob?.importJobId,
      failureMessage: primary.failureMessage,
      harnessLabel: harnessLabelForRuntime(runtime),
      heartbeatLabel: heartbeatAt ? (stale ? `No heartbeat for ${formatElapsed(nowMs - timestamp(heartbeatAt))}` : formatTime(heartbeatAt)) : "Waiting",
      importKind: primary.importKind,
      jobCount: jobs.length,
      key,
      locationSummary: jobs.length === 1 ? "1 source group" : `${jobs.length} source groups`,
      progress: totalUnits > 0 ? `${completedUnits} / ${totalUnits} units` : formatProgress(primary),
      retryJobId: retryJob?.importJobId,
      stage: primary.stage ?? primary.status,
      stale,
      status: stale ? "running" : primary.status,
      summary: [
        `${imported} imported`,
        `${skipped} skipped`,
        `${failed} failed`,
        pending > 0 ? `${pending} pending` : undefined,
        basename
      ].filter(Boolean).join(" · ")
    };
  });
}

function formatProgress(job: ImportJob): string {
  const current = job.progressCurrent ?? job.processedCount ?? job.importedCount;
  const total = job.progressTotal ?? job.discoveredCount;
  const active = job.status === "queued" || job.status === "running" || job.status === "cancelling";
  const hasKnownTotal = total > 0 && total > current;
  if (!hasKnownTotal) {
    if (current > 0) return `${current} records processed`;
    if (job.status === "queued") return "Waiting";
    if (active) return "Starting";
    return "No records processed";
  }
  const percent = job.progressPercent ?? Math.round((current / total) * 100);
  const count = `${current} / ${total}`;
  return percent === undefined ? count : `${count} (${percent}%)`;
}

function statusTone(status: ImportJob["status"]): StatusBadgeTone {
  if (status === "failed") return "danger";
  if (status === "running" || status === "cancelling") return "info";
  if (status === "queued") return "warning";
  if (status === "succeeded" || status === "succeeded_with_issues") return "active";
  return "neutral";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function timestamp(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function latest(values: Array<string | undefined>): string | undefined {
  return values.filter(Boolean).toSorted((a, b) => timestamp(b as string) - timestamp(a as string)).at(0);
}

function sum(jobs: ImportJob[], value: (job: ImportJob) => number): number {
  return jobs.reduce((total, job) => total + value(job), 0);
}

function runtimeFromSourceId(sourceId: string): string {
  return sourceId.split(/[-:]/)[0] || sourceId;
}

function harnessLabelForRuntime(runtime: string): string {
  return harnessForRuntime(runtime as RuntimeKind)?.label ?? titleCase(runtime.replaceAll("_", " "));
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pathBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function formatElapsed(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr`;
}
