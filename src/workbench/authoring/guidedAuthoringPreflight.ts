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


/**
 * Small selections keep the detailed evidence snapshot. Large select-all
 * requests use the canonical revision index so handoff creation never
 * replays millions of transcript rows while holding the daemon write reservation.
 */
export const GUIDED_EAGER_PREFLIGHT_SESSION_LIMIT = 48;


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
  if (sessionIds.length > GUIDED_EAGER_PREFLIGHT_SESSION_LIMIT) {
    return assertLargeGuidedSelectionCompileReady(db, sessionIds);
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

function assertLargeGuidedSelectionCompileReady(
  db: MastheadDatabase,
  sessionIds: string[]
): GuidedSelectionPreflightResult {
  const placeholders = sessionIds.map(() => "?").join(", ");
  const rows = db.prepare(
    `SELECT sessions.session_id AS sessionId,
            sessions.deleted_at AS deletedAt,
            state.publication_status AS publicationStatus,
            state.quality_status AS qualityStatus,
            state.transcript_status AS transcriptStatus,
            EXISTS (
              SELECT 1
              FROM messages
              WHERE messages.session_id = sessions.session_id
                AND messages.role IN ('user', 'assistant')
                AND trim(COALESCE(messages.text_redacted, '')) <> ''
                AND lower(trim(messages.text_redacted)) NOT IN ('codex hook event', 'runtime signal', 'unknown', 'shell')
            ) AS hasNarrativeEvidence
     FROM sessions
     LEFT JOIN workbench_session_state state ON state.session_id = sessions.session_id
     WHERE sessions.session_id IN (${placeholders})`
  ).all(...sessionIds) as Array<{
    sessionId: string;
    deletedAt: string | null;
    publicationStatus: string | null;
    qualityStatus: string | null;
    transcriptStatus: string | null;
    hasNarrativeEvidence: number;
  }>;
  const rowBySessionId = new Map(rows.map((row) => [row.sessionId, row]));
  const revisionInputs = evidenceCatalog.guidedAuthoringEvidenceRevisionInputs(db, sessionIds);
  const revisionsBySessionId = new Map(revisionInputs.map((input) => [input.sessionId, input]));
  const sessions: GuidedCompileReadySession[] = [];
  const excludedSessions: WorkbenchAuthoringV5SelectionDto["excludedSessions"] = [];
  for (const [ordinal, sessionId] of sessionIds.entries()) {
    const row = rowBySessionId.get(sessionId);
    if (!row || row.deletedAt !== null) {
      excludedSessions.push({ reason: "session_not_found", sessionId });
      continue;
    }
    const eligiblePublicationStatus = row.publicationStatus === "publish_path";
    if (row.publicationStatus !== null && !eligiblePublicationStatus) {
      excludedSessions.push({ reason: "not_on_publish_path", sessionId });
      continue;
    }
    const transcriptReady = row.transcriptStatus === "available" || row.transcriptStatus === "imported";
    if (row.publicationStatus !== "publish_path" || !transcriptReady || row.qualityStatus !== "passed") {
      excludedSessions.push({ reason: "not_compile_ready", sessionId });
      continue;
    }
    if (row.hasNarrativeEvidence !== 1) {
      excludedSessions.push({ reason: "missing_canonical_evidence", sessionId });
      continue;
    }
    const dossier = getSessionDossier(db, sessionId);
    if (!dossier) {
      excludedSessions.push({ reason: "session_not_found", sessionId });
      continue;
    }
    sessions.push({
      dossier,
      evidence: {
        coverage: {
          assistantMessages: 0,
          checkpoints: 0,
          fileEffects: 0,
          messages: 0,
          runtimeSignals: 0,
          toolCalls: 0,
          toolResults: 0,
          userMessages: 0
        },
        kindCounts: [],
        sessionId,
        totalItems: 0,
        warnings: []
      },
      ordinal: sessions.length,
      sessionId
    });
  }
  const selectedIds = sessions.map(({ sessionId }) => sessionId);
  const selectedRevisionInputs = selectedIds.map((sessionId) => revisionsBySessionId.get(sessionId)!);
  return {
    manifest: {
      evidenceRevision: evidenceCatalog.guidedAuthoringEvidenceRevisionFromInputs(selectedRevisionInputs),
      sessions: sessions.map(({ evidence }) => evidence)
    },
    revisionInputs: selectedRevisionInputs,
    selection: {
      eligibleSessionCount: sessions.length,
      excludedSessionCount: excludedSessions.length,
      excludedSessions,
      requestedSessionCount: sessionIds.length
    },
    sessions
  };
}
