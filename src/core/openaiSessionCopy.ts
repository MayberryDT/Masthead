import {
  SESSION_COPY_SCHEMA_VERSION,
  sessionCopyCacheKey,
  toSessionCopyInput,
  validateSessionCopy,
  type SessionCopyInput
} from "./sessionCopy.ts";
import type { LiveBoardProjection, SessionPlainCopy } from "./types";

export type OpenAISessionCopyStatus =
  | "llm"
  | "cache"
  | "disabled"
  | "not_configured"
  | "timeout"
  | "api_error"
  | "invalid_output";

export type OpenAISessionCopyConfig = {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type OpenAISessionCopyResult = {
  copy: SessionPlainCopy;
  status: OpenAISessionCopyStatus;
};

export type OpenAISessionCopyEnricherConfig = OpenAISessionCopyConfig & {
  now?: () => number;
  ttlMs?: number;
  maxEntries?: number;
  maxConcurrent?: number;
  projectionBudgetMs?: number;
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
const DEFAULT_TIMEOUT_MS = 500;
const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_PROJECTION_BUDGET_MS = 500;

export async function rewriteSessionCopyWithOpenAI(
  input: SessionCopyInput,
  fallback: SessionPlainCopy,
  config: OpenAISessionCopyConfig = {}
): Promise<OpenAISessionCopyResult> {
  const enabled = config.enabled === true;
  if (!enabled) return { copy: fallback, status: "disabled" };
  const apiKey = config.apiKey?.trim();
  if (!apiKey) return { copy: fallback, status: "not_configured" };

  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) return { copy: fallback, status: "api_error" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

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

    if (!response.ok) return { copy: fallback, status: "api_error" };
    const body = await response.json();
    const outputText = extractOutputText(body);
    if (!outputText) return { copy: fallback, status: "invalid_output" };
    const validation = validateSessionCopy(JSON.parse(outputText), input, "llm");
    if (!validation.ok) return { copy: fallback, status: "invalid_output" };
    return { copy: validation.copy, status: "llm" };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { copy: fallback, status: "timeout" };
    return { copy: fallback, status: "api_error" };
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
  const cache = new Map<string, { copy: SessionPlainCopy; expiresAt: number }>();
  const inFlight = new Map<string, Promise<OpenAISessionCopyResult>>();

  async function cachedRewrite(input: SessionCopyInput, fallback: SessionPlainCopy, remainingMs: number): Promise<OpenAISessionCopyResult> {
    const key = sessionCopyCacheKey(input, model);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return { copy: cached.copy, status: "cache" };

    const existing = inFlight.get(key);
    if (existing) return existing;

    const request = rewriteSessionCopyWithOpenAI(input, fallback, {
      enabled,
      apiKey,
      model,
      fetchImpl: config.fetchImpl,
      timeoutMs: Math.max(1, Math.min(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, remainingMs))
    }).then((result) => {
      if (result.status === "llm") {
        cache.set(key, { copy: result.copy, expiresAt: now() + ttlMs });
        trimCache(cache, maxEntries);
      }
      return result;
    }).finally(() => {
      inFlight.delete(key);
    });

    inFlight.set(key, request);
    return request;
  }

  return {
    async enrichProjection(projection) {
      if (!enabled || !apiKey) return projection;
      const deadline = now() + projectionBudgetMs;
      const copiesBySession = new Map<string, SessionPlainCopy>();
      const cards = projection.cards;
      let index = 0;
      const workers = Array.from({ length: Math.min(maxConcurrent, cards.length) }, async () => {
        while (index < cards.length) {
          const card = cards[index++];
          if (!card) continue;
          const remainingMs = deadline - now();
          if (remainingMs <= 0) return;
          const input = toSessionCopyInput(
            card,
            projection.attentionQueue.filter((item) => item.sessionId === card.sessionId),
            projection.conflicts.filter((conflict) => conflict.sessionIds.includes(card.sessionId))
          );
          const result = await cachedRewrite(input, card.copy, remainingMs);
          if (result.status === "llm" || result.status === "cache") {
            copiesBySession.set(card.sessionId, result.copy);
          }
        }
      });
      await Promise.all(workers);
      if (copiesBySession.size === 0) return projection;

      return {
        ...projection,
        cards: projection.cards.map((card) => withOverlayCopy(card, copiesBySession)),
        expandedSession: projection.expandedSession ? withOverlayCopy(projection.expandedSession, copiesBySession) : undefined,
        selectedSession: projection.selectedSession ? withOverlayCopy(projection.selectedSession, copiesBySession) : undefined
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

function withOverlayCopy<T extends { sessionId: string; copy: SessionPlainCopy }>(value: T, copiesBySession: Map<string, SessionPlainCopy>): T {
  const copy = copiesBySession.get(value.sessionId);
  return copy ? { ...value, copy } : value;
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
