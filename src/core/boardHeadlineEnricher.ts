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
import type { LiveBoardProjection, SessionCardView, SessionDetailView, ExpandedSessionView } from "./types.ts";

export const DEFAULT_MODEL = "gpt-5-nano-2025-08-07";

export type BoardHeadlineEnricherConfig = {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
};

export type BoardHeadlineEnricher = {
  enrichProjection(projection: LiveBoardProjection): Promise<LiveBoardProjection>;
  status(): { enabled: boolean; configured: boolean; model: string };
};

type CacheKey = string;

export function createBoardHeadlineEnricher(config: BoardHeadlineEnricherConfig = {}): BoardHeadlineEnricher {
  const model = config.model ?? DEFAULT_MODEL;
  const completed = new Map<CacheKey, BoardHeadlineView>();
  const failures = new Map<CacheKey, OpenAIBoardHeadlineFrameResult>();
  const inFlight = new Map<CacheKey, Promise<void>>();

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

      if (!currentStatus.enabled || !currentStatus.configured) {
        overlays.set(card.sessionId, buildOfflineBoardHeadlineView(input));
        continue;
      }

      const key = cacheKey(model, input);
      const cached = completed.get(key);

      if (cached) {
        overlays.set(card.sessionId, cached);
        summary.succeeded += 1;
        continue;
      }

      if (failures.has(key) && !countedFailedKeys.has(key)) {
        summary.failed += 1;
        countedFailedKeys.add(key);
      }

      const retained = retainedReadyHeadline(card.headline);
      if (retained) {
        overlays.set(card.sessionId, retained);
      } else {
        overlays.set(card.sessionId, buildPendingBoardHeadlineView(input));
      }

      summary.pending += 1;
      if (!inFlight.has(key)) {
        inFlight.set(key, requestHeadline(input, key));
        summary.requested += 1;
      }
    }

    return {
      ...projection,
      cards: projection.cards.map((card) => overlayCardHeadline(card, overlays)),
      expandedSession: projection.expandedSession
        ? overlayExpandedSessionHeadline(projection.expandedSession, overlays)
        : undefined,
      selectedSession: projection.selectedSession
        ? overlaySelectedSessionHeadline(projection.selectedSession, overlays)
        : undefined,
      headlineRefreshSummary: summary
    };
  }

  async function requestHeadline(input: BoardHeadlineInput, key: CacheKey): Promise<void> {
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
      inFlight.delete(key);
    }
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
): BoardHeadlineView | undefined {
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

function overlayCardHeadline(card: SessionCardView, overlays: Map<string, BoardHeadlineView>): SessionCardView {
  const headline = overlays.get(card.sessionId);
  return headline ? { ...card, headline } : card;
}

function overlayExpandedSessionHeadline(
  session: ExpandedSessionView,
  overlays: Map<string, BoardHeadlineView>
): ExpandedSessionView {
  const headline = overlays.get(session.sessionId);
  return headline ? { ...session, headline } : session;
}

function overlaySelectedSessionHeadline(
  session: SessionDetailView,
  overlays: Map<string, BoardHeadlineView>
): SessionDetailView {
  const headline = overlays.get(session.sessionId);
  return headline ? { ...session, headline } : session;
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
