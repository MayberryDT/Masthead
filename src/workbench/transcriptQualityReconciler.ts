import { getTranscriptCoverage } from "../daemon/db/sessionTranscriptRepository.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import {
  ensureWorkbenchSessionState,
  markWorkbenchQuality,
  markWorkbenchQualityForReview,
  markWorkbenchTranscriptStatus,
  readWorkbenchSessionState,
  removeAutomaticWorkbenchSessionForImportRepair,
  reopenWorkbenchSessionForQualityReview,
  type WorkbenchActor,
  type WorkbenchSessionStateRecord
} from "../daemon/db/workbenchPipelineRepository.ts";
import { runCaptureQualityPrecheck, type CaptureQualityPrecheckResult } from "./qualityPrecheck.ts";
import { authoringEvidenceRevision } from "./authoring/evidenceCatalog.ts";

export type TranscriptQualityReconciliationResult = {
  quality: CaptureQualityPrecheckResult;
  state?: WorkbenchSessionStateRecord;
};

/** Noise dispositions that must leave package path even during live partial ingest. */
const DEFINITIVE_SUPPRESS_REASONS = new Set([
  "empty",
  "hook_only",
  "diagnostic_only",
  "session_start_only",
  "exact_duplicate"
]);

export function isDefinitiveCaptureSuppress(quality: CaptureQualityPrecheckResult): boolean {
  return quality.disposition === "suppress" && DEFINITIVE_SUPPRESS_REASONS.has(quality.reason);
}

export function reconcileImportedTranscript(
  db: MastheadDatabase,
  sessionId: string,
  options: { actor?: WorkbenchActor; finalizeNoise?: boolean; holdForRepair?: boolean } = {}
): TranscriptQualityReconciliationResult {
  const actor = options.actor ?? { kind: "system" as const, id: "transcript_import" };
  const finalizeNoise = options.finalizeNoise ?? true;
  const quality = runCaptureQualityPrecheck(db, sessionId);
  // Grok heartbeat shells and empty units must not sit on package path waiting for
  // a transcript "import" that will never add user work (finalizeNoise=false live path).
  const shouldFinalizeSuppress = finalizeNoise || isDefinitiveCaptureSuppress(quality);
  let state = readWorkbenchSessionState(db, sessionId);
  const sessionExists = Boolean(
    db.prepare("SELECT 1 AS found FROM sessions WHERE session_id = ? AND deleted_at IS NULL").get(sessionId)
  );
  if (!sessionExists) return { quality };
  if (!state && options.holdForRepair) return { quality };
  if (!state && quality.disposition === "suppress" && !shouldFinalizeSuppress && !options.holdForRepair) {
    return { quality };
  }
  state ??= ensureWorkbenchSessionState(db, sessionId);
  if (state.publicationStatus === "published") return { quality, state };

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

  if (options.holdForRepair) {
    state = removeAutomaticWorkbenchSessionForImportRepair(db, sessionId);
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
  } else if (shouldFinalizeSuppress) {
    if (
      state.publicationStatus !== "not_added_to_logbook" ||
      state.qualityStatus !== "failed" ||
      state.nonPublicationReason !== quality.reason
    ) {
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

/**
 * Re-apply definitive noise suppression for package-path rows that should not be
 * on Workbench (Grok session-start shells, empty units, corrupt suppress state).
 */
export function suppressDefinitiveNoiseOnPublishPath(
  db: MastheadDatabase,
  options: { actor?: WorkbenchActor; limit?: number } = {}
): { scanned: number; suppressed: number; sessionIds: string[] } {
  const actor = options.actor ?? { kind: "system" as const, id: "workbench_noise_repair" };
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 500), 5000));
  const candidates = db
    .prepare(
      `SELECT session_id AS sessionId
       FROM workbench_session_state
       WHERE publication_status = 'publish_path'
       ORDER BY updated_at ASC
       LIMIT ?`
    )
    .all(limit) as Array<{ sessionId: string }>;

  const suppressed: string[] = [];
  for (const { sessionId } of candidates) {
    const before = readWorkbenchSessionState(db, sessionId);
    if (!before || before.publicationStatus !== "publish_path") continue;
    const result = reconcileImportedTranscript(db, sessionId, { actor, finalizeNoise: true });
    const after = result.state ?? readWorkbenchSessionState(db, sessionId);
    if (after?.publicationStatus === "not_added_to_logbook" && before.publicationStatus === "publish_path") {
      suppressed.push(sessionId);
    }
  }
  return { scanned: candidates.length, suppressed: suppressed.length, sessionIds: suppressed };
}
