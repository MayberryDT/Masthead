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

type GeminiEnrichmentConfig = {
  apiKey?: string;
  baseUrl?: string;
  enabled?: boolean;
  fetchImpl?: typeof fetch;
  model?: string;
  timeoutMs?: number;
};

const DEFAULT_MODEL = "gemini-3.5-flash";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export function createGeminiEnrichmentProvider(config: GeminiEnrichmentConfig = {}): SessionEnrichmentProvider {
  const providerId = "gemini";
  const label = providerLabel(providerId);
  const enabled = config.enabled === true;
  const apiKey = config.apiKey?.trim();
  const model = normalizeGeminiModel(config.model ?? DEFAULT_MODEL);
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ""}`;

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
        contents: [
          {
            role: "user",
            parts: [{ text: narrative.inputText }]
          }
        ],
        generationConfig: {
          maxOutputTokens: LLM_NARRATIVE_MAX_OUTPUT_TOKENS,
          responseMimeType: "application/json",
          responseSchema: narrativeJsonSchema(),
          temperature: 0
        },
        systemInstruction: {
          parts: [{ text: narrativeInstructions() }]
        }
      };

      try {
        const response = await fetchImpl(endpoint, {
          body: JSON.stringify(requestPayload),
          headers: { "content-type": "application/json" },
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
        const outputText = extractGeminiText(rawOutput);
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

function normalizeGeminiModel(model: string): string {
  return model.replace(/^models\//, "").trim();
}

function extractGeminiText(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.candidates)) return undefined;
  for (const candidate of value.candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) continue;
    for (const part of candidate.content.parts) {
      if (isRecord(part) && typeof part.text === "string") return part.text;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
