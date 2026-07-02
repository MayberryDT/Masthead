import type { EnrichmentProviderResult, SessionEnrichmentProvider } from "./provider.ts";
import {
  buildProviderEvidenceCatalog,
  fallbackDurableSessionEnrichment,
  mergeDurableProviderOutput,
  type ProviderEvidenceCatalogItem
} from "./durableSessionEnrichment.ts";
import { deterministicCapsuleFromFacts, SESSION_CAPSULE_PROMPT_VERSION, type SessionFacts } from "./sessionCompiler.ts";
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
const DEFAULT_TIMEOUT_MS = 10_000;

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
      const evidenceCatalog = buildProviderEvidenceCatalog(input.facts.evidence);
      const requestPayload = {
        model,
        instructions: [
          "You are generating durable enrichment for a Masthead session.",
          "This is not a Board live headline. This is not a live status update.",
          "This enrichment is used by the Logbook and Session Dossier.",
          "Create a stable Logbook title, a one-sentence archival Logbook summary, and structured Session Dossier enrichment.",
          "Write in neutral third-person voice.",
          "Do not write from the assistant's perspective.",
          "Summarize the provided userEvidence and assistantEvidence as a session record, not as a chat reply.",
          "Title rules: 3 to 8 words, sentence case, noun phrase, no trailing period.",
          "Use the first prompt as initial intent, but prefer dominant work actually performed if the session pivoted.",
          "Prefer concrete product areas, components, bugs, tests, imports, settings, docs, or source systems.",
          "Do not use live/status phrases like working on, being updated, blocked by, recent activity, or needs attention.",
          "Do not mention session unless the Masthead session system itself is the topic.",
          "Summary rules: one sentence, 90 to 180 characters preferred, past tense or result-oriented.",
          "If blocked, say what blocked it. If verification was not run, do not imply it passed.",
          "Dossier rules: be specific, do not write marketing copy, and do not overclaim completed work.",
          "Separate purpose, outcome, key work, decisions, blockers, verification, continuation, evidence, and warnings.",
          "Only include decisions and blockers directly supported by evidence.",
          "Verification status must be passed, failed, mixed, missing, or unknown.",
          "Continuation should help a future user or agent resume work.",
          "Do not expose secrets, URLs, emails, raw tokens, hashes, long local paths, or raw commands.",
          "Use evidenceRefIds from the provided catalog only. Use empty arrays when no catalog evidence applies.",
          "If evidence is thin, mark confidence low and include a warning.",
          "Use empty strings for unsupported string fields and empty arrays for unsupported list fields.",
          "Return only JSON that matches the schema."
        ].join(" "),
        input: JSON.stringify(providerPayload(input.facts)),
        max_output_tokens: 760,
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
              required: [
                "title",
                "liveSummary",
                "outcome",
                "searchSummary",
                "action",
                "object",
                "confidence",
                "missingEvidence",
                "version",
                "sessionTitle",
                "sessionSummary",
                "sessionDossier"
              ],
              properties: {
                title: { type: "string" },
                liveSummary: { type: "string" },
                outcome: { type: "string" },
                searchSummary: { type: "string" },
                action: { type: "string" },
                object: { type: "string" },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                missingEvidence: { type: "array", items: { type: "string" } },
                version: { type: "string", enum: ["session-capsule-v4"] },
                sessionTitle: {
                  type: "object",
                  additionalProperties: false,
                  required: ["text", "basis", "confidence", "evidenceRefIds"],
                  properties: {
                    text: { type: "string" },
                    basis: {
                      type: "string",
                      enum: ["first_prompt", "dominant_work", "final_outcome", "file_cluster", "debug_target", "fallback"]
                    },
                    confidence: { type: "string", enum: ["high", "medium", "low"] },
                    evidenceRefIds: { type: "array", items: { type: "string" } }
                  }
                },
                sessionSummary: {
                  type: "object",
                  additionalProperties: false,
                  required: ["text", "state", "confidence", "evidenceRefIds"],
                  properties: {
                    text: { type: "string" },
                    state: { type: "string", enum: ["completed", "blocked", "partial", "failed", "paused", "unknown"] },
                    confidence: { type: "string", enum: ["high", "medium", "low"] },
                    evidenceRefIds: { type: "array", items: { type: "string" } }
                  }
                },
                sessionDossier: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "purpose",
                    "outcome",
                    "keyWork",
                    "decisions",
                    "blockers",
                    "verification",
                    "continuation",
                    "evidenceRefIds",
                    "warnings"
                  ],
                  properties: {
                    purpose: { type: "string" },
                    outcome: { type: "string" },
                    keyWork: { type: "array", items: { type: "string" } },
                    decisions: { type: "array", items: { type: "string" } },
                    blockers: { type: "array", items: { type: "string" } },
                    verification: {
                      type: "object",
                      additionalProperties: false,
                      required: ["status", "summary", "commands", "failures", "evidenceRefIds"],
                      properties: {
                        status: { type: "string", enum: ["passed", "failed", "mixed", "missing", "unknown"] },
                        summary: { type: "string" },
                        commands: { type: "array", items: { type: "string" } },
                        failures: { type: "array", items: { type: "string" } },
                        evidenceRefIds: { type: "array", items: { type: "string" } }
                      }
                    },
                    continuation: {
                      type: "object",
                      additionalProperties: false,
                      required: ["nextStep", "openQuestions", "constraints"],
                      properties: {
                        nextStep: { type: "string" },
                        openQuestions: { type: "array", items: { type: "string" } },
                        constraints: { type: "array", items: { type: "string" } }
                      }
                    },
                    evidenceRefIds: { type: "array", items: { type: "string" } },
                    warnings: { type: "array", items: { type: "string" } }
                  }
                }
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
        const validation = mergeValidatedNarrative(deterministic, input.facts, parsedOutput, evidenceCatalog, model);
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

function providerPayload(facts: SessionFacts): Record<string, unknown> {
  const narrative = facts.narrative;
  const userEvidence = cleanEvidenceList(facts.userEvidence ?? [narrative?.firstUserPrompt, narrative?.lastUserPrompt]);
  const assistantEvidence = cleanEvidenceList(facts.assistantEvidence ?? [narrative?.finalAssistantMessage]);
  return {
    evidenceCatalog: [],
    facts: {
      userEvidence,
      assistantEvidence
    }
  };
}

function mergeValidatedNarrative(
  fallback: SessionCapsule,
  facts: SessionFacts,
  value: unknown,
  evidenceCatalog: ProviderEvidenceCatalogItem[],
  model: string
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
  const durableEnrichment = {
    ...mergeDurableProviderOutput(
      {
        ...fallbackDurableSessionEnrichment(facts),
        model,
        promptVersion: SESSION_CAPSULE_PROMPT_VERSION
      },
      value,
      evidenceCatalog
    ),
    model,
    promptVersion: SESSION_CAPSULE_PROMPT_VERSION
  };
  return {
    capsule: {
      ...fallback,
      action: stringField(value.action) ?? fallback.action,
      confidence,
      durableEnrichment,
      liveSummary: liveSummary.value,
      missingEvidence,
      object: stringField(value.object) ?? fallback.object,
      outcome: outcome ?? fallback.outcome,
      providerStatus: "success",
      searchPhrases: unique([...(fallback.searchPhrases ?? []), durableEnrichment.sessionTitle.text, durableEnrichment.sessionSummary.text, searchSummary.value]),
      searchSummary: searchSummary.value,
      sessionDossier: durableEnrichment.sessionDossier,
      sessionSummary: durableEnrichment.sessionSummary,
      sessionTitle: durableEnrichment.sessionTitle,
      title: durableEnrichment.sessionTitle.text,
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

function cleanEvidenceList(values: Array<string | undefined>): string[] {
  return values
    .map(safeEvidenceText)
    .filter((value): value is string => Boolean(value))
    .filter((value, index, items) => items.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index);
}

function safeEvidenceText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/\/home\/[^/\s"'`]+(?:\/[^\s"'`]*)?/g, "[redacted-path]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted-secret]")
    .replace(/\b[A-Z][A-Z0-9_]{8,}\b/g, "[redacted-token]")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
