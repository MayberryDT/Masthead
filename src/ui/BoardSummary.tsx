import type { LiveBoardProjection } from "../core/types";

type Props = {
  summary: LiveBoardProjection["summary"];
};

export function BoardSummary({ summary }: Props) {
  return (
    <section className="console-summary" aria-label="Current Masthead summary">
      <SummaryItem label="Running" value={summary.running ?? summary.active} />
      <SummaryItem label="Idle" value={summary.idle ?? 0} />
      <SummaryItem label="Needs action" value={summary.needsAction ?? summary.needsAttention} />
      <SummaryItem label="Completed" value={summary.completed} />
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span className="mono-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
