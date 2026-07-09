import { describe, expect, test } from "vitest";
import type { SessionCardView } from "../../core/types";
import {
  applyIdlePresentation,
  IDLE_CONFIRM_TICKS,
  markIdleDoneSeen,
  type IdlePresentationTrack
} from "../sessionIdlePresentation";

function card(overrides: Partial<SessionCardView> & { sessionId: string }): SessionCardView {
  return {
    sessionId: overrides.sessionId,
    project: "Masthead",
    title: "Session",
    headline: { headline: "Session", source: "fallback", confidence: "low" },
    stateLabel: "Active",
    primaryStatus: "reading",
    lifecycle: "running",
    priorityRank: 1,
    durationLabel: "1m",
    lastActivity: "2026-07-09T00:00:00.000Z",
    lastActivityLabel: "now",
    changedFileCount: 0,
    indicators: [],
    identityConfidence: "high",
    safeActions: [],
    isExpanded: false,
    ...overrides
  };
}

describe("applyIdlePresentation", () => {
  test("requires consecutive quiet ticks before confirming idle", () => {
    const tracks = new Map<string, IdlePresentationTrack>();
    const quiet = card({ sessionId: "s1", lifecycle: "idle", stateLabel: "Idle", primaryStatus: "stalled" });

    for (let i = 1; i < IDLE_CONFIRM_TICKS; i += 1) {
      const next = applyIdlePresentation([quiet], tracks)[0];
      expect(next.lifecycle).toBe("running");
      expect(next.stateLabel).toBe("Active");
      expect(tracks.get("s1")?.consecutiveQuietTicks).toBe(i);
    }

    const confirmed = applyIdlePresentation([quiet], tracks)[0];
    expect(confirmed.lifecycle).toBe("idle");
    expect(confirmed.displayState).toBe("done");
    expect(confirmed.stateLabel).toBe("Done");
    expect(tracks.get("s1")?.confirmedQuiet).toBe(true);
    expect(tracks.get("s1")?.doneUntilHover).toBe(true);
  });

  test("resets quiet streak when session becomes active again", () => {
    const tracks = new Map<string, IdlePresentationTrack>();
    const quiet = card({ sessionId: "s1", lifecycle: "idle", stateLabel: "Idle", primaryStatus: "stalled" });
    applyIdlePresentation([quiet], tracks);
    applyIdlePresentation([quiet], tracks);

    const active = card({ sessionId: "s1", lifecycle: "running", stateLabel: "Active" });
    const next = applyIdlePresentation([active], tracks)[0];
    expect(next.lifecycle).toBe("running");
    expect(tracks.get("s1")).toEqual({
      consecutiveQuietTicks: 0,
      confirmedQuiet: false,
      doneUntilHover: false
    });
  });

  test("done until hover then idle", () => {
    const tracks = new Map<string, IdlePresentationTrack>();
    const quiet = card({ sessionId: "s1", lifecycle: "idle", stateLabel: "Idle", primaryStatus: "stalled" });
    for (let i = 0; i < IDLE_CONFIRM_TICKS; i += 1) applyIdlePresentation([quiet], tracks);

    expect(applyIdlePresentation([quiet], tracks)[0].displayState).toBe("done");
    markIdleDoneSeen(tracks, "s1");
    const afterHover = applyIdlePresentation([quiet], tracks)[0];
    expect(afterHover.displayState).toBe("idle");
    expect(afterHover.stateLabel).toBe("Idle");
  });
});
