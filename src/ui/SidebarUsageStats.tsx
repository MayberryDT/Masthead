import type { UsageStatsDto } from "../app/daemonClient";
import { UsageHint } from "./usage/UsageHint";

type Props = {
  stats?: UsageStatsDto;
  loading?: boolean;
  error?: string;
};

export function SidebarUsageStats({ stats, loading = false, error }: Props) {
  if (loading && !stats) {
    return (
      <section className="sidebar-usage" aria-label="Today usage">
        <p>Today</p>
        <span className="sidebar-usage-note">Loading...</span>
      </section>
    );
  }

  if (error && !stats) {
    return (
      <section className="sidebar-usage muted" aria-label="Today usage">
        <p>Today</p>
        <span className="sidebar-usage-note">Usage unavailable</span>
      </section>
    );
  }

  const totals = stats?.totals;
  return (
    <section className="sidebar-usage" aria-label="Today usage">
      <p>Today</p>
      <SidebarUsageRow label="Sessions" tip="Sessions active today." value={formatCompact(totals?.sessions ?? 0)} />
      <SidebarUsageRow label="Tokens" tip="Imported token total for today." value={totals?.totalTokens ? formatCompact(totals.totalTokens) : "-"} />
      <SidebarUsageRow label="Tools" tip="Tool calls captured today." value={formatCompact(totals?.toolCalls ?? 0)} />
      <SidebarUsageRow label="MCP" tip="Read-only MCP queries served today." value={formatCompact(totals?.mcpQueries ?? 0)} />
    </section>
  );
}

function SidebarUsageRow({ label, tip, value }: { label: string; tip: string; value: string }) {
  return (
    <div className="sidebar-usage-row">
      <UsageHint label={label} tip={tip} />
      <strong>{value}</strong>
    </div>
  );
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10_000 ? 1 : 0
  }).format(value);
}
