import { buildBoardBrief } from "./boardBrief.ts";
import { buildLanes } from "./replay.ts";
import { buildDeterministicSessionCopy, toSessionCopyInput } from "./sessionCopy.ts";
import type { ReviewDisposition, StoreRecord } from "./store";
import type { AttentionItem, LiveBoardProjection, SafeAction, SessionCardView } from "./types";

export type ReviewSafeAction = Extract<SafeAction, "snooze" | "dismiss" | "mark_reviewed" | "mark_expected">;

export type ReviewDispositionSubject = {
  subjectId: string;
  subjectType: ReviewDisposition["subjectType"];
};

export type CreateReviewDispositionOptions = {
  action: ReviewSafeAction;
  subject: ReviewDispositionSubject;
  recordedAt?: string;
  snoozedUntil?: string;
  reviewer?: string;
  reason?: string;
};

export function createReviewDisposition(options: CreateReviewDispositionOptions): ReviewDisposition {
  const recordedAt = options.recordedAt ?? new Date().toISOString();
  const status = statusForAction(options.action);

  return {
    dispositionId: [
      "review",
      options.subject.subjectType,
      sanitizeRecordPart(options.subject.subjectId),
      status,
      sanitizeRecordPart(recordedAt)
    ].join(":"),
    subjectId: options.subject.subjectId,
    subjectType: options.subject.subjectType,
    status,
    recordedAt,
    ...(status === "snoozed" && options.snoozedUntil ? { snoozedUntil: options.snoozedUntil } : {}),
    ...(options.reviewer ? { reviewer: options.reviewer } : {}),
    ...(options.reason ? { reason: options.reason } : {})
  };
}

export function reviewDispositionRecord(disposition: ReviewDisposition): StoreRecord {
  return {
    recordId: `record:review_disposition:${disposition.dispositionId}`,
    recordType: "review_disposition",
    observedAt: disposition.recordedAt,
    value: disposition
  };
}

export function applyReviewDispositions(
  projection: LiveBoardProjection,
  dispositions: ReviewDisposition[],
  now = new Date()
): LiveBoardProjection {
  if (dispositions.length === 0) return projection;

  const latest = latestActiveDispositions(dispositions, now);
  const visibleAttention = projection.attentionQueue
    .map((item) => applyAttentionDisposition(item, latest))
    .filter((item) => !isSuppressedAttention(item));
  const cards = projection.cards.map((card) =>
    applyCardDisposition(
      card,
      visibleAttention.filter((item) => item.sessionId === card.sessionId),
      latest.session.get(card.sessionId)
    )
  );
  const expandedSession = projection.expandedSession
    ? {
        ...applyCardDisposition(
          projection.expandedSession,
          visibleAttention.filter((item) => item.sessionId === projection.expandedSession?.sessionId),
          latest.session.get(projection.expandedSession.sessionId)
        ),
        evidence: projection.expandedSession.evidence,
        conflicts: projection.expandedSession.conflicts,
        attentionItems: projection.expandedSession.attentionItems
          .map((item) => applyAttentionDisposition(item, latest))
          .filter((item) => !isSuppressedAttention(item))
      }
    : undefined;
  const selectedSession = projection.selectedSession
    ? {
        ...applyCardDisposition(
          projection.selectedSession,
          visibleAttention.filter((item) => item.sessionId === projection.selectedSession?.sessionId),
          latest.session.get(projection.selectedSession.sessionId)
        ),
        currentActivity: projection.selectedSession.currentActivity,
        evidence: projection.selectedSession.evidence,
        conflicts: projection.selectedSession.conflicts,
        attentionItems: projection.selectedSession.attentionItems
          .map((item) => applyAttentionDisposition(item, latest))
          .filter((item) => !isSuppressedAttention(item)),
        timeline: projection.selectedSession.timeline,
        latestFeedback: projection.selectedSession.latestFeedback,
        inspectorSections: projection.selectedSession.inspectorSections,
        workspace: projection.selectedSession.workspace,
        reviewAnnotations: [
          ...projection.selectedSession.reviewAnnotations,
          ...reviewAnnotationsForSession(projection.selectedSession, latest.session.get(projection.selectedSession.sessionId))
        ]
      }
    : undefined;
  const lanes = buildLanes(cards, visibleAttention, projection.conflicts);
  const laneCounts = laneCountIndex(lanes);

  const updatedProjection: LiveBoardProjection = {
    ...projection,
    summary: {
      ...projection.summary,
      needsAttention: visibleAttention.length,
      needsAction: laneCounts.needs_action,
      running: laneCounts.running,
      idle: laneCounts.idle
    },
    lanes,
    cards,
    expandedSession,
    selectedSession,
    attentionQueue: visibleAttention
  };

  return {
    ...updatedProjection,
    brief: buildBoardBrief(updatedProjection)
  };
}

export function isReviewSafeAction(action: SafeAction): action is ReviewSafeAction {
  return action === "snooze" || action === "dismiss" || action === "mark_reviewed" || action === "mark_expected";
}

function statusForAction(action: ReviewSafeAction): ReviewDisposition["status"] {
  if (action === "mark_reviewed") return "reviewed";
  if (action === "mark_expected") return "expected";
  if (action === "snooze") return "snoozed";
  return "dismissed";
}

type ActiveDispositions = {
  attentionItem: Map<string, ReviewDisposition>;
  conflictCard: Map<string, ReviewDisposition>;
  session: Map<string, ReviewDisposition>;
};

function latestActiveDispositions(dispositions: ReviewDisposition[], now: Date): ActiveDispositions {
  const latest: ActiveDispositions = {
    attentionItem: new Map(),
    conflictCard: new Map(),
    session: new Map()
  };

  for (const disposition of dispositions.toSorted((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    const target = mapForSubject(latest, disposition.subjectType);
    if (disposition.status === "snoozed" && disposition.snoozedUntil && Date.parse(disposition.snoozedUntil) <= now.getTime()) {
      target.delete(disposition.subjectId);
    } else {
      target.set(disposition.subjectId, disposition);
    }
  }

  return latest;
}

function mapForSubject(
  dispositions: ActiveDispositions,
  subjectType: ReviewDisposition["subjectType"]
): Map<string, ReviewDisposition> {
  if (subjectType === "attention_item") return dispositions.attentionItem;
  if (subjectType === "conflict_card") return dispositions.conflictCard;
  return dispositions.session;
}

function applyAttentionDisposition(item: AttentionItem, dispositions: ActiveDispositions): AttentionItem {
  const disposition = dispositionForAttention(item, dispositions);
  if (!disposition) return item;

  if (disposition.status === "snoozed") {
    return { ...item, snoozedUntil: disposition.snoozedUntil };
  }

  if (disposition.status === "dismissed" || disposition.status === "false_positive") {
    return { ...item, dismissedAt: disposition.recordedAt };
  }

  return { ...item, resolvedAt: disposition.recordedAt };
}

function applyCardDisposition(
  card: SessionCardView,
  activeAttention: AttentionItem[],
  disposition: ReviewDisposition | undefined
): SessionCardView {
  if (!disposition) {
    const cardWithAttention = activeAttention.length > 0
      ? { ...card, attentionReason: activeAttention[0].title, indicators: withIndicator(card.indicators, "attention") }
      : { ...card, attentionReason: undefined, indicators: withoutIndicator(card.indicators, "attention") };
    return withUpdatedCopy(cardWithAttention, activeAttention);
  }

  const indicators = activeAttention.length > 0 ? withIndicator(card.indicators, "attention") : withoutIndicator(card.indicators, "attention");
  const label = labelForDisposition(disposition);
  const stale = dispositionIsStale(card.lastActivity, disposition.recordedAt);
  const canRewriteCompletedReview =
    !stale && disposition.status === "reviewed" && card.lifecycle === "ended" && card.primaryStatus === "completed_unreviewed";
  const canUseDispositionLabel = !stale && card.lifecycle === "ended";

  return withUpdatedCopy({
    ...card,
    primaryStatus: canRewriteCompletedReview ? "completed_reviewed" : card.primaryStatus,
    outcomeLabel: canRewriteCompletedReview ? "completed" : card.outcomeLabel,
    endReason: canRewriteCompletedReview ? "completed" : card.endReason,
    stateLabel: canUseDispositionLabel && label ? label : card.stateLabel,
    priorityRank: activeAttention.length > 0 ? card.priorityRank : Math.max(card.priorityRank, 50),
    attentionReason: activeAttention[0]?.title,
    indicators
  }, activeAttention);
}

function withUpdatedCopy(card: SessionCardView, activeAttention: AttentionItem[]): SessionCardView {
  return {
    ...card,
    copy: buildDeterministicSessionCopy(toSessionCopyInput(card, activeAttention, []))
  };
}

function reviewAnnotationsForSession(
  card: SessionCardView,
  disposition: ReviewDisposition | undefined
): NonNullable<LiveBoardProjection["selectedSession"]>["reviewAnnotations"] {
  if (!disposition) return [];
  return [
    {
      status: disposition.status,
      recordedAt: disposition.recordedAt,
      stale: dispositionIsStale(card.lastActivity, disposition.recordedAt),
      ...(disposition.reason ? { reason: disposition.reason } : {}),
      ...(disposition.snoozedUntil ? { snoozedUntil: disposition.snoozedUntil } : {})
    }
  ];
}

function dispositionIsStale(lastActivity: string, recordedAt: string): boolean {
  const last = Date.parse(lastActivity);
  const recorded = Date.parse(recordedAt);
  if (Number.isNaN(last) || Number.isNaN(recorded)) return false;
  return last > recorded;
}

function dispositionForAttention(item: AttentionItem, dispositions: ActiveDispositions): ReviewDisposition | undefined {
  const direct = dispositionIfFreshForAttention(item, dispositions.attentionItem.get(item.itemId));
  const session = dispositionIfFreshForAttention(item, dispositions.session.get(item.sessionId));
  const conflict = item.type === "conflict" ? dispositionIfFreshForAttention(item, conflictDispositionForAttention(item, dispositions)) : undefined;
  return direct ?? conflict ?? session;
}

function conflictDispositionForAttention(
  item: AttentionItem,
  dispositions: ActiveDispositions
): ReviewDisposition | undefined {
  for (const [conflictId, disposition] of dispositions.conflictCard) {
    if (item.itemId.endsWith(`:${conflictId}`)) return disposition;
  }
  return undefined;
}

function isSuppressedAttention(item: AttentionItem): boolean {
  return Boolean(item.resolvedAt || item.dismissedAt || item.snoozedUntil);
}

function dispositionIfFreshForAttention(
  item: AttentionItem,
  disposition: ReviewDisposition | undefined
): ReviewDisposition | undefined {
  if (!disposition) return undefined;
  return dispositionIsStale(item.createdAt, disposition.recordedAt) ? undefined : disposition;
}

function laneCountIndex(
  lanes: NonNullable<LiveBoardProjection["lanes"]>
): Record<NonNullable<LiveBoardProjection["lanes"]>[number]["laneId"], number> {
  return lanes.reduce(
    (counts, lane) => ({ ...counts, [lane.laneId]: lane.count }),
    { running: 0, idle: 0, needs_action: 0, history: 0 }
  );
}

function labelForDisposition(disposition: ReviewDisposition): string | undefined {
  const labels: Partial<Record<ReviewDisposition["status"], string>> = {
    reviewed: "Reviewed",
    expected: "Expected",
    dismissed: "Dismissed",
    false_positive: "False positive",
    snoozed: "Snoozed"
  };
  return labels[disposition.status];
}

function withIndicator(
  indicators: SessionCardView["indicators"],
  indicator: SessionCardView["indicators"][number]
): SessionCardView["indicators"] {
  return indicators.includes(indicator) ? indicators : [...indicators, indicator];
}

function withoutIndicator(
  indicators: SessionCardView["indicators"],
  indicator: SessionCardView["indicators"][number]
): SessionCardView["indicators"] {
  return indicators.filter((item) => item !== indicator);
}

function sanitizeRecordPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
