import { describe, expect, test } from "vitest";
import { deriveSessions } from "../sessionReducer.ts";
import { buildBoardHeadlineFacts } from "../boardHeadlineFacts.ts";
import { toBoardHeadlineInput } from "../boardHeadlineInput.ts";
import { buildOfflineBoardHeadlineView } from "../offlineBoardHeadline.ts";
import { normalizeLiveHookPayload, parseLiveHookPayload } from "../liveHookAdapter.ts";

describe("liveHookAdapter task preview", () => {
  test("Claude-like UserPromptSubmit summary includes task snippet, not only event name", () => {
    const event = normalizeLiveHookPayload(
      {
        hookEventName: "UserPromptSubmit",
        sessionId: "claude-task-preview-session",
        cwd: "/tmp/masthead-live-fixture",
        timestamp: "2026-07-05T12:00:00.000Z",
        prompt: "Implement Logbook pagination spacing"
      },
      { receivedAt: "2026-07-05T12:00:01.000Z", runtime: "claude_code" }
    );

    expect(event.type).toBe("user.response");
    expect(event.summary).toMatch(/Logbook|pagination/i);
    expect(event.summary).not.toMatch(/^Claude Code:\s*User Prompt Submit$/i);
    // Full prompt stays out of general payload fields.
    expect(JSON.stringify(event.payload)).not.toContain("Implement Logbook pagination spacing");
    expect(event.payload).toHaveProperty("promptSummary");
  });

  test("Cursor-like beforeSubmitPrompt summary carries privacy-safe task preview", () => {
    const event = normalizeLiveHookPayload(
      {
        hookEventName: "beforeSubmitPrompt",
        sessionId: "cursor-task-preview-session",
        cwd: "/tmp/masthead-live-fixture",
        timestamp: "2026-07-05T12:00:01.000Z",
        prompt: "Implement Logbook pagination spacing for the artifact table"
      },
      { receivedAt: "2026-07-05T12:00:02.000Z", runtime: "cursor" }
    );

    expect(event.type).toBe("user.response");
    expect(event.summary).toMatch(/Logbook|pagination/i);
    expect(event.summary.length).toBeLessThanOrEqual(80);
  });

  test("Codex-like user prompt submit summary is task-specific", () => {
    const parsed = parseLiveHookPayload(
      JSON.stringify({
        event: "UserPromptSubmit",
        session_id: "codex-task-preview-session",
        cwd: "/tmp/masthead-live-fixture",
        timestamp: "2026-07-05T12:00:00.000Z",
        prompt: "Implement Logbook pagination spacing"
      }),
      { receivedAt: "2026-07-05T12:00:01.000Z", runtime: "codex" }
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event.summary).toMatch(/Logbook|pagination/i);
  });

  test("sensitive prompt tokens and password-like text do not leak into summary", () => {
    const event = normalizeLiveHookPayload(
      {
        hookEventName: "UserPromptSubmit",
        sessionId: "claude-secret-preview-session",
        cwd: "/tmp/masthead-live-fixture",
        timestamp: "2026-07-05T12:00:00.000Z",
        prompt: "Deploy with sk-abcdefghijklmnopqrstuvwxyz012345 and password=super-secret-value to staging"
      },
      { receivedAt: "2026-07-05T12:00:01.000Z", runtime: "claude_code" }
    );

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(serialized).not.toContain("super-secret-value");
    expect(event.summary).not.toMatch(/\bsk-[A-Za-z0-9_-]+\b/);
    expect(event.summary.toLowerCase()).not.toContain("super-secret-value");
  });

  test("long prompts are truncated to a short privacy-safe preview", () => {
    const longPrompt =
      "Implement Logbook pagination spacing so the dense artifact capsule table no longer overflows the inspector rail on narrow desktop widths when many dossiers are open at once and the provenance panel is expanded";
    const event = normalizeLiveHookPayload(
      {
        hookEventName: "UserPromptSubmit",
        sessionId: "claude-long-preview-session",
        cwd: "/tmp/masthead-live-fixture",
        timestamp: "2026-07-05T12:00:00.000Z",
        prompt: longPrompt
      },
      { receivedAt: "2026-07-05T12:00:01.000Z", runtime: "claude_code" }
    );

    expect(event.summary).toMatch(/Logbook|pagination/i);
    // Must fit safeFactLabel (≤80) so title → facts keeps the preview.
    expect(event.summary.length).toBeLessThanOrEqual(80);
    expect(event.summary).not.toBe(longPrompt);
    expect(JSON.stringify(event.payload)).not.toContain(longPrompt);
  });

  test("URLs in prompts are redacted out of the task preview", () => {
    const event = normalizeLiveHookPayload(
      {
        hookEventName: "UserPromptSubmit",
        sessionId: "claude-url-preview-session",
        cwd: "/tmp/masthead-live-fixture",
        timestamp: "2026-07-05T12:00:00.000Z",
        prompt: "Fix Logbook pagination using docs at https://internal.example.com/api/v1/secret-path?token=abc"
      },
      { receivedAt: "2026-07-05T12:00:01.000Z", runtime: "claude_code" }
    );

    expect(event.summary).toMatch(/Logbook|pagination/i);
    expect(event.summary).not.toMatch(/\bhttps?:\/\//i);
    expect(event.summary).not.toContain("internal.example.com");
    expect(event.summary).not.toContain("secret-path");
    expect(JSON.stringify(event)).not.toContain("https://internal.example.com/api/v1/secret-path?token=abc");
  });

  test("session.started with first user prompt promotes preview into session title", () => {
    const event = normalizeLiveHookPayload(
      {
        hookEventName: "SessionStart",
        sessionId: "claude-session-start-preview",
        cwd: "/tmp/masthead-live-fixture",
        timestamp: "2026-07-05T12:00:00.000Z",
        prompt: "Implement Logbook pagination spacing"
      },
      { receivedAt: "2026-07-05T12:00:01.000Z", runtime: "claude_code" }
    );

    expect(event.type).toBe("session.started");
    expect(event.summary).toMatch(/Logbook|pagination/i);

    const sessions = deriveSessions([event], [], { now: new Date("2026-07-05T12:05:00.000Z") });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.title).toMatch(/Logbook|pagination|Implement/i);
    expect(sessions[0]!.title.toLowerCase()).not.toBe("masthead-live-fixture session");
  });

  test("live user-prompt fixture feeds offline subject beyond masthead-live-fixture session", () => {
    const event = normalizeLiveHookPayload(
      {
        hookEventName: "UserPromptSubmit",
        sessionId: "live-fixture-subject-session",
        cwd: "/tmp/masthead-live-fixture",
        timestamp: "2026-07-05T12:00:00.000Z",
        prompt: "Implement Logbook pagination spacing"
      },
      { receivedAt: "2026-07-05T12:00:01.000Z", runtime: "claude_code" }
    );

    const sessions = deriveSessions([event], [], { now: new Date("2026-07-05T12:05:00.000Z") });
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;

    const facts = buildBoardHeadlineFacts({
      card: {
        changedFileCount: session.changedFileCount,
        latestFeedbackSignal: undefined,
        lifecycle: session.lifecycle,
        model: undefined,
        primaryStatus: session.primaryStatus,
        project: session.project,
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
    const input = toBoardHeadlineInput({
      lifecycle: session.lifecycle,
      primaryStatus: session.primaryStatus,
      signals: [],
      facts
    });
    const view = buildOfflineBoardHeadlineView(input);
    const subject = view.frame?.subject ?? view.headline;

    expect(subject.toLowerCase()).not.toBe("masthead-live-fixture session");
    expect(subject).toMatch(/Logbook|pagination|Implement/i);
    // Still no unrestricted full prompt dump into headline input payload channels.
    expect(JSON.stringify(event.payload)).not.toContain("Implement Logbook pagination spacing");
  });

  test("long prompt still yields offline subject via safeFactLabel-aligned title", () => {
    const longPrompt =
      "Implement Logbook pagination spacing so the dense artifact capsule table no longer overflows the inspector rail on narrow desktop widths when many dossiers are open at once and the provenance panel is expanded";
    const event = normalizeLiveHookPayload(
      {
        hookEventName: "UserPromptSubmit",
        sessionId: "live-long-subject-session",
        cwd: "/tmp/masthead-live-fixture",
        timestamp: "2026-07-05T12:00:00.000Z",
        prompt: longPrompt
      },
      { receivedAt: "2026-07-05T12:00:01.000Z", runtime: "claude_code" }
    );

    expect(event.summary.length).toBeLessThanOrEqual(80);

    const sessions = deriveSessions([event], [], { now: new Date("2026-07-05T12:05:00.000Z") });
    const session = sessions[0]!;
    // Title must survive safeFactLabel (≤80) into facts.title → subjectCandidates.
    expect(session.title.length).toBeLessThanOrEqual(80);
    expect(session.title).toMatch(/Logbook|pagination|Implement/i);

    const facts = buildBoardHeadlineFacts({
      card: {
        changedFileCount: session.changedFileCount,
        latestFeedbackSignal: undefined,
        lifecycle: session.lifecycle,
        model: undefined,
        primaryStatus: session.primaryStatus,
        project: session.project,
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
    expect(facts.title).toBeTruthy();
    expect(facts.title).toMatch(/Logbook|pagination|Implement/i);
    expect(facts.title!.length).toBeLessThanOrEqual(80);

    const input = toBoardHeadlineInput({
      lifecycle: session.lifecycle,
      primaryStatus: session.primaryStatus,
      signals: [],
      facts
    });
    const view = buildOfflineBoardHeadlineView(input);
    const subject = view.frame?.subject ?? view.headline;
    expect(subject.toLowerCase()).not.toBe("masthead-live-fixture session");
    expect(subject).toMatch(/Logbook|pagination|Implement/i);
  });
});
