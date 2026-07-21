import { createHash } from "node:crypto";
import type {
  PublishedSessionDossierV1,
  SessionDossierDto
} from "../../shared/sessionDossier.ts";
import { materializeDurableDossierPresentation } from "../../shared/sessionDossierMaterialization.ts";

export function buildPublishedDossierSnapshot(
  dossier: SessionDossierDto,
  capturedAt = new Date().toISOString()
): PublishedSessionDossierV1 {
  const { artifacts: _artifacts, ...canonical } = structuredClone(dossier);
  return {
    ...canonical,
    capturedAt,
    snapshotVersion: "canonical-session-dossier-v1"
  };
}

export function buildPublishedEnrichedDossierSnapshot(
  dossier: SessionDossierDto,
  capturedAt = new Date().toISOString()
): PublishedSessionDossierV1 {
  if (dossier.enrichment.status !== "current" || !dossier.durableEnrichment) {
    throw new Error("session_dossier_requires_current_enrichment");
  }
  return buildPublishedDossierSnapshot(materializeDurableDossierPresentation(dossier), capturedAt);
}

export function dossierSnapshotFingerprint(snapshot: PublishedSessionDossierV1): string {
  const { capturedAt: _capturedAt, ...fingerprinted } = snapshot;
  return createHash("sha256").update(stableStringify(fingerprinted)).digest("hex");
}

export function dossierEvidenceRefs(snapshot: PublishedSessionDossierV1): string[] {
  const refs = [
    ...(snapshot.narrative.narrativeDebug?.sourceRefs ?? []),
    ...(snapshot.durableEnrichment?.sessionTitle.evidenceRefs ?? []),
    ...(snapshot.durableEnrichment?.sessionSummary.evidenceRefs ?? []),
    ...(snapshot.durableEnrichment?.sessionDossier.evidenceRefs ?? []),
    ...(snapshot.durableEnrichment?.sessionDossier.verification.evidenceRefs ?? []),
    ...snapshot.attention.flatMap((item) => item.sourceRefs),
    ...snapshot.excerpts.map((item) => item.sourceRef),
    ...snapshot.files.map((item) => item.sourceRef),
    ...snapshot.tools.map((item) => item.sourceRef),
    ...snapshot.timeline.map((item) => item.sourceRef)
  ].flatMap(evidenceRefIds);

  return [...new Set(refs)].toSorted();
}

function evidenceRefIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(evidenceRefIds);
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!value || typeof value !== "object" || !("id" in value)) return [];
  const id = value.id;
  return typeof id === "string" && id.trim() ? [id.trim()] : [];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
