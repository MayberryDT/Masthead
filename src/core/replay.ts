import { attentionPriority, deriveAttentionItems } from "./attention.ts";
import { buildBoardHeadlineFacts, type BoardTranscriptMessageFact } from "./boardHeadlineFacts.ts";
import { buildBoardBrief } from "./boardBrief.ts";
import type { BoardHeadlineView } from "./boardHeadlineFrame.ts";
import { toBoardHeadlineInput, type BoardHeadlineSignal } from "./boardHeadlineInput.ts";
import { isFailedCommandEvent } from "./commandStatus.ts";
import { detectConflicts, detectSharedResourceConflicts } from "./conflicts.ts";
import { buildOfflineBoardHeadlineView, buildPendingBoardHeadlineView } from "./offlineBoardHeadline.ts";
import { deriveOutcome } from "./outcomes.ts";
import { deriveSessions } from "./sessionReducer.ts";
import { deriveWorkContext } from "./workContext.ts";
import type {
  AttentionItem,
  CommandFailureDetail,
  ConflictCard,
  FixtureReplay,
  GitSnapshot,
  InspectorSectionId,
  LatestFeedbackSignal,
  LatestFeedbackSnapshot,
  LiveBoardProjection,
  NormalizedEvent,
  SessionDetailView,
  SessionCardView,
  SessionOutcomeLabel,
  SessionStatus
} from "./types";

const SAFE_ACTIONS: SessionCardView["safeActions"] = [
  "open_source_session",
  "open_repo",
  "open_readonly_diff",
  "snooze",
  "dismiss",
  "mark_reviewed",
  "mark_expected"
];

type ProjectFixtureOptions = {
  expandedSessionId?: string;
  selectedSessionId?: string | null;
  includeTerminalSessions?: boolean;
  sessionEnrichments?: Map<string, LiveSessionEnrichment>;
  sessionHeadlineViews?: Map<string, BoardHeadlineView>;
  sessionTranscriptFacts?: Map<string, LiveSessionTranscriptFacts>;
  headlineMode?: "llm" | "offline";
  now?: Date;
  idleAfterMs?: number;
};

export type LiveSessionEnrichment = {
  generatedAt?: string;
  title?: string;
  liveSummary?: string;
  subject?: string;
  action?: string;
  object?: string;
  outcome?: string;
  filesChangedSummary?: string;
  commandsSummary?: string;
  verificationSummary?: string;
  topics?: string[];
  technologies?: string[];
  provider?: string;
  model?: string;
  status?: string;
};

export type LiveSessionTranscriptFacts = {
  recentMessages: BoardTranscriptMessageFact[];
  coverage?: {
    hasUsableTranscript?: boolean;
    messages?: number;
  };
};

export function projectFixture(fixture: FixtureReplay, options: ProjectFixtureOptions = {}): LiveBoardProjection {
  const sessions = deriveSessions(fixture.events, fixture.gitSnapshots, {
    now: options.now,
    idleAfterMs: options.idleAfterMs
  });
  const eventsBySession = groupEventsBySession(fixture.events);
  const sessionsWithOutcomes = sessions.map((session) => {
    if (session.lifecycle !== "ended") return session;
    return {
      ...session,
      outcomeLabel: deriveOutcome(session, eventsBySession.get(session.sessionId) ?? []).policyResult.label
    };
  });
  const includeTerminalSessions = options.includeTerminalSessions ?? true;
  const activeSessionIds = sessionsWithOutcomes
    .filter(isActiveSession)
    .map((session) => session.sessionId);
  const conflicts = [
    ...detectConflicts(fixture.gitSnapshots.filter((snapshot) => activeSessionIds.includes(snapshot.sessionId))),
    ...detectSharedResourceConflicts(fixture.events, { activeSessionIds })
  ];
  const derivedAttentionQueue = withFailedCommandDetails(
    deriveAttentionItems(sessionsWithOutcomes, fixture.events, conflicts, fixture.gitSnapshots),
    sessionsWithOutcomes,
    fixture.events
  );
  const activeSessionIdSet = new Set(activeSessionIds);
  const attentionQueue = includeTerminalSessions
    ? derivedAttentionQueue
    : derivedAttentionQueue.filter((item) => activeSessionIdSet.has(item.sessionId));
  const expandedSessionId = options.expandedSessionId ?? fixture.expandedSessionId;
  const selectedSessionId = options.selectedSessionId === null ? undefined : options.selectedSessionId ?? expandedSessionId;
  const cardSessions = includeTerminalSessions ? sessionsWithOutcomes : sessionsWithOutcomes.filter(isActiveSession);
  const cards = cardSessions
    .map((session) => {
      const sessionAttention = attentionQueue.filter((item) => item.sessionId === session.sessionId);
      const sessionConflicts = conflicts.filter((conflict) => conflict.sessionIds.includes(session.sessionId));
      const sessionEvents = eventsBySession.get(session.sessionId) ?? [];
      const sessionSnapshots = fixture.gitSnapshots.filter((snapshot) => snapshot.sessionId === session.sessionId);
      return toCard(
        session,
        sessionAttention,
        sessionConflicts,
        fixture.events,
        sessionEvents,
        sessionSnapshots,
        expandedSessionId,
        options.sessionEnrichments?.get(session.sessionId),
        options.sessionTranscriptFacts?.get(session.sessionId),
        options.headlineMode ?? "llm",
        options.sessionHeadlineViews?.get(session.sessionId)
      );
    })
    .sort((a, b) => a.priorityRank - b.priorityRank || a.project.localeCompare(b.project));
  const expandedSession = cards.find((card) => card.isExpanded) ?? cards[0];
  const selectedCard = selectedSessionId ? cards.find((card) => card.sessionId === selectedSessionId) : undefined;
  const selectedSession = selectedCard
    ? toDetail(
        selectedCard,
        sessionsWithOutcomes.find((session) => session.sessionId === selectedCard.sessionId),
        fixture.events,
        conflicts,
        attentionQueue
      )
    : undefined;
  const lanes = buildLanes(cards, attentionQueue, conflicts);
  const laneCounts = laneCountIndex(lanes);
  const completed = sessionsWithOutcomes.filter((session) => session.lifecycle === "ended" && session.outcomeLabel === "completed").length;

  const projection: LiveBoardProjection = {
    summary: {
      active: sessionsWithOutcomes.filter(isActiveSession).length,
      needsAttention: attentionQueue.filter((item) => !item.resolvedAt && !item.dismissedAt).length,
      conflicts: conflicts.length,
      completed,
      running: laneCounts.running,
      needsAction: laneCounts.needs_action,
      idle: laneCounts.idle
    },
    lanes,
    cards,
    expandedSession: expandedSession
      ? {
          ...expandedSession,
          evidence: {
            observed: sessionsWithOutcomes.find((session) => session.sessionId === expandedSession.sessionId)?.evidence ?? [],
            inferred: [],
            missing: []
          },
          conflicts: conflicts.filter((conflict) => conflict.sessionIds.includes(expandedSession.sessionId)),
          attentionItems: attentionQueue.filter((item) => item.sessionId === expandedSession.sessionId)
        }
      : undefined,
    selectedSession,
    attentionQueue,
    conflicts
  };

  return {
    ...projection,
    brief: buildBoardBrief(projection)
  };
}

function isActiveSession(session: ReturnType<typeof deriveSessions>[number]): boolean {
  return session.lifecycle !== "ended" && session.primaryStatus !== "abandoned";
}

function toCard(
  session: ReturnType<typeof deriveSessions>[number],
  sessionAttention: ReturnType<typeof deriveAttentionItems>,
  sessionConflicts: ConflictCard[],
  events: NormalizedEvent[],
  sessionEvents: NormalizedEvent[],
  sessionSnapshots: GitSnapshot[],
  expandedSessionId?: string,
  enrichment?: LiveSessionEnrichment,
  transcriptFacts?: LiveSessionTranscriptFacts,
  headlineMode: "llm" | "offline" = "llm",
  storedHeadline?: BoardHeadlineView
): SessionCardView {
  const indicators: SessionCardView["indicators"] = [];
  if (sessionAttention.length > 0) indicators.push("attention");
  if (sessionConflicts.length > 0) indicators.push("conflict");
  if (session.flags.includes("no_tests_observed")) indicators.push("verification");
  if (session.flags.includes("high_risk_change")) indicators.push("risk");
  if (session.attribution === "shared_workspace" || session.attribution === "unattributed") indicators.push("degraded");

  const latestFeedback = latestFeedbackForSession(sessionEvents, session.sessionId);
  const feedbackSignal = latestFeedbackSignal(latestFeedback);
  const branchOrWorktree = session.workspace?.branch ?? session.workspace?.worktreePath?.split("/").at(-1);
  const model = latestStringPayload(sessionEvents, ["model", "modelName", "modelId"]);
  const totalTokens = latestNumberPayload(sessionEvents, ["totalTokens", "total_tokens"]);
  const thinkingLevel = normalizedThinkingLevel(
    latestStringPayload(sessionEvents, [
      "thinkingLevel",
      "thinking",
      "modelThinkingLevel",
      "model_thinking_level",
      "reasoningEffort",
      "reasoning_effort",
      "reasoningLevel",
      "reasoning_level",
      "modelReasoningEffort",
      "model_reasoning_effort"
    ])
  );
  const startedAt = firstSessionTimestamp(session.sessionId, events);
  const evidenceTexts = liveCardEvidenceTexts(sessionEvents, sessionSnapshots, feedbackSignal, branchOrWorktree);
  const cardEnrichment = sanitizeLiveCardEnrichment(enrichment, evidenceTexts);
  const title = sanitizeLiveCardTitle(cardEnrichment?.title ?? session.title, evidenceTexts, session.title, session.project);
  const workContext = deriveWorkContext({
    title,
    branchOrWorktree,
    events: sessionEvents,
    gitSnapshots: sessionSnapshots,
    latestFeedbackSignal: feedbackSignal,
    recentTranscriptMessages: transcriptFacts?.recentMessages.map((message) => message.text)
  });

  const card = {
    sessionId: session.sessionId,
    project: session.project,
    title,
    stateLabel: labelForSession(session),
    primaryStatus: session.primaryStatus,
    lifecycle: session.lifecycle,
    outcomeLabel: session.outcomeLabel,
    endReason: session.endReason,
    priorityRank: sessionAttention[0] ? attentionPriority(sessionAttention[0]) : 50,
    durationLabel: durationLabel(session.sessionId, events),
    totalTokens,
    branchOrWorktree,
    model,
    thinkingLevel,
    harness: session.harness ?? "Session",
    runtime: session.runtime,
    sourceSessionId: session.sourceSessionId ?? session.sessionId,
    startedAt,
    lastActivity: session.lastMeaningfulActivityAt,
    lastActivityLabel: relativeAgeLabel(session.lastMeaningfulActivityAt, events),
    changedFileCount: session.changedFileCount,
    attentionReason: sessionAttention[0]?.title,
    indicators,
    identityConfidence: session.attribution,
    safeActions: SAFE_ACTIONS,
    isExpanded: expandedSessionId ? session.sessionId === expandedSessionId : sessionAttention.length > 0,
    workContext,
    latestFeedbackSignal: feedbackSignal
  };

  const facts = buildBoardHeadlineFacts({
    attentionItems: sessionAttention,
    card,
    canonicalEnrichment: cardEnrichment,
    conflicts: sessionConflicts,
    events: sessionEvents,
    gitSnapshots: sessionSnapshots,
    recentTranscriptMessages: transcriptFacts?.recentMessages
  });
  const headlineInput = toBoardHeadlineInput({
    lifecycle: card.lifecycle,
    primaryStatus: card.primaryStatus,
    signals: signalsFromCard(card, sessionAttention, sessionConflicts),
    facts
  });
  const shouldAwaitLlmHeadline = headlineMode === "llm" && card.lifecycle === "running";
  const headline = storedHeadline ?? (shouldAwaitLlmHeadline ? buildPendingBoardHeadlineView(headlineInput) : buildOfflineBoardHeadlineView(headlineInput));
  const enrichedCard = {
    ...card,
    headline,
    headlineInput
  };
  return withEnrichmentHeadline(enrichedCard, cardEnrichment, transcriptFacts, headlineMode);
}

function signalsFromCard(
  card: Pick<SessionCardView, "indicators" | "primaryStatus">,
  attentionItems: AttentionItem[],
  conflicts: ConflictCard[]
): BoardHeadlineSignal[] {
  const signals = new Set<BoardHeadlineSignal>();
  for (const item of attentionItems) {
    if (item.type === "approval_requested") signals.add("approval_waiting");
    if (item.type === "user_question") signals.add("user_reply_waiting");
    if (item.type === "command_failed") signals.add("command_failed");
    if (item.type === "repeated_failure") signals.add("repeated_failure");
    if (item.type === "stalled") signals.add("stalled");
    if (item.type === "completed_without_verification") signals.add("verification_missing");
    if (item.type === "stale_verification") signals.add("verification_stale");
    if (item.type === "high_risk_change") signals.add("high_risk_change");
    if (item.type === "conflict") signals.add("conflict_detected");
  }
  if (card.indicators.includes("risk")) signals.add("high_risk_change");
  if (card.indicators.includes("verification")) signals.add("verification_missing");
  if (card.indicators.includes("conflict") || conflicts.length > 0) signals.add("conflict_detected");
  return [...signals].toSorted();
}

function withEnrichmentHeadline(
  card: SessionCardView,
  _enrichment: LiveSessionEnrichment | undefined,
  _transcriptFacts: LiveSessionTranscriptFacts | undefined,
  _headlineMode: "llm" | "offline"
): SessionCardView {
  return card;
}

function sanitizeLiveCardEnrichment(
  enrichment: LiveSessionEnrichment | undefined,
  evidenceTexts: string[]
): LiveSessionEnrichment | undefined {
  if (!enrichment) return undefined;
  const enrichmentTexts = [
    enrichment.title,
    enrichment.liveSummary,
    enrichment.subject,
    enrichment.action,
    enrichment.object,
    enrichment.outcome,
    enrichment.filesChangedSummary,
    enrichment.commandsSummary,
    enrichment.verificationSummary,
    ...(enrichment.topics ?? []),
    ...(enrichment.technologies ?? [])
  ].filter(isNonEmptyString);
  if (enrichmentTexts.some(mentionsMcp) && !evidenceTexts.some(mentionsMcp)) return undefined;
  return enrichment;
}

function sanitizeLiveCardTitle(title: string, evidenceTexts: string[], fallbackTitle: string, fallbackProject: string): string {
  if (isLowValueLiveTitle(title)) return safeFallbackTitle(fallbackTitle, fallbackProject);
  if (mentionsMcp(title) && !evidenceTexts.some(mentionsMcp)) {
    if (!mentionsMcp(fallbackTitle) && isSafeFallbackTitle(fallbackTitle)) return fallbackTitle;
    if (!mentionsMcp(fallbackProject) && isSafeFallbackTitle(fallbackProject)) return fallbackProject;
    return "Session";
  }
  return title;
}

function isLowValueLiveTitle(value: string): boolean {
  return /^(?:live hook event|desktop transcript activity|runtime signal|unknown|shell|approval\.requested|P\d)$/i.test(value.trim());
}

function isSafeFallbackTitle(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || /^unknown project$/i.test(normalized)) return false;
  if (/^[a-z0-9]+(?:-[a-z0-9]+){2,}$/i.test(normalized)) return false;
  return normalized.length <= 36 && /[a-z]/i.test(normalized);
}

function safeFallbackTitle(fallbackTitle: string, fallbackProject: string): string {
  if (isSafeFallbackTitle(fallbackTitle)) return fallbackTitle;
  if (isSafeFallbackTitle(fallbackProject)) return fallbackProject;
  return "Session";
}

function liveCardEvidenceTexts(
  sessionEvents: NormalizedEvent[],
  sessionSnapshots: GitSnapshot[],
  feedbackSignal: LatestFeedbackSignal | undefined,
  branchOrWorktree: string | undefined
): string[] {
  return [
    branchOrWorktree,
    feedbackSignal?.summary,
    ...sessionEvents.flatMap((event) => [
      event.summary,
      stringPayload(event, "summary"),
      stringPayload(event, "cwd"),
      stringPayload(event, "repoRoot"),
      stringPayload(event, "command"),
      stringPayload(event, "normalizedCommand")
    ]),
    ...sessionSnapshots.flatMap((snapshot) => [
      snapshot.repoRoot,
      snapshot.worktreePath,
      snapshot.branch,
      ...snapshot.changedPaths.map((path) => path.path)
    ])
  ].filter(isNonEmptyString);
}

function stringPayload(event: NormalizedEvent, key: string): string | undefined {
  const value = event.payload[key];
  return typeof value === "string" ? value : undefined;
}

function latestNumberPayload(events: NormalizedEvent[], keys: string[]): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    for (const key of keys) {
      const value = events[index]?.payload[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function mentionsMcp(value: string): boolean {
  return /\bmodel context protocol\b|(?:^|[\s/_.-])mcp(?:$|[\s/_.-])|mcp[A-Z_-]/i.test(value);
}

function toDetail(
  card: SessionCardView,
  session: ReturnType<typeof deriveSessions>[number] | undefined,
  events: NormalizedEvent[],
  conflicts: ConflictCard[],
  attentionQueue: AttentionItem[]
): SessionDetailView {
  const sessionEvents = events
    .filter((event) => event.sessionId === card.sessionId)
    .toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const latestFeedback = latestFeedbackForSession(sessionEvents, card.sessionId);

  return {
    ...card,
    currentActivity: card.attentionReason ?? card.stateLabel,
    latestFeedback,
    inspectorSections: inspectorSectionsFor(latestFeedback),
    reviewAnnotations: [],
    evidence: {
      observed: session?.evidence ?? [],
      inferred: [],
      missing: []
    },
    conflicts: conflicts.filter((conflict) => conflict.sessionIds.includes(card.sessionId)),
    attentionItems: attentionQueue.filter((item) => item.sessionId === card.sessionId),
    timeline: sessionEvents.map((event) => ({
      eventId: event.eventId,
      type: event.type,
      occurredAt: event.occurredAt,
      summary: event.summary
    })),
    workspace: session?.workspace
  };
}

function latestFeedbackForSession(events: NormalizedEvent[], sessionId: string): LatestFeedbackSnapshot | undefined {
  return events
    .filter((event) => event.sessionId === sessionId)
    .toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .map((event) => event.payload.latestFeedbackSnapshot)
    .find(isLatestFeedbackSnapshot);
}

function latestFeedbackSignal(snapshot: LatestFeedbackSnapshot | undefined): LatestFeedbackSignal | undefined {
  if (!snapshot) return undefined;
  const summary = latestFeedbackSummary(snapshot.text);
  return {
    present: true,
    source: snapshot.source,
    observedAt: snapshot.observedAt,
    claims: [...snapshot.claims].toSorted(),
    ...(summary ? { summary } : {})
  };
}

function latestFeedbackSummary(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;

  const markerMatch = normalized.match(/\b(?:what changed|changed|fixed|updated|updates|done):\s*(.+)$/i);
  const source = markerMatch?.[1] ?? normalized;
  const bulletCandidates = [...source.matchAll(/(?:^|\s)[-•]\s+(.+?)(?=\s[-•]\s+|$)/g)].map((match) => match[1] ?? "");
  const sentenceCandidates = source.match(/[^.!?]+[.!?]/g) ?? [source];

  for (const candidate of [...bulletCandidates, ...sentenceCandidates]) {
    const cleaned = cleanFeedbackSummaryCandidate(candidate);
    if (isUsefulFeedbackSummary(cleaned)) return cleaned;
  }

  return undefined;
}

function cleanFeedbackSummaryCandidate(value: string): string {
  const cleaned = value
    .replace(/\[\[([^\]]+)\]\]\([^)]+\)/g, "$1")
    .replace(
      /\b(running|active|idle|blocked|completed|complete|review)\s*\[path\]\s*(running|active|idle|blocked|completed|complete|review)\b/gi,
      "$1 or $2"
    )
    .replace(/\[\/?path\]|\[command\]|\[file\]/gi, "")
    .replace(/\b([a-z]+)\/([a-z]+)\b/gi, "$1 or $2")
    .replace(/\bcommit\s+[a-f0-9]{7,40}\b/gi, "change")
    .replace(/\b[a-f0-9]{7,40}\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function isUsefulFeedbackSummary(value: string): boolean {
  if (value.length < 18 || value.length > 110) return false;
  if (/^done[.!?]?$/i.test(value)) return false;
  if (/\b(now|then|before|after):[.!?]?$/i.test(value)) return false;
  if (/\b(you|your|tyler|urgent|critical|dangerous|please|let'?s|i recommend|we need)\b/i.test(value)) return false;
  if (/\bOPENAI_API_KEY\b|\bsk-[A-Za-z0-9_-]+\b|https?:\/\//i.test(value)) return false;
  if (/[\\/]/.test(value)) return false;
  return /[a-z]/i.test(value) && /[.!?]$/.test(value);
}

function inspectorSectionsFor(latestFeedback: LatestFeedbackSnapshot | undefined): InspectorSectionId[] {
  return latestFeedback
    ? ["state", "latest_feedback", "attention_conflicts", "evidence", "timeline", "actions"]
    : ["state", "attention_conflicts", "evidence", "timeline", "actions"];
}

function isLatestFeedbackSnapshot(value: unknown): value is LatestFeedbackSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LatestFeedbackSnapshot>;
  return (
    typeof candidate.text === "string" &&
    candidate.source === "stop_hook" &&
    typeof candidate.observedAt === "string" &&
    candidate.redacted === true &&
    typeof candidate.bytesIn === "number" &&
    typeof candidate.charsOut === "number" &&
    Array.isArray(candidate.claims) &&
    candidate.claims.every(isLatestFeedbackClaim)
  );
}

function isLatestFeedbackClaim(value: unknown): value is LatestFeedbackSnapshot["claims"][number] {
  return (
    value === "claims_complete" ||
    value === "mentions_blocked" ||
    value === "mentions_tests" ||
    value === "mentions_error" ||
    value === "mentions_files"
  );
}

export function buildLanes(
  cards: SessionCardView[],
  attentionQueue: AttentionItem[],
  conflicts: ConflictCard[]
): NonNullable<LiveBoardProjection["lanes"]> {
  const lanes = [
    { laneId: "running", title: "Running" },
    { laneId: "idle", title: "Idle" },
    { laneId: "needs_action", title: "Needs action" },
    { laneId: "history", title: "History" }
  ] as const;

  return lanes.map((lane) => {
    const sessionIds = cards
      .filter((card) => laneForCard(card, attentionQueue, conflicts) === lane.laneId)
      .map((card) => card.sessionId);
    return {
      laneId: lane.laneId,
      title: lane.title,
      count: sessionIds.length,
      sessionIds
    };
  });
}

function laneForCard(
  card: SessionCardView,
  attentionQueue: AttentionItem[],
  conflicts: ConflictCard[]
): NonNullable<LiveBoardProjection["lanes"]>[number]["laneId"] {
  if (card.lifecycle === "running") return "running";
  if (card.lifecycle === "idle") return "idle";
  if (endedSessionNeedsAction(card, attentionQueue, conflicts)) return "needs_action";
  return "history";
}

function endedSessionNeedsAction(card: SessionCardView, attentionQueue: AttentionItem[], conflicts: ConflictCard[]): boolean {
  if (card.lifecycle !== "ended") return false;
  const unresolvedImmediateAttention = attentionQueue.some(
    (item) => item.sessionId === card.sessionId && immediateAttentionTypes.has(item.type) && !item.resolvedAt && !item.dismissedAt && !item.snoozedUntil
  );
  const hasConflict = conflicts.some((conflict) => conflict.sessionIds.includes(card.sessionId));
  return (
    unresolvedImmediateAttention ||
    hasConflict ||
    card.primaryStatus === "failed" ||
    card.primaryStatus === "blocked" ||
    card.primaryStatus === "waiting_for_user" ||
    card.primaryStatus === "waiting_for_approval" ||
    card.outcomeLabel === "needs_attention" ||
    card.outcomeLabel === "blocked" ||
    card.outcomeLabel === "failed" ||
    card.outcomeLabel === "unknown" ||
    card.endReason === "blocked" ||
    card.endReason === "failed" ||
    card.endReason === "needs_user" ||
    card.endReason === "needs_approval" ||
    card.endReason === "unknown"
  );
}

function laneCountIndex(lanes: NonNullable<LiveBoardProjection["lanes"]>): Record<NonNullable<LiveBoardProjection["lanes"]>[number]["laneId"], number> {
  return lanes.reduce(
    (counts, lane) => ({ ...counts, [lane.laneId]: lane.count }),
    { running: 0, idle: 0, needs_action: 0, history: 0 }
  );
}

const immediateAttentionTypes = new Set<AttentionItem["type"]>([
  "approval_requested",
  "user_question",
  "command_failed",
  "repeated_failure",
  "stalled",
  "high_risk_change",
  "conflict"
]);

function labelForStatus(status: SessionStatus): string {
  return status
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function labelForSession(session: ReturnType<typeof deriveSessions>[number]): string {
  if (session.lifecycle === "running") {
    if (session.primaryStatus === "blocked") return "Blocked";
    if (session.primaryStatus === "waiting_for_approval") return "Needs approval";
    if (session.primaryStatus === "waiting_for_user") return "Needs input";
    return "Running";
  }
  if (session.lifecycle === "idle") return "Idle";
  if (session.outcomeLabel === "completed") return "Completed";
  if (session.outcomeLabel === "needs_attention") return "Needs review";
  if (session.outcomeLabel) return labelForOutcome(session.outcomeLabel);
  return labelForStatus(session.primaryStatus);
}

function labelForOutcome(outcome: SessionOutcomeLabel): string {
  return outcome
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function relativeAgeLabel(timestamp: string, events: NormalizedEvent[]): string {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return timestamp;
  const latest = events
    .map((event) => Date.parse(event.occurredAt))
    .filter((value) => !Number.isNaN(value))
    .toSorted((a, b) => a - b)
    .at(-1);
  const base = latest ?? parsed;
  const elapsedSeconds = Math.max(0, Math.round((base - parsed) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  return `${Math.round(elapsedMinutes / 60)}h ago`;
}

function groupEventsBySession(events: NormalizedEvent[]): Map<string, NormalizedEvent[]> {
  const grouped = new Map<string, NormalizedEvent[]>();
  for (const event of events) {
    if (!event.sessionId) continue;
    grouped.set(event.sessionId, [...(grouped.get(event.sessionId) ?? []), event]);
  }
  return grouped;
}

function withFailedCommandDetails(
  items: AttentionItem[],
  sessions: ReturnType<typeof deriveSessions>,
  events: NormalizedEvent[]
): AttentionItem[] {
  const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]));
  const failedCommands = events.filter((event) => event.sessionId && isFailedCommandEvent(event));
  const detailsBySession = new Map<string, CommandFailureDetail[]>();

  for (const event of failedCommands) {
    const detail = commandFailureDetail(event);
    detailsBySession.set(event.sessionId as string, [...(detailsBySession.get(event.sessionId as string) ?? []), detail]);
  }

  const enrichedItems = items.map((item): AttentionItem => {
    if (item.type !== "command_failed" && item.type !== "repeated_failure") return item;
    const matchingDetails = (detailsBySession.get(item.sessionId) ?? []).filter((detail) =>
      detail.commandId ? item.affectedCommandIds.includes(detail.commandId) : item.evidence.some((ref) => ref.id === detail.evidenceId)
    );
    return matchingDetails.length > 0 ? { ...item, commandDetails: matchingDetails } : item;
  });

  const commandFailedItems: AttentionItem[] = failedCommands.flatMap((event) => {
    if (!event.sessionId) return [];
    const session = sessionsById.get(event.sessionId);
    if (!session) return [];
    const detail = commandFailureDetail(event);
    const commandKey = detail.commandId ?? event.eventId;

    return [
      {
        itemId: `attention:${event.sessionId}:command-failed:${commandKey}`,
        sessionId: event.sessionId,
        project: session.project,
        type: "command_failed",
        severity: "P1",
        title: "Command failed",
        createdAt: event.occurredAt,
        affectedPaths: [],
        affectedCommandIds: detail.commandId ? [detail.commandId] : [],
        evidence: event.evidence,
        support: "deterministic",
        suggestedNextAction: "Inspect the failed command before continuing.",
        commandDetails: [detail]
      }
    ];
  });

  return [...enrichedItems, ...commandFailedItems].toSorted(
    (a, b) => attentionPriority(a) - attentionPriority(b) || a.createdAt.localeCompare(b.createdAt)
  );
}

function commandFailureDetail(event: NormalizedEvent): CommandFailureDetail {
  const detail: CommandFailureDetail = {
    occurredAt: event.occurredAt,
    evidenceId: event.evidence[0]?.id
  };
  if (typeof event.payload.commandId === "string") detail.commandId = event.payload.commandId;
  if (typeof event.payload.category === "string") detail.category = event.payload.category;
  if (typeof event.payload.exitCode === "number") detail.exitCode = event.payload.exitCode;
  return detail;
}

function durationLabel(sessionId: string, events: NormalizedEvent[]): string {
  const timestamps = events
    .filter((event) => event.sessionId === sessionId)
    .map((event) => Date.parse(event.occurredAt))
    .filter((timestamp) => !Number.isNaN(timestamp))
    .toSorted((a, b) => a - b);
  if (timestamps.length < 2) return "0m";

  const elapsedMs = Math.max(0, timestamps.at(-1)! - timestamps[0]);
  return formatDurationMinutes(Math.round(elapsedMs / 60_000));
}

function firstSessionTimestamp(sessionId: string, events: NormalizedEvent[]): string | undefined {
  return events
    .filter((event) => event.sessionId === sessionId)
    .map((event) => event.occurredAt)
    .filter(Boolean)
    .toSorted((a, b) => a.localeCompare(b))
    .at(0);
}

function formatDurationMinutes(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function latestStringPayload(events: NormalizedEvent[], keys: string[]): string | undefined {
  for (const event of events.toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt))) {
    for (const key of keys) {
      const value = event.payload[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return undefined;
}

function normalizedThinkingLevel(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const cleanValue = value.trim();
  const normalized = cleanValue.toLowerCase().replace(/[\s_-]+/g, "_");
  const labels: Record<string, string> = {
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    med: "Medium",
    high: "High",
    xhigh: "Extra High",
    x_high: "Extra High",
    extra_high: "Extra High",
    extrahigh: "Extra High"
  };

  return labels[normalized] ?? cleanValue;
}
