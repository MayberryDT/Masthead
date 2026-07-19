import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { opencodeAdapter } from "../opencode/adapter.ts";
import type { AdapterRecord, DiscoveredSource } from "../types.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("OpenCode adapter", () => {
  test("normalizes the current relational OpenCode SQLite session, message, and part schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-opencode-adapter-"));
    tempDirs.push(root);
    const path = join(root, "opencode.db");
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
    db.exec(
      "CREATE TABLE session (id TEXT, project_id TEXT, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER);" +
      "CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);" +
      "CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);"
    );
    db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)").run("ses_sanitized", "project-1", "/workspace/example", "Sanitized title", 1_752_840_000_000, 1_752_840_002_000);
    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run("msg_user", "ses_sanitized", 1_752_840_001_000, 1_752_840_001_000, JSON.stringify({ role: "user", time: { created: 1_752_840_001_000 } }));
    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run("msg_assistant", "ses_sanitized", 1_752_840_002_000, 1_752_840_002_000, JSON.stringify({ role: "assistant", modelID: "model-sanitized", providerID: "provider-sanitized", tokens: { input: 8, output: 3 } }));
    db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run("part_user", "msg_user", "ses_sanitized", 1_752_840_001_000, 1_752_840_001_000, JSON.stringify({ type: "text", text: "Sanitized prompt" }));
    db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run("part_assistant", "msg_assistant", "ses_sanitized", 1_752_840_002_000, 1_752_840_002_000, JSON.stringify({ type: "text", text: "Sanitized answer" }));

    const [unit] = await opencodeAdapter.planTranscriptUnits(sqliteSource(path));
    expect(unit).toMatchObject({
      modifiedAt: "2025-07-18T12:00:02.000Z",
      semanticActivityAt: "2025-07-18T12:00:02.000Z",
      sourceSessionId: "ses_sanitized",
      timestampBasis: "semantic"
    });
    const parsed = await opencodeAdapter.parseTranscriptUnit(unit);
    db.close();

    expect(parsed.completeness).toBe("complete");
    expect(parsed.sourceSessionIds).toEqual(["ses_sanitized"]);
    expect(parsed.records.map((record) => record.normalized.kind)).toEqual(["session", "message", "message", "usage"]);
    expect(parsed.records.map(value)).toContainEqual(expect.objectContaining({ project: "example", title: "Sanitized title" }));
    expect(parsed.records.map(value)).toContainEqual(expect.objectContaining({ model: "model-sanitized", provider: "provider-sanitized" }));
  });

  test("discovers the OpenCode database instead of empty session-diff JSON placeholders", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "masthead-opencode-discovery-"));
    tempDirs.push(homeDir);
    const root = join(homeDir, ".local", "share", "opencode");
    await mkdir(join(root, "storage", "session_diff"), { recursive: true });
    await writeFile(join(root, "opencode.db"), "fixture");
    await writeFile(join(root, "storage", "session_diff", "ses_placeholder.json"), "{}");

    const sources = await opencodeAdapter.discover({ exclusions: [], homeDir, now: "2026-07-18T00:00:00.000Z" });
    expect(sources.map((source) => source.path)).toEqual([join(root, "opencode.db")]);
  });

  test("normalizes a completed current-schema tool part as a call and its result", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-opencode-tool-part-"));
    tempDirs.push(root);
    const path = join(root, "opencode.db");
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE session (id TEXT, directory TEXT, title TEXT, time_created INTEGER);" +
      "CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);" +
      "CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);"
    );
    db.prepare("INSERT INTO session VALUES (?, ?, ?, ?)").run("ses_tool", "/workspace/example", "Tool session", 1_752_840_000_000);
    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("msg_tool", "ses_tool", 1_752_840_001_000, JSON.stringify({ role: "assistant" }));
    db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run("part_tool", "msg_tool", "ses_tool", 1_752_840_001_000, JSON.stringify({
      callID: "call-sanitized",
      state: {
        input: { path: "README.md" },
        metadata: {},
        output: "Sanitized file contents",
        status: "completed",
        time: { end: 1_752_840_001_500, start: 1_752_840_001_100 },
        title: "Read README"
      },
      tool: "read",
      type: "tool"
    }));
    db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run("part_tool_error", "msg_tool", "ses_tool", 1_752_840_002_000, JSON.stringify({
      callID: "call-error",
      state: {
        error: "Sanitized command failure",
        input: { command: "false" },
        metadata: {},
        status: "error",
        time: { end: 1_752_840_002_500, start: 1_752_840_002_100 }
      },
      tool: "bash",
      type: "tool"
    }));

    const [unit] = await opencodeAdapter.planTranscriptUnits(sqliteSource(path));
    const parsed = await opencodeAdapter.parseTranscriptUnit(unit);
    db.close();

    expect(parsed.completeness).toBe("complete");
    expect(parsed.records.map((record) => record.normalized.kind)).toEqual(["session", "tool_call", "tool_result", "tool_call", "tool_result"]);
    expect(parsed.records.map(value)).toEqual(expect.arrayContaining([
      expect.objectContaining({ arguments: { path: "README.md" }, callId: "call-sanitized", toolName: "read" }),
      expect.objectContaining({ callId: "call-sanitized", output: "Sanitized file contents", status: "succeeded" }),
      expect.objectContaining({ callId: "call-error", output: "Sanitized command failure", status: "failed" })
    ]));
  });

  test("preserves known non-text parts and diagnoses an unknown part type", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-opencode-non-text-parts-"));
    tempDirs.push(root);
    const path = join(root, "opencode.db");
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE session (id TEXT, directory TEXT, title TEXT, time_created INTEGER);" +
      "CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);" +
      "CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);"
    );
    db.prepare("INSERT INTO session VALUES (?, ?, ?, ?)").run("ses_parts", "/workspace/example", "Parts session", 1_752_840_000_000);
    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run("msg_parts", "ses_parts", 1_752_840_001_000, JSON.stringify({ role: "assistant" }));
    const insertPart = db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)");
    insertPart.run("part_reasoning", "msg_parts", "ses_parts", 1_752_840_001_000, JSON.stringify({ text: "Sanitized reasoning", type: "reasoning" }));
    insertPart.run("part_finish", "msg_parts", "ses_parts", 1_752_840_002_000, JSON.stringify({ reason: "stop", type: "step-finish" }));
    insertPart.run("part_future", "msg_parts", "ses_parts", 1_752_840_003_000, JSON.stringify({ type: "future-part" }));

    const [unit] = await opencodeAdapter.planTranscriptUnits(sqliteSource(path));
    const parsed = await opencodeAdapter.parseTranscriptUnit(unit);
    db.close();

    expect(parsed.completeness).toBe("partial");
    expect(parsed.records.map((record) => record.normalized.kind)).toEqual(["session", "checkpoint", "runtime_signal", "runtime_signal"]);
    expect(parsed.diagnostics).toEqual([expect.objectContaining({ code: "opencode_part_type_unrecognized", severity: "warning" })]);
  });
});

function sqliteSource(path: string): DiscoveredSource {
  return { confidence: "heuristic", path, runtime: "opencode", schemaVersion: "opencode-sqlite", sourceId: `opencode:${path}`, sourceKind: "sqlite" };
}

function value(record: AdapterRecord): Record<string, unknown> {
  return record.normalized.value as Record<string, unknown>;
}
