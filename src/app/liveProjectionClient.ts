import type { LiveProjectionEnvelope } from "../core/liveProjection";
import { buildBoardBrief } from "../core/boardBrief";
import { buildDeterministicSessionCopy, toSessionCopyInput, validateSessionCopy } from "../core/sessionCopy";
import type {
  AttentionItem,
  ConflictCard,
  ExpandedSessionView,
  GitSnapshot,
  LifecycleLaneId,
  LiveBoardProjection,
  NormalizedEvent,
  SessionCardView,
  SessionDetailView,
  SessionPlainCopy
} from "../core/types";

type ProjectionEnv = {
  VITE_MASTHEAD_MODE?: string;
  VITE_MASTHEAD_PROJECTION_URL?: string;
};

type EnvWithProjectionUrl = ImportMeta & {
  env?: {
    VITE_MASTHEAD_MODE?: string;
    VITE_MASTHEAD_PROJECTION_URL?: string;
  };
};

export function defaultLiveProjectionUrl(meta: ImportMeta = import.meta): string {
  return importMetaEnv(meta).VITE_MASTHEAD_PROJECTION_URL ?? "http://127.0.0.1:17373/projection";
}
export function normalizeDaemonBaseUrl(inputUrl: string): string {
  const url = new URL(inputUrl);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}


export function defaultFixtureMode(meta: ImportMeta = import.meta, search = locationSearch()): boolean {
  const envMode = importMetaEnv(meta).VITE_MASTHEAD_MODE?.toLowerCase();
  if (envMode === "fixture" || envMode === "demo") return true;

  const params = new URLSearchParams(search);
  return params.get("mode") === "fixture" || params.get("mode") === "demo" || params.get("demo") === "1";
}

export function projectionRequestUrl(
  baseUrl: string,
  selectedSessionId?: string | null,
  options: { refreshIntervalMs?: number } = {}
): string {
  const url = new URL(baseUrl);
  url.pathname = "/projection";
  url.searchParams.delete("expandedSessionId");
  if (selectedSessionId) {
    url.searchParams.set("selectedSessionId", selectedSessionId);
  } else {
    url.searchParams.delete("selectedSessionId");
  }
  if (options.refreshIntervalMs !== undefined) {
    url.searchParams.set("refreshIntervalMs", String(options.refreshIntervalMs));
  } else {
    url.searchParams.delete("refreshIntervalMs");
  }
  return url.toString();
}

export function eventsRequestUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = "/events";
  url.search = "";
  return url.toString();
}

export function retentionRequestUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = "/retention";
  url.search = "";
  return url.toString();
}

export function clearRequestUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = "/clear";
  url.search = "";
  return url.toString();
}

export function healthRequestUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = "/health";
  url.search = "";
  return url.toString();
}

export function isLiveProjectionEnvelope(value: unknown): value is LiveProjectionEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === true &&
    "source" in value &&
    value.source === "live" &&
    "projection" in value &&
    typeof value.projection === "object" &&
    value.projection !== null
  );
}

export function normalizeLiveBoardProjection(
  projection: LiveBoardProjection,
  selectedSessionId?: string | null
): LiveBoardProjection {
  const attentionBySession = groupAttentionBySession(projection.attentionQueue);
  const conflictsBySession = groupConflictsBySession(projection.conflicts);
  const cards = projection.cards.map((card) =>
    normalizeCardCopy(card, attentionBySession.get(card.sessionId) ?? [], conflictsBySession.get(card.sessionId) ?? [])
  );
  const expandedSession = projection.expandedSession
    ? normalizeCardCopy(projection.expandedSession, projection.expandedSession.attentionItems, projection.expandedSession.conflicts)
    : undefined;
  const selectedSession =
    selectedSessionId === null
      ? undefined
      : (projection.selectedSession
          ? normalizeCardCopy(projection.selectedSession, projection.selectedSession.attentionItems, projection.selectedSession.conflicts)
          : undefined) ?? legacySelectedSession(selectedSessionId, expandedSession, cards, attentionBySession, conflictsBySession);
  const laneSessionIds: Record<LifecycleLaneId, string[]> = {
    running: [],
    idle: [],
    needs_action: [],
    history: []
  };

  for (const card of cards) {
    laneSessionIds[laneForCard(card)].push(card.sessionId);
  }

  const lanes = lifecycleLaneOrder.map((laneId) => ({
    laneId,
    title: lifecycleLaneTitles[laneId],
    count: laneSessionIds[laneId].length,
    sessionIds: laneSessionIds[laneId]
  }));

  const normalizedProjection: LiveBoardProjection = {
    ...projection,
    summary: {
      ...projection.summary,
      running: laneSessionIds.running.length,
      idle: laneSessionIds.idle.length,
      needsAction: laneSessionIds.needs_action.length
    },
    lanes,
    cards,
    expandedSession,
    selectedSession
  };

  return {
    ...normalizedProjection,
    brief: normalizedProjection.brief ?? buildBoardBrief(normalizedProjection, "fallback")
  };
}

function locationSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

function importMetaEnv(meta: ImportMeta): ProjectionEnv {
  if (meta === import.meta) {
    return {
      VITE_MASTHEAD_MODE: import.meta.env.VITE_MASTHEAD_MODE,
      VITE_MASTHEAD_PROJECTION_URL: import.meta.env.VITE_MASTHEAD_PROJECTION_URL
    };
  }

  return (meta as EnvWithProjectionUrl).env ?? {};
}

export type LiveEventsEnvelope = {
  ok: true;
  events: NormalizedEvent[];
  gitSnapshots: GitSnapshot[];
  diagnostics: unknown[];
};

export function isLiveEventsEnvelope(value: unknown): value is LiveEventsEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === true &&
    "events" in value &&
    Array.isArray(value.events) &&
    "gitSnapshots" in value &&
    Array.isArray(value.gitSnapshots)
  );
}

const lifecycleLaneOrder: LifecycleLaneId[] = ["running", "idle", "needs_action", "history"];
const lifecycleLaneTitles: Record<LifecycleLaneId, string> = {
  running: "Running",
  idle: "Idle",
  needs_action: "Needs action",
  history: "History"
};

function normalizeCardCopy<T extends SessionCardView | SessionDetailView>(
  card: T,
  attentionItems: AttentionItem[],
  conflicts: ConflictCard[]
): T {
  const input = toSessionCopyInput(card, attentionItems, conflicts);
  const existingCopy = (card as { copy?: unknown }).copy;
  if (isSessionPlainCopy(existingCopy)) {
    const validation = validateSessionCopy(existingCopy, input, existingCopy.source ?? "fallback");
    if (validation.ok) return { ...card, copy: validation.copy };
  }

  return {
    ...card,
    copy: buildDeterministicSessionCopy(input, "fallback")
  };
}

function legacySelectedSession(
  selectedSessionId: string | null | undefined,
  expandedSession: ExpandedSessionView | undefined,
  cards: SessionCardView[],
  attentionBySession: Map<string, AttentionItem[]>,
  conflictsBySession: Map<string, ConflictCard[]>
): SessionDetailView | undefined {
  if (selectedSessionId === null) return undefined;
  if (!selectedSessionId) return undefined;
  if (expandedSession?.sessionId === selectedSessionId) {
    return detailFromCard(expandedSession, expandedSession.attentionItems, expandedSession.conflicts, expandedSession.evidence);
  }

  const card = cards.find((candidate) => candidate.sessionId === selectedSessionId);
  if (!card) return undefined;

  const attentionItems = attentionBySession.get(selectedSessionId) ?? [];
  return detailFromCard(card, attentionItems, conflictsBySession.get(selectedSessionId) ?? []);
}

function detailFromCard(
  card: SessionCardView,
  attentionItems: AttentionItem[],
  conflicts: ConflictCard[],
  evidence: SessionDetailView["evidence"] = { observed: [], inferred: [], missing: [] }
): SessionDetailView {
  return {
    ...card,
    currentActivity: card.attentionReason ?? card.copy.status,
    inspectorSections: card.latestFeedbackSignal
      ? ["state", "latest_feedback", "attention_conflicts", "evidence", "timeline", "actions"]
      : ["state", "attention_conflicts", "evidence", "timeline", "actions"],
    reviewAnnotations: [],
    evidence,
    conflicts,
    attentionItems,
    timeline: []
  };
}

function laneForCard(card: SessionCardView): LifecycleLaneId {
  if (card.lifecycle === "running") return "running";
  if (card.lifecycle === "idle") return "idle";
  if (endedSessionNeedsAction(card)) return "needs_action";
  return "history";
}

function endedSessionNeedsAction(card: SessionCardView): boolean {
  if (card.lifecycle !== "ended") return false;
  if (card.primaryStatus === "failed" || card.primaryStatus === "blocked") return true;
  if (card.primaryStatus === "waiting_for_user" || card.primaryStatus === "waiting_for_approval") return true;
  if (card.primaryStatus === "completed_unreviewed") return true;
  if (card.outcomeLabel === "failed" || card.outcomeLabel === "blocked") return true;
  if (card.outcomeLabel === "needs_attention" || card.outcomeLabel === "unknown") return true;
  if (card.endReason && card.endReason !== "completed") return true;
  return card.indicators.some((indicator) => indicator === "attention" || indicator === "conflict" || indicator === "verification");
}

function groupAttentionBySession(items: AttentionItem[]): Map<string, AttentionItem[]> {
  const groups = new Map<string, AttentionItem[]>();
  for (const item of items) {
    const group = groups.get(item.sessionId) ?? [];
    group.push(item);
    groups.set(item.sessionId, group);
  }
  return groups;
}

function groupConflictsBySession(conflicts: ConflictCard[]): Map<string, ConflictCard[]> {
  const groups = new Map<string, ConflictCard[]>();
  for (const conflict of conflicts) {
    for (const sessionId of conflict.sessionIds) {
      const group = groups.get(sessionId) ?? [];
      group.push(conflict);
      groups.set(sessionId, group);
    }
  }
  return groups;
}

function isSessionPlainCopy(value: unknown): value is SessionPlainCopy {
  return (
    typeof value === "object" &&
    value !== null &&
    "headline" in value &&
    typeof value.headline === "string" &&
    "status" in value &&
    typeof value.status === "string" &&
    "reason" in value &&
    typeof value.reason === "string"
  );
}
