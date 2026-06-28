import type { SessionNarrativeSubject } from "./types.ts";
import type { SessionNarrativeFacts } from "./sessionNarrativeFacts.ts";
import { narrativeWorkArea } from "./sessionNarrativeFacts.ts";
import { normalizeNarrativeText, validateNarrativeField } from "./sessionNarrativeValidator.ts";

export type SessionNarrativeDraft = {
  title: string;
  liveSummary: string;
  outcome?: string;
  searchSummary: string;
  subject: SessionNarrativeSubject;
  action: string;
  object: string;
  topics: string[];
  technologies: string[];
  filesChangedSummary?: string;
  commandsSummary?: string;
  verificationSummary?: string;
  searchPhrases: string[];
  validationWarnings?: string[];
};

export function draftNarrativeFromFacts(facts: SessionNarrativeFacts): SessionNarrativeDraft {
  const subject = subjectFromFacts(facts);
  const action = actionFromFacts(facts);
  const object = objectFromFacts(facts, subject.label);
  const filesChangedSummary = filesChangedSummaryFromFacts(facts);
  const commandsSummary = commandsSummaryFromFacts(facts);
  const verificationSummary = verificationSummaryFromFacts(facts);
  const title = firstValid("title", [
    subject.label,
    `${subject.label} ${object}`,
    `${facts.project ?? "Project"} ${object}`,
    `${facts.project ?? "Project"} work summary`
  ]);
  const liveSummary = firstValid("liveSummary", [
    liveSummaryTemplate(facts, subject.label, action, object),
    `${subject.label} is active in ${facts.project ?? "this project"}.`,
    `${facts.project ?? "Project"} work is focused on ${object}.`
  ]);
  const outcome = firstValid("outcome", [
    outcomeFromFacts(facts),
    `${pastAction(action)} ${object} for ${subject.label}.`,
    `${pastAction(action)} ${subject.label} in ${facts.project ?? "this project"}.`
  ], true);
  const searchSummary = firstValid("searchSummary", [
    [
      `${facts.project ?? "Project"} session for ${subject.label}.`,
      filesChangedSummary ? `Files: ${filesChangedSummary}.` : undefined,
      commandsSummary ? `Commands: ${commandsSummary}.` : undefined,
      verificationSummary ? `Verification: ${verificationSummary}.` : undefined,
      outcome ? `Outcome: ${outcome}` : undefined
    ]
      .filter(Boolean)
      .join(" "),
    `${facts.project ?? "Project"} session for ${subject.label} covering ${object}.`
  ]);
  const validationWarnings = validationWarningsFor({ title, liveSummary, outcome, searchSummary });

  return {
    action,
    commandsSummary,
    filesChangedSummary,
    liveSummary,
    object,
    outcome,
    searchPhrases: unique([title, subject.label, object, facts.project, ...facts.fileBasenames, ...facts.topics].filter(isString)),
    searchSummary,
    subject,
    technologies: facts.technologies,
    title,
    topics: unique([...facts.topics, subject.label.toLowerCase().replace(/\s+/g, "-")]),
    validationWarnings,
    verificationSummary
  };
}

function subjectFromFacts(facts: SessionNarrativeFacts): SessionNarrativeSubject {
  const promptSubject = subjectPhraseFromText(facts.objective ?? facts.firstUserPrompt);
  if (promptSubject) return { confidence: "high", label: promptSubject, source: facts.objective ? "objective" : "first_user_prompt" };

  const outcomeSubject = subjectPhraseFromText(facts.finalAssistantMessage ?? facts.latestFeedbackSummary);
  if (outcomeSubject) {
    return { confidence: "medium", label: outcomeSubject, source: facts.finalAssistantMessage ? "final_assistant_message" : "latest_feedback" };
  }

  const checkpointSubject = facts.checkpointSummaries.map(subjectPhraseFromText).find(isString);
  if (checkpointSubject) return { confidence: "medium", label: checkpointSubject, source: "checkpoint" };

  const storedTitleSubject = subjectFromStoredTitle(facts.storedTitle, facts);
  if (storedTitleSubject) return { confidence: "medium", label: storedTitleSubject, source: "stored_title" };

  const area = narrativeWorkArea(facts);
  if (area.confidence !== "low") return { confidence: area.confidence, label: labelForArea(area.label, facts), source: "file_cluster" };

  if (facts.branch) return { confidence: "low", label: readablePhrase(facts.branch), source: "branch" };
  if (facts.project) return { confidence: "low", label: `${facts.project} session narrative`, source: "project" };
  return { confidence: "low", label: "session narrative", source: "fallback" };
}

function actionFromFacts(facts: SessionNarrativeFacts): string {
  const text = [facts.objective, facts.firstUserPrompt, facts.finalAssistantMessage, facts.latestFeedbackSummary].filter(Boolean).join(" ");
  if (/\bfix|repair|bug|failed|failure|error\b/i.test(text) || facts.testsFailed || facts.buildFailed) return "fix";
  if (/\badd|create|introduce|new\b/i.test(text)) return "add";
  if (facts.files.length > 0 && facts.files.every((file) => file.extension === "md" || file.directory.includes("docs"))) return "document";
  if (facts.files.some((file) => file.directory.includes(".github") || file.basename.toLowerCase().includes("workflow"))) return "configure";
  if (facts.topics.includes("mcp")) return "validate";
  if (facts.testsPassed || facts.buildPassed) return "verify";
  if (facts.deployMentioned) return "configure deployment";
  return "update";
}

function objectFromFacts(facts: SessionNarrativeFacts, subject: string): string {
  const promptObject = objectPhraseFromText(facts.objective ?? facts.firstUserPrompt);
  if (promptObject) return promptObject;
  if (facts.fileBasenames.length > 0) return readablePhrase(facts.fileBasenames[0] ?? subject);
  if (facts.topics.length > 0) return readablePhrase(facts.topics[0] ?? subject);
  return subject.toLowerCase();
}

function subjectPhraseFromText(value: string | undefined): string | undefined {
  const cleaned = safeText(value);
  if (!cleaned) return undefined;
  const targetLine = cleaned
    .split(/[.!?\n]/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line.length >= 10);
  if (!targetLine) return undefined;
  const withoutDirective = targetLine.replace(/^(please\s+)?(fix|add|create|update|wire|make|implement|build|document|configure|validate|turn)\s+/i, "");
  const phrase = withoutDirective
    .replace(/\b(now|so|that|against|with|for|to)\b.*$/i, "")
    .replace(/\b(the|a|an)\s+/gi, "")
    .trim();
  return titleCasePhrase(phrase || withoutDirective).slice(0, 72);
}

function objectPhraseFromText(value: string | undefined): string | undefined {
  const subject = subjectPhraseFromText(value);
  if (!subject) return undefined;
  return subject.toLowerCase();
}

function subjectFromStoredTitle(value: string | undefined, facts: SessionNarrativeFacts): string | undefined {
  const cleaned = safeText(value);
  if (!cleaned) return undefined;
  const normalized = cleaned.toLowerCase();
  if (normalized === "codex session" || normalized === "untitled session" || normalized === "new session") return undefined;
  if (facts.project && normalized === `${facts.project.toLowerCase()} codex session`) return undefined;
  if (/^[0-9a-f]{12,}$/i.test(cleaned) || /^[0-9a-f-]{32,}$/i.test(cleaned)) return undefined;
  return titleCasePhrase(cleaned).slice(0, 72);
}

function labelForArea(area: string, facts: SessionNarrativeFacts): string {
  if (area === "MCP" && hasAny(facts, /agent access/i)) return "MCP launch configuration validation";
  if (area === "MCP") return "MCP integration";
  if (area === "Logbook") return "Canonical Logbook search";
  if (area === "Sources") return "Codex import workflow";
  if (area === "Settings") return "Settings destructive-action safeguards";
  if (area === "Daemon") return "Daemon compatibility handshake";
  if (area === "Docs") return "launch documentation";
  return `${area} work`;
}

function liveSummaryTemplate(facts: SessionNarrativeFacts, subject: string, action: string, object: string): string {
  if (action === "validate") return `${subject} is being validated against current Masthead evidence.`;
  if (action === "document") return `${subject} is being documented for ${facts.project ?? "this project"}.`;
  if (action === "verify") return `${subject} is being verified with ${facts.commands[0]?.name ?? "recorded checks"}.`;
  if (action === "configure deployment") return `${subject} is being configured for deployment.`;
  if (action === "update") return `${subject} is active in ${facts.project ?? object}.`;
  return `${subject} is being ${pastParticiple(action)} for ${facts.project ?? object}.`;
}

function outcomeFromFacts(facts: SessionNarrativeFacts): string | undefined {
  const candidate = safeText(facts.finalAssistantMessage ?? facts.latestFeedbackSummary);
  if (!candidate) return undefined;
  const sentence = candidate.split(/(?<=[.!?])\s+/).find((part) => part.length >= 18 && part.length <= 140);
  return sentence ? normalizeNarrativeText(sentence) : undefined;
}

function filesChangedSummaryFromFacts(facts: SessionNarrativeFacts): string | undefined {
  if (facts.fileBasenames.length === 0) return undefined;
  return facts.fileBasenames.slice(0, 5).join(", ");
}

function commandsSummaryFromFacts(facts: SessionNarrativeFacts): string | undefined {
  if (facts.commands.length === 0) return undefined;
  return facts.commands
    .slice(0, 4)
    .map(commandSummary)
    .join(", ");
}

function commandSummary(command: SessionNarrativeFacts["commands"][number]): string {
  if (/tools[-_]?list/i.test(command.name)) return "tools-list test";
  if (/typecheck|tsc/i.test(command.name)) return "typecheck";
  if (command.category === "test") return command.status === "succeeded" ? "passing test run" : "test run";
  if (command.category === "build") return command.status === "succeeded" ? "passing build" : "build check";
  if (command.category === "deploy") return "deployment check";
  return readablePhrase(command.name).slice(0, 80);
}

function verificationSummaryFromFacts(facts: SessionNarrativeFacts): string | undefined {
  if (facts.testsPassed) return "tests passed";
  if (facts.testsFailed) return "tests failed";
  if (facts.buildPassed) return "build passed";
  if (facts.buildFailed) return "build failed";
  return undefined;
}

function firstValid(field: "title" | "liveSummary" | "searchSummary", candidates: Array<string | undefined>): string;
function firstValid(field: "outcome", candidates: Array<string | undefined>, optional: true): string | undefined;
function firstValid(field: "title" | "liveSummary" | "outcome" | "searchSummary", candidates: Array<string | undefined>, optional = false): string | undefined {
  for (const candidate of candidates) {
    const validation = validateNarrativeField(field, candidate);
    if (validation.ok) return validation.value;
  }
  if (optional) return undefined;
  return normalizeNarrativeText(candidates.find(isString) ?? (field === "title" ? "Session narrative work" : "Session narrative work is active."));
}

function validationWarningsFor(fields: { title: string; liveSummary: string; outcome?: string; searchSummary: string }): string[] {
  return Object.entries(fields).flatMap(([field, value]) => {
    if (!value) return [];
    const result = validateNarrativeField(field as "title" | "liveSummary" | "outcome" | "searchSummary", value);
    return result.ok ? [] : result.failures.map((failure) => `${field}:${failure}`);
  });
}

function pastAction(action: string): string {
  if (action === "fix") return "Fixed";
  if (action === "add") return "Added";
  if (action === "document") return "Documented";
  if (action === "configure deployment") return "Configured";
  if (action === "validate") return "Validated";
  if (action === "verify") return "Verified";
  return "Updated";
}

function pastParticiple(action: string): string {
  if (action === "fix") return "fixed";
  if (action === "add") return "added";
  if (action === "document") return "documented";
  if (action === "configure deployment") return "configured";
  if (action === "validate") return "validated";
  if (action === "verify") return "verified";
  return "updated";
}

function safeText(value: string | undefined): string | undefined {
  const cleaned = normalizeNarrativeText(value);
  if (!cleaned || /https?:\/\//i.test(cleaned) || /(?:~|\.{1,2})?\/(?:[\w.@-]+\/)+[\w.@-]+/.test(cleaned)) return undefined;
  return cleaned;
}

function titleCasePhrase(value: string): string {
  const phrase = readablePhrase(value).replace(/\b(mcp|ui|ci|api)\b/gi, (match) => match.toUpperCase());
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function readablePhrase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(facts: SessionNarrativeFacts, pattern: RegExp): boolean {
  return [facts.objective, facts.firstUserPrompt, facts.finalAssistantMessage, ...facts.fileBasenames, ...facts.fileDirectories].some((value) =>
    pattern.test(value ?? "")
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
