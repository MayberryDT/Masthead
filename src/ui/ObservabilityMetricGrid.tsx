import type { LiveBoardProjection } from "../core/types";
import { MetricCard } from "./MetricCard";
import { observabilityDemoTelemetry } from "./observabilityDemo";

type Props = {
  summary: LiveBoardProjection["summary"];
};

export function ObservabilityMetricGrid({ summary }: Props) {
  const active = summary.running ?? summary.active;
  const idle = summary.idle ?? 0;
  const blocked = summary.needsAction ?? summary.needsAttention;

  return (
    <section className="observability-metric-grid" aria-label="Agent health metrics">
      <MetricCard label="Active Sessions" value={active} tone="good" source="real" />
      <MetricCard label="Idle Sessions" value={idle} tone="good" source="real" />
      <MetricCard label="Blocked Sessions" value={blocked} tone={blocked > 0 ? "bad" : "good"} source="real" />
      <MetricCard
        label="Total Tokens (24h)"
        value={observabilityDemoTelemetry.tokens24h.value}
        delta="+12.1M"
        tone="good"
        source="demo"
      />
      <MetricCard
        label="Avg. Latency"
        value={observabilityDemoTelemetry.avgLatency.value}
        delta="-0.18s"
        tone="good"
        source="demo"
      />
      <MetricCard
        label="Errors (24h)"
        value={observabilityDemoTelemetry.errors24h.value}
        delta="-15"
        tone="good"
        source="demo"
      />
      <MetricCard
        label="Total Cost (24h)"
        value={observabilityDemoTelemetry.totalCost24h.value}
        delta="+$18.22"
        tone="good"
        source="demo"
      />
    </section>
  );
}
