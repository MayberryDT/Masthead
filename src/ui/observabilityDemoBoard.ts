import type { AttentionItem, ExpandedSessionView, LiveBoardProjection, SessionCardView, SessionDetailView } from "../core/types";

type DemoCardInput = {
  sessionId: string;
  headline: string;
  lifecycle: SessionCardView["lifecycle"];
  primaryStatus: SessionCardView["primaryStatus"];
  stateLabel: string;
  durationLabel: string;
  lastActivity: string;
  lastActivityLabel: string;
  changedFileCount: number;
  priorityRank: number;
  branchOrWorktree: string;
  attentionReason?: string;
  copyReason?: string;
};

const safeActions: SessionCardView["safeActions"] = [
  "open_source_session",
  "open_repo",
  "open_readonly_diff",
  "snooze",
  "dismiss",
  "mark_reviewed",
  "mark_expected"
];

const demoCards: DemoCardInput[] = [
  {
    sessionId: "session-9f3a1c7e",
    headline: "Refactored auth flow and added token refresh logic",
    lifecycle: "running",
    primaryStatus: "editing",
    stateLabel: "Active",
    durationLabel: "8m 42s",
    lastActivity: "2026-06-23T10:24:18.000Z",
    lastActivityLabel: "now",
    changedFileCount: 18,
    priorityRank: 1,
    branchOrWorktree: "auth-refresh"
  },
  {
    sessionId: "session-7b2d9e4a",
    headline: "Implemented payment service and webhook handler",
    lifecycle: "running",
    primaryStatus: "testing",
    stateLabel: "Active",
    durationLabel: "14m 11s",
    lastActivity: "2026-06-23T10:21:03.000Z",
    lastActivityLabel: "2m ago",
    changedFileCount: 42,
    priorityRank: 2,
    branchOrWorktree: "payments-webhooks"
  },
  {
    sessionId: "session-3c6a8f91",
    headline: "Fixed session timeout edge case in middleware",
    lifecycle: "running",
    primaryStatus: "running_command",
    stateLabel: "Active",
    durationLabel: "5m 27s",
    lastActivity: "2026-06-23T10:19:54.000Z",
    lastActivityLabel: "3m ago",
    changedFileCount: 6,
    priorityRank: 3,
    branchOrWorktree: "middleware-timeout"
  },
  {
    sessionId: "session-1a2b3c4d",
    headline: "Generate unit tests for billing service",
    lifecycle: "idle",
    primaryStatus: "stalled",
    stateLabel: "Idle",
    durationLabel: "25m 38s",
    lastActivity: "2026-06-23T09:58:12.000Z",
    lastActivityLabel: "5m 37s ago",
    changedFileCount: 9,
    priorityRank: 10,
    branchOrWorktree: "billing-tests"
  },
  {
    sessionId: "session-8e2b1d3f",
    headline: "Update API docs and add usage examples",
    lifecycle: "idle",
    primaryStatus: "stalled",
    stateLabel: "Idle",
    durationLabel: "18m 52s",
    lastActivity: "2026-06-23T10:02:41.000Z",
    lastActivityLabel: "7m 12s ago",
    changedFileCount: 14,
    priorityRank: 11,
    branchOrWorktree: "api-docs"
  },
  {
    sessionId: "session-2f7e3c11",
    headline: "Refactor data access layer and add caching",
    lifecycle: "idle",
    primaryStatus: "stalled",
    stateLabel: "Idle",
    durationLabel: "1h 02m",
    lastActivity: "2026-06-23T09:47:19.000Z",
    lastActivityLabel: "10m 45s ago",
    changedFileCount: 21,
    priorityRank: 12,
    branchOrWorktree: "data-cache"
  },
  {
    sessionId: "session-0f9c2e6d",
    headline: "Investigated memory leak in cache service",
    lifecycle: "ended",
    primaryStatus: "blocked",
    stateLabel: "Blocked",
    durationLabel: "41m",
    lastActivity: "2026-06-23T10:13:05.000Z",
    lastActivityLabel: "blocked",
    changedFileCount: 3,
    priorityRank: 20,
    branchOrWorktree: "cache-memory",
    attentionReason: "Timeout waiting for response",
    copyReason: "The session is blocked waiting for a response from the cache service."
  },
  {
    sessionId: "session-9c1d2e33",
    headline: "Deployment failed due to migration error",
    lifecycle: "ended",
    primaryStatus: "blocked",
    stateLabel: "Blocked",
    durationLabel: "37m",
    lastActivity: "2026-06-23T10:07:22.000Z",
    lastActivityLabel: "blocked",
    changedFileCount: 7,
    priorityRank: 21,
    branchOrWorktree: "deploy-migrations",
    attentionReason: "Migration step failed",
    copyReason: "Deployment stopped because a migration failed."
  },
  {
    sessionId: "session-6d4a9e0f",
    headline: "External API rate limit exceeded",
    lifecycle: "ended",
    primaryStatus: "blocked",
    stateLabel: "Blocked",
    durationLabel: "29m",
    lastActivity: "2026-06-23T09:56:11.000Z",
    lastActivityLabel: "blocked",
    changedFileCount: 2,
    priorityRank: 22,
    branchOrWorktree: "external-api",
    attentionReason: "Rate limit exceeded (429)",
    copyReason: "The integration is blocked by a provider rate limit."
  }
];

export function buildObservabilityDemoBoard(selectedSessionId?: string | null): LiveBoardProjection {
  const cards = demoCards.map(toCard);
  const attentionQueue = cards.filter((card) => card.primaryStatus === "blocked").map(toAttentionItem);
  const selectedCard = selectedSessionId ? cards.find((card) => card.sessionId === selectedSessionId) : undefined;
  const expandedSession = toExpandedSession(cards[0], attentionQueue);

  return {
    summary: {
      active: 16,
      needsAttention: 3,
      conflicts: 0,
      completed: 0,
      running: 16,
      idle: 5,
      needsAction: 3
    },
    lanes: [
      { laneId: "running", title: "Running", count: 3, sessionIds: cards.filter((card) => card.lifecycle === "running").map(cardId) },
      { laneId: "idle", title: "Idle", count: 3, sessionIds: cards.filter((card) => card.lifecycle === "idle").map(cardId) },
      {
        laneId: "needs_action",
        title: "Needs action",
        count: 3,
        sessionIds: cards.filter((card) => card.primaryStatus === "blocked").map(cardId)
      },
      { laneId: "history", title: "History", count: 0, sessionIds: [] }
    ],
    cards,
    expandedSession,
    selectedSession: selectedCard ? toSessionDetail(selectedCard, attentionQueue) : undefined,
    brief: {
      text: "16 active sessions, 5 idle sessions, and 3 blocked sessions are visible across 3 environments.",
      source: "fallback",
      priority: "attention"
    },
    attentionQueue,
    conflicts: []
  };
}

export function observabilitySessionTotal(summary: LiveBoardProjection["summary"]): number {
  return (summary.running ?? summary.active) + (summary.idle ?? 0) + (summary.needsAction ?? summary.needsAttention);
}

function toCard(input: DemoCardInput): SessionCardView {
  const isBlocked = input.primaryStatus === "blocked";
  return {
    sessionId: input.sessionId,
    project: "Masthead",
    title: input.headline,
    headline: {
      headline: input.headline,
      frame: {
        subject: input.headline,
        disposition: input.copyReason ?? "demo session data exercises the observability layout",
        state: input.primaryStatus === "blocked" ? "blocked" : input.lifecycle === "idle" ? "paused" : "active",
        subjectKind: "feature",
        confidence: "low",
        evidence: []
      },
      source: "offline",
      status: "ready"
    },
    stateLabel: input.stateLabel,
    primaryStatus: input.primaryStatus,
    lifecycle: input.lifecycle,
    outcomeLabel: isBlocked ? "blocked" : undefined,
    endReason: isBlocked ? "blocked" : undefined,
    priorityRank: input.priorityRank,
    durationLabel: input.durationLabel,
    branchOrWorktree: input.branchOrWorktree,
    lastActivity: input.lastActivity,
    lastActivityLabel: input.lastActivityLabel,
    changedFileCount: input.changedFileCount,
    attentionReason: input.attentionReason,
    indicators: isBlocked ? ["attention"] : [],
    identityConfidence: "direct",
    safeActions,
    isExpanded: input.sessionId === "session-9f3a1c7e",
    workContext: {
      label: input.branchOrWorktree,
      confidence: "title",
      pathClusters: [],
      sourceSignals: ["observability demo"]
    }
  };
}

function toAttentionItem(card: SessionCardView): AttentionItem {
  return {
    itemId: `attention:${card.sessionId}:blocked`,
    sessionId: card.sessionId,
    project: card.project,
    type: "stalled",
    severity: "P2",
    title: card.attentionReason ?? "Blocked session",
    createdAt: card.lastActivity,
    affectedPaths: [],
    affectedCommandIds: [],
    evidence: [],
    support: "inferred",
    suggestedNextAction: "Inspect the session detail before continuing."
  };
}

function toExpandedSession(card: SessionCardView, attentionQueue: AttentionItem[]): ExpandedSessionView {
  return {
    ...card,
    evidence: { observed: [], inferred: [], missing: [] },
    conflicts: [],
    attentionItems: attentionQueue.filter((item) => item.sessionId === card.sessionId)
  };
}

function toSessionDetail(card: SessionCardView, attentionQueue: AttentionItem[]): SessionDetailView {
  return {
    ...card,
    currentActivity: card.attentionReason ?? card.stateLabel,
    reviewAnnotations: [],
    evidence: { observed: [], inferred: [], missing: [] },
    conflicts: [],
    attentionItems: attentionQueue.filter((item) => item.sessionId === card.sessionId),
    timeline: []
  };
}

function cardId(card: SessionCardView): string {
  return card.sessionId;
}
