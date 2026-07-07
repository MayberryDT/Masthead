import { describe, expect, test } from "vitest";
import { buildLiveHeadlineFacts } from "../liveHeadlineFacts.ts";
import { normalizeLiveStateReport } from "../liveState.ts";
import type { LiveBlocker } from "../liveBlockers.ts";
import type { GitSnapshot, NormalizedEvent } from "../types.ts";

describe("live headline facts", () => {
  test("bounds transcript messages by count and bytes", () => {
    const facts = buildLiveHeadlineFacts({
      sessionId: "session-1",
      sourceSessionId: "source-1",
      events: [],
      transcriptFacts: {
        recentMessages: Array.from({ length: 30 }, (_, index) => ({
          role: "assistant",
          text: `message-${index} ${"x".repeat(100)}`,
          observedAt: `2026-07-07T12:${String(index).padStart(2, "0")}:00.000Z`
        }))
      },
      maxMessages: 3,
      maxBytes: 180,
      now: new Date("2026-07-07T13:00:00.000Z")
    });

    expect(facts.recentMessages.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(facts.recentMessages).length).toBeLessThan(500);
  });

  test("includes live state, blockers, recent events, changed files, and stable fingerprints", () => {
    const liveState = normalizeLiveStateReport({
      runtime: "codex",
      source: "codex.hook",
      sourceSessionId: "source-1",
      state: "blocked",
      message: "waiting on approval",
      observedAt: "2026-07-07T12:00:00.000Z"
    });
    const blocker: LiveBlocker = {
      blockerId: "blocker-1",
      runtime: "codex",
      sourceSessionId: "source-1",
      kind: "approval",
      title: "Approval requested",
      openedAt: "2026-07-07T12:00:00.000Z",
      evidenceEventIds: ["event-1"]
    };

    const first = buildLiveHeadlineFacts({
      sessionId: "session-1",
      sourceSessionId: "source-1",
      runtime: "codex",
      events: [event("event-1", "approval.requested", "Approval requested")],
      liveState,
      blockers: [blocker],
      gitSnapshots: [snapshot("src/liveState.ts")],
      now: new Date("2026-07-07T13:00:00.000Z")
    });
    const second = buildLiveHeadlineFacts({
      sessionId: "session-1",
      sourceSessionId: "source-1",
      runtime: "codex",
      events: [event("event-1", "approval.requested", "Approval requested")],
      liveState,
      blockers: [blocker],
      gitSnapshots: [snapshot("src/liveState.ts")],
      now: new Date("2026-07-07T13:00:00.000Z")
    });
    const changed = buildLiveHeadlineFacts({
      sessionId: "session-1",
      sourceSessionId: "source-1",
      runtime: "codex",
      events: [event("event-2", "turn.completed", "Turn completed")],
      liveState,
      blockers: [blocker],
      gitSnapshots: [snapshot("src/liveState.ts")],
      now: new Date("2026-07-07T13:00:00.000Z")
    });

    expect(first).toMatchObject({
      latestLiveState: { state: "blocked", message: "waiting on approval" },
      blockers: [{ kind: "approval", title: "Approval requested" }],
      recentEvents: [{ type: "approval.requested", summary: "Approval requested" }],
      changedFiles: ["liveState.ts"]
    });
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).not.toBe(changed.fingerprint);
  });
});

function event(eventId: string, type: NormalizedEvent["type"], summary: string): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId,
    sessionId: "session-1",
    source: { adapter: "codex", surface: "hook", sourceEventId: eventId },
    occurredAt: "2026-07-07T12:00:00.000Z",
    receivedAt: "2026-07-07T12:00:00.000Z",
    type,
    summary,
    payload: { runtime: "codex", sourceSessionId: "source-1" },
    sensitivity: "metadata",
    payloadHash: eventId,
    evidence: []
  };
}

function snapshot(path: string): GitSnapshot {
  return {
    snapshotId: "snapshot-1",
    sessionId: "session-1",
    repoRoot: "/workspace/masthead",
    worktreePath: "/workspace/masthead",
    gitCommonDir: "/workspace/masthead/.git",
    changedPaths: [{ path, status: "modified", staged: false, sensitivity: "metadata" }],
    observedAt: "2026-07-07T12:00:00.000Z"
  };
}
