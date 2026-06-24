import { describe, expect, test } from "vitest";
import {
  defaultFixtureMode,
  eventsRequestUrl,
  clearRequestUrl,
  healthRequestUrl,
  isLiveEventsEnvelope,
  isLiveProjectionEnvelope,
  normalizeLiveBoardProjection,
  projectionRequestUrl,
  retentionRequestUrl
} from "../liveProjectionClient";
import type { LiveBoardProjection, SessionCardView, SessionDetailView } from "../../core/types";

describe("live projection client helpers", () => {
  test("adds the selected session id without dropping existing query params", () => {
    expect(projectionRequestUrl("http://127.0.0.1:17373/projection?source=live", "session-1")).toBe(
      "http://127.0.0.1:17373/projection?source=live&selectedSessionId=session-1"
    );
  });

  test("omits selected session id when the board is intentionally unselected", () => {
    expect(projectionRequestUrl("http://127.0.0.1:17373/projection?source=live&selectedSessionId=old", null)).toBe(
      "http://127.0.0.1:17373/projection?source=live"
    );
  });

  test("accepts only live projection envelopes", () => {
    expect(
      isLiveProjectionEnvelope({
        ok: true,
        source: "live",
        generatedAt: "2026-06-23T03:00:00.000Z",
        events: 0,
        gitSnapshots: 0,
        diagnostics: 0,
        projection: {
          summary: { active: 0, needsAttention: 0, conflicts: 0, completed: 0 },
          cards: [],
          attentionQueue: [],
          conflicts: []
        }
      })
    ).toBe(true);
    expect(isLiveProjectionEnvelope({ ok: true, source: "fixture", projection: {} })).toBe(false);
    expect(isLiveProjectionEnvelope({ ok: false })).toBe(false);
  });

  test("builds the read-only live events URL from projection URLs", () => {
    expect(eventsRequestUrl("http://127.0.0.1:17373/projection?source=live&selectedSessionId=s1")).toBe(
      "http://127.0.0.1:17373/events"
    );
  });

  test("builds the local retention URL from projection URLs", () => {
    expect(retentionRequestUrl("http://127.0.0.1:17373/projection?source=live&selectedSessionId=s1")).toBe(
      "http://127.0.0.1:17373/retention"
    );
  });

  test("builds the local clear URL from projection URLs", () => {
    expect(clearRequestUrl("http://127.0.0.1:17373/projection?source=live&selectedSessionId=s1")).toBe(
      "http://127.0.0.1:17373/clear"
    );
  });

  test("builds the live collector health URL from projection URLs", () => {
    expect(healthRequestUrl("http://127.0.0.1:17373/projection?source=live&selectedSessionId=s1")).toBe(
      "http://127.0.0.1:17373/health"
    );
  });

  test("fixture mode is explicit through env or query params", () => {
    expect(defaultFixtureMode(metaWithMode("fixture"))).toBe(true);
    expect(defaultFixtureMode(metaWithMode("demo"))).toBe(true);
    expect(defaultFixtureMode(metaWithMode("live"), "?mode=fixture")).toBe(true);
    expect(defaultFixtureMode(metaWithMode("live"), "?demo=1")).toBe(true);
    expect(defaultFixtureMode(metaWithMode("live"), "")).toBe(false);
  });

  test("accepts only live events envelopes with event and snapshot arrays", () => {
    expect(isLiveEventsEnvelope({ ok: true, events: [], gitSnapshots: [], diagnostics: [] })).toBe(true);
    expect(isLiveEventsEnvelope({ ok: true, gitSnapshots: [], diagnostics: [] })).toBe(false);
    expect(isLiveEventsEnvelope({ ok: true, events: [], diagnostics: [] })).toBe(false);
    expect(isLiveEventsEnvelope({ ok: true, events: {}, gitSnapshots: [] })).toBe(false);
  });

  test("normalizes stale collector projections to the current UI contract", () => {
    const projection = normalizeLiveBoardProjection({
      summary: { active: 1, needsAttention: 1, conflicts: 0, completed: 1 },
      lanes: [
        { laneId: "needs_action", title: "Needs action", count: 0, sessionIds: [] },
        { laneId: "running", title: "Running", count: 1, sessionIds: ["running-attention"] },
        { laneId: "ended_review", title: "Ended to review", count: 1, sessionIds: ["ended-review"] }
      ],
      cards: [
        legacyCard({
          sessionId: "running-attention",
          lifecycle: "running",
          primaryStatus: "waiting_for_approval",
          indicators: ["attention"]
        }),
        legacyCard({
          sessionId: "ended-review",
          lifecycle: "ended",
          primaryStatus: "completed_unreviewed",
          indicators: []
        })
      ],
      selectedSession: legacySessionDetail({
        sessionId: "ended-review",
        lifecycle: "ended",
        primaryStatus: "completed_unreviewed",
        indicators: []
      }),
      attentionQueue: [
        {
          itemId: "attention:running-attention",
          sessionId: "running-attention",
          project: "Masthead",
          type: "approval_requested",
          severity: "P2",
          title: "Approval requested",
          createdAt: "2026-06-23T12:00:00.000Z",
          affectedPaths: [],
          affectedCommandIds: [],
          evidence: [],
          support: "deterministic",
          suggestedNextAction: "Review approval."
        }
      ],
      conflicts: []
    } as unknown as LiveBoardProjection);

    expect(projection.lanes?.map((lane) => lane.laneId)).toEqual(["running", "idle", "needs_action", "history"]);
    expect(projection.summary.running).toBe(1);
    expect(projection.summary.needsAction).toBe(1);
    expect(projection.cards[0].copy.headline).toBe("Masthead session is paused for approval.");
    expect(projection.cards[0].copy.source).toBe("fallback");
    expect(projection.cards[1].copy.headline).toBe("Masthead session had recent activity.");
    expect(projection.selectedSession?.copy.headline).toBe("Masthead session had recent activity.");
    expect(projection.brief).toMatchObject({
      text: "Approval is pending in one active session. One session is running overall.",
      source: "fallback",
      priority: "attention"
    });
  });

  test("synthesizes selected detail for legacy collectors that only return cards", () => {
    const projection = {
      summary: { active: 1, needsAttention: 0, conflicts: 0, completed: 0 },
      cards: [
        legacyCard({
          sessionId: "running-session",
          lifecycle: "running",
          primaryStatus: "editing",
          indicators: []
        })
      ],
      attentionQueue: [],
      conflicts: []
    } as unknown as LiveBoardProjection;

    expect(normalizeLiveBoardProjection(projection).selectedSession).toBeUndefined();

    const selectedProjection = normalizeLiveBoardProjection(projection, "running-session");

    expect(selectedProjection.selectedSession).toMatchObject({
      sessionId: "running-session",
      currentActivity: "Work is active.",
      copy: {
        headline: "Masthead session is active now.",
        status: "Work is active."
      }
    });
  });

  test("replaces stale category-label copy from older live collectors", () => {
    const projection = normalizeLiveBoardProjection({
      summary: { active: 1, needsAttention: 0, conflicts: 0, completed: 0 },
      cards: [
        {
          ...legacyCard({
            sessionId: "live-session",
            lifecycle: "running",
            primaryStatus: "editing",
            indicators: [],
            workContext: {
              label: "UI work",
              confidence: "path_cluster",
              pathClusters: ["ui"],
              sourceSignals: ["path:ui"]
            }
          }),
          copy: {
            headline: "UI work",
            status: "Work is active.",
            reason: "This session is active and has recent activity.",
            source: "deterministic"
          }
        }
      ],
      attentionQueue: [],
      conflicts: []
    } as unknown as LiveBoardProjection);

    expect(projection.cards[0].copy.headline).toBe("UI changes are active now.");
    expect(projection.cards[0].copy.source).toBe("fallback");
  });

  test("keeps null selection distinct from legacy selected-session fallback", () => {
    const projection = {
      summary: { active: 1, needsAttention: 0, conflicts: 0, completed: 0 },
      cards: [
        legacyCard({
          sessionId: "running-session",
          lifecycle: "running",
          primaryStatus: "editing",
          indicators: []
        })
      ],
      selectedSession: legacySessionDetail({
        sessionId: "running-session",
        lifecycle: "running",
        primaryStatus: "editing",
        indicators: []
      }),
      attentionQueue: [],
      conflicts: []
    } as unknown as LiveBoardProjection;

    expect(normalizeLiveBoardProjection(projection, null).selectedSession).toBeUndefined();
    expect(normalizeLiveBoardProjection(projection, "running-session").selectedSession?.sessionId).toBe("running-session");
  });
});

function metaWithMode(mode: string): ImportMeta {
  return { env: { VITE_MASTHEAD_MODE: mode } } as unknown as ImportMeta;
}

function legacyCard(overrides: Partial<SessionCardView>): Omit<SessionCardView, "copy"> {
  const card: Omit<SessionCardView, "copy"> = {
    sessionId: "session-1",
    project: "Masthead",
    title: "Masthead Codex session",
    stateLabel: "Working",
    primaryStatus: "editing",
    lifecycle: "running",
    priorityRank: 1,
    durationLabel: "12m",
    branchOrWorktree: "main",
    lastActivity: "2026-06-23T12:00:00.000Z",
    lastActivityLabel: "1m ago",
    changedFileCount: 2,
    indicators: [],
    identityConfidence: "direct",
    safeActions: ["open_source_session", "open_repo", "open_readonly_diff"],
    isExpanded: false,
    ...overrides
  };
  return card;
}

function legacySessionDetail(overrides: Partial<SessionDetailView>): Omit<SessionDetailView, "copy"> {
  return {
    ...legacyCard(overrides),
    currentActivity: "Waiting for review.",
    reviewAnnotations: [],
    evidence: { observed: [], inferred: [], missing: [] },
    conflicts: [],
    attentionItems: [],
    timeline: []
  };
}
