import type { BoardBrief, LiveBoardProjection } from "../core/types";
import { DemoBadge } from "./DemoBadge";

type Props = {
  summary: LiveBoardProjection["summary"];
  brief?: BoardBrief;
  environmentCount?: number;
};

export function ObservabilityStatusBanner({ summary, brief, environmentCount = 3 }: Props) {
  const active = summary.running ?? summary.active;
  const idle = summary.idle ?? 0;
  const blocked = summary.needsAction ?? summary.needsAttention;
  const text = `${active} active, ${idle} idle, ${blocked} blocked sessions across ${environmentCount} environments. Work in progress is visible with stable platform telemetry. ${blocked} sessions require attention.`;

  return (
    <section className="observability-status-banner" aria-label="System status">
      <div title={brief?.text}>
        <strong>System status:</strong>
        <span>{text}</span>
      </div>
      <span className="health-token">
        Healthy
        <DemoBadge />
      </span>
    </section>
  );
}
