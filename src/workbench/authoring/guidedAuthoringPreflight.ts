import { getSessionDossier } from "../../daemon/db/sessionDossierRepository.ts";
import type { MastheadDatabase } from "../../daemon/db/sqlite.ts";
import {
  readWorkbenchSessionState,
  type WorkbenchSessionStateRecord
} from "../../daemon/db/workbenchPipelineRepository.ts";
import type { SessionDossierDto } from "../../shared/sessionDossier.ts";
import type { WorkbenchAuthoringEvidenceManifest } from "../../shared/workbenchAuthoring.ts";
import type { WorkbenchAuthoringV5SelectionDto } from "../../shared/workbenchAuthoringV5.ts";
import * as evidenceCatalog from "./evidenceCatalog.ts";
import type {
  AuthoringEvidenceRevisionInput,
  AuthoringEvidenceSessionSnapshot
} from "./evidenceCatalog.ts";

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
  selection: WorkbenchAuthoringV5SelectionDto;
};

type GuidedSessionEligibility =
  | {
      eligible: true;
      dossier: SessionDossierDto;
      evidence: WorkbenchAuthoringEvidenceManifest["sessions"][number];
    }
  | {
      eligible: false;
      reason: WorkbenchAuthoringV5SelectionDto["excludedSessions"][number]["reason"];
    };

export function evaluateWorkbenchAuthoringV5Eligibility(
  db: MastheadDatabase,
  sessionId: string,
  captured?: AuthoringEvidenceSessionSnapshot
): GuidedSessionEligibility {
  const readinessReason = workbenchAuthoringV5ReadinessReason(db, sessionId);
  if (readinessReason) return { eligible: false, reason: readinessReason };
  const dossier = getSessionDossier(db, sessionId);
  if (!dossier) return { eligible: false, reason: "session_not_found" };
  const evidence = captured ?? evidenceCatalog.getAuthoringEvidenceSnapshot(db, [sessionId]).sessions[0]!;
  if (!evidence.usableCanonicalEvidence) {
    return { eligible: false, reason: "missing_canonical_evidence" };
  }
  return {
    dossier,
    eligible: true,
    evidence: evidence.evidence
  };
}

export function workbenchAuthoringV5ReadinessReason(
  db: MastheadDatabase,
  sessionId: string,
  options: { reEnrich?: boolean } = {}
): WorkbenchAuthoringV5SelectionDto["excludedSessions"][number]["reason"] | undefined {
  const exists = db.prepare("SELECT 1 AS present FROM sessions WHERE session_id = ?").get(sessionId);
  if (!exists) return "session_not_found";
  const state = readWorkbenchSessionState(db, sessionId);
  const eligiblePublicationStatus = state?.publicationStatus === "publish_path" ||
    (options.reEnrich === true && state?.publicationStatus === "published");
  if (state && !eligiblePublicationStatus) return "not_on_publish_path";
  if (!state || !workbenchStateIsCompileReady(state, options)) return "not_compile_ready";
  return undefined;
}

export function isWorkbenchAuthoringV5CompileReady(
  db: MastheadDatabase,
  state: WorkbenchSessionStateRecord
): boolean {
  return workbenchStateIsCompileReady(state) && evidenceCatalog.hasUsableAuthoringEvidence(db, state.sessionId);
}

function workbenchStateIsCompileReady(state: WorkbenchSessionStateRecord, options: { reEnrich?: boolean } = {}): boolean {
  const transcriptReady = state.transcriptStatus === "available" || state.transcriptStatus === "imported";
  return (state.publicationStatus === "publish_path" || (options.reEnrich === true && state.publicationStatus === "published")) &&
    transcriptReady && state.qualityStatus === "passed";
}

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
  const sessions: GuidedCompileReadySession[] = [];
  const excludedSessions: WorkbenchAuthoringV5SelectionDto["excludedSessions"] = [];
  for (const sessionId of sessionIds) {
    const eligibility = evaluateWorkbenchAuthoringV5Eligibility(db, sessionId, snapshotById.get(sessionId)!);
    if (!eligibility.eligible) {
      excludedSessions.push({ reason: eligibility.reason, sessionId });
      continue;
    }
    sessions.push({ dossier: eligibility.dossier, evidence: eligibility.evidence, ordinal: sessions.length, sessionId });
  }
  return {
    manifest: snapshot.manifest,
    revisionInputs: sessions.map(({ sessionId }) => snapshotById.get(sessionId)!.revisionInput),
    selection: {
      eligibleSessionCount: sessions.length,
      excludedSessionCount: excludedSessions.length,
      excludedSessions,
      requestedSessionCount: sessionIds.length
    },
    sessions
  };
}
