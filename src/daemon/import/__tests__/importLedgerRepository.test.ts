import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import {
  createImportManifest,
  createImportWorkUnit,
  getImportManifestSummary,
  listImportFailureGroups,
  listImportWorkUnits,
  recordImportFailureGroup,
  updateImportWorkUnit
} from "../../db/importLedgerRepository.ts";

const tempDirs: string[] = [];

describe("import ledger repository", () => {
  let db: MastheadDatabase;

  beforeEach(async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-ledger-"));
    tempDirs.push(tempDir);
    db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSourceAndImportJob(db);
  });

  afterEach(async () => {
    db.close();
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  });

  test("persists a manifest and child work unit progress", () => {
    const manifest = createImportManifest(db, {
      cappedUnits: 7,
      excludedUnits: 0,
      generatedAt: "2026-07-01T00:01:00.000Z",
      importJobId: "import-1",
      importKind: "transcript",
      includedUnits: 1,
      runtime: "opencode",
      scope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
      sourceId: "opencode-sessions",
      totalBytes: 120,
      totalUnits: 1
    });

    createImportWorkUnit(db, {
      estimatedRecords: 4,
      fileSizeBytes: 120,
      importJobId: "import-1",
      manifestId: manifest.manifestId,
      modifiedAt: "2026-07-01T00:00:30.000Z",
      scopeReason: "inside_recent_range",
      semanticActivityAt: "2026-07-01T00:00:00.000Z",
      timestampBasis: "semantic",
      runtime: "opencode",
      confidence: "authoritative",
      sourceId: "opencode-sessions",
      sourceKind: "jsonl",
      sourcePath: "/tmp/.opencode/sessions/thread.jsonl",
      status: "queued",
      unitKind: "transcript_file"
    });

    const units = listImportWorkUnits(db, { importJobId: "import-1" });
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      processedRecords: 0,
      scopeReason: "inside_recent_range",
      semanticActivityAt: "2026-07-01T00:00:00.000Z",
      sourcePath: "/tmp/.opencode/sessions/thread.jsonl",
      status: "queued",
      timestampBasis: "semantic"
    });

    updateImportWorkUnit(db, units[0].workUnitId, {
      heartbeatAt: "2026-07-01T00:01:10.000Z",
      importedRecords: 3,
      processedRecords: 3,
      status: "running"
    });

    expect(listImportWorkUnits(db, { importJobId: "import-1" })[0]).toMatchObject({
      heartbeatAt: "2026-07-01T00:01:10.000Z",
      importedRecords: 3,
      processedRecords: 3,
      status: "running"
    });
    expect(getImportManifestSummary(db, manifest.manifestId)).toMatchObject({
      cappedUnits: 7,
      includedUnits: 1,
      totalUnits: 1
    });
  });

  test("groups import failures with sample paths", () => {
    const group = recordImportFailureGroup(db, {
      code: "malformed_json",
      failureKind: "malformed",
      importJobId: "import-1",
      message: "OpenCode transcript contained malformed JSON.",
      observedAt: "2026-07-01T00:02:00.000Z",
      retryable: false,
      runtime: "opencode",
      samplePath: "/tmp/.opencode/sessions/bad.jsonl"
    });

    const updated = recordImportFailureGroup(db, {
      code: "malformed_json",
      failureKind: "malformed",
      importJobId: "import-1",
      message: "OpenCode transcript contained malformed JSON.",
      observedAt: "2026-07-01T00:03:00.000Z",
      retryable: false,
      runtime: "opencode",
      samplePath: "/tmp/.opencode/sessions/also-bad.jsonl"
    });

    expect(updated.failureGroupId).toBe(group.failureGroupId);
    expect(updated.count).toBe(2);
    expect(updated.samplePaths).toContain("/tmp/.opencode/sessions/bad.jsonl");
    expect(updated.samplePaths).toContain("/tmp/.opencode/sessions/also-bad.jsonl");
    expect(listImportFailureGroups(db, "import-1")).toEqual([
      expect.objectContaining({
        code: "malformed_json",
        count: 2,
        failureKind: "malformed"
      })
    ]);
  });
});

function seedSourceAndImportJob(db: MastheadDatabase): void {
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("opencode-sessions", "opencode", "jsonl", "/tmp/.opencode/sessions", "authoritative", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO import_jobs (
      import_job_id, source_id, import_kind, status, updated_at
    ) VALUES (?, ?, ?, ?, ?)`
  ).run("import-1", "opencode-sessions", "transcript", "queued", "2026-07-01T00:00:00.000Z");
}
