import type { LiveBoardProjection } from "../core/types";
import { Icon } from "./icons/Icon";
import { iconWeights } from "./icons/icon-tokens";
import { observabilityDemoTelemetry } from "./observabilityDemo";

type Props = {
  summary: LiveBoardProjection["summary"];
  showDemoTelemetry?: boolean;
};

export function ObservabilityRightRail({ summary, showDemoTelemetry = false }: Props) {
  const active = summary.running ?? summary.active;
  const idle = summary.idle ?? 0;
  const blocked = summary.needsAction ?? summary.needsAttention;
  const total = active + idle + blocked;
  const tokensPerMinute = observabilityDemoTelemetry.resourceSeries.find((series) => series.label === "Tokens / min");

  return (
    <>
      {showDemoTelemetry ? (
        <>
          <section className="rail-card metal-surface metal-card metric">
            <p className="rail-title">
              <span className="rail-icon" aria-hidden="true">
                <Icon name="usage" size="panel" weight={iconWeights.panel} />
              </span>
              Total Tokens (24h)
            </p>
            <div className="metric-row">
              <span className="metric-value">{observabilityDemoTelemetry.tokens24h.value}</span>
              <span className="metric-delta">
                <Icon name="trendUp" size="inline" weight={iconWeights.inline} />
                12.1M
              </span>
            </div>
          </section>

          <section id="top-models" className="rail-card metal-surface metal-card models">
            <h2 className="rail-heading">Top Models (24h)</h2>
            <div className="model-table">
              <span>Model</span>
              <span>Tokens</span>
              {observabilityDemoTelemetry.topModels.slice(0, 2).map((model) => (
                <div key={model.model} className="model-row">
                  <strong>{model.model}</strong>
                  <span>{model.tokens}</span>
                </div>
              ))}
            </div>
            <a href="#top-models">
              View all models
              <Icon name="arrowRight" size="inline" weight={iconWeights.inline} />
            </a>
          </section>

          <section id="tokens-per-minute" className="rail-card metal-surface metal-card tokens">
            <h2 className="rail-heading">Tokens / Min</h2>
            <div className="metric-row">
              <span className="metric-value">{tokensPerMinute?.value ?? "12.4K"}</span>
              <span className="metric-delta">
                <Icon name="trendUp" size="inline" weight={iconWeights.inline} />
                1.8K
              </span>
            </div>
            <div className="tokens-sparkline" aria-label="Tokens per minute sparkline">
              <svg viewBox="0 0 232 37" preserveAspectRatio="none" aria-hidden="true">
                <path
                  d="M1 24 8 20 15 23 23 21 30 24 37 19 45 23 52 22 60 25 67 17 75 23 82 22 90 24 98 19 105 23 113 20 120 22 128 18 135 13 143 23 150 20 158 21 165 18 173 25 180 19 188 17 195 22 203 18 210 23 218 21 231 25"
                  fill="none"
                />
              </svg>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="rail-card metal-surface metal-card metric">
            <p className="rail-title">
              <span className="rail-icon" aria-hidden="true">
                <Icon name="sessions" size="panel" weight={iconWeights.panel} />
              </span>
              Live Sessions
            </p>
            <div className="metric-row">
              <span className="metric-value">{total}</span>
              <span className="metric-delta">{active} active</span>
            </div>
          </section>

          <section id="top-models" className="rail-card metal-surface metal-card models">
            <h2 className="rail-heading">Session Source</h2>
            <div className="model-table">
              <span>Source</span>
              <span>Sessions</span>
              <div className="model-row">
                <strong>Codex</strong>
                <span>{total}</span>
              </div>
              <div className="model-row">
                <strong>Local hooks</strong>
                <span>Live</span>
              </div>
            </div>
          </section>
        </>
      )}

      <section className="rail-card metal-surface metal-card lifecycle">
        <h2 className="rail-heading">Session Mix</h2>
        <div className="mix-total">
          <span>Visible sessions</span>
          <strong>{total}</strong>
        </div>
        <div className="mix-bar" aria-hidden="true">
          <span className="mix-active" style={{ width: percent(active, total) }} />
          <span className="mix-idle" style={{ width: percent(idle, total) }} />
          <span className="mix-blocked" style={{ width: percent(blocked, total) }} />
        </div>
        <div className="mix-legend">
          <div>
            <span>
              <i className="active-dot" />
              Active
            </span>
            <strong>{active}</strong>
          </div>
          <div>
            <span>
              <i className="idle-dot" />
              Idle
            </span>
            <strong>{idle}</strong>
          </div>
          <div>
            <span>
              <i className="blocked-dot" />
              Blocked
            </span>
            <strong>{blocked}</strong>
          </div>
        </div>
      </section>
    </>
  );
}

function percent(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${(value / total) * 100}%`;
}
