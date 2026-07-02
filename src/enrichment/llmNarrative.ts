import type { EnrichmentProviderResult } from "./provider.ts";
import {
  buildProviderEvidenceCatalog,
  fallbackDurableSessionEnrichment,
  mergeDurableProviderOutput,
  type ProviderEvidenceCatalogItem
} from "./durableSessionEnrichment.ts";
import { deterministicCapsuleFromFacts, SESSION_CAPSULE_PROMPT_VERSION, type SessionFacts } from "./sessionCompiler.ts";
import { validateNarrativeField } from "./sessionNarrativeValidator.ts";
import type { SessionCapsule } from "./types.ts";

export const LLM_NARRATIVE_MAX_OUTPUT_TOKENS = 760;
export const DEFAULT_LLM_TIMEOUT_MS = 10_000;

export type LlmNarrativeRequest = {
  evidenceCatalog: ProviderEvidenceCatalogItem[];
  fallback: SessionCapsule;
  facts: SessionFacts;
  inputText: string;
};

export function buildLlmNarrativeRequest(facts: SessionFacts): LlmNarrativeRequest {
  const fallback = deterministicCapsuleFromFacts(facts);
  const evidenceCatalog = buildProviderEvidenceCatalog(facts.evidence);
  return {
    evidenceCatalog,
    fallback,
    facts,
    inputText: JSON.stringify(providerPayload(facts))
  };
}

export function narrativeInstructions(): string {
  return [
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
    "Title must be a 3 to 8 word noun phrase with a concrete work subject.",
    "Return only JSON that matches the schema."
  ].join(" ");
}

export function narrativeJsonSchema(): Record<string, unknown> {
  return {
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
  };
}

export function parseLlmNarrativeResult(input: {
  evidenceCatalog: ProviderEvidenceCatalogItem[];
  fallback: SessionCapsule;
  facts: SessionFacts;
  latencyMs: number;
  model: string;
  outputText: string;
  provider: string;
  rawOutput: unknown;
  requestPayload: unknown;
}): EnrichmentProviderResult {
  let parsedOutput: unknown;
  try {
    parsedOutput = JSON.parse(input.outputText);
  } catch {
    return failureResult("invalid_json", input.provider, input.model, `${providerLabel(input.provider)} enrichment response was not valid JSON.`, {
      latencyMs: input.latencyMs,
      rawOutput: input.rawOutput,
      requestPayload: input.requestPayload
    });
  }
  const validation = mergeValidatedNarrative(input.fallback, input.facts, parsedOutput, input.evidenceCatalog, input.model);
  if (!validation.ok) {
    return failureResult("validation_failed", input.provider, input.model, `${providerLabel(input.provider)} enrichment response failed validation.`, {
      latencyMs: input.latencyMs,
      parsedOutput,
      rawOutput: input.rawOutput,
      requestPayload: input.requestPayload,
      validationFailures: validation.validationFailures
    });
  }
  return {
    capsule: validation.capsule,
    latencyMs: input.latencyMs,
    model: input.model,
    parsedOutput,
    provider: input.provider,
    rawOutput: input.rawOutput,
    requestPayload: input.requestPayload,
    source: "llm",
    status: "success"
  };
}

export function failureResult(
  status: Exclude<EnrichmentProviderResult["status"], "success">,
  provider: string,
  model: string,
  failureMessage: string,
  details: Partial<EnrichmentProviderResult> = {}
): EnrichmentProviderResult {
  return {
    ...details,
    failureMessage,
    model,
    provider,
    source: "none",
    status
  };
}

export function providerLabel(provider: string): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "gemini") return "Gemini";
  return "LLM provider";
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
  const softFailures = [
    ...fieldValidationWarnings("title", title),
    ...fieldValidationWarnings("liveSummary", liveSummary),
    ...fieldValidationWarnings("searchSummary", searchSummary)
  ];
  const softFailureSummary = [
    ...fieldValidationFailureSummary("title", title),
    ...fieldValidationFailureSummary("liveSummary", liveSummary),
    ...fieldValidationFailureSummary("searchSummary", searchSummary)
  ];
  const hardFailures = [
    ...(confidence ? [] : ["confidence"]),
    ...(missingEvidence ? [] : ["missingEvidence"])
  ];
  if (!confidence || !missingEvidence) {
    return { ok: false, validationFailures: [...softFailureSummary, ...hardFailures] };
  }
  const outcome = validatedOptionalField("outcome", value.outcome);
  const durableEnrichment = durableEnrichmentFromOutput(fallback, facts, value, evidenceCatalog, model, {
    confidence,
    liveSummary,
    title
  });
  const liveSummaryValue =
    (liveSummary.ok ? liveSummary.value : undefined) || durableEnrichment.sessionSummary.text || fallback.liveSummary || fallback.title;
  const searchSummaryValue =
    (searchSummary.ok ? searchSummary.value : undefined) ||
    [durableEnrichment.sessionTitle.text, durableEnrichment.sessionSummary.text, durableEnrichment.sessionDossier.purpose]
      .filter(Boolean)
      .join(" ");
  const validationWarnings = unique([...softFailures, ...outcome.failures.map((failure) => `outcome:${failure}`)]);
  return {
    capsule: {
      ...fallback,
      action: stringField(value.action) ?? fallback.action,
      confidence,
      durableEnrichment,
      liveSummary: liveSummaryValue,
      missingEvidence,
      object: stringField(value.object) ?? fallback.object,
      outcome: (outcome.ok ? outcome.value : undefined) ?? fallback.outcome,
      providerStatus: "success",
      searchPhrases: unique([...(fallback.searchPhrases ?? []), durableEnrichment.sessionTitle.text, durableEnrichment.sessionSummary.text, searchSummaryValue]),
      searchSummary: searchSummaryValue,
      sessionDossier: durableEnrichment.sessionDossier,
      sessionSummary: durableEnrichment.sessionSummary,
      sessionTitle: durableEnrichment.sessionTitle,
      title: durableEnrichment.sessionTitle.text,
      titleSource: "llm",
      validationWarnings: validationWarnings.length > 0 ? validationWarnings : fallback.validationWarnings
    },
    ok: true
  };
}

function validatedField(
  field: "title" | "liveSummary" | "searchSummary",
  value: unknown
): { ok: true; value: string; failures: [] } | { ok: false; value: string; failures: string[] } {
  if (typeof value !== "string") return { ok: false, failures: ["missing"], value: "" };
  const result = validateNarrativeField(field, value);
  return result.ok ? { ok: true, failures: [], value: result.value } : { ok: false, failures: result.failures, value: result.value };
}

function validatedOptionalField(field: "outcome", value: unknown): { ok: true; value: string; failures: [] } | { ok: false; value?: string; failures: string[] } {
  if (typeof value !== "string") return { failures: [], ok: false };
  const result = validateNarrativeField(field, value);
  return result.ok ? { failures: [], ok: true, value: result.value } : { failures: result.failures, ok: false, value: result.value };
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

function durableEnrichmentFromOutput(
  fallback: SessionCapsule,
  facts: SessionFacts,
  value: Record<string, unknown>,
  evidenceCatalog: ProviderEvidenceCatalogItem[],
  model: string,
  fields: {
    confidence: "high" | "medium" | "low";
    liveSummary: ReturnType<typeof validatedField>;
    title: ReturnType<typeof validatedField>;
  }
): NonNullable<SessionCapsule["durableEnrichment"]> {
  const merged = {
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

  const canUseTopLevelTitle = !isRecord(value.sessionTitle) && fields.title.ok;
  const canUseTopLevelSummary = !isRecord(value.sessionSummary) && fields.liveSummary.ok;
  return {
    ...merged,
    sessionSummary: canUseTopLevelSummary
      ? {
          ...merged.sessionSummary,
          confidence: fields.confidence,
          text: fields.liveSummary.value
        }
      : merged.sessionSummary,
    sessionTitle: canUseTopLevelTitle
      ? {
          ...merged.sessionTitle,
          basis: "dominant_work",
          confidence: fields.confidence,
          text: fields.title.value
        }
      : merged.sessionTitle
  };
}

function fieldValidationWarnings(
  field: "title" | "liveSummary" | "searchSummary",
  result: ReturnType<typeof validatedField>
): string[] {
  return result.failures.map((failure) => `${field}:${failure}`);
}

function fieldValidationFailureSummary(
  field: "title" | "liveSummary" | "searchSummary",
  result: ReturnType<typeof validatedField>
): string[] {
  return result.failures.length > 0 ? [field, ...fieldValidationWarnings(field, result)] : [];
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
