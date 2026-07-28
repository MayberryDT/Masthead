import { describe, expect, test } from "vitest";
import { toBoardHeadlineInput, type BoardHeadlineInput, type BoardHeadlineSignal } from "../boardHeadlineInput";
import { validateBoardHeadlineFrame } from "../boardHeadlineFrame";
import type { BoardHeadlineFacts } from "../boardHeadlineFacts";
import { buildOfflineBoardHeadlineView, buildPendingBoardHeadlineView } from "../offlineBoardHeadline";

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

  test("rejects hook placeholders as deterministic subjects", () => {
    const baseInput = input({ recentTranscriptMessages: [], project: "Wargus-TypeScript", runtime: "codex" });
    const view = buildOfflineBoardHeadlineView({
      ...baseInput,
      subjectCandidates: ["Codex hook event", "Session", "019f1ebf-3f79-75c3-b20a-41de26b0f46e session", "Wargus-TypeScript"]
    });

    expect(view.headline).toMatch(/Wargus-TypeScript/);
    expect(view.headline).not.toMatch(/Codex hook event|019f1ebf/i);
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
        recentEvents: [],
        recentToolNames: [],
        changedFileCount: 12,
        runtime: "grok"
      })
    );
    expect(risk.frame?.disposition).toBe("high-risk change still open with many file edits");

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

  test("rejects generic project-session subjects when better evidence exists", () => {
    const baseInput = input({
      project: "Masthead",
      title: "Masthead session",
      recentTranscriptMessages: ["Implement Board headline frames from subject and disposition."],
      workContext: {
        label: "Board headline work",
        confidence: "path_cluster",
        pathClusters: ["board"],
        sourceSignals: ["path:board"]
      }
    });
    const view = buildOfflineBoardHeadlineView({
      ...baseInput,
      subjectCandidates: ["Masthead session", "Board headline work", "SessionCard.tsx"]
    });

    expect(view.frame?.subject).not.toMatch(/^Masthead session$/i);
    expect(view.frame?.subject).toMatch(/Board headline work|Board headlines|Session Card|SessionCard/i);
    expect(view.headline).not.toMatch(/^Masthead session:/i);
  });

  test.each([
    { project: "Masthead", title: "Masthead session" },
    { project: "Masthead", title: "masthead session" },
    { project: "Masthead", title: "MASTHEAD SESSION" },
    { project: "Nova OS", title: "Nova OS session" },
    { project: "Nova OS", title: "nova os session" },
    { project: "codex", title: "codex session" },
    { project: "Codex", title: "Codex session" }
  ])("does not keep sole subject as exact project-session label ($title)", ({ project, title }) => {
    const view = buildOfflineBoardHeadlineView(
      input({
        project,
        title,
        recentTranscriptMessages: [],
        workContext: undefined,
        recentFileBasenames: [],
        recentEvents: [],
        recentToolNames: [],
        attentionTitles: [],
        runtime: undefined
      })
    );

    expect(view.frame?.subject).not.toBe(title);
    expect(view.frame?.subject).not.toMatch(/^.+\s+session$/i);
    // Prefer the bare project name (or other non-colliding fallback) over "X session".
    expect(view.frame?.subject?.toLowerCase()).toBe(project.toLowerCase());
  });

  test("rejects project·harness title candidates when stronger subject evidence exists", () => {
    const baseInput = input({
      project: "Masthead",
      title: "Masthead · Codex",
      runtime: "codex",
      recentTranscriptMessages: ["Polish SessionCard layout for the Now board."],
      workContext: {
        label: "Board cards work",
        confidence: "path_cluster",
        pathClusters: ["board"],
        sourceSignals: ["path:board"]
      },
      recentFileBasenames: ["SessionCard.tsx"]
    });
    const view = buildOfflineBoardHeadlineView({
      ...baseInput,
      subjectCandidates: ["Masthead · Codex", "Masthead session", "Board cards"]
    });

    expect(view.frame?.subject).not.toMatch(/^Masthead\s*[·•]\s*Codex$/i);
    expect(view.frame?.subject).not.toMatch(/^Masthead session$/i);
    expect(view.frame?.subject).toMatch(/Board cards|Session Card|SessionCard/i);
  });

  test("hook-poverty inputs with only Masthead session titles do not stick on that label", () => {
    const view = buildOfflineBoardHeadlineView({
      ...input({
        project: "Masthead",
        title: "Masthead session",
        recentTranscriptMessages: [],
        workContext: undefined,
        recentFileBasenames: ["README.md"],
        recentEvents: [],
        recentToolNames: [],
        attentionTitles: [],
        runtime: "grok"
      }),
      subjectCandidates: ["Masthead session", "Session", "Masthead"]
    });

    expect(view.frame?.subject).not.toMatch(/^Masthead session$/i);
    // Bare project or project·harness fallback is fine; the colliding "X session" label is not.
    expect(view.frame?.subject).toMatch(/^Masthead( · Grok Build)?$/i);
  });

  test("diversifies disposition with evidence when subject is project-level", () => {
    const sharedFacts = {
      project: "Masthead",
      title: undefined as string | undefined,
      workContext: undefined,
      recentTranscriptMessages: [] as string[],
      attentionTitles: [] as string[],
      recentEvents: [] as BoardHeadlineFacts["recentEvents"],
      recentCommandFailures: [] as string[],
      lifecycle: "running" as const,
      primaryStatus: "editing",
      runtime: "grok" as const,
      changedFileCount: 2
    };

    // Force matching project-level subjects; basenames stay on facts for disposition only.
    const withCard = buildOfflineBoardHeadlineView({
      ...input({
        ...sharedFacts,
        recentFileBasenames: ["icon-registry.ts"],
        recentToolNames: ["search_replace"]
      }),
      subjectCandidates: ["Masthead", "UI", "session"]
    });
    const withFrame = buildOfflineBoardHeadlineView({
      ...input({
        ...sharedFacts,
        recentFileBasenames: ["boardHeadlineFrame.ts"],
        recentToolNames: ["read_file"]
      }),
      subjectCandidates: ["Masthead", "UI", "session"]
    });

    expect(withCard.frame?.subject).toMatch(/Masthead/i);
    expect(withFrame.frame?.subject).toMatch(/Masthead/i);
    // Same project-level subject shape should still yield different full headlines via disposition tokens.
    expect(withCard.frame?.subject).toBe(withFrame.frame?.subject);
    expect(withCard.frame?.disposition).toMatch(/icon-registry/i);
    expect(withFrame.frame?.disposition).toMatch(/boardHeadlineFrame/i);
    expect(withCard.headline).not.toBe(withFrame.headline);
    expect(withCard.frame?.disposition.length).toBeLessThanOrEqual(96);
    expect(validateBoardHeadlineFrame(withCard.frame).ok).toBe(true);
    expect(validateBoardHeadlineFrame(withFrame.frame).ok).toBe(true);
  });

  test("diversifies idle disposition with tool token when subject is project-level", () => {
    const a = buildOfflineBoardHeadlineView({
      ...input({
        project: "Masthead",
        title: undefined,
        workContext: undefined,
        recentTranscriptMessages: [],
        attentionTitles: [],
        recentEvents: [],
        recentFileBasenames: [],
        recentToolNames: ["todo_write"],
        lifecycle: "idle",
        primaryStatus: "stalled",
        runtime: "codex",
        changedFileCount: 0
      }),
      subjectCandidates: ["Masthead"]
    });
    const b = buildOfflineBoardHeadlineView({
      ...input({
        project: "Masthead",
        title: undefined,
        workContext: undefined,
        recentTranscriptMessages: [],
        attentionTitles: [],
        recentEvents: [],
        recentFileBasenames: [],
        recentToolNames: ["run_terminal_command"],
        lifecycle: "idle",
        primaryStatus: "stalled",
        runtime: "codex",
        changedFileCount: 0
      }),
      subjectCandidates: ["Masthead"]
    });

    expect(a.frame?.subject).toBe(b.frame?.subject);
    expect(a.frame?.disposition).toMatch(/todo_write/i);
    expect(b.frame?.disposition).toMatch(/run_terminal_command/i);
    expect(a.headline).not.toBe(b.headline);
    expect(validateBoardHeadlineFrame(a.frame).ok).toBe(true);
  });

  test("keeps short state disposition when subject is a specific multi-word task phrase", () => {
    const base = input({
      lifecycle: "running",
      primaryStatus: "editing",
      recentFileBasenames: ["icon-registry.ts"],
      recentToolNames: ["search_replace"],
      recentTranscriptMessages: ["Implement Logbook pagination spacing for dense tables."]
    });
    const view = buildOfflineBoardHeadlineView({
      ...base,
      subjectCandidates: ["Logbook pagination spacing", "icon-registry.ts", "Masthead"]
    });

    expect(view.frame?.subject).toMatch(/Logbook pagination spacing/i);
    // Specific subject already diversifies cards; disposition may stay a short state label.
    expect(view.frame?.disposition).toBe("editing files");
    expect(view.frame?.disposition).not.toMatch(/icon-registry/i);
  });

  test("offline subject prefers specific user phrase over Logbook domain-map singleton", () => {
    const view = buildOfflineBoardHeadlineView(
      input({
        workContext: {
          label: "Logbook work",
          confidence: "path_cluster",
          pathClusters: ["logbook"],
          sourceSignals: ["path:logbook"]
        },
        recentTranscriptMessages: ["Fix the Logbook artifact detail loading spinner"],
        recentFileBasenames: ["LogbookSurface.tsx"]
      })
    );

    expect(view.frame?.subject?.toLowerCase()).not.toBe("logbook");
    expect(view.frame?.subject).toMatch(/logbook/i);
    expect(view.frame?.subject?.split(/\s+/).length).toBeGreaterThan(1);
    expect(view.headline).not.toMatch(/^Logbook:/i);
  });

  test("offline subject ignores assistant openers when user task phrase is present", () => {
    const view = buildOfflineBoardHeadlineView(
      input({
        recentTranscriptMessages: [
          "Fix the Logbook artifact detail loading spinner",
          "I will inspect the repository"
        ],
        recentFileBasenames: []
      })
    );

    expect(view.frame?.subject).not.toMatch(/^I will inspect/i);
    expect(view.frame?.subject?.toLowerCase()).not.toBe("logbook");
    expect(view.frame?.subject).toMatch(/logbook/i);
  });
});
