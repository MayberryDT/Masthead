import type {
  AttentionItem,
  AttributionLevel,
  ConflictCard,
  SessionEndReason,
  SessionLifecycle,
  SessionOutcomeLabel,
  SessionPlainCopy,
  SessionStatus,
  LatestFeedbackSignal,
  WorkAreaContext
} from "./types";
import type { BoardLiveCopyFacts } from "./boardLiveCopyFacts";

export type SessionCopyRefreshContext = {
  refreshId: string;
  generatedAt: string;
  refreshIntervalMs?: number;
  cardIndex: number;
};

export type SessionCopyRecentDelta = {
  eventsSinceLastRefresh: number;
  latestEventSummaries: string[];
  latestToolNames: string[];
  latestFileBasenames: string[];
};

export type SessionCopySignal =
  | "approval_waiting"
  | "user_reply_waiting"
  | "command_failed"
  | "repeated_failure"
  | "stalled"
  | "verification_missing"
  | "verification_stale"
  | "high_risk_change"
  | "conflict_detected";

export type SessionCopyInput = {
  lifecycle: SessionLifecycle;
  primaryStatus: SessionStatus;
  outcomeLabel?: SessionOutcomeLabel;
  endReason?: SessionEndReason;
  signals: SessionCopySignal[];
  conflictCount: number;
  changedFileBucket: "none" | "one" | "few" | "many";
  lastActivityBucket: "just_now" | "recent" | "quiet" | "old";
  durationBucket: "short" | "medium" | "long";
  identityConfidence: AttributionLevel;
  project?: string;
  workContext?: WorkAreaContext;
  latestFeedback?: LatestFeedbackSignal;
  refresh?: SessionCopyRefreshContext;
  recentDelta?: SessionCopyRecentDelta;
  facts?: BoardLiveCopyFacts;
};

type CopyCardLike = {
  lifecycle: SessionLifecycle;
  primaryStatus: SessionStatus;
  outcomeLabel?: SessionOutcomeLabel;
  endReason?: SessionEndReason;
  project?: string;
  changedFileCount: number;
  lastActivityLabel: string;
  durationLabel: string;
  indicators: Array<"attention" | "conflict" | "verification" | "degraded" | "risk">;
  identityConfidence: AttributionLevel;
  workContext?: WorkAreaContext;
  latestFeedbackSignal?: LatestFeedbackSignal;
};

export type SessionCopyValidationResult =
  | { ok: true; copy: SessionPlainCopy }
  | { ok: false; reason: "invalid_shape" | "unsafe_copy" | "unsupported_claim" };

export const SESSION_COPY_SCHEMA_VERSION = 1;

export function toSessionCopyInput(
  card: CopyCardLike,
  attentionItems: AttentionItem[],
  conflicts: ConflictCard[],
  options: { refresh?: SessionCopyRefreshContext; recentDelta?: SessionCopyRecentDelta; facts?: BoardLiveCopyFacts } = {}
): SessionCopyInput {
  const signals = new Set<SessionCopySignal>();
  for (const item of attentionItems) {
    const signal = signalForAttentionType(item.type);
    if (signal) signals.add(signal);
  }
  if (card.indicators.includes("risk")) signals.add("high_risk_change");
  if (card.indicators.includes("verification")) signals.add("verification_missing");
  if (conflicts.some((conflict) => conflict.sessionIds.includes((card as { sessionId?: string }).sessionId ?? ""))) {
    signals.add("conflict_detected");
  } else if (card.indicators.includes("conflict") || conflicts.length > 0) {
    signals.add("conflict_detected");
  }

  return {
    lifecycle: card.lifecycle,
    primaryStatus: card.primaryStatus,
    ...(card.outcomeLabel ? { outcomeLabel: card.outcomeLabel } : {}),
    ...(card.endReason ? { endReason: card.endReason } : {}),
    signals: [...signals].toSorted(),
    conflictCount: conflicts.length,
    changedFileBucket: changedFileBucket(card.changedFileCount),
    lastActivityBucket: lastActivityBucket(card.lastActivityLabel),
    durationBucket: durationBucket(card.durationLabel),
    identityConfidence: card.identityConfidence,
    ...projectField(card.project),
    ...(card.workContext ? { workContext: card.workContext } : {}),
    ...(card.latestFeedbackSignal
      ? {
          latestFeedback: {
            present: true,
            source: card.latestFeedbackSignal.source,
            observedAt: card.latestFeedbackSignal.observedAt,
            claims: [...card.latestFeedbackSignal.claims].toSorted(),
            ...(card.latestFeedbackSignal.summary ? { summary: card.latestFeedbackSignal.summary } : {})
          }
        }
      : {}),
    ...(options.refresh ? { refresh: options.refresh } : {}),
    ...(options.recentDelta ? { recentDelta: options.recentDelta } : {}),
    ...(options.facts ? { facts: options.facts } : {})
  };
}

export function buildDeterministicSessionCopy(input: SessionCopyInput, source: SessionPlainCopy["source"] = "deterministic"): SessionPlainCopy {
  const headline = headlineForInput(input);
  if (input.latestFeedback?.claims.includes("claims_complete") && !(input.lifecycle === "ended" && input.outcomeLabel === "completed")) {
    return {
      headline,
      status: "Session reports completion.",
      reason: input.latestFeedback.claims.includes("mentions_tests")
        ? "The latest feedback mentions completion and verification evidence."
        : "The latest feedback mentions completion evidence.",
      source
    };
  }

  if (input.lifecycle === "running") {
    if (input.signals.includes("approval_waiting")) {
      return {
        headline,
        status: "Approval is pending.",
        reason: "The session is active and paused for a decision.",
        nextStep: "Inspector details show the pending request.",
        source
      };
    }
    if (input.signals.includes("user_reply_waiting")) {
      return {
        headline,
        status: "Input is pending.",
        reason: "The session is active and waiting for a reply.",
        nextStep: "Inspector details show the waiting question.",
        source
      };
    }
    if (input.signals.includes("command_failed")) {
      return {
        headline,
        status: "Command evidence needs review.",
        reason: "The session is active, with a recent command problem to inspect.",
        nextStep: "Inspector details show the failed command evidence.",
        source
      };
    }
    return {
      headline,
      status: "Work is active.",
      reason: "This session is active and has recent activity.",
      source
    };
  }

  if (input.lifecycle === "idle") {
    return {
      headline,
      status: "Work is quiet.",
      reason: "This session has not ended, but it has been quiet recently.",
      nextStep: "Inspector details show the last observed activity.",
      source
    };
  }

  if (input.primaryStatus === "completed_unreviewed") {
    return {
      headline,
      status: "Review is pending.",
      reason: "This session ended and still needs a quick review.",
      nextStep: "Review the evidence before filing it away.",
      source
    };
  }

  if (input.outcomeLabel === "completed" || input.primaryStatus === "completed_reviewed") {
    return {
      headline,
      status: "Filed in history.",
      reason: "This session ended without an unresolved follow-up.",
      source
    };
  }

  if (input.outcomeLabel === "failed" || input.endReason === "failed" || input.primaryStatus === "failed") {
    return {
      headline,
      status: "Follow-up is pending.",
      reason: "This session ended after a failure signal.",
      nextStep: "Review the evidence before filing it away.",
      source
    };
  }

  if (input.outcomeLabel === "blocked" || input.endReason === "blocked" || input.primaryStatus === "blocked") {
    return {
      headline,
      status: "Blocked state is recorded.",
      reason: "This session stopped before the work could continue.",
      nextStep: "Inspector details show the blocker.",
      source
    };
  }

  if (input.signals.length > 0 || input.outcomeLabel === "needs_attention" || input.outcomeLabel === "unknown") {
    return {
      headline,
      status: "Follow-up is pending.",
      reason: "This session ended with something still worth reviewing.",
      nextStep: "Review the details before filing it away.",
      source
    };
  }

  return {
    headline,
    status: "Ready for history.",
    reason: "This session has ended and has no active follow-up.",
    source
  };
}

export function validateSessionCopy(
  candidate: unknown,
  input: SessionCopyInput,
  source: SessionPlainCopy["source"] = "llm"
): SessionCopyValidationResult {
  if (!isCopyShape(candidate)) return { ok: false, reason: "invalid_shape" };
  const copy: SessionPlainCopy = {
    headline: sentenceWithTerminalPunctuation(cleanModelCopyText(candidate.headline)),
    status: sentenceWithTerminalPunctuation(cleanModelCopyText(candidate.status)),
    reason: sentenceWithTerminalPunctuation(cleanModelCopyText(candidate.reason)),
    ...(candidate.nextStep?.trim() ? { nextStep: sentenceWithTerminalPunctuation(cleanModelCopyText(candidate.nextStep)) } : {}),
    source: candidate.source ?? source
  };

  const serialized = [copy.headline, copy.status, copy.reason, copy.nextStep ?? ""].join(" ");
  if (unsafeCopyPattern.test(serialized)) return { ok: false, reason: "unsafe_copy" };
  if (isRepetitiveStatusTemplate(copy.headline, input)) return { ok: false, reason: "invalid_shape" };

  if (
    copy.headline.length < 12 ||
    copy.headline.length > 96 ||
    !isSentenceHeadline(copy.headline) ||
    copy.status.length < 2 ||
    copy.status.length > 80 ||
    copy.reason.length < 2 ||
    copy.reason.length > 180 ||
    (copy.nextStep !== undefined && copy.nextStep.length > 100)
  ) {
    return { ok: false, reason: "invalid_shape" };
  }

  if (claimsCompleted(serialized) && !supportsCompletionClaim(input)) {
    return { ok: false, reason: "unsupported_claim" };
  }

  return { ok: true, copy };
}

export function sessionCopyCacheKey(input: SessionCopyInput, model: string): string {
  return stableHash(
    JSON.stringify({
      schemaVersion: SESSION_COPY_SCHEMA_VERSION,
      model,
      input: stableSessionCopyInput(input)
    })
  );
}

function signalForAttentionType(type: AttentionItem["type"]): SessionCopySignal | undefined {
  if (type === "approval_requested") return "approval_waiting";
  if (type === "user_question") return "user_reply_waiting";
  if (type === "command_failed") return "command_failed";
  if (type === "repeated_failure") return "repeated_failure";
  if (type === "stalled") return "stalled";
  if (type === "completed_without_verification") return "verification_missing";
  if (type === "stale_verification") return "verification_stale";
  if (type === "high_risk_change") return "high_risk_change";
  if (type === "conflict") return "conflict_detected";
  return undefined;
}

function changedFileBucket(count: number): SessionCopyInput["changedFileBucket"] {
  if (count <= 0) return "none";
  if (count === 1) return "one";
  if (count <= 5) return "few";
  return "many";
}

function lastActivityBucket(label: string): SessionCopyInput["lastActivityBucket"] {
  if (/^\d+s ago$/.test(label)) return "just_now";
  if (/^\d+m ago$/.test(label)) {
    const minutes = Number.parseInt(label, 10);
    return minutes <= 10 ? "recent" : "quiet";
  }
  if (/^\d+h ago$/.test(label)) return "old";
  return "quiet";
}

function durationBucket(label: string): SessionCopyInput["durationBucket"] {
  const minutes = Number.parseInt(label, 10);
  if (!Number.isFinite(minutes) || minutes < 10) return "short";
  if (minutes < 45) return "medium";
  return "long";
}

function isCopyShape(value: unknown): value is SessionPlainCopy {
  return (
    typeof value === "object" &&
    value !== null &&
    "headline" in value &&
    typeof value.headline === "string" &&
    "status" in value &&
    typeof value.status === "string" &&
    "reason" in value &&
    typeof value.reason === "string" &&
    (!("source" in value) ||
      value.source === "deterministic" ||
      value.source === "llm" ||
      value.source === "fallback" ||
      value.source === "enrichment") &&
    (!("nextStep" in value) || value.nextStep === undefined || typeof value.nextStep === "string")
  );
}

function sentenceWithTerminalPunctuation(value: string): string {
  const normalized = value.trim();
  if (!normalized || /[.!?]$/.test(normalized)) return normalized;
  return `${normalized}.`;
}

function cleanModelCopyText(value: string): string {
  return value
    .replace(/\blatest\s+stop_hook\s+feedback\b/g, "latest feedback")
    .replace(/\bstop_hook\b/g, "latest feedback")
    .replace(/\s+/g, " ")
    .trim();
}

function claimsCompleted(value: string): boolean {
  return /\b(completed|complete|finished|done)\b/i.test(value);
}

function supportsCompletionClaim(input: SessionCopyInput): boolean {
  return input.lifecycle === "ended" && (input.outcomeLabel === "completed" || input.primaryStatus === "completed_reviewed" || input.primaryStatus === "completed_unreviewed");
}

const unsafeCopyPattern =
  /\b(you|your|tyler|urgent|critical|dangerous|please|let'?s|i\b|my|i recommend|i finished|we need|waiting for review)\b|completed_unreviewed|waiting_for_user|waiting_for_approval|ended_review|needs_action|primaryStatus|lifecycle|evidence refs|hook event|OPENAI_API_KEY|sk-|https?:\/\/|\/|\bnpm\b|\byarn\b|\bpnpm\b|\bcmd-[a-z0-9-]*/i;

function headlineForInput(input: SessionCopyInput): string {
  const activityHeadline = latestActivityHeadline(input);
  if (activityHeadline) return activityHeadline;

  const subject = headlineSubject(input.workContext?.label, input.project);
  const be = subject.plural ? "are" : "is";

  if (input.latestFeedback?.claims.includes("claims_complete") && !(input.lifecycle === "ended" && input.outcomeLabel === "completed")) {
    return `${subject.text} ${subject.plural ? "have" : "has"} a recent completion note.`;
  }

  if (input.lifecycle === "running") {
    if (input.signals.includes("approval_waiting")) return `${subject.text} ${be} paused for approval.`;
    if (input.signals.includes("user_reply_waiting")) return `${subject.text} ${be} waiting for input.`;
    if (input.signals.includes("command_failed")) return `${subject.text} ${be} showing a command failure.`;
    return `${subject.text} ${be} active now.`;
  }

  if (input.lifecycle === "idle") return `${subject.text} ${be} quiet but still open.`;

  if (input.primaryStatus === "completed_unreviewed") return completedActivityHeadline(subject);
  if (input.outcomeLabel === "completed" || input.primaryStatus === "completed_reviewed") return `${subject.text} ${be} filed in history.`;
  if (input.outcomeLabel === "failed" || input.endReason === "failed" || input.primaryStatus === "failed") {
    return `${subject.text} ended after a failure signal.`;
  }
  if (input.outcomeLabel === "blocked" || input.endReason === "blocked" || input.primaryStatus === "blocked") {
    return `${subject.text} ${be} blocked from continuing.`;
  }
  if (input.signals.length > 0 || input.outcomeLabel === "needs_attention" || input.outcomeLabel === "unknown") {
    return `${subject.text} ${input.signals.length > 0 ? "needs" : subject.plural ? "need" : "needs"} follow-up.`;
  }

  return `${subject.text} ${be} ready for history.`;
}

function isSentenceHeadline(value: string): boolean {
  return (
    /[.!?]$/.test(value) &&
    /\s/.test(value) &&
    /\b(added|blocked|checked|configured|corrected|created|deployed|documented|ended|filed|fixed|has|have|implemented|installed|is|logged|moved|need|needs|paused|published|quiet|receive|receives|recorded|removed|rendered|report|reports|reworked|rewrote|showing|shows|started|stopped|updated|uses|verified|waiting|was|were)\b/i.test(
      value
    )
  );
}

function latestActivityHeadline(input: SessionCopyInput): string | undefined {
  return (
    latestFeedbackHeadline(input.latestFeedback?.summary) ??
    latestFeedbackHeadline(input.facts?.recentEvents[0]?.summary) ??
    input.recentDelta?.latestEventSummaries.map(latestFeedbackHeadline).find(isString)
  );
}

function latestFeedbackHeadline(summary: string | undefined): string | undefined {
  const cleaned = cleanLatestFeedbackHeadline(summary);
  if (!cleaned || unsafeCopyPattern.test(cleaned) || isLowQualitySessionHeadline(cleaned)) return undefined;
  if (isSentenceHeadline(cleaned)) return cleaned;

  const sentence = sentenceFromFeedbackFragment(cleaned);
  if (!sentence || unsafeCopyPattern.test(sentence) || isLowQualitySessionHeadline(sentence) || !isSentenceHeadline(sentence)) return undefined;
  return sentence;
}

function cleanLatestFeedbackHeadline(value: string | undefined): string | undefined {
  const cleaned = neutralizeFirstPersonActivity(value)
    ?.replace(/\s+/g, " ")
    .replace(/\s+([.!?])/g, "$1")
    .trim();
  if (!cleaned) return undefined;
  if (/\bis\s*,/i.test(cleaned) || /\bgenerated\s*\./i.test(cleaned) || /(?:^|[\s:-])[-,]\s*[.!?]?$/i.test(cleaned)) return undefined;
  if (/\[[^\]]+\]\([^)]*\)/.test(cleaned)) return undefined;
  if (/\b(now|then|before|after):[.!?]?$/i.test(cleaned)) return undefined;
  return cleaned;
}

function neutralizeFirstPersonActivity(value: string | undefined): string | undefined {
  return value?.replace(
    /^I\s+(?:also\s+)?(added|checked|configured|created|deployed|documented|fixed|implemented|installed|logged|moved|published|recorded|removed|rendered|reworked|rewrote|started|stopped|updated|verified)\b/i,
    (_match, verb: string) => capitalizeFirst(verb)
  );
}

function isLowQualitySessionHeadline(value: string): boolean {
  const normalized = value.replace(/[.!?]+$/g, "").trim().toLowerCase();
  if (["codex session", "untitled session", "new session", "session", "chat session"].includes(normalized)) return true;
  if (/^[\w .-]+\s+codex session$/i.test(normalized)) return true;
  if (/^updated\b/i.test(normalized)) return true;
  if (/\b(?:ready for review|needs review|need review|work is focused on)\b/i.test(normalized)) return true;
  if (/^updated\s+(codex|untitled|new|chat)?\s*session$/i.test(normalized)) return true;
  if (/^[0-9a-f]{12,}$/i.test(normalized) || /^session[-_:][a-z0-9][a-z0-9_-]{5,}$/i.test(normalized)) return true;
  return false;
}

function sentenceFromFeedbackFragment(value: string): string | undefined {
  const fragment = value.replace(/[.!?]+$/, "").trim();
  if (!fragment || fragment.length < 12) return undefined;
  if (/^(fixed|added|removed|corrected|implemented|created|verified|moved|published|deployed|reworked|rewrote)\b/i.test(fragment)) return `${capitalizeFirst(fragment)}.`;
  return undefined;
}

function hasConcreteActivityEvidence(input: SessionCopyInput): boolean {
  return Boolean(input.latestFeedback?.summary || input.facts?.recentEvents.length || input.recentDelta?.latestEventSummaries.length);
}

function isRepetitiveStatusTemplate(value: string, input: SessionCopyInput): boolean {
  if (
    /\b(?:ready for review|needs review|need review|report(?:s)? completion and need(?:s)? review|being (?:fixed|updated|reviewed|validated) for)\b/i.test(
      value
    )
  ) {
    return true;
  }
  return hasConcreteActivityEvidence(input) && /\bwork is focused on\b/i.test(value);
}

function completedActivityHeadline(subject: { text: string; plural: boolean }): string {
  return `${subject.text} had recent activity.`;
}

function headlineSubject(label: string | undefined, project: string | undefined): { text: string; plural: boolean } {
  if (!label || label === "Session work") return { text: project ? `${project} session` : "This session", plural: false };
  if (label === "Changed-file review") return { text: "Changed files", plural: true };
  if (label === "Verification follow-up") return { text: "Verification follow-up", plural: false };
  if (label === "Test repair work" || label === "Test work") return { text: "Test repairs", plural: true };
  if (label.endsWith(" work")) {
    return { text: `${label.slice(0, -" work".length)} changes`, plural: true };
  }
  return { text: "This session", plural: false };
}

function safeProjectLabel(value: string | undefined): string | undefined {
  const label = value?.replace(/\s+/g, " ").trim();
  if (!label || /^unknown project$/i.test(label)) return undefined;
  if (label.length > 36 || !/[a-z]/i.test(label)) return undefined;
  if (/^[a-z0-9]+(?:-[a-z0-9]+){2,}$/i.test(label)) return undefined;
  if (
    /\bhttps?:\/\//i.test(label) ||
    /[\\/@]/.test(label) ||
    /\b[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\b/i.test(label) ||
    /\bsk-[A-Za-z0-9_-]+\b/i.test(label)
  ) {
    return undefined;
  }
  return label;
}

function projectField(project: string | undefined): Pick<SessionCopyInput, "project"> {
  const label = safeProjectLabel(project);
  return label ? { project: label } : {};
}

function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function lowercaseFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stableSessionCopyInput(input: SessionCopyInput): SessionCopyInput {
  return {
    ...input,
    signals: [...input.signals].toSorted()
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `copy:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
