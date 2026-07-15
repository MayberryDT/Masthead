import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { ingestAdapterRecord } from "../../daemon/db/sessionRepository.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";
import { hermesAdapter } from "../hermes/adapter.ts";
import type { AdapterRecord, DiscoveredSource } from "../types.ts";

const tempDirs: string[] = [];
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__");

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Hermes adapter", () => {
  test("imports whole-session JSON files with message arrays", async () => {
    const tempDir = await makeTempDir();
    const path = join(tempDir, "session_20260414_084123_d48bd1.json");
    await writeFile(
      path,
      JSON.stringify({
        session_id: "20260414_084123_d48bd1",
        session_start: "2026-04-14T08:41:23.000Z",
        last_updated: "2026-04-14T08:42:21.000Z",
        model: "gpt-5.4",
        messages: [
          { content: "Hermes user prompt", role: "user", timestamp: "2026-04-14T08:41:24.000Z" },
          { content: "Hermes assistant reply", role: "assistant", timestamp: "2026-04-14T08:41:30.000Z" }
        ]
      }),
      "utf8"
    );

    const records = await collect(hermesAdapter.backfill(source(path)));

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.diagnostics)).toEqual([[], []]);
    expect(records.map((record) => messageValue(record))).toEqual([
      expect.objectContaining({ role: "user", sessionId: "20260414_084123_d48bd1", text: "Hermes user prompt" }),
      expect.objectContaining({ role: "assistant", sessionId: "20260414_084123_d48bd1", text: "Hermes assistant reply" })
    ]);
  });

  test("imports Hermes JSONL message rows by inferring the session id from the file name", async () => {
    const tempDir = await makeTempDir();
    const path = join(tempDir, "20260515_165544_9d511138.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({ model: "gpt-5.4", platform: "cli", role: "session_meta", timestamp: "2026-05-15T16:55:49.000Z" }),
        JSON.stringify({ content: "Hermes JSONL user prompt", role: "user", timestamp: "2026-05-15T16:55:50.000Z" }),
        JSON.stringify({ content: "Hermes JSONL assistant reply", role: "assistant", timestamp: "2026-05-15T16:55:51.000Z" })
      ].join("\n") + "\n",
      "utf8"
    );

    const records = await collect(hermesAdapter.backfill(source(path)));

    expect(records.filter((record) => record.normalized.kind === "message").map((record) => messageValue(record))).toEqual([
      expect.objectContaining({ role: "user", sessionId: "20260515_165544_9d511138", text: "Hermes JSONL user prompt" }),
      expect.objectContaining({ role: "assistant", sessionId: "20260515_165544_9d511138", text: "Hermes JSONL assistant reply" })
    ]);
    expect(records.flatMap((record) => record.diagnostics)).toEqual([]);
  });

  test("normalizes Hermes tool-role rows as tool calls and results", async () => {
    const [unit] = await hermesAdapter.planTranscriptUnits(hermesFixtureSource());
    const parsed = await hermesAdapter.parseTranscriptUnit(unit);

    expect(parsed.records.filter((record) => record.normalized.kind === "message")).toHaveLength(3);
    expect(parsed.records.filter((record) => record.normalized.kind === "tool_call")).toHaveLength(1);
    expect(parsed.records.filter((record) => record.normalized.kind === "tool_result")).toHaveLength(1);
    expect(parsed.sourceSessionIds).toEqual(["20260710_100000_fixture"]);
  });

  test("merges JSONL and SQLite evidence under one canonical Hermes session without double counting", async () => {
    const tempDir = await makeTempDir();
    const jsonlPath = join(tempDir, "session_20260710_100000_fixture.jsonl");
    const sqlitePath = join(tempDir, "state.db");
    const observedAt = "2026-07-10T10:00:01.000Z";
    await writeFile(jsonlPath, JSON.stringify({ content: "Repair the parser.", role: "user", timestamp: observedAt }) + "\n", "utf8");
    const sqlite = new DatabaseSync(sqlitePath);
    sqlite.exec("CREATE TABLE messages (session_id TEXT, role TEXT, content TEXT, timestamp REAL);");
    sqlite
      .prepare("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)")
      .run("20260710_100000_fixture", "user", "Repair the parser.", Date.parse(observedAt) / 1_000);
    sqlite.close();
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);

    for (const candidate of [source(jsonlPath), sqliteSource(sqlitePath)]) {
      for await (const record of hermesAdapter.backfill(candidate)) {
        ingestAdapterRecord(db, record, {
          hostId: "host:test",
          hostname: "masthead-test",
          runtimeKind: "hermes"
        });
      }
    }

    expect(db.prepare("SELECT source_session_id AS sourceSessionId FROM sessions").all()).toEqual([
      { sourceSessionId: "20260710_100000_fixture" }
    ]);
    expect(db.prepare("SELECT role, text_redacted AS text FROM messages").all()).toEqual([{ role: "user", text: "Repair the parser." }]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM raw_events").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_sources").get()).toEqual({ count: 2 });
    db.close();
  });

  test("plans recent Hermes activity from session semantics before filename or file mtime", async () => {
    const tempDir = await makeTempDir();
    const path = join(tempDir, "session_20260710_100000_fixture.json");
    await writeFile(
      path,
      JSON.stringify({
        last_updated: "2026-07-11T12:30:00.000Z",
        messages: [{ content: "Later message", role: "assistant", timestamp: "2026-07-12T09:00:00.000Z" }],
        session_id: "20260710_100000_fixture"
      }),
      "utf8"
    );

    const [unit] = await hermesAdapter.planTranscriptUnits(source(path));

    expect(unit).toEqual(
      expect.objectContaining({
        semanticActivityAt: "2026-07-11T12:30:00.000Z",
        sourceSessionId: "20260710_100000_fixture",
        timestampBasis: "semantic"
      })
    );
  });

  test("normalizes SQLite assistant tool_calls and links following tool results", async () => {
    const tempDir = await makeTempDir();
    const sqlitePath = join(tempDir, "state.db");
    const sqlite = new DatabaseSync(sqlitePath);
    sqlite.exec(
      "CREATE TABLE messages (session_id TEXT, role TEXT, content TEXT, record TEXT, tool_call_id TEXT, timestamp REAL);"
    );
    sqlite
      .prepare("INSERT INTO messages (session_id, role, record, tool_call_id, timestamp) VALUES (?, ?, ?, ?, ?)")
      .run(
        "20260710_100000_fixture",
        "assistant",
        JSON.stringify({
          content: "I will inspect the adapter.",
          tool_calls: [
            {
              function: { arguments: JSON.stringify({ path: "src/adapters/hermes/adapter.ts" }), name: "read_file" },
              id: "tool_sqlite_001",
              type: "function"
            }
          ]
        }),
        null,
        1_783_677_603
      );
    sqlite
      .prepare("INSERT INTO messages (session_id, role, content, tool_call_id, timestamp) VALUES (?, ?, ?, ?, ?)")
      .run("20260710_100000_fixture", "tool", "sanitized adapter source", "tool_sqlite_001", 1_783_677_604);
    sqlite.close();

    const parsedRecords = await collect(hermesAdapter.backfill(sqliteSource(sqlitePath)));
    expect(parsedRecords.filter((record) => record.normalized.kind === "message")).toHaveLength(1);
    expect(parsedRecords.filter((record) => record.normalized.kind === "tool_call").map(normalizedValue)).toEqual([
      expect.objectContaining({ callId: "tool_sqlite_001", toolName: "read_file" })
    ]);
    expect(parsedRecords.filter((record) => record.normalized.kind === "tool_result").map(normalizedValue)).toEqual([
      expect.objectContaining({ callId: "tool_sqlite_001", output: "sanitized adapter source" })
    ]);

    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    for (const record of parsedRecords) {
      ingestAdapterRecord(db, record, { hostId: "host:test", hostname: "masthead-test", runtimeKind: "hermes" });
    }
    expect(db.prepare("SELECT COUNT(*) AS count FROM tool_calls").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM tool_results").get()).toEqual({ count: 1 });
    db.close();
  });

  test("imports Hermes SQLite rows beyond the 5,000-row page boundary", async () => {
    const tempDir = await makeTempDir();
    const sqlitePath = join(tempDir, "state.db");
    const sqlite = new DatabaseSync(sqlitePath);
    sqlite.exec("CREATE TABLE messages (session_id TEXT, role TEXT, content TEXT, timestamp REAL);");
    const insert = sqlite.prepare("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)");
    sqlite.exec("BEGIN");
    for (let index = 0; index < 5_001; index += 1) {
      insert.run("20260710_100000_fixture", "user", `Sanitized message ${index}`, 1_783_677_600 + index);
    }
    sqlite.exec("COMMIT");
    sqlite.close();

    const records = await collect(hermesAdapter.backfill(sqliteSource(sqlitePath)));

    expect(records.filter((record) => record.normalized.kind === "message")).toHaveLength(5_001);
    expect(records.map(normalizedValue)).toContainEqual(expect.objectContaining({ text: "Sanitized message 5000" }));
  });

  test("plans SQLite activity from numeric session started_at and ended_at", async () => {
    const tempDir = await makeTempDir();
    const sqlitePath = join(tempDir, "state.db");
    const sqlite = new DatabaseSync(sqlitePath);
    sqlite.exec("CREATE TABLE sessions (session_id TEXT, started_at REAL, ended_at REAL);");
    sqlite
      .prepare("INSERT INTO sessions (session_id, started_at, ended_at) VALUES (?, ?, ?)")
      .run("20260710_100000_fixture", 1_783_677_600, 1_783_677_699_000);
    sqlite.close();

    const [unit] = await hermesAdapter.planTranscriptUnits(sqliteSource(sqlitePath));

    expect(unit).toEqual(
      expect.objectContaining({
        semanticActivityAt: "2026-07-10T10:01:39.000Z",
        sourceSessionId: "20260710_100000_fixture",
        timestampBasis: "semantic"
      })
    );
  });

  test("discovers Hermes session files without crawling request dumps or logs", async () => {
    const homeDir = await makeTempDir();
    const sessionsDir = join(homeDir, ".hermes", "sessions");
    const logsDir = join(homeDir, ".hermes", "logs", "curator", "run");
    await mkdir(sessionsDir, { recursive: true });
    await mkdir(logsDir, { recursive: true });
    await writeFile(join(sessionsDir, "session_20260414_084123_d48bd1.json"), "{}", "utf8");
    await writeFile(join(sessionsDir, "20260414_084123_d48bd1.jsonl"), "{}", "utf8");
    await writeFile(join(sessionsDir, "request_dump_20260414_084123_d48bd1.json"), "{}", "utf8");
    await writeFile(join(sessionsDir, "sessions.json"), "{}", "utf8");
    await writeFile(join(logsDir, "run.json"), "{}", "utf8");

    const sources = await hermesAdapter.discover({
      exclusions: [],
      homeDir,
      now: "2026-07-02T00:00:00.000Z"
    });

    expect(sources.map((candidate) => candidate.path)).toEqual([join(sessionsDir, "20260414_084123_d48bd1.jsonl")]);
  });
});

async function makeTempDir(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-hermes-adapter-"));
  tempDirs.push(tempDir);
  return tempDir;
}

function source(path: string): DiscoveredSource {
  return {
    confidence: "heuristic",
    path,
    runtime: "hermes",
    schemaVersion: "hermes-jsonl-tree",
    sourceId: `hermes:${path}`,
    sourceKind: "jsonl"
  };
}

function hermesFixtureSource(): DiscoveredSource {
  const path = join(fixturesDir, "hermes", "session.jsonl");
  return {
    ...source(path),
    sourceSessionId: "20260710_100000_fixture"
  };
}

function sqliteSource(path: string): DiscoveredSource {
  return {
    confidence: "heuristic",
    path,
    runtime: "hermes",
    schemaVersion: "hermes-sqlite-file",
    sourceId: `hermes:${path}`,
    sourceKind: "sqlite"
  };
}

async function collect(records: AsyncIterable<AdapterRecord>): Promise<AdapterRecord[]> {
  const output: AdapterRecord[] = [];
  for await (const record of records) output.push(record);
  return output;
}

function messageValue(record: AdapterRecord): Record<string, unknown> {
  expect(record.normalized.kind).toBe("message");
  return record.normalized.value as Record<string, unknown>;
}

function normalizedValue(record: AdapterRecord): Record<string, unknown> {
  return record.normalized.value as Record<string, unknown>;
}
