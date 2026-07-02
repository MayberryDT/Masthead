import type { AttentionItem, LiveBoardProjection, SessionCardView } from "../core/types";
import { isBlockedSessionCard } from "./format";
import type { HarnessFilter, LifecycleFilter, SortMode } from "./toolbarOptions";

export type BoardFilter = "all" | "needs_attention" | "conflicts";

export type BoardFilterOptions = {
  query: string;
  filter: BoardFilter;
  harness?: HarnessFilter;
  lifecycle?: LifecycleFilter;
  sort?: SortMode;
};

export type MainScanOptions = {
  now?: Date;
  activityWindowMs?: number;
};

export const MAIN_SCAN_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function filterCards(cards: SessionCardView[], options: BoardFilterOptions): SessionCardView[] {
  const query = normalize(options.query);
  const harness = options.harness ?? "all";
  const lifecycle = options.lifecycle ?? "all";
  const sort = options.sort ?? "operational_priority";

  return cards
    .filter((card) => {
      if (options.filter === "needs_attention" && !card.indicators.includes("attention")) return false;
      if (options.filter === "conflicts" && !card.indicators.includes("conflict")) return false;
      if (harness === "codex" && normalizedHarness(card) !== "codex") return false;
      if (!matchesLifecycle(card, lifecycle)) return false;
      if (!query) return true;

      return searchableText(card).includes(query);
    })
    .sort((a, b) => compareCardsForSort(a, b, sort));
}

export function mainScanCards(cards: SessionCardView[], options: MainScanOptions = {}): SessionCardView[] {
  const now = options.now ?? new Date();
  const activityWindowMs = options.activityWindowMs ?? MAIN_SCAN_ACTIVITY_WINDOW_MS;

  return cards
    .flatMap((card) => scanCardForMainView(card, now, activityWindowMs))
    .sort((a, b) => compareLastActivityDesc(a, b));
}

export function summarizeMainScanCards(cards: SessionCardView[]): LiveBoardProjection["summary"] {
  const blocked = cards.filter(isBlockedScanCard).length;
  const idle = cards.filter((card) => card.lifecycle === "idle" && !isBlockedScanCard(card)).length;
  const running = cards.filter((card) => card.lifecycle === "running" && !isBlockedScanCard(card)).length;

  return {
    active: running,
    needsAttention: blocked,
    conflicts: cards.filter((card) => card.indicators.includes("conflict")).length,
    completed: 0,
    running,
    idle,
    needsAction: blocked
  };
}

export function filterAttentionItemsForCards(items: AttentionItem[], cards: Pick<SessionCardView, "sessionId">[]): AttentionItem[] {
  const visibleSessionIds = new Set(cards.map((card) => card.sessionId));
  return items.filter((item) => visibleSessionIds.has(item.sessionId));
}

function searchableText(card: SessionCardView): string {
  return normalize(
    [
      card.sessionId,
      card.project,
      card.title,
      card.workContext?.label,
      ...(card.workContext?.pathClusters ?? []),
      card.headline.headline,
      card.headline.status,
      card.headline.source,
      card.headline.frame?.subject,
      card.headline.frame?.disposition,
      card.headline.frame?.state,
      ...(card.headline.frame?.evidence ?? []),
      card.stateLabel,
      card.primaryStatus,
      card.branchOrWorktree,
      card.lastActivity,
      card.attentionReason,
      card.identityConfidence,
      card.indicators.join(" ")
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function normalizedHarness(card: SessionCardView): string {
  return normalize(card.harness ?? "Codex");
}

function matchesLifecycle(card: SessionCardView, lifecycle: LifecycleFilter): boolean {
  if (lifecycle === "all") return true;
  if (lifecycle === "blocked") return isBlockedScanCard(card);
  if (lifecycle === "running") return card.lifecycle === "running" && !isBlockedScanCard(card);
  return card.lifecycle === "idle" && !isBlockedScanCard(card);
}

function isBlockedScanCard(card: SessionCardView): boolean {
  return isBlockedSessionCard(card);
}

function scanCardForMainView(card: SessionCardView, now: Date, activityWindowMs: number): SessionCardView[] {
  if (!isRecentActivity(card.lastActivity, now, activityWindowMs)) return [];
  if (card.lifecycle !== "ended") return [card];
  if (isBlockedScanCard(card)) return [card];

  return [
    {
      ...card,
      lifecycle: "idle",
      primaryStatus: "stalled",
      stateLabel: "Idle",
      outcomeLabel: undefined,
      endReason: undefined,
      attentionReason: undefined,
      indicators: []
    }
  ];
}

function isRecentActivity(lastActivity: string, now: Date, activityWindowMs: number): boolean {
  const lastActivityMs = Date.parse(lastActivity);
  if (!Number.isFinite(lastActivityMs)) return false;
  const ageMs = now.getTime() - lastActivityMs;
  return ageMs >= 0 && ageMs <= activityWindowMs;
}

function compareLastActivityDesc(a: SessionCardView, b: SessionCardView): number {
  const activityDelta = lastActivityTime(b) - lastActivityTime(a);
  if (activityDelta !== 0) return activityDelta;

  const priorityDelta = a.priorityRank - b.priorityRank;
  if (priorityDelta !== 0) return priorityDelta;

  return a.sessionId.localeCompare(b.sessionId);
}

function operationalBucket(card: SessionCardView): number {
  if (isBlockedScanCard(card)) return 0;
  if (card.indicators.includes("attention") || card.indicators.includes("conflict")) return 0;
  if (card.lifecycle === "running") return 1;
  if (card.lifecycle === "idle") return 2;
  return 3;
}

function compareOperationalPriority(a: SessionCardView, b: SessionCardView): number {
  const bucketDelta = operationalBucket(a) - operationalBucket(b);
  if (bucketDelta !== 0) return bucketDelta;

  const priorityDelta = a.priorityRank - b.priorityRank;
  if (priorityDelta !== 0) return priorityDelta;

  return compareLastActivityDesc(a, b);
}

function compareCardsForSort(a: SessionCardView, b: SessionCardView, sort: SortMode): number {
  if (sort === "operational_priority") {
    return compareOperationalPriority(a, b);
  }

  if (sort === "recently_started") {
    const startedDelta = timestampForSort(b.startedAt ?? b.lastActivity) - timestampForSort(a.startedAt ?? a.lastActivity);
    if (startedDelta !== 0) return startedDelta;
  }

  return compareLastActivityDesc(a, b);
}

function lastActivityTime(card: Pick<SessionCardView, "lastActivity">): number {
  const timestamp = Date.parse(card.lastActivity);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function timestampForSort(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[_/.-]+/g, " ");
}
