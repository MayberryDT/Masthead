import {
  markStaleCurrentSessionEnrichments,
  readCurrentSessionEnrichment,
  readLatestFailedSessionEnrichment,
  upsertSessionEnrichment
} from "../daemon/db/enrichmentRepository.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import { createEnrichmentAuditLogger, type EnrichmentAuditLogger } from "./enrichmentAudit.ts";
import { buildSessionFacts } from "./sessionFacts.ts";
import {
  fingerprintSessionFacts,
  isMeaningfulSessionTitle,
  selectSessionTitle,
  SESSION_CAPSULE_PROMPT_VERSION,
  type SessionFacts
} from "./sessionCompiler.ts";
import type { EnrichmentProviderResult, EnrichmentProviderStatus, SessionEnrichmentProvider } from "./provider.ts";
import type { SessionCapsule, SessionEnrichmentKind, SessionEnrichmentRecord } from "./types.ts";

export type EnrichmentCoordinator = {
  enrich(sessionId: string): Promise<SessionEnrichmentRecord>;
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

export type EnrichmentCoordinatorOptions = {
  auditLogger?: EnrichmentAuditLogger;
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
          content: { searchText: searchProjectionText(capsule) },
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
    async ensureCurrent(sessionId) {
      const facts = buildSessionFacts(db, sessionId);
      const fingerprint = fingerprintSessionFacts(facts);
      const current = readCurrentSessionEnrichment(db, sessionId, "session_capsule", SESSION_CAPSULE_PROMPT_VERSION);
      if (current?.contentFingerprint === fingerprint) return current;
      const latestFailed = readLatestFailedSessionEnrichment(db, sessionId, "session_capsule", SESSION_CAPSULE_PROMPT_VERSION);
      if (isRecentFailureForFingerprint(latestFailed, fingerprint, now(), failureBackoffMs)) return latestFailed;
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
  failureBackoffMs: number
): record is SessionEnrichmentRecord {
  if (!record?.generatedAt || !record.contentFingerprint.startsWith(`${fingerprint}:failed:`)) return false;
  const generatedAtMs = Date.parse(record.generatedAt);
  if (!Number.isFinite(generatedAtMs)) return false;
  return nowMs - generatedAtMs < failureBackoffMs;
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
    provider: SessionEnrichmentProvider;
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
  const title = capsule.title?.trim();
  if (isMeaningfulSessionTitle(title, facts)) {
    return {
      ...capsule,
      title,
      titleSource: capsule.titleSource ?? selectSessionTitle(facts).source
    };
  }

  const selected = selectSessionTitle(facts);
  return {
    ...capsule,
    title: selected.title,
    titleSource: selected.source
  };
}

function searchProjectionText(capsule: SessionCapsule): string {
  return [
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
