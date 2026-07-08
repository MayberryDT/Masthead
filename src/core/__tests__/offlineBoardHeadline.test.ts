import { describe, expect, test } from "vitest";
import { toBoardHeadlineInput, type BoardHeadlineInput, type BoardHeadlineSignal } from "../boardHeadlineInput";
import { validateBoardHeadlineFrame } from "../boardHeadlineFrame";
import type { BoardHeadlineFacts } from "../boardHeadlineFacts";
import { buildOfflineBoardHeadlineView, buildPendingBoardHeadlineView, buildWaitingForTranscriptBoardHeadlineView } from "../offlineBoardHeadline";

function facts(overrides: Partial<BoardHeadlineFacts> = {}): BoardHeadlineFacts {
  return {
    sessionId: "session-1",
    project: "Masthead",
    lifecycle: "running",
    primaryStatus: "editing",
    workContext: {
      label: "Board headline work",
      confidence: "path_cluster",
      pathClusters: ["board"],
      sourceSignals: ["path:board"]
    },
    recentTranscriptMessages: ["Implement Board headline frames from subject and disposition."],
    recentFileBasenames: ["SessionCard.tsx"],
    changedFileCount: 1,
    recentEvents: [],
    recentToolNames: [],
    recentCommandFailures: [],
    attentionTitles: [],
    conflictTitles: [],
    ...overrides
  };
}

function input(overrides: Partial<BoardHeadlineFacts> = {}, signals: BoardHeadlineSignal[] = []): BoardHeadlineInput {
  const liveCopyFacts = facts(overrides);

  return toBoardHeadlineInput({
    lifecycle: liveCopyFacts.lifecycle,
    primaryStatus: liveCopyFacts.primaryStatus,
    signals,
    facts: liveCopyFacts
  });
}

describe("offline board headline views", () => {
  test("returns a pending placeholder without a deterministic frame", () => {
    expect(buildPendingBoardHeadlineView(input())).toEqual({
      headline: "Updating session status...",
      source: "pending",
      status: "pending"
    });
  });

  test("builds a waiting-for-transcript pending headline", () => {
    expect(buildWaitingForTranscriptBoardHeadlineView(input())).toEqual({
      headline: "Waiting for transcript...",
      source: "pending",
      status: "pending"
    });
  });

  test("returns an offline deterministic frame without LLM fallback copy", () => {
    const view = buildOfflineBoardHeadlineView(input());

    expect(view.source).toBe("offline");
    expect(view.status).toBe("ready");
    expect(view.frame).toBeDefined();
    expect(validateBoardHeadlineFrame(view.frame).ok).toBe(true);
    expect(view.headline).not.toMatch(/LLM|waiting for LLM/i);
    expect(view.headline).toMatch(/in progress|making file changes|Board headline work|Board cards|SessionCard/i);
  });

  test("uses failure evidence for blocked dispositions", () => {
    const view = buildOfflineBoardHeadlineView(
      input(
        {
          primaryStatus: "blocked",
          recentCommandFailures: ["vitest failed on Board headline frame tests"]
        },
        ["command_failed"]
      )
    );

    expect(view.frame?.state).toBe("blocked");
    expect(view.frame?.disposition).toMatch(/^blocked by /);
    expect(view.frame?.disposition).toContain("vitest failed on Board headline frame tests");
  });

  test("falls back to project subject when candidates are generic", () => {
    const baseInput = input();
    const view = buildOfflineBoardHeadlineView({
      ...baseInput,
      subjectCandidates: ["UI", "changes", "session narrative"]
    });

    expect(view.source).toBe("offline");
    expect(view.status).toBe("ready");
    expect(view.frame?.subject).toMatch(/Masthead|Board headline work|Session Card|SessionCard/i);
    expect(view.headline).not.toMatch(/LLM|session narrative|Board headlines: waiting/i);
    expect(validateBoardHeadlineFrame(view.frame).ok).toBe(true);
  });

  test("does not collapse multi-area path-cluster work to Settings UI", () => {
    const view = buildOfflineBoardHeadlineView(
      input({
        title: "019f4315-c31f-7c52-a9ba-813d244d8124 session",
        workContext: {
          label: "Settings UI work",
          confidence: "path_cluster",
          pathClusters: ["docs", "settings", "tests", "ui"],
          sourceSignals: ["path:docs", "path:settings", "path:tests", "path:ui"]
        },
        recentTranscriptMessages: [],
        recentFileBasenames: ["README.md", "product-release-gate.md"],
        runtime: "grok"
      })
    );

    expect(view.frame?.subject).not.toMatch(/settings ui/i);
    expect(view.headline).not.toMatch(/^Settings UI:/i);
    expect(view.headline).not.toMatch(/^README\.md:/i);
    expect(view.headline).toMatch(/Masthead · Grok Build|Masthead/i);
  });

  test("sanitizes unsafe blocked failure hints before rendering an offline headline", () => {
    const baseInput = input(
      {
        primaryStatus: "blocked",
        recentCommandFailures: ["vitest failed on Board headline frame tests"]
      },
      ["command_failed"]
    );
    const unsafeHint = 'blocked by https://example.com ::git-stage{cwd="/tmp"} OPENAI_API_KEY';
    const view = buildOfflineBoardHeadlineView({
      ...baseInput,
      dispositionHints: [unsafeHint]
    });

    expect(view.source).toBe("offline");
    expect(view.status).toBe("ready");
    expect(view.frame?.state).toBe("blocked");
    expect(view.frame?.disposition).toBe("blocked by recorded session evidence");
    expect(view.headline).not.toContain("https://example.com");
    expect(view.headline).not.toContain("::git-stage");
    expect(view.headline).not.toContain("OPENAI_API_KEY");
    expect(validateBoardHeadlineFrame(view.frame).ok).toBe(true);
  });

  test("preserves ended failed state in offline ready views", () => {
    const view = buildOfflineBoardHeadlineView(
      input({
        lifecycle: "ended",
        primaryStatus: "failed"
      })
    );

    expect(view.source).toBe("offline");
    expect(view.status).toBe("ready");
    expect(view.frame?.state).toBe("failed");
  });

  test("varies idle dispositions from attention, files, and event evidence", () => {
    const risk = buildOfflineBoardHeadlineView(
      input({
        lifecycle: "idle",
        primaryStatus: "stalled",
        recentTranscriptMessages: [],
        attentionTitles: ["High-risk change"],
        changedFileCount: 12,
        runtime: "grok"
      })
    );
    expect(risk.frame?.disposition).toBe("high-risk change still open");

    const afterTests = buildOfflineBoardHeadlineView(
      input({
        lifecycle: "idle",
        primaryStatus: "stalled",
        recentTranscriptMessages: [],
        attentionTitles: [],
        recentEvents: [{ type: "command.finished", summary: "npm test -- --run src/ui/workbench", occurredAt: "2026-07-08T12:00:00.000Z" }],
        changedFileCount: 2,
        runtime: "grok"
      })
    );
    expect(afterTests.frame?.disposition).toBe("quiet after last test run");

    const afterCommit = buildOfflineBoardHeadlineView(
      input({
        lifecycle: "idle",
        primaryStatus: "stalled",
        recentTranscriptMessages: [],
        attentionTitles: [],
        recentEvents: [{ type: "command.finished", summary: "git commit -m fix(ui): workbench chrome", occurredAt: "2026-07-08T12:00:00.000Z" }],
        runtime: "codex"
      })
    );
    expect(afterCommit.frame?.disposition).toBe("quiet after last commit");

    const fileChurn = buildOfflineBoardHeadlineView(
      input({
        lifecycle: "idle",
        primaryStatus: "stalled",
        recentTranscriptMessages: [],
        attentionTitles: [],
        recentEvents: [],
        recentToolNames: [],
        changedFileCount: 40,
        runtime: "grok"
      })
    );
    expect(fileChurn.frame?.disposition).toBe("quiet after 40 file changes");
  });

  test("varies active dispositions from tools", () => {
    const editing = buildOfflineBoardHeadlineView(
      input({
        lifecycle: "running",
        primaryStatus: "editing",
        recentToolNames: ["search_replace", "read_file"]
      })
    );
    expect(editing.frame?.disposition).toBe("editing files");
  });
});
