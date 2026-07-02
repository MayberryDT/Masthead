import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { SessionCardView } from "../../core/types";
import { SessionRail } from "../SessionRail";

describe("SessionRail", () => {
  test("renders calm session navigation without raw technical metadata", () => {
    const html = renderToStaticMarkup(
      <SessionRail
        sourceLabel="Live ingestion"
        summary={{ active: 1, needsAttention: 1, conflicts: 0, completed: 0, running: 1, idle: 0, needsAction: 0 }}
        sessions={[
          session({
            sessionId: "session-1",
            project: "Masthead",
            title: "Fix private branch src/auth/token.ts",
            branchOrWorktree: "agent/private-branch",
            headline: {
              headline: "Auth work",
              frame: {
                subject: "Auth work",
                disposition: "tests need another look",
                state: "needs_verification",
                subjectKind: "test",
                confidence: "high",
                evidence: ["A failed test signal is visible."]
              },
              source: "llm",
              status: "ready"
            }
          })
        ]}
        selectedSessionId="session-1"
        onSelectSession={() => undefined}
      />
    );

    expect(html).toContain("Live ingestion");
    expect(html).toContain("1 active");
    expect(html).toContain("1 needs attention");
    expect(html).toContain("Auth work");
    expect(html).toContain("Tests need another look.");
    expect(html).toContain('aria-current="true"');
    expect(html).not.toContain("Fix private branch");
    expect(html).not.toContain("src/auth/token.ts");
    expect(html).not.toContain("agent/private-branch");
  });
});

function session(overrides: Partial<SessionCardView> = {}): SessionCardView {
  return {
    sessionId: "session-1",
    project: "Masthead",
    title: "Raw title",
    headline: {
      headline: "Session activity",
      frame: {
        subject: "Session activity",
        disposition: "work is active",
        state: "active",
        subjectKind: "unknown",
        confidence: "low",
        evidence: ["No blocker is visible."]
      },
      source: "llm",
      status: "ready"
    },
    stateLabel: "Running",
    primaryStatus: "editing",
    lifecycle: "running",
    priorityRank: 10,
    durationLabel: "4m",
    branchOrWorktree: "local",
    lastActivity: "2026-06-23T02:04:00.000Z",
    lastActivityLabel: "0s ago",
    changedFileCount: 1,
    indicators: ["attention"],
    identityConfidence: "direct",
    safeActions: ["open_source_session"],
    isExpanded: false,
    ...overrides
  };
}
