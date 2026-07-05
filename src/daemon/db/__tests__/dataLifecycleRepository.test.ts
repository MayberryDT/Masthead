import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { deleteAllMastheadData } from "../dataLifecycleRepository.ts";
import { getOrCreateDatabaseIdentity, migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("data lifecycle repository", () => {
  test("deleteAllMastheadData removes every canonical and derived record", async () => {
    const db = await openTestDatabase();
    const databaseId = getOrCreateDatabaseIdentity(db);
    seedCanonicalSessionGraph(db);

    const result = deleteAllMastheadData(db);

    expect(result.sessions).toBe(1);
    expect(result.rawEvents).toBe(1);
    expect(result.enrichments).toBe(1);
    expect(result.auditRows).toBe(1);
    expect(count(db, "sessions")).toBe(0);
    expect(count(db, "messages")).toBe(0);
    expect(count(db, "session_enrichments")).toBe(0);
    expect(count(db, "session_search")).toBe(0);
    expect(count(db, "raw_events")).toBe(0);
    expect(count(db, "ingest_sources")).toBe(0);
    expect(count(db, "hosts")).toBe(0);
    expect(count(db, "runtimes")).toBe(0);
    expect(getOrCreateDatabaseIdentity(db)).toBe(databaseId);
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-data-lifecycle-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedCanonicalSessionGraph(db: MastheadDatabase): void {
  const now = "2026-06-25T12:00:00.000Z";
  db.prepare(
    `INSERT INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("source:codex", "codex", "jsonl", "/tmp/rollout.jsonl", "authoritative", now, now);
  db.prepare(
    `INSERT INTO raw_events (
      raw_event_id, source_id, source_record_key, observed_at, received_at, source_kind, source_path, payload_hash, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("raw:1", "source:codex", "rollout.jsonl:1", now, now, "jsonl", "/tmp/rollout.jsonl", "hash", "{}");
  db.prepare("INSERT INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    "host:test",
    "test-host",
    now,
    now
  );
  db.prepare(
    `INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)`
  ).run("runtime:codex", "codex", "test", now, now);
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, title, lifecycle, last_activity_at,
      source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("session:1", "host:test", "runtime:codex", "session-1", "Import Logbook", "ended", now, "authoritative", now, now);
  db.prepare(
    `INSERT INTO messages (
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("message:1", "session:1", "user", "Build Logbook", "hash:message", now, "{}", "authoritative");
  db.prepare(
    `INSERT INTO session_enrichments (
      enrichment_id, session_id, enrichment_kind, status, content_fingerprint, prompt_version,
      generated_at, content_json, source_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("enrichment:1", "session:1", "session_capsule", "current", "fp", "v1", now, "{}", "[]");
  db.prepare("INSERT INTO session_search(session_id, title, normalized_text) VALUES (?, ?, ?)").run(
    "session:1",
    "Import Logbook",
    "Build Logbook"
  );
  db.prepare(
    `INSERT INTO mcp_query_log (
      mcp_query_id, tool_name, requested_at, result_count, session_ids_json, status
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run("mcp:1", "search_sessions", now, 1, "[\"session:1\"]", "succeeded");
}

function count(db: MastheadDatabase, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}
