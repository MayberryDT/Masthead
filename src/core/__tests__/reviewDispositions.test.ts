import { describe, expect, test } from "vitest";
import {
  applyReviewDispositions,
  createReviewDisposition,
  reviewDispositionRecord
} from "../reviewDispositions";
import { projectFixture } from "../replay";
import type { GitSnapshot, NormalizedEvent } from "../types";

const observedAt = "2026-06-23T05:00:00.000Z";

describe("review disposition projection", () => {
  test("stale session dismissal does not overwrite newer running activity", () => {
    const board = projectFixture(
      {
        events: [
          event("session-start", "session-active", "session.started", "2026-06-23T05:00:00.000Z"),
          event("newer-command", "session-active", "command.finished", "2026-06-23T05:05:00.000Z", {
            commandId: "cmd-continue"
          })
        ],
        gitSnapshots: []
      },
      { expandedSessionId: "session-active" }
    );
    const disposition = createReviewDisposition({
      action: "dismiss",
      subject: { subjectId: "session-active", subjectType: "session" },
      recordedAt: "2026-06-23T05:02:00.000Z",
      reason: "Old state was not actionable."
    });

    const applied = applyReviewDispositions(board, [disposition], new Date("2026-06-23T05:06:00.000Z"));
    const card = applied.cards.find((candidate) => candidate.sessionId === "session-active");
    const selected = (
      applied as typeof applied & {
        selectedSession?: { reviewAnnotations?: Array<{ status: string; stale: boolean; reason?: string }> };
      }
    ).selectedSession;

    expect(card).toMatchObject({
      primaryStatus: "reading",
      lifecycle: "running"
    });
    expect(card?.stateLabel).not.toBe("Dismissed");
    expect(selected?.reviewAnnotations).toContainEqual({
      status: "dismissed",
      recordedAt: "2026-06-23T05:02:00.000Z",
      stale: true,
      reason: "Old state was not actionable."
    });
  });

  test("marks a completed unreviewed session as reviewed and removes review-needed attention", () => {
    const board = projectFixture({
      events: [
        event("done-start", "session-done", "session.started", "2026-06-23T05:00:00.000Z"),
        event("done-complete", "session-done", "session.completed", "2026-06-23T05:05:00.000Z")
      ],
      gitSnapshots: [snapshot("snapshot-done", "session-done")]
    });
    expect(board.attentionQueue.map((item) => item.type)).toContain("completed_without_verification");

    const disposition = createReviewDisposition({
      action: "mark_reviewed",
      subject: { subjectId: "session-done", subjectType: "session" },
      recordedAt: "2026-06-23T05:06:00.000Z"
    });
    const applied = applyReviewDispositions(board, [disposition], new Date("2026-06-23T05:07:00.000Z"));

    expect(applied.summary.needsAttention).toBe(0);
    expect(applied.attentionQueue).toEqual([]);
    expect(applied.lanes?.find((lane) => lane.laneId === "history")?.sessionIds).toEqual(["session-done"]);
    expect(applied.lanes?.find((lane) => lane.laneId === "needs_action")?.sessionIds).toEqual([]);
    expect(applied.cards[0]).toMatchObject({
      primaryStatus: "completed_reviewed",
      stateLabel: "Reviewed",
      attentionReason: undefined
    });
  });

  test("dismisses direct attention records without deleting the evidence from local history", () => {
    const board = projectFixture({
      events: [
        event("approval-start", "session-approval", "session.started", "2026-06-23T05:00:00.000Z"),
        event("approval-request", "session-approval", "approval.requested", "2026-06-23T05:01:00.000Z")
      ],
      gitSnapshots: []
    });
    const item = board.attentionQueue[0]!;
    const disposition = createReviewDisposition({
      action: "dismiss",
      subject: { subjectId: item.itemId, subjectType: "attention_item" },
      recordedAt: "2026-06-23T05:02:00.000Z",
      reason: "Expected prompt."
    });
    const record = reviewDispositionRecord(disposition);
    const applied = applyReviewDispositions(board, [disposition], new Date("2026-06-23T05:03:00.000Z"));

    expect(record.recordType).toBe("review_disposition");
    expect(disposition.reason).toBe("Expected prompt.");
    expect(applied.summary.needsAttention).toBe(0);
    expect(applied.summary.needsAction).toBe(0);
    expect(applied.lanes?.find((lane) => lane.laneId === "needs_action")?.sessionIds).toEqual([]);
    expect(applied.cards[0]?.indicators).not.toContain("attention");
    expect(applied.cards[0]?.attentionReason).toBeUndefined();
    expect(applied.attentionQueue).toEqual([]);
    expect(board.attentionQueue[0]?.evidence).toEqual(item.evidence);
  });

  test("older session disposition does not suppress newer attention", () => {
    const board = projectFixture({
      events: [
        event("session-start", "session-new-attention", "session.started", "2026-06-23T05:00:00.000Z"),
        event("approval-later", "session-new-attention", "approval.requested", "2026-06-23T05:05:00.000Z")
      ],
      gitSnapshots: []
    });
    const disposition = createReviewDisposition({
      action: "dismiss",
      subject: { subjectId: "session-new-attention", subjectType: "session" },
      recordedAt: "2026-06-23T05:02:00.000Z"
    });
    const applied = applyReviewDispositions(board, [disposition], new Date("2026-06-23T05:06:00.000Z"));

    expect(applied.attentionQueue).toHaveLength(1);
    expect(applied.summary).toMatchObject({
      needsAttention: 1,
      needsAction: 0
    });
    expect(applied.lanes?.find((lane) => lane.laneId === "running")?.sessionIds).toEqual(["session-new-attention"]);
    expect(applied.lanes?.find((lane) => lane.laneId === "needs_action")?.sessionIds).toEqual([]);
    expect(applied.cards[0]).toMatchObject({
      lifecycle: "running",
      attentionReason: "Approval requested"
    });
  });

  test("hides future snoozes and shows attention again after the latest snooze expires", () => {
    const board = projectFixture({
      events: [
        event("question-start", "session-question", "session.started", "2026-06-23T05:00:00.000Z"),
        event("question-asked", "session-question", "user.question", "2026-06-23T05:01:00.000Z")
      ],
      gitSnapshots: []
    });
    const item = board.attentionQueue[0]!;
    const disposition = createReviewDisposition({
      action: "snooze",
      subject: { subjectId: item.itemId, subjectType: "attention_item" },
      recordedAt: "2026-06-23T05:02:00.000Z",
      snoozedUntil: "2026-06-23T06:02:00.000Z"
    });

    expect(applyReviewDispositions(board, [disposition], new Date("2026-06-23T05:30:00.000Z")).attentionQueue).toEqual([]);
    expect(applyReviewDispositions(board, [disposition], new Date("2026-06-23T06:03:00.000Z")).attentionQueue).toHaveLength(1);
  });

  test("expected conflict suppresses conflict attention while preserving the conflict card", () => {
    const board = projectFixture({
      events: [
        event("a-start", "session-a", "session.started", "2026-06-23T05:00:00.000Z"),
        event("b-start", "session-b", "session.started", "2026-06-23T05:00:01.000Z")
      ],
      gitSnapshots: [
        snapshot("snapshot-a", "session-a"),
        snapshot("snapshot-b", "session-b")
      ]
    });
    const conflict = board.conflicts[0]!;
    expect(board.attentionQueue.filter((item) => item.type === "conflict")).toHaveLength(2);

    const disposition = createReviewDisposition({
      action: "mark_expected",
      subject: { subjectId: conflict.conflictId, subjectType: "conflict_card" },
      recordedAt: "2026-06-23T05:04:00.000Z"
    });
    const applied = applyReviewDispositions(board, [disposition], new Date("2026-06-23T05:05:00.000Z"));

    expect(applied.attentionQueue.filter((item) => item.type === "conflict")).toEqual([]);
    expect(applied.conflicts).toEqual(board.conflicts);
    expect(applied.summary.conflicts).toBe(1);
  });
});

function event(
  eventId: string,
  sessionId: string,
  type: NormalizedEvent["type"],
  occurredAt: string,
  payload: Record<string, unknown> = {}
): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId,
    sessionId,
    source: { adapter: "codex", surface: "fixture", sourceEventId: eventId },
    occurredAt,
    receivedAt: occurredAt,
    type,
    workspace: {
      repoRoot: "/workspace/app",
      worktreePath: `/workspace/app-${sessionId}`,
      gitCommonDir: "/workspace/app/.git",
      branch: `agent/${sessionId}`
    },
    summary: type,
    payload: {
      project: "App",
      title: sessionId,
      attribution: "direct",
      ...payload
    },
    sensitivity: "metadata",
    payloadHash: `hash-${eventId}`,
    evidence: [{ id: eventId, kind: "event", observedAt: occurredAt, source: "codex.fixture" }]
  };
}

function snapshot(snapshotId: string, sessionId: string): GitSnapshot {
  return {
    snapshotId,
    sessionId,
    repoRoot: "/workspace/app",
    worktreePath: `/workspace/app-${sessionId}`,
    gitCommonDir: "/workspace/app/.git",
    branch: `agent/${sessionId}`,
    headSha: "abc123",
    changedPaths: [
      {
        path: "src/shared.ts",
        status: "modified",
        staged: false,
        additions: 2,
        deletions: 1,
        sensitivity: "metadata"
      }
    ],
    observedAt
  };
}
