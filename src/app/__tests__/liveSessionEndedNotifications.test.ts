import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveBoardProjection, SessionCardView } from "../../core/types";
import {
  detectSessionNotificationTransitions,
  emitSessionTransitionNotifications
} from "../liveSessionEndedNotifications";

const notifyMock = vi.fn();
vi.mock("../desktopNotify", () => ({
  notifySessionTransitionDesktop: (...args: unknown[]) => notifyMock(...args)
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

function cardHeadline(headline: string): SessionCardView["headline"] {
  return { ...baseCard.headline, headline };
}

function projection(cards: SessionCardView[]): LiveBoardProjection {
  return {
    summary: { active: cards.length, needsAttention: 0, conflicts: 0, completed: 0 },
    cards,
    attentionQueue: [],
    conflicts: []
  };
}

describe("detectSessionNotificationTransitions", () => {
  it("uses the first successful projection as a baseline without notifying historical terminal states", () => {
    const next = projection([
      card({ sessionId: "idle", lifecycle: "idle", stateLabel: "Idle" }),
      card({ sessionId: "blocked", primaryStatus: "waiting_for_approval", attentionReason: "Approval requested" }),
      card({ sessionId: "ended", lifecycle: "ended", stateLabel: "Completed", outcomeLabel: "completed" })
    ]);

    expect(detectSessionNotificationTransitions(undefined, next)).toEqual([]);
  });

  it("detects running sessions becoming idle, permission-blocked, or ended without treating user input as blocked", () => {
    const previous = projection([
      card({ sessionId: "idle", headline: cardHeadline("Idle candidate") }),
      card({ sessionId: "approval", headline: cardHeadline("Approval candidate") }),
      card({ sessionId: "input", headline: cardHeadline("Input candidate") }),
      card({ sessionId: "ended", headline: cardHeadline("Ended candidate") })
    ]);
    const next = projection([
      card({ sessionId: "idle", lifecycle: "idle", stateLabel: "Idle", headline: cardHeadline("Idle candidate") }),
      card({
        sessionId: "approval",
        primaryStatus: "blocked",
        displayState: "blocked",
        runtimeState: "blocked",
        stateLabel: "Blocked",
        attentionReason: "Approval requested",
        headline: cardHeadline("Approval candidate")
      }),
      card({
        sessionId: "input",
        primaryStatus: "stalled",
        lifecycle: "idle",
        displayState: "idle",
        runtimeState: "idle",
        stateLabel: "Idle",
        attentionReason: "User input requested",
        headline: cardHeadline("Input candidate")
      }),
      card({
        sessionId: "ended",
        lifecycle: "ended",
        outcomeLabel: "completed",
        stateLabel: "Completed",
        headline: cardHeadline("Ended candidate")
      })
    ]);

    expect(detectSessionNotificationTransitions(previous, next)).toEqual([
      { sessionId: "idle", transition: "idle", title: "Idle candidate", body: "Idle" },
      { sessionId: "approval", transition: "blocked", title: "Approval candidate", body: "Blocked: Approval requested" },
      { sessionId: "input", transition: "idle", title: "Input candidate", body: "Idle: User input requested" },
      { sessionId: "ended", transition: "ended", title: "Ended candidate", body: "Ended: Completed" }
    ]);
  });

  it("does not report attention/conflict state, stable nonactive cards, or idle-to-ended changes as desktop transitions", () => {
    const previous = projection([
      card({ sessionId: "conflict", lifecycle: "running" }),
      card({ sessionId: "stable-idle", lifecycle: "idle", stateLabel: "Idle" }),
      card({ sessionId: "stable-approval", primaryStatus: "blocked", displayState: "blocked", runtimeState: "blocked", stateLabel: "Blocked", attentionReason: "Approval requested" }),
      card({ sessionId: "stable-ended", lifecycle: "ended", outcomeLabel: "completed", stateLabel: "Completed" }),
      card({ sessionId: "idle-to-ended", lifecycle: "idle", stateLabel: "Idle" })
    ]);
    const next = projection([
      card({ sessionId: "conflict", lifecycle: "running", indicators: ["attention", "conflict"] }),
      card({ sessionId: "stable-idle", lifecycle: "idle", stateLabel: "Idle" }),
      card({ sessionId: "stable-approval", primaryStatus: "blocked", displayState: "blocked", runtimeState: "blocked", stateLabel: "Blocked", attentionReason: "Approval requested" }),
      card({ sessionId: "stable-ended", lifecycle: "ended", outcomeLabel: "completed", stateLabel: "Completed" }),
      card({ sessionId: "idle-to-ended", lifecycle: "ended", outcomeLabel: "completed", stateLabel: "Completed" })
    ]);

    expect(detectSessionNotificationTransitions(previous, next)).toEqual([]);
  });
});

describe("emitSessionTransitionNotifications", () => {
  beforeEach(() => {
    notifyMock.mockReset();
    notifyMock.mockResolvedValue({ ok: true, shown: true });
  });

  it("emits a typed desktop notification and records the transition-specific dedupe key", async () => {
    const previous = projection([card({ sessionId: "s1", lifecycle: "running", title: "Run one", headline: cardHeadline("Run one") })]);
    const next = projection([
      card({
        sessionId: "s1",
        lifecycle: "ended",
        outcomeLabel: "completed",
        stateLabel: "Completed",
        title: "Run one",
        headline: cardHeadline("Run one")
      })
    ]);
    const notified = new Set<string>();

    await emitSessionTransitionNotifications(previous, next, { enabled: true, notifiedTransitionKeys: notified });

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith({
      sessionId: "s1",
      transition: "ended",
      title: "Run one",
      body: "Ended: Completed"
    });
    expect(notified.has("s1:ended")).toBe(true);
    expect(notified.has("s1")).toBe(false);
  });

  it("dedupes by session and transition instead of suppressing every later transition for the session", async () => {
    const previous = projection([card({ sessionId: "s1", lifecycle: "running", stateLabel: "Working" })]);
    const next = projection([card({ sessionId: "s1", lifecycle: "idle", stateLabel: "Idle" })]);
    const notified = new Set<string>(["s1:ended"]);

    await emitSessionTransitionNotifications(previous, next, { enabled: true, notifiedTransitionKeys: notified });

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notified.has("s1:idle")).toBe(true);
  });

  it("skips already recorded transition keys", async () => {
    const previous = projection([card({ sessionId: "s1", lifecycle: "running" })]);
    const next = projection([card({ sessionId: "s1", lifecycle: "idle", stateLabel: "Idle" })]);
    const notified = new Set<string>(["s1:idle"]);

    await emitSessionTransitionNotifications(previous, next, { enabled: true, notifiedTransitionKeys: notified });

    expect(notifyMock).not.toHaveBeenCalled();
    expect([...notified]).toEqual(["s1:idle"]);
  });

  it("does not mutate dedupe state while the notification preference is off", async () => {
    const previous = projection([card({ sessionId: "s1", lifecycle: "running" })]);
    const next = projection([card({ sessionId: "s1", lifecycle: "ended" })]);
    const notified = new Set<string>();

    await emitSessionTransitionNotifications(previous, next, { enabled: false, notifiedTransitionKeys: notified });

    expect(notifyMock).not.toHaveBeenCalled();
    expect(notified.size).toBe(0);
  });

  it("dedupes unsupported desktop results so browser-only environments do not retry every poll", async () => {
    notifyMock.mockResolvedValueOnce({ ok: true, shown: false, reason: "unsupported" });
    const previous = projection([card({ sessionId: "s1", lifecycle: "running" })]);
    const next = projection([card({ sessionId: "s1", lifecycle: "idle", stateLabel: "Idle" })]);
    const notified = new Set<string>();

    await emitSessionTransitionNotifications(previous, next, { enabled: true, notifiedTransitionKeys: notified });
    await emitSessionTransitionNotifications(previous, next, { enabled: true, notifiedTransitionKeys: notified });

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notified.has("s1:idle")).toBe(true);
  });
});
