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
  const { capturedAt: _capturedAt, ...fingerprinted } = snapshot;
  return createHash("sha256").update(stableStringify(fingerprinted)).digest("hex");
}

export function dossierEvidenceRefs(snapshot: PublishedSessionDossierV1): string[] {
  const refs = [
    ...(snapshot.narrative.narrativeDebug?.sourceRefs ?? []),
    ...snapshot.attention.flatMap((item) => item.sourceRefs),
    ...snapshot.excerpts.map((item) => item.sourceRef),
    ...snapshot.files.map((item) => item.sourceRef),
    ...snapshot.tools.map((item) => item.sourceRef),
    ...snapshot.timeline.map((item) => item.sourceRef)
  ]
    .map(evidenceRefId)
    .filter((ref): ref is string => ref !== undefined);

  return [...new Set(refs)].toSorted();
}

function evidenceRefId(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!value || typeof value !== "object" || !("id" in value)) return undefined;
  const id = value.id;
  return typeof id === "string" ? id.trim() || undefined : undefined;
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
