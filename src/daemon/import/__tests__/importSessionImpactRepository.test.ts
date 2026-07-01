import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { recordImportSessionImpact, summarizeImportSessionImpacts } from "../../db/importSessionImpactRepository.ts";

const tempDirs: string[] = [];

describe("import session impact repository", () => {
  let db: MastheadDatabase;

  beforeEach(async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-impact-"));
    tempDirs.push(tempDir);
    db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSourceJobAndSession(db);
  });

  afterEach(async () => {
    db.close();
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  });

  test("summarizes canonical session outcomes for an import job", () => {
    recordImportSessionImpact(db, {
      importJobId: "import-1",
      impactKind: "created",
      observedAt: "2026-07-01T00:01:00.000Z",
      runtime: "codex",
      sessionId: "session:1",
      sourceId: "codex-sessions"
    });
    recordImportSessionImpact(db, {
      importJobId: "import-1",
      impactKind: "transcript_added",
      observedAt: "2026-07-01T00:02:00.000Z",
      recordCount: 4,
      runtime: "codex",
      sessionId: "session:1",
      sourceId: "codex-sessions"
    });
    recordImportSessionImpact(db, {
      importJobId: "import-1",
      impactKind: "enriched",
      observedAt: "2026-07-01T00:03:00.000Z",
      runtime: "codex",
      sessionId: "session:1",
      sourceId: "codex-sessions"
    });

    expect(summarizeImportSessionImpacts(db, "import-1")).toEqual({
      enrichedSessions: 1,
      sessionsCreated: 1,
      sessionsUpdated: 0,
      transcriptsAdded: 4
    });
  });
});

function seedSourceJobAndSession(db: MastheadDatabase): void {
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("codex-sessions", "codex", "jsonl", "/tmp/.codex/sessions", "authoritative", "2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO import_jobs (
      import_job_id, source_id, import_kind, status, updated_at
    ) VALUES (?, ?, ?, ?, ?)`
  ).run("import-1", "codex-sessions", "transcript", "queued", "2026-07-01T00:00:00.000Z");
  db.prepare("INSERT INTO hosts (host_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)").run(
    "host:test",
    "2026-07-01T00:00:00.000Z",
    "2026-07-01T00:00:00.000Z"
  );
  db.prepare("INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
    "runtime:codex:test",
    "codex",
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
    "runtime:codex:test",
    "s1",
    "unknown",
    "2026-07-01T00:00:00.000Z",
    "authoritative",
    "2026-07-01T00:00:00.000Z",
    "2026-07-01T00:00:00.000Z"
  );
}
