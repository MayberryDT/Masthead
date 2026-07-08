import { describe, expect, test } from "vitest";
import { deriveWorkContext } from "../workContext";
import type { GitSnapshot, NormalizedEvent } from "../types";

describe("work context", () => {
  test("derives a work-area label from title and path clusters", () => {
    const context = deriveWorkContext({
      title: "Fix Google OAuth callback",
      branchOrWorktree: "agent/auth-fix",
      events: [],
      gitSnapshots: [snapshot("src/lib/auth/session.ts"), snapshot("src/app/api/auth/callback.ts")]
    });

    expect(context).toMatchObject({
      label: "OAuth callback work",
      confidence: "title",
      pathClusters: ["auth"]
    });
  });

  test("falls back to path cluster when title is generic", () => {
    const context = deriveWorkContext({
      title: "Codex session",
      branchOrWorktree: "agent/session-123",
      events: [],
      gitSnapshots: [snapshot("src/ui/settings/ProfilePanel.tsx"), snapshot("src/ui/settings/AccountPanel.tsx")]
    });

    expect(context.label).toBe("Settings UI work");
    expect(context.confidence).toBe("path_cluster");
  });

  test("does not label multi-area path clusters as Settings UI work", () => {
    const context = deriveWorkContext({
      title: "Codex session",
      branchOrWorktree: "agent/session-123",
      events: [],
      gitSnapshots: [
        snapshot("src/ui/settings/ProfilePanel.tsx"),
        snapshot("docs/acceptance/product-release-gate.md"),
        snapshot("src/core/__tests__/workContext.test.ts"),
        snapshot("src/ui/SessionCard.tsx")
      ]
    });

    expect(context.label).not.toBe("Settings UI work");
    expect(context.pathClusters).toEqual(expect.arrayContaining(["docs", "settings", "tests", "ui"]));
  });

  test("prefers recent event context over stale path clusters", () => {
    const context = deriveWorkContext({
      title: "Codex session",
      branchOrWorktree: "agent/session-123",
      events: [
        event("The Board headline validator now compacts subject and disposition slots."),
        event("Three-line clamp applied to session card headlines.")
      ],
      gitSnapshots: [snapshot("src/ui/settings/ProfilePanel.tsx"), snapshot("src/ui/settings/AccountPanel.tsx")]
    });

    expect(context.label).toBe("Board headline work");
    expect(context.confidence).toBe("event_summary");
    expect(context.sourceSignals).toContain("event:headline");
  });

  test("uses recent transcript context before stale path clusters", () => {
    const context = deriveWorkContext({
      title: "Codex session",
      branchOrWorktree: "agent/session-123",
      events: [],
      gitSnapshots: [snapshot("src/ui/settings/ProfilePanel.tsx"), snapshot("src/ui/settings/AccountPanel.tsx")],
      recentTranscriptMessages: [
        "The Board headline validator now compacts subject and disposition slots.",
        "Three-line clamp applied to session card headlines."
      ]
    });

    expect(context.label).toBe("Board headline work");
    expect(context.confidence).toBe("event_summary");
    expect(context.sourceSignals).toContain("event:headline");
  });

  test("does not leak long paths or secrets into source signals", () => {
    const context = deriveWorkContext({
      title: "Codex session",
      branchOrWorktree: "agent/secret-sk-test",
      events: [event("Ran npm test with OPENAI_API_KEY=sk-test")],
      gitSnapshots: [snapshot("/workspace/app/src/secret.ts")]
    });

    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("/workspace");
    expect(serialized).not.toContain("OPENAI_API_KEY");
    expect(serialized).not.toContain("sk-test");
  });

  test("does not turn private title or branch text into board labels", () => {
    const context = deriveWorkContext({
      title: "Fix Acme payroll callback for https://customer.example/private",
      branchOrWorktree: "agent/acme-payroll-sk-test",
      events: [],
      gitSnapshots: []
    });

    expect(context.label).toBe("Session work");
    expect(context.confidence).toBe("generic");
    expect(JSON.stringify(context)).not.toContain("Acme");
    expect(JSON.stringify(context)).not.toContain("customer.example");
    expect(JSON.stringify(context)).not.toContain("sk-test");
  });
});

function event(summary: string): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId: "event-1",
    sessionId: "session-1",
    source: { adapter: "codex", surface: "fixture", sourceEventId: "event-1" },
    occurredAt: "2026-06-23T02:00:00.000Z",
    receivedAt: "2026-06-23T02:00:00.000Z",
    type: "command.finished",
    summary,
    payload: {},
    sensitivity: "metadata",
    payloadHash: "hash",
    evidence: []
  };
}

function snapshot(path: string): GitSnapshot {
  return {
    snapshotId: `snapshot-${path}`,
    sessionId: "session-1",
    repoRoot: "/workspace/app",
    worktreePath: "/workspace/app",
    gitCommonDir: "/workspace/app/.git",
    branch: "agent/test",
    changedPaths: [{ path, status: "modified", staged: false, sensitivity: "metadata" }],
    observedAt: "2026-06-23T02:00:00.000Z"
  };
}
