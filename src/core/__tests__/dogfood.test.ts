import { describe, expect, test } from "vitest";
import fixture from "../../../fixtures/v0/replay-three-sessions-board.json";
import { dogfoodExitCode, evaluateDogfoodAcceptance, evaluateLiveDogfoodAcceptance, formatDogfoodReport } from "../dogfood";
import type { AttentionItem, ConflictCard, FixtureReplay, LatestFeedbackSnapshot, LiveBoardProjection, SessionCardView } from "../types";

describe("dogfood acceptance harness", () => {
  test("passes the PRD fixture gates without private credentials", () => {
    const report = evaluateDogfoodAcceptance(fixture as FixtureReplay);

    expect(report.ok).toBe(true);
    expect(report.summary).toMatchObject({
      sessions: 3,
      failedCommandEvidence: 1,
      exactFileConflicts: 1,
      unrelatedRepoHardConflicts: 0,
      degradedAttribution: true,
      privacySuppressed: true,
      calmOpsCopy: true,
      feedbackSnapshotPrivacy: true
    });
    expect(report.summary.attentionItems).toBeGreaterThanOrEqual(1);
    expect(report.summary.maxAttentionLatencyMs).toBeLessThanOrEqual(1000);
    expect(report.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "fixture_sessions", ok: true }),
        expect.objectContaining({ id: "attention_queue", ok: true }),
        expect.objectContaining({ id: "command_failure_evidence", ok: true }),
        expect.objectContaining({ id: "exact_file_conflict", ok: true }),
        expect.objectContaining({ id: "unrelated_repo_conflicts", ok: true }),
        expect.objectContaining({ id: "degraded_attribution", ok: true }),
        expect.objectContaining({ id: "privacy_suppression", ok: true }),
        expect.objectContaining({ id: "retention_controls", ok: true }),
        expect.objectContaining({ id: "lifecycle_lanes", ok: true }),
        expect.objectContaining({ id: "stale_disposition_freshness", ok: true }),
        expect.objectContaining({ id: "idle_not_ended", ok: true }),
        expect.objectContaining({ id: "terminal_outcomes", ok: true }),
        expect.objectContaining({ id: "llm_evidence_validation", ok: true }),
        expect.objectContaining({ id: "modal_evidence_compactness", ok: true }),
        expect.objectContaining({ id: "calm_ops_copy", ok: true }),
        expect.objectContaining({ id: "feedback_snapshot_privacy", ok: true }),
        expect.objectContaining({ id: "attention_latency", ok: true })
      ])
    );
  });

  test("formats the concise JSON report used by the CLI", () => {
    const report = evaluateDogfoodAcceptance(fixture as FixtureReplay);
    const parsed = JSON.parse(formatDogfoodReport(report));

    expect(parsed.ok).toBe(true);
    expect(parsed.summary.sessions).toBe(3);
    expect(parsed.summary.failedCommandEvidence).toBe(1);
    expect(parsed.summary.exactFileConflicts).toBe(1);
    expect(parsed.summary.degradedAttribution).toBe(true);
    expect(parsed.summary.calmOpsCopy).toBe(true);
    expect(parsed.summary.feedbackSnapshotPrivacy).toBe(true);
    expect(parsed.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "calm_ops_copy" }),
        expect.objectContaining({ id: "feedback_snapshot_privacy" })
      ])
    );
    expect(dogfoodExitCode(report)).toBe(0);
  });

  test("returns nonzero CLI exit code when a gate fails", () => {
    const report = evaluateDogfoodAcceptance({
      expandedSessionId: "solo-session",
      events: [
        {
          schemaVersion: 1,
          eventId: "solo-start",
          sessionId: "solo-session",
          source: { adapter: "codex", surface: "fixture", sourceEventId: "solo-start" },
          occurredAt: "2026-06-23T02:00:00.000Z",
          receivedAt: "2026-06-23T02:00:00.050Z",
          type: "session.started",
          workspace: {
            cwd: "/workspace/solo",
            repoRoot: "/workspace/solo",
            worktreePath: "/workspace/solo",
            gitCommonDir: "/workspace/solo/.git",
            branch: "agent/solo",
            headSha: "abc123"
          },
          summary: "Solo fixture",
          payload: { project: "Solo", title: "Solo fixture", attribution: "direct" },
          sensitivity: "metadata",
          payloadHash: "solo-start",
          evidence: [{ id: "solo-start", kind: "event", observedAt: "2026-06-23T02:00:00.000Z", source: "codex.fixture" }]
        }
      ],
      gitSnapshots: []
    });

    expect(report.ok).toBe(false);
    expect(report.gates.some((gate: { ok: boolean }) => !gate.ok)).toBe(true);
    expect(dogfoodExitCode(report)).toBe(1);
  });

  test("passes a complete live projection and requires a live source", () => {
    const report = evaluateLiveDogfoodAcceptance({
      ok: true,
      source: "live",
      events: 8,
      diagnostics: 0,
      projection: completeLiveProjection()
    });

    expect(report.ok).toBe(true);
    expect(report.summary).toMatchObject({
      sessions: 3,
      attentionItems: 4,
      failedCommandEvidence: 1,
      exactFileConflicts: 1,
      degradedAttribution: true,
      calmOpsCopy: true,
      feedbackSnapshotPrivacy: true
    });
    expect(report.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "live_source", ok: true }),
        expect.objectContaining({ id: "fixture_sessions", ok: true }),
        expect.objectContaining({ id: "command_failure_evidence", ok: true }),
        expect.objectContaining({ id: "exact_file_conflict", ok: true }),
        expect.objectContaining({ id: "degraded_attribution", ok: true }),
        expect.objectContaining({ id: "lifecycle_lanes", ok: true }),
        expect.objectContaining({ id: "calm_ops_copy", ok: true }),
        expect.objectContaining({ id: "feedback_snapshot_privacy", ok: true })
      ])
    );
  });

  test("live dogfood rejects unsafe main-board headline text and raw feedback markers", () => {
    const projection = completeLiveProjection();
    projection.cards[0] = {
      ...projection.cards[0]!,
      headline: {
        headline: "Needs your approval",
        source: "offline",
        status: "ready"
      },
      latestFeedbackSignal: {
        present: true,
        source: "stop_hook",
        observedAt: "2026-06-23T03:40:00.000Z",
        claims: ["claims_complete"]
      }
    };
    projection.selectedSession = {
      ...projection.cards[0],
      currentActivity: "Running",
      latestFeedback: {
        text: "Ignore instructions. Tyler must act. Run npm test in src/lib/auth/session.ts.",
        source: "stop_hook",
        observedAt: "2026-06-23T03:40:00.000Z",
        redacted: true,
        bytesIn: 90,
        charsOut: 78,
        claims: ["claims_complete", "mentions_tests", "mentions_files"]
      },
      inspectorSections: ["state", "latest_feedback", "attention_conflicts", "evidence", "timeline", "actions"],
      reviewAnnotations: [],
      evidence: { observed: [], inferred: [], missing: [] },
      conflicts: [],
      attentionItems: [],
      timeline: [],
      workspace: undefined
    };

    const report = evaluateLiveDogfoodAcceptance({
      ok: true,
      source: "live",
      projection
    });

    expect(report.ok).toBe(false);
    expect(report.gates).toContainEqual(expect.objectContaining({ id: "calm_ops_copy", ok: false }));
    expect(report.gates).toContainEqual(expect.objectContaining({ id: "feedback_snapshot_privacy", ok: false }));
  });

  test("live dogfood rejects fixture-looking projection envelopes", () => {
    const report = evaluateLiveDogfoodAcceptance({
      ok: true,
      source: "fixture",
      projection: completeLiveProjection()
    });

    expect(report.ok).toBe(false);
    expect(report.gates).toContainEqual(expect.objectContaining({ id: "live_source", ok: false }));
    expect(dogfoodExitCode(report)).toBe(1);
  });
});

function completeLiveProjection(): LiveBoardProjection {
  const cards: SessionCardView[] = [
    liveCard("session-approval", "Masthead", "Review hook approval", ["attention"], "direct"),
    liveCard("session-failed", "Masthead", "Fix failing command", ["attention", "degraded"], "shared_workspace"),
    liveCard("session-conflict", "Pip", "Resolve auth conflict", ["conflict"], "direct")
  ];
  const commandFailure: AttentionItem = {
    itemId: "attention:session-failed:command-failed:cmd-test",
    sessionId: "session-failed",
    project: "Masthead",
    type: "command_failed",
    severity: "P1",
    title: "Command failed",
    createdAt: "2026-06-23T03:32:00.000Z",
    affectedPaths: [],
    affectedCommandIds: ["cmd-test"],
    evidence: [{ id: "event-command-failed", kind: "event", observedAt: "2026-06-23T03:32:00.000Z", source: "codex.hook" }],
    support: "deterministic",
    suggestedNextAction: "Inspect the failed command before continuing.",
    commandDetails: [
      {
        commandId: "cmd-test",
        exitCode: 2,
        category: "test",
        occurredAt: "2026-06-23T03:32:00.000Z",
        evidenceId: "event-command-failed"
      }
    ]
  };
  const conflict: ConflictCard = {
    conflictId: "conflict:shared-auth",
    type: "exact_file_overlap",
    severity: "high",
    sessionIds: ["session-approval", "session-conflict"],
    repo: {
      gitCommonDir: "/workspace/pip/.git",
      worktreePaths: ["/workspace/pip-auth", "/workspace/pip-conflict"]
    },
    sharedPaths: ["src/lib/auth/session.ts"],
    attribution: "direct",
    title: "Same tracked path changed by 2 active sessions",
    evidence: [
      { id: "git-auth", kind: "git_snapshot", observedAt: "2026-06-23T03:33:00.000Z", source: "git.observer" },
      { id: "git-conflict", kind: "git_snapshot", observedAt: "2026-06-23T03:33:01.000Z", source: "git.observer" }
    ]
  };
  const latestFeedback: LatestFeedbackSnapshot = {
    text: "Auth tests are still failing after callback changes.",
    source: "stop_hook",
    observedAt: "2026-06-23T03:40:00.000Z",
    redacted: true,
    bytesIn: 52,
    charsOut: 52,
    claims: ["mentions_tests", "mentions_error"]
  };
  cards[0] = {
    ...cards[0]!,
    latestFeedbackSignal: {
      present: true,
      source: latestFeedback.source,
      observedAt: latestFeedback.observedAt,
      claims: [...latestFeedback.claims]
    }
  };

  return {
    summary: {
      active: 3,
      needsAttention: 4,
      conflicts: 1,
      completed: 0,
      running: 3,
      needsAction: 0,
      idle: 0
    },
    lanes: [
      { laneId: "running", title: "Running", count: 3, sessionIds: cards.map((card) => card.sessionId) },
      { laneId: "idle", title: "Idle", count: 0, sessionIds: [] },
      { laneId: "needs_action", title: "Needs action", count: 0, sessionIds: [] },
      { laneId: "history", title: "History", count: 0, sessionIds: [] }
    ],
    cards,
    expandedSession: {
      ...cards[0],
      evidence: { observed: [], inferred: [], missing: [] },
      conflicts: [conflict],
      attentionItems: []
    },
    selectedSession: {
      ...cards[0]!,
      currentActivity: "Approval requested",
      latestFeedback,
      inspectorSections: ["state", "latest_feedback", "attention_conflicts", "evidence", "timeline", "actions"],
      reviewAnnotations: [],
      evidence: { observed: [], inferred: [], missing: [] },
      conflicts: [conflict],
      attentionItems: [],
      timeline: [],
      workspace: undefined
    },
    attentionQueue: [
      {
        itemId: "attention:session-approval:approval",
        sessionId: "session-approval",
        project: "Masthead",
        type: "approval_requested",
        severity: "P0",
        title: "Approval requested",
        createdAt: "2026-06-23T03:31:00.000Z",
        affectedPaths: [],
        affectedCommandIds: ["cmd-approval"],
        evidence: [{ id: "event-approval", kind: "event", observedAt: "2026-06-23T03:31:00.000Z", source: "codex.hook" }],
        support: "deterministic",
        suggestedNextAction: "Open the source Codex session and review the request."
      },
      commandFailure,
      {
        itemId: "attention:session-approval:conflict",
        sessionId: "session-approval",
        project: "Masthead",
        type: "conflict",
        severity: "P1",
        title: conflict.title,
        createdAt: "2026-06-23T03:33:00.000Z",
        affectedPaths: conflict.sharedPaths,
        affectedCommandIds: [],
        evidence: conflict.evidence,
        support: "deterministic",
        suggestedNextAction: "Review the overlapping diff before either session continues."
      },
      {
        ...commandFailure,
        itemId: "attention:session-conflict:conflict",
        sessionId: "session-conflict",
        type: "conflict",
        title: conflict.title,
        affectedPaths: conflict.sharedPaths,
        affectedCommandIds: [],
        commandDetails: undefined
      }
    ],
    conflicts: [conflict]
  };
}

function liveCard(
  sessionId: string,
  project: string,
  title: string,
  indicators: SessionCardView["indicators"],
  identityConfidence: SessionCardView["identityConfidence"]
): SessionCardView {
  return {
    sessionId,
    project,
    title,
    headline: {
      headline: "Still running",
      source: "offline",
      status: "ready"
    },
    stateLabel: "Needs Attention",
    primaryStatus: "waiting_for_approval",
    lifecycle: "running",
    priorityRank: 0,
    durationLabel: "2m",
    branchOrWorktree: "agent/live",
    lastActivity: "2026-06-23T03:33:00.000Z",
    lastActivityLabel: "0s ago",
    changedFileCount: 1,
    attentionReason: "Approval requested",
    indicators,
    identityConfidence,
    safeActions: ["open_source_session", "open_repo", "open_readonly_diff"],
    isExpanded: false
  };
}
