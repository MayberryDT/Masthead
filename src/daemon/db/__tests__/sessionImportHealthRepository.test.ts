import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../schema.ts";
import {
  readSessionImportHealth,
  recordSessionImportHealth,
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

    expect(readSessionImportHealth(db, "session:repair")).toEqual(record);
    expect(summarizeSessionImportHealth(db, "import-health-1")).toEqual({
      complete: 0,
      partial: 0,
      reasons: [{ count: 1, reason: "partial_parse" }],
      repairRequired: 1,
      total: 1
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
