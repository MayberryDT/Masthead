import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { App } from "../../app/App";
import { MastheadConnectionProvider } from "../../app/connection/MastheadConnectionProvider";
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
  "Work is progressing"
];


function renderApp(): string {
  return renderToStaticMarkup(
    <MastheadConnectionProvider>
      <App />
    </MastheadConnectionProvider>
  );
}
describe("Live Board UI", () => {
  test("renders final observability shell without prototype dashboard panels", () => {
    const html = renderApp();

    expect(html).toContain("Masthead");
    expect(html).not.toContain("System status:");
    expect(html).not.toContain("AI Agent Observability");
    expect(html).toContain('aria-label="Masthead session manager"');
    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain('aria-label="Session workspace"');
    expect(html).toContain('aria-label="Board controls"');
    expect(html).not.toContain('aria-label="Agent health metrics"');
    expect(html).not.toContain("Total Tokens (24h)");
    expect(html).not.toContain("Top Models (24h)");
    expect(html).not.toContain("Tokens / Min");
    expect(html).not.toContain("Resource Utilization");
    expect(html).not.toContain("Recent Errors");
    expect(html).toContain("All Harnesses");
    expect(html).toContain("All Lifecycles");
    expect(html).toContain("Last week");
    expect(html).toContain("10s");
    expect(html).toContain("Priority");
    expect(html).not.toContain("Live ingestion");
    expect(html).not.toContain("Demo");
    expect(html).not.toContain("Offline");
    expect(html).not.toContain("rail-controls");
    expect(html).not.toContain('aria-label="Filters"');
    expect(html).not.toContain("History");
    expect(html).not.toContain("Ended to review");
    expect(html).toContain("Board will switch to live sessions when the local collector responds.");
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
    const html = renderApp();

    expect(html).not.toContain("System status:");
    expect(html).toContain("Connecting to Masthead collector");
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
          source: "opencode.fixture"
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
          source: "opencode.fixture"
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
      headline: {
        headline: "Still running",
        frame: {
          subject: "Shared workspace edit",
          disposition: "review shared edits with overlapping work to inspect",
          state: "active",
          subjectKind: "feature",
          confidence: "high",
          evidence: ["Open details before continuing."]
        },
        source: "llm",
        status: "ready"
      },
      stateLabel: "Editing",
      primaryStatus: "editing",
      lifecycle: "running",
      priorityRank: 10,
      durationLabel: "4m",
      thinkingLevel: "Extra High",
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
    expect(html).toContain("modal-backdrop session-dossier-backdrop masthead-control-scope t-modal-backdrop");
    expect(html).toContain("session-dossier-modal");
    expect(html).toContain("meta-rail");
    expect(html).toContain("title-block");
    expect(html).toContain("Session dossier");
    expect(html).toContain("Enrichment summary");
    expect(html).toContain("Advanced details");
    expect(html).toContain("Still running");
    expect(html).not.toContain("Review shared edits");
    expect(html).not.toContain("This session is active with overlapping work to inspect.");
    expect(html).toContain("Source confidence");
    expect(html).toContain("shared_workspace");
    expect(html).not.toContain("Implementation is complete, but auth tests are still failing.");
    expect(html).not.toContain("Approve request");
    expect(html).not.toContain("Run command");
    expect(html).not.toContain("Git commit");
    expect(html).not.toContain("Open source");
  });

  test("session cards do not fall back to raw titles when next step is absent", () => {
    const html = renderToStaticMarkup(
      <SessionCard
        session={{
          sessionId: "session-private",
          project: "Payroll",
          title: "Fix Acme payroll callback with private customer detail",
          headline: {
            headline: "Auth work",
            frame: {
              subject: "Auth work",
              disposition: "active with no visible blocker",
              state: "active",
              subjectKind: "feature",
              confidence: "high",
              evidence: []
            },
            source: "llm",
            status: "ready"
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
    expect(html).not.toContain('role="button"');
    expect(html).toContain('aria-label="Auth work · Active"');
    expect(html).not.toContain("Acme payroll");
    expect(html).not.toContain("private customer detail");
  });

  test("keeps Board dossier button scope out of app shell layout rules", () => {
    const css = readFileSync("src/styles/masthead.css", "utf8");
    const shellRule = cssRuleBody(css, ".observability-console,\n.masthead-shell");
    const controlVariableRule = cssRuleBody(css, ".observability-console,\n.masthead-shell,\n.masthead-control-scope");

    expect(shellRule).toContain("display: grid;");
    expect(shellRule).not.toContain("masthead-control-scope");
    expect(controlVariableRule).toContain("--folded-control-clip:");
    expect(controlVariableRule).not.toContain("display: grid;");
  });
});

function cssRuleBody(css: string, selector: string): string {
  const selectorIndex = css.indexOf(`${selector} {`);
  if (selectorIndex === -1) throw new Error(`Expected CSS rule for ${selector}`);
  const openBraceIndex = css.indexOf("{", selectorIndex + selector.length);
  if (openBraceIndex === -1) throw new Error(`Expected CSS rule for ${selector} to have a body`);
  let depth = 0;
  for (let index = openBraceIndex; index < css.length; index += 1) {
    const character = css[index];
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(openBraceIndex + 1, index);
    }
  }
  throw new Error(`Expected CSS rule for ${selector} to close`);
}
