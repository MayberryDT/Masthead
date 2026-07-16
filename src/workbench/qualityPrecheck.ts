import { createHash } from "node:crypto";
import {
  getTranscriptCoverage,
  iterateSessionTranscriptItems
} from "../daemon/db/sessionTranscriptRepository.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import type { CaptureQualityDisposition } from "../shared/workbench.ts";

export type { CaptureQualityDisposition } from "../shared/workbench.ts";
export type CaptureQualityPrecheckResult = CaptureQualityDisposition & { sessionId: string };

export function runCaptureQualityPrecheck(db: MastheadDatabase, sessionId: string): CaptureQualityPrecheckResult {
  const coverage = getTranscriptCoverage(db, sessionId);
  const totalEvidence =
    coverage.messages +
    coverage.toolCalls +
    coverage.toolResults +
    coverage.fileEffects +
    coverage.runtimeSignals +
    coverage.checkpoints;

  if (totalEvidence === 0) return result(sessionId, "suppress", "empty");
  if (coverage.messages === 0 && coverage.lowValueItems >= totalEvidence) {
    return result(sessionId, "suppress", "hook_only");
  }
  if (
    coverage.messages === 0 &&
    coverage.fileEffects === 0 &&
    coverage.toolCalls + coverage.toolResults === 0 &&
    coverage.checkpoints === 0 &&
    coverage.runtimeSignals > 0
  ) {
    return result(sessionId, "suppress", "diagnostic_only");
  }
  if (hasExactCanonicalDuplicate(db, sessionId)) return result(sessionId, "suppress", "exact_duplicate");
  if (coverage.fileEffects > 0) return result(sessionId, "keep", "durable_file_effect");
  if (coverage.toolCalls + coverage.toolResults >= 4 && coverage.userMessages >= 1) {
    return result(sessionId, "keep", "substantial_tool_work");
  }
  if (coverage.userMessages >= 1 && coverage.assistantMessages >= 1) {
    return result(sessionId, "keep", "meaningful_conversation");
  }
  return result(sessionId, "review", "insufficient_evidence");
}

function result<D extends CaptureQualityDisposition["disposition"]>(
  sessionId: string,
  disposition: D,
  reason: Extract<CaptureQualityDisposition, { disposition: D }>["reason"]
): CaptureQualityPrecheckResult {
  return { disposition, reason, sessionId } as CaptureQualityPrecheckResult;
}

function hasExactCanonicalDuplicate(db: MastheadDatabase, sessionId: string): boolean {
  const current = db
    .prepare("SELECT created_at AS createdAt FROM sessions WHERE session_id = ? AND deleted_at IS NULL")
    .get(sessionId) as { createdAt: string } | undefined;
  if (!current) return false;
  const fingerprint = canonicalEvidenceFingerprint(db, sessionId);
  persistCanonicalEvidenceFingerprint(db, sessionId, fingerprint);
  const missing = db.prepare(
    `SELECT candidates.session_id AS sessionId
     FROM sessions AS candidates
     LEFT JOIN session_transcript_fingerprints AS fingerprints
       ON fingerprints.session_id = candidates.session_id
     WHERE candidates.deleted_at IS NULL
       AND candidates.session_id <> ?
       AND (candidates.created_at < ? OR (candidates.created_at = ? AND candidates.session_id < ?))
       AND fingerprints.session_id IS NULL`
  ).all(sessionId, current.createdAt, current.createdAt, sessionId) as Array<{ sessionId: string }>;
  for (const candidate of missing) {
    persistCanonicalEvidenceFingerprint(db, candidate.sessionId, canonicalEvidenceFingerprint(db, candidate.sessionId));
  }
  const match = db.prepare(
    `SELECT fingerprints.session_id AS sessionId
     FROM session_transcript_fingerprints AS fingerprints
     JOIN sessions AS candidates ON candidates.session_id = fingerprints.session_id
     WHERE fingerprints.fingerprint = ?
       AND candidates.deleted_at IS NULL
       AND candidates.session_id <> ?
       AND (candidates.created_at < ? OR (candidates.created_at = ? AND candidates.session_id < ?))
     ORDER BY candidates.created_at, candidates.session_id
     LIMIT 1`
  ).get(fingerprint, sessionId, current.createdAt, current.createdAt, sessionId);
  return Boolean(match);
}

function persistCanonicalEvidenceFingerprint(db: MastheadDatabase, sessionId: string, fingerprint: string): void {
  db.prepare(
    `INSERT INTO session_transcript_fingerprints(session_id, fingerprint, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET fingerprint = excluded.fingerprint, updated_at = excluded.updated_at`
  ).run(sessionId, fingerprint, new Date().toISOString());
}

function canonicalEvidenceFingerprint(db: MastheadDatabase, sessionId: string): string {
  const hash = createHash("sha256");
  for (const item of iterateSessionTranscriptItems(db, { order: "asc", sessionId })) {
    hash.update(
      `${JSON.stringify({
        additions: item.additions,
        argumentsRedacted: item.argumentsRedacted,
        deletions: item.deletions,
        details: item.details,
        exitCode: item.exitCode,
        kind: item.kind,
        label: item.label,
        lowValue: item.lowValue,
        narrativeText: item.narrativeText,
        observedAt: item.observedAt,
        role: item.role,
        staged: item.staged,
        status: item.status,
        text: item.text,
        toolName: item.toolName
      })}\n`
    );
  }
  return hash.digest("hex");
}
