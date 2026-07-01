import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { getImportJob } from "../../db/importJobRepository.ts";
import { migrateDatabase } from "../../db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import {
  deriveImportVisibilityState,
  markInterruptedImportJobs,
  queueImportJob,
  type ImportJobControls,
  type ImportWorkResult
} from "../importCoordinator.ts";

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
      finishedAt: fixedNow(),
      importedCount: 2,
      startedAt: fixedNow(),
      status: "succeeded"
    });
    db.close();
  });

  test("runs queued imports one at a time", async () => {
    const db = await openTestDatabase();
    seedSource(db);
    seedSource(db, "codex-archive");
    let resolveFirst: (value: ImportWorkResult) => void = () => undefined;
    let secondStarted = false;

    const firstWorker = new Promise<ImportWorkResult>((resolve) => {
      resolveFirst = resolve;
    });
    const first = queueImportJob(db, { importKind: "metadata", sourceId: "codex-sessions", now: fixedNow }, () => firstWorker);
    const second = queueImportJob(db, { importKind: "metadata", sourceId: "codex-archive", now: fixedNow }, () => {
      secondStarted = true;
      return Promise.resolve({ discoveredCount: 1, failureCount: 0, importedCount: 1, processedCount: 1, queuedCount: 0 });
    });

    await flushMicrotasks();
    expect(getImportJob(db, first.importJobId)?.status).toBe("running");
    expect(getImportJob(db, second.importJobId)?.status).toBe("queued");
    expect(secondStarted).toBe(false);

    resolveFirst({ discoveredCount: 1, failureCount: 0, importedCount: 1, processedCount: 1, queuedCount: 0 });
    await waitForJobStatus(db, first.importJobId, "succeeded");
    await waitForJobStatus(db, second.importJobId, "succeeded");
    expect(secondStarted).toBe(true);
    db.close();
  });

  test("marks active jobs from a previous daemon run as interrupted", async () => {
    const db = await openTestDatabase();
    seedSource(db);
    db.prepare(
      `INSERT INTO import_jobs (
        import_job_id,
        source_id,
        import_kind,
        status,
        discovered_count,
        processed_count,
        imported_count,
        queued_count,
        failure_count,
        current_path,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("import_job:interrupted", "codex-sessions", "metadata", "running", 10, 10, 10, 0, 0, "/tmp/import.jsonl", fixedNow());

    const interrupted = markInterruptedImportJobs(db, fixedNow);
    expect(interrupted).toBe(1);
    expect(getImportJob(db, "import_job:interrupted")).toMatchObject({
      failureCount: 1,
      failureMessage: "Import was interrupted by a previous daemon shutdown. Re-run the import to continue.",
      finishedAt: fixedNow(),
      status: "failed"
    });
    db.close();
  });

  test("updates heartbeat and stage while a job runs", async () => {
    const db = await openTestDatabase();
    seedSource(db);
    let resolveWorker: (value: ImportWorkResult) => void = () => undefined;
    const worker = new Promise<ImportWorkResult>((resolve) => {
      resolveWorker = resolve;
    });

    const job = queueImportJob(db, { importKind: "metadata", sourceId: "codex-sessions", now: fixedNow }, (controls) => {
      controls.updateProgress({
        currentPath: "/tmp/session_index.jsonl",
        heartbeatAt: "2026-07-01T00:00:05.000Z",
        importedCount: 1,
        processedCount: 1,
        stage: "metadata"
      });
      return worker;
    });

    await flushMicrotasks();
    expect(getImportJob(db, job.importJobId)).toMatchObject({
      currentPath: "/tmp/session_index.jsonl",
      heartbeatAt: "2026-07-01T00:00:05.000Z",
      importedCount: 1,
      processedCount: 1,
      stage: "metadata",
      status: "running"
    });

    resolveWorker({ discoveredCount: 1, failureCount: 0, importedCount: 1, processedCount: 1, queuedCount: 0 });
    await waitForJobStatus(db, job.importJobId, "succeeded");
    expect(getImportJob(db, job.importJobId)).toMatchObject({
      currentPath: undefined,
      heartbeatAt: fixedNow(),
      importedCount: 1,
      stage: "completion",
      status: "succeeded"
    });
    db.close();
  });

  test("marks parent job succeeded_with_issues when useful records and failures both occurred", async () => {
    const db = await openTestDatabase();
    seedSource(db);

    const job = queueImportJob(db, { importKind: "transcript", sourceId: "codex-sessions", now: fixedNow }, async () => ({
      discoveredCount: 10,
      failureCount: 2,
      importedCount: 8,
      processedCount: 10,
      queuedCount: 0
    }));

    await waitForJobStatus(db, job.importJobId, "succeeded_with_issues");
    expect(getImportJob(db, job.importJobId)?.status).toBe("succeeded_with_issues");
    db.close();
  });

  test("derives stalled state from stale running job heartbeat", () => {
    expect(
      deriveImportVisibilityState(
        { heartbeatAt: "2026-07-01T00:00:00.000Z", status: "running", updatedAt: "2026-07-01T00:00:00.000Z" },
        new Date("2026-07-01T00:01:00.000Z").getTime(),
        30_000
      )
    ).toBe("stalled");
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-coordinator-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedSource(db: MastheadDatabase, sourceId = "codex-sessions"): void {
  const now = fixedNow();
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sourceId, "codex", "jsonl", `/tmp/.codex/${sourceId}`, "authoritative", now, now);
}

function fixedNow(): string {
  return "2026-06-25T12:00:00.000Z";
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForJobStatus(db: MastheadDatabase, importJobId: string, status: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (getImportJob(db, importJobId)?.status === status) return;
    await flushMicrotasks();
  }
  expect(getImportJob(db, importJobId)?.status).toBe(status);
}
