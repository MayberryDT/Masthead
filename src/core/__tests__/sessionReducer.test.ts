import { describe, expect, test } from "vitest";
import type { GitSnapshot, NormalizedEvent } from "../types";
import { deriveSessions } from "../sessionReducer";

const baseEvent = (
  eventId: string,
  type: NormalizedEvent["type"],
  payload: Record<string, unknown> = {},
  occurredAt = "2026-06-23T02:00:00.000Z"
): NormalizedEvent => ({
  schemaVersion: 1,
  eventId,
  sessionId: "session-1",
  source: { adapter: "codex", surface: "fixture", sourceEventId: eventId },
  occurredAt,
  receivedAt: occurredAt,
  type,
  workspace: {
    repoRoot: "/workspace/app",
    worktreePath: "/workspace/app",
    gitCommonDir: "/workspace/app/.git",
    branch: "agent/test"
  },
  summary: type,
  payload: {
    project: "App",
    title: "Test session",
    attribution: "direct",
    ...payload
  },
  sensitivity: "metadata",
  payloadHash: `hash-${eventId}`,
  evidence: [{ id: eventId, kind: "event", observedAt: occurredAt, source: "codex.fixture" }]
});

const snapshot = (changedPaths: GitSnapshot["changedPaths"]): GitSnapshot => ({
  snapshotId: "snapshot-1",
  sessionId: "session-1",
  repoRoot: "/workspace/app",
  worktreePath: "/workspace/app",
  gitCommonDir: "/workspace/app/.git",
  branch: "agent/test",
  headSha: "abc123",
  changedPaths,
  observedAt: "2026-06-23T02:03:00.000Z"
});

describe("session reducer", () => {
  test("derives recent non-terminal sessions as running", () => {
    const sessions = deriveSessions(
      [
        baseEvent("start", "session.started", {}, "2026-06-23T02:00:00.000Z"),
        baseEvent("command-finished", "command.finished", { commandId: "cmd-1" }, "2026-06-23T02:05:00.000Z")
      ],
      [],
      { now: new Date("2026-06-23T02:05:30.000Z"), idleAfterMs: 5 * 60_000 }
    );

    expect(sessions[0]).toMatchObject({
      lifecycle: "running",
      lastEventType: "command.finished"
    });
  });

  test("derives old non-terminal sessions as idle rather than ended", () => {
    const sessions = deriveSessions(
      [baseEvent("start", "session.started", {}, "2026-06-23T02:00:00.000Z")],
      [],
      { now: new Date("2026-06-23T02:20:00.000Z"), idleAfterMs: 5 * 60_000 }
    );

    expect(sessions[0]).toMatchObject({
      lifecycle: "idle",
      primaryStatus: "stalled"
    });
    expect(sessions[0]?.endedAt).toBeUndefined();
  });

  test("derives terminal completion as ended with completed reason", () => {
    const sessions = deriveSessions(
      [
        baseEvent("start", "session.started", {}, "2026-06-23T02:00:00.000Z"),
        baseEvent("done", "session.completed", {}, "2026-06-23T02:10:00.000Z")
      ],
      [],
      { now: new Date("2026-06-23T02:11:00.000Z"), idleAfterMs: 5 * 60_000 }
    );

    expect(sessions[0]).toMatchObject({
      lifecycle: "ended",
      endReason: "completed",
      endedAt: "2026-06-23T02:10:00.000Z"
    });
  });

  test("approval requests outrank active command state", () => {
    const sessions = deriveSessions([
      baseEvent("start", "session.started"),
      baseEvent("command-start", "command.started", { category: "test" }, "2026-06-23T02:01:00.000Z"),
      baseEvent("approval", "approval.requested", { commandId: "cmd-1" }, "2026-06-23T02:02:00.000Z")
    ]);

    expect(sessions[0]?.primaryStatus).toBe("waiting_for_approval");
    expect(sessions[0]?.flags).toContain("approval_pending");
  });

  test("approval requests clear after later command activity", () => {
    const sessions = deriveSessions([
      baseEvent("start", "session.started"),
      baseEvent("approval", "approval.requested", { commandId: "cmd-1" }, "2026-06-23T02:02:00.000Z"),
      baseEvent("command-finished", "command.finished", { commandId: "cmd-1" }, "2026-06-23T02:03:00.000Z")
    ]);

    expect(sessions[0]?.primaryStatus).toBe("reading");
    expect(sessions[0]?.flags).not.toContain("approval_pending");
  });

  test("command hooks without exit status do not count as failed commands", () => {
    const sessions = deriveSessions([
      baseEvent("start", "session.started"),
      baseEvent("command-finished", "command.finished", { commandId: "cmd-1" }, "2026-06-23T02:03:00.000Z")
    ]);

    expect(sessions[0]?.primaryStatus).toBe("reading");
    expect(sessions[0]?.flags).not.toContain("tests_failed");
  });

  test("completion is terminal only until later session activity resumes", () => {
    const sessions = deriveSessions([
      baseEvent("start", "session.started"),
      baseEvent("done", "session.completed", {}, "2026-06-23T02:02:00.000Z"),
      baseEvent("later-command", "command.finished", { commandId: "cmd-2" }, "2026-06-23T02:04:00.000Z")
    ]);

    expect(sessions[0]?.primaryStatus).toBe("reading");
    expect(sessions[0]?.flags).not.toContain("agent_claims_complete");
  });

  test("three equivalent failures mark a session as possibly looping", () => {
    const sessions = deriveSessions([
      baseEvent("start", "session.started"),
      baseEvent("fail-1", "command.finished", { commandId: "cmd-1", normalizedCommand: "npm test", exitCode: 1 }),
      baseEvent("fail-2", "command.finished", { commandId: "cmd-2", normalizedCommand: "npm test", exitCode: 1 }),
      baseEvent("fail-3", "command.finished", { commandId: "cmd-3", normalizedCommand: "npm test", exitCode: 1 }, "2026-06-23T02:03:00.000Z")
    ]);

    expect(sessions[0]?.primaryStatus).toBe("possibly_looping");
    expect(sessions[0]?.flags).toContain("tests_failed");
  });

  test("completion with changed files and no verification remains review needed", () => {
    const sessions = deriveSessions(
      [baseEvent("start", "session.started"), baseEvent("done", "session.completed")],
      [
        snapshot([
          {
            path: "src/app.ts",
            status: "modified",
            staged: false,
            additions: 12,
            deletions: 2,
            sensitivity: "metadata"
          }
        ])
      ]
    );

    expect(sessions[0]?.primaryStatus).toBe("completed_unreviewed");
    expect(sessions[0]?.flags).toContain("agent_claims_complete");
    expect(sessions[0]?.flags).toContain("no_tests_observed");
    expect(sessions[0]?.flags).toContain("dirty_worktree");
  });

  test("high-risk changed paths are flagged without reading file contents", () => {
    const sessions = deriveSessions(
      [baseEvent("start", "session.started")],
      [
        snapshot([
          {
            path: "supabase/migrations/20260623050000_add_billing.sql",
            status: "added",
            staged: false,
            additions: 8,
            deletions: 0,
            sensitivity: "metadata"
          }
        ])
      ]
    );

    expect(sessions[0]?.flags).toContain("high_risk_change");
  });

  test("shared workspace attribution is explicit", () => {
    const sessions = deriveSessions([
      baseEvent("start", "session.started", { attribution: "shared_workspace" })
    ]);

    expect(sessions[0]?.attribution).toBe("shared_workspace");
  });

  test("real hook sessions fall back to the cwd basename for project and title", () => {
    const event = baseEvent("real-start", "session.started", {});
    event.workspace = { cwd: "/home/tyler/Documents/Masthead" };
    event.payload = { source: "startup" };

    const sessions = deriveSessions([event]);

    expect(sessions[0]).toMatchObject({
      project: "Masthead",
      title: "Masthead session"
    });
  });

  test("uses runtime-scoped metadata without Codex fallback title", () => {
    const sessions = deriveSessions([
      {
        schemaVersion: 1,
        eventId: "claude:start",
        sessionId: "claude_code:raw-1",
        source: { adapter: "claude_code", surface: "hook", sourceEventId: "raw-1:start" },
        occurredAt: "2026-07-05T12:00:00.000Z",
        receivedAt: "2026-07-05T12:00:00.000Z",
        type: "session.started",
        summary: "Started",
        payload: { runtime: "claude_code", sourceSessionId: "raw-1", project: "Masthead" },
        sensitivity: "metadata",
        payloadHash: "hash",
        evidence: [{ id: "claude:start", kind: "event", observedAt: "2026-07-05T12:00:00.000Z", source: "claude_code.hook" }]
      }
    ]);

    expect(sessions[0]).toMatchObject({
      harness: "Claude Code",
      runtime: "claude_code",
      sourceSessionId: "raw-1",
      title: "Masthead session"
    });
  });
});
