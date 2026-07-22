import type { EvidenceRef } from "../core/types";
import { redactText } from "../core/redaction.ts";
import { cleanSessionText, isWeakLiveSummary } from "../shared/sessionTextQuality.ts";
import type {
  DurableSessionEnrichment,
  DurableVerificationStatus,
  EnrichmentConfidence,
  SessionSummaryEnrichment,
  SessionSummaryState,
  SessionTitleBasis,
  SessionTitleEnrichment
} from "../shared/sessionEnrichment.ts";
import type { SessionFacts } from "./sessionCompiler.ts";

export type TextValidationResult = { ok: true; value: string } | { ok: false; value: string; failures: string[] };

const BANNED_TITLE_PHRASES = [
  "recent activity",
  "session update",
  "work in progress",
  "being updated",
  "being fixed",
  "has recent",
  "had recent",
  "quiet but open",
  "needs attention",
  "ui changes",
  "session activity",
  "implementation work",
  "code updates",
  "bug fixes"
];

const BANNED_SUMMARY_PHRASES = [
  "recent activity",
  "session update",
  "being worked on",
  "being updated around",
  "being fixed around",
  "work is focused on",
  "has recent",
  "had recent",
  "quiet but open"
];

export type ProviderEvidenceCatalogItem = {
  id: string;
  label: string;
  ref: EvidenceRef;
};

export function validateSessionTitleText(value: string | undefined): TextValidationResult {
  const title = normalize(value);
  const failures: string[] = [];
  const normalized = title.toLowerCase();
  const wordCount = title.split(" ").filter(Boolean).length;

  if (!title) failures.push("empty");
  if (wordCount < 3 || wordCount > 8) failures.push("word_count");
  if (/[.!?]$/.test(title)) failures.push("sentence_punctuation");
  if (looksLikeRawCommand(title)) failures.push("command_like");
  if (containsSensitiveMarker(title)) failures.push("secret_like");
  if (looksLikePathUrlOrEmail(title)) failures.push("path_url_or_email");
  if (looksSerialized(title)) failures.push("serialized");
  if (BANNED_TITLE_PHRASES.some((phrase) => normalized.includes(phrase))) failures.push("banned_phrase");
  if (!/[a-z]/i.test(title)) failures.push("missing_letters");

  return failures.length === 0 ? { ok: true, value: title } : { ok: false, failures, value: title };
}

export function validateSessionSummaryText(value: string | undefined): TextValidationResult {
  const summary = normalize(value);
  const failures: string[] = [];
  const normalized = summary.toLowerCase();

  if (!summary) failures.push("empty");
  if (summary.length < 50 || summary.length > 220) failures.push("length");
  if (!/[.!?]$/.test(summary)) failures.push("missing_punctuation");
  if (looksLikeRawCommand(summary)) failures.push("command_like");
  if (containsSensitiveMarker(summary)) failures.push("secret_like");
  if (looksLikePathUrlOrEmail(summary)) failures.push("path_url_or_email");
  if (looksSerialized(summary)) failures.push("serialized");
  if (containsFirstPersonOrDirectAddress(summary)) failures.push("perspective");
  if (BANNED_SUMMARY_PHRASES.some((phrase) => normalized.includes(phrase))) failures.push("banned_phrase");
  if (isWeakLiveSummary(summary)) failures.push("weak_live_summary");

  return failures.length === 0 ? { ok: true, value: summary } : { ok: false, failures, value: summary };
}

export function fallbackDurableSessionEnrichment(facts: SessionFacts): DurableSessionEnrichment {
  return {
    keywords: [],
    sessionDossier: {
      blockers: [],
      continuation: {
        constraints: [],
        nextStep: "Review the original source transcript if more context is needed.",
        openQuestions: []
      },
      decisions: [],
      evidenceRefs: facts.evidence.slice(0, 8),
      keyWork: keyWorkFromFacts(facts),
      outcome: "Masthead imported limited session metadata for this record.",
      purpose: "Not enough transcript evidence is available to identify the session purpose reliably.",
      verification: verificationFromFacts(facts),
      warnings: ["Durable enrichment used a low-confidence fallback."]
    },
    sessionSummary: fallbackSummary(facts),
    sessionTitle: fallbackTitle(facts),
    source: "deterministic",
    version: "session-capsule-v4"
  };
}

export function buildProviderEvidenceCatalog(evidence: EvidenceRef[]): ProviderEvidenceCatalogItem[] {
  return evidence.slice(0, 24).map((ref) => ({
    id: ref.id,
    label: `${ref.kind}:${ref.source}`,
    ref
  }));
}

export function mergeDurableProviderOutput(
  fallback: DurableSessionEnrichment,
  output: unknown,
  evidenceCatalog: ProviderEvidenceCatalogItem[]
): DurableSessionEnrichment {
  if (!isRecord(output)) return fallback;
  const title = isRecord(output.sessionTitle) ? output.sessionTitle : undefined;
  const summary = isRecord(output.sessionSummary) ? output.sessionSummary : undefined;
  const dossier = isRecord(output.sessionDossier) ? output.sessionDossier : undefined;
  const titleText = validateSessionTitleText(stringField(title?.text));
  const summaryText = validateSessionSummaryText(stringField(summary?.text));

  const mergedTitle: SessionTitleEnrichment = titleText.ok
    ? {
        basis: sessionTitleBasis(title?.basis),
        confidence: confidenceField(title?.confidence) ?? fallback.sessionTitle.confidence,
        evidenceRefs: evidenceRefsFromIds(title?.evidenceRefIds, evidenceCatalog),
        text: titleText.value
      }
    : fallback.sessionTitle;
  const mergedSummary: SessionSummaryEnrichment = summaryText.ok
    ? {
        confidence: confidenceField(summary?.confidence) ?? fallback.sessionSummary.confidence,
        evidenceRefs: evidenceRefsFromIds(summary?.evidenceRefIds, evidenceCatalog),
        state: sessionSummaryState(summary?.state),
        text: summaryText.value
      }
    : fallback.sessionSummary;

  return {
    ...fallback,
    sessionDossier: dossier
      ? {
          blockers: stringArray(dossier.blockers, 8),
          continuation: {
            constraints: stringArray(isRecord(dossier.continuation) ? dossier.continuation.constraints : undefined, 8),
            nextStep: stringField(isRecord(dossier.continuation) ? dossier.continuation.nextStep : undefined),
            openQuestions: stringArray(isRecord(dossier.continuation) ? dossier.continuation.openQuestions : undefined, 8)
          },
          decisions: stringArray(dossier.decisions, 8),
          evidenceRefs: evidenceRefsFromIds(dossier.evidenceRefIds, evidenceCatalog),
          keyWork: stringArray(dossier.keyWork, 10),
          outcome: stringField(dossier.outcome),
          purpose: stringField(dossier.purpose),
          verification: {
            commands: stringArray(isRecord(dossier.verification) ? dossier.verification.commands : undefined, 8),
            evidenceRefs: evidenceRefsFromIds(isRecord(dossier.verification) ? dossier.verification.evidenceRefIds : undefined, evidenceCatalog),
            failures: stringArray(isRecord(dossier.verification) ? dossier.verification.failures : undefined, 8),
            status: verificationStatus(isRecord(dossier.verification) ? dossier.verification.status : undefined),
            summary:
              stringField(isRecord(dossier.verification) ? dossier.verification.summary : undefined) ??
              fallback.sessionDossier.verification.summary
          },
          warnings: stringArray(dossier.warnings, 8)
        }
      : fallback.sessionDossier,
    sessionSummary: mergedSummary,
    sessionTitle: mergedTitle,
    source: "remote_model"
  };
}

function fallbackTitle(facts: SessionFacts): SessionTitleEnrichment {
  const candidates = [
    { basis: "first_prompt" as const, confidence: "medium" as const, value: nounPhraseFromPrompt(facts.objective) },
    ...facts.messages.map((message) => ({ basis: "first_prompt" as const, confidence: "medium" as const, value: nounPhraseFromPrompt(message) })),
    { basis: "dominant_work" as const, confidence: "medium" as const, value: facts.title },
    { basis: "file_cluster" as const, confidence: "low" as const, value: titleFromFiles(facts.files) },
    { basis: "fallback" as const, confidence: "low" as const, value: facts.project ? `${facts.project} imported evidence` : undefined },
    { basis: "fallback" as const, confidence: "low" as const, value: "Imported session evidence" }
  ];
  for (const candidate of candidates) {
    const selected = validateSessionTitleText(candidate.value);
    if (selected.ok) {
      return {
        basis: candidate.basis,
        confidence: candidate.confidence,
        evidenceRefs: facts.evidence.slice(0, 3),
        text: selected.value
      };
    }
  }
  return {
    basis: "fallback",
    confidence: "low",
    evidenceRefs: facts.evidence.slice(0, 3),
    text: "Imported session evidence"
  };
}

function fallbackSummary(facts: SessionFacts): SessionSummaryEnrichment {
  const project = cleanSessionText(facts.project, 40) ?? "Masthead";
  return {
    confidence: "low",
    evidenceRefs: facts.evidence.slice(0, 3),
    state: "unknown",
    text: `Imported historical ${project} session evidence with limited durable enrichment context.`
  };
}

function verificationFromFacts(facts: SessionFacts): DurableSessionEnrichment["sessionDossier"]["verification"] {
  const narrative = facts.narrative;
  const commands = narrative?.commands
    .filter((command) => command.category === "test" || command.category === "build")
    .map((command) => command.name)
    .filter(Boolean)
    .slice(0, 8) ?? [];
  const failures = narrative?.commands
    .filter((command) => command.status === "failed" || command.exitCode !== undefined && command.exitCode !== 0)
    .map((command) => command.name)
    .filter(Boolean)
    .slice(0, 8) ?? [];
  const status: DurableVerificationStatus = narrative?.testsFailed
    ? narrative.testsPassed
      ? "mixed"
      : "failed"
    : narrative?.testsPassed
      ? "passed"
      : commands.length > 0
        ? "unknown"
        : "missing";
  return {
    commands,
    evidenceRefs: facts.evidence.slice(0, 3),
    failures,
    status,
    summary: status === "missing" ? "No reliable verification evidence was captured." : "Verification evidence was captured from session commands."
  };
}

function keyWorkFromFacts(facts: SessionFacts): string[] {
  const narrative = facts.narrative;
  return [
    narrative?.files.length ? `Changed ${narrative.files.length} file${narrative.files.length === 1 ? "" : "s"}.` : undefined,
    narrative?.commands.length ? `Ran ${narrative.commands.length} captured command${narrative.commands.length === 1 ? "" : "s"}.` : undefined
  ].filter((value): value is string => Boolean(value));
}

function nounPhraseFromPrompt(value: string | undefined): string | undefined {
  const cleaned = cleanSessionText(value, 120);
  if (!cleaned) return undefined;
  return cleaned
    .replace(/^(please\s+)?(fix|add|create|update|wire|make|implement|build|document|configure|validate|repair)\s+/i, "")
    .replace(/[.!?]+$/g, "")
    .split(/\b(?:so|because|while|then|and then|with)\b/i)[0]
    ?.trim();
}

function titleFromFiles(files: string[]): string | undefined {
  const first = files[0]?.split("/").filter(Boolean).at(-1)?.replace(/\.[a-z0-9]+$/i, "");
  if (!first) return undefined;
  return `${readablePhrase(first)} file changes`;
}

function evidenceRefsFromIds(value: unknown, evidenceCatalog: ProviderEvidenceCatalogItem[]): EvidenceRef[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map(evidenceCatalog.map((item) => [item.id, item.ref]));
  return value
    .map((id) => (typeof id === "string" ? byId.get(id) : undefined))
    .filter((ref): ref is EvidenceRef => Boolean(ref));
}

function sessionTitleBasis(value: unknown): SessionTitleBasis {
  if (
    value === "first_prompt" ||
    value === "dominant_work" ||
    value === "final_outcome" ||
    value === "file_cluster" ||
    value === "debug_target" ||
    value === "fallback"
  ) {
    return value;
  }
  return "dominant_work";
}

function confidenceField(value: unknown): EnrichmentConfidence | undefined {
  return value === "high" || value === "medium" || value === "low" ? value : undefined;
}

function sessionSummaryState(value: unknown): SessionSummaryState {
  if (value === "completed" || value === "blocked" || value === "partial" || value === "failed" || value === "paused" || value === "unknown") {
    return value;
  }
  return "unknown";
}

function verificationStatus(value: unknown): DurableVerificationStatus {
  if (value === "passed" || value === "failed" || value === "mixed" || value === "missing" || value === "unknown") return value;
  return "unknown";
}

function stringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(stringField).filter((entry): entry is string => Boolean(entry)).slice(0, limit);
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const cleaned = cleanSessionText(value, 240);
  if (!cleaned) return undefined;
  if (redactText(cleaned) !== cleaned) return undefined;
  return isUnsafeDossierText(cleaned) ? undefined : cleaned;
}

function normalize(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function readablePhrase(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_./]+/g, " ").replace(/\s+/g, " ").trim();
}

function looksLikeRawCommand(value: string): boolean {
  return /^(?:npm|pnpm|yarn|node|python|python3|bash|sh|zsh|git|curl|cat|sed|rg|grep)\s+/i.test(value);
}

function containsSensitiveMarker(value: string): boolean {
  return /\b(?:private|confidential|secret|token|password)\b/i.test(value) || redactText(value) !== value;
}

function looksLikePathUrlOrEmail(value: string): boolean {
  return (
    /[a-z][a-z0-9+.-]*:\/\//i.test(value) ||
    /\b[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\?)+/.test(value) ||
    /\b[A-Za-z]:\/(?:[^/:*?"<>|\r\n\s]+\/?)+/.test(value) ||
    /\\\\[^\\\s]+\\[^\\\s]+/.test(value) ||
    /@/.test(value) ||
    /(?:^|[^A-Za-z0-9_])(?:~|\.{1,2})?\/\S+/.test(value)
  );
}

function looksSerialized(value: string): boolean {
  return value.startsWith("{") || value.startsWith("[") || value.includes('"event"') || value.includes("\\n");
}

function containsFirstPersonOrDirectAddress(value: string): boolean {
  return /\b(?:i|me|my|mine|we|us|our|ours|you|your|yours)\b/i.test(value);
}

function isUnsafeDossierText(value: string): boolean {
  return looksLikeRawCommand(value) || containsSensitiveMarker(value) || looksLikePathUrlOrEmail(value) || looksSerialized(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
