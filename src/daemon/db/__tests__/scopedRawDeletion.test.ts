import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { deleteMastheadData, getDataSummary } from "../dataLifecycleRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("scoped raw deletion", () => {
  test("deletes raw events that belong to the selected canonical project", async () => {
    const db = await openTestDatabase();
    seedSessionWithRawEvent(db, { project: "Masthead", rawId: "raw:masthead", sessionId: "session:masthead", sourceSessionId: "source-masthead" });
    seedSessionWithRawEvent(db, { project: "Pip", rawId: "raw:pip", sessionId: "session:pip", sourceSessionId: "source-pip" });

    expect(getDataSummary(db, { kind: "project", project: "Pip" }).rawEvents).toBe(1);

    const result = deleteMastheadData(db, { kind: "project", project: "Pip" });

    expect(result).toMatchObject({ rawEvents: 1, sessions: 1 });
    expect(rows(db, "sessions")).toEqual(["session:masthead"]);
    expect(rows(db, "raw_events")).toEqual(["raw:masthead"]);
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-scoped-raw-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedSessionWithRawEvent(
  db: MastheadDatabase,
  input: { project: string; rawId: string; sessionId: string; sourceSessionId: string }
): void {
  const now = "2026-06-25T12:00:00.000Z";
  db.prepare(
    `INSERT OR IGNORE INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("source:codex", "codex", "jsonl", "/tmp/sessions", "authoritative", now, now);
  db.prepare(
    `INSERT INTO raw_events (
      raw_event_id, source_id, source_record_key, observed_at, received_at, source_kind, source_path, payload_hash, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.rawId,
    "source:codex",
    `${input.sourceSessionId}:1`,
    now,
    now,
    "jsonl",
    `/tmp/${input.sourceSessionId}.jsonl`,
    `hash:${input.rawId}`,
    JSON.stringify({ payload: { session_id: input.sourceSessionId } })
  );
  db.prepare("INSERT OR IGNORE INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    "host:test",
    "test-host",
    now,
    now
  );
  db.prepare(
    `INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)`
  ).run("runtime:codex", "codex", "test", now, now);
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, lifecycle, last_activity_at,
      source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(input.sessionId, "host:test", "runtime:codex", input.sourceSessionId, input.project, "ended", now, "authoritative", now, now);
}

function rows(db: MastheadDatabase, table: "raw_events" | "sessions"): string[] {
  const column = table === "raw_events" ? "raw_event_id" : "session_id";
  return (db.prepare(`SELECT ${column} AS id FROM ${table} ORDER BY id`).all() as Array<{ id: string }>).map((row) => row.id);
}
