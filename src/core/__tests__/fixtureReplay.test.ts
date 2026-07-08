import { describe, expect, test } from "vitest";
import fixture from "../../../fixtures/v0/replay-three-sessions-board.json";
import { projectFixture } from "../replay";
import type { FixtureReplay } from "../types";

describe("fixture replay vertical slice", () => {
  test("projects a live board with sessions, attention, conflict evidence, and safe actions", () => {
    const board = projectFixture(fixture as FixtureReplay);

    // Live-state semantics: summary.active is the Running lane only and requires fresh
    // working proof (live-state report or recent command.started / turn.started /
    // user.response). This static fixture has multi-minute event/snapshot gaps and no
    // live-state reports, so all three non-ended sessions correctly land in Idle.
    expect(board.summary.active).toBe(0);
    expect(board.summary.running).toBe(0);
    expect(board.summary.idle).toBe(3);
    expect(board.summary.needsAttention).toBeGreaterThanOrEqual(2);
    expect(board.summary.conflicts).toBe(1);
    expect(board.cards).toHaveLength(3);
    expect(board.cards.every((card) => card.lifecycle !== "ended")).toBe(true);
    expect(board.cards.every((card) => card.displayState === "idle")).toBe(true);
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
