import type {
  ImportFailureGroupDto,
  ImportFailureKind,
  ImportJobKind,
  ImportManifestSummaryDto,
  ImportScopeDto,
  ImportWorkUnitDto,
  ImportWorkUnitKind,
  ImportWorkUnitStatus
} from "../../shared/sourceImport.ts";
import type { RuntimeKind, SourceConfidence, SourceKind } from "../../adapters/types.ts";
import { stableRecordId } from "../identity.ts";
import type { MastheadDatabase } from "./sqlite.ts";

type SqlValue = string | number | bigint | Buffer | null;

export type CreateImportManifestInput = {
  importJobId: string;
  sourceId?: string;
  runtime: RuntimeKind;
  importKind: ImportJobKind;
  scope: ImportScopeDto;
  generatedAt: string;
  totalUnits: number;
  includedUnits: number;
  excludedUnits: number;
  totalBytes: number;
  estimatedRecords?: number;
};

export type CreateImportWorkUnitInput = {
  manifestId: string;
  importJobId: string;
  sourceId: string;
  runtime: RuntimeKind;
  sourceKind: SourceKind;
  confidence: SourceConfidence;
  schemaVersion?: string;
  unitKind: ImportWorkUnitKind;
  sourcePath?: string;
  sourceSessionId?: string;
  cursorBefore?: unknown;
  status: ImportWorkUnitStatus;
  statusReason?: string;
  fileSizeBytes?: number;
  modifiedAt?: string;
  estimatedRecords?: number;
};

export type UpdateImportWorkUnitInput = {
  status?: ImportWorkUnitStatus;
  statusReason?: string | null;
  processedRecords?: number;
  importedRecords?: number;
  skippedRecords?: number;
  failedRecords?: number;
  heartbeatAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  failureGroupId?: string | null;
  cursorAfter?: unknown;
  summary?: unknown;
};

export type ListImportWorkUnitsOptions = {
  importJobId?: string;
  manifestId?: string;
  status?: ImportWorkUnitStatus;
  limit?: number;
  offset?: number;
};

export function createImportManifest(db: MastheadDatabase, input: CreateImportManifestInput): ImportManifestSummaryDto {
  const manifestId = stableRecordId("import_manifest", [
    input.importJobId,
    input.runtime,
    input.importKind,
    JSON.stringify(input.scope)
  ]);
  db.prepare(
    `INSERT INTO import_manifests (
      manifest_id,
      import_job_id,
      source_id,
      runtime_kind,
      import_kind,
      scope_json,
      generated_at,
      total_units,
      included_units,
      excluded_units,
      total_bytes,
      estimated_records
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(manifest_id) DO UPDATE SET
      source_id = excluded.source_id,
      scope_json = excluded.scope_json,
      generated_at = excluded.generated_at,
      total_units = excluded.total_units,
      included_units = excluded.included_units,
      excluded_units = excluded.excluded_units,
      total_bytes = excluded.total_bytes,
      estimated_records = excluded.estimated_records`
  ).run(
    manifestId,
    input.importJobId,
    input.sourceId ?? null,
    input.runtime,
    input.importKind,
    JSON.stringify(input.scope),
    input.generatedAt,
    input.totalUnits,
    input.includedUnits,
    input.excludedUnits,
    input.totalBytes,
    input.estimatedRecords ?? null
  );
  const manifest = getImportManifestSummary(db, manifestId);
  if (!manifest) throw new Error(`Import manifest not found after create: ${manifestId}`);
  return manifest;
}

export function getImportManifestSummary(db: MastheadDatabase, manifestId: string): ImportManifestSummaryDto | undefined {
  const row = db.prepare("SELECT * FROM import_manifests WHERE manifest_id = ?").get(manifestId) as Record<string, unknown> | undefined;
  return row ? manifestFromRow(row) : undefined;
}

export function createImportWorkUnit(db: MastheadDatabase, input: CreateImportWorkUnitInput): ImportWorkUnitDto {
  const workUnitId = stableRecordId("import_work_unit", [
    input.manifestId,
    input.unitKind,
    input.sourcePath,
    input.sourceSessionId
  ]);
  db.prepare(
    `INSERT INTO import_work_units (
      work_unit_id,
      manifest_id,
      import_job_id,
      source_id,
      runtime_kind,
      source_kind,
      confidence,
      schema_version,
      unit_kind,
      source_path,
      source_session_id,
      cursor_before_json,
      status,
      status_reason,
      file_size_bytes,
      modified_at,
      estimated_records
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(work_unit_id) DO UPDATE SET
      source_kind = excluded.source_kind,
      confidence = excluded.confidence,
      schema_version = excluded.schema_version,
      status = excluded.status,
      status_reason = excluded.status_reason,
      file_size_bytes = excluded.file_size_bytes,
      modified_at = excluded.modified_at,
      estimated_records = excluded.estimated_records`
  ).run(
    workUnitId,
    input.manifestId,
    input.importJobId,
    input.sourceId,
    input.runtime,
    input.sourceKind,
    input.confidence,
    input.schemaVersion ?? null,
    input.unitKind,
    input.sourcePath ?? null,
    input.sourceSessionId ?? null,
    input.cursorBefore === undefined ? null : JSON.stringify(input.cursorBefore),
    input.status,
    input.statusReason ?? null,
    input.fileSizeBytes ?? null,
    input.modifiedAt ?? null,
    input.estimatedRecords ?? null
  );
  const unit = getImportWorkUnit(db, workUnitId);
  if (!unit) throw new Error(`Import work unit not found after create: ${workUnitId}`);
  return unit;
}

export function getImportWorkUnit(db: MastheadDatabase, workUnitId: string): ImportWorkUnitDto | undefined {
  const row = db.prepare("SELECT * FROM import_work_units WHERE work_unit_id = ?").get(workUnitId) as Record<string, unknown> | undefined;
  return row ? workUnitFromRow(row) : undefined;
}

export function updateImportWorkUnit(db: MastheadDatabase, workUnitId: string, input: UpdateImportWorkUnitInput): ImportWorkUnitDto {
  const current = db.prepare("SELECT * FROM import_work_units WHERE work_unit_id = ?").get(workUnitId) as Record<string, unknown> | undefined;
  if (!current) throw new Error(`Import work unit not found: ${workUnitId}`);
  db.prepare(
    `UPDATE import_work_units
    SET status = ?,
      status_reason = ?,
      processed_records = ?,
      imported_records = ?,
      skipped_records = ?,
      failed_records = ?,
      heartbeat_at = ?,
      started_at = ?,
      finished_at = ?,
      failure_group_id = ?,
      cursor_after_json = ?,
      summary_json = ?
    WHERE work_unit_id = ?`
  ).run(
    input.status ?? stringValue(current.status),
    input.statusReason === undefined ? nullableString(current.status_reason) : input.statusReason,
    input.processedRecords ?? numberValue(current.processed_records),
    input.importedRecords ?? numberValue(current.imported_records),
    input.skippedRecords ?? numberValue(current.skipped_records),
    input.failedRecords ?? numberValue(current.failed_records),
    input.heartbeatAt === undefined ? nullableString(current.heartbeat_at) : input.heartbeatAt,
    input.startedAt === undefined ? nullableString(current.started_at) : input.startedAt,
    input.finishedAt === undefined ? nullableString(current.finished_at) : input.finishedAt,
    input.failureGroupId === undefined ? nullableString(current.failure_group_id) : input.failureGroupId,
    input.cursorAfter === undefined ? nullableString(current.cursor_after_json) : JSON.stringify(input.cursorAfter),
    input.summary === undefined ? nullableString(current.summary_json) : JSON.stringify(input.summary),
    workUnitId
  );
  const updated = getImportWorkUnit(db, workUnitId);
  if (!updated) throw new Error(`Import work unit not found after update: ${workUnitId}`);
  return updated;
}

export function listImportWorkUnits(db: MastheadDatabase, options: ListImportWorkUnitsOptions = {}): ImportWorkUnitDto[] {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (options.importJobId) {
    where.push("import_job_id = ?");
    params.push(options.importJobId);
  }
  if (options.manifestId) {
    where.push("manifest_id = ?");
    params.push(options.manifestId);
  }
  if (options.status) {
    where.push("status = ?");
    params.push(options.status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = options.limit ?? 250;
  const offset = options.offset ?? 0;
  const rows = db
    .prepare(`SELECT * FROM import_work_units ${whereSql} ORDER BY started_at IS NULL, started_at, source_path, work_unit_id LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Record<string, unknown>[];
  return rows.map(workUnitFromRow);
}

export function listAllImportWorkUnits(
  db: MastheadDatabase,
  options: Omit<ListImportWorkUnitsOptions, "limit" | "offset"> = {}
): ImportWorkUnitDto[] {
  const pageSize = 10_000;
  const units: ImportWorkUnitDto[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = listImportWorkUnits(db, { ...options, limit: pageSize, offset });
    units.push(...page);
    if (page.length < pageSize) return units;
  }
}

export function recordImportFailureGroup(
  db: MastheadDatabase,
  input: {
    importJobId: string;
    manifestId?: string;
    runtime: RuntimeKind;
    failureKind: ImportFailureKind;
    code: string;
    message: string;
    retryable: boolean;
    observedAt: string;
    samplePath?: string;
  }
): ImportFailureGroupDto {
  const existing = db
    .prepare(
      `SELECT *
      FROM import_failure_groups
      WHERE import_job_id = ?
        AND failure_kind = ?
        AND code = ?
        AND message = ?`
    )
    .get(input.importJobId, input.failureKind, input.code, input.message) as Record<string, unknown> | undefined;
  if (existing) {
    const samples = uniqueJsonStrings(nullableString(existing.sample_paths_json), input.samplePath);
    db.prepare(
      `UPDATE import_failure_groups
      SET count = count + 1,
        last_seen_at = ?,
        sample_paths_json = ?
      WHERE failure_group_id = ?`
    ).run(input.observedAt, JSON.stringify(samples), stringValue(existing.failure_group_id));
    const updated = db
      .prepare("SELECT * FROM import_failure_groups WHERE failure_group_id = ?")
      .get(stringValue(existing.failure_group_id)) as Record<string, unknown>;
    return failureGroupFromRow(updated);
  }

  const failureGroupId = stableRecordId("import_failure_group", [
    input.importJobId,
    input.failureKind,
    input.code,
    input.message
  ]);
  db.prepare(
    `INSERT INTO import_failure_groups (
      failure_group_id,
      import_job_id,
      manifest_id,
      runtime_kind,
      failure_kind,
      code,
      message,
      retryable,
      count,
      first_seen_at,
      last_seen_at,
      sample_paths_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    failureGroupId,
    input.importJobId,
    input.manifestId ?? null,
    input.runtime,
    input.failureKind,
    input.code,
    input.message,
    input.retryable ? 1 : 0,
    1,
    input.observedAt,
    input.observedAt,
    JSON.stringify(input.samplePath ? [input.samplePath] : [])
  );
  const row = db.prepare("SELECT * FROM import_failure_groups WHERE failure_group_id = ?").get(failureGroupId) as Record<string, unknown>;
  return failureGroupFromRow(row);
}

export function listImportFailureGroups(db: MastheadDatabase, importJobId: string): ImportFailureGroupDto[] {
  const rows = db
    .prepare("SELECT * FROM import_failure_groups WHERE import_job_id = ? ORDER BY count DESC, last_seen_at DESC")
    .all(importJobId) as Record<string, unknown>[];
  return rows.map(failureGroupFromRow);
}

function manifestFromRow(row: Record<string, unknown>): ImportManifestSummaryDto {
  return {
    excludedUnits: numberValue(row.excluded_units),
    generatedAt: stringValue(row.generated_at),
    importJobId: stringValue(row.import_job_id),
    importKind: stringValue(row.import_kind) as ImportJobKind,
    includedUnits: numberValue(row.included_units),
    manifestId: stringValue(row.manifest_id),
    runtime: stringValue(row.runtime_kind) as RuntimeKind,
    scope: parseJson<ImportScopeDto>(stringValue(row.scope_json)),
    sourceId: nullableString(row.source_id) ?? undefined,
    totalBytes: numberValue(row.total_bytes),
    totalUnits: numberValue(row.total_units),
    ...(row.estimated_records === null ? {} : { estimatedRecords: numberValue(row.estimated_records) })
  };
}

function workUnitFromRow(row: Record<string, unknown>): ImportWorkUnitDto {
  return {
    failedRecords: numberValue(row.failed_records),
    fileSizeBytes: optionalNumber(row.file_size_bytes),
    finishedAt: nullableString(row.finished_at) ?? undefined,
    heartbeatAt: nullableString(row.heartbeat_at) ?? undefined,
    importedRecords: numberValue(row.imported_records),
    importJobId: stringValue(row.import_job_id),
    manifestId: stringValue(row.manifest_id),
    modifiedAt: nullableString(row.modified_at) ?? undefined,
    processedRecords: numberValue(row.processed_records),
    runtime: stringValue(row.runtime_kind) as RuntimeKind,
    sourceKind: stringValue(row.source_kind) as SourceKind,
    confidence: stringValue(row.confidence) as SourceConfidence,
    schemaVersion: nullableString(row.schema_version) ?? undefined,
    skippedRecords: numberValue(row.skipped_records),
    sourceId: stringValue(row.source_id),
    sourcePath: nullableString(row.source_path) ?? undefined,
    sourceSessionId: nullableString(row.source_session_id) ?? undefined,
    startedAt: nullableString(row.started_at) ?? undefined,
    status: stringValue(row.status) as ImportWorkUnitStatus,
    statusReason: nullableString(row.status_reason) ?? undefined,
    unitKind: stringValue(row.unit_kind) as ImportWorkUnitKind,
    workUnitId: stringValue(row.work_unit_id),
    estimatedRecords: optionalNumber(row.estimated_records),
    failureGroupId: nullableString(row.failure_group_id) ?? undefined
  };
}

function failureGroupFromRow(row: Record<string, unknown>): ImportFailureGroupDto {
  return {
    code: stringValue(row.code),
    count: numberValue(row.count),
    failureGroupId: stringValue(row.failure_group_id),
    failureKind: stringValue(row.failure_kind) as ImportFailureKind,
    firstSeenAt: stringValue(row.first_seen_at),
    importJobId: stringValue(row.import_job_id),
    lastSeenAt: stringValue(row.last_seen_at),
    manifestId: nullableString(row.manifest_id) ?? undefined,
    message: stringValue(row.message),
    retryable: numberValue(row.retryable) === 1,
    runtime: stringValue(row.runtime_kind) as RuntimeKind,
    samplePaths: parseJson<string[]>(stringValue(row.sample_paths_json))
  };
}

function uniqueJsonStrings(value: string | null | undefined, next?: string): string[] {
  const current = value ? parseJson<string[]>(value) : [];
  return next ? [...new Set([...current, next])] : current;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function optionalNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : numberValue(value);
}
