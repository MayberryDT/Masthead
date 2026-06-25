import { createDeterministicEnrichmentProvider } from "./deterministicProvider.ts";
import type { SessionEnrichmentProvider } from "./provider.ts";

export function createOpenAIEnrichmentProvider(config: { enabled?: boolean; apiKey?: string; model?: string } = {}): SessionEnrichmentProvider {
  const fallback = createDeterministicEnrichmentProvider();
  return {
    id: config.enabled && config.apiKey ? "openai" : fallback.id,
    model: config.enabled && config.apiKey ? config.model ?? "gpt-5-nano-2025-08-07" : fallback.model,
    async enrich(input) {
      return fallback.enrich(input);
    }
  };
}
