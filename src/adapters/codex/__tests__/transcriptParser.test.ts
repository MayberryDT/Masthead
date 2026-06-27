import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { DiscoveredSource, IngestCursor } from "../../types.ts";
import { parseCodexTranscript } from "../transcriptParser.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("codex transcript parser", () => {
  test("classifies transcript records and resumes from a byte-offset cursor", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "codex-transcript-"));
    tempDirs.push(tempDir);
    const file = join(tempDir, "session.jsonl");
    const firstLine = JSON.stringify({ role: "user", content: "Build the Logbook", timestamp: "2026-06-24T12:00:00.000Z" });
    const secondLine = JSON.stringify({ type: "tool_call", name: "bash", timestamp: "2026-06-24T12:01:00.000Z" });
    const thirdLine = JSON.stringify({ usage: { input_tokens: 10 }, timestamp: "2026-06-24T12:02:00.000Z" });
    await writeFile(file, `${firstLine}\n${secondLine}\n${thirdLine}\n`, "utf8");
    const cursor: IngestCursor = {
      byteOffset: Buffer.byteLength(`${firstLine}\n`),
      cursorId: "cursor:session",
      sourceId: "codex-session",
      sourcePath: file
    };

    const records = await collect(parseCodexTranscript(source(file), cursor));

    expect(records.map((record) => record.normalized.kind)).toEqual(["tool_call", "usage"]);
    expect(records[0]).toMatchObject({
      observedAt: "2026-06-24T12:01:00.000Z",
      sourceRecordKey: `${file}:${Buffer.byteLength(`${firstLine}\n${secondLine}\n`)}`
    });
    expect(records[0].normalized.sourceRef).toMatchObject({ sourceKind: "jsonl", sourcePath: file });
  });

  test("classifies payload-wrapped Codex transcript records", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "codex-transcript-"));
    tempDirs.push(tempDir);
    const file = join(tempDir, "session.jsonl");
    await writeFile(
      file,
      `${JSON.stringify({
        payload: { message: { content: "Wrapped user message", role: "user" }, session_id: "session-1" },
        timestamp: "2026-06-24T12:00:00.000Z",
        type: "message"
      })}\n`,
      "utf8"
    );

    const records = await collect(parseCodexTranscript(source(file)));

    expect(records).toHaveLength(1);
    expect(records[0].normalized.kind).toBe("message");
    expect(records[0].normalized.value).toMatchObject({
      content: "Wrapped user message",
      role: "user",
      session_id: "session-1"
    });
  });

  test("normalizes Codex event token counts from last usage payloads", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "codex-transcript-"));
    tempDirs.push(tempDir);
    const file = join(tempDir, "session.jsonl");
    await writeFile(
      file,
      `${JSON.stringify({
        payload: {
          info: {
            last_token_usage: {
              input_tokens: 203_577,
              output_tokens: 67,
              total_tokens: 203_644
            },
            total_token_usage: {
              input_tokens: 11_292_912,
              output_tokens: 49_872,
              total_tokens: 11_342_784
            }
          },
          type: "token_count"
        },
        timestamp: "2026-06-26T20:23:21.794Z",
        type: "event_msg"
      })}\n`,
      "utf8"
    );

    const records = await collect(parseCodexTranscript(source(file), { ...cursorContext(file), model: "gpt-5.5", sourceSessionId: "session-token" }));

    expect(records).toHaveLength(1);
    expect(records[0].normalized.kind).toBe("usage");
    expect(records[0].normalized.value).toMatchObject({
      inputTokens: 203_577,
      model: "gpt-5.5",
      outputTokens: 67,
      sessionId: "session-token",
      totalTokens: 203_644
    });
  });

  test("carries model context from Codex turn context into token counts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "codex-transcript-"));
    tempDirs.push(tempDir);
    const file = join(tempDir, "session.jsonl");
    await writeFile(
      file,
      `${JSON.stringify({
        payload: {
          id: "session-turn-context"
        },
        timestamp: "2026-06-26T20:22:00.000Z",
        type: "session_meta"
      })}\n${JSON.stringify({
        payload: {
          cwd: "/home/tyler/Documents/Masthead",
          model: "gpt-5.5"
        },
        timestamp: "2026-06-26T20:22:10.000Z",
        type: "turn_context"
      })}\n${JSON.stringify({
        payload: {
          info: {
            last_token_usage: {
              input_tokens: 30,
              output_tokens: 7,
              total_tokens: 37
            }
          },
          type: "token_count"
        },
        timestamp: "2026-06-26T20:22:20.000Z",
        type: "event_msg"
      })}\n`,
      "utf8"
    );

    const records = await collect(parseCodexTranscript(source(file)));

    expect(records.map((record) => record.normalized.kind)).toEqual(["session", "event", "usage"]);
    expect(records[2].normalized.value).toMatchObject({
      inputTokens: 30,
      model: "gpt-5.5",
      sessionId: "session-turn-context",
      totalTokens: 37
    });
  });
});

function source(path: string): DiscoveredSource {
  return {
    confidence: "authoritative",
    path,
    runtime: "codex",
    runtimeVersion: "local-jsonl",
    schemaVersion: "codex-transcript-jsonl",
    sourceId: "codex-session",
    sourceKind: "jsonl"
  };
}

function cursorContext(path: string): IngestCursor {
  return {
    byteOffset: 0,
    cursorId: "cursor:token",
    sourceId: "codex-session",
    sourcePath: path
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}
