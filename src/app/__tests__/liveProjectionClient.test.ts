import { describe, expect, test } from "vitest";
import {
  defaultFixtureMode,
  eventsRequestUrl,
  clearRequestUrl,
  healthRequestUrl,
  isLiveEventsEnvelope,
  isLiveProjectionEnvelope,
  normalizeLiveBoardProjection,
  normalizeDaemonBaseUrl,
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

  test("normalizes projection URL to daemon base URL", () => {
    expect(normalizeDaemonBaseUrl("http://127.0.0.1:17374/projection?x=1")).toBe("http://127.0.0.1:17374");
  });

  test("builds projection URL from daemon base URL", () => {
    expect(projectionRequestUrl("http://127.0.0.1:17374", "s1")).toBe(
      "http://127.0.0.1:17374/projection?selectedSessionId=s1"
    );
  });

  test("passes the board refresh interval to projection requests", () => {
    expect(projectionRequestUrl("http://127.0.0.1:17374/projection", "s1", { refreshIntervalMs: 5_000 })).toBe(
      "http://127.0.0.1:17374/projection?selectedSessionId=s1&refreshIntervalMs=5000"
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
    expect(projection.cards[0].headline.headline).toBe("Masthead OpenCode session: waiting for the next required input.");
    expect(projection.cards[0].headline.source).toBe("offline");
    expect("copy" in projection.cards[0]).toBe(false);
    expect(projection.cards[1].headline.headline).toBe("Masthead OpenCode session: latest outcome is ready for review.");
    expect(projection.selectedSession?.headline.headline).toBe("Masthead OpenCode session: latest outcome is ready for review.");
    expect(projection.selectedSession && "copy" in projection.selectedSession).toBe(false);
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
      currentActivity: "waiting for LLM headline access",
      headline: {
        headline: "Masthead OpenCode session: waiting for LLM headline access.",
        source: "offline",
        status: "ready"
      }
    });
    expect(selectedProjection.selectedSession && "copy" in selectedProjection.selectedSession).toBe(false);
  });

  test("replaces stale category-label headlines from older live collectors", () => {
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
          headline: {
            headline: "UI work",
            source: "enrichment",
            status: "ready"
          }
        }
      ],
      attentionQueue: [],
      conflicts: []
    } as unknown as LiveBoardProjection);

    expect(projection.cards[0].headline.headline).toBe("Masthead OpenCode session: waiting for LLM headline access.");
    expect(projection.cards[0].headline.source).toBe("offline");
    expect("copy" in projection.cards[0]).toBe(false);
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

  test("ignores stale selected session details that do not match the requested session", () => {
    const projection = {
      summary: { active: 2, needsAttention: 0, conflicts: 0, completed: 0 },
      cards: [
        legacyCard({
          sessionId: "pip-session",
          lifecycle: "running",
          primaryStatus: "editing",
          indicators: []
        }),
        legacyCard({
          sessionId: "university-dates",
          lifecycle: "ended",
          primaryStatus: "completed_unreviewed",
          indicators: []
        })
      ],
      selectedSession: legacySessionDetail({
        sessionId: "university-dates",
        lifecycle: "ended",
        primaryStatus: "completed_unreviewed",
        indicators: []
      }),
      attentionQueue: [],
      conflicts: []
    } as unknown as LiveBoardProjection;

    const normalized = normalizeLiveBoardProjection(projection, "pip-session");

    expect(normalized.selectedSession?.sessionId).toBe("pip-session");
  });
});

function metaWithMode(mode: string): ImportMeta {
  return { env: { VITE_MASTHEAD_MODE: mode } } as unknown as ImportMeta;
}

function legacyCard(overrides: Partial<SessionCardView>): Omit<SessionCardView, "headline"> {
  const card: Omit<SessionCardView, "headline"> = {
    sessionId: "session-1",
    project: "Masthead",
    title: "Masthead OpenCode session",
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

function legacySessionDetail(overrides: Partial<SessionDetailView>): Omit<SessionDetailView, "headline"> {
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
