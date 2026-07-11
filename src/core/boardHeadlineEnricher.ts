import { createHash } from "node:crypto";
import {
  renderBoardHeadlineFrame,
  type BoardHeadlineFrame,
  type BoardHeadlineView
} from "./boardHeadlineFrame.ts";
import type { BoardHeadlineInput } from "./boardHeadlineInput.ts";
import { boardHeadlineRefreshKey } from "./boardHeadlineRefreshKey.ts";
import { buildOfflineBoardHeadlineView, buildPendingBoardHeadlineView } from "./offlineBoardHeadline.ts";
import {
  rewriteBoardHeadlineFrameWithOpenAI,
  type BoardHeadlineFrameApiStyle,
  type OpenAIBoardHeadlineFrameResult
} from "./openaiBoardHeadlineFrame.ts";
import type { BoardHeadlineRefreshState, LiveBoardProjection, SessionCardView, SessionDetailView, ExpandedSessionView } from "./types.ts";

export const DEFAULT_MODEL = "gpt-5-nano-2025-08-07";

export type BoardHeadlineProviderConfig = {
  enabled?: boolean;
  configured?: boolean;
  provider?: string;
  providerLabel?: string;
  apiKey?: string;
  apiKeyRequired?: boolean;
  apiStyle?: BoardHeadlineFrameApiStyle;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  unsupportedReason?: string;
};

export type BoardHeadlineEnricherConfig = BoardHeadlineProviderConfig & {
  providerConfig?: () => BoardHeadlineProviderConfig;
  now?: () => Date;
  onFrameApplied?: (event: BoardHeadlineAppliedEvent) => void;
  onGenerationFinished?: (event: BoardHeadlineGenerationFinishedEvent) => void;
};

export type BoardHeadlineAppliedEvent = {
  sessionId: string;
  frame: BoardHeadlineFrame;
  headline: BoardHeadlineView;
  provider: string;
  model: string;
  generatedAt: string;
};

export type BoardHeadlineGenerationFinishedEvent = {
  sessionId: string;
  input: BoardHeadlineInput;
  provider: string;
  model: string;
  refreshKey: string;
  requestedAt: string;
  completedAt: string;
  status: "success" | OpenAIBoardHeadlineFrameResult["status"];
  frame?: BoardHeadlineFrame;
  headline?: BoardHeadlineView;
  failureMessage?: string;
  latencyMs?: number;
};

export type BoardHeadlineEnrichProjectionOptions = {
  refreshIntervalMs?: number;
};

export type BoardHeadlineEnricherStatus = {
  enabled: boolean;
  configured: boolean;
  model: string;
  provider: string;
  apiStyle: BoardHeadlineFrameApiStyle;
  unsupportedReason?: string;
};

export type BoardHeadlineEnricher = {
  enrichProjection(projection: LiveBoardProjection, options?: BoardHeadlineEnrichProjectionOptions): Promise<LiveBoardProjection>;
  status(): BoardHeadlineEnricherStatus;
};

type CacheKey = string;
type ReadyLLMBoardHeadlineView = BoardHeadlineView & {
  frame: BoardHeadlineFrame;
  generatedAt: string;
  model: string;
  provider: string;
};

type ResolvedBoardHeadlineProvider = {
  enabled: boolean;
  configured: boolean;
  provider: string;
  providerLabel: string;
  apiKey?: string;
  apiKeyRequired: boolean;
  apiStyle: BoardHeadlineFrameApiStyle;
  baseUrl?: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  unsupportedReason?: string;
};

export function createBoardHeadlineEnricher(config: BoardHeadlineEnricherConfig = {}): BoardHeadlineEnricher {
  const completed = new Map<CacheKey, ReadyLLMBoardHeadlineView>();
  const failures = new Map<CacheKey, OpenAIBoardHeadlineFrameResult>();
  const inFlight = new Map<CacheKey, Promise<void>>();
  const pendingSessionIds = new Map<CacheKey, Set<string>>();
  const appliedSessionIds = new Map<CacheKey, Set<string>>();
  const lastRequestedAtBySession = new Map<string, number>();

  function currentProvider(): ResolvedBoardHeadlineProvider {
    const providerConfig = config.providerConfig?.() ?? config;
    const provider = providerConfig.provider ?? config.provider ?? "openai";
    const providerLabel = providerConfig.providerLabel ?? (provider === "openai" ? "OpenAI" : provider);
    const apiKey = providerConfig.apiKey ?? config.apiKey;
    const apiKeyRequired = providerConfig.apiKeyRequired ?? config.apiKeyRequired ?? true;
    const configured =
      providerConfig.configured ??
      (Boolean(providerConfig.model ?? config.model ?? DEFAULT_MODEL) && (!apiKeyRequired || Boolean(apiKey?.trim())));
    const unsupportedReason = providerConfig.unsupportedReason ?? config.unsupportedReason;
    return {
      enabled: (providerConfig.enabled ?? config.enabled) === true,
      configured: configured && !unsupportedReason,
      provider,
      providerLabel,
      apiKey,
      apiKeyRequired,
      apiStyle: providerConfig.apiStyle ?? config.apiStyle ?? "responses",
      baseUrl: providerConfig.baseUrl ?? config.baseUrl,
      model: providerConfig.model ?? config.model ?? DEFAULT_MODEL,
      fetchImpl: providerConfig.fetchImpl ?? config.fetchImpl,
      timeoutMs: providerConfig.timeoutMs ?? config.timeoutMs,
      unsupportedReason
    };
  }

  function status() {
    const provider = currentProvider();
    return {
      enabled: provider.enabled,
      configured: provider.configured,
      model: provider.model,
      provider: provider.provider,
      apiStyle: provider.apiStyle,
      ...(provider.unsupportedReason ? { unsupportedReason: provider.unsupportedReason } : {})
    };
  }

  async function enrichProjection(
    projection: LiveBoardProjection,
    options: BoardHeadlineEnrichProjectionOptions = {}
  ): Promise<LiveBoardProjection> {
    const provider = currentProvider();
    const projectionNow = config.now?.() ?? new Date();
    const generatedAt = projectionNow.toISOString();
    const nowMs = projectionNow.getTime();
    const requestCooldownMs = effectiveHeadlineRequestCooldownMs(options.refreshIntervalMs);
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

      if (!provider.enabled || !provider.configured) {
        overlays.set(card.sessionId, retained ?? buildOfflineBoardHeadlineView(input));
        if (provider.enabled && !provider.configured) {
          refreshOverlays.set(card.sessionId, {
            provider: provider.provider,
            model: provider.model,
            requestedAt: generatedAt,
            status: "not_configured",
            ...(provider.unsupportedReason ? { failureMessage: provider.unsupportedReason } : {})
          });
        }
        continue;
      }

      const key = boardHeadlineRefreshKey(`${provider.provider}:${provider.model}`, input);
      const canRequestHeadline = shouldRequestHeadlineForCard(card);
      const showPendingHeadline = shouldShowPendingHeadlineForCard(card);
      if (!key) {
        if (showPendingHeadline) {
          overlays.set(card.sessionId, retained ?? buildOfflineBoardHeadlineView(input));
          refreshOverlays.set(card.sessionId, {
            provider: provider.provider,
            model: provider.model,
            requestedAt: generatedAt,
            status: "pending",
            failureMessage: "Waiting for transcript evidence before refreshing Board headline."
          });
          summary.pending += 1;
        } else {
          overlays.set(card.sessionId, retained ?? buildOfflineBoardHeadlineView(input));
        }
        continue;
      }

      const retainedRefreshKeyHash = retained?.refreshKeyHash;
      const currentRefreshKeyHash = createHash("sha256").update(key).digest("hex");
      if (retainedRefreshKeyHash && retainedRefreshKeyHash === currentRefreshKeyHash) {
        overlays.set(card.sessionId, { ...retained, freshness: "fresh" });
        refreshOverlays.set(card.sessionId, {
          provider: retained.provider,
          model: retained.model,
          requestedAt: retained.generatedAt ?? generatedAt,
          status: "success",
          freshness: "fresh"
        });
        summary.succeeded += 1;
        continue;
      }

      const cached = completed.get(key);

      if (cached) {
        overlays.set(card.sessionId, cached);
        refreshOverlays.set(card.sessionId, {
          provider: cached.provider,
          model: cached.model,
          requestedAt: cached.generatedAt,
          status: "success",
          freshness: "fresh"
        });
        emitFrameApplied(key, card.sessionId, cached);
        summary.succeeded += 1;
        continue;
      }

      if (!canRequestHeadline) {
        overlays.set(card.sessionId, retained ?? buildOfflineBoardHeadlineView(input));
        continue;
      }

      trackPendingSession(key, card.sessionId);

      const failure = failures.get(key);
      if (failure && showPendingHeadline) {
        refreshOverlays.set(card.sessionId, refreshFromFailure(failure, provider, generatedAt));
        if (!countedFailedKeys.has(key)) {
          summary.failed += 1;
          countedFailedKeys.add(key);
        }
      }

      if (retained) {
        overlays.set(card.sessionId, retained.refreshKeyHash ? { ...retained, status: "pending", freshness: "stale" } : retained);
      } else if (showPendingHeadline) {
        overlays.set(card.sessionId, buildPendingBoardHeadlineView(input));
      } else {
        overlays.set(card.sessionId, buildOfflineBoardHeadlineView(input));
      }

      if (showPendingHeadline) {
        summary.pending += 1;
      }
      if (!failure && showPendingHeadline) {
        refreshOverlays.set(card.sessionId, {
          provider: provider.provider,
          model: provider.model,
          requestedAt: generatedAt,
          status: "pending"
        });
      }
      const canRequestNow = requestAllowedForSession(lastRequestedAtBySession, card.sessionId, nowMs, requestCooldownMs);
      if (!canRequestNow) {
        continue;
      }
      if (!inFlight.has(key)) {
        lastRequestedAtBySession.set(card.sessionId, nowMs);
        inFlight.set(key, requestHeadline(input, key, card.sessionId, provider));
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

  async function requestHeadline(
    input: BoardHeadlineInput,
    key: CacheKey,
    sessionId: string,
    provider: ResolvedBoardHeadlineProvider
  ): Promise<void> {
    const requestedAt = nowIso(config.now);
    try {
      const result = await rewriteBoardHeadlineFrameWithOpenAI(input, {
        enabled: true,
        apiKey: provider.apiKey,
        apiKeyRequired: provider.apiKeyRequired,
        apiStyle: provider.apiStyle,
        baseUrl: provider.baseUrl,
        fetchImpl: provider.fetchImpl,
        model: provider.model,
        providerId: provider.provider,
        providerLabel: provider.providerLabel,
        timeoutMs: provider.timeoutMs
      });

      const completedAt = nowIso(config.now);
      const view = viewFromOpenAIResult(result, provider.provider, provider.model, completedAt);
      emitGenerationFinished(key, sessionId, input, result, view, requestedAt, completedAt, provider);
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
      const result: OpenAIBoardHeadlineFrameResult = {
        failureMessage: error instanceof Error ? error.message : `${provider.providerLabel} board headline frame request failed.`,
        status: "api_error"
      };
      failures.set(key, result);
      emitGenerationFinished(
        key,
        sessionId,
        input,
        result,
        undefined,
        requestedAt,
        nowIso(config.now),
        provider
      );
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
      provider: view.provider,
      model: view.model,
      generatedAt: view.generatedAt
    });
    sessionIds.add(sessionId);
  }

  function emitGenerationFinished(
    key: CacheKey,
    sessionId: string,
    input: BoardHeadlineInput,
    result: OpenAIBoardHeadlineFrameResult,
    view: ReadyLLMBoardHeadlineView | undefined,
    requestedAt: string,
    completedAt: string,
    provider: ResolvedBoardHeadlineProvider
  ): void {
    const sessionIds = pendingSessionIds.get(key) ?? new Set([sessionId]);
    for (const pendingSessionId of sessionIds) {
      config.onGenerationFinished?.({
        completedAt,
        failureMessage: result.failureMessage,
        frame: result.frame,
        headline: view,
        input,
        latencyMs: result.latencyMs,
        model: provider.model,
        provider: provider.provider,
        refreshKey: key,
        requestedAt,
        sessionId: pendingSessionId,
        status: result.status === "llm" ? "success" : result.status
      });
    }
  }

  return {
    enrichProjection,
    status
  };
}

function viewFromOpenAIResult(
  result: OpenAIBoardHeadlineFrameResult,
  provider: string,
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
    provider
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
  provider: ResolvedBoardHeadlineProvider,
  requestedAt: string
): BoardHeadlineRefreshState {
  return {
    provider: provider.provider,
    model: provider.model,
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
    case "not_configured":
      return "not_configured";
    case "api_error":
    case "disabled":
    case "llm":
      return "api_error";
  }
}

function effectiveHeadlineRequestCooldownMs(refreshIntervalMs: number | undefined): number {
  if (!Number.isFinite(refreshIntervalMs)) return 10_000;
  return Math.max(5_000, Math.min(60_000, Number(refreshIntervalMs)));
}

function nowIso(now: BoardHeadlineEnricherConfig["now"]): string {
  return (now?.() ?? new Date()).toISOString();
}

function requestAllowedForSession(lastRequestedAtBySession: Map<string, number>, sessionId: string, nowMs: number, cooldownMs: number): boolean {
  const lastRequestedAt = lastRequestedAtBySession.get(sessionId);
  return lastRequestedAt === undefined || nowMs - lastRequestedAt >= cooldownMs;
}

function shouldRequestHeadlineForCard(card: SessionCardView): boolean {
  return (
    card.lifecycle === "running" ||
    card.displayState === "done" ||
    card.displayState === "idle" ||
    card.isExpanded ||
    card.headline.source !== "llm"
  );
}

function shouldShowPendingHeadlineForCard(card: SessionCardView): boolean {
  return card.lifecycle === "running" || card.displayState === "done" || card.displayState === "idle" || card.isExpanded;
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
