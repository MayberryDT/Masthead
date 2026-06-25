import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { applyDefaultRetention, deleteMastheadData, getDataSummary } from "../dataLifecycleRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("retention policy", () => {
  test("default retention preserves canonical sessions and capsules", async () => {
    const db = await openTestDatabase();
    seedCanonicalSessionGraph(db, { project: "Masthead", sessionId: "session:1" });

    const result = applyDefaultRetention(db);

    expect(result.rawEvents).toBe(1);
    expect(count(db, "sessions")).toBe(1);
    expect(count(db, "session_enrichments")).toBe(1);
    expect(count(db, "session_search")).toBe(1);
    expect(count(db, "raw_events")).toBe(0);
    db.close();
  });

  test("data summary reports table counts and logical storage classes", async () => {
    const db = await openTestDatabase();
    seedCanonicalSessionGraph(db, { project: "Masthead", sessionId: "session:1" });

    expect(getDataSummary(db)).toMatchObject({
      tables: {
        raw_events: 1,
        sessions: 1,
        session_enrichments: 1,
        session_search: 1
      },
      storageClasses: {
        audit_logs: { records: 1 },
        canonical_metadata: { records: 2, retention: "indefinite" },
        derived_indexes: { records: 2, retention: "rebuildable" },
        raw_payloads: { records: 1, retention: "configurable" },
        searchable_messages: { records: 1, retention: "indefinite_configurable" }
      }
    });
    db.close();
  });

  test("scoped deletion removes matching sessions, FTS rows, and derived summaries", async () => {
    const db = await openTestDatabase();
    seedCanonicalSessionGraph(db, { project: "Masthead", sessionId: "session:1" });
    seedCanonicalSessionGraph(db, { project: "Pip", sessionId: "session:2" });

    const result = deleteMastheadData(db, { kind: "project", project: "Pip" });

    expect(result.sessions).toBe(1);
    expect(sessionIds(db)).toEqual(["session:1"]);
    expect(searchSessionIds(db)).toEqual(["session:1"]);
    expect(projectKeys(db)).toEqual(["Masthead"]);
    expect(count(db, "raw_events")).toBe(2);
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-retention-policy-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedCanonicalSessionGraph(
  db: MastheadDatabase,
  options: {
    project: string;
    sessionId: string;
  }
): void {
  const suffix = options.sessionId.replace(/[^a-z0-9]+/gi, "-");
  const now = "2026-06-25T12:00:00.000Z";
  db.prepare(
    `INSERT OR IGNORE INTO ingest_sources (
      source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("source:codex", "codex", "jsonl", "/tmp/rollout.jsonl", "authoritative", now, now);
  db.prepare(
    `INSERT INTO raw_events (
      raw_event_id, source_id, source_record_key, observed_at, received_at, source_kind, source_path, payload_hash, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`raw:${suffix}`, "source:codex", `${suffix}:1`, now, now, "jsonl", "/tmp/rollout.jsonl", `hash:${suffix}`, "{}");
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
      session_id, host_id, runtime_id, source_session_id, project_label, title, lifecycle, last_activity_at,
      source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    options.sessionId,
    "host:test",
    "runtime:codex",
    `source-${suffix}`,
    options.project,
    `${options.project} import`,
    "ended",
    now,
    "authoritative",
    now,
    now
  );
  db.prepare(
    `INSERT INTO messages (
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`message:${suffix}`, options.sessionId, "user", `Build ${options.project}`, `hash:message:${suffix}`, now, "{}", "authoritative");
  db.prepare(
    `INSERT INTO session_enrichments (
      enrichment_id, session_id, enrichment_kind, status, content_fingerprint, prompt_version,
      generated_at, content_json, source_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`enrichment:${suffix}`, options.sessionId, "session_capsule", "current", `fp:${suffix}`, "v1", now, "{}", "[]");
  db.prepare("INSERT INTO session_search(session_id, title, normalized_text) VALUES (?, ?, ?)").run(
    options.sessionId,
    `${options.project} import`,
    `Build ${options.project}`
  );
  db.prepare(
    `INSERT OR REPLACE INTO project_summaries (
      project_summary_id, project_key, summary_json, content_fingerprint, generated_at
    ) VALUES (?, ?, ?, ?, ?)`
  ).run(`summary:${options.project}`, options.project, "{}", `summary-fp:${options.project}`, now);
  db.prepare(
    `INSERT OR IGNORE INTO mcp_query_log (
      mcp_query_id, tool_name, requested_at, result_count, session_ids_json, status
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run("mcp:1", "search_sessions", now, 1, "[\"session:1\"]", "succeeded");
}

function count(db: MastheadDatabase, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function sessionIds(db: MastheadDatabase): string[] {
  return (db.prepare("SELECT session_id FROM sessions ORDER BY session_id").all() as Array<{ session_id: string }>).map(
    (row) => row.session_id
  );
}

function searchSessionIds(db: MastheadDatabase): string[] {
  return (db.prepare("SELECT session_id FROM session_search ORDER BY session_id").all() as Array<{ session_id: string }>).map(
    (row) => row.session_id
  );
}

function projectKeys(db: MastheadDatabase): string[] {
  return (
    db.prepare("SELECT project_key FROM project_summaries ORDER BY project_key").all() as Array<{ project_key: string }>
  ).map((row) => row.project_key);
}
