import { stableRecordId } from "../identity.ts";
import type { RuntimeKind } from "../../adapters/types.ts";
import type { ImportCompletionReportDto, ImportJobKind, ImportJobStatus, ImportScopeDto, ImportStage } from "../../shared/sourceImport.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export type { ImportJobKind, ImportJobStatus };
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
  finishedAt?: string;
  progressCurrent: number;
  progressTotal?: number;
  progressPercent?: number;
  startedAt?: string;
  stage?: ImportStage;
  heartbeatAt?: string;
  totalWorkUnits: number;
  completedWorkUnits: number;
  failedWorkUnits: number;
  skippedWorkUnits: number;
  scope?: ImportScopeDto;
  summary?: unknown;
  completionReport?: ImportCompletionReportDto;
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
  finished_at: string | null;
  started_at: string | null;
  stage: ImportStage | null;
  heartbeat_at: string | null;
  total_work_units: number;
  completed_work_units: number;
  failed_work_units: number;
  skipped_work_units: number;
  scope_json: string | null;
  summary_json: string | null;
  completion_report_json: string | null;
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
    finishedAt?: string | null;
    startedAt?: string | null;
    stage?: ImportStage | null;
    heartbeatAt?: string | null;
    totalWorkUnits?: number;
    completedWorkUnits?: number;
    failedWorkUnits?: number;
    skippedWorkUnits?: number;
    scope?: ImportScopeDto | null;
    summary?: unknown;
    completionReport?: ImportCompletionReportDto | null;
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
      failure_message = ?,
      started_at = ?,
      finished_at = ?,
      stage = ?,
      heartbeat_at = ?,
      total_work_units = ?,
      completed_work_units = ?,
      failed_work_units = ?,
      skipped_work_units = ?,
      scope_json = ?,
      summary_json = ?,
      completion_report_json = ?
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
    updates.startedAt === undefined ? (current.startedAt ?? null) : updates.startedAt,
    updates.finishedAt === undefined ? (current.finishedAt ?? null) : updates.finishedAt,
    updates.stage === undefined ? (current.stage ?? null) : updates.stage,
    updates.heartbeatAt === undefined ? (current.heartbeatAt ?? null) : updates.heartbeatAt,
    updates.totalWorkUnits ?? current.totalWorkUnits,
    updates.completedWorkUnits ?? current.completedWorkUnits,
    updates.failedWorkUnits ?? current.failedWorkUnits,
    updates.skippedWorkUnits ?? current.skippedWorkUnits,
    updates.scope === undefined ? (current.scope ? JSON.stringify(current.scope) : null) : updates.scope === null ? null : JSON.stringify(updates.scope),
    updates.summary === undefined ? (current.summary === undefined ? null : JSON.stringify(current.summary)) : JSON.stringify(updates.summary),
    updates.completionReport === undefined
      ? (current.completionReport ? JSON.stringify(current.completionReport) : null)
      : updates.completionReport === null
        ? null
        : JSON.stringify(updates.completionReport),
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
  const transcriptStillDiscovering = row.import_kind === "transcript" && ["queued", "running", "cancelling"].includes(row.status);
  const progressTotal = !transcriptStillDiscovering && row.discovered_count > 0 ? row.discovered_count : undefined;
  const progressPercent = progressTotal
    ? Math.min(100, Math.max(0, Math.round((row.processed_count / progressTotal) * 100)))
    : undefined;
  return {
    currentPath: row.current_path ?? undefined,
    discoveredCount: row.discovered_count,
    failureCount: row.failure_count,
    ...(row.failure_message ? { failureMessage: row.failure_message } : {}),
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    ...(row.heartbeat_at ? { heartbeatAt: row.heartbeat_at } : {}),
    importedCount: row.imported_count,
    importJobId: row.import_job_id,
    importKind: row.import_kind,
    processedCount: row.processed_count,
    progressCurrent: row.processed_count,
    progressPercent,
    progressTotal,
    queuedCount: row.queued_count,
    sourceId: row.source_id,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.stage ? { stage: row.stage } : {}),
    status: row.status,
    totalWorkUnits: row.total_work_units,
    completedWorkUnits: row.completed_work_units,
    failedWorkUnits: row.failed_work_units,
    skippedWorkUnits: row.skipped_work_units,
    ...(parseOptionalJson<ImportScopeDto>(row.scope_json) ? { scope: parseOptionalJson<ImportScopeDto>(row.scope_json) } : {}),
    ...(parseOptionalJson<unknown>(row.summary_json) ? { summary: parseOptionalJson<unknown>(row.summary_json) } : {}),
    ...(parseOptionalJson<ImportCompletionReportDto>(row.completion_report_json)
      ? { completionReport: parseOptionalJson<ImportCompletionReportDto>(row.completion_report_json) }
      : {}),
    updatedAt: row.updated_at
  };
}

function parseOptionalJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
