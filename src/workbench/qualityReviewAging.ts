import type { MastheadDatabase } from "../daemon/db/sqlite.ts";
import {
  markWorkbenchQuality,
  type WorkbenchActor
} from "../daemon/db/workbenchPipelineRepository.ts";

/**
 * Sessions stuck in quality review with an unchanged quality_evidence_revision
 * for this long may be aged to Not Added (automatic decision source).
 *
 * Anchor: latest workbench_activity event_at for quality_review_required /
 * quality_reopened; falls back to workbench_session_state.updated_at.
 */
export const QUALITY_REVIEW_STALE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const QUALITY_REVIEW_AGING_DEFAULT_LIMIT = 100;
export const QUALITY_REVIEW_AGING_MAX_LIMIT = 250;
export const STALE_INSUFFICIENT_EVIDENCE_REASON = "stale_insufficient_evidence";
export const QUALITY_REVIEW_AGING_ACTOR_ID = "quality_review_aging";

export type AgeStaleQualityReviewsResult = {
  aged: number;
  agedSessionIds: string[];
  eligible: number;
  limit: number;
  maxAgeMs: number;
  dryRun: boolean;
  cutoffAt: string;
};

type EligibleRow = {
  sessionId: string;
  qualityEvidenceRevision: string | null;
  reviewAnchoredAt: string;
};

const REVIEW_ANCHOR_SQL = `COALESCE(
  (
    SELECT MAX(wa.event_at)
    FROM workbench_activity wa
    WHERE wa.session_id = workbench_session_state.session_id
      AND wa.event_type IN ('quality_review_required', 'quality_reopened')
  ),
  workbench_session_state.updated_at
)`;

/**
 * Bounded drain: move eligible review_quality / insufficient_evidence rows to
 * Not Added with reason stale_insufficient_evidence and automatic decision
 * source so a later evidence-revision change can reopen (existing path).
 *
 * Does not touch user decisions, quality-passed, published, or already Not Added rows.
 * Deliberate trigger only (startup hook / CLI) — not per request.
 */
export function ageStaleQualityReviews(
  db: MastheadDatabase,
  options: {
    actor?: WorkbenchActor;
    dryRun?: boolean;
    limit?: number;
    maxAgeMs?: number;
    now?: Date | string;
  } = {}
): AgeStaleQualityReviewsResult {
  const dryRun = options.dryRun === true;
  const maxAgeMs = normalizeMaxAgeMs(options.maxAgeMs);
  const limit = normalizeLimit(options.limit);
  const nowMs = resolveNowMs(options.now);
  const cutoffAt = new Date(nowMs - maxAgeMs).toISOString();
  const actor = options.actor ?? { kind: "system" as const, id: QUALITY_REVIEW_AGING_ACTOR_ID };

  const eligible = listEligibleStaleQualityReviews(db, cutoffAt, limit);
  const agedSessionIds: string[] = [];

  if (!dryRun) {
    for (const row of eligible) {
      markWorkbenchQuality(db, {
        actor,
        evidenceRevision: row.qualityEvidenceRevision ?? undefined,
        qualityDecisionSource: "automatic",
        reason: STALE_INSUFFICIENT_EVIDENCE_REASON,
        sessionId: row.sessionId,
        status: "failed",
        suppressionCategory: "insufficient_evidence"
      });
      agedSessionIds.push(row.sessionId);
    }
  }

  return {
    aged: dryRun ? 0 : agedSessionIds.length,
    agedSessionIds: dryRun ? [] : agedSessionIds,
    cutoffAt,
    dryRun,
    eligible: eligible.length,
    limit,
    maxAgeMs
  };
}

function listEligibleStaleQualityReviews(
  db: MastheadDatabase,
  cutoffAt: string,
  limit: number
): EligibleRow[] {
  return db
    .prepare(
      `SELECT workbench_session_state.session_id AS sessionId,
              workbench_session_state.quality_evidence_revision AS qualityEvidenceRevision,
              ${REVIEW_ANCHOR_SQL} AS reviewAnchoredAt
       FROM workbench_session_state
       JOIN sessions ON sessions.session_id = workbench_session_state.session_id
       WHERE sessions.deleted_at IS NULL
         AND workbench_session_state.publication_status = 'publish_path'
         AND workbench_session_state.next_action = 'review_quality'
         AND workbench_session_state.quality_status = 'unchecked'
         AND workbench_session_state.suppression_category = 'insufficient_evidence'
         AND workbench_session_state.quality_decision_source = 'automatic'
         AND ${REVIEW_ANCHOR_SQL} <= ?
       ORDER BY ${REVIEW_ANCHOR_SQL} ASC, workbench_session_state.session_id ASC
       LIMIT ?`
    )
    .all(cutoffAt, limit) as EligibleRow[];
}

function normalizeLimit(limit: number | undefined): number {
  const raw = limit ?? QUALITY_REVIEW_AGING_DEFAULT_LIMIT;
  if (!Number.isFinite(raw)) return QUALITY_REVIEW_AGING_DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(raw), QUALITY_REVIEW_AGING_MAX_LIMIT));
}

function normalizeMaxAgeMs(maxAgeMs: number | undefined): number {
  const raw = maxAgeMs ?? QUALITY_REVIEW_STALE_AGE_MS;
  if (!Number.isFinite(raw) || raw < 0) return QUALITY_REVIEW_STALE_AGE_MS;
  return Math.trunc(raw);
}

function resolveNowMs(now: Date | string | undefined): number {
  if (now === undefined) return Date.now();
  if (now instanceof Date) return now.getTime();
  const parsed = Date.parse(now);
  return Number.isFinite(parsed) ? parsed : Date.now();
}
