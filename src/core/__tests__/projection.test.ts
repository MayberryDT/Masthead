import { describe, expect, test } from "vitest";
import fixture from "../../../fixtures/v0/replay-three-sessions-board.json";
import { normalizeLiveStateReport, type LiveRuntimeSemanticState } from "../liveState";
import { projectFixture } from "../replay";
import type { FixtureReplay, GitSnapshot, NormalizedEvent } from "../types";

const event = (
  eventId: string,
  sessionId: string,
  type: NormalizedEvent["type"],
  occurredAt: string,
  payload: Record<string, unknown> = {}
): NormalizedEvent => ({
  schemaVersion: 1,
  eventId,
  sessionId,
  source: { adapter: "claude_code", surface: "fixture", sourceEventId: eventId },
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
    title: "Projection case",
    attribution: "direct",
    ...payload
  },
  sensitivity: "metadata",
  payloadHash: `hash-${eventId}`,
  evidence: [{ id: eventId, kind: "event", observedAt: occurredAt, source: "claude_code.fixture" }]
});

const snapshot = (snapshotId: string, sessionId: string, path: string): GitSnapshot => ({
  snapshotId,
  sessionId,
  repoRoot: "/workspace/app",
  worktreePath: `/workspace/app-${sessionId}`,
  gitCommonDir: "/workspace/app/.git",
  branch: `agent/${sessionId}`,
  headSha: "abc123",
  changedPaths: [
    {
      path,
      status: "modified",
      staged: false,
      additions: 1,
      deletions: 0,
      sensitivity: "metadata"
    }
  ],
  observedAt: "2026-06-23T02:04:00.000Z"
});

const liveReports = (
  sessionIds: string[],
  observedAt = "2026-06-23T02:04:30.000Z",
  state: LiveRuntimeSemanticState = "working"
) =>
  new Map(
    sessionIds.map((sessionId) => [
      sessionId,
      normalizeLiveStateReport({
        runtime: "claude_code",
        source: "test",
        sourceSessionId: sessionId,
        state,
        observedAt
      })
    ])
  );

describe("Live Board projection", () => {
  test("projects model and token metadata from live events", () => {
    const board = projectFixture(
      {
        events: [
          event("metadata-start", "metadata-session", "session.started", "2026-06-23T02:00:00.000Z", {
            model: "gpt-5-codex",
            title: "Metadata work",
            totalTokens: 1840
          })
        ],
        gitSnapshots: []
      },
      { now: new Date("2026-06-23T02:01:00.000Z") }
    );

    expect(board.cards[0]).toMatchObject({
      model: "gpt-5-codex",
      totalTokens: 1840
    });
  });

  test("labels last activity against projection time instead of the newest event", () => {
    const board = projectFixture(
      {
        events: [
          event("stale-start", "stale-session", "session.started", "2026-07-05T12:00:00.000Z", {
            title: "Stale but visible work"
          })
        ],
        gitSnapshots: []
      },
      { now: new Date("2026-07-08T12:00:00.000Z") }
    );

    expect(board.cards[0]?.lastActivityLabel).toBe("3d ago");
  });

  test("projects numeric payload metadata by event timestamp instead of arrival order", () => {
    const board = projectFixture(
      {
        events: [
          event("timestamp-start", "timestamp-session", "session.started", "2026-06-23T02:00:00.000Z", {
            title: "Timestamp metadata"
          }),
          event("timestamp-current-usage", "timestamp-session", "command.finished", "2026-06-23T02:10:00.000Z", {
            totalTokens: 2400
          }),
          event("timestamp-stale-usage", "timestamp-session", "command.finished", "2026-06-23T02:05:00.000Z", {
            totalTokens: 12
          })
        ],
        gitSnapshots: []
      },
      { now: new Date("2026-06-23T02:11:00.000Z") }
    );

    expect(board.cards.find((card) => card.sessionId === "timestamp-session")?.totalTokens).toBe(2400);
  });

  test("counts only running lane sessions as active in lifecycle summary", () => {
    const board = projectFixture(
      {
        events: [
          event("running-start", "running-session", "session.started", "2026-06-23T02:00:00.000Z", {
            title: "Running work"
          }),
          event("running-command", "running-session", "command.finished", "2026-06-23T02:09:30.000Z", {
            commandId: "cmd-read"
          }),
          event("idle-start", "idle-session", "session.started", "2026-06-23T01:30:00.000Z", {
            title: "Idle work"
          }),
          event("review-start", "review-session", "session.started", "2026-06-23T02:00:00.000Z", {
            title: "Needs review work"
          }),
          event("review-done", "review-session", "session.completed", "2026-06-23T02:08:00.000Z"),
          event("history-start", "history-session", "session.started", "2026-06-23T02:00:00.000Z", {
            title: "Verified work"
          }),
          event("history-test", "history-session", "command.finished", "2026-06-23T02:06:00.000Z", {
            commandId: "cmd-test",
            category: "test",
            normalizedCommand: "npm test",
            exitCode: 0
          }),
          event("history-done", "history-session", "session.completed", "2026-06-23T02:07:00.000Z")
        ],
        gitSnapshots: [
          {
            snapshotId: "review-snapshot",
            sessionId: "review-session",
            repoRoot: "/workspace/app",
            worktreePath: "/workspace/app",
            gitCommonDir: "/workspace/app/.git",
            branch: "agent/test",
            headSha: "abc123",
            changedPaths: [
              {
                path: "src/review.ts",
                status: "modified",
                staged: false,
                additions: 4,
                deletions: 1,
                sensitivity: "metadata"
              }
            ],
            observedAt: "2026-06-23T02:08:30.000Z"
          }
        ]
      },
      {
        now: new Date("2026-06-23T02:10:00.000Z"),
        idleAfterMs: 5 * 60_000,
        liveStateReports: liveReports(["running-session"], "2026-06-23T02:09:55.000Z")
      }
    );

    expect(board.summary).toMatchObject({
      active: 1,
      running: 1,
      idle: 1,
      needsAction: 1,
      completed: 1
    });
    expect(board.lanes!.map((lane) => [lane.laneId, lane.sessionIds])).toEqual([
      ["running", ["running-session"]],
      ["idle", ["idle-session"]],
      ["needs_action", ["review-session"]],
      ["history", ["history-session"]]
    ]);
    expect(board.lanes!.map((lane) => lane.laneId)).not.toContain("ended_review");
    expect(board.cards.every((card) => card.headline.headline.length > 0 && card.headlineInput !== undefined)).toBe(true);
    expect(board.cards.find((card) => card.sessionId === "running-session")?.headline.source).toBe("pending");
    expect(board.cards.filter((card) => card.sessionId !== "running-session").every((card) => card.headline.source === "offline")).toBe(
      true
    );
  });

  test("keeps running sessions in Running even when they need attention", () => {
    const board = projectFixture({
      events: [
        event("start", "session-running", "session.started", "2026-06-23T02:00:00.000Z"),
        event("approval", "session-running", "approval.requested", "2026-06-23T02:01:00.000Z")
      ],
      gitSnapshots: []
    });

    expect(board.cards[0]).toMatchObject({ lifecycle: "running", primaryStatus: "blocked", stateLabel: "Blocked" });
    expect(board.lanes?.find((lane) => lane.laneId === "running")?.sessionIds).toEqual([]);
    expect(board.lanes?.find((lane) => lane.laneId === "needs_action")?.sessionIds).toEqual(["session-running"]);
  });

  test("uses a single Blocked label when permission requests remain unresolved", () => {
    const board = projectFixture({
      events: [
        event("start", "session-waiting", "session.started", "2026-06-23T02:00:00.000Z"),
        event("approval", "session-waiting", "approval.requested", "2026-06-23T02:01:00.000Z")
      ],
      gitSnapshots: []
    });

    expect(board.cards[0]).toMatchObject({
      lifecycle: "running",
      primaryStatus: "blocked",
      stateLabel: "Blocked"
    });
    expect(board.lanes?.find((lane) => lane.laneId === "running")?.sessionIds).toEqual([]);
    expect(board.summary).toMatchObject({ running: 0, needsAction: 1 });
  });

  test("keeps running sessions in Running even when a command failed", () => {
    const board = projectFixture(
      {
        events: [
          event("start", "session-running-failed-command", "session.started", "2026-06-23T02:00:00.000Z"),
          event("failed-command", "session-running-failed-command", "command.finished", "2026-06-23T02:01:00.000Z", {
            commandId: "cmd-test",
            category: "test",
            exitCode: 1,
            normalizedCommand: "npm test"
          })
        ],
        gitSnapshots: []
      },
      { liveStateReports: liveReports(["session-running-failed-command"], "2026-06-23T02:01:00.000Z") }
    );

    expect(board.attentionQueue.some((item) => item.type === "command_failed")).toBe(true);
    expect(board.lanes?.find((lane) => lane.laneId === "running")?.sessionIds).toEqual(["session-running-failed-command"]);
    expect(board.lanes?.find((lane) => lane.laneId === "needs_action")?.sessionIds).toEqual([]);
  });

  test("keeps active conflict sessions in Running instead of Needs action", () => {
    const board = projectFixture(
      {
        events: [
          event("a-start", "session-a", "session.started", "2026-06-23T02:00:00.000Z"),
          event("b-start", "session-b", "session.started", "2026-06-23T02:00:01.000Z")
        ],
        gitSnapshots: [snapshot("snapshot-a", "session-a", "src/shared.ts"), snapshot("snapshot-b", "session-b", "src/shared.ts")]
      },
      { liveStateReports: liveReports(["session-a", "session-b"]) }
    );

    expect(board.conflicts).toHaveLength(1);
    expect(board.lanes?.find((lane) => lane.laneId === "running")?.sessionIds.toSorted()).toEqual(["session-a", "session-b"]);
    expect(board.lanes?.find((lane) => lane.laneId === "needs_action")?.sessionIds).toEqual([]);
  });

  test("does not keep stale sessions active from fresh git snapshots alone", () => {
    const board = projectFixture(
      {
        events: [event("start", "stale-session", "session.started", "2026-06-23T02:00:00.000Z")],
        gitSnapshots: [
          {
            snapshotId: "fresh-snapshot",
            sessionId: "stale-session",
            repoRoot: "/workspace/app",
            worktreePath: "/workspace/app",
            gitCommonDir: "/workspace/app/.git",
            branch: "agent/stale-session",
            headSha: "abc123",
            changedPaths: [
              {
                path: "src/shared.ts",
                status: "modified",
                staged: false,
                additions: 1,
                deletions: 0,
                sensitivity: "metadata"
              }
            ],
            observedAt: "2026-06-23T02:20:00.000Z"
          }
        ]
      },
      { now: new Date("2026-06-23T02:21:00.000Z"), idleAfterMs: 15 * 60_000 }
    );

    expect(board.cards[0]).toMatchObject({
      changedFileCount: 1,
      lifecycle: "idle",
      primaryStatus: "stalled"
    });
    expect(board.lanes?.find((lane) => lane.laneId === "running")?.sessionIds).toEqual([]);
    expect(board.lanes?.find((lane) => lane.laneId === "idle")?.sessionIds).toEqual(["stale-session"]);
  });

  test("does not keep stale runtime-active sessions in Running", () => {
    const board = projectFixture(
      {
        events: [
          event("runtime-active", "runtime-active-session", "session.started", "2026-06-23T02:00:00.000Z", {
            status: "active",
            state: "running",
            title: "Runtime active work"
          })
        ],
        gitSnapshots: [
          {
            snapshotId: "fresh-runtime-snapshot",
            sessionId: "runtime-active-session",
            repoRoot: "/workspace/app",
            worktreePath: "/workspace/app",
            gitCommonDir: "/workspace/app/.git",
            branch: "agent/runtime-active-session",
            headSha: "abc123",
            changedPaths: [
              {
                path: "src/runtime.ts",
                status: "modified",
                staged: false,
                additions: 1,
                deletions: 0,
                sensitivity: "metadata"
              }
            ],
            observedAt: "2026-06-23T02:20:00.000Z"
          }
        ]
      },
      { now: new Date("2026-06-23T02:21:00.000Z"), idleAfterMs: 15 * 60_000 }
    );

    expect(board.cards[0]).toMatchObject({
      changedFileCount: 1,
      lifecycle: "idle",
      primaryStatus: "stalled",
      stateLabel: "Idle"
    });
    expect(board.lanes?.find((lane) => lane.laneId === "running")?.sessionIds).toEqual([]);
    expect(board.lanes?.find((lane) => lane.laneId === "idle")?.sessionIds).toEqual(["runtime-active-session"]);
    expect(board.summary).toMatchObject({ running: 0, idle: 1, needsAction: 0 });
  });

  test("ignores generic updating-around enrichment for live session headlines", () => {
    const board = projectFixture(
      {
        events: [
          event("start", "live-ui-session", "session.started", "2026-06-23T02:00:00.000Z", {
            project: "Masthead",
            title: "Masthead UI work"
          })
        ],
        gitSnapshots: [snapshot("snapshot-live-ui", "live-ui-session", "src/app/App.tsx")]
      },
      {
        now: new Date("2026-06-23T02:04:30.000Z"),
        liveStateReports: liveReports(["live-ui-session"], "2026-06-23T02:04:25.000Z"),
        sessionEnrichments: new Map([
          [
            "live-ui-session",
            {
              liveSummary: "Masthead work is being updated around mcp.",
              title: "Masthead mcp"
            }
          ]
        ])
      }
    );

    expect(board.cards[0]).toMatchObject({
      title: "Masthead UI work",
      headline: {
        source: "pending",
        status: "pending"
      },
      workContext: {
        label: "UI work"
      }
    });
  });

  test("ignores generic is-being-updated enrichment for card headlines", () => {
    const board = projectFixture(
      {
        events: [
          event("start", "updated-for-session", "session.started", "2026-06-23T02:00:00.000Z", {
            project: "Masthead",
            title: "Masthead UI work"
          })
        ],
        gitSnapshots: [snapshot("snapshot-updated-for", "updated-for-session", "src/app/App.tsx")]
      },
      {
        now: new Date("2026-06-23T02:04:30.000Z"),
        liveStateReports: liveReports(["updated-for-session"], "2026-06-23T02:04:25.000Z"),
        sessionEnrichments: new Map([
          [
            "updated-for-session",
            {
              liveSummary: "Live hook event is being updated for Masthead.",
              title: "Live hook event"
            }
          ]
        ])
      }
    );

    expect(board.cards[0]).toMatchObject({
      title: "Masthead UI work",
      headline: {
        source: "pending",
        status: "pending"
      }
    });
  });

  test("ignores hook-event active-in enrichment for card headlines and titles", () => {
    const board = projectFixture(
      {
        events: [
          event("start", "hook-active-session", "session.started", "2026-06-23T02:00:00.000Z", {
            project: "Masthead",
            title: "Masthead UI work"
          })
        ],
        gitSnapshots: [snapshot("snapshot-hook-active", "hook-active-session", "src/app/App.tsx")]
      },
      {
        now: new Date("2026-06-23T02:04:30.000Z"),
        liveStateReports: liveReports(["hook-active-session"], "2026-06-23T02:04:25.000Z"),
        sessionEnrichments: new Map([
          [
            "hook-active-session",
            {
              liveSummary: "Live hook event is active in sources.",
              title: "Live hook event"
            }
          ]
        ])
      }
    );

    expect(board.cards[0]).toMatchObject({
      title: "Masthead UI work",
      headline: {
        source: "pending",
        status: "pending"
      }
    });
    expect(board.cards[0]?.headline.headline).not.toMatch(/live hook event/i);
  });

  test("ignores generic is-being-fixed enrichment for card headlines", () => {
    const board = projectFixture(
      {
        events: [
          event("start", "fixed-for-session", "session.started", "2026-06-23T02:00:00.000Z", {
            project: "Masthead",
            title: "Masthead UI work"
          })
        ],
        gitSnapshots: [snapshot("snapshot-fixed-for", "fixed-for-session", "src/app/App.tsx")]
      },
      {
        now: new Date("2026-06-23T02:04:30.000Z"),
        liveStateReports: liveReports(["fixed-for-session"], "2026-06-23T02:04:25.000Z"),
        sessionEnrichments: new Map([
          [
            "fixed-for-session",
            {
              liveSummary: "Live hook event is being fixed for Masthead.",
              title: "Live hook event"
            }
          ]
        ])
      }
    );

    expect(board.cards[0]).toMatchObject({
      headline: {
        source: "pending",
        status: "pending"
      }
    });
  });

  test("ignores stale review-status enrichment when latest activity is concrete", () => {
    const board = projectFixture(
      {
        events: [
          event("start", "review-template-session", "session.started", "2026-06-23T02:00:00.000Z", {
            project: "Masthead",
            title: "Masthead UI work"
          }),
          {
            ...event("latest", "review-template-session", "file.changed", "2026-06-23T02:03:00.000Z"),
            summary: "Reworked the Board headline path to summarize the latest assistant output."
          }
        ],
        gitSnapshots: [snapshot("snapshot-review-template", "review-template-session", "src/core/boardHeadlineFrame.ts")]
      },
      {
        now: new Date("2026-06-23T02:04:30.000Z"),
        liveStateReports: liveReports(["review-template-session"], "2026-06-23T02:04:25.000Z"),
        sessionEnrichments: new Map([
          [
            "review-template-session",
            {
              liveSummary: "Masthead UI work is ready for review.",
              title: "Masthead UI work"
            }
          ]
        ])
      }
    );

    expect(board.cards[0]).toMatchObject({
      headline: {
        source: "pending",
        status: "pending"
      }
    });
    expect((board.cards[0]?.headlineInput as { evidence?: string[] } | undefined)?.evidence).toContain(
      "Reworked the Board headline path to summarize the latest assistant output."
    );
  });

  test("does not append recent activity text to sentence-like enrichment titles", () => {
    const board = projectFixture(
      {
        events: [
          event("start", "patched-title-session", "session.started", "2026-06-23T02:00:00.000Z", {
            project: "Masthead",
            title: "Masthead settings work"
          })
        ],
        gitSnapshots: [snapshot("snapshot-patched-title", "patched-title-session", "scripts/masthead-live-dev.js")]
      },
      {
        now: new Date("2026-06-23T02:04:30.000Z"),
        liveStateReports: liveReports(["patched-title-session"], "2026-06-23T02:04:25.000Z"),
        sessionEnrichments: new Map([
          [
            "patched-title-session",
            {
              liveSummary: "Launcher cleanup path is patched has recent Masthead activity.",
              title: "Launcher cleanup path is patched"
            }
          ]
        ])
      }
    );

    expect(board.cards[0]?.headline.source).toBe("pending");
    expect(board.cards[0]?.headline.headline).not.toContain("patched has recent");
  });

  test("ignores stale MCP enrichment when current activity is unrelated", () => {
    const board = projectFixture(
      {
        events: [
          event("start", "stale-topic-session", "session.started", "2026-06-23T02:00:00.000Z", {
            project: "Masthead",
            title: "Live Board headline work"
          }),
          {
            ...event("latest", "stale-topic-session", "file.changed", "2026-06-23T02:03:00.000Z"),
            summary: "Reworked the Board headline path to summarize the latest assistant output."
          }
        ],
        gitSnapshots: [snapshot("snapshot-stale-topic", "stale-topic-session", "src/core/boardHeadlineFrame.ts")]
      },
      {
        now: new Date("2026-06-23T02:04:30.000Z"),
        liveStateReports: liveReports(["stale-topic-session"], "2026-06-23T02:04:25.000Z"),
        sessionEnrichments: new Map([
          [
            "stale-topic-session",
            {
              liveSummary: "MCP launch config validation has passing tools-list coverage.",
              title: "MCP launch config validation",
              topics: ["mcp"]
            }
          ]
        ])
      }
    );

    expect(board.cards[0]?.title).toBe("Live Board headline work");
    expect(board.cards[0]?.headline).toMatchObject({
      source: "pending",
      status: "pending"
    });
    expect(JSON.stringify(board.cards[0])).not.toMatch(/\bmcp\b/i);
  });

  test("does not treat a title-only MCP label as current MCP evidence", () => {
    const board = projectFixture(
      {
        events: [
          event("start", "title-only-topic-session", "session.started", "2026-06-23T02:00:00.000Z", {
            project: "Masthead",
            title: "Masthead mcp"
          }),
          {
            ...event("latest", "title-only-topic-session", "file.changed", "2026-06-23T02:03:00.000Z"),
            summary: "Reworked the Board headline path to summarize the latest assistant output."
          }
        ],
        gitSnapshots: [snapshot("snapshot-title-only-topic", "title-only-topic-session", "src/core/boardHeadlineFrame.ts")]
      },
      {
        now: new Date("2026-06-23T02:04:30.000Z"),
        liveStateReports: liveReports(["title-only-topic-session"], "2026-06-23T02:04:25.000Z"),
        sessionEnrichments: new Map([
          [
            "title-only-topic-session",
            {
              liveSummary: "Masthead work is focused on mcp.",
              title: "Masthead mcp",
              topics: ["mcp"]
            }
          ]
        ])
      }
    );

    expect(board.cards[0]?.title).toBe("Masthead");
    expect(board.cards[0]?.headline).toMatchObject({
      source: "pending",
      status: "pending"
    });
    expect(JSON.stringify(board.cards[0])).not.toMatch(/\bmcp\b/i);
  });

  test("keeps high-quality enrichment from replacing pending LLM headlines", () => {
    const board = projectFixture(
      {
        events: [
          event("start", "running-enriched-session", "session.started", "2026-06-23T02:00:00.000Z", {
            project: "Masthead",
            title: "MCP launch config validation"
          }),
          {
            ...event("latest", "running-enriched-session", "file.changed", "2026-06-23T02:03:00.000Z"),
            summary: "MCP launch config validation has passing tools-list coverage."
          }
        ],
        gitSnapshots: [snapshot("snapshot-running-enriched", "running-enriched-session", "src/mcp/launchConfig.ts")]
      },
      {
        now: new Date("2026-06-23T02:04:30.000Z"),
        headlineMode: "llm",
        liveStateReports: liveReports(["running-enriched-session"], "2026-06-23T02:04:25.000Z"),
        sessionEnrichments: new Map([
          [
            "running-enriched-session",
            {
              liveSummary: "MCP launch config validation has passing tools-list coverage.",
              title: "MCP launch config validation"
            }
          ]
        ])
      }
    );

    expect(board.cards[0]).toMatchObject({
      headline: {
        headline: "Generating headline...",
        source: "pending",
        status: "pending"
      },
      lifecycle: "running",
      workContext: {
        label: "Session work"
      }
    });
  });

  test("does not mark same-worktree duplicate snapshots as conflict attention", () => {
    const board = projectFixture(
      {
        events: [
          event("a-start", "session-a", "session.started", "2026-06-23T02:00:00.000Z"),
          event("b-start", "session-b", "session.started", "2026-06-23T02:00:01.000Z")
        ],
        gitSnapshots: [
          {
            snapshotId: "snapshot-a",
            sessionId: "session-a",
            repoRoot: "/workspace/app",
            worktreePath: "/workspace/app",
            gitCommonDir: "/workspace/app/.git",
            branch: "agent/session-a",
            headSha: "abc123",
            changedPaths: [
              {
                path: "src/shared.ts",
                status: "modified",
                staged: false,
                additions: 1,
                deletions: 0,
                sensitivity: "metadata"
              }
            ],
            observedAt: "2026-06-23T02:04:00.000Z"
          },
          {
            snapshotId: "snapshot-b",
            sessionId: "session-b",
            repoRoot: "/workspace/app",
            worktreePath: "/workspace/app",
            gitCommonDir: "/workspace/app/.git",
            branch: "agent/session-b",
            headSha: "abc123",
            changedPaths: [
              {
                path: "src/shared.ts",
                status: "modified",
                staged: false,
                additions: 1,
                deletions: 0,
                sensitivity: "metadata"
              }
            ],
            observedAt: "2026-06-23T02:04:01.000Z"
          }
        ]
      },
      { liveStateReports: liveReports(["session-a", "session-b"], "2026-06-23T02:04:01.000Z") }
    );

    expect(board.conflicts).toEqual([]);
    expect(board.attentionQueue.some((item) => item.type === "conflict")).toBe(false);
    expect(board.cards).toHaveLength(2);
    expect(board.cards.every((card) => card.lifecycle === "running")).toBe(true);
    expect(board.cards.every((card) => !card.indicators.includes("conflict"))).toBe(true);
  });

  test("keeps different-worktree exact file overlap as conflict attention", () => {
    const board = projectFixture(
      {
        events: [
          event("a-start", "session-a", "session.started", "2026-06-23T02:00:00.000Z"),
          event("b-start", "session-b", "session.started", "2026-06-23T02:00:01.000Z")
        ],
        gitSnapshots: [snapshot("snapshot-a", "session-a", "src/shared.ts"), snapshot("snapshot-b", "session-b", "src/shared.ts")]
      },
      { liveStateReports: liveReports(["session-a", "session-b"]) }
    );

    expect(board.conflicts).toHaveLength(1);
    expect(board.attentionQueue.filter((item) => item.type === "conflict")).toHaveLength(2);
    expect(board.cards.every((card) => card.lifecycle === "running")).toBe(true);
    expect(board.cards.every((card) => card.indicators.includes("conflict"))).toBe(true);
  });

  test("routes ended failed sessions that need follow-up to Needs action", () => {
    const board = projectFixture({
      events: [
        event("start", "session-ended-failed", "session.started", "2026-06-23T02:00:00.000Z"),
        event("failed-command", "session-ended-failed", "command.finished", "2026-06-23T02:01:00.000Z", {
          commandId: "cmd-test",
          category: "test",
          exitCode: 1,
          normalizedCommand: "npm test"
        }),
        event("done", "session-ended-failed", "session.completed", "2026-06-23T02:02:00.000Z")
      ],
      gitSnapshots: []
    });

    expect(board.cards[0]).toMatchObject({ lifecycle: "ended" });
    expect(board.lanes?.find((lane) => lane.laneId === "needs_action")?.sessionIds).toEqual(["session-ended-failed"]);
    expect(board.lanes?.find((lane) => lane.laneId === "history")?.sessionIds).toEqual([]);
  });

  test("can override the expanded session without changing fixture data", () => {
    const board = projectFixture(fixture as FixtureReplay, { expandedSessionId: "codex-imports" });

    expect(board.expandedSession?.sessionId).toBe("codex-imports");
    expect(board.cards.find((card) => card.sessionId === "codex-imports")?.isExpanded).toBe(true);
    expect(board.cards.find((card) => card.sessionId === "codex-auth-fix")?.isExpanded).toBe(false);
  });

  test("derives card duration from each session event timestamp span", () => {
    const board = projectFixture({
      events: [
        event("short-start", "short-session", "session.started", "2026-06-23T02:00:00.000Z", {
          title: "Short span"
        }),
        event("short-done", "short-session", "session.completed", "2026-06-23T02:04:00.000Z"),
        event("long-start", "long-session", "session.started", "2026-06-23T02:10:00.000Z", {
          title: "Long span"
        }),
        event("long-done", "long-session", "session.completed", "2026-06-23T02:32:00.000Z")
      ],
      gitSnapshots: []
    });

    expect(board.cards.find((card) => card.sessionId === "short-session")?.durationLabel).toBe("4m");
    expect(board.cards.find((card) => card.sessionId === "long-session")?.durationLabel).toBe("22m");
  });

  test("formats hour-long card durations as hours and minutes", () => {
    const board = projectFixture({
      events: [
        event("hour-start", "hour-session", "session.started", "2026-06-23T02:00:00.000Z"),
        event("hour-done", "hour-session", "session.completed", "2026-06-23T03:10:00.000Z")
      ],
      gitSnapshots: []
    });

    expect(board.cards.find((card) => card.sessionId === "hour-session")?.durationLabel).toBe("1h 10m");
  });

  test("projects captured model information from live session events", () => {
    const board = projectFixture({
      events: [
        event("start", "model-session", "session.started", "2026-06-23T02:00:00.000Z"),
        event("model-command", "model-session", "command.finished", "2026-06-23T02:02:00.000Z", {
          model: "gpt-5.5"
        })
      ],
      gitSnapshots: []
    });

    expect(board.cards.find((card) => card.sessionId === "model-session")?.model).toBe("gpt-5.5");
  });

  test("projects captured reasoning effort as a normalized thinking level", () => {
    const board = projectFixture({
      events: [
        event("start", "thinking-session", "session.started", "2026-06-23T02:00:00.000Z", {
          modelReasoningEffort: "low"
        }),
        event("latest", "thinking-session", "command.finished", "2026-06-23T02:02:00.000Z", {
          reasoningEffort: "xhigh"
        })
      ],
      gitSnapshots: []
    });

    expect(board.cards.find((card) => card.sessionId === "thinking-session")?.thinkingLevel).toBe("Extra High");
  });

  test("projects session started time and harness for toolbar sorting and filtering", () => {
    const board = projectFixture({
      events: [
        event("a-start", "session-a", "session.started", "2026-06-23T02:00:00.000Z"),
        event("a-command", "session-a", "command.finished", "2026-06-23T02:03:00.000Z"),
        event("b-start", "session-b", "session.started", "2026-06-23T02:05:00.000Z")
      ],
      gitSnapshots: []
    });

    expect(board.cards.find((card) => card.sessionId === "session-a")).toMatchObject({
      startedAt: "2026-06-23T02:00:00.000Z",
      harness: "Claude Code"
    });
    expect(board.cards.find((card) => card.sessionId === "session-b")).toMatchObject({
      startedAt: "2026-06-23T02:05:00.000Z",
      harness: "Claude Code"
    });
  });

  test("uses Git snapshot workspace details when hook workspace only has cwd", () => {
    const start = event("start", "snapshot-session", "session.started", "2026-06-23T02:00:00.000Z");
    start.workspace = { cwd: "/workspace/app" };
    const board = projectFixture({
      events: [start],
      gitSnapshots: [
        {
          snapshotId: "snapshot-session-state",
          sessionId: "snapshot-session",
          repoRoot: "/workspace/app",
          worktreePath: "/workspace/app",
          gitCommonDir: "/workspace/app/.git",
          branch: "agent/snapshot-work",
          headSha: "abc123",
          changedPaths: [],
          observedAt: "2026-06-23T02:01:00.000Z"
        }
      ]
    });

    expect(board.cards.find((card) => card.sessionId === "snapshot-session")?.branchOrWorktree).toBe("agent/snapshot-work");
  });

  test("projects failed command attention items with command and evidence details", () => {
    const board = projectFixture({
      events: [
        event("start", "session-1", "session.started", "2026-06-23T02:00:00.000Z"),
        event("failed-command", "session-1", "command.finished", "2026-06-23T02:08:00.000Z", {
          commandId: "cmd-test-1",
          category: "test",
          exitCode: 2,
          normalizedCommand: "npm test"
        })
      ],
      gitSnapshots: []
    });
    const item = board.attentionQueue.find((candidate) => candidate.type === "command_failed");

    expect(item).toMatchObject({
      sessionId: "session-1",
      title: "Command failed",
      createdAt: "2026-06-23T02:08:00.000Z",
      affectedCommandIds: ["cmd-test-1"],
      evidence: [{ id: "failed-command" }]
    });
    expect((item as { commandDetails?: unknown[] } | undefined)?.commandDetails).toEqual([
      {
        commandId: "cmd-test-1",
        exitCode: 2,
        category: "test",
        occurredAt: "2026-06-23T02:08:00.000Z",
        evidenceId: "failed-command"
      }
    ]);
  });

  test("does not project missing exit status as command failure attention", () => {
    const board = projectFixture(
      {
        events: [
          event("start", "session-1", "session.started", "2026-06-23T02:00:00.000Z"),
          event("command-without-status", "session-1", "command.finished", "2026-06-23T02:08:00.000Z", {
            commandId: "cmd-test-1",
            category: "test"
          })
        ],
        gitSnapshots: []
      },
      { liveStateReports: liveReports(["session-1"], "2026-06-23T02:08:00.000Z") }
    );

    expect(board.cards[0]?.primaryStatus).toBe("reading");
    expect(board.attentionQueue.some((candidate) => candidate.type === "command_failed")).toBe(false);
    expect(board.attentionQueue.some((candidate) => candidate.type === "repeated_failure")).toBe(false);
  });

  test("can omit terminal completed sessions from the live card grid while preserving summary", () => {
    const board = projectFixture(
      {
        events: [
          event("old-start", "old-session", "session.started", "2026-06-23T02:00:00.000Z"),
          event("old-done", "old-session", "session.completed", "2026-06-23T02:01:00.000Z"),
          event("new-start", "new-session", "session.started", "2026-06-23T02:02:00.000Z")
        ],
        gitSnapshots: []
      },
      { includeTerminalSessions: false, liveStateReports: liveReports(["new-session"], "2026-06-23T02:02:00.000Z") }
    );

    expect(board.summary).toMatchObject({ active: 1, completed: 1 });
    expect(board.attentionQueue).toEqual([]);
    expect(board.cards.map((card) => card.sessionId)).toEqual(["new-session"]);
  });

  test("completed session snapshots do not create active exact-file conflicts", () => {
    const board = projectFixture(
      {
        events: [
          event("old-start", "old-session", "session.started", "2026-06-23T02:00:00.000Z"),
          event("old-done", "old-session", "session.completed", "2026-06-23T02:01:00.000Z"),
          event("new-start", "new-session", "session.started", "2026-06-23T02:02:00.000Z")
        ],
        gitSnapshots: [
          snapshot("old-snapshot", "old-session", "src/shared.ts"),
          snapshot("new-snapshot", "new-session", "src/shared.ts")
        ]
      },
      { liveStateReports: liveReports(["new-session"]) }
    );

    expect(board.conflicts).toEqual([]);
    expect(board.lanes?.find((lane) => lane.laneId === "running")?.sessionIds).toEqual(["new-session"]);
    expect(board.lanes?.find((lane) => lane.laneId === "needs_action")?.sessionIds).toEqual(["old-session"]);
  });

  test("projects high-risk changed paths as card risk indicators", () => {
    const board = projectFixture({
      events: [event("start", "session-1", "session.started", "2026-06-23T02:00:00.000Z")],
      gitSnapshots: [
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
              path: ".github/workflows/deploy.yml",
              status: "modified",
              staged: false,
              additions: 4,
              deletions: 1,
              sensitivity: "metadata"
            }
          ],
          observedAt: "2026-06-23T02:04:00.000Z"
        }
      ]
    });

    expect(board.cards[0]?.indicators).toContain("risk");
  });

  test("does not project shared-resource conflicts from completed historical sessions", () => {
    const board = projectFixture({
      events: [
        event("old-start", "old-session", "session.started", "2026-06-23T02:00:00.000Z", {
          sharedResources: ["port:5173"]
        }),
        event("old-done", "old-session", "session.completed", "2026-06-23T02:01:00.000Z"),
        event("new-start", "new-session", "session.started", "2026-06-23T02:02:00.000Z", {
          sharedResources: ["port:5173"]
        })
      ],
      gitSnapshots: []
    });

    expect(board.conflicts).toEqual([]);
    expect(board.attentionQueue.some((item) => item.type === "conflict")).toBe(false);
  });

  test("projects active shared-resource conflicts into the attention queue", () => {
    const board = projectFixture({
      events: [
        event("a-start", "session-a", "session.started", "2026-06-23T02:00:00.000Z", {
          sharedResources: ["port:5173"]
        }),
        event("b-start", "session-b", "session.started", "2026-06-23T02:01:00.000Z", {
          port: 5173
        })
      ],
      gitSnapshots: []
    });

    expect(board.conflicts[0]).toMatchObject({
      type: "shared_resource",
      sharedPaths: ["port:5173"]
    });
    expect(board.attentionQueue.filter((item) => item.type === "conflict")).toHaveLength(2);
  });

  test("projects work-area context and latest feedback into cards and details", () => {
    const board = projectFixture(
      {
        events: [
          event("start", "session-auth", "session.started", "2026-06-23T02:00:00.000Z", {
            title: "Fix Google OAuth callback"
          }),
          event("stop", "session-auth", "session.completed", "2026-06-23T02:05:00.000Z", {
            latestFeedbackSnapshot: {
              text: "Implementation is complete, but auth tests are still failing.",
              source: "stop_hook",
              observedAt: "2026-06-23T02:05:00.000Z",
              redacted: true,
              bytesIn: 80,
              charsOut: 61,
              claims: ["claims_complete", "mentions_tests", "mentions_error"]
            }
          })
        ],
        gitSnapshots: [snapshot("snapshot-auth", "session-auth", "src/lib/auth/session.ts")]
      },
      { selectedSessionId: "session-auth" }
    );

    expect(board.cards[0]?.workContext?.label).toBe("OAuth callback work");
    expect(board.cards[0]?.latestFeedbackSignal?.claims).toContain("claims_complete");
    expect(board.cards[0]?.headline).toMatchObject({ source: "offline", status: "ready" });
    expect((board.cards[0]?.headlineInput as { dispositionHints?: string[] } | undefined)?.dispositionHints).toContain(
      "Implementation is complete, but auth tests are still failing."
    );
    expect(board.selectedSession?.latestFeedback?.text).toContain("auth tests are still failing");
    expect(board.selectedSession?.inspectorSections).toEqual([
      "state",
      "latest_feedback",
      "attention_conflicts",
      "evidence",
      "timeline",
      "actions"
    ]);
  });

  test("summarizes latest feedback text into the card headline", () => {
    const board = projectFixture(
      {
        events: [
          event("start", "headline-session", "session.started", "2026-06-24T06:00:00.000Z", {
            title: "Masthead UI work"
          }),
          event("stop", "headline-session", "session.completed", "2026-06-24T06:05:00.000Z", {
            latestFeedbackSnapshot: {
              text:
                "The root cause was not GPT-5 nano. What changed: - Live session cards no longer receive demo harness/model telemetry. - Card headlines are now sentence-shaped.",
              source: "stop_hook",
              observedAt: "2026-06-24T06:05:00.000Z",
              redacted: true,
              bytesIn: 200,
              charsOut: 180,
              claims: ["mentions_files"]
            }
          })
        ],
        gitSnapshots: []
      },
      { selectedSessionId: "headline-session" }
    );

    expect(board.cards[0]?.latestFeedbackSignal?.summary).toBe(
      "Live session cards no longer receive demo harness or model telemetry."
    );
    expect((board.cards[0]?.headlineInput as { dispositionHints?: string[] } | undefined)?.dispositionHints).toContain(
      "Live session cards no longer receive demo harness or model telemetry."
    );
    expect(board.cards[0]?.headline.source).toBe("offline");
  });

  test("skips dangling transition bullets when summarizing latest feedback", () => {
    const board = projectFixture({
      events: [
        event("start", "session-transition", "session.started", "2026-06-24T06:00:00.000Z", {
          title: "Masthead UI work"
        }),
        event("stop", "session-transition", "session.completed", "2026-06-24T06:05:00.000Z", {
          latestFeedbackSnapshot: {
            text:
              "- The card badge rendered almost every non-idle card as Active, including completed/review history. Now: - The main grid now shows active sessions and recent idle sessions. - Red is reserved for actual blockers.",
            source: "stop_hook",
            observedAt: "2026-06-24T06:05:00.000Z",
            redacted: true,
            bytesIn: 220,
            charsOut: 190,
            claims: ["mentions_files"]
          }
        })
      ],
      gitSnapshots: []
    });

    expect(board.cards[0]?.latestFeedbackSignal?.summary).toBe(
      "The main grid now shows active sessions and recent idle sessions."
    );
    expect((board.cards[0]?.headlineInput as { dispositionHints?: string[] } | undefined)?.dispositionHints).toContain(
      "The main grid now shows active sessions and recent idle sessions."
    );
    expect(board.cards[0]?.headline.source).toBe("offline");
  });

  test("turns redacted slash markers into natural language in latest feedback summaries", () => {
    const board = projectFixture({
      events: [
        event("start", "session-redaction", "session.started", "2026-06-24T06:00:00.000Z", {
          title: "Masthead UI work"
        }),
        event("stop", "session-redaction", "session.completed", "2026-06-24T06:05:00.000Z", {
          latestFeedbackSnapshot: {
            text: "What changed: - The main grid defaults to current sessions only: running[path] blocked.",
            source: "stop_hook",
            observedAt: "2026-06-24T06:05:00.000Z",
            redacted: true,
            bytesIn: 120,
            charsOut: 90,
            claims: ["mentions_files"]
          }
        })
      ],
      gitSnapshots: []
    });

    expect(board.cards[0]?.latestFeedbackSignal?.summary).toBe(
      "The main grid defaults to current sessions only: running or blocked."
    );
  });

  test("removes path markers between ordinary words in latest feedback summaries", () => {
    const board = projectFixture({
      events: [
        event("start", "session-marker", "session.started", "2026-06-24T06:00:00.000Z", {
          title: "Masthead UI work"
        }),
        event("stop", "session-marker", "session.completed", "2026-06-24T06:05:00.000Z", {
          latestFeedbackSnapshot: {
            text: "What changed: - Updated recent-session pattern audit for durable user[path] signals.",
            source: "stop_hook",
            observedAt: "2026-06-24T06:05:00.000Z",
            redacted: true,
            bytesIn: 120,
            charsOut: 90,
            claims: ["mentions_files"]
          }
        })
      ],
      gitSnapshots: []
    });

    expect(board.cards[0]?.latestFeedbackSignal?.summary).toBe(
      "Updated recent-session pattern audit for durable user signals."
    );
  });
});
