import { ALL_RUNTIME_KINDS, type RuntimeKind } from "../../adapters/types.ts";
import type {
  SessionImportHealthDiagnosticDto,
  SessionImportHealthStatus,
  SessionImportHealthSummaryDto
} from "../../shared/workbench.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type { SessionImportHealthStatus } from "../../shared/workbench.ts";

function requireRuntimeKind(value: string): RuntimeKind {
  const runtime = ALL_RUNTIME_KINDS.find((candidate) => candidate === value);
  if (!runtime) throw new TypeError(`Unsupported import repair runtime: ${value}`);
  return runtime;
}

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

export function sessionImportRequiresRepair(
  db: MastheadDatabase,
  importJobId: string,
  sessionId: string
): boolean {
  return Boolean(db.prepare(
    `SELECT 1 AS found FROM session_import_health
     WHERE import_job_id = ? AND session_id = ? AND status = 'repair_required'
     LIMIT 1`
  ).get(importJobId, sessionId));
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

export function summarizeCurrentSessionImportHealth(db: MastheadDatabase): {
  repairRequired: number;
  reasons: Array<{ reason: string; count: number }>;
  importJobIds: string[];
  repairImports: Array<{
    importJobId: string;
    sourceId: string;
    runtime: RuntimeKind;
    repairRequired: number;
    reasons: Array<{ reason: string; count: number }>;
  }>;
} {
  const rows = db.prepare(
    `SELECT health.import_job_id AS importJobId, jobs.source_id AS sourceId,
      sources.adapter AS runtime, health.reason
    FROM session_import_health health
    JOIN import_jobs jobs ON jobs.import_job_id = health.import_job_id
    JOIN ingest_sources sources ON sources.source_id = jobs.source_id
    WHERE health.status = 'repair_required'
      AND (
        health.session_id IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM session_import_health newer_health
          WHERE newer_health.session_id = health.session_id
            AND (
              newer_health.updated_at > health.updated_at
              OR (
                newer_health.updated_at = health.updated_at
                AND newer_health.work_unit_id > health.work_unit_id
              )
            )
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM import_repair_replacements replacements
        JOIN import_jobs replacement_jobs
          ON replacement_jobs.import_job_id = replacements.replacement_import_job_id
        WHERE replacements.original_import_job_id = health.import_job_id
          AND replacement_jobs.status = 'succeeded'
      )
    ORDER BY health.import_job_id, health.reason, health.work_unit_id`
  ).all() as Array<{ importJobId: string; sourceId: string; runtime: string; reason: string | null }>;
  const reasonCounts = new Map<string, number>();
  const repairImports = new Map<string, {
    importJobId: string;
    sourceId: string;
    runtime: RuntimeKind;
    repairRequired: number;
    reasonCounts: Map<string, number>;
  }>();
  for (const row of rows) {
    if (row.reason) reasonCounts.set(row.reason, (reasonCounts.get(row.reason) ?? 0) + 1);
    const summary = repairImports.get(row.importJobId) ?? {
      importJobId: row.importJobId,
      sourceId: row.sourceId,
      runtime: requireRuntimeKind(row.runtime),
      repairRequired: 0,
      reasonCounts: new Map<string, number>()
    };
    summary.repairRequired += 1;
    if (row.reason) summary.reasonCounts.set(row.reason, (summary.reasonCounts.get(row.reason) ?? 0) + 1);
    repairImports.set(row.importJobId, summary);
  }
  return {
    importJobIds: [...new Set(rows.map((row) => row.importJobId))],
    repairImports: [...repairImports.values()].map(({ reasonCounts: importReasonCounts, ...summary }) => ({
      ...summary,
      reasons: [...importReasonCounts.entries()]
        .map(([reason, count]) => ({ count, reason }))
        .toSorted((left, right) => right.count - left.count || left.reason.localeCompare(right.reason))
    })),
    reasons: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ count, reason }))
      .toSorted((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
    repairRequired: rows.length
  };
}

export function recordImportRepairReplacements(
  db: MastheadDatabase,
  replacements: Array<{ originalImportJobId: string; replacementImportJobId: string }>
): void {
  const statement = db.prepare(
    `INSERT INTO import_repair_replacements (
      original_import_job_id, replacement_import_job_id
    ) VALUES (?, ?)`
  );
  for (const replacement of replacements) {
    statement.run(replacement.originalImportJobId, replacement.replacementImportJobId);
  }
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
