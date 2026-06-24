import { describe, expect, test } from "vitest";
import { deriveAttentionItems } from "../attention";
import { deriveSessions } from "../sessionReducer";
import type { ConflictCard, GitSnapshot, NormalizedEvent } from "../types";

const event = (
  eventId: string,
  type: NormalizedEvent["type"],
  payload: Record<string, unknown> = {},
  occurredAt = `2026-06-23T02:00:0${eventId.length % 9}.000Z`
): NormalizedEvent => ({
  schemaVersion: 1,
  eventId,
  sessionId: "session-1",
  source: { adapter: "codex", surface: "fixture", sourceEventId: eventId },
  occurredAt,
  receivedAt: occurredAt,
  type,
  summary: type,
  payload: { project: "App", title: "Attention case", ...payload },
  sensitivity: "metadata",
  payloadHash: `hash-${eventId}`,
  evidence: [{ id: eventId, kind: "event", observedAt: "2026-06-23T02:00:00.000Z", source: "codex.fixture" }]
});

describe("attention engine", () => {
  test("destructive or production approval becomes deterministic P0", () => {
    const events = [
      event("start", "session.started"),
      event("approval", "approval.requested", { commandId: "cmd-1", blastRadius: "production" })
    ];
    const items = deriveAttentionItems(deriveSessions(events), events, []);

    expect(items[0]).toMatchObject({
      type: "approval_requested",
      severity: "P0",
      support: "deterministic"
    });
    expect(items[0]?.evidence).not.toHaveLength(0);
  });

  test("approval attention clears after later session activity", () => {
    const events = [
      event("start", "session.started"),
      event("approval", "approval.requested", { commandId: "cmd-1", blastRadius: "production" }),
      event("later", "command.finished", { commandId: "cmd-1" }, "2026-06-23T02:00:09.000Z")
    ];
    const items = deriveAttentionItems(deriveSessions(events), events, []);

    expect(items.some((item) => item.type === "approval_requested")).toBe(false);
  });

  test("command events without exit status do not create repeated-failure attention", () => {
    const events = [
      event("start", "session.started"),
      event("cmd-1", "command.finished", { commandId: "cmd-1", normalizedCommand: "npm test" }),
      event("cmd-2", "command.finished", { commandId: "cmd-2", normalizedCommand: "npm test" }),
      event("cmd-3", "command.finished", { commandId: "cmd-3", normalizedCommand: "npm test" })
    ];
    const items = deriveAttentionItems(deriveSessions(events), events, []);

    expect(items.some((item) => item.type === "repeated_failure")).toBe(false);
  });

  test("one recovered failure does not create a repeated-failure interruption", () => {
    const events = [
      event("start", "session.started"),
      event("fail", "command.finished", { commandId: "cmd-1", normalizedCommand: "npm test", exitCode: 1 }),
      event("pass", "command.finished", { commandId: "cmd-2", normalizedCommand: "npm test", exitCode: 0 })
    ];
    const items = deriveAttentionItems(deriveSessions(events), events, []);

    expect(items.some((item) => item.type === "repeated_failure")).toBe(false);
  });

  test("conflicts create P1 attention with affected paths", () => {
    const events = [event("start", "session.started")];
    const conflict: ConflictCard = {
      conflictId: "conflict-1",
      type: "exact_file_overlap",
      severity: "high",
      sessionIds: ["session-1", "session-2"],
      repo: { gitCommonDir: "/repo/.git", worktreePaths: ["/repo/a", "/repo/b"] },
      sharedPaths: ["src/lib/auth/session.ts"],
      attribution: "direct",
      title: "Same tracked path changed by 2 active sessions",
      evidence: [{ id: "snapshot-1", kind: "git_snapshot", observedAt: "2026-06-23T02:01:00.000Z", source: "git.observer" }]
    };

    const items = deriveAttentionItems(deriveSessions(events), events, [conflict]);

    expect(items[0]).toMatchObject({
      type: "conflict",
      severity: "P1",
      affectedPaths: ["src/lib/auth/session.ts"]
    });
  });

  test("successful verification followed by a later file change creates stale-verification attention", () => {
    const events = [
      event("start", "session.started"),
      event("test-pass", "command.finished", {
        commandId: "cmd-test",
        normalizedCommand: "npm test",
        category: "test",
        exitCode: 0
      }),
      event("file-change", "file.changed", { path: "src/app.ts" })
    ];
    const items = deriveAttentionItems(deriveSessions(events), events, []);

    expect(items.find((item) => item.type === "stale_verification")).toMatchObject({
      severity: "P2",
      title: "Verification is stale",
      affectedPaths: ["src/app.ts"],
      affectedCommandIds: ["cmd-test"],
      evidence: [{ id: "test-pass" }, { id: "file-change" }]
    });
  });

  test("does not infer stale verification from one dirty snapshot observed after a pass", () => {
    const events = [
      event("start", "session.started"),
      event("test-pass", "command.finished", {
        commandId: "cmd-test",
        normalizedCommand: "npm test",
        category: "test",
        exitCode: 0
      })
    ];
    const snapshots: GitSnapshot[] = [
      {
        snapshotId: "snapshot-after-test",
        sessionId: "session-1",
        repoRoot: "/workspace/app",
        worktreePath: "/workspace/app",
        gitCommonDir: "/workspace/app/.git",
        branch: "agent/test",
        headSha: "abc123",
        changedPaths: [
          {
            path: "src/app.ts",
            status: "modified",
            staged: false,
            additions: 4,
            deletions: 1,
            sensitivity: "metadata"
          }
        ],
        observedAt: "2026-06-23T02:10:00.000Z"
      }
    ];
    const items = deriveAttentionItems(deriveSessions(events, snapshots), events, [], snapshots);

    expect(items.some((item) => item.type === "stale_verification")).toBe(false);
  });

  test("snapshot-based stale verification requires a before and after snapshot delta", () => {
    const events = [
      event("start", "session.started"),
      event("test-pass", "command.finished", {
        commandId: "cmd-test",
        normalizedCommand: "npm test",
        category: "test",
        exitCode: 0
      })
    ];
    const snapshots: GitSnapshot[] = [
      {
        snapshotId: "snapshot-before-test",
        sessionId: "session-1",
        repoRoot: "/workspace/app",
        worktreePath: "/workspace/app",
        gitCommonDir: "/workspace/app/.git",
        branch: "agent/test",
        headSha: "abc123",
        changedPaths: [],
        observedAt: "2026-06-23T01:59:59.000Z"
      },
      {
        snapshotId: "snapshot-after-test",
        sessionId: "session-1",
        repoRoot: "/workspace/app",
        worktreePath: "/workspace/app",
        gitCommonDir: "/workspace/app/.git",
        branch: "agent/test",
        headSha: "abc123",
        changedPaths: [
          {
            path: "src/app.ts",
            status: "modified",
            staged: false,
            additions: 4,
            deletions: 1,
            sensitivity: "metadata"
          }
        ],
        observedAt: "2026-06-23T02:10:00.000Z"
      }
    ];
    const items = deriveAttentionItems(deriveSessions(events, snapshots), events, [], snapshots);

    expect(items.find((item) => item.type === "stale_verification")).toMatchObject({
      severity: "P2",
      title: "Verification is stale",
      affectedPaths: ["src/app.ts"],
      affectedCommandIds: ["cmd-test"],
      evidence: [{ id: "test-pass" }, { id: "snapshot-after-test" }]
    });
  });

  test("high-risk changed paths create deterministic P2 attention with Git evidence", () => {
    const events = [event("start", "session.started")];
    const snapshots: GitSnapshot[] = [
      {
        snapshotId: "snapshot-risk",
        sessionId: "session-1",
        repoRoot: "/workspace/app",
        worktreePath: "/workspace/app",
        gitCommonDir: "/workspace/app/.git",
        branch: "agent/test",
        headSha: "abc123",
        changedPaths: [
          {
            path: "supabase/migrations/20260623060000_add_accounts.sql",
            status: "added",
            staged: false,
            additions: 20,
            deletions: 0,
            sensitivity: "metadata"
          },
          {
            path: ".env",
            status: "modified",
            staged: false,
            additions: 1,
            deletions: 1,
            sensitivity: "sensitive_path_only"
          }
        ],
        observedAt: "2026-06-23T02:10:00.000Z"
      }
    ];
    const items = deriveAttentionItems(deriveSessions(events, snapshots), events, [], snapshots);

    expect(items.find((item) => item.type === "high_risk_change")).toMatchObject({
      severity: "P2",
      title: "High-risk change",
      affectedPaths: ["supabase/migrations/20260623060000_add_accounts.sql"],
      evidence: [{ id: "snapshot-risk", kind: "git_snapshot" }]
    });
  });
});
