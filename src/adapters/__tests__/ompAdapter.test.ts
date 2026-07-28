import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { ingestAdapterRecord } from "../../daemon/db/sessionRepository.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";
import { runCaptureQualityPrecheck } from "../../workbench/qualityPrecheck.ts";
import { ompAdapter } from "../omp/adapter.ts";
import type { AdapterRecord, DiscoveredSource } from "../types.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Oh My Pi adapter", () => {
  test("imports OMP JSONL message rows by inferring the session id from the file name", async () => {
    const tempDir = await makeTempDir();
    const path = join(tempDir, "2026-06-25T20-55-39-024Z_019f0091-2110-7000-a1e2-147639fff216.jsonl");
    await writeFile(path, basicOmpTranscriptJsonl(), "utf8");

    const records = await collect(ompAdapter.backfill(source(path)));

    expect(records.map((record) => record.diagnostics)).toEqual([[], [], [], [], []]);
    expect(records.map((record) => record.normalized.kind)).toEqual(["session", "message", "message", "tool_call", "tool_result"]);
    expect(records.filter((record) => record.normalized.kind === "message").map((record) => messageValue(record))).toEqual([
      expect.objectContaining({ role: "user", sessionId: "2026-06-25T20-55-39-024Z_019f0091-2110-7000-a1e2-147639fff216", text: "OMP user prompt" }),
      expect.objectContaining({ role: "assistant", sessionId: "2026-06-25T20-55-39-024Z_019f0091-2110-7000-a1e2-147639fff216", text: "OMP assistant reply" })
    ]);
    expect(records.find((record) => record.normalized.kind === "tool_result")?.normalized.value).toEqual(
      expect.objectContaining({ output: "OMP tool result", sessionId: "2026-06-25T20-55-39-024Z_019f0091-2110-7000-a1e2-147639fff216", status: "succeeded" })
    );
    expect(records.find((record) => record.normalized.kind === "tool_call")?.normalized.value).toEqual(
      expect.objectContaining({ callId: "call-1", sessionId: "2026-06-25T20-55-39-024Z_019f0091-2110-7000-a1e2-147639fff216", toolName: "read" })
    );
  });

  test("parseTranscriptUnit uses custom backfill so toolCall/toolResult become structured tools", async () => {
    const tempDir = await makeTempDir();
    const path = join(tempDir, "2026-06-25T20-55-39-024Z_019f0091-2110-7000-a1e2-147639fff216.jsonl");
    await writeFile(path, basicOmpTranscriptJsonl(), "utf8");

    const [unit] = await ompAdapter.planTranscriptUnits(source(path));
    expect(unit).toBeDefined();
    const parsed = await ompAdapter.parseTranscriptUnit(unit!);
    const kinds = parsed.records.map((record) => record.normalized.kind);

    expect(parsed.completeness).toBe("complete");
    expect(kinds).toEqual(["session", "message", "message", "tool_call", "tool_result"]);
    expect(parsed.records.filter((record) => record.normalized.kind === "message").map((record) => messageValue(record).role)).toEqual([
      "user",
      "assistant"
    ]);
    // Generic path would emit path:line keys without suffixes and messages.role=tool only.
    expect(parsed.records.map((record) => record.sourceRecordKey)).toEqual(
      expect.arrayContaining([
        `${path}:1:session`,
        `${path}:2:message`,
        `${path}:3:message`,
        `${path}:3:tool_call:2`,
        `${path}:4:tool_result`
      ])
    );
    expect(parsed.records.some((record) => record.normalized.kind === "message" && messageValue(record).role === "tool")).toBe(false);
  });

  test("import-shaped OMP transcript with thinking-only assistants keeps via substantial_tool_work", async () => {
    const tempDir = await makeTempDir();
    const path = join(tempDir, "2026-07-01T12-00-00-000Z_omp-tool-heavy.jsonl");
    await writeFile(path, toolHeavyOmpTranscriptJsonl(), "utf8");

    const [unit] = await ompAdapter.planTranscriptUnits(source(path));
    const parsed = await ompAdapter.parseTranscriptUnit(unit!);
    const toolCalls = parsed.records.filter((record) => record.normalized.kind === "tool_call");
    const toolResults = parsed.records.filter((record) => record.normalized.kind === "tool_result");
    const messages = parsed.records.filter((record) => record.normalized.kind === "message");

    expect(toolCalls.length).toBeGreaterThanOrEqual(2);
    expect(toolResults.length).toBeGreaterThanOrEqual(2);
    expect(toolCalls.length + toolResults.length).toBeGreaterThanOrEqual(4);
    // Review-set shape: assistant turns are thinking + toolCall with no text parts.
    expect(messages.map((record) => messageValue(record).role)).toEqual(["user"]);
    expect(messages.some((record) => messageValue(record).role === "tool")).toBe(false);

    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    let sessionId: string | undefined;
    for (const record of parsed.records) {
      const result = ingestAdapterRecord(db, record, {
        hostId: "host:test",
        hostname: "masthead-test",
        runtimeKind: "omp"
      });
      sessionId = result.sessionId ?? sessionId;
    }
    expect(sessionId).toBeTruthy();

    const toolCallCount = (db.prepare("SELECT COUNT(*) AS n FROM tool_calls WHERE session_id = ?").get(sessionId!) as { n: number }).n;
    const toolResultCount = (db.prepare("SELECT COUNT(*) AS n FROM tool_results WHERE session_id = ?").get(sessionId!) as { n: number }).n;
    const toolMessageCount = (
      db.prepare("SELECT COUNT(*) AS n FROM messages WHERE session_id = ? AND role = 'tool'").get(sessionId!) as { n: number }
    ).n;
    const userMessageCount = (
      db.prepare("SELECT COUNT(*) AS n FROM messages WHERE session_id = ? AND role = 'user'").get(sessionId!) as { n: number }
    ).n;

    expect(toolCallCount).toBeGreaterThanOrEqual(2);
    expect(toolResultCount).toBeGreaterThanOrEqual(2);
    expect(toolCallCount + toolResultCount).toBeGreaterThanOrEqual(4);
    expect(toolMessageCount).toBe(0);
    expect(userMessageCount).toBe(1);
    expect(runCaptureQualityPrecheck(db, sessionId!)).toMatchObject({
      disposition: "keep",
      reason: "substantial_tool_work"
    });
  });

  test("normalizes OMP message model and provider metadata into record values", async () => {
    const tempDir = await makeTempDir();
    const path = join(tempDir, "2026-07-05T12-00-00-000Z_omp-model-provider.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({ cwd: "/project", id: "session", timestamp: "2026-07-05T12:00:00.000Z", title: "Model metadata", type: "session" }),
        JSON.stringify({
          id: "message-1",
          message: {
            content: [{ text: "OMP assistant reply with runtime metadata", type: "text" }],
            model: "gpt-5.5",
            provider: "openai",
            role: "assistant",
            timestamp: "2026-07-05T12:00:01.000Z"
          },
          parentId: "session",
          timestamp: "2026-07-05T12:00:01.000Z",
          type: "message"
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const records = await collect(ompAdapter.backfill(source(path)));
    const values = records
      .map((record) => record.normalized.value)
      .filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null);

    expect(records.flatMap((record) => record.diagnostics)).toEqual([]);
    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "gpt-5.5",
          provider: "openai",
          sessionId: "2026-07-05T12-00-00-000Z_omp-model-provider"
        })
      ])
    );
  });

  test("derives a title from the first user turn when session metadata title is empty", async () => {
    const tempDir = await makeTempDir();
    const path = join(tempDir, "2026-07-20T10-00-00-000Z_omp-empty-title.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({ cwd: "/project/Masthead", id: "session", timestamp: "2026-07-20T10:00:00.000Z", type: "session", version: 1 }),
        JSON.stringify({
          id: "message-1",
          message: {
            content: [{ text: "Tighten OMP session titles for empty metadata", type: "text" }],
            role: "user",
            timestamp: "2026-07-20T10:00:01.000Z"
          },
          parentId: "session",
          timestamp: "2026-07-20T10:00:01.000Z",
          type: "message"
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const records = await collect(ompAdapter.backfill(source(path)));
    const session = records.find((record) => record.normalized.kind === "session");
    expect(session?.normalized.value).toMatchObject({
      title: expect.stringMatching(/OMP session titles/i)
    });
    expect((session?.normalized.value as { title?: string }).title).not.toBe("Masthead");
  });

  test("keeps nested OMP advisor sessions grouped under the parent source session", async () => {
    const tempDir = await makeTempDir();
    const parentSessionId = "2026-06-25T20-55-39-024Z_019f0091-2110-7000-a1e2-147639fff216";
    const sessionDir = join(tempDir, parentSessionId);
    const path = join(sessionDir, "__advisor.jsonl");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path,
      [
        JSON.stringify({ cwd: "/project", id: "advisor-session", timestamp: "2026-06-25T20:55:39.024Z", title: "Advisor", type: "session", version: 1 }),
        JSON.stringify({
          id: "advisor-message-1",
          message: { content: [{ text: "Advisor child guidance", type: "text" }], role: "assistant", timestamp: "2026-06-25T20:55:40.000Z" },
          parentId: "advisor-session",
          timestamp: "2026-06-25T20:55:40.000Z",
          type: "message"
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const records = await collect(ompAdapter.backfill(source(path)));
    const values = records.map((record) => record.normalized.value).filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null);

    expect(records.map((record) => record.normalized.kind)).toEqual(["session", "message"]);
    expect(values).toEqual([
      expect.objectContaining({
        sessionId: parentSessionId,
        parentSourceSessionId: parentSessionId,
        childSessionId: "advisor",
        title: "Advisor"
      }),
      expect.objectContaining({
        sessionId: parentSessionId,
        parentSourceSessionId: parentSessionId,
        childSessionId: "advisor",
        role: "assistant",
        text: "Advisor child guidance"
      })
    ]);
  });
  test("discovers OMP session JSONL files without crawling logs or blobs", async () => {
    const homeDir = await makeTempDir();
    const sessionsDir = join(homeDir, ".omp", "agent", "sessions", "-project");
    const sessionDir = join(sessionsDir, "2026-06-25T20-55-39-024Z_019f0091-2110-7000-a1e2-147639fff216");
    await mkdir(sessionDir, { recursive: true });
    await mkdir(join(homeDir, ".omp", "logs"), { recursive: true });
    await mkdir(join(homeDir, ".omp", "agent", "blobs"), { recursive: true });
    await writeFile(join(sessionsDir, "2026-06-25T20-55-39-024Z_019f0091-2110-7000-a1e2-147639fff216.jsonl"), "{}", "utf8");
    await writeFile(join(sessionDir, "__advisor.jsonl"), "{}", "utf8");
    await writeFile(join(homeDir, ".omp", "logs", "omp.2026-07-01.log"), "{}", "utf8");
    await writeFile(join(homeDir, ".omp", "agent", "blobs", "image.json"), "{}", "utf8");

    const sources = await ompAdapter.discover({
      exclusions: [],
      homeDir,
      now: "2026-07-02T00:00:00.000Z"
    });

    expect(sources.map((candidate) => candidate.path).sort()).toEqual([
      join(sessionDir, "__advisor.jsonl"),
      join(sessionsDir, "2026-06-25T20-55-39-024Z_019f0091-2110-7000-a1e2-147639fff216.jsonl")
    ].sort());
  });
});

async function makeTempDir(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-omp-adapter-"));
  tempDirs.push(tempDir);
  return tempDir;
}

function source(path: string): DiscoveredSource {
  return {
    confidence: "heuristic",
    path,
    runtime: "omp",
    schemaVersion: "omp-jsonl-tree",
    sourceId: `omp:${path}`,
    sourceKind: "jsonl"
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

/** Classic OMP fixture: user + assistant text + toolCall + toolResult. */
function basicOmpTranscriptJsonl(): string {
  return (
    [
      JSON.stringify({ cwd: "/project", id: "session", timestamp: "2026-06-25T20:55:39.024Z", title: "Example", type: "session", version: 1 }),
      JSON.stringify({
        id: "message-1",
        message: { content: [{ text: "OMP user prompt", type: "text" }], role: "user", timestamp: "2026-06-25T20:55:40.000Z" },
        parentId: "session",
        timestamp: "2026-06-25T20:55:40.000Z",
        type: "message"
      }),
      JSON.stringify({
        id: "message-2",
        message: {
          content: [
            { thinking: "internal reasoning must not be imported", type: "thinking" },
            { text: "OMP assistant reply", type: "text" },
            { arguments: { path: "README.md" }, id: "call-1", name: "read", type: "toolCall" }
          ],
          role: "assistant",
          timestamp: "2026-06-25T20:55:41.000Z"
        },
        parentId: "message-1",
        timestamp: "2026-06-25T20:55:41.000Z",
        type: "message"
      }),
      JSON.stringify({
        id: "message-3",
        message: { content: [{ text: "OMP tool result", type: "text" }], role: "toolResult", timestamp: "2026-06-25T20:55:42.000Z" },
        parentId: "message-2",
        timestamp: "2026-06-25T20:55:42.000Z",
        type: "message"
      })
    ].join("\n") + "\n"
  );
}

/**
 * Review-set shape from B1: user + assistant turns that are thinking+toolCall only
 * (no assistant text). Generic parse would store toolResults as messages.role=tool
 * and drop toolCalls, leaving quality precheck at review/insufficient_evidence.
 */
function toolHeavyOmpTranscriptJsonl(): string {
  const lines: string[] = [
    JSON.stringify({
      cwd: "/project/Masthead",
      id: "session",
      timestamp: "2026-07-01T12:00:00.000Z",
      type: "session",
      version: 1
    }),
    JSON.stringify({
      id: "message-user",
      message: {
        content: [{ text: "Run the FullSuite semantics suite and fix failures", type: "text" }],
        role: "user",
        timestamp: "2026-07-01T12:00:01.000Z"
      },
      parentId: "session",
      timestamp: "2026-07-01T12:00:01.000Z",
      type: "message"
    })
  ];

  // Use non-file-mutating tools so quality precheck hits substantial_tool_work
  // (file-path tools can also materialize file_effects, which win earlier as durable_file_effect).
  const tools = [
    { callId: "call-read-1", name: "read", args: { path: "src/adapters/omp/adapter.ts" }, output: "export const ompAdapter = ..." },
    { callId: "call-bash-1", name: "bash", args: { command: "npm test -- ompAdapter" }, output: "2 failed" },
    { callId: "call-grep-1", name: "grep", args: { pattern: "parseTranscriptUnit" }, output: "localAdapterFactory.ts:33" },
    { callId: "call-bash-2", name: "bash", args: { command: "npm test -- ompAdapter" }, output: "all passed" }
  ];

  let parentId = "message-user";
  let second = 2;
  for (const [index, tool] of tools.entries()) {
    const assistantId = `message-assistant-${index + 1}`;
    const toolId = `message-tool-${index + 1}`;
    const assistantTs = `2026-07-01T12:00:${String(second).padStart(2, "0")}.000Z`;
    second += 1;
    const toolTs = `2026-07-01T12:00:${String(second).padStart(2, "0")}.000Z`;
    second += 1;

    lines.push(
      JSON.stringify({
        id: assistantId,
        message: {
          content: [
            { thinking: `plan step ${index + 1}`, type: "thinking" },
            { arguments: tool.args, id: tool.callId, name: tool.name, type: "toolCall" }
          ],
          role: "assistant",
          timestamp: assistantTs
        },
        parentId,
        timestamp: assistantTs,
        type: "message"
      })
    );
    lines.push(
      JSON.stringify({
        id: toolId,
        message: {
          content: [{ text: tool.output, type: "text" }],
          isError: false,
          role: "toolResult",
          timestamp: toolTs,
          toolCallId: tool.callId,
          toolName: tool.name
        },
        parentId: assistantId,
        timestamp: toolTs,
        type: "message"
      })
    );
    parentId = toolId;
  }

  return lines.join("\n") + "\n";
}
