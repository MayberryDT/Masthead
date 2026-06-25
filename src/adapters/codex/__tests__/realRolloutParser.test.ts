import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { AdapterRecord, DiscoveredSource } from "../../types.ts";
import { parseCodexTranscript } from "../transcriptParser.ts";

describe("codex real rollout parser", () => {
  test("normalizes session metadata and message content blocks", async () => {
    const file = fixturePath("rollout-basic.jsonl");

    const records = await parseFixture(file);

    expect(records.map((record) => record.normalized.kind)).toEqual(["session", "message", "message"]);
    expect(records[0].normalized.value).toMatchObject({
      cwd: "/workspace/masthead",
      model: "gpt-5-codex",
      sessionId: "session-abc"
    });
    expect(records[1].normalized.value).toMatchObject({
      content: "Build the Logbook search.",
      role: "user",
      sessionId: "session-abc",
      text: "Build the Logbook search."
    });
    expect(records[2].normalized.value).toMatchObject({
      content: "I will inspect the session store first.",
      role: "assistant",
      sessionId: "session-abc"
    });
  });

  test("normalizes tool calls, tool outputs, and event messages", async () => {
    const records = await parseFixture(fixturePath("rollout-tools.jsonl"));

    expect(records.map((record) => record.normalized.kind)).toEqual(["session", "tool_call", "tool_result", "runtime_signal"]);
    expect(records[1].normalized.value).toMatchObject({
      arguments: { cmd: "npm test -- --run src/adapters/codex" },
      callId: "call-1",
      sessionId: "session-tools",
      toolName: "shell"
    });
    expect(records[2].normalized.value).toMatchObject({
      callId: "call-1",
      output: "adapter tests failed as expected",
      sessionId: "session-tools"
    });
    expect(records[3].normalized.value).toMatchObject({
      message: "Recorded the failing adapter test.",
      severity: "info",
      sessionId: "session-tools"
    });
  });

  test("normalizes compaction checkpoints and token counts", async () => {
    const records = await parseFixture(fixturePath("rollout-compacted.jsonl"));

    expect(records.map((record) => record.normalized.kind)).toEqual(["session", "checkpoint", "usage"]);
    expect(records[1].normalized.value).toMatchObject({
      checkpointId: "checkpoint-1",
      sessionId: "session-compacted",
      summary: "Earlier adapter exploration was compacted into a checkpoint."
    });
    expect(records[2].normalized.value).toMatchObject({
      inputTokens: 1234,
      model: "gpt-5-codex",
      outputTokens: 456,
      sessionId: "session-compacted",
      totalTokens: 1690
    });
  });
});

function fixturePath(name: string): string {
  return join(process.cwd(), "fixtures", "adapters", "codex", name);
}

async function parseFixture(file: string): Promise<AdapterRecord[]> {
  await readFile(file, "utf8");
  return collect(parseCodexTranscript(source(file)));
}

function source(path: string): DiscoveredSource {
  return {
    confidence: "authoritative",
    path,
    runtime: "codex",
    runtimeVersion: "file",
    schemaVersion: "codex-transcript-jsonl",
    sourceId: `codex-rollout:${path}`,
    sourceKind: "jsonl"
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}
