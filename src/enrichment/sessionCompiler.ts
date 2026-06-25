import { createHash } from "node:crypto";
import type { EvidenceRef } from "../core/types";
import type { SessionCapsule } from "./types";

export type SessionFacts = {
  sessionId: string;
  title: string;
  project: string;
  objective?: string;
  messages: string[];
  commands: string[];
  files: string[];
  evidence: EvidenceRef[];
};

export const SESSION_CAPSULE_PROMPT_VERSION = "session-capsule-v1";

export function fingerprintSessionFacts(facts: SessionFacts): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        commands: facts.commands,
        files: facts.files,
        messages: facts.messages,
        objective: facts.objective,
        project: facts.project,
        sessionId: facts.sessionId,
        title: facts.title
      })
    )
    .digest("hex");
}

export function deterministicCapsuleFromFacts(facts: SessionFacts): SessionCapsule {
  const title = derivedTitle(facts);
  return {
    candidateDecisions: [],
    liveSummary: `${facts.project}: ${title}`,
    objective: facts.objective,
    searchPhrases: unique([facts.project, title, facts.objective, ...facts.commands, ...facts.files].filter(isString)),
    technologies: unique(facts.files.map(technologyFromPath).filter(isString)),
    title,
    topics: unique([facts.project, ...facts.commands.map(firstWord), ...facts.files.map(topPathSegment)].filter(isString)),
    unresolved: []
  };
}

function derivedTitle(facts: SessionFacts): string {
  if (isMeaningfulTitle(facts.title)) return cleanTitle(facts.title) ?? facts.title;
  const prompt = facts.messages.map(messageTitleCandidate).find(isString);
  return prompt ?? cleanTitle(facts.title) ?? `${facts.project} session`;
}

function messageTitleCandidate(value: string): string | undefined {
  const cleaned = cleanTitle(value.replace(/^(user|assistant|system|tool):\s*/i, ""));
  if (!cleaned || !isMeaningfulTitle(cleaned)) return undefined;
  return cleaned;
}

function cleanTitle(value: string | undefined): string | undefined {
  const cleaned = value
    ?.replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > 80 ? `${cleaned.slice(0, 77).trim()}...` : cleaned;
}

function isMeaningfulTitle(value: string | undefined): value is string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return false;
  return normalized !== "codex session" && normalized !== "untitled session" && normalized !== "session";
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
