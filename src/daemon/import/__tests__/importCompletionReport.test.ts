import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { recordImportSessionImpact } from "../../db/importSessionImpactRepository.ts";
import { migrateDatabase } from "../../db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { buildImportCompletionReport } from "../importCompletionReport.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("import completion report", () => {
  test("derives created sessions and transcript coverage from persisted impact rows", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-report-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedImportSession(db);
    recordImportSessionImpact(db, {
      importJobId: "import-1",
      impactKind: "created",
      observedAt: "2026-07-01T00:01:00.000Z",
      runtime: "opencode",
      sessionId: "session:1",
      sourceId: "opencode-sessions"
    });
    recordImportSessionImpact(db, {
      importJobId: "import-1",
      impactKind: "transcript_added",
      observedAt: "2026-07-01T00:02:00.000Z",
      recordCount: 4,
      runtime: "opencode",
      sessionId: "session:1",
      sourceId: "opencode-sessions"
    });

    const report = buildImportCompletionReport(db, {
      failedUnits: 0,
      generatedAt: "2026-07-01T00:03:00.000Z",
      importJobId: "import-1",
      recordsFailed: 0,
      recordsImported: 4,
      recordsSkipped: 1,
      runtime: "opencode",
      skippedUnits: 1,
      status: "succeeded",
      transcriptsImported: 0
    });

    expect(report).toMatchObject({
      importJobId: "import-1",
      nextActions: expect.arrayContaining(["open_logbook", "import_full_archive", "run_enrichment"]),
      recordsImported: 4,
      recordsSkipped: 1,
      sessionsCreated: 1,
      sessionsUpdated: 0,
      transcriptsImported: 4
    });
    db.close();
  });
});

function seedImportSession(db: MastheadDatabase): void {
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("opencode-sessions", "opencode", "jsonl", "/tmp/.opencode/sessions", "authoritative", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO import_jobs (
      import_job_id, source_id, import_kind, status, updated_at
    ) VALUES (?, ?, ?, ?, ?)`
  ).run("import-1", "opencode-sessions", "transcript", "succeeded", "2026-07-01T00:00:00.000Z");
  db.prepare("INSERT INTO hosts (host_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)").run(
    "host:test",
    "2026-07-01T00:00:00.000Z",
    "2026-07-01T00:00:00.000Z"
  );
  db.prepare("INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
    "runtime:opencode:test",
    "opencode",
    "test",
    "2026-07-01T00:00:00.000Z",
    "2026-07-01T00:00:00.000Z"
  );
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "session:1",
    "host:test",
    "runtime:opencode:test",
    "s1",
    "unknown",
    "2026-07-01T00:00:00.000Z",
    "authoritative",
    "2026-07-01T00:00:00.000Z",
    "2026-07-01T00:00:00.000Z"
  );
  db.prepare("INSERT INTO session_search(session_id, title, normalized_text) VALUES (?, ?, ?)").run("session:1", "Import me", "Import me");
}
