import type {
  SessionImportHealthDiagnosticDto,
  SessionImportHealthStatus,
  SessionImportHealthSummaryDto
} from "../../shared/workbench.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type { SessionImportHealthStatus } from "../../shared/workbench.ts";

export type SessionImportHealthRecord = {
  workUnitId: string;
  importJobId: string;
  sessionId?: string;
  status: SessionImportHealthStatus;
  reason?: string;
  diagnostics: SessionImportHealthDiagnosticDto[];
  evidenceRevision: string;
  updatedAt: string;
};

export function recordSessionImportHealth(
  db: MastheadDatabase,
  input: {
    sessionId?: string;
    status: SessionImportHealthStatus;
    reason?: string;
    diagnostics?: SessionImportHealthDiagnosticDto[];
    importJobId: string;
    workUnitId: string;
    evidenceRevision: string;
    updatedAt: string;
  }
): SessionImportHealthRecord {
  db.prepare(
    `INSERT INTO session_import_health (
      work_unit_id, import_job_id, session_id, status, reason, diagnostics_json,
      evidence_revision, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(work_unit_id) DO UPDATE SET
      import_job_id = excluded.import_job_id,
      session_id = excluded.session_id,
      status = excluded.status,
      reason = excluded.reason,
      diagnostics_json = excluded.diagnostics_json,
      evidence_revision = excluded.evidence_revision,
      updated_at = excluded.updated_at`
  ).run(
    input.workUnitId,
    input.importJobId,
    input.sessionId ?? null,
    input.status,
    input.reason ?? null,
    JSON.stringify(input.diagnostics ?? []),
    input.evidenceRevision,
    input.updatedAt
  );
  const record = readImportWorkUnitHealth(db, input.workUnitId);
  if (!record) throw new Error(`Session import health not found after write: ${input.workUnitId}`);
  return record;
}

export function readImportWorkUnitHealth(
  db: MastheadDatabase,
  workUnitId: string
): SessionImportHealthRecord | undefined {
  return readHealthRow(db.prepare(`${HEALTH_SELECT} WHERE work_unit_id = ?`).get(workUnitId));
}

export function readSessionImportHealth(
  db: MastheadDatabase,
  sessionId: string
): SessionImportHealthRecord | undefined {
  return readHealthRow(
    db.prepare(`${HEALTH_SELECT} WHERE session_id = ? ORDER BY updated_at DESC, work_unit_id DESC LIMIT 1`).get(sessionId)
  );
}

export function summarizeSessionImportHealth(
  db: MastheadDatabase,
  importJobId: string
): SessionImportHealthSummaryDto {
  const records = (db.prepare(`${HEALTH_SELECT} WHERE import_job_id = ?`).all(importJobId) as unknown[])
    .map(readHealthRow)
    .filter((record): record is SessionImportHealthRecord => Boolean(record));
  const countFor = (status: SessionImportHealthStatus) => records.filter((record) => record.status === status).length;
  const reasonCounts = new Map<string, number>();
  const diagnosticCounts = new Map<string, SessionImportHealthDiagnosticDto & { count: number }>();
  for (const record of records) {
    if (record.reason) reasonCounts.set(record.reason, (reasonCounts.get(record.reason) ?? 0) + 1);
    for (const diagnostic of record.diagnostics) {
      const key = `${diagnostic.code}\0${diagnostic.message}\0${diagnostic.severity}`;
      diagnosticCounts.set(key, { ...diagnostic, count: (diagnosticCounts.get(key)?.count ?? 0) + 1 });
    }
  }
  return {
    complete: countFor("complete"),
    diagnostics: [...diagnosticCounts.values()]
      .toSorted((a, b) => b.count - a.count || a.code.localeCompare(b.code))
      .slice(0, 5),
    partial: countFor("partial"),
    reasons: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ count, reason }))
      .toSorted((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
      .slice(0, 5),
    repairRequired: countFor("repair_required"),
    total: records.length
  };
}

export function countRepairRequiredSessions(db: MastheadDatabase, importJobId: string): number {
  const row = db.prepare(
    `SELECT COUNT(DISTINCT session_id) AS count
    FROM session_import_health
    WHERE import_job_id = ?
      AND status = 'repair_required'
      AND session_id IS NOT NULL`
  ).get(importJobId) as { count: number } | undefined;
  return row?.count ?? 0;
}

const HEALTH_SELECT = `SELECT
  work_unit_id AS workUnitId,
  import_job_id AS importJobId,
  session_id AS sessionId,
  status,
  reason,
  diagnostics_json AS diagnosticsJson,
  evidence_revision AS evidenceRevision,
  updated_at AS updatedAt
FROM session_import_health`;

function readHealthRow(value: unknown): SessionImportHealthRecord | undefined {
  if (!value) return undefined;
  const row = value as Omit<SessionImportHealthRecord, "diagnostics"> & { diagnosticsJson: string; sessionId: string | null; reason: string | null };
  return {
    diagnostics: parseDiagnostics(row.diagnosticsJson),
    evidenceRevision: row.evidenceRevision,
    importJobId: row.importJobId,
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    status: row.status,
    updatedAt: row.updatedAt,
    workUnitId: row.workUnitId
  };
}

function parseDiagnostics(value: string): SessionImportHealthDiagnosticDto[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed as SessionImportHealthDiagnosticDto[] : [];
}
