import type { ImportJob } from "../../app/daemonClient";
import { deriveImportVisibilityState, type ImportFailureGroupDto, type ImportWorkUnitDto } from "../../shared/sourceImport";
import { StatusBadge } from "../primitives/StatusBadge";

type Props = {
  job: ImportJob;
  units?: ImportWorkUnitDto[];
  failureGroups?: ImportFailureGroupDto[];
  nowMs?: number;
  stalledAfterMs?: number;
};

export function ImportProgressPanel({
  failureGroups = [],
  job,
  nowMs = Date.now(),
  stalledAfterMs = 30_000,
  units = []
}: Props) {
  const visibility = deriveImportVisibilityState(job, nowMs, stalledAfterMs);
  const processed = job.processedCount ?? 0;
  const discovered = job.discoveredCount ?? 0;
  const progressPct = discovered > 0 ? Math.min(100, Math.round((processed / discovered) * 100)) : undefined;
  const stalled = visibility === "stalled";

  return (
    <section className={`import-progress-panel${stalled ? " is-stale" : ""}`} aria-label="Import progress">
      <div className="source-detail-section-head">
        <div>
          <p className="mono-label">{job.importKind}</p>
          <h3>{job.stage ?? job.status}</h3>
        </div>
        <StatusBadge tone={visibility === "failed" ? "danger" : visibility === "stalled" ? "warning" : visibility === "running" ? "info" : "active"}>{visibility.replaceAll("_", " ")}</StatusBadge>
      </div>
      {discovered > 0 ? (
        <div className="import-progress-bar" role="progressbar" aria-valuenow={processed} aria-valuemin={0} aria-valuemax={discovered} aria-label="Records processed">
          <div className="import-progress-bar-fill" style={{ width: `${progressPct ?? 0}%` }} />
          <span className="import-progress-bar-label">{progressPct}%</span>
        </div>
      ) : null}
      <dl className="import-progress-grid">
        <ProgressMetric label="Records" value={`${processed} / ${discovered || "?"}`} />
        <ProgressMetric label="Units" value={`${job.completedWorkUnits ?? 0} / ${job.totalWorkUnits ?? 0}`} />
        <ProgressMetric label="Failed" value={String(job.failedWorkUnits ?? job.failureCount ?? 0)} />
        <ProgressMetric label="Heartbeat" value={job.heartbeatAt ? formatTime(job.heartbeatAt) : "Waiting"} />
      </dl>
      {stalled ? (
        <p className="surface-status import-progress-stale-warning">
          No import heartbeat in the last {Math.round(stalledAfterMs / 1000)} seconds. The job may still be working on a large file or waiting on disk.
        </p>
      ) : null}
      {job.currentPath ? <p className="surface-status import-current-path">{job.currentPath}</p> : null}
      {units.length > 0 ? (
        <ul className="import-unit-list">
          {units.slice(0, 6).map((unit) => (
            <li key={unit.workUnitId}>
              <span>{unit.sourcePath ? basename(unit.sourcePath) : unit.sourceSessionId ?? unit.workUnitId}</span>
              <strong>{unit.status.replaceAll("_", " ")}</strong>
            </li>
          ))}
        </ul>
      ) : null}
      {failureGroups.length > 0 ? (
        <ul className="import-failure-list">
          {failureGroups.map((group) => (
            <li key={group.failureGroupId}>
              <strong>{group.count}x {group.code}</strong>
              <span>{group.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}


function ProgressMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}