import { describe, expect, expectTypeOf, test } from "vitest";
import type { SessionCardView } from "../types";

describe("board headline view types", () => {
  test("supports SessionCardView headline usage", () => {
    const card: SessionCardView = {
      sessionId: "session-1",
      project: "Masthead",
      title: "Board headline rebuild",
      headline: {
        headline: "Board headlines: structured around subject and outcome.",
        source: "llm",
        status: "ready",
        frame: {
          subject: "Board headlines",
          disposition: "structured around subject and outcome",
          state: "active",
          subjectKind: "feature",
          confidence: "high",
          evidence: ["The latest task asks for frame-based Board headlines."]
        }
      },
      stateLabel: "Running",
      primaryStatus: "editing",
      lifecycle: "running",
      priorityRank: 50,
      durationLabel: "4m",
      lastActivity: "2026-07-01T12:00:00.000Z",
      lastActivityLabel: "1m ago",
      changedFileCount: 0,
      indicators: [],
      identityConfidence: "direct",
      safeActions: ["open_source_session"],
      isExpanded: false
    };

    expectTypeOf<SessionCardView>().toHaveProperty("headline");
    expect(card.headline.headline).toContain(":");
  });
});
