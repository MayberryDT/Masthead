import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
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
    await writeFile(
      path,
      [
        JSON.stringify({ cwd: "/project", id: "session", timestamp: "2026-06-25T20:55:39.024Z", title: "Example", type: "session", version: 1 }),
        JSON.stringify({ id: "message-1", message: { content: [{ text: "OMP user prompt", type: "text" }], role: "user", timestamp: "2026-06-25T20:55:40.000Z" }, parentId: "session", timestamp: "2026-06-25T20:55:40.000Z", type: "message" }),
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
      ].join("\n") + "\n",
      "utf8"
    );

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
