import type {
  SessionDossierAttention,
  SessionDossierCoverage,
  SessionDossierIdentity,
  SessionDossierNarrative,
  SessionDossierVerification
} from "./sessionDossier.ts";
import type { DurableSessionEnrichment } from "./sessionEnrichment.ts";

type DurableDossierPresentation = {
  attention: SessionDossierAttention[];
  coverage: SessionDossierCoverage;
  durableEnrichment?: DurableSessionEnrichment;
  identity: SessionDossierIdentity;
  narrative: SessionDossierNarrative;
  verification: SessionDossierVerification;
};

/**
 * Projects supported durable enrichment onto the human-facing dossier fields.
 * Raw excerpts, tools, files, and timeline evidence remain unchanged.
 */
export function materializeDurableDossierPresentation<T extends DurableDossierPresentation>(dossier: T): T {
  const materialized = structuredClone(dossier);
  const durable = materialized.durableEnrichment;
  if (!durable) return materialized;

  const durableDossier = durable.sessionDossier;
  materialized.identity.title = durable.sessionTitle.text;
  if (durableDossier.outcome) materialized.identity.outcome = durableDossier.outcome;
  materialized.narrative.liveSummary = durable.sessionSummary.text;
  if (durableDossier.purpose) materialized.narrative.objective = durableDossier.purpose;
  if (durableDossier.outcome) materialized.narrative.outcome = durableDossier.outcome;
  materialized.verification = {
    ...materialized.verification,
    status: durableDossier.verification.status,
    summary: durableDossier.verification.summary
  };

  if (isCapturedVerification(durableDossier.verification.status)) {
    materialized.attention = materialized.attention.filter(({ kind }) => kind !== "missing_verification");
    materialized.coverage.warnings = materialized.coverage.warnings.filter(
      ({ code }) => code !== "verification_missing"
    );
  }

  return materialized;
}

function isCapturedVerification(status: string): boolean {
  return status === "passed" || status === "failed" || status === "mixed";
}
