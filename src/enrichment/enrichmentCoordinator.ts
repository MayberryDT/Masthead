import {
  markStaleCurrentSessionEnrichments,
  readCurrentSessionEnrichment,
  readLatestFailedSessionEnrichment,
  upsertSessionEnrichment
} from "../daemon/db/enrichmentRepository.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import { createEnrichmentAuditLogger, type EnrichmentAuditLogger } from "./enrichmentAudit.ts";
import { fallbackDurableSessionEnrichment } from "./durableSessionEnrichment.ts";
import { buildSessionFacts } from "./sessionFacts.ts";
import {
  deterministicCapsuleFromFacts,
  fingerprintSessionFacts,
  isMeaningfulSessionTitle,
  selectSessionTitle,
  SESSION_CAPSULE_PROMPT_VERSION,
  type SessionFacts
} from "./sessionCompiler.ts";
import type { EnrichmentProviderResult, EnrichmentProviderStatus, SessionEnrichmentProvider } from "./provider.ts";
import type { SessionTitleEnrichment } from "../shared/sessionEnrichment.ts";
import type { SessionCapsule, SessionEnrichmentKind, SessionEnrichmentRecord } from "./types.ts";

export type EnrichmentCoordinator = {
  enrich(sessionId: string): Promise<SessionEnrichmentRecord>;
  enrichSummary(sessionId: string): Promise<SessionEnrichmentRecord>;
  ensureCurrent(sessionId: string): Promise<SessionEnrichmentRecord>;
};

export class EnrichmentFailedError extends Error {
  readonly provider?: string;
  readonly model?: string;
  readonly status: EnrichmentProviderStatus;
  readonly failureMessage?: string;
  readonly record?: SessionEnrichmentRecord;

  constructor(input: {
    provider?: string;
    model?: string;
    status: EnrichmentProviderStatus;
    failureMessage?: string;
    record?: SessionEnrichmentRecord;
  }) {
    super(input.failureMessage ?? `Session enrichment failed with status ${input.status}.`);
    this.name = "EnrichmentFailedError";
    this.provider = input.provider;
    this.model = input.model;
    this.status = input.status;
    this.failureMessage = input.failureMessage;
    this.record = input.record;
  }
}

export function shouldReplaceSessionTitle(input: {
  current?: SessionTitleEnrichment;
  incoming: SessionTitleEnrichment;
  lifecycle?: string;
}): boolean {
  if (!input.current) return true;
  if (input.lifecycle !== "ended") return true;
  return confidenceRank(input.incoming.confidence) > confidenceRank(input.current.confidence);
}

function confidenceRank(value: "high" | "medium" | "low"): number {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

export type EnrichmentCoordinatorOptions = {
  auditLogger?: EnrichmentAuditLogger;
  failureBackoffAfterMs?: number;
  failureBackoffMs?: number;
  now?: () => number;
};

const DEFAULT_FAILURE_BACKOFF_MS = 10 * 60_000;

export function createEnrichmentCoordinator(
  db: MastheadDatabase,
  provider: SessionEnrichmentProvider,
  optionsOrAudit: EnrichmentCoordinatorOptions | EnrichmentAuditLogger = {}
): EnrichmentCoordinator {
  const options = isAuditLogger(optionsOrAudit) ? { auditLogger: optionsOrAudit } : optionsOrAudit;
  const audit = options.auditLogger ?? createEnrichmentAuditLogger();
  const failureBackoffAfterMs = options.failureBackoffAfterMs ?? 0;
  const failureBackoffMs = options.failureBackoffMs ?? DEFAULT_FAILURE_BACKOFF_MS;
  const now = options.now ?? Date.now;

  return {
    async enrich(sessionId) {
      const facts = buildSessionFacts(db, sessionId);
      const fingerprint = fingerprintSessionFacts(facts);
      audit.record({
        inputFingerprint: fingerprint,
        kind: "durable.started",
        model: provider.model,
        provider: provider.id,
        runtime: facts.narrative?.runtime,
        sessionId,
        sourceSessionId: facts.sourceSessionId
      });
      audit.record({
        details: facts,
        inputFingerprint: fingerprint,
        kind: "durable.facts",
        model: provider.model,
        provider: provider.id,
        runtime: facts.narrative?.runtime,
        sessionId,
        sourceSessionId: facts.sourceSessionId
      });
      const providerResult = await provider.enrich({ facts });
      const generatedAt = new Date(now()).toISOString();
      audit.record({
        details: providerResult,
        inputFingerprint: fingerprint,
        kind: "durable.provider_response",
        latencyMs: providerResult.latencyMs,
        model: providerResult.model,
        provider: providerResult.provider,
        runtime: facts.narrative?.runtime,
        sessionId,
        sourceSessionId: facts.sourceSessionId,
        status: providerResult.status
      });

      if (providerResult.status !== "success" || !providerResult.capsule) {
        const record = writeFailedEnrichment(db, {
          facts,
          fingerprint,
          generatedAt,
          providerResult,
          sessionId
        });
        audit.record({
          details: {
            enrichmentId: record.enrichmentId,
            failureCode: record.failureCode,
            failureMessage: record.failureMessage
          },
          inputFingerprint: fingerprint,
          kind: "durable.failed",
          model: providerResult.model,
          provider: providerResult.provider,
          runtime: facts.narrative?.runtime,
          sessionId,
          sourceSessionId: facts.sourceSessionId,
          status: providerResult.status
        });
        throw new EnrichmentFailedError({
          failureMessage: providerResult.failureMessage,
          model: providerResult.model,
          provider: providerResult.provider,
          record,
          status: providerResult.status
        });
      }

      const capsule = applyTitleQuality(providerResult.capsule, facts);

      db.exec("BEGIN IMMEDIATE;");
      try {
        const capsuleId = writeEnrichment(db, {
          content: capsule,
          enrichmentKind: "session_capsule",
          fingerprint,
          generatedAt,
          provider,
          sessionId,
          sourceRefs: facts.evidence
        });
        writeEnrichment(db, {
          content: { text: capsule.liveSummary ?? capsule.objective ?? capsule.title },
          enrichmentKind: "live_summary",
          fingerprint,
          generatedAt,
          provider,
          sessionId,
          sourceRefs: facts.evidence
        });
        writeEnrichment(db, {
          content: {
            keywords: capsule.durableEnrichment?.keywords ?? [],
            searchText: searchProjectionText(capsule)
          },
          enrichmentKind: "search_projection",
          fingerprint,
          generatedAt,
          provider,
          sessionId,
          sourceRefs: facts.evidence
        });
        db.exec("COMMIT;");
        audit.record({
          details: { enrichmentId: capsuleId },
          inputFingerprint: fingerprint,
          kind: "durable.persisted",
          model: providerResult.model,
          provider: providerResult.provider,
          runtime: facts.narrative?.runtime,
          sessionId,
          sourceSessionId: facts.sourceSessionId,
          status: "current"
        });

        return {
          content: capsule,
          contentFingerprint: fingerprint,
          enrichmentId: capsuleId,
          enrichmentKind: "session_capsule",
          generatedAt,
          model: providerResult.model,
          promptVersion: SESSION_CAPSULE_PROMPT_VERSION,
          provider: providerResult.provider,
          sessionId,
          sourceRefs: facts.evidence,
          status: "current"
        };
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
    },
    async enrichSummary(sessionId) {
      const facts = buildSessionFacts(db, sessionId);
      const fingerprint = `${fingerprintSessionFacts(facts)}:summary`;
      const generatedAt = new Date(now()).toISOString();
      const capsule = applyTitleQuality(deterministicCapsuleFromFacts(facts), facts);
      const localProvider = { id: "deterministic", model: "local-rules" };
      const searchProjectionContent = {
        keywords: capsule.durableEnrichment?.keywords ?? [],
        objective: capsule.objective,
        outcome: capsule.outcome,
        searchSummary: capsule.searchSummary,
        searchText: searchProjectionText(capsule),
        sessionSummary: capsule.sessionSummary,
        sessionTitle: capsule.sessionTitle,
        technologies: capsule.technologies,
        title: capsule.title,
        titleSource: capsule.titleSource,
        topics: capsule.topics
      };

      db.exec("BEGIN IMMEDIATE;");
      try {
        writeEnrichment(db, {
          content: { text: capsule.liveSummary ?? capsule.objective ?? capsule.title },
          enrichmentKind: "live_summary",
          fingerprint,
          generatedAt,
          provider: localProvider,
          sessionId,
          sourceRefs: facts.evidence
        });
        const searchProjectionId = writeEnrichment(db, {
          content: searchProjectionContent as SessionEnrichmentRecord["content"],
          enrichmentKind: "search_projection",
          fingerprint,
          generatedAt,
          provider: localProvider,
          sessionId,
          sourceRefs: facts.evidence
        });
        db.exec("COMMIT;");
        return {
          content: searchProjectionContent as SessionEnrichmentRecord["content"],
          contentFingerprint: fingerprint,
          enrichmentId: searchProjectionId,
          enrichmentKind: "search_projection",
          generatedAt,
          model: localProvider.model,
          promptVersion: SESSION_CAPSULE_PROMPT_VERSION,
          provider: localProvider.id,
          sessionId,
          sourceRefs: facts.evidence,
          status: "current"
        };
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
    },
    async ensureCurrent(sessionId) {
      const facts = buildSessionFacts(db, sessionId);
      const fingerprint = fingerprintSessionFacts(facts);
      const current = readCurrentSessionEnrichment(db, sessionId, "session_capsule", SESSION_CAPSULE_PROMPT_VERSION);
      if (current?.contentFingerprint === fingerprint && recordMatchesProvider(current, provider) && !isWeakCurrentEnrichment(current, facts)) return current;
      const latestFailed = readLatestFailedSessionEnrichment(db, sessionId, "session_capsule", SESSION_CAPSULE_PROMPT_VERSION);
      if (isRecentFailureForFingerprint(latestFailed, fingerprint, now(), failureBackoffMs, provider, failureBackoffAfterMs)) return latestFailed;
      return this.enrich(sessionId);
    }
  };
}

function writeFailedEnrichment(
  db: MastheadDatabase,
  options: {
    facts: SessionFacts;
    fingerprint: string;
    generatedAt: string;
    providerResult: EnrichmentProviderResult;
    sessionId: string;
  }
): SessionEnrichmentRecord {
  const failureFingerprint = `${options.fingerprint}:failed:${options.providerResult.status}`;
  const recordWithoutId: Omit<SessionEnrichmentRecord, "enrichmentId"> = {
    contentFingerprint: failureFingerprint,
    enrichmentKind: "session_capsule",
    failureCode: options.providerResult.status,
    failureMessage: options.providerResult.failureMessage,
    generatedAt: options.generatedAt,
    model: options.providerResult.model,
    promptVersion: SESSION_CAPSULE_PROMPT_VERSION,
    provider: options.providerResult.provider,
    sessionId: options.sessionId,
    sourceRefs: options.facts.evidence,
    status: "failed"
  };
  const enrichmentId = upsertSessionEnrichment(db, recordWithoutId);
  return {
    ...recordWithoutId,
    enrichmentId
  };
}

function isRecentFailureForFingerprint(
  record: SessionEnrichmentRecord | undefined,
  fingerprint: string,
  nowMs: number,
  failureBackoffMs: number,
  provider: SessionEnrichmentProvider,
  failureBackoffAfterMs: number
): record is SessionEnrichmentRecord {
  if (!record?.generatedAt || !record.contentFingerprint.startsWith(`${fingerprint}:failed:`)) return false;
  if (!recordMatchesProvider(record, provider)) return false;
  const generatedAtMs = Date.parse(record.generatedAt);
  if (!Number.isFinite(generatedAtMs)) return false;
  if (generatedAtMs < failureBackoffAfterMs) return false;
  return nowMs - generatedAtMs < failureBackoffMs;
}

function recordMatchesProvider(record: SessionEnrichmentRecord, provider: SessionEnrichmentProvider): boolean {
  return record.provider === provider.id && record.model === provider.model;
}

function isWeakCurrentEnrichment(record: SessionEnrichmentRecord, facts: SessionFacts): boolean {
  if (!hasRichTranscriptEvidence(facts)) return false;
  const capsule = record.content as SessionCapsule | undefined;
  if (!capsule) return true;
  const warnings = [
    ...(capsule.validationWarnings ?? []),
    ...(capsule.sessionDossier?.warnings ?? []),
    ...(capsule.durableEnrichment?.sessionDossier.warnings ?? [])
  ];
  if (warnings.some((warning) => /fallback|liveSummary:missing|searchSummary:missing|sessionSummary:missing|sessionDossier:missing/i.test(warning))) {
    return true;
  }
  if (capsule.sessionSummary?.confidence === "low" && /limited durable enrichment context/i.test(capsule.sessionSummary.text)) return true;
  if (/not enough transcript evidence/i.test(capsule.sessionDossier?.purpose ?? "")) return true;
  return false;
}

function hasRichTranscriptEvidence(facts: SessionFacts): boolean {
  const userCount = facts.userEvidence?.filter((entry) => entry.trim().length > 0).length ?? 0;
  const assistantCount = facts.assistantEvidence?.filter((entry) => entry.trim().length > 0).length ?? 0;
  return assistantCount > 0 && userCount + assistantCount >= 2;
}

function isAuditLogger(value: EnrichmentCoordinatorOptions | EnrichmentAuditLogger): value is EnrichmentAuditLogger {
  return typeof (value as EnrichmentAuditLogger).record === "function";
}

function writeEnrichment(
  db: MastheadDatabase,
  options: {
    content: SessionEnrichmentRecord["content"];
    enrichmentKind: SessionEnrichmentKind;
    fingerprint: string;
    generatedAt: string;
    provider: Pick<SessionEnrichmentProvider, "id" | "model">;
    sessionId: string;
    sourceRefs: SessionEnrichmentRecord["sourceRefs"];
  }
): string {
  markStaleCurrentSessionEnrichments(db, {
    enrichmentKind: options.enrichmentKind,
    exceptContentFingerprint: options.fingerprint,
    promptVersion: SESSION_CAPSULE_PROMPT_VERSION,
    sessionId: options.sessionId
  });
  return upsertSessionEnrichment(db, {
    content: options.content,
    contentFingerprint: options.fingerprint,
    enrichmentKind: options.enrichmentKind,
    generatedAt: options.generatedAt,
    model: options.provider.model,
    promptVersion: SESSION_CAPSULE_PROMPT_VERSION,
    provider: options.provider.id,
    sessionId: options.sessionId,
    sourceRefs: options.sourceRefs,
    status: "current"
  });
}

function applyTitleQuality(capsule: SessionCapsule, facts: SessionFacts): SessionCapsule {
  const fallbackDurable = fallbackDurableSessionEnrichment(facts);
  const durableBase = capsule.durableEnrichment ?? fallbackDurable;
  const durableTitle = capsule.sessionTitle ?? durableBase.sessionTitle;
  const durableSummary = capsule.sessionSummary ?? durableBase.sessionSummary;
  const durableDossier = capsule.sessionDossier ?? durableBase.sessionDossier;
  const durableTitleCandidate = durableTitle.confidence === "low" && durableTitle.basis === "fallback" ? undefined : durableTitle.text?.trim();
  const title = durableTitleCandidate || capsule.title?.trim();
  const selected = isMeaningfulSessionTitle(title, facts)
    ? { source: capsule.titleSource ?? selectSessionTitle(facts).source, title }
    : selectSessionTitle(facts);
  const sessionTitle = isMeaningfulSessionTitle(durableTitleCandidate, facts)
    ? durableTitle
    : {
        ...durableTitle,
        confidence: "low" as const,
        text: selected.title
      };
  return {
    ...capsule,
    durableEnrichment: {
      ...durableBase,
      sessionDossier: durableDossier,
      sessionSummary: durableSummary,
      sessionTitle
    },
    sessionDossier: durableDossier,
    sessionSummary: durableSummary,
    sessionTitle,
    title: selected.title,
    titleSource: selected.source
  };
}

function searchProjectionText(capsule: SessionCapsule): string {
  return [
    ...(capsule.durableEnrichment?.keywords ?? []),
    capsule.sessionTitle?.text,
    capsule.sessionSummary?.text,
    capsule.sessionDossier?.purpose,
    capsule.sessionDossier?.outcome,
    ...(capsule.sessionDossier?.keyWork ?? []),
    ...(capsule.sessionDossier?.decisions ?? []),
    ...(capsule.sessionDossier?.blockers ?? []),
    capsule.sessionDossier?.verification.summary,
    capsule.sessionDossier?.continuation.nextStep,
    capsule.title,
    capsule.objective,
    capsule.liveSummary,
    capsule.outcome,
    capsule.searchSummary,
    capsule.filesChangedSummary,
    capsule.commandsSummary,
    capsule.verificationSummary,
    ...capsule.topics,
    ...capsule.technologies,
    ...capsule.searchPhrases,
    ...capsule.candidateDecisions.map((claim) => claim.text),
    ...capsule.unresolved.map((claim) => claim.text)
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
}
