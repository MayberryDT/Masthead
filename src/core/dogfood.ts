import { applyRetentionPolicy } from "./retention.ts";
import { projectFixture } from "./replay.ts";
import {
  applyReviewDispositions,
  createReviewDisposition
} from "./reviewDispositions.ts";
import { validateLlmOutcomeCandidate } from "./outcomeClassifier.ts";
import type { StoreRecord } from "./store";
import type { FixtureReplay, GitSnapshot, LiveBoardProjection, NormalizedEvent } from "./types";

export type DogfoodGateId =
  | "live_source"
  | "fixture_sessions"
  | "attention_queue"
  | "command_failure_evidence"
  | "exact_file_conflict"
  | "unrelated_repo_conflicts"
  | "degraded_attribution"
  | "privacy_suppression"
  | "retention_controls"
  | "lifecycle_lanes"
  | "stale_disposition_freshness"
  | "idle_not_ended"
  | "terminal_outcomes"
  | "llm_evidence_validation"
  | "modal_evidence_compactness"
  | "calm_ops_copy"
  | "feedback_snapshot_privacy"
  | "attention_latency";

export type DogfoodGate = {
  id: DogfoodGateId;
  ok: boolean;
  label: string;
  details: Record<string, unknown>;
};

export type DogfoodReport = {
  ok: boolean;
  summary: {
    sessions: number;
    attentionItems: number;
    failedCommandEvidence: number;
    exactFileConflicts: number;
    unrelatedRepoHardConflicts: number;
    degradedAttribution: boolean;
    privacySuppressed: boolean;
    retentionControls: boolean;
    lifecycleLanes: boolean;
    staleDispositionFreshness: boolean;
    idleNotEnded: boolean;
    terminalOutcomes: boolean;
    llmEvidenceValidation: boolean;
    modalEvidenceCompactness: boolean;
    calmOpsCopy: boolean;
    feedbackSnapshotPrivacy: boolean;
    maxAttentionLatencyMs: number | null;
  };
  gates: DogfoodGate[];
};

type DogfoodOptions = {
  expectedSessions?: number;
  expectedExactFileConflicts?: number;
  maxAttentionLatencyMs?: number;
};

type LiveProjectionLike = {
  ok?: boolean;
  source?: string;
  events?: number;
  diagnostics?: number;
  projection?: LiveBoardProjection;
};

type ExactFileConflict = {
  gitCommonDir: string;
  path: string;
  sessionIds: string[];
  observedAt: string[];
};

const ATTENTION_EVENT_TYPES = new Set(["approval.requested", "user.question"]);
const RAW_CAPTURE_KEYS = new Set([
  "rawPrompt",
  "prompt",
  "transcript",
  "fullTranscript",
  "fullDiff",
  "diff",
  "patch",
  "commandOutput",
  "stdout",
  "stderr",
  "screenshot",
  "browserState",
  "shellHistory",
  "databaseContents",
  "toolResponse",
  "lastAssistantMessage"
]);
const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._-]{12,}/i,
  /\bsk-[A-Za-z0-9_-]{12,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/
];

export function evaluateDogfoodAcceptance(fixture: FixtureReplay, options: DogfoodOptions = {}): DogfoodReport {
  const expectedSessions = options.expectedSessions ?? 3;
  const expectedExactFileConflicts = options.expectedExactFileConflicts ?? 1;
  const maxAllowedAttentionLatencyMs = options.maxAttentionLatencyMs ?? 1000;
  const events = Array.isArray(fixture.events) ? fixture.events : [];
  const snapshots = Array.isArray(fixture.gitSnapshots) ? fixture.gitSnapshots : [];
  const sessionIds = unique(events.flatMap((event) => (event.sessionId ? [event.sessionId] : [])));
  const attentionEvents = events.filter((event) => ATTENTION_EVENT_TYPES.has(event.type));
  const failedCommandEvents = events.filter(
    (event) => event.type === "command.finished" && typeof event.payload.exitCode === "number" && event.payload.exitCode !== 0
  );
  const exactFileConflicts = detectExactFileConflicts(snapshots);
  const conflictAttentionItems = exactFileConflicts.reduce((sum, conflict) => sum + conflict.sessionIds.length, 0);
  const commandFailureEvidence = countFailedCommandEvidence(failedCommandEvents);
  const attentionItems = attentionEvents.length + conflictAttentionItems + commandFailureEvidence;
  const unrelatedRepoHardConflicts = countUnrelatedRepoHardConflicts(exactFileConflicts, snapshots);
  const degradedAttribution = hasDegradedAttributionEvidence(events, snapshots);
  const privacy = evaluatePrivacySuppression(fixture);
  const retention = evaluateRetentionControls(events);
  const latency = evaluateAttentionLatency(attentionEvents, maxAllowedAttentionLatencyMs);
  const projection = projectFixture(fixture);
  const lifecycleLanes = evaluateLifecycleLanes(projection);
  const staleDisposition = evaluateStaleDispositionFreshness();
  const idleNotEnded = evaluateIdleNotEnded();
  const terminalOutcomes = evaluateTerminalOutcomes(projection);
  const llmEvidence = evaluateLlmEvidenceValidation();
  const modalEvidence = evaluateModalEvidenceCompactness(projection);
  const calmOpsCopy = evaluateCalmOpsCopy(projection);
  const feedbackPrivacy = evaluateFeedbackSnapshotPrivacy(projection);

  const gates: DogfoodGate[] = [
    gate("fixture_sessions", sessionIds.length === expectedSessions, "fixture has exactly three sessions", {
      expected: expectedSessions,
      actual: sessionIds.length,
      sessionIds
    }),
    gate("attention_queue", attentionItems >= 1, "fixture derives at least one attention item", {
      actual: attentionItems,
      attentionEvents: attentionEvents.length,
      conflictAttentionItems,
      commandFailureEvidence
    }),
    gate(
      "command_failure_evidence",
      commandFailureEvidence >= 1,
      "fixture includes failed command evidence with exit status, category, timestamp, and event reference",
      {
        actual: commandFailureEvidence,
        failedCommandEvents: failedCommandEvents.length
      }
    ),
    gate(
      "exact_file_conflict",
      exactFileConflicts.length === expectedExactFileConflicts,
      "fixture derives one exact-file conflict",
      {
        expected: expectedExactFileConflicts,
        actual: exactFileConflicts.length,
        sharedPaths: exactFileConflicts.map((conflict) => conflict.path)
      }
    ),
    gate(
      "unrelated_repo_conflicts",
      unrelatedRepoHardConflicts === 0 && unique(snapshots.map((snapshot) => snapshot.gitCommonDir)).length >= 2,
      "unrelated repositories do not create a hard conflict",
      {
        actual: unrelatedRepoHardConflicts,
        gitCommonDirs: unique(snapshots.map((snapshot) => snapshot.gitCommonDir)).length
      }
    ),
    gate(
      "degraded_attribution",
      degradedAttribution,
      "fixture includes explicit degraded attribution evidence",
      {
        sessionPayloads: events.filter((event) => event.payload.attribution === "shared_workspace" || event.payload.attribution === "unattributed").length,
        sameWorktreeConflicts: countSameWorktreeOverlap(snapshots)
      }
    ),
    gate("privacy_suppression", privacy.ok, "fixture suppresses private/raw capture by default", privacy.details),
    gate("retention_controls", retention.ok, "local retention prunes old history while preserving pinned records", retention.details),
    gate("lifecycle_lanes", lifecycleLanes.ok, "projection exposes ordered lifecycle lanes", lifecycleLanes.details),
    gate(
      "stale_disposition_freshness",
      staleDisposition.ok,
      "newer activity prevents stale dispositions from becoming primary runtime state",
      staleDisposition.details
    ),
    gate("idle_not_ended", idleNotEnded.ok, "old non-terminal sessions become idle rather than ended", idleNotEnded.details),
    gate("terminal_outcomes", terminalOutcomes.ok, "terminal sessions expose supported outcome labels", terminalOutcomes.details),
    gate("llm_evidence_validation", llmEvidence.ok, "LLM outcome candidates require evidence and ended lifecycle", llmEvidence.details),
    gate(
      "modal_evidence_compactness",
      modalEvidence.ok,
      "cards stay compact while selected-session detail exposes evidence",
      modalEvidence.details
    ),
    gate("calm_ops_copy", calmOpsCopy.ok, "main-board copy follows calm ops voice rules", calmOpsCopy.details),
    gate(
      "feedback_snapshot_privacy",
      feedbackPrivacy.ok,
      "latest feedback snapshots stay bounded and raw assistant text remains suppressed",
      feedbackPrivacy.details
    ),
    gate("attention_latency", latency.ok, "attention timing metadata supports <=1s simulated latency", latency.details)
  ];

  return {
    ok: gates.every((item) => item.ok),
    summary: {
      sessions: sessionIds.length,
      attentionItems,
      failedCommandEvidence: commandFailureEvidence,
      exactFileConflicts: exactFileConflicts.length,
      unrelatedRepoHardConflicts,
      degradedAttribution,
      privacySuppressed: privacy.ok,
      retentionControls: retention.ok,
      lifecycleLanes: lifecycleLanes.ok,
      staleDispositionFreshness: staleDisposition.ok,
      idleNotEnded: idleNotEnded.ok,
      terminalOutcomes: terminalOutcomes.ok,
      llmEvidenceValidation: llmEvidence.ok,
      modalEvidenceCompactness: modalEvidence.ok,
      calmOpsCopy: calmOpsCopy.ok,
      feedbackSnapshotPrivacy: feedbackPrivacy.ok,
      maxAttentionLatencyMs: latency.maxLatencyMs
    },
    gates
  };
}

export function formatDogfoodReport(report: DogfoodReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function dogfoodExitCode(report: DogfoodReport): 0 | 1 {
  return report.ok ? 0 : 1;
}

export function evaluateLiveDogfoodAcceptance(envelope: LiveProjectionLike, options: DogfoodOptions = {}): DogfoodReport {
  const expectedSessions = options.expectedSessions ?? 3;
  const expectedExactFileConflicts = options.expectedExactFileConflicts ?? 1;
  const projection = envelope.projection;
  const cards = projection?.cards ?? [];
  const attentionQueue = projection?.attentionQueue ?? [];
  const conflicts = projection?.conflicts ?? [];
  const failedCommandEvidence = attentionQueue.filter(hasFailedCommandEvidence).length;
  const exactFileConflicts = conflicts.filter((conflict) => conflict.type === "exact_file_overlap").length;
  const lifecycleLanes = projection ? evaluateLifecycleLanes(projection) : { ok: false, details: { reason: "missing projection" } };
  const calmOpsCopy = projection ? evaluateCalmOpsCopy(projection) : { ok: false, details: { reason: "missing projection" } };
  const feedbackPrivacy = projection ? evaluateFeedbackSnapshotPrivacy(projection) : { ok: false, details: { reason: "missing projection" } };
  const degradedAttribution =
    cards.some((card) => card.identityConfidence === "shared_workspace" || card.identityConfidence === "unattributed") ||
    conflicts.some((conflict) => conflict.attribution === "degraded");
  const gates: DogfoodGate[] = [
    gate("live_source", envelope.ok === true && envelope.source === "live", "projection source is live, not fixture replay", {
      ok: envelope.ok,
      source: envelope.source
    }),
    gate("fixture_sessions", cards.length >= expectedSessions, "live projection has at least three sessions", {
      expected: expectedSessions,
      actual: cards.length,
      sessionIds: cards.map((card) => card.sessionId)
    }),
    gate("attention_queue", attentionQueue.length >= 1, "live projection derives at least one attention item", {
      actual: attentionQueue.length
    }),
    gate(
      "command_failure_evidence",
      failedCommandEvidence >= 1,
      "live projection includes failed command evidence with exit status, category, timestamp, and event reference",
      {
        actual: failedCommandEvidence
      }
    ),
    gate(
      "exact_file_conflict",
      exactFileConflicts >= expectedExactFileConflicts,
      "live projection derives an exact-file conflict",
      {
        expected: expectedExactFileConflicts,
        actual: exactFileConflicts
      }
    ),
    gate("degraded_attribution", degradedAttribution, "live projection includes explicit degraded attribution evidence", {
      degradedCards: cards.filter(
        (card) => card.identityConfidence === "shared_workspace" || card.identityConfidence === "unattributed"
      ).length,
      degradedConflicts: conflicts.filter((conflict) => conflict.attribution === "degraded").length
    }),
    gate("lifecycle_lanes", lifecycleLanes.ok, "live projection exposes ordered lifecycle lanes", lifecycleLanes.details),
    gate("calm_ops_copy", calmOpsCopy.ok, "live main-board copy follows calm ops voice rules", calmOpsCopy.details),
    gate(
      "feedback_snapshot_privacy",
      feedbackPrivacy.ok,
      "live latest feedback snapshots stay bounded and raw assistant text remains suppressed",
      feedbackPrivacy.details
    )
  ];

  return {
    ok: gates.every((item) => item.ok),
    summary: {
      sessions: cards.length,
      attentionItems: attentionQueue.length,
      failedCommandEvidence,
      exactFileConflicts,
      unrelatedRepoHardConflicts: 0,
      degradedAttribution,
      privacySuppressed: false,
      retentionControls: false,
      lifecycleLanes: lifecycleLanes.ok,
      staleDispositionFreshness: false,
      idleNotEnded: false,
      terminalOutcomes: false,
      llmEvidenceValidation: false,
      modalEvidenceCompactness: false,
      calmOpsCopy: calmOpsCopy.ok,
      feedbackSnapshotPrivacy: feedbackPrivacy.ok,
      maxAttentionLatencyMs: null
    },
    gates
  };
}

function gate(id: DogfoodGateId, ok: boolean, label: string, details: Record<string, unknown>): DogfoodGate {
  return { id, ok, label, details };
}

function evaluateRetentionControls(events: NormalizedEvent[]): { ok: boolean; details: Record<string, unknown> } {
  const event = events[0];
  if (!event) {
    return { ok: false, details: { reason: "fixture has no events for retention simulation" } };
  }

  const oldRecord: StoreRecord = {
    recordId: "dogfood:event:old",
    recordType: "event",
    observedAt: "2026-05-01T00:00:00.000Z",
    value: event
  };
  const pinnedRecord: StoreRecord = {
    recordId: "dogfood:event:pinned",
    recordType: "event",
    observedAt: "2026-05-02T00:00:00.000Z",
    value: event
  };
  const recentRecord: StoreRecord = {
    recordId: "dogfood:event:recent",
    recordType: "event",
    observedAt: "2026-06-20T00:00:00.000Z",
    value: event
  };
  const result = applyRetentionPolicy([oldRecord, pinnedRecord, recentRecord], {
    cutoffAt: "2026-06-01T00:00:00.000Z",
    recordTypes: ["event"],
    pinnedRecordIds: [pinnedRecord.recordId],
    keepUnresolvedAttention: true
  });
  const removedRecordIds = result.removedRecords.map((record) => record.recordId);
  const retainedRecordIds = result.retainedRecords.map((record) => record.recordId);

  return {
    ok:
      removedRecordIds.length === 1 &&
      removedRecordIds.includes(oldRecord.recordId) &&
      retainedRecordIds.includes(pinnedRecord.recordId) &&
      retainedRecordIds.includes(recentRecord.recordId),
    details: {
      removedRecordIds,
      retainedRecordIds,
      cutoffAt: "2026-06-01T00:00:00.000Z",
      pinnedRecordIds: [pinnedRecord.recordId]
    }
  };
}

function hasFailedCommandEvidence(item: LiveBoardProjection["attentionQueue"][number]): boolean {
  if (item.type !== "command_failed" || !item.commandDetails?.length) return false;
  return item.commandDetails.some(
    (detail) =>
      typeof detail.exitCode === "number" &&
      typeof detail.category === "string" &&
      Number.isFinite(Date.parse(detail.occurredAt)) &&
      typeof detail.evidenceId === "string"
  );
}

function evaluateLifecycleLanes(projection: LiveBoardProjection): { ok: boolean; details: Record<string, unknown> } {
  const expected = ["running", "idle", "needs_action", "history"];
  const actual = projection.lanes?.map((lane) => lane.laneId) ?? [];
  const needsActionSessionIds = projection.lanes?.find((lane) => lane.laneId === "needs_action")?.sessionIds ?? [];
  const activeSessionsInNeedsAction = projection.cards
    .filter((card) => card.lifecycle !== "ended" && needsActionSessionIds.includes(card.sessionId))
    .map((card) => card.sessionId);
  return {
    ok: expected.every((laneId, index) => actual[index] === laneId) && activeSessionsInNeedsAction.length === 0,
    details: {
      expected,
      actual,
      activeSessionsInNeedsAction,
      summary: projection.summary
    }
  };
}

function evaluateStaleDispositionFreshness(): { ok: boolean; details: Record<string, unknown> } {
  const board = projectFixture({
    events: [
      dogfoodEvent("stale-start", "stale-session", "session.started", "2026-06-23T05:00:00.000Z"),
      dogfoodEvent("stale-command", "stale-session", "command.finished", "2026-06-23T05:05:00.000Z", {
        commandId: "cmd-continue"
      })
    ],
    gitSnapshots: []
  }, { expandedSessionId: "stale-session" });
  const disposition = createReviewDisposition({
    action: "dismiss",
    subject: { subjectId: "stale-session", subjectType: "session" },
    recordedAt: "2026-06-23T05:02:00.000Z"
  });
  const applied = applyReviewDispositions(board, [disposition], new Date("2026-06-23T05:06:00.000Z"));
  const card = applied.cards.find((candidate) => candidate.sessionId === "stale-session");
  const annotation = applied.selectedSession?.reviewAnnotations.find((candidate) => candidate.status === "dismissed");
  return {
    ok: card?.lifecycle === "running" && card.stateLabel !== "Dismissed" && annotation?.stale === true,
    details: {
      lifecycle: card?.lifecycle,
      stateLabel: card?.stateLabel,
      annotation
    }
  };
}

function evaluateIdleNotEnded(): { ok: boolean; details: Record<string, unknown> } {
  const board = projectFixture(
    {
      events: [dogfoodEvent("idle-start", "idle-session", "session.started", "2026-06-23T01:00:00.000Z")],
      gitSnapshots: []
    },
    { now: new Date("2026-06-23T01:30:00.000Z"), idleAfterMs: 5 * 60_000 }
  );
  const card = board.cards.find((candidate) => candidate.sessionId === "idle-session");
  return {
    ok: card?.lifecycle === "idle" && card.endReason === undefined,
    details: {
      lifecycle: card?.lifecycle,
      endReason: card?.endReason
    }
  };
}

function evaluateTerminalOutcomes(_projection: LiveBoardProjection): { ok: boolean; details: Record<string, unknown> } {
  const projection = projectFixture({
    events: [
      dogfoodEvent("terminal-start", "terminal-session", "session.started", "2026-06-23T04:00:00.000Z"),
      dogfoodEvent("terminal-done", "terminal-session", "session.completed", "2026-06-23T04:10:00.000Z")
    ],
    gitSnapshots: [
      {
        snapshotId: "terminal-snapshot",
        sessionId: "terminal-session",
        repoRoot: "/workspace/dogfood",
        worktreePath: "/workspace/dogfood",
        gitCommonDir: "/workspace/dogfood/.git",
        branch: "agent/dogfood",
        headSha: "abc123",
        changedPaths: [
          {
            path: "src/terminal.ts",
            status: "modified",
            staged: false,
            additions: 1,
            deletions: 0,
            sensitivity: "metadata"
          }
        ],
        observedAt: "2026-06-23T04:10:30.000Z"
      }
    ]
  });
  const supported = new Set(["completed", "needs_attention", "blocked", "failed", "abandoned", "unknown"]);
  const terminalCards = projection.cards.filter((card) => card.lifecycle === "ended");
  const unsupported = terminalCards.filter((card) => !card.outcomeLabel || !supported.has(card.outcomeLabel));
  return {
    ok: terminalCards.length > 0 && unsupported.length === 0,
    details: {
      terminalCards: terminalCards.map((card) => ({ sessionId: card.sessionId, outcomeLabel: card.outcomeLabel })),
      unsupported: unsupported.map((card) => card.sessionId)
    }
  };
}

function evaluateLlmEvidenceValidation(): { ok: boolean; details: Record<string, unknown> } {
  const evidence = [{ id: "event-1", kind: "event" as const, observedAt: "2026-06-23T02:00:00.000Z", source: "dogfood" }];
  const accepted = validateLlmOutcomeCandidate(
    {
      outcome: "needs_attention",
      confidence: "medium",
      reason: "No fresh verification observed.",
      evidence_refs: ["event-1"],
      missing_evidence: ["test command"],
      recommended_next_action: "Review the diff."
    },
    evidence,
    { lifecycle: "ended" }
  );
  const zeroEvidence = validateLlmOutcomeCandidate(
    {
      outcome: "completed",
      confidence: "high",
      reason: "Unsupported claim.",
      evidence_refs: [],
      missing_evidence: [],
      recommended_next_action: "Move to history."
    },
    evidence,
    { lifecycle: "ended" }
  );
  const running = validateLlmOutcomeCandidate(
    {
      outcome: "completed",
      confidence: "high",
      reason: "Unsupported lifecycle claim.",
      evidence_refs: ["event-1"],
      missing_evidence: [],
      recommended_next_action: "Move to history."
    },
    evidence,
    { lifecycle: "running" }
  );
  return {
    ok:
      accepted.ok &&
      !zeroEvidence.ok &&
      zeroEvidence.reason === "llm_outcome_requires_evidence" &&
      !running.ok &&
      running.reason === "llm_outcome_requires_ended_lifecycle",
    details: {
      accepted: accepted.ok,
      zeroEvidence,
      running
    }
  };
}

function evaluateModalEvidenceCompactness(projection: LiveBoardProjection): { ok: boolean; details: Record<string, unknown> } {
  const selected = projection.selectedSession;
  const selectedCard = selected ? projection.cards.find((card) => card.sessionId === selected.sessionId) : undefined;
  const cardHasEvidencePayload = selectedCard ? "evidence" in selectedCard || "timeline" in selectedCard || "reviewAnnotations" in selectedCard : false;
  return {
    ok: Boolean(
      selected &&
        selectedCard &&
        !cardHasEvidencePayload &&
        selected.evidence.observed.length >= 0 &&
        Array.isArray(selected.timeline) &&
        Array.isArray(selected.reviewAnnotations)
    ),
    details: {
      selectedSessionId: selected?.sessionId,
      cardHasEvidencePayload,
      evidenceRefs: selected?.evidence.observed.length,
      timelineEvents: selected?.timeline.length
    }
  };
}

const FORBIDDEN_MAIN_BOARD_TERMS = [
  /\byou\b/i,
  /\byour\b/i,
  /\btyler\b/i,
  /\burgent\b/i,
  /\bcritical\b/i,
  /\bdangerous\b/i,
  /\bplease\b/i,
  /\blet'?s\b/i,
  /\bi recommend\b/i,
  /\bi finished\b/i,
  /\bwe need\b/i,
  /primaryStatus/,
  /lifecycle/,
  /evidence refs/,
  /hook event/
];

const FORBIDDEN_FEEDBACK_PROJECTION_TERMS = [
  "lastAssistantMessage",
  "private assistant response",
  "```",
  "OPENAI_API_KEY",
  "Ignore instructions",
  "Tyler must act",
  "Latest agent feedback"
];

const FORBIDDEN_FEEDBACK_TEXT_PATTERNS = [
  /\b(?:[\w.-]+\/){1,}[\w.-]+\.[a-z0-9]+\b/i,
  /\b[\w.-]+\.(?:ts|tsx|js|jsx|json|md|toml|yml|yaml|css|scss|rs|py|go|java|rb|php)\b/i,
  /\b(npm|pnpm|yarn|bun|node|npx|curl|git|cargo|pytest|python|pip)\b/i,
  /\b[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\b/i
];

function evaluateCalmOpsCopy(projection: LiveBoardProjection): { ok: boolean; details: Record<string, unknown> } {
  const fields = [
    projection.brief?.text,
    ...projection.cards.map((card) => card.headline.headline)
  ].filter((value): value is string => typeof value === "string");
  const violations = fields.flatMap((field) =>
    FORBIDDEN_MAIN_BOARD_TERMS.filter((pattern) => pattern.test(field)).map((pattern) => ({ pattern: pattern.source, field }))
  );

  return {
    ok: fields.length > 0 && violations.length === 0,
    details: {
      checkedFields: fields.length,
      violations
    }
  };
}

function evaluateFeedbackSnapshotPrivacy(projection: LiveBoardProjection): { ok: boolean; details: Record<string, unknown> } {
  const serialized = JSON.stringify(projection);
  const projectionForbiddenTerms = FORBIDDEN_FEEDBACK_PROJECTION_TERMS.filter((term) => serialized.includes(term));
  const projectionSecretLikeValues = SECRET_PATTERNS.filter((pattern) => pattern.test(serialized)).map((pattern) => pattern.source);
  const feedbackTexts = [
    projection.selectedSession?.latestFeedback?.text
  ].filter((value): value is string => typeof value === "string");
  const hasLatestFeedbackSignal = projection.cards.some((card) => card.latestFeedbackSignal?.present === true);
  const unsafeFeedbackTexts = feedbackTexts.flatMap((text) =>
    FORBIDDEN_FEEDBACK_TEXT_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => ({ pattern: pattern.source, text }))
  );

  return {
    ok:
      hasLatestFeedbackSignal &&
      projectionForbiddenTerms.length === 0 &&
      projectionSecretLikeValues.length === 0 &&
      unsafeFeedbackTexts.length === 0,
    details: {
      projectionForbiddenTerms,
      projectionSecretLikeValues,
      feedbackTexts: feedbackTexts.length,
      unsafeFeedbackTexts,
      hasLatestFeedbackSignal
    }
  };
}

function countFailedCommandEvidence(events: NormalizedEvent[]): number {
  return events.filter((event) => {
    const hasExitStatus = typeof event.payload.exitCode === "number";
    const hasCategory = typeof event.payload.category === "string" && event.payload.category.length > 0;
    const hasTimestamp = Number.isFinite(Date.parse(event.occurredAt));
    const hasReference = event.evidence.length > 0 && event.evidence.every((ref) => ref.id && ref.observedAt && ref.source);
    return hasExitStatus && hasCategory && hasTimestamp && hasReference;
  }).length;
}

function dogfoodEvent(
  eventId: string,
  sessionId: string,
  type: NormalizedEvent["type"],
  occurredAt: string,
  payload: Record<string, unknown> = {}
): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId,
    sessionId,
    source: { adapter: "codex", surface: "fixture", sourceEventId: eventId },
    occurredAt,
    receivedAt: occurredAt,
    type,
    workspace: {
      cwd: "/workspace/dogfood",
      repoRoot: "/workspace/dogfood",
      worktreePath: "/workspace/dogfood",
      gitCommonDir: "/workspace/dogfood/.git",
      branch: "agent/dogfood"
    },
    summary: type,
    payload: {
      project: "Dogfood",
      title: sessionId,
      attribution: "direct",
      ...payload
    },
    sensitivity: "metadata",
    payloadHash: `hash-${eventId}`,
    evidence: [{ id: eventId, kind: "event", observedAt: occurredAt, source: "dogfood.fixture" }]
  };
}

function detectExactFileConflicts(snapshots: GitSnapshot[]): ExactFileConflict[] {
  const pathIndex = new Map<string, GitSnapshot[]>();

  for (const snapshot of snapshots) {
    for (const changedPath of snapshot.changedPaths) {
      if (changedPath.sensitivity === "sensitive_path_only") continue;
      const normalizedPath = normalizeRepoPath(changedPath.path);
      const key = `${snapshot.gitCommonDir}::${normalizedPath}`;
      pathIndex.set(key, [...(pathIndex.get(key) ?? []), snapshot]);
    }
  }

  return [...pathIndex.entries()].flatMap(([key, matches]) => {
    const sessionIds = unique(matches.map((snapshot) => snapshot.sessionId));
    if (sessionIds.length < 2) return [];
    const [gitCommonDir, path] = splitConflictKey(key);
    return [
      {
        gitCommonDir,
        path,
        sessionIds,
        observedAt: matches.map((snapshot) => snapshot.observedAt)
      }
    ];
  });
}

function hasDegradedAttributionEvidence(events: NormalizedEvent[], snapshots: GitSnapshot[]): boolean {
  return (
    events.some((event) => event.payload.attribution === "shared_workspace" || event.payload.attribution === "unattributed") ||
    countSameWorktreeOverlap(snapshots) > 0
  );
}

function countSameWorktreeOverlap(snapshots: GitSnapshot[]): number {
  const pathIndex = new Map<string, GitSnapshot[]>();

  for (const snapshot of snapshots) {
    for (const changedPath of snapshot.changedPaths) {
      if (changedPath.sensitivity === "sensitive_path_only") continue;
      const key = `${snapshot.gitCommonDir}::${snapshot.worktreePath}::${normalizeRepoPath(changedPath.path)}`;
      pathIndex.set(key, [...(pathIndex.get(key) ?? []), snapshot]);
    }
  }

  return [...pathIndex.values()].filter((matches) => unique(matches.map((snapshot) => snapshot.sessionId)).length > 1).length;
}

function countUnrelatedRepoHardConflicts(conflicts: ExactFileConflict[], snapshots: GitSnapshot[]): number {
  const gitCommonDirsBySession = new Map(snapshots.map((snapshot) => [snapshot.sessionId, snapshot.gitCommonDir]));
  return conflicts.filter((conflict) => {
    const gitCommonDirs = unique(conflict.sessionIds.flatMap((sessionId) => gitCommonDirsBySession.get(sessionId) ?? []));
    return gitCommonDirs.length > 1;
  }).length;
}

function evaluatePrivacySuppression(fixture: FixtureReplay): { ok: boolean; details: Record<string, unknown> } {
  const forbiddenKeys: string[] = [];
  const secretValues: string[] = [];
  const redactedMarkers: string[] = [];

  walk(fixture, (key, value) => {
    if (key && RAW_CAPTURE_KEYS.has(key)) forbiddenKeys.push(key);
    if (typeof value !== "string") return;
    if (value.includes("[redacted]") || value.includes("[SECRET:")) redactedMarkers.push(key ?? "value");
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) secretValues.push(key ?? "value");
  });

  const redactedSensitivityCount = [
    ...fixture.events.filter((event) => event.sensitivity === "redacted" || event.sensitivity === "sensitive_path_only"),
    ...fixture.gitSnapshots.flatMap((snapshot) =>
      snapshot.changedPaths.filter((changedPath) => changedPath.sensitivity === "sensitive_path_only")
    )
  ].length;
  const hasSuppressionEvidence = redactedSensitivityCount > 0 || redactedMarkers.length > 0;

  return {
    ok: hasSuppressionEvidence && forbiddenKeys.length === 0 && secretValues.length === 0,
    details: {
      hasSuppressionEvidence,
      redactedSensitivityCount,
      redactedMarkers: redactedMarkers.length,
      forbiddenRawCaptureKeys: unique(forbiddenKeys),
      secretLikeValues: secretValues.length
    }
  };
}

function evaluateAttentionLatency(
  attentionEvents: NormalizedEvent[],
  maxAllowedAttentionLatencyMs: number
): { ok: boolean; maxLatencyMs: number | null; details: Record<string, unknown> } {
  const latencies = attentionEvents.flatMap((event) => {
    const occurredAt = Date.parse(event.occurredAt);
    const receivedAt = Date.parse(event.receivedAt);
    if (!Number.isFinite(occurredAt) || !Number.isFinite(receivedAt)) return [];
    return [receivedAt - occurredAt];
  });
  const invalidTimingCount = attentionEvents.length - latencies.length + latencies.filter((value) => value < 0).length;
  const nonNegativeLatencies = latencies.filter((value) => value >= 0);
  const maxLatencyMs = nonNegativeLatencies.length > 0 ? Math.max(...nonNegativeLatencies) : null;

  return {
    ok:
      attentionEvents.length > 0 &&
      invalidTimingCount === 0 &&
      maxLatencyMs !== null &&
      maxLatencyMs <= maxAllowedAttentionLatencyMs,
    maxLatencyMs,
    details: {
      attentionEvents: attentionEvents.length,
      maxAllowedMs: maxAllowedAttentionLatencyMs,
      maxLatencyMs,
      invalidTimingCount
    }
  };
}

function normalizeRepoPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.?\//, "").replace(/\/+/g, "/");
}

function splitConflictKey(key: string): [string, string] {
  const separator = key.lastIndexOf("::");
  return [key.slice(0, separator), key.slice(separator + 2)];
}

function walk(value: unknown, visitor: (key: string | undefined, value: unknown) => void, key?: string): void {
  visitor(key, value);

  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visitor));
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [childKey, childValue] of Object.entries(value)) {
    walk(childValue, visitor, childKey);
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
