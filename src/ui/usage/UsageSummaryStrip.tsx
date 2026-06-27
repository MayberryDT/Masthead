import type { UsageStatsDto } from "../../app/daemonClient";
import { formatCompactUsage, formatTokensPerMinute } from "./formatUsage";
import { UsageHint } from "./UsageHint";

export function UsageSummaryStrip({ stats }: { stats: UsageStatsDto }) {
  return (
    <dl className="usage-summary-strip">
      <UsageMetric tone="sessions" label="Sessions" tip="Sessions active in the selected usage window." value={formatCompactUsage(stats.totals.sessions)} />
      <UsageMetric tone="tokens" label="Total tokens" tip="Input and output tokens imported from session metadata." value={formatCompactUsage(stats.totals.totalTokens)} />
      <UsageMetric tone="rate" label="Tokens/m" tip="Average token volume per minute for this window when token totals are available." value={formatTokensPerMinute(stats.totals.tokensPerMinute)} />
      <UsageMetric tone="tools" label="Tool calls" tip="Tool invocation records captured across matching sessions." value={formatCompactUsage(stats.totals.toolCalls)} />
      <UsageMetric tone="files" label="File effects" tip="Observed file changes associated with matching sessions." value={formatCompactUsage(stats.totals.fileEffects)} />
      <UsageMetric tone="mcp" label="MCP queries" tip="Read-only MCP requests made against Masthead data." value={formatCompactUsage(stats.totals.mcpQueries)} />
    </dl>
  );
}

function UsageMetric({ tone, label, tip, value }: { tone: string; label: string; tip: string; value: string }) {
  return (
    <div className={`usage-metric ${tone}`}>
      <span className="usage-metric-accent" aria-hidden="true" />
      <dt><UsageHint label={label} tip={tip} /></dt>
      <dd>{value}</dd>
    </div>
  );
}
