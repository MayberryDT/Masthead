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
            copy: {
              headline: "Auth work",
              status: "Tests need another look.",
              reason: "A failed test signal is visible.",
              source: "deterministic"
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
    copy: {
      headline: "Session activity",
      status: "Work is active.",
      reason: "No blocker is visible.",
      source: "deterministic"
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
