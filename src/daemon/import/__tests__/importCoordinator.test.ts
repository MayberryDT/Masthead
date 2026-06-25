import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { getImportJob } from "../../db/importJobRepository.ts";
import { migrateDatabase } from "../../db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { queueImportJob, type ImportJobControls, type ImportWorkResult } from "../importCoordinator.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("import coordinator", () => {
  test("returns a queued job before running the worker", async () => {
    const db = await openTestDatabase();
    seedSource(db);
    let resolveWorker: (value: ImportWorkResult) => void = () => undefined;
    const worker = new Promise<ImportWorkResult>((resolve) => {
      resolveWorker = resolve;
    });
    let controls: ImportJobControls | undefined;

    const job = queueImportJob(db, { importKind: "metadata", sourceId: "codex-sessions", now: fixedNow }, (workerControls) => {
      controls = workerControls;
      return worker;
    });

    expect(job.status).toBe("queued");
    expect(getImportJob(db, job.importJobId)?.status).toBe("queued");

    await Promise.resolve();
    expect(getImportJob(db, job.importJobId)?.status).toBe("running");
    expect(controls).toBeDefined();
    controls?.updateProgress({
      currentPath: "/tmp/.codex/sessions/2026/06/25/import.jsonl",
      discoveredCount: 4,
      failureCount: 0,
      importedCount: 1,
      processedCount: 1,
      queuedCount: 0
    });
    expect(getImportJob(db, job.importJobId)).toMatchObject({
      currentPath: "/tmp/.codex/sessions/2026/06/25/import.jsonl",
      discoveredCount: 4,
      processedCount: 1,
      progressCurrent: 1,
      progressPercent: 25,
      progressTotal: 4,
      status: "running"
    });

    resolveWorker({ discoveredCount: 2, failureCount: 0, importedCount: 2, processedCount: 2, queuedCount: 0 });
    await Promise.resolve();
    expect(getImportJob(db, job.importJobId)).toMatchObject({
      discoveredCount: 2,
      importedCount: 2,
      status: "succeeded"
    });
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-coordinator-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedSource(db: MastheadDatabase): void {
  const now = fixedNow();
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("codex-sessions", "codex", "jsonl", "/tmp/.codex/sessions", "authoritative", now, now);
}

function fixedNow(): string {
  return "2026-06-25T12:00:00.000Z";
}
