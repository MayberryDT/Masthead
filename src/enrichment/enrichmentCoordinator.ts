import {
  markStaleCurrentSessionEnrichments,
  readCurrentSessionEnrichment,
  upsertSessionEnrichment
} from "../daemon/db/enrichmentRepository.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import { buildSessionFacts } from "./sessionFacts.ts";
import {
  fingerprintSessionFacts,
  isMeaningfulSessionTitle,
  selectSessionTitle,
  SESSION_CAPSULE_PROMPT_VERSION,
  type SessionFacts
} from "./sessionCompiler.ts";
import type { SessionEnrichmentProvider } from "./provider.ts";
import type { SessionCapsule, SessionEnrichmentKind, SessionEnrichmentRecord } from "./types.ts";

export type EnrichmentCoordinator = {
  enrich(sessionId: string): Promise<SessionEnrichmentRecord>;
  ensureCurrent(sessionId: string): Promise<SessionEnrichmentRecord>;
};

export function createEnrichmentCoordinator(db: MastheadDatabase, provider: SessionEnrichmentProvider): EnrichmentCoordinator {
  return {
    async enrich(sessionId) {
      const facts = buildSessionFacts(db, sessionId);
      const fingerprint = fingerprintSessionFacts(facts);
      const capsule = applyTitleQuality(await provider.enrich({ facts }), facts);
      const generatedAt = new Date().toISOString();

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

        return {
          content: capsule,
          contentFingerprint: fingerprint,
          enrichmentId: capsuleId,
          enrichmentKind: "session_capsule",
          generatedAt,
          model: provider.model,
          promptVersion: SESSION_CAPSULE_PROMPT_VERSION,
          provider: provider.id,
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
      return this.enrich(sessionId);
    }
  };
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
