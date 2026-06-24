import type { ObservabilityDataSource } from "./observabilityDemo";
import { DemoBadge } from "./DemoBadge";

type Props = {
  label: string;
  value: string | number;
  delta?: string;
  tone?: "good" | "bad" | "neutral";
  source: ObservabilityDataSource;
};

export function MetricCard({ label, value, delta, tone = "neutral", source }: Props) {
  return (
    <article className="metric-card">
      <header className="metric-card-head">
        <span className="metric-icon" aria-hidden="true" />
        <span>{label}</span>
        {source === "demo" ? <DemoBadge /> : null}
      </header>
      <div className="metric-card-value">{value}</div>
      {delta ? <p className={`metric-delta ${tone}`}>{delta}</p> : null}
    </article>
  );
}
