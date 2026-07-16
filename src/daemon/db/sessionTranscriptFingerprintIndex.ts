import { createHash } from "node:crypto";
import { iterateSessionTranscriptItems } from "./sessionTranscriptRepository.ts";
import { withImmediateTransaction, type MastheadDatabase } from "./sqlite.ts";

type InitializationOptions = {
  batchSize?: number;
  updatedAt?: string;
};

export function initializeSessionTranscriptFingerprintIndex(
  db: MastheadDatabase,
  options: InitializationOptions = {}
): { batches: number; fingerprintsPopulated: number } {
  const batchSize = options.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("Fingerprint backfill batch size must be a positive integer.");
  const updatedAt = options.updatedAt ?? new Date().toISOString();
  let batches = 0;
  let fingerprintsPopulated = 0;
  let cursor: { createdAt: string; sessionId: string } | undefined;

  while (true) {
    const rows = db.prepare(
      `SELECT sessions.session_id AS sessionId, sessions.created_at AS createdAt
       FROM sessions
       LEFT JOIN session_transcript_fingerprints AS fingerprints
         ON fingerprints.session_id = sessions.session_id
       WHERE sessions.deleted_at IS NULL
         AND fingerprints.session_id IS NULL
         AND (? IS NULL OR sessions.created_at > ? OR (sessions.created_at = ? AND sessions.session_id > ?))
       ORDER BY sessions.created_at, sessions.session_id
       LIMIT ?`
    ).all(
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? "",
      cursor?.createdAt ?? "",
      cursor?.sessionId ?? "",
      batchSize
    ) as Array<{ createdAt: string; sessionId: string }>;
    if (rows.length === 0) break;

    withImmediateTransaction(db, () => {
      for (const row of rows) refreshSessionTranscriptFingerprint(db, row.sessionId, updatedAt);
    });
    batches += 1;
    fingerprintsPopulated += rows.length;
    cursor = rows.at(-1);
  }

  const missing = db.prepare(
    `SELECT COUNT(*) AS count
     FROM sessions
     LEFT JOIN session_transcript_fingerprints AS fingerprints
       ON fingerprints.session_id = sessions.session_id
     WHERE sessions.deleted_at IS NULL AND fingerprints.session_id IS NULL`
  ).get() as { count: number };
  if (missing.count > 0) {
    throw new Error(`Session transcript fingerprint index initialization incomplete: ${missing.count} sessions remain.`);
  }
  return { batches, fingerprintsPopulated };
}

export function refreshSessionTranscriptFingerprint(
  db: MastheadDatabase,
  sessionId: string,
  updatedAt = new Date().toISOString()
): string {
  const fingerprint = canonicalSessionTranscriptFingerprint(db, sessionId);
  db.prepare(
    `INSERT INTO session_transcript_fingerprints(session_id, fingerprint, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET fingerprint = excluded.fingerprint, updated_at = excluded.updated_at`
  ).run(sessionId, fingerprint, updatedAt);
  return fingerprint;
}

export function canonicalSessionTranscriptFingerprint(db: MastheadDatabase, sessionId: string): string {
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
