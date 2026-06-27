import { describe, expect, test } from "vitest";
import { detectConflicts, detectSharedResourceConflicts } from "../conflicts";
import type { GitSnapshot, NormalizedEvent } from "../types";

const snapshot = (
  sessionId: string,
  gitCommonDir: string,
  worktreePath: string,
  path: string,
  options: Partial<GitSnapshot> = {}
): GitSnapshot => ({
  snapshotId: `${sessionId}-${path}`,
  sessionId,
  repoRoot: "/workspace/repo",
  worktreePath,
  gitCommonDir,
  branch: `agent/${sessionId}`,
  headSha: "abc123",
  changedPaths: [
    {
      path,
      status: "modified",
      staged: false,
      additions: 2,
      deletions: 1,
      sensitivity: "metadata"
    }
  ],
  observedAt: "2026-06-23T02:00:00.000Z",
  ...options
});

describe("conflict engine", () => {
  test("detects exact same-file overlap in the same Git worktree family", () => {
    const conflicts = detectConflicts([
      snapshot("auth", "/repo/.git", "/repo-auth", "src/lib/auth/session.ts"),
      snapshot("middleware", "/repo/.git", "/repo-middleware", "src/lib/auth/session.ts")
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      type: "exact_file_overlap",
      severity: "high",
      sessionIds: ["auth", "middleware"],
      sharedPaths: ["src/lib/auth/session.ts"],
      attribution: "direct"
    });
  });

  test("does not hard-conflict unrelated repositories with the same path", () => {
    const conflicts = detectConflicts([
      snapshot("auth", "/repo-a/.git", "/repo-a", "src/lib/auth/session.ts"),
      snapshot("middleware", "/repo-b/.git", "/repo-b", "src/lib/auth/session.ts")
    ]);

    expect(conflicts).toHaveLength(0);
  });

  test("does not hard-conflict same repo disjoint paths", () => {
    const conflicts = detectConflicts([
      snapshot("auth", "/repo/.git", "/repo-auth", "src/lib/auth/session.ts"),
      snapshot("middleware", "/repo/.git", "/repo-middleware", "src/middleware.ts")
    ]);

    expect(conflicts).toHaveLength(0);
  });

  test("uses only the latest snapshot per session when detecting exact file overlap", () => {
    const conflicts = detectConflicts([
      snapshot("auth", "/repo/.git", "/repo-auth", "src/shared.ts", {
        snapshotId: "auth-old",
        observedAt: "2026-06-23T02:00:00.000Z"
      }),
      snapshot("auth", "/repo/.git", "/repo-auth", "src/other.ts", {
        snapshotId: "auth-latest",
        observedAt: "2026-06-23T02:05:00.000Z"
      }),
      snapshot("middleware", "/repo/.git", "/repo-middleware", "src/shared.ts", {
        snapshotId: "middleware-latest",
        observedAt: "2026-06-23T02:06:00.000Z"
      })
    ]);

    expect(conflicts).toEqual([]);
  });

  test("detects exact file overlap from latest snapshots", () => {
    const conflicts = detectConflicts([
      snapshot("auth", "/repo/.git", "/repo-auth", "src/old.ts", {
        snapshotId: "auth-old",
        observedAt: "2026-06-23T02:00:00.000Z"
      }),
      snapshot("auth", "/repo/.git", "/repo-auth", "src/shared.ts", {
        snapshotId: "auth-latest",
        observedAt: "2026-06-23T02:05:00.000Z"
      }),
      snapshot("middleware", "/repo/.git", "/repo-middleware", "src/shared.ts", {
        snapshotId: "middleware-latest",
        observedAt: "2026-06-23T02:06:00.000Z"
      })
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.sharedPaths).toEqual(["src/shared.ts"]);
  });

  test("does not hard-conflict same working-directory attribution", () => {
    const conflicts = detectConflicts([
      snapshot("auth", "/repo/.git", "/repo", "src/lib/auth/session.ts"),
      snapshot("middleware", "/repo/.git", "/repo", "src/lib/auth/session.ts")
    ]);

    expect(conflicts).toEqual([]);
  });

  test("detects shared local resource collisions from explicit session evidence", () => {
    const conflicts = detectSharedResourceConflicts([
      event("session-a", "a-resource", { sharedResources: ["port:5173"] }),
      event("session-b", "b-resource", { port: 5173 }),
      event("session-c", "c-resource", { sharedResources: ["port:17373"] })
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      type: "shared_resource",
      severity: "medium",
      sessionIds: ["session-a", "session-b"],
      sharedPaths: ["port:5173"],
      title: "Shared local resource used by 2 active sessions"
    });
    expect(conflicts[0]?.evidence.map((ref) => ref.id)).toEqual(["a-resource", "b-resource"]);
  });

  test("marks shared migration command resources as high severity", () => {
    const conflicts = detectSharedResourceConflicts([
      event("session-a", "a-migrate", { normalizedCommand: "supabase db push" }, "command.started"),
      event("session-b", "b-migrate", { normalizedCommand: "prisma migrate deploy" }, "command.started")
    ]);

    expect(conflicts[0]).toMatchObject({
      type: "shared_resource",
      severity: "high",
      sharedPaths: ["migration:/workspace/repo/.git"]
    });
  });

  test("marks shared local database collisions as high severity", () => {
    const conflicts = detectSharedResourceConflicts([
      event("session-a", "a-db", { localDatabase: "masthead-dev" }),
      event("session-b", "b-db", { localDatabase: "masthead-dev" })
    ]);

    expect(conflicts[0]).toMatchObject({
      type: "shared_resource",
      severity: "high",
      sharedPaths: ["local-db:masthead-dev"]
    });
  });

  test("does not collide duplicate resource events from one session", () => {
    const conflicts = detectSharedResourceConflicts([
      event("session-a", "a-port-1", { sharedResources: ["port:5173"] }),
      event("session-a", "a-port-2", { sharedResources: ["port:5173"] })
    ]);

    expect(conflicts).toEqual([]);
  });

  test("does not collide migration commands in different Git worktree families", () => {
    const conflicts = detectSharedResourceConflicts([
      event("session-a", "a-migrate", { normalizedCommand: "supabase db push" }, "command.started", "/workspace/app-a/.git"),
      event("session-b", "b-migrate", { normalizedCommand: "supabase db push" }, "command.started", "/workspace/app-b/.git")
    ]);

    expect(conflicts).toEqual([]);
  });
});

function event(
  sessionId: string,
  eventId: string,
  payload: Record<string, unknown>,
  type: NormalizedEvent["type"] = "session.started",
  gitCommonDir = "/workspace/repo/.git"
): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId,
    sessionId,
    source: { adapter: "codex", surface: "fixture", sourceEventId: eventId },
    occurredAt: "2026-06-23T02:00:00.000Z",
    receivedAt: "2026-06-23T02:00:00.000Z",
    type,
    workspace: {
      repoRoot: "/workspace/repo",
      worktreePath: `/workspace/${sessionId}`,
      gitCommonDir,
      branch: `agent/${sessionId}`
    },
    summary: type,
    payload: {
      project: "App",
      title: sessionId,
      ...payload
    },
    sensitivity: "metadata",
    payloadHash: `hash-${eventId}`,
    evidence: [{ id: eventId, kind: "event", observedAt: "2026-06-23T02:00:00.000Z", source: "codex.fixture" }]
  };
}
