import { describe, expect, test } from "vitest";
import { filterAttentionItemsForCards, filterCards, mainScanCards, summarizeMainScanCards } from "../filterBoard";
import { HARNESS_OPTIONS } from "../toolbarOptions";
import type { AttentionItem, SessionCardView } from "../../core/types";

const baseCard: SessionCardView = {
  sessionId: "s1",
  project: "Auth",
  title: "Fix callback",
  headline: {
    headline: "Still running",
    frame: {
      subject: "Auth callback",
      disposition: "paused for a decision on approval",
      state: "waiting",
      subjectKind: "feature",
      confidence: "high",
      evidence: ["Open the session when you want to review it."]
    },
    source: "llm",
    status: "ready"
  },
  stateLabel: "Waiting For Approval",
  primaryStatus: "waiting_for_approval",
  lifecycle: "running",
  priorityRank: 1,
  durationLabel: "5m",
  branchOrWorktree: "auth/callback",
  lastActivity: "2026-06-22T20:00:00.000Z",
  lastActivityLabel: "5m ago",
  changedFileCount: 2,
  attentionReason: "Approval requested",
  indicators: ["attention"],
  identityConfidence: "direct",
  safeActions: ["open_source_session"],
  isExpanded: false
};

describe("board card filtering", () => {
  test("matches project, branch, status, title, and attention reason text", () => {
    const cards = [
      baseCard,
      {
        ...baseCard,
        sessionId: "s2",
        project: "Imports",
        title: "Rebuild importer",
        headline: {
          headline: "Still running",
          frame: {
            subject: "Importer",
            disposition: "checking the work in tests",
            state: "active",
            subjectKind: "import",
            confidence: "high",
            evidence: []
          },
          source: "llm",
          status: "ready"
        },
        stateLabel: "Testing",
        primaryStatus: "testing",
        branchOrWorktree: "imports/batch",
        attentionReason: undefined,
        indicators: [],
        priorityRank: 50
      }
    ] satisfies SessionCardView[];

    expect(filterCards(cards, { query: "auth", filter: "all" }).map((card) => card.sessionId)).toEqual(["s1"]);
    expect(filterCards(cards, { query: "batch", filter: "all" }).map((card) => card.sessionId)).toEqual(["s2"]);
    expect(filterCards(cards, { query: "waiting", filter: "all" }).map((card) => card.sessionId)).toEqual(["s1"]);
    expect(filterCards(cards, { query: "approval", filter: "all" }).map((card) => card.sessionId)).toEqual(["s1"]);
    expect(filterCards(cards, { query: "paused", filter: "all" }).map((card) => card.sessionId)).toEqual(["s1"]);
  });

  test("filters cards by unresolved attention and conflict indicators", () => {
    const cards = [
      baseCard,
      { ...baseCard, sessionId: "s2", indicators: ["conflict"], attentionReason: undefined },
      { ...baseCard, sessionId: "s3", indicators: [], attentionReason: undefined }
    ] satisfies SessionCardView[];

    expect(filterCards(cards, { query: "", filter: "needs_attention" }).map((card) => card.sessionId)).toEqual(["s1"]);
    expect(filterCards(cards, { query: "", filter: "conflicts" }).map((card) => card.sessionId)).toEqual(["s2"]);
  });

  test("matches work-area labels and path clusters", () => {
    const card = {
      ...baseCard,
      project: "Billing",
      title: "Session work",
      branchOrWorktree: "main",
      headline: {
        headline: "Work is active",
        frame: {
          subject: "OAuth callback",
          disposition: "active with no visible blocker",
          state: "active",
          subjectKind: "feature",
          confidence: "high",
          evidence: []
        },
        source: "llm",
        status: "ready"
      },
      workContext: {
        label: "OAuth callback work",
        confidence: "title",
        pathClusters: ["auth"],
        sourceSignals: ["Fix Google OAuth callback"]
      }
    } satisfies SessionCardView;

    expect(filterCards([card], { query: "oauth callback", filter: "all" })).toHaveLength(1);
    expect(filterCards([card], { query: "auth", filter: "all" })).toHaveLength(1);
  });

  test("filters attention items to the visible session cards", () => {
    const items = [
      attention({ itemId: "attention-1", sessionId: "s1" }),
      attention({ itemId: "attention-2", sessionId: "s2" })
    ];

    expect(filterAttentionItemsForCards(items, [{ sessionId: "s2" }])).toEqual([items[1]]);
  });

  test("filters cards by lifecycle dropdown", () => {
    const cards = [
      { ...baseCard, sessionId: "active", lifecycle: "running", primaryStatus: "editing", indicators: [] },
      { ...baseCard, sessionId: "idle", lifecycle: "idle", primaryStatus: "stalled", indicators: [] },
      { ...baseCard, sessionId: "blocked", lifecycle: "running", primaryStatus: "blocked", indicators: ["attention"] }
    ] satisfies SessionCardView[];

    expect(
      filterCards(cards, { query: "", filter: "all", harness: "all", lifecycle: "running", sort: "recent_activity" }).map(
        (card) => card.sessionId
      )
    ).toEqual(["active"]);
    expect(
      filterCards(cards, { query: "", filter: "all", harness: "all", lifecycle: "idle", sort: "recent_activity" }).map(
        (card) => card.sessionId
      )
    ).toEqual(["idle"]);
    expect(
      filterCards(cards, { query: "", filter: "all", harness: "all", lifecycle: "blocked", sort: "recent_activity" }).map(
        (card) => card.sessionId
      )
    ).toEqual(["blocked"]);
  });

  test("does not count conflict-only, failed, or approval-waiting cards as blocked", () => {
    const cards = [
      { ...baseCard, sessionId: "active", lifecycle: "running", primaryStatus: "editing", indicators: [] },
      {
        ...baseCard,
        sessionId: "conflict-only",
        lifecycle: "running",
        primaryStatus: "editing",
        indicators: ["attention", "conflict"],
        attentionReason: "Same tracked path changed by 2 active sessions"
      },
      { ...baseCard, sessionId: "failed", lifecycle: "running", primaryStatus: "failed", indicators: ["attention"] },
      { ...baseCard, sessionId: "blocked", lifecycle: "running", primaryStatus: "blocked", indicators: ["attention"] },
      { ...baseCard, sessionId: "approval", lifecycle: "running", primaryStatus: "waiting_for_approval", indicators: ["attention"] }
    ] satisfies SessionCardView[];

    expect(
      filterCards(cards, { query: "", filter: "all", harness: "all", lifecycle: "blocked", sort: "recent_activity" }).map(
        (card) => card.sessionId
      )
    ).toEqual(["blocked"]);

    expect(summarizeMainScanCards(cards)).toMatchObject({
      running: 4,
      active: 4,
      needsAction: 1,
      needsAttention: 1
    });
  });

  test("filters cards only by valid supported harness options and does not infer missing harnesses", () => {
    expect(HARNESS_OPTIONS.map((option) => option.value)).toEqual([
      "all",
      "codex",
      "cursor",
      "claude_code",
      "opencode",
      "grok",
      "hermes",
      "pi",
      "omp"
    ]);
    expect(HARNESS_OPTIONS.some((option) => String(option.value) === "legacy_harness")).toBe(false);

    const cards = [
      { ...baseCard, sessionId: "by-runtime", runtime: "opencode", harness: undefined },
      { ...baseCard, sessionId: "by-label", runtime: undefined, harness: "OpenCode" },
      { ...baseCard, sessionId: "missing-harness", runtime: undefined, harness: undefined }
    ] satisfies SessionCardView[];

    expect(
      filterCards(cards, { query: "", filter: "all", harness: "opencode", lifecycle: "all", sort: "recent_activity" }).map(
        (card) => card.sessionId
      )
    ).toEqual(["by-label", "by-runtime"]);
  });

  test("sorts cards by recently started when selected", () => {
    const cards = [
      { ...baseCard, sessionId: "old-start", startedAt: "2026-06-24T06:00:00.000Z", lastActivity: "2026-06-24T07:59:00.000Z" },
      { ...baseCard, sessionId: "new-start", startedAt: "2026-06-24T07:00:00.000Z", lastActivity: "2026-06-24T07:30:00.000Z" }
    ] satisfies SessionCardView[];

    expect(
      filterCards(cards, { query: "", filter: "all", harness: "all", lifecycle: "all", sort: "recently_started" }).map(
        (card) => card.sessionId
      )
    ).toEqual(["new-start", "old-start"]);
  });

  test("sorts by operational priority by default", () => {
    const cards = [
      {
        ...baseCard,
        sessionId: "newer-idle",
        lifecycle: "idle",
        primaryStatus: "stalled",
        indicators: [],
        lastActivity: "2026-06-24T07:59:00.000Z",
        priorityRank: 50
      },
      {
        ...baseCard,
        sessionId: "older-blocked",
        lifecycle: "running",
        primaryStatus: "blocked",
        indicators: ["attention"],
        lastActivity: "2026-06-24T06:00:00.000Z",
        priorityRank: 5
      },
      {
        ...baseCard,
        sessionId: "active",
        lifecycle: "running",
        primaryStatus: "editing",
        indicators: [],
        lastActivity: "2026-06-24T07:30:00.000Z",
        priorityRank: 10
      }
    ] satisfies SessionCardView[];

    expect(filterCards(cards, { query: "", filter: "all", harness: "all", lifecycle: "all" }).map((card) => card.sessionId)).toEqual([
      "older-blocked",
      "active",
      "newer-idle"
    ]);
  });

  test("keeps recent activity as a pure recency sort when selected", () => {
    const cards = [
      {
        ...baseCard,
        sessionId: "older-blocked",
        lifecycle: "running",
        primaryStatus: "blocked",
        indicators: ["attention"],
        lastActivity: "2026-06-24T06:00:00.000Z",
        priorityRank: 1
      },
      {
        ...baseCard,
        sessionId: "newer-idle",
        lifecycle: "idle",
        primaryStatus: "stalled",
        indicators: [],
        lastActivity: "2026-06-24T07:59:00.000Z",
        priorityRank: 50
      }
    ] satisfies SessionCardView[];

    expect(
      filterCards(cards, { query: "", filter: "all", harness: "all", lifecycle: "all", sort: "recent_activity" }).map(
        (card) => card.sessionId
      )
    ).toEqual(["newer-idle", "older-blocked"]);
  });

  test("sorts by recency inside operational priority buckets", () => {
    const cards = [
      {
        ...baseCard,
        sessionId: "older-active",
        lifecycle: "running",
        primaryStatus: "editing",
        indicators: [],
        lastActivity: "2026-06-24T06:00:00.000Z",
        priorityRank: 10
      },
      {
        ...baseCard,
        sessionId: "newer-active",
        lifecycle: "running",
        primaryStatus: "editing",
        indicators: [],
        lastActivity: "2026-06-24T07:00:00.000Z",
        priorityRank: 10
      }
    ] satisfies SessionCardView[];

    expect(
      filterCards(cards, { query: "", filter: "all", harness: "all", lifecycle: "all", sort: "operational_priority" }).map(
        (card) => card.sessionId
      )
    ).toEqual(["newer-active", "older-active"]);
  });

  test("priority mode is blocked, then active, then idle, each by most recent activity", () => {
    const cards = [
      {
        ...baseCard,
        sessionId: "old-idle",
        lifecycle: "idle",
        primaryStatus: "stalled",
        lastActivity: "2026-06-24T07:00:00.000Z",
        priorityRank: 1
      },
      {
        ...baseCard,
        sessionId: "new-idle",
        lifecycle: "idle",
        primaryStatus: "stalled",
        lastActivity: "2026-06-24T08:00:00.000Z",
        priorityRank: 99
      },
      {
        ...baseCard,
        sessionId: "old-active",
        lifecycle: "running",
        primaryStatus: "editing",
        lastActivity: "2026-06-24T06:00:00.000Z",
        priorityRank: 1
      },
      {
        ...baseCard,
        sessionId: "new-active",
        lifecycle: "running",
        primaryStatus: "editing",
        lastActivity: "2026-06-24T07:30:00.000Z",
        priorityRank: 50
      },
      {
        ...baseCard,
        sessionId: "old-blocked",
        lifecycle: "running",
        primaryStatus: "blocked",
        lastActivity: "2026-06-24T05:00:00.000Z",
        priorityRank: 1
      },
      {
        ...baseCard,
        sessionId: "new-blocked",
        lifecycle: "running",
        primaryStatus: "blocked",
        lastActivity: "2026-06-24T07:45:00.000Z",
        priorityRank: 50
      }
    ] satisfies SessionCardView[];

    expect(
      filterCards(cards, { query: "", filter: "all", harness: "all", lifecycle: "all", sort: "operational_priority" }).map(
        (card) => card.sessionId
      )
    ).toEqual(["new-blocked", "old-blocked", "new-active", "old-active", "new-idle", "old-idle"]);
  });

  test("attention indicators alone do not outrank active sessions in priority mode", () => {
    const cards = [
      {
        ...baseCard,
        sessionId: "idle-attention",
        lifecycle: "idle",
        primaryStatus: "stalled",
        indicators: ["attention"],
        lastActivity: "2026-06-24T08:00:00.000Z",
        priorityRank: 1
      },
      {
        ...baseCard,
        sessionId: "active",
        lifecycle: "running",
        primaryStatus: "editing",
        indicators: [],
        lastActivity: "2026-06-24T07:00:00.000Z",
        priorityRank: 50
      }
    ] satisfies SessionCardView[];

    expect(
      filterCards(cards, { query: "", filter: "all", harness: "all", lifecycle: "all", sort: "operational_priority" }).map(
        (card) => card.sessionId
      )
    ).toEqual(["active", "idle-attention"]);
  });

  test("main scan window filters by last activity across visible scan cards", () => {
    const cards = [
      { ...baseCard, sessionId: "inside", lastActivity: "2026-06-24T07:30:00.000Z" },
      { ...baseCard, sessionId: "outside", lastActivity: "2026-06-24T05:59:00.000Z" }
    ] satisfies SessionCardView[];

    const scanCards = mainScanCards(cards, {
      now: new Date("2026-06-24T08:00:00.000Z"),
      activityWindowMs: 60 * 60_000
    });

    expect(scanCards.map((card) => card.sessionId)).toEqual(["inside"]);
  });

  test("main scan cards show recent non-active sessions as idle", () => {
    const cards = [
      { ...baseCard, lastActivity: "2026-06-23T19:59:00.000Z" },
      {
        ...baseCard,
        sessionId: "s2",
        lifecycle: "idle",
        primaryStatus: "stalled",
        lastActivity: "2026-06-23T18:00:00.000Z",
        indicators: []
      },
      {
        ...baseCard,
        sessionId: "s3",
        lifecycle: "ended",
        primaryStatus: "completed_unreviewed",
        outcomeLabel: "completed",
        endReason: "completed",
        stateLabel: "Completed",
        lastActivity: "2026-06-23T20:00:00.000Z",
        lastActivityLabel: "12h ago",
        indicators: ["attention", "verification"]
      },
      {
        ...baseCard,
        sessionId: "s4",
        lifecycle: "ended",
        primaryStatus: "completed_unreviewed",
        outcomeLabel: "completed",
        endReason: "completed",
        stateLabel: "Completed",
        lastActivity: "2026-06-23T07:59:00.000Z",
        lastActivityLabel: "24h ago",
        indicators: []
      }
    ] satisfies SessionCardView[];

    const scanCards = mainScanCards(cards, { now: new Date("2026-06-24T08:00:00.000Z") });

    expect(scanCards.map((card) => card.sessionId)).toEqual(["s3", "s1", "s2"]);
    expect(scanCards.find((card) => card.sessionId === "s3")).toMatchObject({
      lifecycle: "idle",
      primaryStatus: "stalled",
      stateLabel: "Idle",
      indicators: []
    });
  });

  test("main scan cards sort by most recent activity", () => {
    const cards = [
      {
        ...baseCard,
        sessionId: "older-active",
        lifecycle: "running",
        lastActivity: "2026-06-24T06:00:00.000Z",
        lastActivityLabel: "2h ago"
      },
      {
        ...baseCard,
        sessionId: "newer-idle",
        lifecycle: "ended",
        primaryStatus: "completed_unreviewed",
        outcomeLabel: "completed",
        endReason: "completed",
        stateLabel: "Completed",
        lastActivity: "2026-06-24T07:45:00.000Z",
        lastActivityLabel: "15m ago",
        indicators: ["attention"]
      },
      {
        ...baseCard,
        sessionId: "newest-active",
        lifecycle: "running",
        lastActivity: "2026-06-24T07:59:00.000Z",
        lastActivityLabel: "1m ago"
      }
    ] satisfies SessionCardView[];

    const scanCards = mainScanCards(cards, { now: new Date("2026-06-24T08:00:00.000Z") });

    expect(scanCards.map((card) => card.sessionId)).toEqual(["newest-active", "newer-idle", "older-active"]);
    expect(scanCards.find((card) => card.sessionId === "newer-idle")).toMatchObject({
      lifecycle: "idle",
      primaryStatus: "stalled"
    });
  });

  test("main scan summary counts active, idle, and truly blocked visible cards only", () => {
    const cards = [
      { ...baseCard, sessionId: "active", lifecycle: "running", primaryStatus: "editing", indicators: [] },
      { ...baseCard, sessionId: "idle", lifecycle: "idle", primaryStatus: "stalled", indicators: [] },
      { ...baseCard, sessionId: "approval", lifecycle: "running", primaryStatus: "waiting_for_approval", indicators: ["attention"] },
      { ...baseCard, sessionId: "blocked", lifecycle: "running", primaryStatus: "blocked", indicators: ["attention"] }
    ] satisfies SessionCardView[];

    expect(summarizeMainScanCards(cards)).toMatchObject({
      running: 2,
      active: 2,
      idle: 1,
      needsAction: 1,
      needsAttention: 1
    });
  });
});

function attention(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    itemId: "attention-1",
    sessionId: "s1",
    project: "Auth",
    type: "approval_requested",
    severity: "P1",
    title: "Approval requested",
    createdAt: "2026-06-23T02:00:00.000Z",
    affectedPaths: [],
    affectedCommandIds: [],
    evidence: [],
    support: "deterministic",
    suggestedNextAction: "Review the request.",
    ...overrides
  };
}
