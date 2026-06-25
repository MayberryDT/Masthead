import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { getImportJob } from "../../db/importJobRepository.ts";
import { migrateDatabase } from "../../db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { queueImportJob } from "../importCoordinator.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("background import jobs", () => {
  test("returns a queued job and persists worker failures asynchronously", async () => {
    const db = await openTestDatabase();
    seedSource(db);

    const job = queueImportJob(db, { importKind: "metadata", sourceId: "codex-sessions", now: fixedNow }, async () => {
      throw new Error("metadata file disappeared");
    });

    expect(job.status).toBe("queued");
    await Promise.resolve();
    await waitForMacrotask();
    expect(getImportJob(db, job.importJobId)).toMatchObject({
      failureCount: 1,
      failureMessage: "metadata file disappeared",
      status: "failed"
    });
    db.close();
  });
});

function waitForMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-background-import-"));
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
