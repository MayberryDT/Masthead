import { describe, expect, test } from "vitest";
import { deleteLocalHistory, exportHistory, searchHistory, type HistorySearchFilters } from "../history";
import { createInMemoryStore, type ReviewDisposition, type StoreRecord } from "../store";
import type { AttentionItem, ConflictCard, GitSnapshot, NormalizedEvent } from "../types";

const observedAt = "2026-06-23T02:30:00.000Z";
const evidence = [{ id: "event-1", kind: "event" as const, observedAt, source: "fixture" }];

describe("history core slice", () => {
  test.each([
    [{ project: "pip" }, ["session-a"]],
    [{ sessionId: "SESSION-A" }, ["session-a"]],
    [{ filePath: "checkout.ts" }, ["session-a"]],
    [{ command: "npm test" }, ["session-a"]],
    [{ commandId: "cmd-build" }, ["session-b"]],
    [{ status: "failed" }, ["session-b"]],
    [{ branch: "feature/checkout" }, ["session-a"]],
    [{ alertType: "command_failed" }, ["session-b"]],
    [{ conflictType: "shared_resource" }, ["session-a", "session-b"]],
    [{ outcome: "failed" }, ["session-b"]],
    [{ disposition: "expected" }, ["session-a"]]
  ] satisfies Array<[HistorySearchFilters, string[]]>)("filters local history by %j", (filters, sessionIds) => {
    const result = searchHistory(historyRecords(), filters);

    expect(result.sessions.map((session) => session.sessionId)).toEqual(sessionIds);
  });

  test("exports records with stable Masthead history formatting metadata", () => {
    const records = historyRecords();
    const exported = exportHistory(records, {
      exportedAt: "2026-06-23T03:04:05.000Z",
      filters: { project: "Pip" }
    });

    expect(exported.contentType).toBe("application/json");
    expect(exported.filename).toBe("masthead-history-20260623T030405000Z.json");
    expect(exported.metadata).toEqual({
      format: "masthead.history.v1",
      schemaVersion: 1,
      exportedAt: "2026-06-23T03:04:05.000Z",
      recordCount: records.length,
      sessionCount: 2,
      recordTypes: {
        event: 5,
        git_snapshot: 2,
        attention_item: 1,
        conflict_card: 1,
        review_disposition: 1
      },
      filters: { project: "Pip" }
    });

    expect(JSON.parse(exported.body)).toEqual({
      metadata: exported.metadata,
      records
    });
  });

  test("deletes local history with complete non-external side effect semantics", async () => {
    const records = historyRecords();
    const store = createInMemoryStore(records);

    const result = await deleteLocalHistory(store, { deletedAt: "2026-06-23T03:10:00.000Z" });

    expect(result).toEqual({
      deletedAt: "2026-06-23T03:10:00.000Z",
      removedRecords: records.length,
      removedRecordIds: records.map((record) => record.recordId),
      removedByType: {
        event: 5,
        git_snapshot: 2,
        attention_item: 1,
        conflict_card: 1,
        review_disposition: 1
      },
      localRecordsRemaining: 0,
      touchedExternalState: false,
      externalState: {
        codexSessions: "untouched",
        gitRepositories: "untouched",
        sourceFiles: "untouched",
        externalServices: "untouched"
      }
    });
    expect(store.readAll()).toEqual([]);
  });
});

function historyRecords(): StoreRecord[] {
  const sessionAStart = event("session-a", "a-start", "session.started", {
    project: "Pip",
    title: "Fix checkout",
    objective: "Repair checkout flow"
  });
  const sessionATest = event("session-a", "a-test", "command.finished", {
    commandId: "cmd-test",
    category: "test",
    normalizedCommand: "npm test -- checkout",
    command: "npm test -- checkout",
    exitCode: 0
  });
  const sessionAComplete = event("session-a", "a-complete", "session.completed", {});
  const sessionBStart = event("session-b", "b-start", "session.started", {
    project: "Docs",
    title: "Refresh docs"
  });
  const sessionBBuild = event("session-b", "b-build", "command.finished", {
    commandId: "cmd-build",
    category: "build",
    normalizedCommand: "npm run build",
    command: "npm run build",
    exitCode: 1
  });

  const snapshotA: GitSnapshot = {
    snapshotId: "snapshot-a",
    sessionId: "session-a",
    repoRoot: "/work/pip",
    worktreePath: "/work/pip-checkout",
    gitCommonDir: "/work/pip/.git",
    branch: "feature/checkout",
    headSha: "abc123",
    changedPaths: [
      {
        path: "src/payments/checkout.ts",
        status: "modified",
        staged: false,
        additions: 8,
        deletions: 2,
        sensitivity: "metadata"
      }
    ],
    observedAt
  };
  const snapshotB: GitSnapshot = {
    snapshotId: "snapshot-b",
    sessionId: "session-b",
    repoRoot: "/work/docs",
    worktreePath: "/work/docs",
    gitCommonDir: "/work/docs/.git",
    branch: "docs/readme",
    headSha: "def456",
    changedPaths: [
      {
        path: "docs/README.md",
        status: "modified",
        staged: true,
        additions: 3,
        deletions: 1,
        sensitivity: "metadata"
      }
    ],
    observedAt
  };
  const attention: AttentionItem = {
    itemId: "attention:session-b:command",
    sessionId: "session-b",
    project: "Docs",
    type: "command_failed",
    severity: "P1",
    title: "Build failed",
    createdAt: observedAt,
    affectedPaths: ["docs/README.md"],
    affectedCommandIds: ["cmd-build"],
    evidence,
    support: "deterministic",
    suggestedNextAction: "Inspect build failure."
  };
  const conflict: ConflictCard = {
    conflictId: "conflict:resource:dev-server",
    type: "shared_resource",
    severity: "medium",
    sessionIds: ["session-a", "session-b"],
    repo: {
      gitCommonDir: "/work/shared/.git",
      worktreePaths: ["/work/pip-checkout", "/work/docs"]
    },
    sharedPaths: [],
    attribution: "direct",
    title: "Shared dev server",
    evidence
  };
  const disposition: ReviewDisposition = {
    dispositionId: "review:session-a",
    subjectId: "session-a",
    subjectType: "session",
    status: "expected",
    recordedAt: "2026-06-23T02:45:00.000Z",
    reviewer: "tyler"
  };

  return [
    record("event", sessionAStart.eventId, sessionAStart),
    record("event", sessionATest.eventId, sessionATest),
    record("event", sessionAComplete.eventId, sessionAComplete),
    record("event", sessionBStart.eventId, sessionBStart),
    record("event", sessionBBuild.eventId, sessionBBuild),
    record("git_snapshot", snapshotA.snapshotId, snapshotA),
    record("git_snapshot", snapshotB.snapshotId, snapshotB),
    record("attention_item", attention.itemId, attention),
    record("conflict_card", conflict.conflictId, conflict),
    record("review_disposition", disposition.dispositionId, disposition)
  ];
}

function event(
  sessionId: string,
  eventId: string,
  type: NormalizedEvent["type"],
  payload: Record<string, unknown>
): NormalizedEvent {
  const branch = sessionId === "session-a" ? "feature/checkout" : "docs/readme";

  return {
    schemaVersion: 1,
    eventId,
    sessionId,
    source: { adapter: "codex", surface: "fixture", sourceEventId: eventId },
    occurredAt: `2026-06-23T02:${eventId.length.toString().padStart(2, "0")}:00.000Z`,
    receivedAt: `2026-06-23T02:${eventId.length.toString().padStart(2, "0")}:00.000Z`,
    type,
    workspace: {
      repoRoot: sessionId === "session-a" ? "/work/pip" : "/work/docs",
      worktreePath: sessionId === "session-a" ? "/work/pip-checkout" : "/work/docs",
      branch
    },
    summary: type,
    payload,
    sensitivity: "metadata",
    payloadHash: `hash-${eventId}`,
    evidence
  };
}

function record<T extends StoreRecord["recordType"]>(
  recordType: T,
  subjectId: string,
  value: Extract<StoreRecord, { recordType: T }>["value"]
): Extract<StoreRecord, { recordType: T }> {
  return {
    recordId: `record:${recordType}:${subjectId}`,
    recordType,
    observedAt,
    value
  } as Extract<StoreRecord, { recordType: T }>;
}
