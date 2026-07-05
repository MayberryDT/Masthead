import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { AdapterRecord, DiscoveredSource } from "../../../adapters/types.ts";
import {
  createImportManifest,
  createImportWorkUnit,
  listImportFailureGroups,
  listImportWorkUnits
} from "../../db/importLedgerRepository.ts";
import { migrateDatabase } from "../../db/schema.ts";
import { addSourceExclusion } from "../../db/sourceRepository.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { runImportWorkUnit } from "../importWorkUnitRunner.ts";

const tempDirs: string[] = [];

describe("import work unit runner", () => {
  let db: MastheadDatabase;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "masthead-work-unit-"));
    tempDirs.push(tempDir);
    db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSourceAndImportJob(db, join(tempDir, "thread.jsonl"));
  });

  afterEach(async () => {
    db.close();
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  });

  test("imports valid records and marks the unit succeeded", async () => {
    const sourcePath = join(tempDir, "thread.jsonl");
    const unitId = seedWorkUnit(db, sourcePath);
    const records: AdapterRecord[] = [
      {
        diagnostics: [],
        normalized: {
          confidence: "authoritative",
          kind: "session",
          sourceRef: { sourceKind: "jsonl", sourcePath },
          value: { observedAt: "2026-07-01T00:00:00.000Z", sessionId: "s1" }
        },
        observedAt: "2026-07-01T00:00:00.000Z",
        payload: { id: "s1" },
        payloadHash: "hash",
        source: sourceForPath(sourcePath),
        sourceRecordKey: `${sourcePath}:1`
      }
    ];

    await runImportWorkUnit({
      adapterBackfill: async function* () {
        yield* records;
      },
      db,
      hostId: "host:test",
      hostname: "test",
      now: () => "2026-07-01T00:00:05.000Z",
      runtimeKind: "codex",
      workUnitId: unitId
    });

    expect(listImportWorkUnits(db, { importJobId: "import-1" })[0]).toMatchObject({
      importedRecords: 1,
      processedRecords: 1,
      status: "succeeded"
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 1 });
  });

  test("skips records whose project metadata is excluded", async () => {
    const sourcePath = join(tempDir, "thread.jsonl");
    const unitId = seedWorkUnit(db, sourcePath);
    addSourceExclusion(db, {
      createdAt: "2026-07-01T00:00:00.000Z",
      exclusionKind: "project",
      pattern: "PrivateClient",
      reason: "Excluded project transcripts."
    });

    await runImportWorkUnit({
      adapterBackfill: async function* () {
        yield {
          diagnostics: [],
          normalized: {
            confidence: "authoritative",
            kind: "session",
            sourceRef: { sourceKind: "jsonl", sourcePath },
            value: { cwd: "/workspace/PrivateClient", observedAt: "2026-07-01T00:00:00.000Z", sessionId: "s1" }
          },
          observedAt: "2026-07-01T00:00:00.000Z",
          payload: { id: "s1" },
          payloadHash: "hash",
          source: sourceForPath(sourcePath),
          sourceRecordKey: `${sourcePath}:1`
        };
      },
      db,
      hostId: "host:test",
      hostname: "test",
      now: () => "2026-07-01T00:00:05.000Z",
      runtimeKind: "codex",
      workUnitId: unitId
    });

    expect(listImportWorkUnits(db, { importJobId: "import-1" })[0]).toMatchObject({
      importedRecords: 0,
      processedRecords: 1,
      status: "succeeded"
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 0 });
  });

  test("indexes each touched session once after an import unit completes", async () => {
    const sourcePath = join(tempDir, "thread.jsonl");
    const unitId = seedWorkUnit(db, sourcePath);
    const records: AdapterRecord[] = [1, 2, 3].map((offset) => ({
      diagnostics: [],
      normalized: {
        confidence: "authoritative",
        kind: "session",
        sourceRef: { sourceKind: "jsonl", sourcePath },
        value: { observedAt: "2026-07-01T00:00:00.000Z", sessionId: "s1" }
      },
      observedAt: "2026-07-01T00:00:00.000Z",
      payload: { id: "s1", offset },
      payloadHash: `hash-${offset}`,
      source: sourceForPath(sourcePath),
      sourceRecordKey: `${sourcePath}:${offset}`
    }));
    const indexedSessionIds: string[] = [];

    await runImportWorkUnit({
      adapterBackfill: async function* () {
        yield* records;
      },
      db,
      hostId: "host:test",
      hostname: "test",
      indexSession: (sessionId) => indexedSessionIds.push(sessionId),
      now: () => "2026-07-01T00:00:05.000Z",
      runtimeKind: "codex",
      workUnitId: unitId
    });

    expect(indexedSessionIds).toHaveLength(1);
  });

  test("groups diagnostic records and marks the unit failed", async () => {
    const sourcePath = join(tempDir, "bad.jsonl");
    const unitId = seedWorkUnit(db, sourcePath);

    await runImportWorkUnit({
      adapterBackfill: async function* (source: DiscoveredSource) {
        expect(source.sourceKind).toBe("jsonl");
        yield {
          diagnostics: [{ code: "malformed_json", message: "Malformed JSON.", observedAt: "2026-07-01T00:00:00.000Z", severity: "error" }],
          normalized: {
            confidence: "heuristic",
            kind: "event",
            sourceRef: { sourceKind: "jsonl", sourcePath: source.path },
            value: {}
          },
          observedAt: "2026-07-01T00:00:00.000Z",
          payload: {},
          payloadHash: "bad",
          source,
          sourceRecordKey: `${source.path}:1`
        };
      },
      db,
      hostId: "host:test",
      hostname: "test",
      now: () => "2026-07-01T00:00:05.000Z",
      runtimeKind: "codex",
      workUnitId: unitId
    });

    expect(listImportWorkUnits(db, { importJobId: "import-1" })[0]).toMatchObject({
      failedRecords: 1,
      status: "failed"
    });
    expect(listImportFailureGroups(db, "import-1")).toEqual([
      expect.objectContaining({
        code: "malformed_json",
        count: 1,
        failureKind: "malformed"
      })
    ]);
  });

  test("reconstructs the work unit source with persisted adapter metadata", async () => {
    const sourcePath = join(tempDir, "cursor-state.sqlite");
    const unitId = seedWorkUnit(db, sourcePath, {
      confidence: "heuristic",
      runtime: "cursor",
      sourceKind: "sqlite"
    });

    await runImportWorkUnit({
      adapterBackfill: async function* (source: DiscoveredSource) {
        expect(source).toMatchObject({
          confidence: "heuristic",
          path: sourcePath,
          runtime: "cursor",
          sourceKind: "sqlite"
        });
      },
      db,
      hostId: "host:test",
      hostname: "test",
      now: () => "2026-07-01T00:00:05.000Z",
      runtimeKind: "cursor",
      workUnitId: unitId
    });

    expect(listImportWorkUnits(db, { importJobId: "import-1" })[0]).toMatchObject({
      sourceKind: "sqlite",
      status: "succeeded"
    });
  });
});

function seedSourceAndImportJob(db: MastheadDatabase, sourcePath: string): void {
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("codex-sessions:thread.jsonl", "codex", "jsonl", sourcePath, "authoritative", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO import_jobs (
      import_job_id, source_id, import_kind, status, updated_at
    ) VALUES (?, ?, ?, ?, ?)`
  ).run("import-1", "codex-sessions:thread.jsonl", "transcript", "running", "2026-07-01T00:00:00.000Z");
}

function seedWorkUnit(
  db: MastheadDatabase,
  sourcePath: string,
  overrides: { confidence?: "authoritative" | "inferred" | "heuristic"; runtime?: "codex" | "cursor"; sourceKind?: "jsonl" | "sqlite" } = {}
): string {
  const manifest = createImportManifest(db, {
    excludedUnits: 0,
    generatedAt: "2026-07-01T00:00:00.000Z",
    importJobId: "import-1",
    importKind: "transcript",
    includedUnits: 1,
    runtime: overrides.runtime ?? "codex",
    scope: { includeChangedSinceCursor: true, mode: "transcript_recent", days: 30 },
    sourceId: "codex-sessions:thread.jsonl",
    totalBytes: 1,
    totalUnits: 1
  });
  return createImportWorkUnit(db, {
    confidence: overrides.confidence ?? "authoritative",
    importJobId: "import-1",
    manifestId: manifest.manifestId,
    runtime: overrides.runtime ?? "codex",
    sourceId: "codex-sessions:thread.jsonl",
    sourceKind: overrides.sourceKind ?? "jsonl",
    sourcePath,
    status: "queued",
    unitKind: "transcript_file"
  }).workUnitId;
}

function sourceForPath(path: string): DiscoveredSource {
  return {
    confidence: "authoritative",
    path,
    runtime: "codex",
    schemaVersion: "codex-transcript-jsonl",
    sourceId: "codex-sessions:thread.jsonl",
    sourceKind: "jsonl"
  };
}
