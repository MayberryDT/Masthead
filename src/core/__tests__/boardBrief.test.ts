import { describe, expect, test } from "vitest";
import { buildBoardBrief } from "../boardBrief";
import type { AttentionItem, LiveBoardProjection, SessionCardView } from "../types";

describe("board brief", () => {
  test("summarizes intervention-first board state in system-neutral language", () => {
    const brief = buildBoardBrief(
      projection({
        cards: [
          card({ sessionId: "session-approval" }),
          card({ sessionId: "session-failure" }),
          card({ sessionId: "session-conflict" })
        ],
        attentionQueue: [
          attention({ sessionId: "session-approval", type: "approval_requested" }),
          attention({ sessionId: "session-failure", type: "command_failed" })
        ],
        conflicts: [
          {
            conflictId: "conflict-1",
            type: "exact_file_overlap",
            severity: "high",
            sessionIds: ["session-conflict", "session-other"],
            repo: { gitCommonDir: "/workspace/app/.git", worktreePaths: ["/workspace/app"] },
            sharedPaths: ["src/app.ts"],
            attribution: "direct",
            title: "Same file changed",
            evidence: []
          }
        ]
      })
    );

    expect(brief).toEqual({
      text: "Approval is pending in one active session. Failed command evidence is visible in one session. Overlapping work is visible in one session. Three sessions are running overall.",
      source: "deterministic",
      priority: "attention"
    });
    expect(brief.text).not.toMatch(/\b(you|your|urgent|critical|dangerous|please|let's|i recommend|i finished|we need)\b/i);
  });

  test("does not describe command failures as approvals", () => {
    const brief = buildBoardBrief(
      projection({
        cards: [card()],
        attentionQueue: [attention({ type: "command_failed" })]
      })
    );

    expect(brief.text).toContain("Failed command evidence is visible in one session.");
    expect(brief.text).not.toMatch(/approval|review/i);
  });

  test("describes user questions as input rather than approval", () => {
    const brief = buildBoardBrief(
      projection({
        cards: [card()],
        attentionQueue: [attention({ type: "user_question" })]
      })
    );

    expect(brief.text).toContain("Input is pending in one active session.");
    expect(brief.text).not.toMatch(/approval/i);
  });

  test("describes empty boards without stale live-session language", () => {
    const brief = buildBoardBrief(projection({ cards: [], attentionQueue: [] }));

    expect(brief.text).toBe("No sessions are running overall.");
    expect(brief.priority).toBe("normal");
  });
});

function projection(overrides: Partial<Pick<LiveBoardProjection, "cards" | "attentionQueue" | "conflicts">> = {}): Pick<LiveBoardProjection, "summary" | "cards" | "attentionQueue" | "conflicts"> {
  const cards = overrides.cards ?? [card()];
  return {
    summary: {
      active: cards.length,
      needsAttention: overrides.attentionQueue?.length ?? 0,
      conflicts: overrides.conflicts?.length ?? 0,
      completed: 0,
      running: cards.filter((item) => item.lifecycle === "running").length,
      idle: cards.filter((item) => item.lifecycle === "idle").length,
      needsAction: 0
    },
    cards,
    attentionQueue: overrides.attentionQueue ?? [],
    conflicts: overrides.conflicts ?? []
  };
}

function card(overrides: Partial<SessionCardView> = {}): SessionCardView {
  return {
    sessionId: "session-1",
    project: "App",
    title: "Session title",
    copy: {
      headline: "Session activity",
      status: "Work is active.",
      reason: "This session is active.",
      source: "deterministic"
    },
    stateLabel: "Running",
    primaryStatus: "editing",
    lifecycle: "running",
    priorityRank: 50,
    durationLabel: "4m",
    branchOrWorktree: "local",
    lastActivity: "2026-06-23T02:00:00.000Z",
    lastActivityLabel: "1m ago",
    changedFileCount: 0,
    indicators: [],
    identityConfidence: "direct",
    safeActions: ["open_source_session"],
    isExpanded: false,
    ...overrides
  };
}

function attention(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    itemId: "attention-1",
    sessionId: "session-1",
    project: "App",
    type: "approval_requested",
    severity: "P1",
    title: "Approval requested",
    createdAt: "2026-06-23T02:00:00.000Z",
    affectedPaths: [],
    affectedCommandIds: [],
    evidence: [],
    support: "deterministic",
    suggestedNextAction: "Inspect the request.",
    ...overrides
  };
}
