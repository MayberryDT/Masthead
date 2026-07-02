import { describe, expect, test } from "vitest";
import { buildObservabilityDemoBoard, observabilitySessionTotal } from "../observabilityDemoBoard";

describe("observability demo board", () => {
  test("provides the screenshot-scale summary and representative card set", () => {
    const board = buildObservabilityDemoBoard();

    expect(board.summary).toMatchObject({
      running: 16,
      idle: 5,
      needsAction: 3
    });
    expect(observabilitySessionTotal(board.summary)).toBe(24);
    expect(board.cards).toHaveLength(9);
    expect(board.cards.map((card) => card.headline.headline)).toEqual([
      "Refactored auth flow and added token refresh logic",
      "Implemented payment service and webhook handler",
      "Fixed session timeout edge case in middleware",
      "Generate unit tests for billing service",
      "Update API docs and add usage examples",
      "Refactor data access layer and add caching",
      "Investigated memory leak in cache service",
      "Deployment failed due to migration error",
      "External API rate limit exceeded"
    ]);
    expect(board.attentionQueue).toHaveLength(3);
  });

  test("can synthesize details for a selected demo session", () => {
    const board = buildObservabilityDemoBoard("session-0f9c2e6d");

    expect(board.selectedSession).toMatchObject({
      sessionId: "session-0f9c2e6d",
      currentActivity: "Timeout waiting for response"
    });
  });
});
