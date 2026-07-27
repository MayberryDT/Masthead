import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import { getKnowledge } from "./knowledge.ts";
import type { ProvenanceResult } from "./types.ts";

export function getProvenance(db: MastheadDatabase, artifactId: string): ProvenanceResult | { ok: true; artifact: null } {
  const detail = getKnowledge(db, artifactId);
  if (!detail.artifact) return { artifact: null, ok: true };
  return {
    artifactId: detail.artifact.artifactId,
    kind: detail.artifact.kind,
    ok: true,
    provenance: detail.artifact.provenance,
    title: detail.artifact.title
  };
}

export function sessionInArtifactProvenance(db: MastheadDatabase, artifactId: string, sessionId: string): boolean {
  const detail = getKnowledge(db, artifactId);
  return Boolean(detail.artifact?.provenance.sessionIds.includes(sessionId));
}
