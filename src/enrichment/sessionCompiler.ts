import { createHash } from "node:crypto";
import type { EvidenceRef } from "../core/types";
import { cleanSessionText, isUsefulSessionTitle } from "../shared/sessionTextQuality.ts";
import type { SessionCapsule, SessionTitleSource } from "./types";
import { fallbackDurableSessionEnrichment } from "./durableSessionEnrichment.ts";
import { draftNarrativeFromFacts } from "./sessionNarrativeDraft.ts";
import type { SessionNarrativeFacts } from "./sessionNarrativeFacts.ts";
export type { SessionTitleSource } from "./types";

export type SessionFacts = {
  sessionId: string;
  sourceSessionId?: string;
  title: string;
  project: string;
  objective?: string;
  messages: string[];
  userEvidence?: string[];
  assistantEvidence?: string[];
  commands: string[];
  files: string[];
  evidence: EvidenceRef[];
  narrative?: SessionNarrativeFacts;
};

export const SESSION_CAPSULE_PROMPT_VERSION = "session-capsule-v4";

export function fingerprintSessionFacts(facts: SessionFacts): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        commands: facts.commands,
        files: facts.files,
        messages: facts.messages,
        userEvidence: facts.userEvidence,
        assistantEvidence: facts.assistantEvidence,
        objective: facts.objective,
        narrative: facts.narrative,
        project: facts.project,
        sessionId: facts.sessionId,
        sourceSessionId: facts.sourceSessionId,
        title: facts.title
      })
    )
    .digest("hex");
}

export function deterministicCapsuleFromFacts(facts: SessionFacts): SessionCapsule {
  if (facts.narrative) {
    return capsuleFromNarrativeFacts(facts);
  }

  const titleSelection = selectSessionTitle(facts);
  const durableFields = durableCapsuleFields(facts);
  const capsule = {
    candidateDecisions: [],
    confidence: "medium",
    ...durableFields,
    liveSummary: `${facts.project}: ${titleSelection.title}`,
    missingEvidence: ["narrative facts"],
    objective: facts.objective,
    providerStatus: "success",
    searchPhrases: unique([facts.project, titleSelection.title, facts.objective, ...facts.commands, ...facts.files].filter(isString)),
    technologies: unique(facts.files.map(technologyFromPath).filter(isString)),
    title: titleSelection.title,
    titleSource: titleSelection.source,
    topics: unique([facts.project, ...facts.commands.map(firstWord), ...facts.files.map(topPathSegment)].filter(isString)),
    unresolved: []
  } satisfies SessionCapsule;
  return capsule;
}

function capsuleFromNarrativeFacts(facts: SessionFacts): SessionCapsule {
  const draft = draftNarrativeFromFacts(facts.narrative as SessionNarrativeFacts);
  const durableFields = durableCapsuleFields(facts);
  return {
    action: draft.action,
    candidateDecisions: [],
    commandsSummary: draft.commandsSummary,
    confidence: confidenceFromNarrativeCoverage(facts.narrative),
    ...durableFields,
    filesChangedSummary: draft.filesChangedSummary,
    liveSummary: draft.liveSummary,
    objective: facts.objective,
    object: draft.object,
    outcome: draft.outcome,
    missingEvidence: missingEvidenceFromNarrativeCoverage(facts.narrative),
    providerStatus: "success",
    searchPhrases: unique([...draft.searchPhrases, facts.objective, facts.project].filter(isString)),
    searchSummary: draft.searchSummary,
    subject: draft.subject,
    technologies: unique(draft.technologies),
    title: draft.title,
    titleSource: "deterministic",
    topics: unique(draft.topics),
    unresolved: [],
    validationWarnings: draft.validationWarnings,
    verificationSummary: draft.verificationSummary
  };
}

function durableCapsuleFields(facts: SessionFacts): Pick<SessionCapsule, "durableEnrichment" | "sessionDossier" | "sessionSummary" | "sessionTitle"> {
  const durableEnrichment = {
    ...fallbackDurableSessionEnrichment(facts),
    promptVersion: SESSION_CAPSULE_PROMPT_VERSION
  };
  return {
    durableEnrichment,
    sessionDossier: durableEnrichment.sessionDossier,
    sessionSummary: durableEnrichment.sessionSummary,
    sessionTitle: durableEnrichment.sessionTitle
  };
}

function confidenceFromNarrativeCoverage(narrative: SessionNarrativeFacts | undefined): "high" | "medium" | "low" {
  if (narrative?.coverage?.level === "complete") return "high";
  if (narrative?.coverage?.level === "partial") return "medium";
  if (narrative?.coverage?.level === "hook_only" || narrative?.coverage?.level === "metadata_only") return "low";
  return "medium";
}

function missingEvidenceFromNarrativeCoverage(narrative: SessionNarrativeFacts | undefined): string[] {
  const coverage = narrative?.coverage;
  if (!coverage) return ["coverage facts"];
  const missing: string[] = [];
  if (!coverage.hasUsableTranscript) missing.push("transcript");
  if (coverage.fileEffects === 0) missing.push("file effects");
  if (coverage.toolCalls === 0) missing.push("commands");
  if (coverage.tokenUsageRows === 0) missing.push("token usage");
  return missing;
}

export function selectSessionTitle(facts: SessionFacts): { title: string; source: SessionTitleSource } {
  const sessionTitle = cleanTitle(facts.title);
  if (isMeaningfulSessionTitle(sessionTitle, facts)) return { title: sessionTitle, source: "session_title" };

  const objective = cleanTitle(facts.objective);
  if (isMeaningfulSessionTitle(objective, facts)) return { title: objective, source: "objective" };

  const prompt = facts.messages.map((message) => messageTitleCandidate(message, facts)).find(isString);
  if (prompt) return { title: prompt, source: "message" };

  const project = cleanTitle(facts.project);
  if (project) return { title: `${project} session`, source: "project" };

  return { title: "Codex session", source: "fallback" };
}

function messageTitleCandidate(value: string, facts: SessionFacts): string | undefined {
  const firstUsableLine = value
    .replace(/^(user|assistant|system|tool):\s*/i, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line.length > 0 && !isPromptScaffoldLine(line));
  const cleaned = cleanTitle(firstUsableLine);
  if (!isMeaningfulSessionTitle(cleaned, facts)) return undefined;
  return cleaned;
}

function cleanTitle(value: string | undefined): string | undefined {
  return cleanSessionText(value, 80)?.replace(/[.!?]+$/g, "").trim();
}

export function isMeaningfulSessionTitle(value: string | undefined, facts: Pick<SessionFacts, "project" | "sessionId" | "sourceSessionId">): value is string {
  const cleaned = cleanTitle(value);
  return isUsefulSessionTitle(cleaned, facts);
}

function isInstructionWrapper(value: string): boolean {
  return /^(complete|finish|do|handle)\s+(the\s+)?(assignment|task|request)\s+(below|above|only)?(?:,\s*\w+)?[:\s]*$/i.test(value);
}

function isPromptScaffoldLine(value: string): boolean {
  if (isInstructionWrapper(value)) return true;
  return /^(target|change|acceptance|constraints|contract|goal)$/i.test(value.trim());
}

function firstWord(value: string): string {
  return value.trim().split(/\s+/)[0] ?? "";
}

function topPathSegment(value: string): string {
  return value.split("/").filter(Boolean)[0] ?? "";
}

function technologyFromPath(value: string): string | undefined {
  if (value.endsWith(".ts") || value.endsWith(".tsx")) return "TypeScript";
  if (value.endsWith(".rs")) return "Rust";
  if (value.endsWith(".sql")) return "SQLite";
  if (value.endsWith(".css")) return "CSS";
  return undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
