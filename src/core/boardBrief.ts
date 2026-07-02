import type { AttentionItem, BoardBrief, LiveBoardProjection } from "./types";

type BriefProjection = Pick<LiveBoardProjection, "summary" | "cards" | "attentionQueue" | "conflicts">;

export function buildBoardBrief(projection: BriefProjection, source: BoardBrief["source"] = "deterministic"): BoardBrief {
  const clauses: string[] = [];
  const attention = countAttentionTypes(projection.attentionQueue);
  const commandFailureCount = attention.command_failed + attention.repeated_failure;
  const verificationCount = attention.completed_without_verification + attention.stale_verification;
  const highRiskCount = attention.high_risk_change;
  const conflictCount = projection.conflicts.length;
  const runningCount = projection.summary.running ?? projection.cards.filter((card) => card.lifecycle === "running").length;

  if (attention.approval_requested > 0)
    clauses.push(`Approval is pending in ${countNoun(attention.approval_requested, "one active session", "active sessions")}.`);
  if (attention.user_question > 0) clauses.push(`Input is pending in ${countNoun(attention.user_question, "one active session", "active sessions")}.`);
  if (commandFailureCount > 0) clauses.push(`Failed command evidence is visible in ${countNoun(commandFailureCount, "one session", "sessions")}.`);
  if (verificationCount > 0) clauses.push(`Verification follow-up is visible in ${countNoun(verificationCount, "one session", "sessions")}.`);
  if (highRiskCount > 0) clauses.push(`High-risk change evidence is visible in ${countNoun(highRiskCount, "one session", "sessions")}.`);
  if (conflictCount > 0) clauses.push(`Overlapping work is visible in ${countNoun(conflictCount, "one session", "sessions")}.`);
  clauses.push(`${capitalize(countNoun(runningCount, "one session is", "sessions are"))} running overall.`);

  return {
    text: clauses.join(" "),
    source,
    priority: clauses.length > 1 ? "attention" : "normal"
  };
}

function countAttentionTypes(items: AttentionItem[]): Record<AttentionItem["type"], number> {
  const counts: Record<AttentionItem["type"], number> = {
    approval_requested: 0,
    user_question: 0,
    command_failed: 0,
    repeated_failure: 0,
    stalled: 0,
    completed_without_verification: 0,
    stale_verification: 0,
    high_risk_change: 0,
    conflict: 0
  };
  for (const item of items) {
    if (item.resolvedAt || item.dismissedAt || item.snoozedUntil) continue;
    counts[item.type] += 1;
  }
  return counts;
}

function countNoun(count: number, one: string, many: string): string {
  if (count === 0) return `no ${many}`;
  if (count === 1) return one;
  return `${numberWord(count)} ${many}`;
}

function numberWord(count: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  return words[count] ?? String(count);
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
