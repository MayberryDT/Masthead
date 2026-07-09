import type { LogbookArtifactDetail } from "../daemonClient";

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
};

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
