import type { ImportJob } from "../../app/daemonClient";
import type { ImportFailureGroupDto, ImportWorkUnitDto } from "../../shared/sourceImport";
import { StatusBadge } from "../primitives/StatusBadge";

type Props = {
  job: ImportJob;
  units?: ImportWorkUnitDto[];
  failureGroups?: ImportFailureGroupDto[];
};

export function ImportProgressPanel({ failureGroups = [], job, units = [] }: Props) {
  return (
    <section className="import-progress-panel" aria-label="Import progress">
      <div className="source-detail-section-head">
        <div>
          <p className="mono-label">{job.importKind}</p>
          <h3>{job.stage ?? job.status}</h3>
        </div>
        <StatusBadge tone={job.status === "failed" ? "danger" : job.status === "running" ? "info" : "active"}>
          {job.status.replaceAll("_", " ")}
        </StatusBadge>
      </div>
      <dl className="import-progress-grid">
        <ProgressMetric label="Records" value={`${job.processedCount ?? 0} / ${job.discoveredCount || "?"}`} />
        <ProgressMetric label="Units" value={`${job.completedWorkUnits ?? 0} / ${job.totalWorkUnits ?? 0}`} />
        <ProgressMetric label="Failed" value={String(job.failedWorkUnits ?? job.failureCount ?? 0)} />
        <ProgressMetric label="Heartbeat" value={job.heartbeatAt ? formatTime(job.heartbeatAt) : "Waiting"} />
      </dl>
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
