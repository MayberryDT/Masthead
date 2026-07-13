import type { LogbookArtifactDetail, SessionTranscriptResult } from "../daemonClient";
import type { PublishedSessionDossierV1 } from "../../shared/sessionDossier";

/** Inspector-facing view of a published Logbook artifact. */
export type LogbookInspectorArtifact = {
  kind: string;
  /** The persisted artifact schema is authoritative for choosing a renderer. */
  schemaVersion?: string;
  title: string;
  confidence?: string;
  project?: string;
  publishedAt?: string;
  provenanceSessionIds: string[];
  provenanceLabel?: string;
  joinRationale?: string;
  body: unknown;
  evidenceRefs?: string[];
  provenanceTranscript?: SessionTranscriptResult;
  provenanceTranscriptLoading?: boolean;
  provenanceTranscriptError?: string;
};

export const CANONICAL_SESSION_DOSSIER_SCHEMA = "canonical-session-dossier-v1";
const LEGACY_SESSION_DOSSIER_SCHEMAS = new Set(["1", "session_dossier-v1", "session-dossier-v1"]);

export function isKnownLegacySessionDossierSchema(schemaVersion: string | undefined): boolean {
  return typeof schemaVersion === "string" && LEGACY_SESSION_DOSSIER_SCHEMAS.has(schemaVersion);
}

export function isPublishedSessionDossierV1(body: unknown): body is PublishedSessionDossierV1 {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  return (
    record.snapshotVersion === CANONICAL_SESSION_DOSSIER_SCHEMA &&
    isString(record.capturedAt) &&
    isIdentity(record.identity) &&
    isEnrichment(record.enrichment) &&
    isOptionalDurableEnrichment(record.durableEnrichment) &&
    isCoverage(record.coverage) &&
    isNarrative(record.narrative) &&
    isArrayOf(record.files, isFile) &&
    isArrayOf(record.tools, isTool) &&
    isVerification(record.verification) &&
    isArrayOf(record.attention, isAttention) &&
    isArrayOf(record.excerpts, isExcerpt) &&
    isArrayOf(record.timeline, isTimelineEvent) &&
    isReuse(record.reuse) &&
    isUsage(record.usage)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || isString(value);
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || isNumber(value);
}

function isArrayOf(value: unknown, predicate: (entry: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(predicate);
}

function isStringArray(value: unknown): boolean {
  return isArrayOf(value, isString);
}

function isIdentity(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    isString(value.sessionId) &&
    isString(value.sourceSessionId) &&
    isString(value.title) &&
    isString(value.runtime) &&
    isStringArray(value.models) &&
    isString(value.hostId) &&
    isString(value.lifecycle) &&
    isString(value.lastActivityAt) &&
    isString(value.sourceConfidence) &&
    [value.project, value.model, value.branch, value.repoRoot, value.worktreePath, value.outcome, value.startedAt, value.endedAt].every(isOptionalString) &&
    isOptionalNumber(value.durationMs)
  );
}

function isEnrichment(value: unknown): boolean {
  if (!isObject(value) || !isString(value.status)) return false;
  return [value.generatedAt, value.provider, value.model, value.failureCode, value.failureMessage].every(isOptionalString);
}

function isOptionalDurableEnrichment(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isObject(value) || !isString(value.version) || !isObject(value.sessionTitle) || !isObject(value.sessionSummary) || !isObject(value.sessionDossier)) return false;
  const dossier = value.sessionDossier;
  if (!isObject(dossier.verification) || !isObject(dossier.continuation)) return false;
  return (
    isString(value.sessionTitle.text) &&
    isString(value.sessionSummary.text) &&
    isStringArray(dossier.keyWork) &&
    isStringArray(dossier.decisions) &&
    isStringArray(dossier.blockers) &&
    isString(dossier.verification.status) &&
    isString(dossier.verification.summary) &&
    isStringArray(dossier.verification.commands) &&
    isStringArray(dossier.verification.failures) &&
    Array.isArray(dossier.verification.evidenceRefs) &&
    isStringArray(dossier.continuation.openQuestions) &&
    isStringArray(dossier.continuation.constraints) &&
    Array.isArray(dossier.evidenceRefs) &&
    isStringArray(dossier.warnings) &&
    [dossier.purpose, dossier.outcome, dossier.continuation.nextStep, value.generatedAt, value.source, value.promptVersion, value.model].every(isOptionalString)
  );
}

function isCoverage(value: unknown): boolean {
  if (!isObject(value) || !isString(value.level) || !isArrayOf(value.warnings, isCoverageWarning) || !isObject(value.transcript)) return false;
  const transcript = value.transcript;
  return (
    ["assistantMessages", "checkpoints", "fileEffects", "lowValueItems", "messages", "runtimeSignals", "toolCalls", "toolResults", "userMessages"].every(
      (key) => isNumber(transcript[key])
    ) && typeof transcript.hasUsableTranscript === "boolean"
  );
}

function isCoverageWarning(value: unknown): boolean {
  return isObject(value) && isString(value.code) && isString(value.message) && (value.action === undefined || (isObject(value.action) && isString(value.action.label) && isString(value.action.target)));
}

function isNarrative(value: unknown): boolean {
  if (!isObject(value) || !isStringArray(value.topics) || !isStringArray(value.technologies) || !isStringArray(value.unresolved)) return false;
  if (![value.objective, value.firstUserPrompt, value.latestUserPrompt, value.finalAssistantMessage, value.liveSummary, value.outcome].every(isOptionalString)) return false;
  if (value.narrativeDebug === undefined) return true;
  if (!isObject(value.narrativeDebug) || !Array.isArray(value.narrativeDebug.sourceRefs)) return false;
  return [value.narrativeDebug.promptVersion, value.narrativeDebug.failureCode, value.narrativeDebug.providerStatus].every(isOptionalString);
}

function isFile(value: unknown): boolean {
  return isObject(value) && [value.fileEffectId, value.path, value.displayPath, value.basename, value.effectKind, value.observedAt].every(isString) && typeof value.staged === "boolean" && isOptionalString(value.directory) && isOptionalNumber(value.additions) && isOptionalNumber(value.deletions);
}

function isTool(value: unknown): boolean {
  return isObject(value) && isString(value.toolCallId) && isString(value.toolName) && [value.category, value.status, value.startedAt, value.completedAt, value.outputPreview].every(isOptionalString) && isOptionalNumber(value.exitCode);
}

function isVerification(value: unknown): boolean {
  return isObject(value) && isString(value.status) && isString(value.summary) && isArrayOf(value.commands, isTool);
}

function isAttention(value: unknown): boolean {
  return isObject(value) && isString(value.kind) && isString(value.severity) && isString(value.title) && isOptionalString(value.detail) && isOptionalString(value.observedAt) && Array.isArray(value.sourceRefs);
}

function isExcerpt(value: unknown): boolean {
  return isObject(value) && [value.excerptId, value.kind, value.text, value.observedAt].every(isString) && isOptionalString(value.role);
}

function isTimelineEvent(value: unknown): boolean {
  return isObject(value) && [value.eventId, value.kind, value.label, value.summary, value.observedAt].every(isString);
}

function isReuse(value: unknown): boolean {
  return isObject(value) && typeof value.mcpIncluded === "boolean" && [value.sourceRuntime, value.sourceSessionId, value.sourceConfidence, value.canonicalSessionId, value.copyableContext].every(isString);
}

function isUsage(value: unknown): boolean {
  return isObject(value) && [value.inputTokens, value.outputTokens, value.totalTokens, value.usageRows].every(isNumber);
}

/** Map daemon artifact detail into inspector props. */
export function toLogbookInspectorArtifact(detail: LogbookArtifactDetail): LogbookInspectorArtifact {
  return {
    body: detail.body,
    confidence: detail.confidence ?? detail.capsule.confidence,
    evidenceRefs: detail.evidenceRefs,
    joinRationale: detail.joinRationale,
    kind: detail.capsule.kind,
    schemaVersion: detail.schemaVersion,
    project: detail.capsule.project,
    provenanceLabel: detail.capsule.provenanceLabel,
    provenanceSessionIds: detail.provenanceSessionIds,
    publishedAt: detail.capsule.publishedAt,
    title: detail.capsule.title
  };
}
