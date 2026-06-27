import { stableRecordId } from "../identity.ts";
import type { RuntimeKind } from "../../adapters/types.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type ImportJobKind = "metadata" | "transcript" | "enrichment";
export type ImportJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "cancelling";
export type ImportJobListStatus = ImportJobStatus | "active";

export type ImportJobDto = {
  importJobId: string;
  sourceId: string;
  importKind: ImportJobKind;
  status: ImportJobStatus;
  discoveredCount: number;
  processedCount: number;
  importedCount: number;
  queuedCount: number;
  failureCount: number;
  updatedAt: string;
  currentPath?: string;
  failureMessage?: string;
  progressCurrent: number;
  progressTotal?: number;
  progressPercent?: number;
};

type ImportJobRow = {
  import_job_id: string;
  source_id: string;
  import_kind: ImportJobKind;
  status: ImportJobStatus;
  discovered_count: number;
  processed_count: number;
  imported_count: number;
  queued_count: number;
  failure_count: number;
  updated_at: string;
  current_path: string | null;
  failure_message: string | null;
};

export type ListImportJobsOptions = {
  adapterId?: RuntimeKind;
  limit?: number;
  offset?: number;
  sourceId?: string;
  status?: ImportJobListStatus;
};

export type ImportJobPage = {
  jobs: ImportJobDto[];
  limit: number;
  offset: number;
  total: number;
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
  updates: {
    status?: ImportJobStatus;
    discoveredCount?: number;
    processedCount?: number;
    importedCount?: number;
    queuedCount?: number;
    failureCount?: number;
    currentPath?: string | null;
    failureMessage?: string | null;
    updatedAt: string;
  }
): ImportJobDto {
  const current = getImportJob(db, importJobId);
  if (!current) throw new Error(`Import job not found: ${importJobId}`);
  db.prepare(
    `UPDATE import_jobs
    SET status = ?,
      discovered_count = ?,
      processed_count = ?,
      imported_count = ?,
      queued_count = ?,
      failure_count = ?,
      updated_at = ?,
      current_path = ?,
      failure_message = ?
    WHERE import_job_id = ?`
  ).run(
    updates.status ?? current.status,
    updates.discoveredCount ?? current.discoveredCount,
    updates.processedCount ?? current.processedCount,
    updates.importedCount ?? current.importedCount,
    updates.queuedCount ?? current.queuedCount,
    updates.failureCount ?? current.failureCount,
    updates.updatedAt,
    updates.currentPath === undefined ? (current.currentPath ?? null) : updates.currentPath,
    updates.failureMessage === undefined ? (current.failureMessage ?? null) : updates.failureMessage,
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

export function listImportJobPage(db: MastheadDatabase, options: ListImportJobsOptions = {}): ImportJobPage {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const { joins, params, where } = importJobFilters(options);
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM import_jobs ${joins} ${whereSql}`).get(...params) as
    | { total: number }
    | undefined;
  const rows = db
    .prepare(`SELECT import_jobs.* FROM import_jobs ${joins} ${whereSql} ORDER BY updated_at DESC, import_job_id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as ImportJobRow[];
  return {
    jobs: rows.map(importJobFromRow),
    limit,
    offset,
    total: totalRow?.total ?? 0
  };
}

type SqlParam = string | number | bigint | Buffer | null;

function importJobFilters(options: ListImportJobsOptions): { joins: string; params: SqlParam[]; where: string[] } {
  const params: SqlParam[] = [];
  const where: string[] = [];
  const joins = options.adapterId ? "INNER JOIN ingest_sources ON ingest_sources.source_id = import_jobs.source_id" : "";
  if (options.adapterId) {
    where.push("ingest_sources.adapter = ?");
    params.push(options.adapterId);
  }
  if (options.sourceId) {
    where.push("import_jobs.source_id = ?");
    params.push(options.sourceId);
  }
  if (options.status === "active") {
    where.push("import_jobs.status IN ('queued', 'running', 'cancelling')");
  } else if (options.status) {
    where.push("import_jobs.status = ?");
    params.push(options.status);
  }
  return { joins, params, where };
}

function importJobFromRow(row: ImportJobRow): ImportJobDto {
  const progressTotal = row.discovered_count > 0 ? row.discovered_count : undefined;
  const progressPercent = progressTotal
    ? Math.min(100, Math.max(0, Math.round((row.processed_count / progressTotal) * 100)))
    : undefined;
  return {
    currentPath: row.current_path ?? undefined,
    discoveredCount: row.discovered_count,
    failureCount: row.failure_count,
    ...(row.failure_message ? { failureMessage: row.failure_message } : {}),
    importedCount: row.imported_count,
    importJobId: row.import_job_id,
    importKind: row.import_kind,
    processedCount: row.processed_count,
    progressCurrent: row.processed_count,
    progressPercent,
    progressTotal,
    queuedCount: row.queued_count,
    sourceId: row.source_id,
    status: row.status,
    updatedAt: row.updated_at
  };
}
