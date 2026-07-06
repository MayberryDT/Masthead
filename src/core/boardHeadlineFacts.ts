import type { AttentionItem, ConflictCard, GitSnapshot, NormalizedEvent, SessionCardView, WorkAreaContext, LatestFeedbackSignal } from "./types";

export type BoardHeadlineFacts = {
  sessionId: string;
  project?: string;
  runtime?: string;
  model?: string;
  lifecycle: string;
  primaryStatus: string;
  title?: string;
  workContext?: WorkAreaContext;
  latestFeedback?: LatestFeedbackSignal;
  recentEvents: Array<{
    type: string;
    summary: string;
    occurredAt: string;
  }>;
  transcriptExcerpt?: BoardHeadlineTranscriptExcerpt[];
  recentTranscriptMessages?: string[];
  recentToolNames: string[];
  recentFileBasenames: string[];
  recentCommandFailures: string[];
  changedFileCount: number;
  attentionTitles: string[];
  conflictTitles: string[];
  transcriptCoverage?: {
    hasUsableTranscript?: boolean;
    messages?: number;
  };
  canonicalEnrichment?: BoardCanonicalEnrichmentFacts;
};

export type BoardHeadlineTranscriptExcerpt = {
  role: "user" | "assistant";
  text: string;
  observedAt: string;
};

export type BoardTranscriptMessageFact = {
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  text: string;
  observedAt: string;
};

export type BoardCanonicalEnrichmentFacts = {
  title?: string;
  liveSummary?: string;
  subject?: string;
  action?: string;
  object?: string;
  outcome?: string;
  filesChangedSummary?: string;
  commandsSummary?: string;
  verificationSummary?: string;
  topics?: string[];
  technologies?: string[];
  provider?: string;
  model?: string;
  status?: string;
};

const MAX_TRANSCRIPT_EXCERPT_MESSAGES = 20;
const MAX_TRANSCRIPT_EXCERPT_TOTAL_CHARS = 10_000;
const MAX_TRANSCRIPT_EXCERPT_MESSAGE_CHARS = 900;

export function buildBoardHeadlineFacts(input: {
  card: Pick<
    SessionCardView,
    | "changedFileCount"
    | "latestFeedbackSignal"
    | "lifecycle"
    | "model"
    | "primaryStatus"
    | "project"
    | "runtime"
    | "sessionId"
    | "title"
    | "workContext"
  >;
  canonicalEnrichment?: BoardCanonicalEnrichmentFacts;
  events: NormalizedEvent[];
  gitSnapshots: GitSnapshot[];
  recentTranscriptMessages?: BoardTranscriptMessageFact[];
  attentionItems: AttentionItem[];
  conflicts: ConflictCard[];
  maxEvents?: number;
}): BoardHeadlineFacts {
  const project = safeFactLabel(input.card.project);
  const title = safeFactLabel(input.card.title);
  const recentEvents = input.events
    .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .map(eventSummary)
    .filter((event): event is NonNullable<ReturnType<typeof eventSummary>> => Boolean(event))
    .slice(0, input.maxEvents ?? 8);
  const recentToolNames = unique(
    input.events
      .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .map(toolNameFromEvent)
      .filter(isString)
  ).slice(0, 8);
  const recentFileBasenames = unique([
    ...input.events.map(fileBasenameFromEvent).filter(isString),
    ...input.gitSnapshots.flatMap((snapshot) => snapshot.changedPaths.map((path) => pathBasename(path.path))).filter(isString)
  ]).slice(0, 8);
  const attentionTitles = input.attentionItems.map((item) => item.title).filter((title) => !isLowValueBoardHeadlineText(title)).slice(0, 6);
  const conflictTitles = input.conflicts.map((conflict) => conflict.title).filter((title) => !isLowValueBoardHeadlineText(title)).slice(0, 6);
  const recentCommandFailures = input.events
    .filter(isCommandFailureEvent)
    .map((event) => event.summary)
    .filter((summary) => !isLowValueBoardHeadlineText(summary))
    .slice(0, 6);
  const transcriptExcerpt = buildTranscriptExcerpt(input.recentTranscriptMessages ?? []);
  const recentTranscriptMessages = transcriptExcerpt.map((message) => message.text);
  const nonEnrichmentEvidence = [
    project,
    title,
    input.card.workContext?.label,
    input.card.workContext?.confidence,
    input.card.latestFeedbackSignal?.summary,
    ...recentTranscriptMessages,
    ...recentEvents.map((event) => event.summary),
    ...recentToolNames,
    ...recentFileBasenames,
    ...recentCommandFailures,
    ...attentionTitles,
    ...conflictTitles
  ].filter(isString);

  return {
    attentionTitles,
    canonicalEnrichment: sanitizeCanonicalEnrichment(input.canonicalEnrichment, nonEnrichmentEvidence),
    changedFileCount: input.card.changedFileCount,
    conflictTitles,
    latestFeedback: input.card.latestFeedbackSignal,
    lifecycle: input.card.lifecycle,
    model: input.card.model,
    primaryStatus: input.card.primaryStatus,
    project,
    recentCommandFailures,
    recentEvents,
    transcriptExcerpt,
    recentTranscriptMessages,
    recentFileBasenames,
    recentToolNames,
    runtime: input.card.runtime,
    sessionId: input.card.sessionId,
    title,
    workContext: input.card.workContext
  };
}

export function isLowValueBoardHeadlineText(value: string): boolean {
  const normalized = value.trim();
  return /^(live hook event|runtime signal|unknown|shell|approval\.requested|P\d)$/i.test(normalized);
}

function eventSummary(event: NormalizedEvent): { type: string; summary: string; occurredAt: string } | undefined {
  const summary = String(event.summary || event.type).replace(/\s+/g, " ").trim();
  if (!summary || isLowValueBoardHeadlineText(summary)) return undefined;
  if (event.type === "approval.requested" && /^approval\.requested$/i.test(summary)) return undefined;
  return {
    occurredAt: event.occurredAt,
    summary,
    type: event.type
  };
}

function toolNameFromEvent(event: NormalizedEvent): string | undefined {
  if (event.type !== "command.started" && event.type !== "command.finished") return undefined;
  const value = event.payload.normalizedCommand ?? event.payload.command ?? event.payload.toolName ?? event.payload.commandId;
  if (typeof value !== "string") return undefined;
  return safeShortText(value);
}

function fileBasenameFromEvent(event: NormalizedEvent): string | undefined {
  if (event.type !== "file.changed") return undefined;
  const value = event.payload.path ?? event.payload.file ?? event.payload.filePath;
  return typeof value === "string" ? pathBasename(value) : undefined;
}

function isCommandFailureEvent(event: NormalizedEvent): boolean {
  if (event.type !== "command.finished") return false;
  const exitCode = event.payload.exitCode;
  const status = event.payload.status;
  return (typeof exitCode === "number" && exitCode !== 0) || status === "failed" || status === "error";
}

function safeShortText(value: string): string | undefined {
  const cleaned = value.replace(/\/home\/[^/\s"'`]+(?:\/[^\s"'`]*)?/g, "[redacted-path]").replace(/\s+/g, " ").trim();
  if (!cleaned || isLowValueBoardHeadlineText(cleaned)) return undefined;
  if (isGenericHarnessToolName(cleaned)) return undefined;
  return cleaned.slice(0, 120);
}

function neutralizeTranscriptText(value: string): string {
  return value
    .replace(/\bI\s+do\s+not\s+see\s+the\s+headlines\s+changing\b/gi, "Headlines are not visibly changing")
    .replace(/\bI\s+don't\s+see\s+the\s+headlines\s+changing\b/gi, "Headlines are not visibly changing")
    .replace(/\bwe\s+need\b/gi, "Need")
    .replace(/\bI\s+do\s+not\s+see\b/gi, "No visible")
    .replace(/\bI\s+don't\s+see\b/gi, "No visible")
    .replace(/\bI\s+saw\b/gi, "Saw")
    .replace(/\bI\s+even\s+restarted\b/gi, "Restarted")
    .replace(/\bI\s+think\b/gi, "Likely")
    .replace(/\bI\s+need\b/gi, "Need");
}

function buildTranscriptExcerpt(messages: BoardTranscriptMessageFact[]): BoardHeadlineTranscriptExcerpt[] {
  const selected: BoardHeadlineTranscriptExcerpt[] = [];
  const seen = new Set<string>();
  let totalChars = 0;

  for (const message of messages.toSorted((left, right) => right.observedAt.localeCompare(left.observedAt))) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const remaining = MAX_TRANSCRIPT_EXCERPT_TOTAL_CHARS - totalChars;
    if (remaining <= 0) break;

    const cleaned = transcriptExcerptText(message.text, Math.min(MAX_TRANSCRIPT_EXCERPT_MESSAGE_CHARS, remaining));
    if (!cleaned) continue;

    const key = `${message.role}:${cleaned.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    selected.push({
      observedAt: message.observedAt,
      role: message.role,
      text: cleaned
    });
    totalChars += cleaned.length;

    if (selected.length >= MAX_TRANSCRIPT_EXCERPT_MESSAGES) break;
  }

  return selected.toSorted((left, right) => left.observedAt.localeCompare(right.observedAt));
}

function transcriptExcerptText(value: string, maxChars: number): string | undefined {
  const cleaned = neutralizeTranscriptText(value)
    .replace(/\/home\/[^/\s"'`]+(?:\/[^\s"'`]*)?/g, "[redacted-path]")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length < 12) return undefined;
  if (isLowValueBoardHeadlineText(cleaned)) return undefined;
  if (isGenericHarnessToolName(cleaned)) return undefined;
  if (isUnsafeBoardHeadlineEvidence(cleaned)) return undefined;

  const clipped = cleaned.slice(0, maxChars).trim();
  if (!clipped || clipped.length < 12 || isUnsafeBoardHeadlineEvidence(clipped)) return undefined;
  return clipped;
}

function safeFactLabel(value: string | undefined): string | undefined {
  const cleaned = value ? safeShortText(value) : undefined;
  if (!cleaned) return undefined;
  if (
    /^https[-_:]/i.test(cleaned) ||
    /\bhttps?:\/\//i.test(cleaned) ||
    /[\\/@]/.test(cleaned) ||
    /\b[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\b/i.test(cleaned) ||
    /\bsk-[A-Za-z0-9_-]+\b/i.test(cleaned)
  ) {
    return undefined;
  }
  return cleaned.length <= 80 ? cleaned : undefined;
}

function isGenericHarnessToolName(value: string): boolean {
  return /^(bash|edit|glob|grep|ls|read|shell|write|apply_patch|multi_tool_use\.parallel)$/i.test(value.trim());
}

function sanitizeCanonicalEnrichment(
  enrichment: BoardCanonicalEnrichmentFacts | undefined,
  nonEnrichmentEvidence: string[]
): BoardCanonicalEnrichmentFacts | undefined {
  if (!enrichment) return undefined;
  const evidenceMentionsMcp = nonEnrichmentEvidence.some(mentionsMcp);
  const enrichmentTexts = [
    enrichment.title,
    enrichment.liveSummary,
    enrichment.subject,
    enrichment.action,
    enrichment.object,
    enrichment.outcome,
    enrichment.filesChangedSummary,
    enrichment.commandsSummary,
    enrichment.verificationSummary,
    ...(enrichment.topics ?? []),
    ...(enrichment.technologies ?? [])
  ].filter(isString);
  if (!evidenceMentionsMcp && enrichmentTexts.some(mentionsMcp)) return undefined;

  const cleaned: BoardCanonicalEnrichmentFacts = {
    action: cleanCanonicalEnrichmentText(enrichment.action),
    commandsSummary: cleanCanonicalEnrichmentText(enrichment.commandsSummary),
    filesChangedSummary: cleanCanonicalEnrichmentText(enrichment.filesChangedSummary),
    liveSummary: cleanCanonicalEnrichmentText(enrichment.liveSummary),
    model: enrichment.model,
    object: cleanCanonicalEnrichmentText(enrichment.object),
    outcome: cleanCanonicalEnrichmentText(enrichment.outcome),
    provider: enrichment.provider,
    status: enrichment.status,
    subject: cleanCanonicalEnrichmentText(enrichment.subject),
    technologies: cleanCanonicalTags(enrichment.technologies, evidenceMentionsMcp),
    title: cleanCanonicalEnrichmentText(enrichment.title),
    topics: cleanCanonicalTags(enrichment.topics, evidenceMentionsMcp),
    verificationSummary: cleanCanonicalEnrichmentText(enrichment.verificationSummary)
  };
  return hasMeaningfulCanonicalEnrichment(cleaned) ? cleaned : undefined;
}

function cleanCanonicalEnrichmentText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized || isLowValueBoardHeadlineText(normalized) || isWeakCanonicalEnrichmentText(normalized) || isUnsafeBoardHeadlineEvidence(normalized)) return undefined;
  return normalized;
}

function cleanCanonicalTags(values: string[] | undefined, evidenceMentionsMcp: boolean): string[] | undefined {
  const cleaned = unique(
    (values ?? [])
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter((value) => value && !isLowValueBoardHeadlineText(value))
      .filter((value) => evidenceMentionsMcp || !mentionsMcp(value))
  );
  return cleaned.length > 0 ? cleaned : undefined;
}

function hasMeaningfulCanonicalEnrichment(enrichment: BoardCanonicalEnrichmentFacts): boolean {
  return Boolean(
    enrichment.title ||
      enrichment.liveSummary ||
      enrichment.subject ||
      enrichment.action ||
      enrichment.object ||
      enrichment.outcome ||
      enrichment.filesChangedSummary ||
      enrichment.commandsSummary ||
      enrichment.verificationSummary ||
      enrichment.topics?.length ||
      enrichment.technologies?.length
  );
}

function isWeakCanonicalEnrichmentText(value: string): boolean {
  const normalized = value.replace(/[.!?]+$/g, "").trim();
  if (/^live hook event\b/i.test(normalized)) return true;
  if (/^updated\b/i.test(normalized)) return true;
  if (/\b(?:ready for review|needs review|need review|work is focused on)\b/i.test(normalized)) return true;
  if (/\bhas recent (?:[\w .-]+\s+)?activity\b/i.test(normalized)) return true;
  if (/\bbeing (?:fixed|updated|reviewed|validated) for\b/i.test(normalized)) return true;
  return normalized.startsWith("{") || normalized.includes('"event"');
}

function isUnsafeBoardHeadlineEvidence(value: string): boolean {
  return (
    /::[-\w]+\{[^}]*\}/i.test(value) ||
    /\[url\]/i.test(value) ||
    /\b[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\b/i.test(value) ||
    /\bsk-[A-Za-z0-9_-]+\b/i.test(value) ||
    /^https?:\/\//i.test(value)
  );
}

function mentionsMcp(value: string): boolean {
  return /\bmodel context protocol\b|(?:^|[\s/_.-])mcp(?:$|[\s/_.-])|mcp[A-Z_-]/i.test(value);
}

function pathBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
