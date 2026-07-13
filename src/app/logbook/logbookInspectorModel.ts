import type { LogbookArtifactDetail, SessionTranscriptResult } from "../daemonClient";
import type { PublishedSessionDossierV1 } from "../../shared/sessionDossier";

/** Inspector-facing view of a published Logbook artifact. */
export type LogbookInspectorArtifact = {
  kind: string;
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
  provenanceTranscriptError?: string;
};

export function isPublishedSessionDossierV1(body: unknown): body is PublishedSessionDossierV1 {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  return record.snapshotVersion === "canonical-session-dossier-v1" && isObject(record.identity) && isObject(record.enrichment) && isObject(record.coverage) && isObject(record.narrative) && Array.isArray(record.files) && Array.isArray(record.tools) && isObject(record.verification) && Array.isArray(record.attention) && Array.isArray(record.excerpts) && Array.isArray(record.timeline) && isObject(record.reuse) && isObject(record.usage);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Map daemon artifact detail into inspector props. */
export function toLogbookInspectorArtifact(detail: LogbookArtifactDetail): LogbookInspectorArtifact {
  return {
    body: detail.body,
    confidence: detail.confidence ?? detail.capsule.confidence,
    evidenceRefs: detail.evidenceRefs,
    joinRationale: detail.joinRationale,
    kind: detail.capsule.kind,
    project: detail.capsule.project,
    provenanceLabel: detail.capsule.provenanceLabel,
    provenanceSessionIds: detail.provenanceSessionIds,
    publishedAt: detail.capsule.publishedAt,
    title: detail.capsule.title
  };
}
