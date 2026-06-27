import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { SessionDetailView } from "../../core/types";
import { SessionInspector } from "../SessionInspector";

describe("SessionInspector", () => {
  test("renders an empty inspector state when nothing is selected", () => {
    const html = renderToStaticMarkup(<SessionInspector session={undefined} />);

    expect(html).toContain("Select a session");
    expect(html).toContain("Technical details appear here");
  });

  test("renders technical detail for the selected session", () => {
    const html = renderToStaticMarkup(<SessionInspector session={session()} />);

    expect(html).toContain("Still running");
    expect(html).toContain("Session brief");
    expect(html).toContain("Runtime");
    expect(html).toContain("Model");
    expect(html).toContain("Thinking");
    expect(html).toContain("High");
    expect(html).toContain("Evidence health");
    expect(html).toContain("1 observed");
    expect(html).toContain("Worktree");
    expect(html).toContain("Latest agent feedback");
    expect(html).toContain("Implementation is complete, but auth tests are still failing.");
    expect(html).toContain("1 timeline events");
    expect(html).toContain("Open Codex");
  });

  test("does not render conflict-only running attention as a blocked token", () => {
    const html = renderToStaticMarkup(
      <SessionInspector
        session={session({
          indicators: ["attention", "conflict"],
          primaryStatus: "editing",
          lifecycle: "running",
          attentionItems: [
            {
              itemId: "attention-1",
              sessionId: "session-1",
              project: "Masthead",
              type: "conflict",
              severity: "P1",
              title: "Same tracked path changed by 2 active sessions",
              createdAt: "2026-06-23T02:04:00.000Z",
              affectedPaths: ["src/shared.ts"],
              affectedCommandIds: [],
              evidence: [],
              support: "deterministic",
              suggestedNextAction: "Review the overlapping diff."
            }
          ]
        })}
      />
    );

    expect(html).toContain(">Active<");
    expect(html).not.toContain(">Blocked<");
    expect(html).not.toContain("state-token attention");
  });
});

function session(overrides: Partial<SessionDetailView> = {}): SessionDetailView {
  return {
    sessionId: "session-1",
    project: "Masthead",
    title: "Raw selected title",
    copy: {
      headline: "Still running",
      status: "Tests need another look.",
      reason: "A failed test signal is visible.",
      source: "deterministic"
    },
    stateLabel: "Running",
    primaryStatus: "editing",
    lifecycle: "running",
    priorityRank: 10,
    durationLabel: "4m",
    model: "gpt-5.5",
    thinkingLevel: "High",
    harness: "Codex",
    startedAt: "2026-06-23T02:00:00.000Z",
    branchOrWorktree: "agent/test",
    lastActivity: "2026-06-23T02:04:00.000Z",
    lastActivityLabel: "0s ago",
    changedFileCount: 1,
    indicators: ["attention"],
    identityConfidence: "direct",
    safeActions: ["open_source_session"],
    isExpanded: true,
    currentActivity: "Running",
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
    reviewAnnotations: [],
    evidence: {
      observed: [{ id: "event-1", kind: "event", observedAt: "2026-06-23T02:04:00.000Z", source: "codex.fixture" }],
      inferred: [],
      missing: []
    },
    conflicts: [],
    attentionItems: [],
    timeline: [
      { eventId: "event-1", type: "file.changed", occurredAt: "2026-06-23T02:04:00.000Z", summary: "File changed" }
    ],
    ...overrides
  };
}
