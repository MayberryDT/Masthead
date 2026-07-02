import type { SessionEnrichmentProvider } from "./provider.ts";
import {
  buildLlmNarrativeRequest,
  DEFAULT_LLM_TIMEOUT_MS,
  failureResult,
  LLM_NARRATIVE_MAX_OUTPUT_TOKENS,
  narrativeInstructions,
  narrativeJsonSchema,
  parseLlmNarrativeResult,
  providerLabel
} from "./llmNarrative.ts";

type AnthropicEnrichmentConfig = {
  apiKey?: string;
  baseUrl?: string;
  enabled?: boolean;
  fetchImpl?: typeof fetch;
  model?: string;
  timeoutMs?: number;
};

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

export function createAnthropicEnrichmentProvider(config: AnthropicEnrichmentConfig = {}): SessionEnrichmentProvider {
  const providerId = "anthropic";
  const label = providerLabel(providerId);
  const enabled = config.enabled === true;
  const apiKey = config.apiKey?.trim();
  const model = config.model ?? DEFAULT_MODEL;
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const endpoint = `${baseUrl}/messages`;

  return {
    id: providerId,
    model,
    async enrich(input) {
      if (!enabled) return failureResult("disabled", providerId, model, `${label} enrichment is disabled.`);
      if (!apiKey) return failureResult("not_configured", providerId, model, `${label} enrichment is enabled but no API key is configured.`);
      const fetchImpl = config.fetchImpl ?? globalThis.fetch;
      if (!fetchImpl) return failureResult("api_error", providerId, model, `No fetch implementation is available for ${label} enrichment.`);

      const controller = new AbortController();
      const timeoutMs = config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
      const startedAt = Date.now();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const narrative = buildLlmNarrativeRequest(input.facts);
      const requestPayload = {
        max_tokens: LLM_NARRATIVE_MAX_OUTPUT_TOKENS,
        messages: [{ role: "user", content: narrative.inputText }],
        model,
        output_config: {
          format: {
            type: "json_schema",
            schema: narrativeJsonSchema()
          }
        },
        system: narrativeInstructions()
      };

      try {
        const response = await fetchImpl(endpoint, {
          body: JSON.stringify(requestPayload),
          headers: {
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
            "x-api-key": apiKey
          },
          method: "POST",
          signal: controller.signal
        });
        const latencyMs = Date.now() - startedAt;
        if (!response.ok) {
          return failureResult("api_error", providerId, model, `${label} enrichment request failed with HTTP ${response.status}.`, {
            latencyMs,
            requestPayload
          });
        }
        const rawOutput = await response.json();
        const outputText = extractAnthropicText(rawOutput);
        if (!outputText) {
          return failureResult("invalid_output", providerId, model, `${label} enrichment response did not include output text.`, {
            latencyMs,
            rawOutput,
            requestPayload
          });
        }
        return parseLlmNarrativeResult({
          evidenceCatalog: narrative.evidenceCatalog,
          fallback: narrative.fallback,
          facts: narrative.facts,
          latencyMs,
          model,
          outputText,
          provider: providerId,
          rawOutput,
          requestPayload
        });
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        if (error instanceof Error && error.name === "AbortError") {
          return failureResult("timeout", providerId, model, `${label} enrichment timed out after ${timeoutMs}ms.`, {
            latencyMs,
            requestPayload
          });
        }
        return failureResult("api_error", providerId, model, error instanceof Error ? error.message : `${label} enrichment request failed.`, {
          latencyMs,
          requestPayload
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function extractAnthropicText(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.content)) return undefined;
  for (const block of value.content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") return block.text;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
