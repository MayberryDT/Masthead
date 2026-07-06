import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createImportJob, updateImportJob } from "../importJobRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";
import { getAdapterStatuses, getSourceStatuses } from "../../import/sourceStatusService.ts";
import type { SourcePreflightResult } from "../../sources/sourcePreflight.ts";

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
    ).run("opencode-sessions", "opencode", "jsonl", "/tmp/.opencode/sessions", "authoritative", now, now);
    db.prepare(
      `INSERT INTO ingest_sources (
        source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("opencode-archive", "opencode", "jsonl", "/tmp/.opencode/archived_sessions", "authoritative", now, now);
    db.prepare("INSERT INTO hosts (host_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)").run("host:test", now, now);
    db.prepare(
      `INSERT INTO runtimes (runtime_id, runtime_kind, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?)`
    ).run("runtime:opencode", "opencode", now, now);
    db.prepare(
      `INSERT INTO sessions (
        session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("session:1", "host:test", "runtime:opencode", "session-1", "ended", now, "authoritative", now, now);
    db.prepare(
      `INSERT INTO sessions (
        session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("session:2", "host:test", "runtime:opencode", "session-2", "ended", now, "authoritative", now, now);
    db.prepare(
      `INSERT INTO session_sources (
        session_id, source_id, first_seen_at, last_seen_at, imported_record_count
      ) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`
    ).run("session:1", "opencode-sessions", now, now, 40, "session:2", "opencode-archive", now, now, 5);
    const job = createImportJob(db, {
      importKind: "metadata",
      sourceId: "opencode-sessions",
      updatedAt: now
    });
    updateImportJob(db, job.importJobId, {
      importedCount: 40,
      queuedCount: 3,
      status: "succeeded",
      updatedAt: now
    });

    const statuses = getSourceStatuses(db);
    expect(statuses.find((status) => status.sourceId === "opencode-sessions")).toMatchObject({
      importedSessions: 1,
      importedRecords: 40,
      queuedRecords: 3
    });
    expect(statuses.find((status) => status.sourceId === "opencode-archive")).toMatchObject({
      importedSessions: 1,
      importedRecords: 0
    });
    db.close();
  });

  test("source failure count ignores stale failed jobs after a newer successful job for the same kind", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-source-status-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    const now = "2026-06-25T12:00:00.000Z";

    db.prepare(
      `INSERT INTO ingest_sources (
        source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("opencode-sessions", "opencode", "jsonl", "/tmp/.opencode/sessions", "authoritative", now, now);

    const staleFailure = createImportJob(db, {
      importKind: "metadata",
      sourceId: "opencode-sessions",
      updatedAt: "2026-06-25T12:00:00.000Z"
    });
    updateImportJob(db, staleFailure.importJobId, {
      failureCount: 9,
      failureMessage: "Import job was abandoned by a previous daemon before it completed.",
      status: "failed",
      updatedAt: "2026-06-25T12:00:30.000Z"
    });
    const latestSuccess = createImportJob(db, {
      importKind: "metadata",
      sourceId: "opencode-sessions",
      updatedAt: "2026-06-25T12:01:00.000Z"
    });
    updateImportJob(db, latestSuccess.importJobId, {
      importedCount: 40,
      status: "succeeded",
      updatedAt: "2026-06-25T12:01:30.000Z"
    });

    const status = getSourceStatuses(db).find((candidate) => candidate.sourceId === "opencode-sessions");

    expect(status).toMatchObject({
      failureCount: 0,
      importedRecords: 40
    });
    db.close();
  });

  test("source failure count keeps the latest failed job as a current issue", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-source-status-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    const now = "2026-06-25T12:00:00.000Z";

    db.prepare(
      `INSERT INTO ingest_sources (
        source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("opencode-sessions", "opencode", "jsonl", "/tmp/.opencode/sessions", "authoritative", now, now);

    const olderSuccess = createImportJob(db, {
      importKind: "metadata",
      sourceId: "opencode-sessions",
      updatedAt: "2026-06-25T12:00:00.000Z"
    });
    updateImportJob(db, olderSuccess.importJobId, {
      importedCount: 40,
      status: "succeeded",
      updatedAt: "2026-06-25T12:00:30.000Z"
    });
    const latestFailure = createImportJob(db, {
      importKind: "metadata",
      sourceId: "opencode-sessions",
      updatedAt: "2026-06-25T12:01:00.000Z"
    });
    updateImportJob(db, latestFailure.importJobId, {
      failureCount: 2,
      status: "failed",
      updatedAt: "2026-06-25T12:01:30.000Z"
    });

    const status = getSourceStatuses(db).find((candidate) => candidate.sourceId === "opencode-sessions");

    expect(status).toMatchObject({
      failureCount: 2,
      importedRecords: 0
    });
    db.close();
  });

  test("source failure count evaluates import kinds independently", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-source-status-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    const now = "2026-06-25T12:00:00.000Z";

    db.prepare(
      `INSERT INTO ingest_sources (
        source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("opencode-sessions", "opencode", "jsonl", "/tmp/.opencode/sessions", "authoritative", now, now);

    const metadataSuccess = createImportJob(db, {
      importKind: "metadata",
      sourceId: "opencode-sessions",
      updatedAt: "2026-06-25T12:00:00.000Z"
    });
    updateImportJob(db, metadataSuccess.importJobId, {
      importedCount: 40,
      status: "succeeded",
      updatedAt: "2026-06-25T12:00:30.000Z"
    });
    const transcriptFailure = createImportJob(db, {
      importKind: "transcript",
      sourceId: "opencode-sessions",
      updatedAt: "2026-06-25T12:01:00.000Z"
    });
    updateImportJob(db, transcriptFailure.importJobId, {
      failureCount: 3,
      status: "failed",
      updatedAt: "2026-06-25T12:01:30.000Z"
    });

    const status = getSourceStatuses(db).find((candidate) => candidate.sourceId === "opencode-sessions");

    expect(status).toMatchObject({
      failureCount: 3,
      importedRecords: 40
    });
    db.close();
  });

  test("adapter status does not report import failures from stale historical jobs", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-source-status-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    const now = "2026-06-25T12:00:00.000Z";

    db.prepare(
      `INSERT INTO ingest_sources (
        source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("opencode-sessions", "opencode", "jsonl", "/tmp/.opencode/sessions", "authoritative", now, now);

    const staleFailure = createImportJob(db, {
      importKind: "metadata",
      sourceId: "opencode-sessions",
      updatedAt: "2026-06-25T12:00:00.000Z"
    });
    updateImportJob(db, staleFailure.importJobId, {
      failureCount: 9,
      status: "failed",
      updatedAt: "2026-06-25T12:00:30.000Z"
    });
    const latestSuccess = createImportJob(db, {
      importKind: "metadata",
      sourceId: "opencode-sessions",
      updatedAt: "2026-06-25T12:01:00.000Z"
    });
    updateImportJob(db, latestSuccess.importJobId, {
      importedCount: 40,
      status: "succeeded",
      updatedAt: "2026-06-25T12:01:30.000Z"
    });

    const codex = getAdapterStatuses(db).find((adapter) => adapter.runtime === "opencode");

    expect(codex?.state).not.toBe("degraded");
    expect(codex?.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("adapter_import_failures");
    db.close();
  });

  test("adapter status groups repeated diagnostics while preserving degraded state", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-source-status-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);

    const hermes = getAdapterStatuses(db, {
      preflights: [
        {
          checkedPaths: [],
          diagnostics: [
            {
              code: "jsonl_invalid_line",
              message: "Detected, import blocked: schema not recognized.",
              observedAt: "2026-06-25T12:00:00.000Z",
              severity: "warning"
            },
            {
              code: "jsonl_invalid_line",
              message: "Detected, import blocked: schema not recognized.",
              observedAt: "2026-06-25T12:01:00.000Z",
              severity: "warning"
            }
          ],
          discoveredCount: 2,
          label: "Hermes",
          runtime: "hermes",
          state: "degraded"
        } as unknown as SourcePreflightResult
      ]
    }).find((adapter) => adapter.runtime === "hermes");

    expect(hermes).toMatchObject({ state: "degraded" });
    expect(hermes?.diagnostics).toEqual([
      expect.objectContaining({
        code: "jsonl_invalid_line",
        count: 2,
        observedAt: "2026-06-25T12:01:00.000Z"
      })
    ]);
    db.close();
  });
});
