import type { LiveBoardProjection, SessionCardView } from "../core/types";
import { isBlockedSessionCard } from "../ui/format";

/** Consecutive quiet projection samples before we treat a session as idle. */
export const IDLE_CONFIRM_TICKS = 3;

export type IdlePresentationTrack = {
  consecutiveQuietTicks: number;
  confirmedQuiet: boolean;
  /** After confirmed quiet, show Done until the user hovers the card. */
  doneUntilHover: boolean;
};

function isQuietCandidate(card: SessionCardView): boolean {
  if (isBlockedSessionCard(card)) return false;
  if (card.lifecycle === "ended") return false;
  return (
    card.lifecycle === "idle" ||
    card.primaryStatus === "stalled" ||
    card.displayState === "idle" ||
    card.displayState === "done"
  );
}

function isActivelyWorking(card: SessionCardView): boolean {
  if (isBlockedSessionCard(card)) return false;
  if (card.lifecycle === "ended") return false;
  if (isQuietCandidate(card)) return false;
  return card.lifecycle === "running" || card.displayState === "working";
}

function holdAsActive(card: SessionCardView): SessionCardView {
  return {
    ...card,
    lifecycle: "running",
    displayState: "working",
    stateLabel: "Active",
    primaryStatus: card.primaryStatus === "stalled" ? "reading" : card.primaryStatus
  };
}

function presentAsDone(card: SessionCardView): SessionCardView {
  return {
    ...card,
    lifecycle: "idle",
    displayState: "done",
    stateLabel: "Done"
  };
}

function presentAsIdle(card: SessionCardView): SessionCardView {
  return {
    ...card,
    lifecycle: "idle",
    displayState: "idle",
    stateLabel: "Idle"
  };
}

/**
 * Smooths noisy running↔idle flips (e.g. Grok "thinking" gaps) and presents a
 * temporary Done highlight until the user notices the card via hover.
 *
 * Mutates `tracks` in place so App can keep a stable ref across projection loads.
 */
export function applyIdlePresentation(
  cards: SessionCardView[],
  tracks: Map<string, IdlePresentationTrack>
): SessionCardView[] {
  const presentIds = new Set(cards.map((card) => card.sessionId));
  for (const sessionId of tracks.keys()) {
    if (!presentIds.has(sessionId)) tracks.delete(sessionId);
  }

  return cards.map((card) => {
    if (isBlockedSessionCard(card) || card.lifecycle === "ended") {
      tracks.set(card.sessionId, { consecutiveQuietTicks: 0, confirmedQuiet: false, doneUntilHover: false });
      return card;
    }

    if (isActivelyWorking(card)) {
      tracks.set(card.sessionId, { consecutiveQuietTicks: 0, confirmedQuiet: false, doneUntilHover: false });
      return card;
    }

    if (!isQuietCandidate(card)) {
      return card;
    }

    const prior = tracks.get(card.sessionId) ?? {
      consecutiveQuietTicks: 0,
      confirmedQuiet: false,
      doneUntilHover: false
    };

    if (!prior.confirmedQuiet) {
      const consecutiveQuietTicks = prior.consecutiveQuietTicks + 1;
      if (consecutiveQuietTicks < IDLE_CONFIRM_TICKS) {
        tracks.set(card.sessionId, {
          consecutiveQuietTicks,
          confirmedQuiet: false,
          doneUntilHover: false
        });
        return holdAsActive(card);
      }
      tracks.set(card.sessionId, {
        consecutiveQuietTicks,
        confirmedQuiet: true,
        doneUntilHover: true
      });
      return presentAsDone(card);
    }

    if (prior.doneUntilHover) {
      tracks.set(card.sessionId, prior);
      return presentAsDone(card);
    }

    tracks.set(card.sessionId, prior);
    return presentAsIdle(card);
  });
}

export function markIdleDoneSeen(tracks: Map<string, IdlePresentationTrack>, sessionId: string): void {
  const track = tracks.get(sessionId);
  if (!track?.doneUntilHover) return;
  tracks.set(sessionId, { ...track, doneUntilHover: false });
}

export function applyIdlePresentationToProjection(
  projection: LiveBoardProjection,
  tracks: Map<string, IdlePresentationTrack>
): LiveBoardProjection {
  return {
    ...projection,
    cards: applyIdlePresentation(projection.cards ?? [], tracks)
  };
}
