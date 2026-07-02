import { describe, expect, test } from "vitest";
import { toBoardHeadlineInput, type BoardHeadlineInput, type BoardHeadlineSignal } from "../boardHeadlineInput";
import { validateBoardHeadlineFrame } from "../boardHeadlineFrame";
import type { BoardLiveCopyFacts } from "../boardLiveCopyFacts";
import { buildOfflineBoardHeadlineView, buildPendingBoardHeadlineView } from "../offlineBoardHeadline";

function facts(overrides: Partial<BoardLiveCopyFacts> = {}): BoardLiveCopyFacts {
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

function input(overrides: Partial<BoardLiveCopyFacts> = {}, signals: BoardHeadlineSignal[] = []): BoardHeadlineInput {
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
      headline: "Generating headline...",
      source: "pending",
      status: "pending"
    });
  });

  test("returns an offline deterministic frame when LLM headline access is unavailable", () => {
    const view = buildOfflineBoardHeadlineView(input());

    expect(view.source).toBe("offline");
    expect(view.status).toBe("ready");
    expect(view.frame).toBeDefined();
    expect(validateBoardHeadlineFrame(view.frame).ok).toBe(true);
    expect(view.headline).toBe("Board headlines: waiting for LLM headline access.");
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

  test("falls back to a valid frame when subject candidates are generic", () => {
    const baseInput = input();
    const view = buildOfflineBoardHeadlineView({
      ...baseInput,
      subjectCandidates: ["UI", "changes", "Masthead"]
    });

    expect(view.source).toBe("offline");
    expect(view.status).toBe("ready");
    expect(view.frame?.subject).toBe("Board headlines");
    expect(view.headline).toBe("Board headlines: waiting for LLM headline access.");
    expect(view.headline).not.toMatch(/\b(?:UI|changes|Masthead)\b/i);
    expect(validateBoardHeadlineFrame(view.frame).ok).toBe(true);
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
});
