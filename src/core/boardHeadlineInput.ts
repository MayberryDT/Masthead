import type { BoardLiveCopyFacts } from "./boardLiveCopyFacts";

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

export type BoardHeadlineStateHint =
  | "active"
  | "blocked"
  | "completed"
  | "failed"
  | "needs_verification"
  | "paused"
  | "unknown"
  | "waiting";

export type BoardHeadlineInput = {
  lifecycle: string;
  primaryStatus: string;
  stateHint: BoardHeadlineStateHint;
  signals: BoardHeadlineSignal[];
  subjectCandidates: string[];
  dispositionHints: string[];
  evidence: string[];
  facts: BoardLiveCopyFacts;
};

export function toBoardHeadlineInput(input: {
  lifecycle: string;
  primaryStatus: string;
  signals: BoardHeadlineSignal[];
  facts: BoardLiveCopyFacts;
}): BoardHeadlineInput {
  const { facts, lifecycle, primaryStatus, signals } = input;
  const canonical = facts.canonicalEnrichment;
  const transcriptMessages = facts.recentTranscriptMessages ?? [];

  return {
    lifecycle,
    primaryStatus,
    stateHint: stateHintFor({ lifecycle, primaryStatus, signals }),
    signals,
    subjectCandidates: uniqueBounded(
      [
        ...transcriptMessages.flatMap(transcriptSubjectCandidates),
        canonical?.subject,
        canonical?.object,
        cleanWorkContextLabel(facts.workContext?.label),
        ...facts.recentFileBasenames.map(fileSubject),
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
  if (lifecycle === "ended" && (primaryStatus === "failed" || primaryStatus === "error")) {
    return "failed";
  }
  if (lifecycle === "ended") {
    return "completed";
  }
  if (lifecycle === "running") {
    return "active";
  }
  return "unknown";
}

function transcriptSubjectCandidates(message: string): string[] {
  const normalized = cleanText(message);
  if (!normalized) return [];
  const withoutLeadingAction = normalized.replace(
    /^(?:add|build|change|fix|implement|make|polish|repair|update|wire)\s+(?:the\s+)?/i,
    ""
  );
  const candidates = [capitalizedPhrase(withoutLeadingAction), capitalizedPhrase(normalized)].filter(isString);
  return candidates;
}

function capitalizedPhrase(value: string): string | undefined {
  const words = value.replace(/[.?!,:;]+$/g, "").split(/\s+/);
  const start = words.findIndex((word) => /^[A-Z][A-Za-z0-9.-]*$/.test(word));
  if (start < 0) return undefined;
  const phrase = words.slice(start, start + 3).join(" ");
  return cleanText(phrase);
}

function cleanWorkContextLabel(value: string | undefined): string | undefined {
  const cleaned = cleanText(value);
  return cleaned?.replace(/\s+(?:changes|work)$/i, "");
}

function fileSubject(value: string): string | undefined {
  return cleanText(value);
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

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}
