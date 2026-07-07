import type { SessionCardView } from "../core/types";

export function isBlockedSessionCard(session: SessionCardView): boolean {
  return (
    session.displayState === "blocked" ||
    session.runtimeState === "blocked" ||
    session.primaryStatus === "blocked" ||
    session.outcomeLabel === "blocked" ||
    session.endReason === "blocked"
  );
}

export function stateClassName(session: SessionCardView): string {
  if (isBlockedSessionCard(session)) return "needs-attention";
  if (session.lifecycle === "ended" && session.outcomeLabel === "completed") return "complete";
  if (session.lifecycle === "idle" || session.primaryStatus === "stalled") return "stalled";
  if (session.lifecycle === "ended") return "ended";
  return "running";
}

export function statusTokenLabel(session: SessionCardView): string {
  if (isBlockedSessionCard(session)) return "Blocked";
  if (session.indicators.includes("risk")) return "High risk";
  if (session.lifecycle === "running") return "Active";
  if (session.lifecycle === "idle") return "Idle";
  if (session.lifecycle === "ended" && session.outcomeLabel) return outcomeLabel(session.outcomeLabel);
  return session.stateLabel;
}

function outcomeLabel(outcome: NonNullable<SessionCardView["outcomeLabel"]>): string {
  return outcome
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
