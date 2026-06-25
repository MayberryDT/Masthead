import { stableRecordId } from "../identity.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type ImportJobKind = "metadata" | "transcript" | "enrichment";
export type ImportJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type ImportJobDto = {
  importJobId: string;
  sourceId: string;
  importKind: ImportJobKind;
  status: ImportJobStatus;
  discoveredCount: number;
  importedCount: number;
  queuedCount: number;
  failureCount: number;
  updatedAt: string;
  failureMessage?: string;
};

type ImportJobRow = {
  import_job_id: string;
  source_id: string;
  import_kind: ImportJobKind;
  status: ImportJobStatus;
  discovered_count: number;
  imported_count: number;
  queued_count: number;
  failure_count: number;
  updated_at: string;
  failure_message: string | null;
};

export function createImportJob(
  db: MastheadDatabase,
  input: {
    sourceId: string;
    importKind: ImportJobKind;
    updatedAt: string;
  }
): ImportJobDto {
  const importJobId = stableRecordId("import_job", [input.sourceId, input.importKind, input.updatedAt]);
  db.prepare(
    `INSERT INTO import_jobs (
      import_job_id,
      source_id,
      import_kind,
      status,
      updated_at
    ) VALUES (?, ?, ?, ?, ?)`
  ).run(importJobId, input.sourceId, input.importKind, "queued", input.updatedAt);
  return getImportJob(db, importJobId) as ImportJobDto;
}

export function updateImportJob(
  db: MastheadDatabase,
  importJobId: string,
  updates: Partial<Pick<ImportJobDto, "status" | "discoveredCount" | "importedCount" | "queuedCount" | "failureCount" | "failureMessage">> & {
    updatedAt: string;
  }
): ImportJobDto {
  const current = getImportJob(db, importJobId);
  if (!current) throw new Error(`Import job not found: ${importJobId}`);
  db.prepare(
    `UPDATE import_jobs
    SET status = ?,
      discovered_count = ?,
      imported_count = ?,
      queued_count = ?,
      failure_count = ?,
      updated_at = ?,
      failure_message = ?
    WHERE import_job_id = ?`
  ).run(
    updates.status ?? current.status,
    updates.discoveredCount ?? current.discoveredCount,
    updates.importedCount ?? current.importedCount,
    updates.queuedCount ?? current.queuedCount,
    updates.failureCount ?? current.failureCount,
    updates.updatedAt,
    updates.failureMessage ?? current.failureMessage ?? null,
    importJobId
  );
  return getImportJob(db, importJobId) as ImportJobDto;
}

export function getImportJob(db: MastheadDatabase, importJobId: string): ImportJobDto | undefined {
  const row = db.prepare("SELECT * FROM import_jobs WHERE import_job_id = ?").get(importJobId) as ImportJobRow | undefined;
  return row ? importJobFromRow(row) : undefined;
}

export function listImportJobs(db: MastheadDatabase): ImportJobDto[] {
  const rows = db.prepare("SELECT * FROM import_jobs ORDER BY updated_at DESC, import_job_id DESC").all() as ImportJobRow[];
  return rows.map(importJobFromRow);
}

function importJobFromRow(row: ImportJobRow): ImportJobDto {
  return {
    discoveredCount: row.discovered_count,
    failureCount: row.failure_count,
    ...(row.failure_message ? { failureMessage: row.failure_message } : {}),
    importedCount: row.imported_count,
    importJobId: row.import_job_id,
    importKind: row.import_kind,
    queuedCount: row.queued_count,
    sourceId: row.source_id,
    status: row.status,
    updatedAt: row.updated_at
  };
}
