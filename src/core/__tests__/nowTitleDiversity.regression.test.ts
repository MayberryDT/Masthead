/**
 * Now-tab title diversity regression gate (Task 6).
 *
 * Investigation baseline (Halla, 2026-07-27, /tmp/masthead-now-title-investigation-report.md):
 * - Hook-poverty corpus (40 same-project hook sessions): **1 unique subject**
 *   (`Masthead session`), 4 unique headlines, ~90% exact headline duplicate rate.
 * - Cross-harness diverse-prompt corpus (120 rows): domain-map collapse → 14 unique
 *   headlines; many distinct user phrases mapped to singleton product labels.
 * - Live hook fixtures (6 harnesses): 2 unique headlines, all subject
 *   `masthead-live-fixture session`.
 *
 * Thresholds locked here (CI floor — not a perfection target):
 * 1. Diverse-user offline corpus: unique subjects / N ≥ 0.50
 *    (investigation showed near-total subject collapse; post T1+T3 we expect ≫ 50%).
 * 2. Hook-poverty **with** privacy-safe task previews (T2): unique subjects must be > 1
 *    (investigation baseline was exactly 1).
 * 3. Hook-poverty **without** user text but with tools/files: unique subjects > 1
 *    when file/tool evidence exists (T1 evidence path + component basenames); full
 *    headlines must also diversify (T4 disposition tokens) so cards are not identical.
 * 4. Never accept `${project} session` as the offline subject when that is the only
 *    stored title (T1).
 *
 * Non-goals: perfect uniqueness, LLM titles, Logbook durable sessionTitle.
 */
import { describe, expect, test } from "vitest";
import { toBoardHeadlineInput, type BoardHeadlineSignal } from "../boardHeadlineInput.ts";
import { buildOfflineBoardHeadlineView } from "../offlineBoardHeadline.ts";
import type { BoardHeadlineFacts } from "../boardHeadlineFacts.ts";
import { normalizeLiveHookPayload } from "../liveHookAdapter.ts";
import { deriveSessions } from "../sessionReducer.ts";
import { buildBoardHeadlineFacts } from "../boardHeadlineFacts.ts";
import { validateBoardHeadlineFrame } from "../boardHeadlineFrame.ts";

/** Investigation-style floor for diverse-user subject uniqueness. */
const DIVERSE_USER_UNIQUE_SUBJECT_RATE = 0.5;

const DIVERSE_USER_PHRASES = [
  "Implement Logbook pagination spacing for dense tables",
  "Fix Sources connector activation flakiness on bridge ports",
  "Polish SessionCard layout for the Now board",
  "Add Workbench activity rail keyboard navigation",
  "Repair transcript import progress indicator stalling",
  "Update Settings danger zone delete confirmation copy",
  "Wire MCP status panel into Agent access section",
  "Diversify offline disposition when subject is weak",
  "Reject generic project-session subjects in offline headlines",
  "Surface privacy-safe live task previews for hook events",
  "Prefer user-task phrases over domain-map singleton labels",
  "Improve Codex adapter titles from first user turn"
] as const;

const HOOK_POVERTY_TOOLS = [
  "search_replace",
  "read_file",
  "run_terminal_command",
  "todo_write",
  "grep",
  "list_dir",
  "write",
  "web_search"
] as const;

const HOOK_POVERTY_FILES = [
  "SessionCard.tsx",
  "boardHeadlineFrame.ts",
  "icon-registry.ts",
  "LogbookSurface.tsx",
  "SourcesToolbar.tsx",
  "liveHookAdapter.ts",
  "offlineBoardHeadline.ts",
  "sessionReducer.ts"
] as const;

function baseFacts(overrides: Partial<BoardHeadlineFacts> = {}): BoardHeadlineFacts {
  return {
    sessionId: "session-1",
    project: "Masthead",
    lifecycle: "running",
    primaryStatus: "editing",
    workContext: undefined,
    recentTranscriptMessages: [],
    recentFileBasenames: [],
    changedFileCount: 0,
    recentEvents: [],
    recentToolNames: [],
    recentCommandFailures: [],
    attentionTitles: [],
    conflictTitles: [],
    // Investigation collapse label — offline must not promote this as the subject.
    title: "Masthead session",
    runtime: "grok",
    ...overrides
  };
}

function headlineInput(
  overrides: Partial<BoardHeadlineFacts> = {},
  signals: BoardHeadlineSignal[] = []
) {
  const facts = baseFacts(overrides);
  return toBoardHeadlineInput({
    lifecycle: facts.lifecycle,
    primaryStatus: facts.primaryStatus,
    signals,
    facts
  });
}

function uniqueRate(values: string[]): number {
  if (values.length === 0) return 0;
  return new Set(values.map((value) => value.toLowerCase())).size / values.length;
}

function uniqueCount(values: string[]): number {
  return new Set(values.map((value) => value.toLowerCase())).size;
}

describe("now title diversity regression gate", () => {
  test("diverse-user offline corpus keeps unique subjects ≥ 50%", () => {
    // Investigation: domain-map + generic project-session collapse made many distinct
    // user prompts share one subject. Floor is 50% unique subjects for a diverse-user
    // corpus of the same project (plan Task 6 / investigation §3).
    const subjects: string[] = [];
    const headlines: string[] = [];

    for (let index = 0; index < DIVERSE_USER_PHRASES.length; index += 1) {
      const phrase = DIVERSE_USER_PHRASES[index]!;
      const view = buildOfflineBoardHeadlineView(
        headlineInput({
          sessionId: `diverse-user-${index}`,
          recentTranscriptMessages: [phrase],
          title: "Masthead session",
          // Same project for every row — diversity must come from user phrases, not project.
          project: "Masthead",
          recentFileBasenames: [],
          recentToolNames: [],
          workContext: undefined
        })
      );

      expect(view.source).toBe("offline");
      expect(view.frame).toBeDefined();
      expect(validateBoardHeadlineFrame(view.frame).ok).toBe(true);

      const subject = view.frame!.subject;
      subjects.push(subject);
      headlines.push(view.headline);

      expect(subject.toLowerCase()).not.toBe("masthead session");
      expect(subject).not.toMatch(/^.+\s+session$/i);
    }

    const subjectRate = uniqueRate(subjects);
    expect(
      subjectRate,
      `unique subject rate ${subjectRate.toFixed(2)} below floor ${DIVERSE_USER_UNIQUE_SUBJECT_RATE}; subjects=${JSON.stringify(subjects)}`
    ).toBeGreaterThanOrEqual(DIVERSE_USER_UNIQUE_SUBJECT_RATE);

    // Sanity: we should not collapse the whole corpus to a single domain singleton.
    expect(uniqueCount(subjects)).toBeGreaterThan(1);
    expect(uniqueCount(headlines)).toBeGreaterThan(1);
  });

  test("hook-poverty with live task previews yields more than 1 unique subject", () => {
    // Investigation baseline: live hooks suppressed prompts → every card subject was
    // `${cwd-basename} session` (1 unique). T2 surfaces a privacy-safe task preview
    // into summary/title so offlineSubject can diversify.
    const subjects: string[] = [];
    const headlines: string[] = [];

    for (let index = 0; index < 8; index += 1) {
      const prompt = DIVERSE_USER_PHRASES[index]!;
      const event = normalizeLiveHookPayload(
        {
          hookEventName: "UserPromptSubmit",
          sessionId: `live-preview-${index}`,
          // Same cwd basename for every session so project/title poverty is controlled.
          cwd: "/tmp/masthead-live-fixture",
          timestamp: `2026-07-05T12:00:${String(index).padStart(2, "0")}.000Z`,
          prompt
        },
        {
          receivedAt: `2026-07-05T12:00:${String(index + 10).padStart(2, "0")}.000Z`,
          runtime: "claude_code"
        }
      );

      const sessions = deriveSessions([event], [], {
        now: new Date("2026-07-05T12:05:00.000Z")
      });
      expect(sessions).toHaveLength(1);
      const session = sessions[0]!;

      // Full prompt must not leak into hook payload (privacy gate from T2).
      expect(JSON.stringify(event.payload)).not.toContain(prompt);

      const facts = buildBoardHeadlineFacts({
        card: {
          changedFileCount: session.changedFileCount,
          latestFeedbackSignal: undefined,
          lifecycle: session.lifecycle,
          model: undefined,
          primaryStatus: session.primaryStatus,
          // Force same project label across the corpus.
          project: "Masthead",
          runtime: session.runtime,
          sessionId: session.sessionId,
          title: session.title,
          workContext: undefined
        },
        events: [event],
        gitSnapshots: [],
        attentionItems: [],
        conflicts: []
      });
      facts.project = "Masthead";

      const view = buildOfflineBoardHeadlineView(
        toBoardHeadlineInput({
          lifecycle: session.lifecycle,
          primaryStatus: session.primaryStatus,
          signals: [],
          facts
        })
      );

      expect(view.frame).toBeDefined();
      const subject = view.frame!.subject;
      subjects.push(subject);
      headlines.push(view.headline);

      expect(subject.toLowerCase()).not.toBe("masthead session");
      expect(subject.toLowerCase()).not.toBe("masthead-live-fixture session");
      expect(subject).not.toMatch(/^.+\s+session$/i);
    }

    // Investigation floor was exactly 1 unique subject for hook poverty.
    expect(
      uniqueCount(subjects),
      `hook-poverty+task-preview collapsed subjects again: ${JSON.stringify(subjects)}`
    ).toBeGreaterThan(1);

    // Task previews should also beat the old 50% floor for this small diverse set.
    expect(uniqueRate(subjects)).toBeGreaterThanOrEqual(DIVERSE_USER_UNIQUE_SUBJECT_RATE);
    expect(uniqueCount(headlines)).toBeGreaterThan(1);
  });

  test("hook-poverty tools/files only: subjects and headlines no longer all identical", () => {
    // Pure hook poverty without user text: investigation had 1 unique subject and
    // ~4 unique headlines for 40 rows. With only tools/files varying (same project +
    // Masthead session title), offline evidence + weak-subject disposition (T4) must
    // prevent total collapse.
    const subjects: string[] = [];
    const headlines: string[] = [];
    const dispositions: string[] = [];

    for (let index = 0; index < 16; index += 1) {
      const view = buildOfflineBoardHeadlineView(
        headlineInput({
          sessionId: `hook-poverty-${index}`,
          project: "Masthead",
          title: "Masthead session",
          recentTranscriptMessages: [],
          workContext: undefined,
          recentToolNames: [HOOK_POVERTY_TOOLS[index % HOOK_POVERTY_TOOLS.length]!],
          recentFileBasenames: [HOOK_POVERTY_FILES[index % HOOK_POVERTY_FILES.length]!],
          changedFileCount: (index % 5) + 1,
          primaryStatus: index % 2 === 0 ? "editing" : "stalled",
          lifecycle: index % 2 === 0 ? "running" : "idle",
          runtime: "grok"
        })
      );

      expect(view.frame).toBeDefined();
      expect(validateBoardHeadlineFrame(view.frame).ok).toBe(true);

      const subject = view.frame!.subject;
      subjects.push(subject);
      headlines.push(view.headline);
      dispositions.push(view.frame!.disposition);

      // T1: never stick on the colliding project-session label.
      expect(subject.toLowerCase()).not.toBe("masthead session");
      expect(subject).not.toMatch(/^masthead\s+session$/i);
    }

    // With file/tool evidence present, we must not return to 1 unique subject
    // (investigation worst case).
    expect(
      uniqueCount(subjects),
      `tools/files hook-poverty unique subjects collapsed: ${JSON.stringify([...new Set(subjects)])}`
    ).toBeGreaterThan(1);

    // Even if some subjects still share a project-level fallback, full headlines must
    // diversify via disposition evidence tokens (T4).
    expect(
      uniqueCount(headlines),
      `headlines still collapsed under tools/files variation: ${JSON.stringify([...new Set(headlines)])}`
    ).toBeGreaterThan(1);
    expect(uniqueCount(dispositions)).toBeGreaterThan(1);
  });

  test("same-project weak subjects still produce distinct headlines via disposition", () => {
    // T4 regression: when subject is forced to project-level (weak), differing files
    // must change the rendered headline so Now cards do not read identically.
    const a = buildOfflineBoardHeadlineView({
      ...headlineInput({
        project: "Masthead",
        title: undefined,
        recentTranscriptMessages: [],
        workContext: undefined,
        recentFileBasenames: ["icon-registry.ts"],
        recentToolNames: ["search_replace"],
        lifecycle: "running",
        primaryStatus: "editing",
        runtime: "grok"
      }),
      subjectCandidates: ["Masthead", "UI", "session"]
    });
    const b = buildOfflineBoardHeadlineView({
      ...headlineInput({
        project: "Masthead",
        title: undefined,
        recentTranscriptMessages: [],
        workContext: undefined,
        recentFileBasenames: ["boardHeadlineFrame.ts"],
        recentToolNames: ["read_file"],
        lifecycle: "running",
        primaryStatus: "editing",
        runtime: "grok"
      }),
      subjectCandidates: ["Masthead", "UI", "session"]
    });

    expect(a.frame?.subject).toBe(b.frame?.subject);
    expect(a.headline).not.toBe(b.headline);
    expect(a.frame?.disposition).not.toBe(b.frame?.disposition);
    expect(validateBoardHeadlineFrame(a.frame).ok).toBe(true);
    expect(validateBoardHeadlineFrame(b.frame).ok).toBe(true);
  });

  test("sole project-session title is not a stable offline subject", () => {
    // Direct T1 floor against the investigation label.
    const view = buildOfflineBoardHeadlineView(
      headlineInput({
        project: "Masthead",
        title: "Masthead session",
        recentTranscriptMessages: [],
        recentFileBasenames: [],
        recentToolNames: [],
        workContext: undefined,
        recentEvents: [],
        attentionTitles: []
      })
    );

    expect(view.frame?.subject?.toLowerCase()).not.toBe("masthead session");
    expect(view.frame?.subject).not.toMatch(/^.+\s+session$/i);
  });
});
