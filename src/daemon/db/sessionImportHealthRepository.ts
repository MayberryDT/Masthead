import type {
  SessionImportHealthStatus,
  SessionImportHealthSummaryDto
} from "../../shared/workbench.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type { SessionImportHealthStatus } from "../../shared/workbench.ts";

export type SessionImportHealthRecord = {
  sessionId: string;
  status: SessionImportHealthStatus;
  reason?: string;
  importJobId?: string;
  workUnitId?: string;
  evidenceRevision: string;
  updatedAt: string;
};

export function recordSessionImportHealth(
  db: MastheadDatabase,
  input: {
    sessionId: string;
    status: SessionImportHealthStatus;
    reason?: string;
    importJobId: string;
    workUnitId: string;
    evidenceRevision: string;
    updatedAt: string;
  }
): SessionImportHealthRecord {
  db.prepare(
    `INSERT INTO session_import_health (
      session_id, status, reason, import_job_id, work_unit_id, evidence_revision, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      import_job_id = excluded.import_job_id,
      work_unit_id = excluded.work_unit_id,
      evidence_revision = excluded.evidence_revision,
      updated_at = excluded.updated_at`
  ).run(
    input.sessionId,
    input.status,
    input.reason ?? null,
    input.importJobId,
    input.workUnitId,
    input.evidenceRevision,
    input.updatedAt
  );
  const record = readSessionImportHealth(db, input.sessionId);
  if (!record) throw new Error(`Session import health not found after write: ${input.sessionId}`);
  return record;
}

export function readSessionImportHealth(
  db: MastheadDatabase,
  sessionId: string
): SessionImportHealthRecord | undefined {
  const row = db.prepare(
    `SELECT session_id AS sessionId, status, reason,
            import_job_id AS importJobId, work_unit_id AS workUnitId,
            evidence_revision AS evidenceRevision, updated_at AS updatedAt
     FROM session_import_health
     WHERE session_id = ?`
  ).get(sessionId) as SessionImportHealthRecord | undefined;
  return row ? optionalFields(row) : undefined;
}

export function summarizeSessionImportHealth(
  db: MastheadDatabase,
  importJobId: string
): SessionImportHealthSummaryDto {
  const counts = db.prepare(
    `SELECT status, COUNT(*) AS count
     FROM session_import_health
     WHERE import_job_id = ?
     GROUP BY status`
  ).all(importJobId) as Array<{ status: SessionImportHealthStatus; count: number }>;
  const reasons = db.prepare(
    `SELECT reason, COUNT(*) AS count
     FROM session_import_health
     WHERE import_job_id = ? AND reason IS NOT NULL
     GROUP BY reason
     ORDER BY count DESC, reason ASC
     LIMIT 5`
  ).all(importJobId) as Array<{ reason: string; count: number }>;
  const countFor = (status: SessionImportHealthStatus) => counts.find((row) => row.status === status)?.count ?? 0;
  return {
    complete: countFor("complete"),
    partial: countFor("partial"),
    reasons,
    repairRequired: countFor("repair_required"),
    total: counts.reduce((total, row) => total + row.count, 0)
  };
}

function optionalFields(record: SessionImportHealthRecord): SessionImportHealthRecord {
  return {
    evidenceRevision: record.evidenceRevision,
    ...(record.importJobId ? { importJobId: record.importJobId } : {}),
    ...(record.reason ? { reason: record.reason } : {}),
    sessionId: record.sessionId,
    status: record.status,
    updatedAt: record.updatedAt,
    ...(record.workUnitId ? { workUnitId: record.workUnitId } : {})
  };
}
