import { createDeterministicEnrichmentProvider } from "./deterministicProvider.ts";
import type { SessionEnrichmentProvider } from "./provider.ts";
import type { SessionFacts } from "./sessionCompiler.ts";
import { validateNarrativeField } from "./sessionNarrativeValidator.ts";
import type { SessionCapsule } from "./types.ts";

type OpenAIEnrichmentConfig = {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_MODEL = "gpt-5-nano-2025-08-07";
const DEFAULT_TIMEOUT_MS = 2_000;

export function createOpenAIEnrichmentProvider(config: OpenAIEnrichmentConfig = {}): SessionEnrichmentProvider {
  const fallback = createDeterministicEnrichmentProvider();
  const enabled = config.enabled === true;
  const apiKey = config.apiKey?.trim();
  return {
    id: enabled && apiKey ? "openai" : fallback.id,
    model: enabled && apiKey ? config.model ?? DEFAULT_MODEL : fallback.model,
    async enrich(input) {
      const deterministic = await fallback.enrich(input);
      if (!enabled || !apiKey) return deterministic;
      const fetchImpl = config.fetchImpl ?? globalThis.fetch;
      if (!fetchImpl) return deterministic;

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
              "Write Masthead session narrative fields from the supplied sanitized facts.",
              "Masthead is a local-first session data layer, not a monitoring console.",
              "Use concrete product/work subject language.",
              "Do not mention raw paths, shell commands, secrets, hashes, IDs, lifecycle enum names, or provider events.",
              "Do not address the user directly and do not use first person.",
              "Return only JSON that matches the schema."
            ].join(" "),
            input: JSON.stringify(providerPayload(input.facts, deterministic)),
            max_output_tokens: 360,
            store: false,
            text: {
              format: {
                type: "json_schema",
                name: "masthead_session_narrative",
                strict: true,
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["title", "liveSummary", "searchSummary"],
                  properties: {
                    title: { type: "string" },
                    liveSummary: { type: "string" },
                    outcome: { type: "string" },
                    searchSummary: { type: "string" },
                    action: { type: "string" },
                    object: { type: "string" }
                  }
                }
              }
            }
          }),
          signal: controller.signal
        });
        if (!response.ok) return deterministic;
        const outputText = extractOutputText(await response.json());
        if (!outputText) return deterministic;
        return mergeValidatedNarrative(deterministic, JSON.parse(outputText));
      } catch {
        return deterministic;
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function providerPayload(facts: SessionFacts, fallback: SessionCapsule): Record<string, unknown> {
  const narrative = facts.narrative;
  return {
    fallback: {
      filesChangedSummary: fallback.filesChangedSummary,
      liveSummary: fallback.liveSummary,
      outcome: fallback.outcome,
      searchSummary: fallback.searchSummary,
      subject: fallback.subject,
      title: fallback.title,
      verificationSummary: fallback.verificationSummary
    },
    facts: {
      checkpointSummaries: narrative?.checkpointSummaries.slice(0, 3) ?? [],
      commands: narrative?.commands.map((command) => ({ category: command.category, status: command.status })).slice(0, 8) ?? [],
      fileBasenames: narrative?.fileBasenames.slice(0, 12) ?? [],
      fileDirectories: narrative?.fileDirectories.slice(0, 8) ?? [],
      finalAssistantMessage: narrative?.finalAssistantMessage,
      firstUserPrompt: narrative?.firstUserPrompt,
      objective: facts.objective,
      project: facts.project,
      technologies: narrative?.technologies ?? [],
      testsPassed: narrative?.testsPassed,
      testsFailed: narrative?.testsFailed,
      topics: narrative?.topics.slice(0, 12) ?? []
    }
  };
}

function mergeValidatedNarrative(fallback: SessionCapsule, value: unknown): SessionCapsule {
  if (!isRecord(value)) return fallback;
  const title = validatedField("title", value.title);
  const liveSummary = validatedField("liveSummary", value.liveSummary);
  const searchSummary = validatedField("searchSummary", value.searchSummary);
  if (!title || !liveSummary || !searchSummary) return fallback;
  const outcome = validatedField("outcome", value.outcome);
  return {
    ...fallback,
    action: stringField(value.action) ?? fallback.action,
    liveSummary,
    object: stringField(value.object) ?? fallback.object,
    outcome: outcome ?? fallback.outcome,
    searchPhrases: unique([...(fallback.searchPhrases ?? []), title, searchSummary]),
    searchSummary,
    title,
    titleSource: "llm"
  };
}

function validatedField(field: "title" | "liveSummary" | "outcome" | "searchSummary", value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = validateNarrativeField(field, value);
  return result.ok ? result.value : undefined;
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

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
