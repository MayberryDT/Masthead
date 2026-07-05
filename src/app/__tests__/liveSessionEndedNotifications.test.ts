import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveBoardProjection, SessionCardView } from "../../core/types";
import {
  detectSessionEndedTransitions,
  emitSessionEndedNotifications
} from "../liveSessionEndedNotifications";

const notifyMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../desktopNotify", () => ({
  notifySessionEndedDesktop: (...args: unknown[]) => notifyMock(...args)
}));

const baseCard = {
  sessionId: "s1",
  project: "proj",
  title: "Session",
  headline: {
    headline: "Working",
    frame: {
      subject: "Task",
      disposition: "in progress",
      state: "active" as const,
      subjectKind: "feature" as const,
      confidence: "high" as const,
      evidence: [] as string[]
    },
    source: "offline" as const,
    status: "ready" as const
  },
  stateLabel: "Working",
  primaryStatus: "running_command" as const,
  lifecycle: "running" as const,
  priorityRank: 0,
  durationLabel: "1m",
  lastActivity: "2026-01-01T00:00:00Z",
  lastActivityLabel: "1m ago",
  changedFileCount: 0,
  indicators: [] as SessionCardView["indicators"],
  identityConfidence: "direct" as const,
  safeActions: ["open_source_session"] as SessionCardView["safeActions"],
  isExpanded: false
} satisfies SessionCardView;

function card(overrides: Partial<SessionCardView> = {}): SessionCardView {
  return { ...baseCard, ...overrides };
}

function projection(cards: SessionCardView[]): LiveBoardProjection {
  return {
    summary: { active: cards.length, needsAttention: 0, conflicts: 0, completed: 0 },
    cards,
    attentionQueue: [],
    conflicts: []
  };
}

describe("detectSessionEndedTransitions", () => {
  it("detects non-ended to ended transitions only once", () => {
    const previous = projection([
      card({ sessionId: "a", lifecycle: "running", title: "Alpha", headline: { ...baseCard.headline, headline: "Alpha" } })
    ]);
    const next = projection([
      card({ sessionId: "a", lifecycle: "ended", title: "Alpha", headline: { ...baseCard.headline, headline: "Alpha" } })
    ]);
    expect(detectSessionEndedTransitions(previous, next)).toEqual([
      { sessionId: "a", title: "Alpha", body: "Working" }
    ]);
    expect(detectSessionEndedTransitions(next, next)).toEqual([]);
  });
});

describe("emitSessionEndedNotifications", () => {
  beforeEach(() => {
    notifyMock.mockClear();
  });

  it("notifies newly ended sessions", async () => {
    const runHeadline = { ...baseCard.headline, headline: "Run one" };
    const previous = projection([card({ sessionId: "s1", lifecycle: "running", title: "Run one", headline: runHeadline })]);
    const next = projection([card({ sessionId: "s1", lifecycle: "ended", title: "Run one", headline: runHeadline })]);
    const notified = new Set<string>();
    await emitSessionEndedNotifications(previous, next, { enabled: true, notifiedSessionIds: notified });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith({ title: "Run one", body: "Working" });
    expect(notified.has("s1")).toBe(true);
  });

  it("dedupes via notifiedSessionIds", async () => {
    const previous = projection([card({ sessionId: "s1", lifecycle: "running" })]);
    const next = projection([card({ sessionId: "s1", lifecycle: "ended" })]);
    const notified = new Set<string>(["s1"]);
    await emitSessionEndedNotifications(previous, next, { enabled: true, notifiedSessionIds: notified });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("no-ops when enabled is false", async () => {
    const previous = projection([card({ sessionId: "s1", lifecycle: "running" })]);
    const next = projection([card({ sessionId: "s1", lifecycle: "ended" })]);
    const notified = new Set<string>();
    await emitSessionEndedNotifications(previous, next, { enabled: false, notifiedSessionIds: notified });
    expect(notifyMock).not.toHaveBeenCalled();
    expect(notified.size).toBe(0);
  });
});