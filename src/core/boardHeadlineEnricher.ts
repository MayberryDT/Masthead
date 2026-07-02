import {
  renderBoardHeadlineFrame,
  type BoardHeadlineFrame,
  type BoardHeadlineView
} from "./boardHeadlineFrame.ts";
import type { BoardHeadlineInput } from "./boardHeadlineInput.ts";
import { buildOfflineBoardHeadlineView, buildPendingBoardHeadlineView } from "./offlineBoardHeadline.ts";
import {
  rewriteBoardHeadlineFrameWithOpenAI,
  type OpenAIBoardHeadlineFrameResult
} from "./openaiBoardHeadlineFrame.ts";
import type { BoardHeadlineRefreshState, LiveBoardProjection, SessionCardView, SessionDetailView, ExpandedSessionView } from "./types.ts";

export const DEFAULT_MODEL = "gpt-5-nano-2025-08-07";

export type BoardHeadlineEnricherConfig = {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  onFrameApplied?: (event: BoardHeadlineAppliedEvent) => void;
};

export type BoardHeadlineAppliedEvent = {
  sessionId: string;
  frame: BoardHeadlineFrame;
  headline: BoardHeadlineView;
  provider: string;
  model: string;
  generatedAt: string;
};

export type BoardHeadlineEnricher = {
  enrichProjection(projection: LiveBoardProjection): Promise<LiveBoardProjection>;
  status(): { enabled: boolean; configured: boolean; model: string };
};

type CacheKey = string;
type ReadyLLMBoardHeadlineView = BoardHeadlineView & {
  frame: BoardHeadlineFrame;
  generatedAt: string;
  model: string;
  provider: "openai";
};

export function createBoardHeadlineEnricher(config: BoardHeadlineEnricherConfig = {}): BoardHeadlineEnricher {
  const model = config.model ?? DEFAULT_MODEL;
  const completed = new Map<CacheKey, ReadyLLMBoardHeadlineView>();
  const failures = new Map<CacheKey, OpenAIBoardHeadlineFrameResult>();
  const inFlight = new Map<CacheKey, Promise<void>>();
  const pendingSessionIds = new Map<CacheKey, Set<string>>();
  const appliedSessionIds = new Map<CacheKey, Set<string>>();

  function status() {
    return {
      enabled: config.enabled === true,
      configured: Boolean(config.apiKey?.trim()),
      model
    };
  }

  async function enrichProjection(projection: LiveBoardProjection): Promise<LiveBoardProjection> {
    const currentStatus = status();
    const generatedAt = nowIso(config.now);
    const overlays = new Map<string, BoardHeadlineView>();
    const refreshOverlays = new Map<string, BoardHeadlineRefreshState>();
    const countedFailedKeys = new Set<CacheKey>();
    const summary = {
      requested: 0,
      succeeded: 0,
      failed: 0,
      pending: 0,
      generatedAt
    };

    for (const card of projection.cards) {
      const input = headlineInput(card);
      if (!input) continue;
      const retained = retainedReadyHeadline(card.headline);

      if (!currentStatus.enabled || !currentStatus.configured) {
        overlays.set(card.sessionId, retained ?? buildOfflineBoardHeadlineView(input));
        if (currentStatus.enabled && !currentStatus.configured) {
          refreshOverlays.set(card.sessionId, {
            provider: "openai",
            requestedAt: generatedAt,
            status: "not_configured"
          });
        }
        continue;
      }

      const key = cacheKey(model, input);
      const cached = completed.get(key);

      if (cached) {
        overlays.set(card.sessionId, cached);
        refreshOverlays.set(card.sessionId, {
          provider: "openai",
          model,
          requestedAt: cached.generatedAt,
          status: "success"
        });
        emitFrameApplied(key, card.sessionId, cached);
        summary.succeeded += 1;
        continue;
      }

      trackPendingSession(key, card.sessionId);

      const failure = failures.get(key);
      if (failure) {
        refreshOverlays.set(card.sessionId, refreshFromFailure(failure, model, generatedAt));
        if (!countedFailedKeys.has(key)) {
          summary.failed += 1;
          countedFailedKeys.add(key);
        }
      }

      if (retained) {
        overlays.set(card.sessionId, retained);
      } else {
        overlays.set(card.sessionId, buildPendingBoardHeadlineView(input));
      }

      summary.pending += 1;
      if (!failure) {
        refreshOverlays.set(card.sessionId, {
          provider: "openai",
          model,
          requestedAt: generatedAt,
          status: "pending"
        });
      }
      if (!inFlight.has(key)) {
        inFlight.set(key, requestHeadline(input, key, card.sessionId));
        summary.requested += 1;
      }
    }

    return {
      ...projection,
      cards: projection.cards.map((card) => overlayCardHeadline(card, overlays, refreshOverlays)),
      expandedSession: projection.expandedSession
        ? overlayExpandedSessionHeadline(projection.expandedSession, overlays, refreshOverlays)
        : undefined,
      selectedSession: projection.selectedSession
        ? overlaySelectedSessionHeadline(projection.selectedSession, overlays, refreshOverlays)
        : undefined,
      headlineRefreshSummary: summary
    };
  }

  async function requestHeadline(input: BoardHeadlineInput, key: CacheKey, sessionId: string): Promise<void> {
    try {
      const result = await rewriteBoardHeadlineFrameWithOpenAI(input, {
        enabled: true,
        apiKey: config.apiKey,
        fetchImpl: config.fetchImpl,
        model,
        timeoutMs: config.timeoutMs
      });

      const view = viewFromOpenAIResult(result, model, nowIso(config.now));
      if (view) {
        completed.set(key, view);
        failures.delete(key);
        for (const pendingSessionId of pendingSessionIds.get(key) ?? [sessionId]) {
          emitFrameApplied(key, pendingSessionId, view);
        }
      } else {
        failures.set(key, result);
      }
    } catch (error) {
      failures.set(key, {
        failureMessage: error instanceof Error ? error.message : "OpenAI board headline frame request failed.",
        status: "api_error"
      });
      // Keep configured LLM mode pending on failures; do not synthesize offline copy here.
    } finally {
      pendingSessionIds.delete(key);
      inFlight.delete(key);
    }
  }

  function trackPendingSession(key: CacheKey, sessionId: string): void {
    const sessionIds = pendingSessionIds.get(key);
    if (sessionIds) {
      sessionIds.add(sessionId);
      return;
    }
    pendingSessionIds.set(key, new Set([sessionId]));
  }

  function emitFrameApplied(key: CacheKey, sessionId: string, view: ReadyLLMBoardHeadlineView): void {
    let sessionIds = appliedSessionIds.get(key);
    if (!sessionIds) {
      sessionIds = new Set();
      appliedSessionIds.set(key, sessionIds);
    }
    if (sessionIds.has(sessionId)) return;

    config.onFrameApplied?.({
      sessionId,
      frame: view.frame,
      headline: view,
      provider: "openai",
      model,
      generatedAt: view.generatedAt
    });
    sessionIds.add(sessionId);
  }

  return {
    enrichProjection,
    status
  };
}

function viewFromOpenAIResult(
  result: OpenAIBoardHeadlineFrameResult,
  model: string,
  generatedAt: string
): ReadyLLMBoardHeadlineView | undefined {
  if (result.status !== "llm" || !result.frame) return undefined;

  const frame: BoardHeadlineFrame = result.frame;
  return {
    headline: renderBoardHeadlineFrame(frame),
    frame,
    source: "llm",
    status: "ready",
    generatedAt,
    model,
    provider: "openai"
  };
}

function headlineInput(card: SessionCardView): BoardHeadlineInput | undefined {
  if (!isBoardHeadlineInput(card.headlineInput)) return undefined;
  return card.headlineInput;
}

function retainedReadyHeadline(headline: BoardHeadlineView): BoardHeadlineView | undefined {
  if (headline.source !== "llm" || headline.status !== "ready") return undefined;
  return headline;
}

function overlayCardHeadline(
  card: SessionCardView,
  overlays: Map<string, BoardHeadlineView>,
  refreshOverlays: Map<string, BoardHeadlineRefreshState>
): SessionCardView {
  const headline = overlays.get(card.sessionId);
  const headlineRefresh = refreshOverlays.get(card.sessionId);
  if (!headline && !headlineRefresh) return card;
  return {
    ...card,
    ...(headline ? { headline } : {}),
    ...(headlineRefresh ? { headlineRefresh } : {})
  };
}

function overlayExpandedSessionHeadline(
  session: ExpandedSessionView,
  overlays: Map<string, BoardHeadlineView>,
  refreshOverlays: Map<string, BoardHeadlineRefreshState>
): ExpandedSessionView {
  const headline = overlays.get(session.sessionId);
  const headlineRefresh = refreshOverlays.get(session.sessionId);
  if (!headline && !headlineRefresh) return session;
  return {
    ...session,
    ...(headline ? { headline } : {}),
    ...(headlineRefresh ? { headlineRefresh } : {})
  };
}

function overlaySelectedSessionHeadline(
  session: SessionDetailView,
  overlays: Map<string, BoardHeadlineView>,
  refreshOverlays: Map<string, BoardHeadlineRefreshState>
): SessionDetailView {
  const headline = overlays.get(session.sessionId);
  const headlineRefresh = refreshOverlays.get(session.sessionId);
  if (!headline && !headlineRefresh) return session;
  return {
    ...session,
    ...(headline ? { headline } : {}),
    ...(headlineRefresh ? { headlineRefresh } : {})
  };
}

function refreshFromFailure(
  result: OpenAIBoardHeadlineFrameResult,
  model: string,
  requestedAt: string
): BoardHeadlineRefreshState {
  return {
    provider: "openai",
    model,
    requestedAt,
    status: refreshStatusFromOpenAI(result.status),
    ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
    ...(result.failureMessage ? { failureMessage: result.failureMessage } : {})
  };
}

function refreshStatusFromOpenAI(status: OpenAIBoardHeadlineFrameResult["status"]): BoardHeadlineRefreshState["status"] {
  switch (status) {
    case "timeout":
      return "timeout";
    case "invalid_output":
      return "invalid_output";
    case "validation_failed":
      return "validation_failed";
    case "not_configured":
      return "not_configured";
    case "api_error":
    case "disabled":
    case "llm":
      return "api_error";
  }
}

function cacheKey(model: string, input: BoardHeadlineInput): CacheKey {
  return JSON.stringify({ model, input });
}

function nowIso(now: BoardHeadlineEnricherConfig["now"]): string {
  return (now?.() ?? new Date()).toISOString();
}

function isBoardHeadlineInput(value: unknown): value is BoardHeadlineInput {
  if (!isRecord(value)) return false;
  if (
    typeof value.lifecycle !== "string" ||
    typeof value.primaryStatus !== "string" ||
    typeof value.stateHint !== "string" ||
    !Array.isArray(value.signals) ||
    !Array.isArray(value.subjectCandidates) ||
    !Array.isArray(value.dispositionHints) ||
    !Array.isArray(value.evidence) ||
    !isRecord(value.facts)
  ) {
    return false;
  }

  return (
    value.signals.every((signal) => typeof signal === "string") &&
    value.subjectCandidates.every((candidate) => typeof candidate === "string") &&
    value.dispositionHints.every((hint) => typeof hint === "string") &&
    value.evidence.every((evidence) => typeof evidence === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
