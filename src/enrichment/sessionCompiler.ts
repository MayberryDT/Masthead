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
  return {
    candidateDecisions: [],
    liveSummary: `${facts.project}: ${facts.title}`,
    objective: facts.objective,
    searchPhrases: unique([facts.project, facts.title, facts.objective, ...facts.commands, ...facts.files].filter(isString)),
    technologies: unique(facts.files.map(technologyFromPath).filter(isString)),
    title: facts.title,
    topics: unique([facts.project, ...facts.commands.map(firstWord), ...facts.files.map(topPathSegment)].filter(isString)),
    unresolved: []
  };
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
