import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createImportJob, listImportJobPage, updateImportJob } from "../importJobRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("import job repository", () => {
  test("lists import jobs by bounded newest-first pages", async () => {
    const db = await openTestDatabase();
    insertSource(db, "opencode-sessions", "opencode");

    const first = createImportJob(db, {
      importKind: "metadata",
      sourceId: "opencode-sessions",
      updatedAt: "2026-06-25T12:00:00.000Z"
    });
    const second = createImportJob(db, {
      importKind: "metadata",
      sourceId: "opencode-sessions",
      updatedAt: "2026-06-25T12:01:00.000Z"
    });
    const third = createImportJob(db, {
      importKind: "metadata",
      sourceId: "opencode-sessions",
      updatedAt: "2026-06-25T12:02:00.000Z"
    });

    const page = listImportJobPage(db, { limit: 2, offset: 1 });

    expect(page).toMatchObject({ limit: 2, offset: 1, total: 3 });
    expect(page.jobs.map((job) => job.importJobId)).toEqual([second.importJobId, first.importJobId]);
    expect(page.jobs.map((job) => job.importJobId)).not.toContain(third.importJobId);
    db.close();
  });

  test("filters import job pages by adapter, source, and active status", async () => {
    const db = await openTestDatabase();
    insertSource(db, "opencode-sessions", "opencode");
    insertSource(db, "hermes-jsonl", "hermes");

    const codexRunning = createImportJob(db, {
      importKind: "metadata",
      sourceId: "opencode-sessions",
      updatedAt: "2026-06-25T12:00:00.000Z"
    });
    updateImportJob(db, codexRunning.importJobId, {
      status: "running",
      updatedAt: "2026-06-25T12:00:30.000Z"
    });
    const codexDone = createImportJob(db, {
      importKind: "transcript",
      sourceId: "opencode-sessions",
      updatedAt: "2026-06-25T12:01:00.000Z"
    });
    updateImportJob(db, codexDone.importJobId, {
      status: "succeeded",
      updatedAt: "2026-06-25T12:01:30.000Z"
    });
    const hermesRunning = createImportJob(db, {
      importKind: "metadata",
      sourceId: "hermes-jsonl",
      updatedAt: "2026-06-25T12:02:00.000Z"
    });
    updateImportJob(db, hermesRunning.importJobId, {
      status: "queued",
      updatedAt: "2026-06-25T12:02:30.000Z"
    });

    const page = listImportJobPage(db, { adapterId: "opencode", limit: 10, offset: 0, status: "active" });

    expect(page.total).toBe(1);
    expect(page.jobs.map((job) => job.importJobId)).toEqual([codexRunning.importJobId]);
    expect(page.jobs.map((job) => job.importJobId)).not.toContain(codexDone.importJobId);
    expect(page.jobs.map((job) => job.importJobId)).not.toContain(hermesRunning.importJobId);
    db.close();
  });
});

async function openTestDatabase() {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-jobs-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function insertSource(db: Awaited<ReturnType<typeof openTestDatabase>>, sourceId: string, adapter: string): void {
  const now = "2026-06-25T12:00:00.000Z";
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sourceId, adapter, "jsonl", `/tmp/${sourceId}`, "authoritative", now, now);
}
