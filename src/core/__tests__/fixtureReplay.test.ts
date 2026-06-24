import { describe, expect, test } from "vitest";
import fixture from "../../../fixtures/v0/replay-three-sessions-board.json";
import { projectFixture } from "../replay";
import type { FixtureReplay } from "../types";

describe("fixture replay vertical slice", () => {
  test("projects a live board with sessions, attention, conflict evidence, and safe actions", () => {
    const board = projectFixture(fixture as FixtureReplay);

    expect(board.summary.active).toBeGreaterThanOrEqual(3);
    expect(board.summary.needsAttention).toBeGreaterThanOrEqual(2);
    expect(board.summary.conflicts).toBe(1);
    expect(board.cards).toHaveLength(3);
    expect(board.cards[0]?.indicators).toContain("attention");
    expect(board.attentionQueue.some((item) => item.type === "approval_requested")).toBe(true);
    expect(board.conflicts[0]).toMatchObject({
      type: "exact_file_overlap",
      severity: "high",
      sharedPaths: ["src/lib/auth/session.ts"]
    });

    const renderedActions = board.cards.flatMap((card) => card.safeActions);
    expect(renderedActions).toContain("open_source_session");
    expect(renderedActions).toContain("open_readonly_diff");
    expect(renderedActions).not.toContain("approve_codex_request");
    expect(renderedActions).not.toContain("run_shell_command");
    expect(renderedActions).not.toContain("git_commit");
  });
});
