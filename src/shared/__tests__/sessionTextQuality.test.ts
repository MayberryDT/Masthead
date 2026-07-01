import { describe, expect, test } from "vitest";
import {
  firstUsefulSessionTitle,
  hasAcceptableDisplayCopy,
  isUsefulSessionTitle,
  isWeakLiveSummary,
  isWeakSessionTitle
} from "../sessionTextQuality.ts";

const context = {
  project: "Masthead",
  sessionId: "session-123",
  sourceSessionId: "source-123"
};

describe("session text quality", () => {
  test("rejects observed weak session titles", () => {
    expect(isWeakSessionTitle("Codex hook event", context)).toBe(true);
    expect(isWeakSessionTitle("Session narrative", context)).toBe(true);
    expect(isWeakSessionTitle("Recent activity", context)).toBe(true);
    expect(isWeakSessionTitle("Masthead session", context)).toBe(true);
    expect(isWeakSessionTitle("Untitled session", context)).toBe(true);
    expect(isWeakSessionTitle("019f1ebf-3f79-75c3-b20a-41de26b0f46e", context)).toBe(true);
    expect(isWeakSessionTitle("Project session for session narrative. Commands: shell.", context)).toBe(true);
    expect(isWeakSessionTitle("Halla session for Codex hook event.", context)).toBe(true);
    expect(isWeakSessionTitle("Project codex hook event", context)).toBe(true);
    expect(isWeakSessionTitle("session narrative is active in this project.", context)).toBe(true);
  });

  test("accepts concrete title candidates", () => {
    expect(isUsefulSessionTitle("Headline refresh data enrichment", context)).toBe(true);
    expect(isUsefulSessionTitle("Repair OAuth callback title quality", context)).toBe(true);
    expect(isUsefulSessionTitle("Session card headline refresh", context)).toBe(true);
    expect(isUsefulSessionTitle("Added v2 session narrative facts, validator, deterministic draft.", context)).toBe(true);
  });

  test("selects the first useful title candidate", () => {
    expect(firstUsefulSessionTitle(["Codex session", undefined, "Headline refresh data enrichment"], context)).toBe(
      "Headline refresh data enrichment"
    );
  });

  test("detects weak review-template live summaries", () => {
    expect(isWeakLiveSummary("Title quality work is ready for review.")).toBe(true);
    expect(isWeakLiveSummary("Fixed mcp for Codex hook event.")).toBe(true);
    expect(isWeakLiveSummary("Headline refresh data enrichment has validation coverage.")).toBe(false);
  });

  test("accepts display copy when either title or headline is useful", () => {
    expect(hasAcceptableDisplayCopy({ headline: "Refactor auth flow", title: "Codex session" }, context)).toBe(true);
    expect(hasAcceptableDisplayCopy({ headline: "Recent activity", title: "Codex session" }, context)).toBe(false);
  });
});
