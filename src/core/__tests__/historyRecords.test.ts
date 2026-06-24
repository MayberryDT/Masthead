import { describe, expect, test } from "vitest";
import { buildHistoryRecords } from "../historyRecords";
import type { AttentionItem, ConflictCard, GitSnapshot, NormalizedEvent } from "../types";
import type { ReviewDisposition, StoreRecord } from "../store";

const observedAt = "2026-06-23T07:00:00.000Z";
const evidence = [{ id: "event-1", kind: "event" as const, observedAt, source: "fixture" }];

describe("history record projection", () => {
  test("builds deduped store records from live or fixture evidence plus persisted local records", () => {
    const event = normalizedEvent();
    const snapshot = gitSnapshot();
    const attention = attentionItem();
    const conflict = conflictCard();
    const disposition = reviewDisposition();
    const storedDispositionRecord: StoreRecord = {
      recordId: `record:review_disposition:${disposition.dispositionId}`,
      recordType: "review_disposition",
      observedAt: disposition.recordedAt,
      value: disposition
    };

    const records = buildHistoryRecords({
      events: [event],
      gitSnapshots: [snapshot],
      attentionItems: [attention],
      conflicts: [conflict],
      reviewDispositions: [disposition],
      storedRecords: [storedDispositionRecord]
    });

    expect(records.map((record) => record.recordType).toSorted()).toEqual([
      "attention_item",
      "conflict_card",
      "event",
      "git_snapshot",
      "review_disposition"
    ]);
    expect(records.filter((record) => record.recordType === "review_disposition")).toHaveLength(1);
  });
});

function normalizedEvent(): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId: "event-1",
    sessionId: "session-1",
    source: { adapter: "codex", surface: "fixture", sourceEventId: "event-1" },
    occurredAt: observedAt,
    receivedAt: observedAt,
    type: "session.started",
    workspace: { repoRoot: "/workspace/app", worktreePath: "/workspace/app", gitCommonDir: "/workspace/app/.git" },
    summary: "Started",
    payload: { project: "App", title: "History case" },
    sensitivity: "metadata",
    payloadHash: "hash-event-1",
    evidence
  };
}

function gitSnapshot(): GitSnapshot {
  return {
    snapshotId: "snapshot-1",
    sessionId: "session-1",
    repoRoot: "/workspace/app",
    worktreePath: "/workspace/app",
    gitCommonDir: "/workspace/app/.git",
    changedPaths: [{ path: "src/app.ts", status: "modified", staged: false, sensitivity: "metadata" }],
    observedAt
  };
}

function attentionItem(): AttentionItem {
  return {
    itemId: "attention-1",
    sessionId: "session-1",
    project: "App",
    type: "stale_verification",
    severity: "P2",
    title: "Verification is stale",
    createdAt: observedAt,
    affectedPaths: ["src/app.ts"],
    affectedCommandIds: ["cmd-test"],
    evidence,
    support: "deterministic",
    suggestedNextAction: "Re-run verification."
  };
}

function conflictCard(): ConflictCard {
  return {
    conflictId: "conflict-1",
    type: "exact_file_overlap",
    severity: "high",
    sessionIds: ["session-1", "session-2"],
    repo: { gitCommonDir: "/workspace/app/.git", worktreePaths: ["/workspace/app"] },
    sharedPaths: ["src/app.ts"],
    attribution: "direct",
    title: "Same tracked path changed",
    evidence
  };
}

function reviewDisposition(): ReviewDisposition {
  return {
    dispositionId: "review-session-1",
    subjectId: "session-1",
    subjectType: "session",
    status: "reviewed",
    recordedAt: "2026-06-23T07:05:00.000Z"
  };
}
