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

/**
 * Terminal incomplete shells (frozen evidence, no assistant / structured tools /
 * file effects) leave quality review immediately once frozen — do not wait for
 * the 7-day stale path (decision D4).
 */
export const TERMINAL_INCOMPLETE_AGE_MS = 0;

/**
 * When import health is not complete and the session is not ended, treat the
 * incomplete shell as frozen after this much session inactivity so live work
 * is not suppressed mid-flight.
 */
export const TERMINAL_INCOMPLETE_INACTIVITY_MS = 60 * 60 * 1000;

export const QUALITY_REVIEW_AGING_DEFAULT_LIMIT = 100;
export const QUALITY_REVIEW_AGING_MAX_LIMIT = 250;
export const STALE_INSUFFICIENT_EVIDENCE_REASON = "stale_insufficient_evidence";
/** Not Added reason for frozen terminal incomplete shells (D4). */
export const TERMINAL_INCOMPLETE_REASON = "terminal_incomplete";
export const QUALITY_REVIEW_AGING_ACTOR_ID = "quality_review_aging";

export type AgeStaleQualityReviewsResult = {
  aged: number;
  agedSessionIds: string[];
  eligible: number;
  limit: number;
  maxAgeMs: number;
  dryRun: boolean;
  cutoffAt: string;
  /** Sessions disposed via the terminal-incomplete (D4) path. */
  terminalIncompleteAged: number;
  terminalIncompleteEligible: number;
  /** Sessions disposed via the classic 7-day stale path. */
  staleAged: number;
  staleEligible: number;
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

/** Shared package-path automatic quality-review hold predicates. */
const REVIEW_HOLD_PREDICATE = `
  sessions.deleted_at IS NULL
  AND workbench_session_state.publication_status = 'publish_path'
  AND workbench_session_state.next_action = 'review_quality'
  AND workbench_session_state.quality_status = 'unchecked'
  AND workbench_session_state.suppression_category = 'insufficient_evidence'
  AND workbench_session_state.quality_decision_source = 'automatic'
`;

/**
 * Incomplete evidence shape: no assistant, no structured tools, no file effects.
 * Also excludes residual tool-role message shells (mis-captured adapters) so they
 * stay in review for operator/adapter recovery rather than silent Not Added.
 */
const TERMINAL_INCOMPLETE_SHAPE_SQL = `
  NOT EXISTS (
    SELECT 1 FROM messages m
    WHERE m.session_id = workbench_session_state.session_id
      AND m.role = 'assistant'
  )
  AND NOT EXISTS (
    SELECT 1 FROM messages m
    WHERE m.session_id = workbench_session_state.session_id
      AND m.role = 'tool'
  )
  AND NOT EXISTS (
    SELECT 1 FROM tool_calls tc
    WHERE tc.session_id = workbench_session_state.session_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM tool_results tr
    WHERE tr.session_id = workbench_session_state.session_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM file_effects fe
    WHERE fe.session_id = workbench_session_state.session_id
  )
`;

/**
 * Bounded drain: move eligible review_quality / insufficient_evidence rows to
 * Not Added with automatic decision source so a later evidence-revision change
 * can reopen (existing path).
 *
 * Two paths (same actor / startup hook):
 * 1. **Terminal incomplete (D4)** — frozen incomplete shells (import complete,
 *    session ended, or long inactivity; no assistant/tools/files) →
 *    `terminal_incomplete` with zero/short age.
 * 2. **Classic stale** — any remaining review hold older than maxAgeMs (default
 *    7 days) → `stale_insufficient_evidence`.
 *
 * Does not touch user decisions, quality-passed, published, or already Not Added rows.
 * Deliberate trigger only (startup hook / CLI) — not per request.
 * Never auto-passes incomplete sessions into authoring (D6).
 */
export function ageStaleQualityReviews(
  db: MastheadDatabase,
  options: {
    actor?: WorkbenchActor;
    dryRun?: boolean;
    limit?: number;
    maxAgeMs?: number;
    /** Override terminal-incomplete max age (default TERMINAL_INCOMPLETE_AGE_MS). */
    terminalIncompleteMaxAgeMs?: number;
    /** Override inactivity freeze window for non-ended / non-import-complete shells. */
    terminalIncompleteInactivityMs?: number;
    now?: Date | string;
  } = {}
): AgeStaleQualityReviewsResult {
  const dryRun = options.dryRun === true;
  const maxAgeMs = normalizeMaxAgeMs(options.maxAgeMs);
  const terminalIncompleteMaxAgeMs = normalizeNonNegativeMs(
    options.terminalIncompleteMaxAgeMs,
    TERMINAL_INCOMPLETE_AGE_MS
  );
  const terminalIncompleteInactivityMs = normalizeNonNegativeMs(
    options.terminalIncompleteInactivityMs,
    TERMINAL_INCOMPLETE_INACTIVITY_MS
  );
  const limit = normalizeLimit(options.limit);
  const nowMs = resolveNowMs(options.now);
  const cutoffAt = new Date(nowMs - maxAgeMs).toISOString();
  const terminalCutoffAt = new Date(nowMs - terminalIncompleteMaxAgeMs).toISOString();
  const inactivityCutoffAt = new Date(nowMs - terminalIncompleteInactivityMs).toISOString();
  const actor = options.actor ?? { kind: "system" as const, id: QUALITY_REVIEW_AGING_ACTOR_ID };

  const terminalEligible = listEligibleTerminalIncompleteReviews(
    db,
    terminalCutoffAt,
    inactivityCutoffAt,
    limit
  );
  const agedSessionIds: string[] = [];
  let terminalIncompleteAged = 0;

  if (!dryRun) {
    for (const row of terminalEligible) {
      markWorkbenchQuality(db, {
        actor,
        evidenceRevision: row.qualityEvidenceRevision ?? undefined,
        qualityDecisionSource: "automatic",
        reason: TERMINAL_INCOMPLETE_REASON,
        sessionId: row.sessionId,
        status: "failed",
        suppressionCategory: "insufficient_evidence"
      });
      agedSessionIds.push(row.sessionId);
      terminalIncompleteAged += 1;
    }
  }

  const remainingLimit = Math.max(0, limit - terminalEligible.length);
  const staleEligible =
    remainingLimit > 0
      ? listEligibleStaleQualityReviews(db, cutoffAt, remainingLimit, agedSessionIds)
      : [];
  let staleAged = 0;

  if (!dryRun) {
    for (const row of staleEligible) {
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
      staleAged += 1;
    }
  }

  const eligible = terminalEligible.length + staleEligible.length;

  return {
    aged: dryRun ? 0 : agedSessionIds.length,
    agedSessionIds: dryRun ? [] : agedSessionIds,
    cutoffAt,
    dryRun,
    eligible,
    limit,
    maxAgeMs,
    staleAged: dryRun ? 0 : staleAged,
    staleEligible: staleEligible.length,
    terminalIncompleteAged: dryRun ? 0 : terminalIncompleteAged,
    terminalIncompleteEligible: terminalEligible.length
  };
}

function listEligibleTerminalIncompleteReviews(
  db: MastheadDatabase,
  reviewCutoffAt: string,
  inactivityCutoffAt: string,
  limit: number
): EligibleRow[] {
  if (limit <= 0) return [];
  return db
    .prepare(
      `SELECT workbench_session_state.session_id AS sessionId,
              workbench_session_state.quality_evidence_revision AS qualityEvidenceRevision,
              ${REVIEW_ANCHOR_SQL} AS reviewAnchoredAt
       FROM workbench_session_state
       JOIN sessions ON sessions.session_id = workbench_session_state.session_id
       WHERE ${REVIEW_HOLD_PREDICATE}
         AND ${TERMINAL_INCOMPLETE_SHAPE_SQL}
         AND ${REVIEW_ANCHOR_SQL} <= ?
         AND (
           sessions.ended_at IS NOT NULL
           OR sessions.lifecycle = 'ended'
           OR EXISTS (
             SELECT 1
             FROM session_import_health sih
             WHERE sih.session_id = workbench_session_state.session_id
               AND sih.status = 'complete'
           )
           OR COALESCE(sessions.last_activity_at, workbench_session_state.updated_at) <= ?
         )
         -- Cheap live-activity guard: never auto-dispose clearly open live sessions.
         AND NOT (
           sessions.lifecycle IN ('active', 'running')
           AND sessions.ended_at IS NULL
           AND COALESCE(sessions.last_activity_at, workbench_session_state.updated_at) > ?
         )
       ORDER BY ${REVIEW_ANCHOR_SQL} ASC, workbench_session_state.session_id ASC
       LIMIT ?`
    )
    .all(reviewCutoffAt, inactivityCutoffAt, inactivityCutoffAt, limit) as EligibleRow[];
}

function listEligibleStaleQualityReviews(
  db: MastheadDatabase,
  cutoffAt: string,
  limit: number,
  excludeSessionIds: string[]
): EligibleRow[] {
  if (limit <= 0) return [];
  const excludeClause =
    excludeSessionIds.length > 0
      ? `AND workbench_session_state.session_id NOT IN (${excludeSessionIds.map(() => "?").join(",")})`
      : "";
  return db
    .prepare(
      `SELECT workbench_session_state.session_id AS sessionId,
              workbench_session_state.quality_evidence_revision AS qualityEvidenceRevision,
              ${REVIEW_ANCHOR_SQL} AS reviewAnchoredAt
       FROM workbench_session_state
       JOIN sessions ON sessions.session_id = workbench_session_state.session_id
       WHERE ${REVIEW_HOLD_PREDICATE}
         AND ${REVIEW_ANCHOR_SQL} <= ?
         ${excludeClause}
       ORDER BY ${REVIEW_ANCHOR_SQL} ASC, workbench_session_state.session_id ASC
       LIMIT ?`
    )
    .all(cutoffAt, ...excludeSessionIds, limit) as EligibleRow[];
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

function normalizeNonNegativeMs(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.trunc(value);
}

function resolveNowMs(now: Date | string | undefined): number {
  if (now === undefined) return Date.now();
  if (now instanceof Date) return now.getTime();
  const parsed = Date.parse(now);
  return Number.isFinite(parsed) ? parsed : Date.now();
}
