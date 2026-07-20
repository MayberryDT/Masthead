import { getSessionDossier } from "../../daemon/db/sessionDossierRepository.ts";
import type { MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { readWorkbenchSessionState } from "../../daemon/db/workbenchPipelineRepository.ts";
import type { SessionDossierDto } from "../../shared/sessionDossier.ts";
import type { WorkbenchAuthoringEvidenceManifest } from "../../shared/workbenchAuthoring.ts";
import * as evidenceCatalog from "./evidenceCatalog.ts";
import type { AuthoringEvidenceRevisionInput } from "./evidenceCatalog.ts";

export type GuidedCompileReadySession = {
  sessionId: string;
  ordinal: number;
  dossier: SessionDossierDto;
  evidence: WorkbenchAuthoringEvidenceManifest["sessions"][number];
};

export type GuidedSelectionPreflightResult = {
  sessions: GuidedCompileReadySession[];
  manifest: WorkbenchAuthoringEvidenceManifest;
  revisionInputs: AuthoringEvidenceRevisionInput[];
};

export function assertGuidedSelectionCompileReady(
  db: MastheadDatabase,
  sessionIds: string[]
): GuidedSelectionPreflightResult {
  if (sessionIds.length === 0) throw new Error("guided_selection_empty");
  if (sessionIds.some((sessionId) => sessionId.trim().length === 0 || sessionId !== sessionId.trim())) {
    throw new Error("authoring_session_id_blank");
  }
  const seen = new Set<string>();
  for (const sessionId of sessionIds) {
    if (seen.has(sessionId)) throw new Error(`authoring_session_id_duplicate:${sessionId}`);
    seen.add(sessionId);
  }
  const snapshot = evidenceCatalog.getAuthoringEvidenceSnapshot(db, sessionIds);
  const snapshotById = new Map(snapshot.sessions.map((session) => [session.revisionInput.sessionId, session]));
  const sessions = sessionIds.map((sessionId, ordinal) => {
    const dossier = getSessionDossier(db, sessionId);
    if (!dossier) throw new Error(`session_not_found:${sessionId}`);
    const state = readWorkbenchSessionState(db, sessionId);
    if (state && state.publicationStatus !== "publish_path") {
      throw new Error(`authoring_session_not_on_publish_path:${sessionId}`);
    }
    const transcriptReady = state?.transcriptStatus === "available" || state?.transcriptStatus === "imported";
    if (!state || state.publicationStatus !== "publish_path" || !transcriptReady || state.qualityStatus !== "passed") {
      throw new Error(`authoring_session_not_compile_ready:${sessionId}`);
    }
    const captured = snapshotById.get(sessionId)!;
    if (!captured.usableCanonicalEvidence) throw new Error(`missing_canonical_evidence:${sessionId}`);
    return { dossier, evidence: captured.evidence, ordinal, sessionId };
  });
  return {
    manifest: snapshot.manifest,
    revisionInputs: sessions.map(({ sessionId }) => snapshotById.get(sessionId)!.revisionInput),
    sessions
  };
}
