import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { countDistinctSessionsForSource, upsertSessionSource } from "../sessionSourceRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { seedSession } from "./sessionTestHelpers.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("session source repository", () => {
  test("tracks distinct canonical sessions per ingest source", async () => {
    const db = await openTestDatabase();
    seedSource(db, "codex-metadata", "/tmp/session_index.jsonl");
    seedSource(db, "codex-transcript", "/tmp/sessions/session.jsonl");
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:1", title: "Metadata import" });

    upsertSessionSource(db, {
      importedRecordCount: 1,
      observedAt: "2026-06-25T12:00:00.000Z",
      sessionId: "session:1",
      sourceId: "codex-metadata"
    });
    upsertSessionSource(db, {
      importedRecordCount: 3,
      observedAt: "2026-06-25T12:05:00.000Z",
      sessionId: "session:1",
      sourceId: "codex-metadata"
    });
    upsertSessionSource(db, {
      importedRecordCount: 1,
      observedAt: "2026-06-25T12:06:00.000Z",
      sessionId: "session:1",
      sourceId: "codex-transcript"
    });

    expect(countDistinctSessionsForSource(db, "codex-metadata")).toBe(1);
    expect(countDistinctSessionsForSource(db, "codex-transcript")).toBe(1);
    const row = db
      .prepare("SELECT imported_record_count AS importedRecordCount FROM session_sources WHERE source_id = ?")
      .get("codex-metadata") as { importedRecordCount: number };
    expect(row.importedRecordCount).toBe(4);
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-session-sources-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedSource(db: MastheadDatabase, sourceId: string, path: string): void {
  const now = "2026-06-25T12:00:00.000Z";
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sourceId, "opencode", "jsonl", path, "authoritative", now, now);
}
