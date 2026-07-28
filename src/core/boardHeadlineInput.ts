import type { BoardHeadlineFacts } from "./boardHeadlineFacts.ts";
import type { BoardHeadlineState } from "./boardHeadlineFrame.ts";

export type BoardHeadlineSignal =
  | "approval_waiting"
  | "user_reply_waiting"
  | "command_failed"
  | "repeated_failure"
  | "stalled"
  | "verification_missing"
  | "verification_stale"
  | "high_risk_change"
  | "conflict_detected";

export type BoardHeadlineStateHint = BoardHeadlineState;

export type BoardHeadlineInput = {
  lifecycle: string;
  primaryStatus: string;
  stateHint: BoardHeadlineStateHint;
  signals: BoardHeadlineSignal[];
  subjectCandidates: string[];
  dispositionHints: string[];
  evidence: string[];
  facts: BoardHeadlineFacts;
};

export function toBoardHeadlineInput(input: {
  lifecycle: string;
  primaryStatus: string;
  signals: BoardHeadlineSignal[];
  facts: BoardHeadlineFacts;
}): BoardHeadlineInput {
  const { facts, lifecycle, primaryStatus, signals } = input;
  const canonical = facts.canonicalEnrichment;
  const transcriptMessages = facts.recentTranscriptMessages ?? [];
  const transcriptSubjects = collectTranscriptSubjects(transcriptMessages);
  const transcriptSupport = transcriptSubjectSupport(transcriptMessages);
  const hasTranscriptSubjects = transcriptSubjects.length > 0;

  return {
    lifecycle,
    primaryStatus,
    stateHint: stateHintFor({ lifecycle, primaryStatus, signals }),
    signals,
    subjectCandidates: uniqueBounded(
      [
        ...transcriptSubjects,
        canonical?.subject,
        canonical?.object,
        supportedWorkContextLabel(facts.workContext?.label, {
          hasTranscriptSubjects,
          transcriptMentionsSettings: transcriptSupport.settings,
          pathClusters: facts.workContext?.pathClusters ?? []
        }),
        ...facts.recentFileBasenames.flatMap((basename) =>
          fileSubjectCandidates(basename, {
            // Settings file basenames only promote Settings UI when transcript is about settings,
            // or when there is no transcript subject and path clusters are settings-focused.
            allowSettingsSubjects: hasTranscriptSubjects
              ? transcriptSupport.settings
              : isSettingsFocusedClusters(facts.workContext?.pathClusters),
            hasTranscriptSubjects
          })
        ),
        facts.title,
        facts.project
      ],
      12
    ),
    dispositionHints: uniqueBounded(
      [
        facts.latestFeedback?.summary,
        ...facts.recentCommandFailures,
        ...facts.attentionTitles,
        canonical?.action,
        canonical?.outcome,
        canonical?.liveSummary,
        ...transcriptMessages,
        ...facts.recentEvents.map((event) => event.summary)
      ],
      12
    ),
    evidence: uniqueBounded(
      [
        ...transcriptMessages,
        ...facts.recentEvents.map((event) => event.summary),
        ...facts.recentCommandFailures,
        ...facts.attentionTitles,
        ...facts.conflictTitles,
        ...facts.recentFileBasenames,
        ...facts.recentToolNames
      ],
      20
    ),
    facts
  };
}

function stateHintFor(input: {
  lifecycle: string;
  primaryStatus: string;
  signals: BoardHeadlineSignal[];
}): BoardHeadlineStateHint {
  const lifecycle = input.lifecycle.toLowerCase();
  const primaryStatus = input.primaryStatus.toLowerCase();
  const signals = new Set(input.signals);

  if (lifecycle === "ended" && (primaryStatus === "failed" || primaryStatus === "error")) {
    return "failed";
  }
  if (lifecycle === "ended" && isBlockedStatus(primaryStatus)) {
    return "blocked";
  }
  if (lifecycle === "ended") {
    return "completed";
  }
  if (primaryStatus === "blocked" || signals.has("command_failed") || signals.has("repeated_failure")) {
    return "blocked";
  }
  if (signals.has("approval_waiting") || signals.has("user_reply_waiting") || primaryStatus.includes("waiting")) {
    return "waiting";
  }
  if (signals.has("verification_missing") || signals.has("verification_stale")) {
    return "needs_verification";
  }
  if (lifecycle === "idle" || lifecycle === "stalled" || primaryStatus === "idle" || primaryStatus === "stalled" || signals.has("stalled")) {
    return "paused";
  }
  if (lifecycle === "running") {
    return "active";
  }
  return "unknown";
}

function isBlockedStatus(value: string): boolean {
  return /(^|[\s_-])blocked($|[\s_-])/.test(value);
}

/**
 * Rank specific user-task phrases above domain-map singleton labels across the
 * whole transcript so offlineSubject / LLM prompts see work substance first.
 */
function collectTranscriptSubjects(messages: string[]): string[] {
  const specificPhrases: string[] = [];
  const domainAndOther: string[] = [];

  for (const message of messages) {
    const { specific, rest } = transcriptSubjectCandidates(message);
    specificPhrases.push(...specific);
    domainAndOther.push(...rest);
  }

  return uniqueBounded([...specificPhrases, ...domainAndOther], 8);
}

function transcriptSubjectCandidates(message: string): { specific: string[]; rest: string[] } {
  const normalized = cleanText(message);
  if (!normalized) return { specific: [], rest: [] };

  // Assistant openers never contribute subject candidates (even domain hits).
  if (isAssistantOpener(normalized)) {
    return { specific: [], rest: [] };
  }

  const withoutLeadingAction = stripLeadingTaskFiller(normalized);
  const specificPhrase =
    specificUserTaskPhrase(withoutLeadingAction) ?? specificUserTaskPhrase(normalized);

  const restRaw = [
    ...domainSubjectCandidates(withoutLeadingAction),
    ...domainSubjectCandidates(normalized),
    capitalizedPhrase(withoutLeadingAction)
  ];

  const rest = uniqueBounded(
    restRaw.filter((candidate) => candidate && !isAssistantOpener(candidate) && candidate !== specificPhrase),
    6
  );
  const specific = specificPhrase ? [specificPhrase] : [];
  return { specific, rest };
}

/**
 * Multi-word task phrase from a user message after filler strip.
 * Requires enough substance to beat a singleton domain label (e.g. "Logbook").
 */
function specificUserTaskPhrase(value: string): string | undefined {
  const cleaned = cleanText(value)?.replace(/[.?!,:;]+$/g, "");
  if (!cleaned) return undefined;
  if (isAssistantOpener(cleaned)) return undefined;

  const words = cleaned.split(/\s+/).filter(Boolean);
  // Need more than a one/two-word domain singleton when enough words exist.
  if (words.length < 3) return undefined;

  const slice = words.slice(0, 6);
  let phrase = slice.join(" ");
  while (phrase.length > 56 && slice.length > 3) {
    slice.pop();
    phrase = slice.join(" ");
  }
  // Drop trailing glue words so subjects do not end mid-clause ("… from subject and").
  while (
    slice.length > 3 &&
    /^(?:and|or|the|a|an|from|to|for|of|with|by|on|in|at|into|over|after|before)$/i.test(slice[slice.length - 1] ?? "")
  ) {
    slice.pop();
    phrase = slice.join(" ");
  }
  if (phrase.length > 56 || phrase.length < 10) return undefined;

  // Exact domain-map singleton is not "specific".
  const domainHits = domainSubjectCandidates(phrase);
  if (domainHits.some((hit) => hit.toLowerCase() === phrase.toLowerCase())) {
    return undefined;
  }

  return cleanText(phrase);
}

function isAssistantOpener(value: string): boolean {
  const trimmed = value.trim();
  if (/^I (will|can|am going to)\b/i.test(trimmed)) return true;
  if (/^I(?:'m| am) (going to|here to|looking|checking|inspecting)\b/i.test(trimmed)) return true;
  if (/^Let me\b/i.test(trimmed)) return true;
  return false;
}

function capitalizedPhrase(value: string): string | undefined {
  if (isAssistantOpener(value)) return undefined;
  const words = value.replace(/[.?!,:;]+$/g, "").split(/\s+/);
  const start = words.findIndex((word) => /^[A-Z][A-Za-z0-9.-]*$/.test(word));
  if (start < 0) return undefined;
  const phrase = words.slice(start, start + 3).join(" ");
  const cleaned = cleanText(phrase);
  if (!cleaned || isAssistantOpener(cleaned)) return undefined;
  return cleaned;
}

function cleanWorkContextLabel(value: string | undefined): string | undefined {
  const cleaned = cleanText(value);
  return cleaned?.replace(/\s+(?:changes|work)$/i, "");
}

function supportedWorkContextLabel(
  value: string | undefined,
  context: {
    hasTranscriptSubjects: boolean;
    transcriptMentionsSettings: boolean;
    pathClusters: string[];
  }
): string | undefined {
  const label = cleanWorkContextLabel(value);
  if (!label) return undefined;
  if (context.hasTranscriptSubjects && isSettingsSubject(label) && !context.transcriptMentionsSettings) return undefined;
  // Multi-area path clusters must not promote Settings UI as the session subject.
  if (isSettingsSubject(label) && !context.transcriptMentionsSettings && !isSettingsFocusedClusters(context.pathClusters)) {
    return undefined;
  }
  return label;
}

function isSettingsFocusedClusters(clusters: string[] | undefined): boolean {
  if (!clusters?.length) return false;
  const unique = [...new Set(clusters)];
  return unique.every((cluster) => cluster === "settings" || cluster === "ui") && unique.includes("settings");
}

function fileSubjectCandidates(
  value: string,
  options: { allowSettingsSubjects: boolean; hasTranscriptSubjects: boolean } = {
    allowSettingsSubjects: true,
    hasTranscriptSubjects: false
  }
): string[] {
  const basename = cleanText(value);
  if (!basename) return [];

  const knownSubjects = knownFileSubjects(basename).filter((subject) => options.allowSettingsSubjects || !isSettingsSubject(subject));
  const includeBasename = !options.hasTranscriptSubjects || options.allowSettingsSubjects || !isSettingsFileBasename(basename);
  return uniqueBounded([...knownSubjects, includeBasename ? basename : undefined], 4);
}

function uniqueBounded(values: Array<string | undefined>, limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = cleanText(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= limit) break;
  }
  return result;
}

function cleanText(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function stripLeadingTaskFiller(value: string): string {
  return value.replace(
    /^(?:(?:please\s+)?(?:investigate\s+why|work\s+on|look\s+into|figure\s+out|add|build|change|fix|implement|make|polish|repair|update|wire)\s+(?:the\s+)?)+/i,
    ""
  );
}

function domainSubjectCandidates(value: string): string[] {
  const candidates: string[] = [];
  const normalized = value.replace(/[.?!,:;]+$/g, "");
  const lower = normalized.toLowerCase();

  const patterns: Array<[RegExp, string]> = [
    [/\bboard headlines?\b/i, "Board headlines"],
    [/\bheadlines?\b/i, "Board headlines"],
    [/\bheadline refresh(?:es)?\b/i, "headline refreshes"],
    [/\bdata enrichment\b/i, "data enrichment"],
    [/\bsettings danger zone\b/i, "Settings danger zone"],
    [/\bsettings ui\b/i, "Settings UI"],
    [/\bsession dossier\b/i, "Session dossier"],
    [/\blogbook\b/i, "Logbook"],
    [/\bsources screen\b/i, "Sources screen"],
    [/\btranscript import\b/i, "transcript import"],
    [/\bboard cards?\b/i, "Board cards"]
  ];

  for (const [pattern, subject] of patterns) {
    if (pattern.test(normalized)) {
      candidates.push(subject);
    }
  }

  if (lower.includes("headline") && lower.includes("refresh") && !candidates.includes("headline refreshes")) {
    candidates.push("headline refreshes");
  }
  if (lower.includes("source") && lower.includes("screen") && !candidates.includes("Sources screen")) {
    candidates.push("Sources screen");
  }
  if (lower.includes("transcript") && lower.includes("import") && !candidates.includes("transcript import")) {
    candidates.push("transcript import");
  }

  return candidates;
}

function knownFileSubjects(value: string): string[] {
  const stem = value.replace(/\.[^.]+$/g, "");
  const normalized = stem.replace(/[-_\s]+/g, "").toLowerCase();
  const subjects: string[] = [];

  if (normalized === "sessioncard" || normalized === "sessioncards") {
    subjects.push("Board cards");
  }
  if (normalized === "dangerzone") {
    subjects.push("Settings danger zone");
  }
  if (normalized.includes("settings")) {
    subjects.push("Settings UI");
  }
  if (normalized.includes("sessiondossier")) {
    subjects.push("Session dossier");
  }
  if (normalized.includes("logbook")) {
    subjects.push("Logbook");
  }
  if (normalized.includes("sources")) {
    subjects.push("Sources screen");
  }
  if (normalized.includes("transcriptimport")) {
    subjects.push("transcript import");
  }
  if (normalized.includes("boardheadline")) {
    subjects.push("Board headlines");
  }

  return subjects;
}

function transcriptSubjectSupport(messages: string[]): { settings: boolean } {
  const text = messages.join(" ");
  return {
    settings: /\bsettings?\b/i.test(text)
  };
}

function isSettingsSubject(value: string): boolean {
  return /\bsettings?\b/i.test(value);
}

function isSettingsFileBasename(value: string): boolean {
  const normalized = value.replace(/[-_\s.]+/g, "").toLowerCase();
  return normalized.includes("settings") || normalized.includes("dangerzone");
}
