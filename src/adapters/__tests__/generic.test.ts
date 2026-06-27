import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { parseJsonlLines, readJsonlFile } from "../generic/jsonl.ts";
import { inspectSqliteDatabase } from "../generic/sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("generic JSONL utilities", () => {
  test("parses valid records and reports malformed lines", () => {
    const result = parseJsonlLines('{"kind":"session"}\nnot json\n\n{"kind":"event"}\n', {
      observedAt: "2026-06-27T12:00:00.000Z",
      sourcePath: "/tmp/runtime/history.jsonl"
    });

    expect(result.records).toEqual([
      expect.objectContaining({ byteOffset: 0, lineNumber: 1, value: { kind: "session" } }),
      expect.objectContaining({ lineNumber: 4, value: { kind: "event" } })
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "jsonl_malformed_line",
        severity: "warning",
        details: expect.stringContaining("line 2")
      })
    ]);
  });

  test("reads a JSONL file through the same parser", async () => {
    const tempDir = await makeTempDir("masthead-jsonl-");
    const path = join(tempDir, "events.jsonl");
    await writeFile(path, '{"id":"one"}\n{"id":"two"}\n', "utf8");

    const result = await readJsonlFile(path, "2026-06-27T12:00:00.000Z");

    expect(result.records.map((record) => record.value)).toEqual([{ id: "one" }, { id: "two" }]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("generic SQLite utilities", () => {
  test("inspects tables without mutating the database", async () => {
    const tempDir = await makeTempDir("masthead-sqlite-");
    const databasePath = join(tempDir, "runtime.sqlite");
    const db = new DatabaseSync(databasePath);
    db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY); INSERT INTO sessions (id) VALUES ('one');");
    db.close();

    const result = inspectSqliteDatabase(databasePath, "2026-06-27T12:00:00.000Z");

    expect(result).toMatchObject({
      ok: true,
      path: databasePath,
      tables: ["sessions"]
    });
    expect(result.diagnostics).toEqual([]);
  });

  test("returns diagnostics for unreadable SQLite candidates", async () => {
    const tempDir = await makeTempDir("masthead-sqlite-invalid-");
    const databasePath = join(tempDir, "runtime.sqlite");
    await writeFile(databasePath, "not sqlite", "utf8");

    const result = inspectSqliteDatabase(databasePath, "2026-06-27T12:00:00.000Z");

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "sqlite_inspect_failed",
        severity: "warning"
      })
    ]);
  });
});

async function makeTempDir(prefix: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}
