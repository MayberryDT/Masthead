import { describe, expect, test } from "vitest";
import { selectEffectiveLiveState } from "../liveProjectionState.ts";
import { normalizeLiveStateReport } from "../liveState.ts";
import type { DerivedSession, NormalizedEvent } from "../types.ts";

describe("live projection state selector", () => {
  test("fresh blocked report wins over session status", () => {
    const effective = selectEffectiveLiveState({
      session: session({ primaryStatus: "reading", lifecycle: "running" }),
      latestLiveState: normalizeLiveStateReport({
        runtime: "codex",
        source: "hook",
        sourceSessionId: "source-1",
        state: "blocked",
        observedAt: "2026-07-07T12:00:00.000Z"
      }),
      unresolvedBlockers: [],
      now: new Date("2026-07-07T12:01:00.000Z")
    });

    expect(effective).toMatchObject({ semanticState: "blocked", displayState: "blocked", authority: "live_state" });
  });

  test("unresolved blocker wins over stale idle report", () => {
    const effective = selectEffectiveLiveState({
      session: session({ primaryStatus: "reading", lifecycle: "running" }),
      latestLiveState: normalizeLiveStateReport({
        runtime: "codex",
        source: "hook",
        sourceSessionId: "source-1",
        state: "idle",
        observedAt: "2026-07-07T11:00:00.000Z",
        ttlMs: 1
      }),
      unresolvedBlockers: [
        {
          blockerId: "blocker-1",
          runtime: "codex",
          sourceSessionId: "source-1",
          kind: "approval",
          title: "Approval requested",
          openedAt: "2026-07-07T12:00:00.000Z",
          evidenceEventIds: ["approval-1"]
        }
      ],
      now: new Date("2026-07-07T12:01:00.000Z")
    });

    expect(effective).toMatchObject({ semanticState: "blocked", authority: "blocker" });
  });

  test("turn completion becomes idle/done rather than ended", () => {
    const latestEvent = event("turn.completed");
    const effective = selectEffectiveLiveState({
      session: session({ primaryStatus: "completed_unreviewed", lifecycle: "idle" }),
      latestEvent,
      latestStateEvent: latestEvent,
      unresolvedBlockers: [],
      now: new Date("2026-07-07T12:01:00.000Z")
    });

    expect(effective).toMatchObject({ semanticState: "idle", displayState: "done", authority: "event" });
  });

  test("stale working report falls back to idle timeout", () => {
    const effective = selectEffectiveLiveState({
      session: session({
        primaryStatus: "reading",
        lifecycle: "idle",
        lastMeaningfulActivityAt: "2026-07-07T11:00:00.000Z"
      }),
      latestLiveState: normalizeLiveStateReport({
        runtime: "codex",
        source: "hook",
        sourceSessionId: "source-1",
        state: "working",
        observedAt: "2026-07-07T11:00:00.000Z",
        ttlMs: 1
      }),
      unresolvedBlockers: [],
      now: new Date("2026-07-07T12:00:00.000Z")
    });

    expect(effective).toMatchObject({ semanticState: "idle", authority: "timeout" });
  });

  test("fresh command event can imply working inside the refresh grace window", () => {
    const latestEvent = event("command.started", "2026-07-07T12:00:00.000Z");
    const effective = selectEffectiveLiveState({
      session: session({ primaryStatus: "reading", lifecycle: "running" }),
      latestEvent,
      latestStateEvent: latestEvent,
      unresolvedBlockers: [],
      now: new Date("2026-07-07T12:00:19.000Z"),
      eventWorkingGraceMs: 20_000
    });

    expect(effective).toMatchObject({
      semanticState: "working",
      displayState: "working",
      authority: "event",
      stateObservedAt: "2026-07-07T12:00:00.000Z"
    });
  });

  test("stale command event demotes to idle on projection refresh", () => {
    const effective = selectEffectiveLiveState({
      session: session({ primaryStatus: "reading", lifecycle: "running" }),
      latestEvent: event("file.changed", "2026-07-07T12:00:05.000Z"),
      latestStateEvent: event("command.started", "2026-07-07T12:00:00.000Z"),
      unresolvedBlockers: [],
      now: new Date("2026-07-07T12:00:21.000Z"),
      eventWorkingGraceMs: 20_000
    });

    expect(effective).toMatchObject({
      semanticState: "idle",
      displayState: "idle",
      authority: "timeout",
      stale: true
    });
  });

  test("user questions are not live blockers", () => {
    const question = event("user.question", "2026-07-07T12:00:00.000Z");
    const effective = selectEffectiveLiveState({
      session: session({ primaryStatus: "waiting_for_user", lifecycle: "running" }),
      latestEvent: question,
      latestStateEvent: undefined,
      unresolvedBlockers: [],
      now: new Date("2026-07-07T12:00:05.000Z"),
      eventWorkingGraceMs: 20_000
    });

    expect(effective).toMatchObject({
      semanticState: "idle",
      displayState: "idle",
      authority: "timeout",
      stale: true
    });
  });

  test("running sessions without fresh proof are demoted to idle", () => {
    const effective = selectEffectiveLiveState({
      session: session({ primaryStatus: "reading", lifecycle: "running" }),
      latestEvent: event("session.started", "2026-07-07T12:00:00.000Z"),
      latestStateEvent: undefined,
      unresolvedBlockers: [],
      now: new Date("2026-07-07T12:00:21.000Z"),
      eventWorkingGraceMs: 20_000
    });

    expect(effective).toMatchObject({
      semanticState: "idle",
      displayState: "idle",
      authority: "timeout",
      stale: true
    });
  });
});

function session(overrides: Partial<DerivedSession>): DerivedSession {
  return {
    sessionId: "session-1",
    sourceSessionId: "source-1",
    runtime: "codex",
    harness: "Codex",
    project: "Masthead",
    title: "Masthead session",
    primaryStatus: "reading",
    lifecycle: "running",
    flags: [],
    lastMeaningfulActivityAt: "2026-07-07T12:00:00.000Z",
    attribution: "direct",
    changedFileCount: 0,
    evidence: [],
    ...overrides
  };
}

function event(type: NormalizedEvent["type"], occurredAt = "2026-07-07T12:00:00.000Z"): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${type}`,
    sessionId: "session-1",
    source: { adapter: "codex", surface: "hook", sourceEventId: `event-${type}` },
    occurredAt,
    receivedAt: occurredAt,
    type,
    summary: type,
    payload: { runtime: "codex", sourceSessionId: "source-1" },
    sensitivity: "metadata",
    payloadHash: `hash-${type}`,
    evidence: []
  };
}
