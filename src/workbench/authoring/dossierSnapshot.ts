import { createHash } from "node:crypto";
import type {
  PublishedSessionDossierV1,
  SessionDossierDto
} from "../../shared/sessionDossier.ts";

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

export function dossierSnapshotFingerprint(snapshot: PublishedSessionDossierV1): string {
  const { capturedAt: _capturedAt, reuse, ...canonical } = snapshot;
  // These two reuse fields are presentation derived from the session's current
  // publication policy. They can change immediately after this immutable
  // snapshot is published, while the underlying canonical dossier does not.
  const { copyableContext: _copyableContext, mcpIncluded: _mcpIncluded, ...stableReuse } = reuse;
  const fingerprinted = { ...canonical, reuse: stableReuse };
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
