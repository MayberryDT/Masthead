import type { LiveBoardProjection } from "../core/types";
import type { AppSurface } from "./ObservabilitySidebar";
import { Icon } from "./icons/Icon";
import { iconWeights } from "./icons/icon-tokens";

type Props = {
  summary: LiveBoardProjection["summary"];
  activeSurface: AppSurface;
  sourceCount?: number;
};

export function ObservabilityRightRail({ summary, activeSurface, sourceCount = 0 }: Props) {
  if (activeSurface === "logbook" || activeSurface === "settings") return null;
  if (activeSurface === "sources") return <SourcesRail sourceCount={sourceCount} />;
  if (activeSurface === "agent_access") return <AgentAccessRail />;
  return <NowRail summary={summary} sourceCount={sourceCount} />;
}

function NowRail({ summary, sourceCount }: { summary: LiveBoardProjection["summary"]; sourceCount: number }) {
  const active = summary.running ?? summary.active;
  const idle = summary.idle ?? 0;
  const blocked = summary.needsAction ?? summary.needsAttention;
  const total = active + idle + blocked;

  return (
    <>
      <section className="rail-card metal-surface metal-card metric">
        <p className="rail-title">
          <span className="rail-icon" aria-hidden="true">
            <Icon name="sessions" size="panel" weight={iconWeights.panel} />
          </span>
          Active Sessions
        </p>
        <div className="metric-row">
          <span className="metric-value">{total}</span>
          <span className="metric-delta">{active} running</span>
        </div>
      </section>

      <section className="rail-card metal-surface metal-card lifecycle">
        <h2 className="rail-heading">Session Mix</h2>
        <div className="mix-total">
          <span>Connected sources</span>
          <strong>{sourceCount}</strong>
        </div>
        <div className="mix-bar" aria-hidden="true">
          <span className="mix-active" style={{ width: percent(active, total) }} />
          <span className="mix-idle" style={{ width: percent(idle, total) }} />
          <span className="mix-blocked" style={{ width: percent(blocked, total) }} />
        </div>
        <div className="mix-legend">
          <RailLegend label="Running" value={active} tone="active-dot" />
          <RailLegend label="Idle" value={idle} tone="idle-dot" />
          <RailLegend label="Needs attention" value={blocked} tone="blocked-dot" />
        </div>
      </section>
    </>
  );
}

function SourcesRail({ sourceCount }: { sourceCount: number }) {
  return (
    <section className="rail-card metal-surface metal-card models">
      <h2 className="rail-heading">Adapter Health</h2>
      <div className="model-table">
        <span>Inventory</span>
        <span>Status</span>
        <div className="model-row">
          <strong>Sources</strong>
          <span>{sourceCount}</span>
        </div>
        <div className="model-row">
          <strong>Import jobs</strong>
          <span>Local</span>
        </div>
      </div>
    </section>
  );
}

function AgentAccessRail() {
  return (
    <section className="rail-card metal-surface metal-card models">
      <h2 className="rail-heading">MCP Access</h2>
      <div className="model-table">
        <span>Mode</span>
        <span>State</span>
        <div className="model-row">
          <strong>History tools</strong>
          <span>Read-only</span>
        </div>
        <div className="model-row">
          <strong>Mutations</strong>
          <span>Blocked</span>
        </div>
      </div>
    </section>
  );
}

function RailLegend({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <span>
        <i className={tone} />
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function percent(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${(value / total) * 100}%`;
}
