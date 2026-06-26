import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("daemon database schema", () => {
  test("creates raw journal, canonical graph, enrichment, FTS, and audit tables idempotently", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-db-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));

    migrateDatabase(db);
    migrateDatabase(db);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name").all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "raw_events",
        "ingest_sources",
        "ingest_cursors",
        "source_exclusions",
        "import_jobs",
        "adapter_diagnostics",
        "hosts",
        "runtimes",
        "sessions",
        "session_aliases",
        "session_relationships",
        "turns",
        "messages",
        "tool_calls",
        "tool_results",
        "file_effects",
        "runtime_signals",
        "background_tasks",
        "checkpoints",
        "model_usage",
        "review_dispositions",
        "board_sessions",
        "session_enrichments",
        "session_topics",
        "project_summaries",
        "mcp_query_log",
        "session_search",
        "app_settings",
        "source_policies",
        "legacy_migrations"
      ])
    );
    const applied = db.prepare("SELECT version, name FROM schema_migrations").all();
    expect(applied).toEqual([
      { version: 1, name: "001_initial" },
      { version: 2, name: "002_session_data_product" },
      { version: 3, name: "003_session_sources" },
      { version: 4, name: "004_cursor_context" },
      { version: 5, name: "005_import_progress" }
    ]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    db.prepare("INSERT INTO session_search(session_id, title, normalized_text) VALUES (?, ?, ?)").run(
      "session-1",
      "Codex importer",
      "Indexed historical session"
    );
    expect(db.prepare("SELECT session_id FROM session_search WHERE session_search MATCH ?").all("historical")).toEqual([
      { session_id: "session-1" }
    ]);
    db.close();
  });

  test("rejects an applied migration marker when critical schema tables are missing", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-db-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));

    db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL);");
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
      1,
      "001_initial",
      "2026-06-24T00:00:00.000Z"
    );

    expect(() => migrateDatabase(db)).toThrow(/missing critical tables|no such table/i);
    db.close();
  });

  test("treats nullable logical keys as unique values", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-db-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));

    migrateDatabase(db);
    db.prepare(
      `INSERT INTO ingest_sources (
        source_id, adapter, source_kind, confidence, discovered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run("source:nullable", "codex", "jsonl", "authoritative", "2026-06-24T00:00:00.000Z", "2026-06-24T00:00:00.000Z");
    db.prepare(
      `INSERT INTO hosts (host_id, first_seen_at, last_seen_at)
      VALUES (?, ?, ?)`
    ).run("host:nullable", "2026-06-24T00:00:00.000Z", "2026-06-24T00:00:00.000Z");
    db.prepare(
      `INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)`
    ).run("runtime:nullable", "codex", null, "2026-06-24T00:00:00.000Z", "2026-06-24T00:00:00.000Z");
    db.prepare(
      `INSERT INTO sessions (
        session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "session:nullable",
      "host:nullable",
      "runtime:nullable",
      "source-session",
      "running",
      "2026-06-24T00:00:00.000Z",
      "authoritative",
      "2026-06-24T00:00:00.000Z",
      "2026-06-24T00:00:00.000Z"
    );

    expect(() =>
      db
        .prepare(
          `INSERT INTO ingest_cursors (cursor_id, source_id, source_path, updated_at)
          VALUES (?, ?, ?, ?)`
        )
        .run("cursor:1", "source:nullable", null, "2026-06-24T00:00:00.000Z")
    ).not.toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO ingest_cursors (cursor_id, source_id, source_path, updated_at)
          VALUES (?, ?, ?, ?)`
        )
        .run("cursor:2", "source:nullable", null, "2026-06-24T00:00:01.000Z")
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?)`
        )
        .run("runtime:duplicate-null", "codex", null, "2026-06-24T00:00:01.000Z", "2026-06-24T00:00:01.000Z")
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO turns (turn_id, session_id, source_turn_id, turn_index, role, source_ref_json)
          VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run("turn:1", "session:nullable", null, 1, "user", "{}")
    ).not.toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO turns (turn_id, session_id, source_turn_id, turn_index, role, source_ref_json)
          VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run("turn:2", "session:nullable", null, 1, "user", "{}")
    ).toThrow();
    db.close();
  });
});
