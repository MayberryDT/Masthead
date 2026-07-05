import type { LiveBoardProjection } from "../core/types";
import { notifySessionEndedDesktop } from "./desktopNotify";

function cardNotificationTitle(card: LiveBoardProjection["cards"][number]): string {
  const fromHeadline = card.headline?.headline?.trim();
  if (fromHeadline) return fromHeadline;
  const fromTitle = card.title?.trim();
  if (fromTitle) return fromTitle;
  return card.project?.trim() || "Session ended";
}

export function detectSessionEndedTransitions(
  previous: LiveBoardProjection | undefined,
  next: LiveBoardProjection
): Array<{ sessionId: string; title: string; body?: string }> {
  const prevById = new Map((previous?.cards ?? []).map((card) => [card.sessionId, card]));
  const transitions: Array<{ sessionId: string; title: string; body?: string }> = [];
  for (const card of next.cards ?? []) {
    if (card.lifecycle !== "ended") continue;
    const prior = prevById.get(card.sessionId);
    if (prior?.lifecycle === "ended") continue;
    const title = cardNotificationTitle(card);
    const body = card.endReason?.trim() || card.stateLabel?.trim();
    transitions.push({ sessionId: card.sessionId, title, body });
  }
  return transitions;
}

export async function emitSessionEndedNotifications(
  previous: LiveBoardProjection | undefined,
  next: LiveBoardProjection,
  options: { enabled: boolean; notifiedSessionIds: Set<string> }
): Promise<void> {
  if (!options.enabled) return;
  for (const item of detectSessionEndedTransitions(previous, next)) {
    if (options.notifiedSessionIds.has(item.sessionId)) continue;
    options.notifiedSessionIds.add(item.sessionId);
    try {
      await notifySessionEndedDesktop({ title: item.title, body: item.body });
    } catch {
      // Desktop-only; ignore in browser-only dev.
    }
  }
}
