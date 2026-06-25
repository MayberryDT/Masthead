import type { ReviewDisposition } from "../../core/store.ts";
import type { MastheadDatabase } from "./sqlite.ts";

type ReviewDispositionRow = {
  disposition_id: string;
  subject_id: string;
  subject_type: ReviewDisposition["subjectType"];
  status: ReviewDisposition["status"];
  recorded_at: string;
  snoozed_until: string | null;
  reviewer: string | null;
  reason: string | null;
};

export function listReviewDispositions(db: MastheadDatabase): ReviewDisposition[] {
  const rows = db
    .prepare(
      `SELECT
        disposition_id,
        subject_id,
        subject_type,
        status,
        recorded_at,
        snoozed_until,
        reviewer,
        reason
      FROM review_dispositions
      ORDER BY recorded_at ASC, disposition_id ASC`
    )
    .all() as ReviewDispositionRow[];
  return rows.map(dispositionFromRow);
}

export function upsertReviewDisposition(db: MastheadDatabase, disposition: ReviewDisposition): void {
  db.prepare(
    `INSERT INTO review_dispositions (
      disposition_id,
      subject_id,
      subject_type,
      status,
      recorded_at,
      snoozed_until,
      reviewer,
      reason,
      source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(disposition_id) DO UPDATE SET
      subject_id = excluded.subject_id,
      subject_type = excluded.subject_type,
      status = excluded.status,
      recorded_at = excluded.recorded_at,
      snoozed_until = excluded.snoozed_until,
      reviewer = excluded.reviewer,
      reason = excluded.reason,
      source_ref_json = excluded.source_ref_json`
  ).run(
    disposition.dispositionId,
    disposition.subjectId,
    disposition.subjectType,
    disposition.status,
    disposition.recordedAt,
    disposition.snoozedUntil ?? null,
    disposition.reviewer ?? null,
    disposition.reason ?? null,
    JSON.stringify({ source: "masthead.local_review" })
  );
}

function dispositionFromRow(row: ReviewDispositionRow): ReviewDisposition {
  return {
    dispositionId: row.disposition_id,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    status: row.status,
    recordedAt: row.recorded_at,
    ...(row.snoozed_until ? { snoozedUntil: row.snoozed_until } : {}),
    ...(row.reviewer ? { reviewer: row.reviewer } : {}),
    ...(row.reason ? { reason: row.reason } : {})
  };
}
