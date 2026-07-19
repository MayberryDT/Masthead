import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../schema.ts";
import {
  countRepairRequiredSessions,
  readImportWorkUnitHealth,
  readSessionImportHealth,
  recordSessionImportHealth,
  summarizeCurrentSessionImportHealth,
  summarizeSessionImportHealth
} from "../sessionImportHealthRepository.ts";
import { openMastheadDatabase } from "../sqlite.ts";
import { seedSession } from "./sessionTestHelpers.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("session import health repository", () => {
  test("records repair health and summarizes representative reasons by import job", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-health-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:repair",
      title: "Repair import"
    });
    seedImportProvenance(db);

    const record = recordSessionImportHealth(db, {
      evidenceRevision: "sha256:repair",
      importJobId: "import-health-1",
      reason: "partial_parse",
      sessionId: "session:repair",
      status: "repair_required",
      updatedAt: "2026-07-01T00:00:05.000Z",
      workUnitId: "unit-health-1"
    });
    cloneHealthWorkUnit(db, "unit-health-2");
    const latestRecord = recordSessionImportHealth(db, {
      evidenceRevision: "sha256:repair-2",
      importJobId: "import-health-1",
      reason: "partial_parse",
      sessionId: "session:repair",
      status: "repair_required",
      updatedAt: "2026-07-01T00:00:06.000Z",
      workUnitId: "unit-health-2"
    });

    expect(readImportWorkUnitHealth(db, "unit-health-1")).toEqual(record);
    expect(readSessionImportHealth(db, "session:repair")).toEqual(latestRecord);
    expect(summarizeSessionImportHealth(db, "import-health-1")).toEqual({
      complete: 0,
      diagnostics: [],
      partial: 0,
      reasons: [{ count: 2, reason: "partial_parse" }],
      repairRequired: 2,
      total: 2
    });
    expect(countRepairRequiredSessions(db, "import-health-1")).toBe(1);
    expect(summarizeCurrentSessionImportHealth(db)).toMatchObject({
      importJobIds: ["import-health-1"],
      reasons: [{ count: 1, reason: "partial_parse" }],
      repairRequired: 1
    });

    seedFollowupImportProvenance(db);
    recordSessionImportHealth(db, {
      evidenceRevision: "sha256:complete",
      importJobId: "import-health-2",
      sessionId: "session:repair",
      status: "complete",
      updatedAt: "2026-07-01T00:00:07.000Z",
      workUnitId: "unit-health-3"
    });
    expect(summarizeCurrentSessionImportHealth(db)).toEqual({
      importJobIds: [],
      reasons: [],
      repairImports: [],
      repairRequired: 0
    });
    db.close();
  });

  test("records repair health for an empty import unit without inventing a session", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-health-empty-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedImportProvenance(db);

    const record = recordSessionImportHealth(db, {
      diagnostics: [{
        code: "schema_unrecognized",
        message: "No transcript records were recognized.",
        severity: "error"
      }],
      evidenceRevision: "sha256:empty",
      importJobId: "import-health-1",
      reason: "missing_identity",
      status: "repair_required",
      updatedAt: "2026-07-01T00:00:05.000Z",
      workUnitId: "unit-health-1"
    });
    cloneHealthWorkUnit(db, "unit-health-2");
    recordSessionImportHealth(db, {
      evidenceRevision: "sha256:empty-2",
      importJobId: "import-health-1",
      reason: "missing_identity",
      status: "repair_required",
      updatedAt: "2026-07-01T00:00:06.000Z",
      workUnitId: "unit-health-2"
    });

    expect(record.sessionId).toBeUndefined();
    expect(readImportWorkUnitHealth(db, "unit-health-1")).toEqual(record);
    expect(summarizeSessionImportHealth(db, "import-health-1")).toEqual({
      complete: 0,
      diagnostics: [{
        code: "schema_unrecognized",
        count: 1,
        message: "No transcript records were recognized.",
        severity: "error"
      }],
      partial: 0,
      reasons: [{ count: 2, reason: "missing_identity" }],
      repairRequired: 2,
      total: 2
    });
    expect(countRepairRequiredSessions(db, "import-health-1")).toBe(0);
    expect(summarizeCurrentSessionImportHealth(db)).toEqual({
      importJobIds: ["import-health-1"],
      repairImports: [{
        importJobId: "import-health-1",
        reasons: [{ count: 2, reason: "missing_identity" }],
        repairRequired: 2,
        runtime: "opencode",
        sourceId: "source:health"
      }],
      reasons: [{ count: 2, reason: "missing_identity" }],
      repairRequired: 2
    });
    db.close();
  });
});

function seedImportProvenance(db: Awaited<ReturnType<typeof openMastheadDatabase>>): void {
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run("source:health", "opencode", "jsonl", "authoritative", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO import_jobs (import_job_id, source_id, import_kind, status, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run("import-health-1", "source:health", "transcript", "running", "2026-07-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO import_manifests (
      manifest_id, import_job_id, source_id, runtime_kind, import_kind, scope_json,
      generated_at, total_units, included_units, capped_units, excluded_units, total_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("manifest-health-1", "import-health-1", "source:health", "opencode", "transcript", "{}", "2026-07-01T00:00:00.000Z", 1, 1, 0, 0, 1);
  db.prepare(
    `INSERT INTO import_work_units (
      work_unit_id, manifest_id, import_job_id, source_id, runtime_kind, source_kind,
      confidence, unit_kind, status, timestamp_basis
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("unit-health-1", "manifest-health-1", "import-health-1", "source:health", "opencode", "jsonl", "authoritative", "transcript_file", "running", "unknown");
}

function cloneHealthWorkUnit(db: Awaited<ReturnType<typeof openMastheadDatabase>>, workUnitId: string): void {
  db.prepare(
    `INSERT INTO import_work_units (
      work_unit_id, manifest_id, import_job_id, source_id, runtime_kind, source_kind,
      confidence, unit_kind, source_path, status, timestamp_basis
    ) SELECT ?, manifest_id, import_job_id, source_id, runtime_kind, source_kind,
      confidence, unit_kind, ?, status, timestamp_basis
    FROM import_work_units
    WHERE work_unit_id = 'unit-health-1'`
  ).run(workUnitId, `/tmp/${workUnitId}.jsonl`);
}

function seedFollowupImportProvenance(db: Awaited<ReturnType<typeof openMastheadDatabase>>): void {
  db.prepare(
    `INSERT INTO import_jobs (import_job_id, source_id, import_kind, status, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run("import-health-2", "source:health", "transcript", "succeeded", "2026-07-01T00:00:07.000Z");
  db.prepare(
    `INSERT INTO import_manifests (
      manifest_id, import_job_id, source_id, runtime_kind, import_kind, scope_json,
      generated_at, total_units, included_units, capped_units, excluded_units, total_bytes
    ) SELECT ?, ?, source_id, runtime_kind, import_kind, scope_json,
      ?, total_units, included_units, capped_units, excluded_units, total_bytes
    FROM import_manifests
    WHERE manifest_id = 'manifest-health-1'`
  ).run("manifest-health-2", "import-health-2", "2026-07-01T00:00:07.000Z");
  db.prepare(
    `INSERT INTO import_work_units (
      work_unit_id, manifest_id, import_job_id, source_id, runtime_kind, source_kind,
      confidence, unit_kind, source_path, status, timestamp_basis
    ) SELECT ?, ?, ?, source_id, runtime_kind, source_kind,
      confidence, unit_kind, ?, 'succeeded', timestamp_basis
    FROM import_work_units
    WHERE work_unit_id = 'unit-health-1'`
  ).run("unit-health-3", "manifest-health-2", "import-health-2", "/tmp/unit-health-3.jsonl");
}
