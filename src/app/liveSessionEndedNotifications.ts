import type { LiveBoardProjection } from "../core/types";
import { isBlockedSessionCard, statusTokenLabel } from "../ui/format";
import { notifySessionTransitionDesktop } from "./desktopNotify";

export type SessionNotificationTransition = "idle" | "blocked" | "ended";

export type SessionTransitionNotification = {
  sessionId: string;
  transition: SessionNotificationTransition;
  title: string;
  body?: string;
};

type SessionCard = LiveBoardProjection["cards"][number];

function cardNotificationTitle(card: SessionCard): string {
  const fromHeadline = card.headline?.headline?.trim();
  if (fromHeadline) return fromHeadline;
  const fromTitle = card.title?.trim();
  if (fromTitle) return fromTitle;
  return card.project?.trim() || "Session changed state";
}

function notificationTransitionLabel(transition: SessionNotificationTransition): string {
  if (transition === "blocked") return "Blocked";
  if (transition === "idle") return "Idle";
  return "Ended";
}

function isDuplicateDetail(label: string, detail: string): boolean {
  return detail.trim().toLowerCase() === label.trim().toLowerCase();
}

function notificationBody(card: SessionCard, transition: SessionNotificationTransition): string {
  const label = notificationTransitionLabel(transition);
  const details = [
    transition === "ended" ? statusTokenLabel(card) : undefined,
    card.attentionReason,
    card.endReason,
    card.stateLabel
  ];
  const detail = details
    .map((item) => item?.trim())
    .find((item): item is string => item !== undefined && item.length > 0 && !isDuplicateDetail(label, item));
  return detail ? `${label}: ${detail}` : label;
}

function detectCardTransition(card: SessionCard): SessionNotificationTransition | undefined {
  if (isBlockedSessionCard(card)) return "blocked";
  if (card.lifecycle === "ended") return "ended";
  if (card.lifecycle === "idle" || card.primaryStatus === "stalled") return "idle";
  return undefined;
}

export function detectSessionNotificationTransitions(
  previous: LiveBoardProjection | undefined,
  next: LiveBoardProjection
): SessionTransitionNotification[] {
  if (previous === undefined) return [];
  const prevById = new Map((previous.cards ?? []).map((card) => [card.sessionId, card]));
  const transitions: SessionTransitionNotification[] = [];
  for (const card of next.cards ?? []) {
    const prior = prevById.get(card.sessionId);
    if (!prior || prior.lifecycle !== "running" || isBlockedSessionCard(prior)) continue;
    const transition = detectCardTransition(card);
    if (!transition) continue;
    transitions.push({
      sessionId: card.sessionId,
      transition,
      title: cardNotificationTitle(card),
      body: notificationBody(card, transition)
    });
  }
  return transitions;
}

export async function emitSessionTransitionNotifications(
  previous: LiveBoardProjection | undefined,
  next: LiveBoardProjection,
  options: { enabled: boolean; notifiedTransitionKeys: Set<string> }
): Promise<void> {
  if (!options.enabled) return;
  for (const item of detectSessionNotificationTransitions(previous, next)) {
    const key = `${item.sessionId}:${item.transition}`;
    if (options.notifiedTransitionKeys.has(key)) continue;
    options.notifiedTransitionKeys.add(key);
    try {
      await notifySessionTransitionDesktop(item);
    } catch {
      // Desktop-only; ignore in browser-only dev or unsigned desktop builds.
    }
  }
}
