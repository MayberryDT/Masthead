import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { adapterForRuntime } from "../../../adapters/registry.ts";
import type { DiscoveredSource, RuntimeKind } from "../../../adapters/types.ts";
import { indexCanonicalSessionSearch, searchSessions } from "../../db/searchRepository.ts";
import { migrateDatabase } from "../../db/schema.ts";
import { ingestAdapterRecord } from "../../db/sessionRepository.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../db/sqlite.ts";
import { markWorkbenchPublished } from "../../db/workbenchPipelineRepository.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("multi-adapter import", () => {
  test("imports recognized records from all active adapters into canonical sessions and search", async () => {
    const { db, tempDir } = await openImportTestDatabase("masthead-multi-adapter-import-");
    const sources = await fixtureSources(tempDir);

    for (const source of sources) {
      const adapter = adapterForRuntime(source.runtime);
      expect(adapter, source.runtime).toBeDefined();
      for await (const record of adapter!.backfill(source)) {
        const { sessionId } = ingestAdapterRecord(db, record, {
          hostId: "host:test",
          hostname: "masthead-test",
          runtimeKind: source.runtime
        });
        if (sessionId) {
          markWorkbenchPublished(db, {
            actor: { kind: "system", id: "test" },
            publishedVia: "test",
            sessionId
          });
          indexCanonicalSessionSearch(db, sessionId);
        }
      }
    }

    const rows = db
      .prepare(
        `SELECT runtimes.runtime_kind AS runtime, COUNT(DISTINCT sessions.session_id) AS sessions, COUNT(messages.message_id) AS messages
        FROM sessions
        JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
        LEFT JOIN messages ON messages.session_id = sessions.session_id
        GROUP BY runtimes.runtime_kind
        ORDER BY runtimes.runtime_kind`
      )
      .all() as Array<{ messages: number; runtime: string; sessions: number }>;

    expect(rows).toEqual(
      expect.arrayContaining(
        ["codex", "cursor", "claude_code", "opencode", "grok", "hermes", "pi", "omp"].map((runtime) =>
          expect.objectContaining({ messages: 2, runtime, sessions: 1 })
        )
      )
    );
    expect(searchSessions(db, { limit: 20, query: "assistant reply" }).total).toBeGreaterThanOrEqual(7);
    db.close();
  });

  test("records unrecognized adapter diagnostics without creating fake transcript sessions", async () => {
    const { db, tempDir } = await openImportTestDatabase("masthead-multi-adapter-diagnostics-");
    const path = join(tempDir, "unrecognized.vscdb");
    const sqlite = new DatabaseSync(path);
    sqlite.exec("CREATE TABLE UnknownState (id TEXT PRIMARY KEY, value TEXT); INSERT INTO UnknownState VALUES ('one', 'not-json');");
    sqlite.close();
    const source = makeSource("cursor", path, "sqlite");
    const adapter = adapterForRuntime("cursor")!;

    let diagnostics = 0;
    for await (const record of adapter.backfill(source)) {
      diagnostics += record.diagnostics.length;
      const { sessionId } = ingestAdapterRecord(db, record, {
        hostId: "host:test",
        hostname: "masthead-test",
        runtimeKind: source.runtime
      });
      expect(sessionId).toBeUndefined();
    }

    expect(diagnostics).toBeGreaterThan(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM raw_events").get()).toEqual({ count: 1 });
    db.close();
  });
});

async function openImportTestDatabase(prefix: string): Promise<{ db: MastheadDatabase; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return { db, tempDir };
}

async function fixtureSources(tempDir: string): Promise<DiscoveredSource[]> {
  const sources: DiscoveredSource[] = [];
  sources.push(await codexJsonlSource(tempDir));
  sources.push(await sqliteJsonSource(tempDir, "cursor", "cursor.vscdb"));
  sources.push(await jsonlSource(tempDir, "claude_code"));
  sources.push(await jsonlSource(tempDir, "opencode"));
  sources.push(await jsonlSource(tempDir, "grok"));
  sources.push(await sqliteRowsSource(tempDir, "hermes", "hermes.db"));
  sources.push(await jsonlSource(tempDir, "pi"));
  sources.push(await ompJsonlSource(tempDir));
  return sources;
}

async function codexJsonlSource(tempDir: string): Promise<DiscoveredSource> {
  const path = join(tempDir, "codex.jsonl");
  await writeFile(
    path,
    [
      JSON.stringify({ type: "session_meta", timestamp: "2026-06-27T10:00:00.000Z", payload: { id: "codex-session", cwd: tempDir } }),
      JSON.stringify({ type: "response_item", timestamp: "2026-06-27T10:00:01.000Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "codex user prompt" }] } }),
      JSON.stringify({ type: "response_item", timestamp: "2026-06-27T10:00:02.000Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "codex assistant reply" }] } })
    ].join("\n") + "\n",
    "utf8"
  );
  return makeSource("codex", path, "jsonl", "codex-rollout-jsonl");
}

async function jsonlSource(tempDir: string, runtime: RuntimeKind, schemaVersion?: string): Promise<DiscoveredSource> {
  const path = join(tempDir, `${runtime}.jsonl`);
  const sessionId = `${runtime}-session`;
  await writeFile(
    path,
    [
      JSON.stringify({ content: `${runtime} user prompt`, role: "user", sessionId, timestamp: "2026-06-27T10:00:00.000Z" }),
      JSON.stringify({ content: `${runtime} assistant reply`, role: "assistant", sessionId, timestamp: "2026-06-27T10:01:00.000Z" })
    ].join("\n") + "\n",
    "utf8"
  );
  return makeSource(runtime, path, "jsonl", schemaVersion);
}


async function ompJsonlSource(tempDir: string): Promise<DiscoveredSource> {
  const path = join(tempDir, "2026-06-27T10-00-00-000Z_omp-session.jsonl");
  await writeFile(
    path,
    [
      JSON.stringify({ cwd: tempDir, timestamp: "2026-06-27T10:00:00.000Z", title: "OMP fixture", type: "session" }),
      JSON.stringify({ message: { content: [{ text: "omp user prompt", type: "text" }], role: "user", timestamp: "2026-06-27T10:00:00.000Z" }, timestamp: "2026-06-27T10:00:00.000Z", type: "message" }),
      JSON.stringify({ message: { content: [{ text: "omp assistant reply", type: "text" }], role: "assistant", timestamp: "2026-06-27T10:01:00.000Z" }, timestamp: "2026-06-27T10:01:00.000Z", type: "message" })
    ].join("\n") + "\n",
    "utf8"
  );
  return makeSource("omp", path, "jsonl", "omp-jsonl-tree");
}

async function sqliteJsonSource(tempDir: string, runtime: RuntimeKind, name: string): Promise<DiscoveredSource> {
  const path = join(tempDir, name);
  const sessionId = `${runtime}-session`;
  const sqlite = new DatabaseSync(path);
  sqlite.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);");
  sqlite
    .prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)")
    .run(
      "conversation",
      JSON.stringify({
        conversationId: sessionId,
        messages: [
          { content: `${runtime} user prompt`, role: "user" },
          { content: `${runtime} assistant reply`, role: "assistant" }
        ]
      })
    );
  sqlite.close();
  return makeSource(runtime, path, "sqlite", `${runtime}-sqlite`);
}

async function sqliteRowsSource(tempDir: string, runtime: RuntimeKind, name: string): Promise<DiscoveredSource> {
  const path = join(tempDir, name);
  const sessionId = `${runtime}-session`;
  const sqlite = new DatabaseSync(path);
  sqlite.exec("CREATE TABLE messages (session_id TEXT, role TEXT, content TEXT, timestamp TEXT);");
  sqlite
    .prepare("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)")
    .run(sessionId, "user", `${runtime} user prompt`, "2026-06-27T10:00:00.000Z");
  sqlite
    .prepare("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)")
    .run(sessionId, "assistant", `${runtime} assistant reply`, "2026-06-27T10:01:00.000Z");
  sqlite.close();
  return makeSource(runtime, path, "sqlite", `${runtime}-sqlite`);
}

function makeSource(runtime: RuntimeKind, path: string, sourceKind: DiscoveredSource["sourceKind"], schemaVersion?: string): DiscoveredSource {
  return {
    confidence: "heuristic",
    path,
    runtime,
    schemaVersion,
    sourceId: `${runtime}:${path}`,
    sourceKind
  };
}
