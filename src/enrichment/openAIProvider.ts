import type { EnrichmentProviderResult, SessionEnrichmentProvider } from "./provider.ts";
import { deterministicCapsuleFromFacts, type SessionFacts } from "./sessionCompiler.ts";
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
  const enabled = config.enabled === true;
  const apiKey = config.apiKey?.trim();
  const model = config.model ?? DEFAULT_MODEL;
  return {
    id: "openai",
    model,
    async enrich(input) {
      if (!enabled) {
        return failureResult("disabled", model, "OpenAI enrichment is disabled.");
      }
      if (!apiKey) {
        return failureResult("not_configured", model, "OpenAI enrichment is enabled but no API key is configured.");
      }
      const fetchImpl = config.fetchImpl ?? globalThis.fetch;
      if (!fetchImpl) return failureResult("api_error", model, "No fetch implementation is available for OpenAI enrichment.");

      const controller = new AbortController();
      const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const startedAt = Date.now();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const deterministic = deterministicCapsuleFromFacts(input.facts);
      const requestPayload = {
        model,
        instructions: [
          "You are writing session metadata for Masthead.",
          "Identify the concrete work subject, user goal, changed area, outcome if supported, and missing evidence.",
          "Use only facts in the input. Do not infer from runtime names like Codex.",
          "Do not use updated, session, work, or recent activity as the main subject.",
          "If transcript coverage is weak, do not invent the task; use only concrete files and commands.",
          "Do not mention raw paths, shell commands, secrets, hashes, IDs, lifecycle enum names, or provider events.",
          "Do not address the user directly and do not use first person.",
          "Title must be a 3 to 8 word noun phrase with a concrete work subject.",
          "Confidence is high when transcript, files, and tools support the claim; medium when partial evidence supports it; low when evidence is hook-only or metadata-only.",
          "Use empty strings for outcome, action, or object when the input does not directly support those fields.",
          "Return only JSON that matches the schema."
        ].join(" "),
        input: JSON.stringify(providerPayload(input.facts, deterministic)),
        max_output_tokens: 360,
        reasoning: { effort: "minimal" },
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "masthead_session_narrative",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["title", "liveSummary", "outcome", "searchSummary", "action", "object", "confidence", "missingEvidence"],
              properties: {
                title: { type: "string" },
                liveSummary: { type: "string" },
                outcome: { type: "string" },
                searchSummary: { type: "string" },
                action: { type: "string" },
                object: { type: "string" },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                missingEvidence: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      };
      try {
        const response = await fetchImpl("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(requestPayload),
          signal: controller.signal
        });
        const latencyMs = Date.now() - startedAt;
        if (!response.ok) {
          return failureResult("api_error", model, `OpenAI enrichment request failed with HTTP ${response.status}.`, {
            latencyMs,
            requestPayload
          });
        }
        const rawOutput = await response.json();
        const outputText = extractOutputText(rawOutput);
        if (!outputText) {
          return failureResult("invalid_output", model, "OpenAI enrichment response did not include output text.", {
            latencyMs,
            rawOutput,
            requestPayload
          });
        }
        let parsedOutput: unknown;
        try {
          parsedOutput = JSON.parse(outputText);
        } catch {
          return failureResult("invalid_json", model, "OpenAI enrichment response was not valid JSON.", {
            latencyMs,
            rawOutput,
            requestPayload
          });
        }
        const validation = mergeValidatedNarrative(deterministic, parsedOutput);
        if (!validation.ok) {
          return failureResult("validation_failed", model, "OpenAI enrichment response failed validation.", {
            latencyMs,
            parsedOutput,
            rawOutput,
            requestPayload,
            validationFailures: validation.validationFailures
          });
        }
        return {
          capsule: validation.capsule,
          latencyMs,
          model,
          parsedOutput,
          provider: "openai",
          rawOutput,
          requestPayload,
          source: "llm",
          status: "success"
        };
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        if (error instanceof Error && error.name === "AbortError") {
          return failureResult("timeout", model, `OpenAI enrichment timed out after ${timeoutMs}ms.`, {
            latencyMs,
            requestPayload
          });
        }
        return failureResult("api_error", model, error instanceof Error ? error.message : "OpenAI enrichment request failed.", {
          latencyMs,
          requestPayload
        });
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
      commands: narrative?.commands.map((command) => ({
        category: command.category,
        exitCode: command.exitCode,
        name: safeCommandName(command.name),
        outputPreview: safeOutputPreview(command.outputPreview),
        status: command.status
      })).slice(0, 8) ?? [],
      coverage: narrative?.coverage,
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

function mergeValidatedNarrative(
  fallback: SessionCapsule,
  value: unknown
): { ok: true; capsule: SessionCapsule } | { ok: false; validationFailures: string[] } {
  if (!isRecord(value)) return { ok: false, validationFailures: ["shape"] };
  const title = validatedField("title", value.title);
  const liveSummary = validatedField("liveSummary", value.liveSummary);
  const searchSummary = validatedField("searchSummary", value.searchSummary);
  const confidence = confidenceField(value.confidence);
  const missingEvidence = missingEvidenceField(value.missingEvidence);
  const failures = [
    ...(!title.ok ? ["title", ...title.failures.map((failure) => `title:${failure}`)] : []),
    ...(!liveSummary.ok ? ["liveSummary", ...liveSummary.failures.map((failure) => `liveSummary:${failure}`)] : []),
    ...(!searchSummary.ok ? ["searchSummary", ...searchSummary.failures.map((failure) => `searchSummary:${failure}`)] : []),
    ...(confidence ? [] : ["confidence"]),
    ...(missingEvidence ? [] : ["missingEvidence"])
  ];
  if (!title.ok || !liveSummary.ok || !searchSummary.ok || !confidence || !missingEvidence) {
    return { ok: false, validationFailures: failures };
  }
  const outcome = validatedOptionalField("outcome", value.outcome);
  return {
    capsule: {
      ...fallback,
      action: stringField(value.action) ?? fallback.action,
      confidence,
      liveSummary: liveSummary.value,
      missingEvidence,
      object: stringField(value.object) ?? fallback.object,
      outcome: outcome ?? fallback.outcome,
      providerStatus: "success",
      searchPhrases: unique([...(fallback.searchPhrases ?? []), title.value, searchSummary.value]),
      searchSummary: searchSummary.value,
      title: title.value,
      titleSource: "llm"
    },
    ok: true
  };
}

function validatedField(
  field: "title" | "liveSummary" | "searchSummary",
  value: unknown
): { ok: true; value: string } | { ok: false; failures: string[] } {
  if (typeof value !== "string") return { ok: false, failures: ["missing"] };
  const result = validateNarrativeField(field, value);
  return result.ok ? { ok: true, value: result.value } : { ok: false, failures: result.failures };
}

function validatedOptionalField(field: "outcome", value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = validateNarrativeField(field, value);
  return result.ok ? result.value : undefined;
}

function failureResult(
  status: Exclude<EnrichmentProviderResult["status"], "success">,
  model: string,
  failureMessage: string,
  details: Partial<EnrichmentProviderResult> = {}
): EnrichmentProviderResult {
  return {
    ...details,
    failureMessage,
    model,
    provider: "openai",
    source: "none",
    status
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

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function confidenceField(value: unknown): "high" | "medium" | "low" | undefined {
  return value === "high" || value === "medium" || value === "low" ? value : undefined;
}

function missingEvidenceField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean).slice(0, 8);
}

function safeCommandName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/\/home\/[^/\s"'`]+(?:\/[^\s"'`]*)?/g, "[redacted-path]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted-secret]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function safeOutputPreview(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/\/home\/[^/\s"'`]+(?:\/[^\s"'`]*)?/g, "[redacted-path]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted-secret]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
