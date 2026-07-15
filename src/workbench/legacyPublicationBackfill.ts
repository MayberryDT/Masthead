import { legacyDataMigrationCompleted, markLegacyDataMigrationCompleted } from "../daemon/legacyDataMigration.ts";
import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import {
  markWorkbenchNotAdded,
  markWorkbenchPublished,
  markWorkbenchQualityForReview,
  readWorkbenchSessionState
} from "../daemon/db/workbenchPipelineRepository.ts";
import { runCaptureQualityPrecheck, type CaptureQualityDisposition } from "./qualityPrecheck.ts";
import { authoringEvidenceRevision } from "./authoring/evidenceCatalog.ts";

export const WORKBENCH_PUBLICATION_BACKFILL_KEY = "workbench_publication_backfill_v1";

export type LegacyWorkbenchPublicationBackfillResult = {
  ok: true;
  totalCandidates: number;
  published: string[];
  notAdded: Array<{
    sessionId: string;
    reason: Extract<CaptureQualityDisposition, { disposition: "suppress" }>["reason"];
  }>;
  review: string[];
  skippedExistingState: number;
};

type SessionCandidateRow = {
  sessionId: string;
};

export function runLegacyWorkbenchPublicationBackfill(db: MastheadDatabase): LegacyWorkbenchPublicationBackfillResult {
  if (legacyDataMigrationCompleted(db, WORKBENCH_PUBLICATION_BACKFILL_KEY)) {
    return {
      ok: true,
      notAdded: [],
      published: [],
      review: [],
      skippedExistingState: 0,
      totalCandidates: 0
    };
  }

  const candidates = db
    .prepare(
      `SELECT session_id AS sessionId
      FROM sessions
      WHERE deleted_at IS NULL
      ORDER BY last_activity_at ASC, session_id ASC`
    )
    .all() as SessionCandidateRow[];
  const result: LegacyWorkbenchPublicationBackfillResult = {
    ok: true,
    notAdded: [],
    published: [],
    review: [],
    skippedExistingState: 0,
    totalCandidates: candidates.length
  };

  for (const candidate of candidates) {
    if (readWorkbenchSessionState(db, candidate.sessionId)) {
      result.skippedExistingState += 1;
      continue;
    }

    const quality = runCaptureQualityPrecheck(db, candidate.sessionId);
    if (quality.disposition === "keep") {
      markWorkbenchPublished(db, {
        actor: { kind: "system", id: "legacy_backfill" },
        publishedVia: "legacy_backfill",
        sessionId: candidate.sessionId
      });
      result.published.push(candidate.sessionId);
    } else if (quality.disposition === "suppress") {
      markWorkbenchNotAdded(db, {
        actor: { kind: "system", id: "legacy_backfill" },
        reason: quality.reason,
        sessionId: candidate.sessionId
      });
      result.notAdded.push({ reason: quality.reason, sessionId: candidate.sessionId });
    } else {
      markWorkbenchQualityForReview(db, {
        actor: { kind: "system", id: "legacy_backfill" },
        evidenceRevision: authoringEvidenceRevision(db, [candidate.sessionId]),
        sessionId: candidate.sessionId
      });
      result.review.push(candidate.sessionId);
    }
  }
  markLegacyDataMigrationCompleted(db, WORKBENCH_PUBLICATION_BACKFILL_KEY, result);

  return result;
}
