import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { AdapterRecord, DiscoveredSource, IngestCursor } from "../../types.ts";
import { parseCodexTranscript } from "../transcriptParser.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("resumed Codex transcript parsing", () => {
  test("restores session context before a byte-offset cursor", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "codex-resume-context-"));
    tempDirs.push(tempDir);
    const file = join(tempDir, "session.jsonl");
    const sessionMeta = JSON.stringify({
      type: "session_meta",
      payload: {
        cwd: "/work/masthead",
        model: "gpt-5",
        session_id: "session-context"
      },
      timestamp: "2026-06-25T12:00:00.000Z"
    });
    const responseItem = JSON.stringify({
      type: "response_item",
      payload: {
        content: [{ type: "output_text", text: "Continue the import." }],
        role: "assistant",
        type: "message"
      },
      timestamp: "2026-06-25T12:01:00.000Z"
    });
    await writeFile(file, `${sessionMeta}\n${responseItem}\n`, "utf8");
    const cursor: IngestCursor = {
      byteOffset: Buffer.byteLength(`${sessionMeta}\n`),
      cursorId: "cursor:session-context",
      sourceId: "codex-session",
      sourcePath: file
    };

    const records = await collect(parseCodexTranscript(source(file), cursor));

    expect(records).toHaveLength(1);
    expect(records[0].normalized.value).toMatchObject({
      cwd: "/work/masthead",
      model: "gpt-5",
      sessionId: "session-context"
    });
  });

  test("resets a truncated source and emits a diagnostic", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "codex-truncated-source-"));
    tempDirs.push(tempDir);
    const file = join(tempDir, "session.jsonl");
    const line = JSON.stringify({ role: "user", content: "Reparse from zero", timestamp: "2026-06-25T12:00:00.000Z" });
    await writeFile(file, `${line}\n`, "utf8");

    const records = await collect(
      parseCodexTranscript(source(file), {
        byteOffset: 10_000,
        cursorId: "cursor:truncated",
        sourceId: "codex-session",
        sourcePath: file
      })
    );

    expect(records[0].diagnostics).toEqual([
      expect.objectContaining({
        code: "source_truncated",
        severity: "warning"
      })
    ]);
    expect(records[1]).toMatchObject({
      normalized: { kind: "message" },
      sourceRecordKey: `${file}:${Buffer.byteLength(`${line}\n`)}`
    });
  });

  test("emits diagnostics for newline-terminated malformed JSON", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "codex-malformed-line-"));
    tempDirs.push(tempDir);
    const file = join(tempDir, "session.jsonl");
    await writeFile(file, `{"role":"user"\n`, "utf8");

    const records = await collect(parseCodexTranscript(source(file)));

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      diagnostics: [expect.objectContaining({ code: "malformed_json", severity: "error" })],
      normalized: { kind: "event" }
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

async function collect(iterable: AsyncIterable<AdapterRecord>): Promise<AdapterRecord[]> {
  const values: AdapterRecord[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}
