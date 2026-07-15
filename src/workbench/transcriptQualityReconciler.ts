import { getTranscriptCoverage } from "../daemon/db/sessionTranscriptRepository.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import {
  ensureWorkbenchSessionState,
  markWorkbenchQuality,
  markWorkbenchQualityForReview,
  markWorkbenchTranscriptStatus,
  readWorkbenchSessionState,
  reopenWorkbenchSessionForQualityReview,
  type WorkbenchSessionStateRecord
} from "../daemon/db/workbenchPipelineRepository.ts";
import { runCaptureQualityPrecheck, type CaptureQualityPrecheckResult } from "./qualityPrecheck.ts";
import { authoringEvidenceRevision } from "./authoring/evidenceCatalog.ts";

export type TranscriptQualityReconciliationResult = {
  quality: CaptureQualityPrecheckResult;
  state?: WorkbenchSessionStateRecord;
};

export function reconcileImportedTranscript(
  db: MastheadDatabase,
  sessionId: string,
  options: { finalizeNoise?: boolean } = {}
): TranscriptQualityReconciliationResult {
  const actor = { kind: "system" as const, id: "transcript_import" };
  const finalizeNoise = options.finalizeNoise ?? true;
  const quality = runCaptureQualityPrecheck(db, sessionId);
  let state = readWorkbenchSessionState(db, sessionId);
  const sessionExists = Boolean(
    db.prepare("SELECT 1 AS found FROM sessions WHERE session_id = ? AND deleted_at IS NULL").get(sessionId)
  );
  if (!sessionExists) return { quality };
  if (!state && quality.disposition === "suppress" && !finalizeNoise) return { quality };
  state ??= ensureWorkbenchSessionState(db, sessionId);

  const coverage = getTranscriptCoverage(db, sessionId);
  const totalEvidence =
    coverage.messages +
    coverage.toolCalls +
    coverage.toolResults +
    coverage.fileEffects +
    coverage.runtimeSignals +
    coverage.checkpoints;
  const transcriptStatus = totalEvidence > 0 ? "imported" : "missing";
  if (state.transcriptStatus !== transcriptStatus) {
    state = markWorkbenchTranscriptStatus(db, {
      actor,
      details: { coverage, source: "history_import" },
      eventType: transcriptStatus === "imported" ? "transcript_imported" : "transcript_hydration_empty",
      sessionId,
      status: transcriptStatus,
      summary: transcriptStatus === "imported" ? "Transcript imported" : "Transcript hydration produced no canonical evidence"
    }).state;
  }

  const currentEvidenceRevision = authoringEvidenceRevision(db, [sessionId]);
  if (
    state.publicationStatus === "not_added_to_logbook" &&
    state.qualityDecisionSource === "automatic" &&
    state.qualityEvidenceRevision !== currentEvidenceRevision
  ) {
    state = reopenWorkbenchSessionForQualityReview(db, {
      actor,
      evidenceRevision: currentEvidenceRevision,
      sessionId
    }).state;
  }

  if (state.publicationStatus === "not_added_to_logbook" && state.qualityDecisionSource === "user") {
    return { quality, state };
  }

  if (quality.disposition === "keep") {
    if (state.qualityStatus !== "passed" || state.publicationStatus === "not_added_to_logbook") {
      state = markWorkbenchQuality(db, {
        actor,
        evidenceRevision: currentEvidenceRevision,
        qualityDecisionSource: "automatic",
        sessionId,
        status: "passed"
      }).state;
    }
  } else if (quality.disposition === "review") {
    if (
      state.nextAction !== "review_quality" ||
      state.suppressionCategory !== "insufficient_evidence" ||
      state.qualityEvidenceRevision !== currentEvidenceRevision
    ) {
      state = markWorkbenchQualityForReview(db, { actor, evidenceRevision: currentEvidenceRevision, sessionId }).state;
    }
  } else if (finalizeNoise) {
    if (state.qualityStatus !== "failed" || state.nonPublicationReason !== quality.reason) {
      state = markWorkbenchQuality(db, {
        actor,
        evidenceRevision: currentEvidenceRevision,
        qualityDecisionSource: "automatic",
        reason: quality.reason,
        sessionId,
        status: "failed",
        suppressionCategory: "confirmed_noise"
      }).state;
    }
  }

  return { quality, state };
}
