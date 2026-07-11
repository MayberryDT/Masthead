import { getTranscriptCoverage } from "../daemon/db/sessionTranscriptRepository.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";

export type CaptureQualityFailureReason = "no_messages" | "hook_only" | "metadata_only" | "duplicate_noise" | "missing_identity";
export type CaptureQualityPassReason = "meaningful_message" | "usable_transcript";

export type CaptureQualityPrecheckResult =
  | {
      ok: true;
      reason: CaptureQualityPassReason;
      sessionId: string;
    }
  | {
      ok: false;
      reason: CaptureQualityFailureReason;
      sessionId: string;
    };

type SessionIdentityRow = {
  sessionId: string;
};

export function runCaptureQualityPrecheck(db: MastheadDatabase, sessionId: string): CaptureQualityPrecheckResult {
  const session = db
    .prepare(
      `SELECT session_id AS sessionId
      FROM sessions
      WHERE session_id = ? AND deleted_at IS NULL`
    )
    .get(sessionId) as SessionIdentityRow | undefined;
  if (!session) return { ok: false, reason: "missing_identity", sessionId };

  const coverage = getTranscriptCoverage(db, sessionId);
  const nonMessageItems =
    coverage.toolCalls + coverage.toolResults + coverage.fileEffects + coverage.runtimeSignals + coverage.checkpoints;
  const totalTranscriptItems = coverage.messages + nonMessageItems;

  if (totalTranscriptItems === 0) return { ok: false, reason: "metadata_only", sessionId };
  if (coverage.hasUsableTranscript) {
    return { ok: true, reason: coverage.userMessages > 0 ? "meaningful_message" : "usable_transcript", sessionId };
  }
  if (coverage.messages === 0 && coverage.lowValueItems >= totalTranscriptItems) return { ok: false, reason: "hook_only", sessionId };
  if (coverage.messages === 0 && nonMessageItems > coverage.lowValueItems) {
    return { ok: true, reason: "usable_transcript", sessionId };
  }
  if (coverage.messages === 0) return { ok: false, reason: "no_messages", sessionId };
  if (coverage.lowValueItems >= totalTranscriptItems) return { ok: false, reason: "duplicate_noise", sessionId };
  return { ok: false, reason: "duplicate_noise", sessionId };
}
