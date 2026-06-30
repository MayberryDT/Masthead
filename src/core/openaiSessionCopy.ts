import {
  SESSION_COPY_SCHEMA_VERSION,
  sessionCopyCacheKey,
  toSessionCopyInput,
  validateSessionCopy,
  type SessionCopyInput
} from "./sessionCopy.ts";
import { createEnrichmentAuditLogger, type EnrichmentAuditLogger } from "../enrichment/enrichmentAudit.ts";
import type { LiveBoardProjection, SessionPlainCopy } from "./types";

export type OpenAISessionCopyStatus =
  | "llm"
  | "disabled"
  | "not_configured"
  | "timeout"
  | "api_error"
  | "invalid_output"
  | "validation_failed";

export type OpenAISessionCopyConfig = {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  refreshIntervalMs?: number;
};

export type OpenAISessionCopyResult = {
  copy?: SessionPlainCopy;
  status: OpenAISessionCopyStatus;
  failureMessage?: string;
  validationReason?: string;
  latencyMs?: number;
};

export type OpenAISessionCopyEnricherConfig = OpenAISessionCopyConfig & {
  now?: () => number;
  ttlMs?: number;
  maxEntries?: number;
  maxConcurrent?: number;
  projectionBudgetMs?: number;
  auditLogger?: EnrichmentAuditLogger;
};

export type OpenAISessionCopyEnricher = {
  enrichProjection: (projection: LiveBoardProjection) => Promise<LiveBoardProjection>;
  status: () => {
    enabled: boolean;
    configured: boolean;
    model: string;
    cacheEntries: number;
    schemaVersion: number;
  };
};

const DEFAULT_MODEL = "gpt-5-nano-2025-08-07";
const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_TTL_MS = 0;
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_PROJECTION_BUDGET_MS = 3_500;

export async function rewriteSessionCopyWithOpenAI(
  input: SessionCopyInput,
  fallback: SessionPlainCopy,
  config: OpenAISessionCopyConfig = {}
): Promise<OpenAISessionCopyResult> {
  const enabled = config.enabled === true;
  if (!enabled) return { failureMessage: "OpenAI live copy is disabled.", status: "disabled" };
  const apiKey = config.apiKey?.trim();
  if (!apiKey) return { failureMessage: "OpenAI live copy is enabled but not configured.", status: "not_configured" };

  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) return { failureMessage: "No fetch implementation is available for OpenAI live copy.", status: "api_error" };

  const controller = new AbortController();
  const timeoutMs = effectiveTimeoutMs(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, config.refreshIntervalMs);
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model ?? DEFAULT_MODEL,
        instructions: [
          "Rewrite Masthead session metadata into calm, system-neutral plain English for an operations brief.",
          "Only restate the facts in the input.",
          "For running or idle sessions, summarize the latest concrete activity in one sentence when latestFeedback, facts.recentEvents, or recentDelta.latestEventSummaries are present.",
          "Prefer latest activity evidence over lifecycle, status, project, or review-state wording.",
          "Do not mention MCP, Model Context Protocol, or MCP servers unless the input explicitly contains MCP, Model Context Protocol, or an mcp path/topic.",
          "Never use repeated templates such as ready for review, needs review, work is focused on, or being fixed for a project.",
          "Do not infer lifecycle, outcome, urgency, identity, or completion.",
          "Treat latestFeedback claim flags as agent claims, not deterministic truth.",
          "Do not mention raw enum names.",
          "The headline must be a short full sentence that describes the session state, not a category label.",
          "Never address the user directly. Do not use you, your, Tyler, urgent, critical, dangerous, action required, please, let's, I, or we.",
          "Return only the requested JSON fields."
        ].join(" "),
        input: JSON.stringify(input),
        max_output_tokens: 240,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "masthead_session_copy",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["headline", "status", "reason"],
              properties: {
                headline: { type: "string" },
                status: { type: "string" },
                reason: { type: "string" },
                nextStep: { type: "string" }
              }
            }
          }
        }
      }),
      signal: controller.signal
    });

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        failureMessage: `OpenAI live copy request failed with HTTP ${response.status}.`,
        latencyMs,
        status: "api_error"
      };
    }
    const body = await response.json();
    const outputText = extractOutputText(body);
    if (!outputText) return { failureMessage: "OpenAI live copy response did not include output text.", latencyMs, status: "invalid_output" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      return { failureMessage: "OpenAI live copy response was not valid JSON.", latencyMs, status: "invalid_output" };
    }
    const validation = validateSessionCopy(parsed, input, "llm");
    if (!validation.ok) {
      return {
        failureMessage: "OpenAI live copy response failed validation.",
        latencyMs,
        status: "validation_failed",
        validationReason: validation.reason
      };
    }
    return { copy: validation.copy, latencyMs, status: "llm" };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    if (error instanceof Error && error.name === "AbortError") {
      return {
        failureMessage: `OpenAI live copy timed out after ${timeoutMs}ms.`,
        latencyMs,
        status: "timeout"
      };
    }
    return {
      failureMessage: error instanceof Error ? error.message : "OpenAI live copy request failed.",
      latencyMs,
      status: "api_error"
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function createOpenAISessionCopyEnricher(config: OpenAISessionCopyEnricherConfig = {}): OpenAISessionCopyEnricher {
  const model = config.model ?? DEFAULT_MODEL;
  const enabled = config.enabled === true;
  const apiKey = config.apiKey;
  const now = config.now ?? Date.now;
  const ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxConcurrent = config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const projectionBudgetMs = config.projectionBudgetMs ?? DEFAULT_PROJECTION_BUDGET_MS;
  const auditLogger = config.auditLogger ?? createEnrichmentAuditLogger();
  const cache = new Map<string, { copy: SessionPlainCopy; expiresAt: number }>();
  const inFlight = new Map<string, Promise<OpenAISessionCopyResult>>();

  async function cachedRewrite(input: SessionCopyInput, fallback: SessionPlainCopy, remainingMs: number): Promise<OpenAISessionCopyResult> {
    const key = sessionCopyCacheKey({ ...input, refresh: undefined }, model);
    const cached = ttlMs > 0 ? cache.get(key) : undefined;
    if (cached && cached.expiresAt > now()) return { copy: cached.copy, latencyMs: 0, status: "llm" };

    const existing = ttlMs > 0 ? inFlight.get(key) : undefined;
    if (existing) return existing;

    const request = rewriteSessionCopyWithOpenAI(input, fallback, {
      enabled,
      apiKey,
      model,
      fetchImpl: config.fetchImpl,
      refreshIntervalMs: config.refreshIntervalMs,
      timeoutMs: Math.max(1, Math.min(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, remainingMs))
    }).then((result) => {
      if (ttlMs > 0 && result.status === "llm" && result.copy) {
        cache.set(key, { copy: result.copy, expiresAt: now() + ttlMs });
        trimCache(cache, maxEntries);
      }
      return result;
    }).finally(() => {
      inFlight.delete(key);
    });

    if (ttlMs > 0) inFlight.set(key, request);
    return request;
  }

  return {
    async enrichProjection(projection) {
      if (!enabled) return projection;
      const deadline = now() + projectionBudgetMs;
      const copiesBySession = new Map<string, SessionPlainCopy>();
      const refreshBySession = new Map<string, NonNullable<LiveBoardProjection["cards"][number]["copyRefresh"]>>();
      const cards = projection.cards;
      const refreshId = `refresh:${now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
      const generatedAt = new Date(now()).toISOString();
      const summary = {
        disabled: 0,
        failed: 0,
        generatedAt,
        requested: 0,
        succeeded: 0
      };
      let index = 0;
      const workers = Array.from({ length: Math.min(maxConcurrent, cards.length) }, async () => {
        while (index < cards.length) {
          const cardIndex = index;
          const card = cards[index++];
          if (!card) continue;
          const remainingMs = deadline - now();
          if (remainingMs <= 0) return;
          const refresh = {
            cardIndex,
            generatedAt,
            refreshId,
            ...(config.refreshIntervalMs ? { refreshIntervalMs: config.refreshIntervalMs } : {})
          };
          const input = isSessionCopyInput(card.copyInput)
            ? { ...card.copyInput, refresh }
            : toSessionCopyInput(
                card,
                projection.attentionQueue.filter((item) => item.sessionId === card.sessionId),
                projection.conflicts.filter((conflict) => conflict.sessionIds.includes(card.sessionId)),
                { refresh }
              );
          auditLogger.record({
            kind: "board.started",
            model,
            provider: "openai",
            refreshId,
            refreshIntervalMs: config.refreshIntervalMs,
            sessionId: card.sessionId
          });
          auditLogger.record({
            details: input,
            kind: "board.input",
            model,
            provider: "openai",
            refreshId,
            refreshIntervalMs: config.refreshIntervalMs,
            sessionId: card.sessionId
          });
          summary.requested += 1;
          const result = await cachedRewrite(input, card.copy, remainingMs);
          auditLogger.record({
            details: {
              failureMessage: result.failureMessage,
              status: result.status,
              validationReason: result.validationReason
            },
            kind: "board.provider_response",
            latencyMs: result.latencyMs,
            model,
            provider: "openai",
            refreshId,
            refreshIntervalMs: config.refreshIntervalMs,
            sessionId: card.sessionId,
            status: result.status
          });
          if (result.status === "llm" && result.copy) {
            copiesBySession.set(card.sessionId, result.copy);
            refreshBySession.set(card.sessionId, {
              latencyMs: result.latencyMs,
              model,
              provider: "openai",
              requestedAt: generatedAt,
              status: "success"
            });
            summary.succeeded += 1;
            auditLogger.record({
              details: result.copy,
              kind: "board.applied",
              latencyMs: result.latencyMs,
              model,
              provider: "openai",
              refreshId,
              refreshIntervalMs: config.refreshIntervalMs,
              sessionId: card.sessionId,
              status: "success"
            });
          } else {
            const status = result.status === "llm" ? "api_error" : result.status;
            refreshBySession.set(card.sessionId, {
              failureMessage: result.failureMessage,
              latencyMs: result.latencyMs,
              model,
              provider: "openai",
              requestedAt: generatedAt,
              status
            });
            if (status === "disabled") summary.disabled += 1;
            else summary.failed += 1;
            auditLogger.record({
              details: {
                failureMessage: result.failureMessage,
                validationReason: result.validationReason
              },
              kind: "board.failed",
              latencyMs: result.latencyMs,
              model,
              provider: "openai",
              refreshId,
              refreshIntervalMs: config.refreshIntervalMs,
              sessionId: card.sessionId,
              status
            });
          }
        }
      });
      await Promise.all(workers);
      if (summary.requested === 0) return projection;

      return {
        ...projection,
        cards: projection.cards.map((card) => withOverlayCopy(card, copiesBySession, refreshBySession)),
        copyRefreshSummary: summary,
        expandedSession: projection.expandedSession ? withOverlayCopy(projection.expandedSession, copiesBySession, refreshBySession) : undefined,
        selectedSession: projection.selectedSession ? withOverlayCopy(projection.selectedSession, copiesBySession, refreshBySession) : undefined
      };
    },
    status() {
      return {
        enabled,
        configured: Boolean(apiKey),
        model,
        cacheEntries: cache.size,
        schemaVersion: SESSION_COPY_SCHEMA_VERSION
      };
    }
  };
}

function extractOutputText(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.output)) return undefined;
  for (const item of value.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return undefined;
}

function withOverlayCopy<T extends { sessionId: string; copy: SessionPlainCopy; copyRefresh?: LiveBoardProjection["cards"][number]["copyRefresh"] }>(
  value: T,
  copiesBySession: Map<string, SessionPlainCopy>,
  refreshBySession: Map<string, NonNullable<LiveBoardProjection["cards"][number]["copyRefresh"]>>
): T {
  const copy = copiesBySession.get(value.sessionId);
  const copyRefresh = refreshBySession.get(value.sessionId);
  if (!copy && !copyRefresh) return value;
  return {
    ...value,
    ...(copy ? { copy } : {}),
    ...(copyRefresh ? { copyRefresh } : {})
  };
}

function trimCache(cache: Map<string, { copy: SessionPlainCopy; expiresAt: number }>, maxEntries: number): void {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) return;
    cache.delete(oldestKey);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSessionCopyInput(value: unknown): value is SessionCopyInput {
  return (
    isRecord(value) &&
    typeof value.lifecycle === "string" &&
    typeof value.primaryStatus === "string" &&
    Array.isArray(value.signals) &&
    typeof value.conflictCount === "number" &&
    typeof value.changedFileBucket === "string" &&
    typeof value.lastActivityBucket === "string" &&
    typeof value.durationBucket === "string" &&
    typeof value.identityConfidence === "string"
  );
}

function effectiveTimeoutMs(configuredTimeoutMs: number, refreshIntervalMs: number | undefined): number {
  if (!refreshIntervalMs || refreshIntervalMs <= 0) return configuredTimeoutMs;
  const capped = Math.min(configuredTimeoutMs, Math.floor(refreshIntervalMs * 0.6));
  return Math.max(800, capped);
}
