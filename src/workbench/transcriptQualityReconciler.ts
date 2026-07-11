import { getTranscriptCoverage } from "../daemon/db/sessionTranscriptRepository.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import {
  ensureWorkbenchSessionState,
  markWorkbenchQuality,
  markWorkbenchTranscriptStatus,
  readWorkbenchSessionState,
  type WorkbenchSessionStateRecord
} from "../daemon/db/workbenchPipelineRepository.ts";
import { runCaptureQualityPrecheck, type CaptureQualityPrecheckResult } from "./qualityPrecheck.ts";

export type TranscriptQualityReconciliationResult = {
  quality: CaptureQualityPrecheckResult;
  state: WorkbenchSessionStateRecord;
};

export function reconcileImportedTranscript(
  db: MastheadDatabase,
  sessionId: string,
  options: { finalizeNoise?: boolean } = {}
): TranscriptQualityReconciliationResult {
  const actor = { kind: "system" as const, id: "transcript_import" };
  const coverage = getTranscriptCoverage(db, sessionId);
  const totalEvidence =
    coverage.messages +
    coverage.toolCalls +
    coverage.toolResults +
    coverage.fileEffects +
    coverage.runtimeSignals +
    coverage.checkpoints;
  let state = readWorkbenchSessionState(db, sessionId) ?? ensureWorkbenchSessionState(db, sessionId);
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

  const quality = runCaptureQualityPrecheck(db, sessionId);
  if (quality.ok) {
    if (state.qualityStatus !== "passed" || state.publicationStatus === "not_added_to_logbook") {
      state = markWorkbenchQuality(db, { actor, sessionId, status: "passed" }).state;
    }
  } else if (options.finalizeNoise && ["duplicate_noise", "hook_only"].includes(quality.reason)) {
    if (state.qualityStatus !== "failed" || state.nonPublicationReason !== quality.reason) {
      state = markWorkbenchQuality(db, { actor, reason: quality.reason, sessionId, status: "failed" }).state;
    }
  }

  return { quality, state };
}
