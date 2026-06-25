import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createImportJob, updateImportJob } from "../importJobRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";
import { getSourceStatuses } from "../../import/sourceStatusService.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("source status service", () => {
  test("source status reports real canonical counts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-source-status-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    const now = "2026-06-25T12:00:00.000Z";

    db.prepare(
      `INSERT INTO ingest_sources (
        source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("codex-sessions", "codex", "jsonl", "/tmp/.codex/sessions", "authoritative", now, now);
    db.prepare(
      `INSERT INTO ingest_sources (
        source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("codex-archive", "codex", "jsonl", "/tmp/.codex/archived_sessions", "authoritative", now, now);
    db.prepare("INSERT INTO hosts (host_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)").run("host:test", now, now);
    db.prepare(
      `INSERT INTO runtimes (runtime_id, runtime_kind, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?)`
    ).run("runtime:codex", "codex", now, now);
    db.prepare(
      `INSERT INTO sessions (
        session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("session:1", "host:test", "runtime:codex", "session-1", "ended", now, "authoritative", now, now);
    db.prepare(
      `INSERT INTO sessions (
        session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("session:2", "host:test", "runtime:codex", "session-2", "ended", now, "authoritative", now, now);
    db.prepare(
      `INSERT INTO session_sources (
        session_id, source_id, first_seen_at, last_seen_at, imported_record_count
      ) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`
    ).run("session:1", "codex-sessions", now, now, 40, "session:2", "codex-archive", now, now, 5);
    const job = createImportJob(db, {
      importKind: "metadata",
      sourceId: "codex-sessions",
      updatedAt: now
    });
    updateImportJob(db, job.importJobId, {
      importedCount: 40,
      queuedCount: 3,
      status: "succeeded",
      updatedAt: now
    });

    const statuses = getSourceStatuses(db);
    expect(statuses.find((status) => status.sourceId === "codex-sessions")).toMatchObject({
      importedSessions: 1,
      importedRecords: 40,
      queuedRecords: 3
    });
    expect(statuses.find((status) => status.sourceId === "codex-archive")).toMatchObject({
      importedSessions: 1,
      importedRecords: 0
    });
    db.close();
  });
});
