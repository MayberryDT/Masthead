import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, test } from "vitest";
import { getSessionTranscript, iterateSessionTranscriptItems } from "../sessionTranscriptRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { seedSession } from "./sessionTestHelpers.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("session transcript repository", () => {
  test("returns all canonical transcript items sorted by observed time and item id", async () => {
    const db = await openTestDatabase();
    seedTranscriptSession(db);

    const result = getSessionTranscript(db, { sessionId: "session-transcript", limit: 20 });

    expect(result.items.map((item) => item.itemId)).toEqual([
      "message:session-transcript:m1",
      "message:session-transcript:m2",
      "tool_call:session-transcript:tool-a",
      "tool_result:session-transcript:tool-result-a",
      "checkpoint:session-transcript:checkpoint",
      "file:session-transcript:file",
      "signal:session-transcript:signal",
      "message:session-transcript:m3"
    ]);
    expect(result.coverage).toMatchObject({
      assistantMessages: 1,
      checkpoints: 1,
      fileEffects: 1,
      hasUsableTranscript: true,
      lowValueItems: 2,
      messages: 3,
      runtimeSignals: 1,
      toolCalls: 1,
      toolResults: 1,
      userMessages: 2
    });
    expect(result.total).toBe(8);
    expect(result.nextCursor).toBeUndefined();
    db.close();
  });

  test("filters to user messages", async () => {
    const db = await openTestDatabase();
    seedTranscriptSession(db);

    const result = getSessionTranscript(db, { kind: "user", sessionId: "session-transcript" });

    expect(result.items.map((item) => item.role)).toEqual(["user", "user"]);
    expect(result.items.map((item) => item.text)).toEqual(["Implement transcript detail v2.", "Search for sqlite pagination."]);
    db.close();
  });

  test("filters to assistant messages", async () => {
    const db = await openTestDatabase();
    seedTranscriptSession(db);

    const result = getSessionTranscript(db, { kind: "assistant", sessionId: "session-transcript" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      itemId: "message:session-transcript:m3",
      role: "assistant",
      text: "Added the canonical transcript repository."
    });
    db.close();
  });

  test("filters to tool calls and tool results with collapsed output previews", async () => {
    const db = await openTestDatabase();
    seedTranscriptSession(db);

    const result = getSessionTranscript(db, { kind: "tools", sessionId: "session-transcript" });

    expect(result.items.map((item) => item.kind)).toEqual(["tool_call", "tool_result"]);
    expect(result.items[0]).toMatchObject({
      itemId: "tool_call:session-transcript:tool-a",
      label: "shell",
      lowValue: true,
      toolName: "shell"
    });
    expect(result.items[1].text).toHaveLength(800);
    expect(result.items[1]).toMatchObject({
      collapsedByDefault: true,
      itemId: "tool_result:session-transcript:tool-result-a",
      lowValue: false
    });
    db.close();
  });

  test("exposes complete redacted tool, runtime-signal, and file-effect content without splitting canonical rows", async () => {
    const db = await openTestDatabase();
    seedTranscriptSession(db);

    const result = getSessionTranscript(db, { sessionId: "session-transcript", limit: 20 });
    const toolCall = result.items.find((item) => item.kind === "tool_call");
    const fileEffect = result.items.find((item) => item.kind === "file_effect");
    const runtimeSignal = result.items.find((item) => item.kind === "runtime_signal");

    expect(toolCall).toMatchObject({
      argumentsRedacted: { command: "npm test -- --run transcript" },
      text: expect.stringContaining("npm test -- --run transcript")
    });
    expect(fileEffect).toMatchObject({
      additions: 41,
      deletions: 3,
      staged: true,
      text: expect.stringMatching(/staged.*41 additions.*3 deletions/)
    });
    expect(runtimeSignal).toMatchObject({
      details: { phase: "verification", testsPassed: 12 },
      text: expect.stringContaining("testsPassed")
    });
    expect(result.items).toHaveLength(8);
    expect(result.total).toBe(8);
    db.close();
  });

  test("filters by q across canonical text", async () => {
    const db = await openTestDatabase();
    seedTranscriptSession(db);

    const result = getSessionTranscript(db, { q: "sqlite", sessionId: "session-transcript" });

    expect(result.items.map((item) => item.itemId)).toEqual(["message:session-transcript:m2"]);
    db.close();
  });

  test("paginates with an offset cursor", async () => {
    const db = await openTestDatabase();
    seedTranscriptSession(db);

    const firstPage = getSessionTranscript(db, { limit: 3, sessionId: "session-transcript" });
    const secondPage = getSessionTranscript(db, { cursor: firstPage.nextCursor, limit: 3, sessionId: "session-transcript" });

    expect(firstPage.items.map((item) => item.itemId)).toEqual([
      "message:session-transcript:m1",
      "message:session-transcript:m2",
      "tool_call:session-transcript:tool-a"
    ]);
    expect(firstPage.nextCursor).toBe("3");
    expect(secondPage.items.map((item) => item.itemId)).toEqual([
      "tool_result:session-transcript:tool-result-a",
      "checkpoint:session-transcript:checkpoint",
      "file:session-transcript:file"
    ]);
    expect(secondPage.nextCursor).toBe("6");
    db.close();
  });

  test("supports descending pages while preserving ascending defaults and numeric cursors", async () => {
    const db = await openTestDatabase();
    seedTranscriptSession(db);

    const ascending = getSessionTranscript(db, { limit: 3, sessionId: "session-transcript" });
    const descending = getSessionTranscript(db, { limit: 3, order: "desc", sessionId: "session-transcript" });
    const nextDescending = getSessionTranscript(db, {
      cursor: descending.nextCursor,
      limit: 3,
      order: "desc",
      sessionId: "session-transcript"
    });

    expect(ascending.items.map((item) => item.itemId)).toEqual([
      "message:session-transcript:m1",
      "message:session-transcript:m2",
      "tool_call:session-transcript:tool-a"
    ]);
    expect(descending.items.map((item) => item.itemId)).toEqual([
      "message:session-transcript:m3",
      "signal:session-transcript:signal",
      "file:session-transcript:file"
    ]);
    expect(descending.nextCursor).toBe("3");
    expect(nextDescending.items.map((item) => item.itemId)).toEqual([
      "checkpoint:session-transcript:checkpoint",
      "tool_result:session-transcript:tool-result-a",
      "tool_call:session-transcript:tool-a"
    ]);
    expect(nextDescending.nextCursor).toBe("6");
    db.close();
  });

  test("marks low-value hook, runtime, shell, and unknown transcript rows without removing them", async () => {
    const db = await openTestDatabase();
    seedHookOnlySession(db);

    const result = getSessionTranscript(db, { sessionId: "session-hooks", limit: 20 });

    expect(result.items.map((item) => item.itemId)).toEqual([
      "message:session-hooks:hook",
      "message:session-hooks:unknown",
      "tool_call:session-hooks:tool",
      "signal:session-hooks:signal"
    ]);
    expect(result.items.every((item) => item.lowValue)).toBe(true);
    db.close();
  });

  test("reports unusable coverage for hook-only message transcripts", async () => {
    const db = await openTestDatabase();
    seedHookOnlySession(db);

    const result = getSessionTranscript(db, { sessionId: "session-hooks" });

    expect(result.coverage).toMatchObject({
      assistantMessages: 0,
      hasUsableTranscript: false,
      lowValueItems: 4,
      messages: 2,
      runtimeSignals: 1,
      toolCalls: 1,
      toolResults: 0,
      userMessages: 1
    });
    expect(result.total).toBe(4);
    db.close();
  });

  test("pages old tool-heavy transcripts without materializing every tool result body", async () => {
    const db = await openTestDatabase();
    seedToolHeavyTranscriptSession(db, 180);

    const startedAt = performance.now();
    const result = getSessionTranscript(db, { limit: 5, sessionId: "session-tool-heavy" });
    const elapsedMs = performance.now() - startedAt;

    expect(result.items).toHaveLength(5);
    expect(result.nextCursor).toBe("5");
    expect(result.total).toBe(360);
    expect(result.coverage).toMatchObject({
      toolCalls: 180,
      toolResults: 180
    });
    expect(elapsedMs).toBeLessThan(150);

    const completeItems = [...iterateSessionTranscriptItems(db, { order: "asc", sessionId: "session-tool-heavy" })];
    expect(completeItems).toHaveLength(360);
    expect(completeItems.find((item) => item.kind === "tool_result")?.text.length).toBeGreaterThan(800);
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-session-transcript-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedTranscriptSession(db: MastheadDatabase): void {
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId: "session-transcript",
    title: "Transcript detail"
  });
  clearCanonicalRows(db, "session-transcript");
  insertMessage(db, "session-transcript", "m2", "user", "Search for sqlite pagination.", "2026-06-26T12:01:00.000Z");
  insertMessage(db, "session-transcript", "m1", "user", "Implement transcript detail v2.", "2026-06-26T12:00:00.000Z");
  insertMessage(db, "session-transcript", "m3", "assistant", "Added the canonical transcript repository.", "2026-06-26T12:06:00.000Z");
  db.prepare(
    "INSERT INTO tool_calls (tool_call_id, session_id, tool_name, arguments_redacted_json, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    "session-transcript:tool-a",
    "session-transcript",
    "shell",
    JSON.stringify({ command: "npm test -- --run transcript" }),
    "2026-06-26T12:02:00.000Z",
    "{}"
  );
  db.prepare(
    `INSERT INTO tool_results (
      tool_result_id, tool_call_id, session_id, status, output_redacted, output_hash, exit_code, completed_at, source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "session-transcript:tool-result-a",
    "session-transcript:tool-a",
    "session-transcript",
    "succeeded",
    longOutput(),
    "hash",
    0,
    "2026-06-26T12:03:00.000Z",
    "{}"
  );
  db.prepare("INSERT INTO checkpoints (checkpoint_id, session_id, checkpoint_kind, summary, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)").run(
    "session-transcript:checkpoint",
    "session-transcript",
    "summary",
    "Repository implemented.",
    "2026-06-26T12:04:00.000Z",
    "{}"
  );
  db.prepare(
    "INSERT INTO file_effects (file_effect_id, session_id, path, effect_kind, staged, additions, deletions, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    "session-transcript:file",
    "session-transcript",
    "src/daemon/db/sessionTranscriptRepository.ts",
    "created",
    1,
    41,
    3,
    "2026-06-26T12:05:00.000Z",
    "{}"
  );
  db.prepare("INSERT INTO runtime_signals (signal_id, session_id, signal_kind, severity, title, details_json, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "session-transcript:signal",
    "session-transcript",
    "progress",
    "info",
    "Runtime signal",
    JSON.stringify({ phase: "verification", testsPassed: 12 }),
    "2026-06-26T12:05:00.000Z",
    "{}"
  );
}

function seedHookOnlySession(db: MastheadDatabase): void {
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId: "session-hooks",
    title: "Hook only"
  });
  clearCanonicalRows(db, "session-hooks");
  insertMessage(db, "session-hooks", "hook", "user", "Codex hook event: session started", "2026-06-26T13:00:00.000Z");
  insertMessage(db, "session-hooks", "unknown", "unknown", "unknown", "2026-06-26T13:01:00.000Z");
  db.prepare("INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)").run(
    "session-hooks:tool",
    "session-hooks",
    "tool call",
    "2026-06-26T13:02:00.000Z",
    "{}"
  );
  db.prepare("INSERT INTO runtime_signals (signal_id, session_id, signal_kind, severity, title, details_json, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "session-hooks:signal",
    "session-hooks",
    "runtime_signal",
    "info",
    "runtime signal",
    "{}",
    "2026-06-26T13:03:00.000Z",
    "{}"
  );
}

function seedToolHeavyTranscriptSession(db: MastheadDatabase, count: number): void {
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId: "session-tool-heavy",
    title: "Tool heavy"
  });
  clearCanonicalRows(db, "session-tool-heavy");
  const output = Array.from({ length: 2600 }, (_, index) => `tool result output line ${index}`).join("\n");
  const insertTool = db.prepare("INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)");
  const insertResult = db.prepare(
    `INSERT INTO tool_results (
      tool_result_id, tool_call_id, session_id, status, output_redacted, output_hash, exit_code, completed_at, source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let index = 0; index < count; index += 1) {
    const padded = String(index).padStart(4, "0");
    const toolCallId = `session-tool-heavy:tool-${padded}`;
    const observedAt = `2026-06-26T14:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`;
    insertTool.run(toolCallId, "session-tool-heavy", "shell", observedAt, "{}");
    insertResult.run(
      `session-tool-heavy:tool-result-${padded}`,
      toolCallId,
      "session-tool-heavy",
      "succeeded",
      output,
      `hash-${padded}`,
      0,
      observedAt,
      "{}"
    );
  }
}

function clearCanonicalRows(db: MastheadDatabase, sessionId: string): void {
  db.prepare("DELETE FROM runtime_signals WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM checkpoints WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM file_effects WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM tool_results WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
}

function insertMessage(db: MastheadDatabase, sessionId: string, id: string, role: string, text: string, observedAt: string): void {
  db.prepare(
    `INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`${sessionId}:${id}`, sessionId, role, text, `${sessionId}:${id}:hash`, observedAt, JSON.stringify({ id }), "authoritative");
}

function longOutput(): string {
  return Array.from({ length: 90 }, (_, index) => `line ${index} passed`).join("\n");
}
