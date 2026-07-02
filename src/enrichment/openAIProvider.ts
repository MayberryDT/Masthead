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

type OpenAIEnrichmentConfig = {
  apiStyle?: "responses" | "chat_completions";
  apiKeyRequired?: boolean;
  baseUrl?: string;
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  providerId?: string;
  timeoutMs?: number;
};

const DEFAULT_MODEL = "gpt-5-nano-2025-08-07";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export function createOpenAIEnrichmentProvider(config: OpenAIEnrichmentConfig = {}): SessionEnrichmentProvider {
  const enabled = config.enabled === true;
  const apiKey = config.apiKey?.trim();
  const apiKeyRequired = config.apiKeyRequired !== false;
  const apiStyle = config.apiStyle ?? "responses";
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const endpoint = `${baseUrl}/${apiStyle === "chat_completions" ? "chat/completions" : "responses"}`;
  const model = config.model ?? DEFAULT_MODEL;
  const providerId = config.providerId ?? "openai";
  const label = providerLabel(providerId);
  return {
    id: providerId,
    model,
    async enrich(input) {
      if (!enabled) {
        return failureResult("disabled", providerId, model, `${label} enrichment is disabled.`);
      }
      if (apiKeyRequired && !apiKey) {
        return failureResult("not_configured", providerId, model, `${label} enrichment is enabled but no API key is configured.`);
      }
      const fetchImpl = config.fetchImpl ?? globalThis.fetch;
      if (!fetchImpl) return failureResult("api_error", providerId, model, `No fetch implementation is available for ${label} enrichment.`);

      const controller = new AbortController();
      const timeoutMs = config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
      const startedAt = Date.now();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const narrative = buildLlmNarrativeRequest(input.facts);
      const requestPayload = buildRequestPayload(apiStyle, model, narrative.inputText);
      try {
        const headers: Record<string, string> = {
          "content-type": "application/json"
        };
        if (apiKey) headers.authorization = `Bearer ${apiKey}`;

        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(requestPayload),
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
        const outputText = apiStyle === "chat_completions" ? extractChatCompletionText(rawOutput) : extractOutputText(rawOutput);
        if (!outputText) {
          return failureResult("invalid_output", providerId, model, `${label} enrichment response did not include output text.`, {
            latencyMs,
            rawOutput,
            requestPayload
          });
        }
        return parseLlmNarrativeResult({
          fallback: narrative.fallback,
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

function buildRequestPayload(
  apiStyle: NonNullable<OpenAIEnrichmentConfig["apiStyle"]>,
  model: string,
  input: string
): Record<string, unknown> {
  if (apiStyle === "chat_completions") {
    return {
      model,
      messages: [
        { role: "system", content: narrativeInstructions() },
        { role: "user", content: input }
      ],
      max_tokens: 360,
      response_format: { type: "json_object" },
      temperature: 0
    };
  }

  return {
    model,
    instructions: narrativeInstructions(),
    input,
    max_output_tokens: LLM_NARRATIVE_MAX_OUTPUT_TOKENS,
    reasoning: { effort: "minimal" },
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "masthead_session_narrative",
        strict: true,
        schema: narrativeJsonSchema()
      }
    }
  };
}

function extractChatCompletionText(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.choices)) return undefined;
  for (const choice of value.choices) {
    if (!isRecord(choice) || !isRecord(choice.message)) continue;
    if (typeof choice.message.content === "string") return choice.message.content;
  }
  return undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
