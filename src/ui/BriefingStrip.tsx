import type { BoardBrief, LiveBoardProjection } from "../core/types";

type Props = {
  brief?: BoardBrief;
  summary?: LiveBoardProjection["summary"];
  cardCount?: number;
};

export function BriefingStrip({ brief, summary, cardCount = 0 }: Props) {
  const resolved = brief ?? fallbackBrief(summary, cardCount);

  return (
    <section className={`briefing-strip ${resolved.priority}`} aria-label="Operations brief">
      <span className="mono-label">Ops brief</span>
      <p>{resolved.text}</p>
    </section>
  );
}

function fallbackBrief(summary: LiveBoardProjection["summary"] | undefined, cardCount: number): BoardBrief {
  if (cardCount <= 0) {
    return {
      text: "No sessions are running overall.",
      source: "fallback",
      priority: "normal"
    };
  }

  const needsAttention = summary?.needsAttention ?? 0;
  const conflicts = summary?.conflicts ?? 0;
  const clauses = [`${cardCount} ${cardCount === 1 ? "session is" : "sessions are"} visible overall.`];

  if (needsAttention > 0) {
    clauses.push(`${needsAttention} ${needsAttention === 1 ? "needs" : "need"} attention.`);
  }

  if (conflicts > 0) {
    clauses.push(`${conflicts} ${conflicts === 1 ? "conflict is" : "conflicts are"} visible.`);
  }

  return {
    text: clauses.join(" "),
    source: "fallback",
    priority: needsAttention > 0 || conflicts > 0 ? "attention" : "normal"
  };
}
