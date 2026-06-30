import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import type { DaemonConfig } from "../config.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("data lifecycle API", () => {
  test("summarizes storage classes and applies default retention without pruning sessions", async () => {
    const daemon = await createTestDaemon();
    seedCanonicalSessionGraph(daemon.database, { project: "Masthead", sessionId: "session:1" });
    const baseUrl = await listen(daemon);

    const before = await getJson(baseUrl, "/data/summary");
    expect(before.summary).toMatchObject({
      tables: {
        raw_events: 1,
        sessions: 1,
        session_enrichments: 1
      },
      storageClasses: {
        canonical_metadata: { records: 2, retention: "indefinite" },
        raw_payloads: { records: 1, retention: "configurable" },
        searchable_messages: { records: 1, retention: "indefinite_configurable" }
      }
    });

    const retained = await postJson(baseUrl, "/data/retention/default", {});
    expect(retained.result).toMatchObject({ rawEvents: 1 });
    expect(count(daemon.database, "sessions")).toBe(1);
    expect(count(daemon.database, "session_enrichments")).toBe(1);
    expect(count(daemon.database, "raw_events")).toBe(0);
  });

  test("scoped deletion previews blast radius and clears FTS for selected projects", async () => {
    const daemon = await createTestDaemon();
    seedCanonicalSessionGraph(daemon.database, { project: "Masthead", sessionId: "session:1" });
    seedCanonicalSessionGraph(daemon.database, { project: "Pip", sessionId: "session:2" });
    const baseUrl = await listen(daemon);

    expect(await getJson(baseUrl, "/data/summary?kind=project&project=Pip")).toMatchObject({
      ok: true,
      summary: {
        tables: {
          raw_events: 1,
          sessions: 1
        },
        storageClasses: {
          raw_payloads: { records: 1 },
          searchable_messages: { records: 1 }
        }
      }
    });

    const deleted = await postJson(baseUrl, "/data/delete", { scope: { kind: "project", project: "Pip" } });

    expect(deleted.preview).toMatchObject({
      tables: {
        raw_events: 1,
        sessions: 1
      },
      storageClasses: {
        raw_payloads: { records: 1 },
        searchable_messages: { records: 1 }
      }
    });
    expect(deleted.result).toMatchObject({ sessions: 1 });
    expect(sessionIds(daemon.database)).toEqual(["session:1"]);
    expect(searchSessionIds(daemon.database)).toEqual(["session:1"]);
    expect(projectKeys(daemon.database)).toEqual(["Masthead"]);
    expect(count(daemon.database, "raw_events")).toBe(1);
  });

  test("default retention removes raw copies without blanking live normalized state", async () => {
    const { daemon, storePath } = await createTestHarness();
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/ingest", liveApprovalPayload("raw-retention"));
    expect((await getJson(baseUrl, "/events")).events).toHaveLength(1);
    expect(await readTextOrEmpty(storePath)).toBe("");
    expect(count(daemon.database, "raw_events")).toBe(1);

    await postJson(baseUrl, "/data/retention/default", {});

    expect((await getJson(baseUrl, "/events")).events).toHaveLength(1);
    expect(await readTextOrEmpty(storePath)).toBe("");
    expect(count(daemon.database, "sessions")).toBe(1);
    expect(count(daemon.database, "raw_events")).toBe(0);
  });

  test("scoped session deletion removes matching live state so projection cannot recreate it", async () => {
    const { daemon, storePath } = await createTestHarness();
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/ingest", liveApprovalPayload("scoped-live-delete"));
    await getJson(baseUrl, "/projection?expandedSessionId=server-live");
    expect(count(daemon.database, "sessions")).toBe(1);
    expect(await getJson(baseUrl, "/data/summary?kind=session&sessionId=server-live")).toMatchObject({
      ok: true,
      summary: {
        tables: {
          raw_events: 1,
          sessions: 1
        },
        storageClasses: {
          raw_payloads: { records: 1 }
        }
      }
    });

    const deleted = await postJson(baseUrl, "/data/delete", { scope: { kind: "session", sessionId: "server-live" } });
    expect(deleted.result).toMatchObject({ sessions: 1 });
    expect((await getJson(baseUrl, "/events")).events).toEqual([]);
    expect(await readTextOrEmpty(storePath)).toBe("");

    const projection = await getJson(baseUrl, "/projection?expandedSessionId=server-live");
    expect(projection.projection.cards).toEqual([]);
    expect(count(daemon.database, "sessions")).toBe(0);
    expect(count(daemon.database, "session_search")).toBe(0);
  });

  test("invalid structured delete scopes return a client error", async () => {
    const daemon = await createTestDaemon();
    const baseUrl = await listen(daemon);

    const missingProject = await fetch(`${baseUrl}/data/delete`, {
      body: JSON.stringify({ scope: { kind: "project" } }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST"
    });
    const bogusKind = await fetch(`${baseUrl}/data/delete`, {
      body: JSON.stringify({ scope: { kind: "bogus" } }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST"
    });

    expect(missingProject.status).toBe(400);
    expect(await missingProject.json()).toMatchObject({ ok: false, error: "project is required" });
    expect(bogusKind.status).toBe(400);
    expect(await bogusKind.json()).toMatchObject({ ok: false, error: "Unsupported delete scope: bogus" });
  });
});

async function createTestDaemon(): Promise<MastheadDaemon> {
  return (await createTestHarness()).daemon;
}

async function createTestHarness(): Promise<{ daemon: MastheadDaemon; databasePath: string; storePath: string; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-data-api-"));
  tempDirs.push(tempDir);
  const databasePath = join(tempDir, "masthead.sqlite");
  const storePath = join(tempDir, "events.ndjson");
  const daemon = await createMastheadDaemon({
    allowedOrigins: ["http://127.0.0.1:5173"],
    codexHomeDir: tempDir,
    databasePath,
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    hookTranscriptCatchupEnabled: false,
    llmCopyEnabled: false,
    port: 0,
    storePath
  } satisfies DaemonConfig);
  daemons.push(daemon);
  return { daemon, databasePath, storePath, tempDir };
}

function listen(daemon: MastheadDaemon): Promise<string> {
  return new Promise((resolve) => {
    daemon.server.listen(0, "127.0.0.1", () => {
      const address = daemon.server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function getJson(baseUrl: string, path: string): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, any>>;
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(202);
  return response.json() as Promise<Record<string, any>>;
}

async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

function liveApprovalPayload(providerEventId: string): Record<string, unknown> {
  return {
    provider_event_id: providerEventId,
    event: "approval_requested",
    session_id: "server-live",
    timestamp: "2026-06-23T03:30:00.000Z",
    cwd: "/workspace/masthead",
    repo_root: "/workspace/masthead",
    git_common_dir: "/workspace/masthead/.git",
    branch: "agent/server-live",
    project: "Masthead",
    title: "Server live projection",
    command_id: "cmd-server-live",
    blast_radius: "production",
    summary: "Server live approval"
  };
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
  ).run(
    `raw:${suffix}`,
    "source:codex",
    `${suffix}:1`,
    now,
    now,
    "jsonl",
    "/tmp/rollout.jsonl",
    `hash:${suffix}`,
    JSON.stringify({ payload: { session_id: `source-${suffix}` } })
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
