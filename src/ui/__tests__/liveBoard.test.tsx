import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { App } from "../../app/App";
import type { AttentionItem, SessionDetailView } from "../../core/types";
import { AttentionQueue } from "../AttentionQueue";
import { BriefingStrip } from "../BriefingStrip";
import { SessionCard } from "../SessionCard";
import { SessionDetailModal } from "../SessionDetailModal";

const forbiddenPrimaryDashboardText = [
  "Demo data",
  "Demo replay",
  "Local history",
  "Local records",
  "Commands / Tests",
  "Files Changed",
  "Progress",
  "Host",
  "Docker",
  "Linux",
  "Kubernetes",
  "Blocked Reason",
  "Blocked At",
  "Total Cost",
  "System status:",
  "Work is progressing",
  "Needs attention"
];

describe("Live Board UI", () => {
  test("renders final observability shell without prototype dashboard panels", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("Masthead");
    expect(html).not.toContain("System status:");
    expect(html).not.toContain("AI Agent Observability");
    expect(html).toContain('aria-label="Masthead observability console"');
    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain('aria-label="Session observability board"');
    expect(html).toContain('aria-label="Telemetry panels"');
    expect(html).not.toContain('aria-label="Agent health metrics"');
    expect(html).toContain("Live Sessions");
    expect(html).toContain("Session Source");
    expect(html).toContain("Codex");
    expect(html).not.toContain("Total Tokens (24h)");
    expect(html).not.toContain("Top Models (24h)");
    expect(html).not.toContain("Tokens / Min");
    expect(html).toContain("Session Mix");
    expect(html).toContain("Visible sessions");
    expect(html).not.toContain("Resource Utilization");
    expect(html).not.toContain("Recent Errors");
    expect(html).toContain("All Harnesses");
    expect(html).toContain("All Lifecycles");
    expect(html).toContain("Last 24 hours");
    expect(html).toContain("10s");
    expect(html).toContain("Recently Started");
    expect(html).not.toContain("Live ingestion");
    expect(html).not.toContain("Demo");
    expect(html).not.toContain("Offline");
    expect(html).not.toContain("rail-controls");
    expect(html).not.toContain('aria-label="Filters"');
    expect(html).not.toContain("History");
    expect(html).not.toContain("Ended to review");
    expect(html).toContain("The board will switch to live sessions when the local collector responds.");
    expect(html).not.toContain("Fix Google OAuth callback");
    expect(html).not.toContain("Approve request");
    expect(html).not.toContain("Run command");
    expect(html).not.toContain("Git commit");
    for (const text of forbiddenPrimaryDashboardText) {
      expect(html).not.toContain(text);
    }

    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("renders calm single-line headline without direct-address language", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).not.toContain("System status:");
    expect(html).toContain("0 active");
    expect(html).not.toMatch(/\byou|your|urgent|critical|dangerous/i);
  });

  test("briefing fallback summarizes visible sessions when projection brief is absent", () => {
    const html = renderToStaticMarkup(
      <BriefingStrip
        cardCount={3}
        summary={{
          active: 2,
          needsAttention: 2,
          conflicts: 1,
          completed: 1,
          running: 1,
          needsAction: 1,
          idle: 1
        }}
      />
    );

    expect(html).toContain("3 sessions are visible overall.");
    expect(html).toContain("2 need attention.");
    expect(html).toContain("1 conflict is visible.");
    expect(html).not.toMatch(/\byou|your|urgent|critical|dangerous/i);
  });

  test("renders failed command attention evidence details without unsafe actions", () => {
    const failedCommandItem = {
      itemId: "attention:session-1:command-failed:cmd-test-1",
      sessionId: "session-1",
      project: "App",
      type: "command_failed",
      severity: "P1",
      title: "Command failed",
      createdAt: "2026-06-23T02:08:00.000Z",
      affectedPaths: [],
      affectedCommandIds: ["cmd-test-1"],
      evidence: [
        {
          id: "failed-command",
          kind: "event",
          observedAt: "2026-06-23T02:08:00.000Z",
          source: "codex.fixture"
        }
      ],
      support: "deterministic",
      suggestedNextAction: "Inspect the failed command before continuing.",
      commandDetails: [
        {
          commandId: "cmd-test-1",
          exitCode: 2,
          category: "test",
          occurredAt: "2026-06-23T02:08:00.000Z",
          evidenceId: "failed-command"
        }
      ]
    } satisfies AttentionItem & {
      commandDetails: Array<{
        commandId: string;
        exitCode: number;
        category: string;
        occurredAt: string;
        evidenceId: string;
      }>;
    };

    const html = renderToStaticMarkup(<AttentionQueue items={[failedCommandItem]} />);

    expect(html).toContain("Exit 2");
    expect(html).toContain("test");
    expect(html).toContain("2026-06-23T02:08:00.000Z");
    expect(html).toContain("failed-command");
    expect(html).not.toContain("Approve request");
    expect(html).not.toContain("Run command");
    expect(html).not.toContain("Git commit");
  });

  test("scan attention queue suppresses raw command evidence details", () => {
    const failedCommandItem = {
      itemId: "attention:session-1:command-failed:cmd-test-1",
      sessionId: "session-1",
      project: "App",
      type: "command_failed",
      severity: "P1",
      title: "Command failed",
      createdAt: "2026-06-23T02:08:00.000Z",
      affectedPaths: [],
      affectedCommandIds: ["cmd-test-1"],
      evidence: [
        {
          id: "failed-command",
          kind: "event",
          observedAt: "2026-06-23T02:08:00.000Z",
          source: "codex.fixture"
        }
      ],
      support: "deterministic",
      suggestedNextAction: "Inspect the failed command before continuing.",
      commandDetails: [
        {
          commandId: "cmd-test-1",
          exitCode: 2,
          category: "test",
          occurredAt: "2026-06-23T02:08:00.000Z",
          evidenceId: "failed-command"
        }
      ]
    } satisfies AttentionItem & {
      commandDetails: Array<{
        commandId: string;
        exitCode: number;
        category: string;
        occurredAt: string;
        evidenceId: string;
      }>;
    };

    const html = renderToStaticMarkup(<AttentionQueue items={[failedCommandItem]} variant="scan" />);

    expect(html).toContain("A failed step needs review");
    expect(html).toContain("Review the session detail before continuing.");
    expect(html).not.toContain("Command failed");
    expect(html).not.toContain("failed command");
    expect(html).not.toContain("Exit 2");
    expect(html).not.toContain("2026-06-23T02:08:00.000Z");
    expect(html).not.toContain("failed-command");
  });

  test("modal details render degraded session and conflict attribution explicitly", () => {
    const session: SessionDetailView = {
      sessionId: "session-1",
      project: "App",
      title: "Shared workspace edit",
      copy: {
        headline: "Still running",
        status: "Review shared edits",
        reason: "This session is active with overlapping work to inspect.",
        nextStep: "Open details before continuing.",
        source: "deterministic"
      },
      stateLabel: "Editing",
      primaryStatus: "editing",
      lifecycle: "running",
      priorityRank: 10,
      durationLabel: "4m",
      branchOrWorktree: "agent/test",
      lastActivity: "2026-06-23T02:04:00.000Z",
      lastActivityLabel: "0s ago",
      changedFileCount: 1,
      attentionReason: "Same tracked path changed by 2 active sessions",
      indicators: ["conflict", "degraded"],
      identityConfidence: "shared_workspace",
      safeActions: ["open_source_session", "open_repo", "open_readonly_diff", "snooze", "dismiss", "mark_reviewed"],
      isExpanded: true,
      currentActivity: "Same tracked path changed by 2 active sessions",
      reviewAnnotations: [],
      evidence: {
        observed: [
          {
            id: "snapshot-1",
            kind: "git_snapshot",
            observedAt: "2026-06-23T02:04:00.000Z",
            source: "git.observer"
          }
        ],
        inferred: [],
        missing: []
      },
      conflicts: [
        {
          conflictId: "conflict-1",
          type: "exact_file_overlap",
          severity: "high",
          sessionIds: ["session-1", "session-2"],
          repo: { gitCommonDir: "/workspace/app/.git", worktreePaths: ["/workspace/app"] },
          sharedPaths: ["src/app.ts"],
          attribution: "degraded",
          title: "Same tracked path changed by 2 active sessions",
          evidence: [
            {
              id: "snapshot-1",
              kind: "git_snapshot",
              observedAt: "2026-06-23T02:04:00.000Z",
              source: "git.observer"
            }
          ]
        }
      ],
      attentionItems: [],
      latestFeedback: {
        text: "Implementation is complete, but auth tests are still failing.",
        source: "stop_hook",
        observedAt: "2026-06-23T02:05:00.000Z",
        redacted: true,
        bytesIn: 80,
        charsOut: 61,
        claims: ["claims_complete", "mentions_tests", "mentions_error"]
      },
      inspectorSections: ["state", "latest_feedback", "attention_conflicts", "evidence", "timeline", "actions"],
      timeline: [
        {
          eventId: "event-1",
          type: "file.changed",
          occurredAt: "2026-06-23T02:04:00.000Z",
          summary: "File changed"
        }
      ],
      workspace: {
        repoRoot: "/workspace/app",
        worktreePath: "/workspace/app",
        gitCommonDir: "/workspace/app/.git",
        branch: "agent/test"
      }
    };

    const html = renderToStaticMarkup(<SessionDetailModal session={session} onClose={() => undefined} />);

    expect(html).toContain("modal-scroll-frame");
    expect(html).toContain("modal-session-meta");
    expect(html).toContain("Session brief");
    expect(html).toContain("Evidence health");
    expect(html).toContain("Still running");
    expect(html).toContain("Review shared edits");
    expect(html).toContain("This session is active with overlapping work to inspect.");
    expect(html).toContain("Attribution degraded");
    expect(html).toContain("Session: shared workspace");
    expect(html).toContain("Conflict: degraded");
    expect(html).toContain("Latest agent feedback");
    expect(html).toContain("Implementation is complete, but auth tests are still failing.");
    expect(html.indexOf("Current activity")).toBeLessThan(html.indexOf("Latest agent feedback"));
    expect(html).not.toContain("Approve request");
    expect(html).not.toContain("Run command");
    expect(html).not.toContain("Git commit");
  });

  test("session cards do not fall back to raw titles when next step is absent", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={{
          sessionId: "session-private",
          project: "Payroll",
          title: "Fix Acme payroll callback with private customer detail",
          copy: {
            headline: "Auth work",
            status: "Work is active.",
            reason: "No blocker is visible.",
            source: "deterministic"
          },
          stateLabel: "Editing",
          primaryStatus: "editing",
          lifecycle: "running",
          priorityRank: 10,
          durationLabel: "4m",
          branchOrWorktree: "auth/callback",
          lastActivity: "2026-06-23T02:04:00.000Z",
          lastActivityLabel: "0s ago",
          changedFileCount: 1,
          indicators: [],
          identityConfidence: "direct",
          safeActions: ["open_source_session"],
          isExpanded: false
        }}
      />
    );

    expect(html).toContain("Auth work");
    expect(html).not.toContain("Work is active.");
    expect(html).toContain("Worktree");
    expect(html).toContain("auth/callback");
    expect(html).toContain('role="button"');
    expect(html).toContain('aria-label="Open Auth work details"');
    expect(html).not.toContain("Acme payroll");
    expect(html).not.toContain("private customer detail");
  });
});
