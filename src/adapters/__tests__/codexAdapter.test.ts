import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { codexAdapter } from "../codex/adapter.ts";
import type { AdapterRecord, DiscoveredSource } from "../types.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("Codex adapter", () => {
  test("restarts from the beginning when a saved byte cursor is beyond a truncated file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-codex-truncated-"));
    tempDirs.push(dir);
    const path = join(dir, "rollout-truncated.jsonl");
    await writeFile(path, `${JSON.stringify({ timestamp: "2026-07-01T00:00:00.000Z", type: "session_meta", payload: { id: "session-new" } })}\n`, "utf8");
    const source: DiscoveredSource = { confidence: "authoritative", path, runtime: "codex", sourceId: "codex:truncated", sourceKind: "jsonl" };

    const records: AdapterRecord[] = [];
    for await (const record of codexAdapter.backfill(source, {
      byteOffset: 50_000,
      cursorId: "cursor:old",
      sourceId: source.sourceId,
      sourcePath: path,
      sourceSessionId: "session-old"
    })) records.push(record);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ normalized: { value: { sessionId: "session-new" } }, sourceRecordKey: `${path}:1` });
  });

  test("resumes after a byte checkpoint while retaining session context and stable line keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-codex-adapter-"));
    tempDirs.push(dir);
    const path = join(dir, "rollout-test.jsonl");
    const lines = [
      JSON.stringify({ timestamp: "2026-07-01T00:00:00.000Z", type: "session_meta", payload: { id: "session-real", cwd: "/workspace/masthead", model: "gpt-5" } }),
      JSON.stringify({ timestamp: "2026-07-01T00:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "first" }] } }),
      JSON.stringify({ timestamp: "2026-07-01T00:00:02.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "second" }] } })
    ];
    await writeFile(path, `${lines.join("\n")}\n`, "utf8");
    const byteOffset = Buffer.byteLength(`${lines[0]}\n${lines[1]}\n`);
    const source: DiscoveredSource = {
      confidence: "authoritative",
      path,
      runtime: "codex",
      sourceId: "codex:test",
      sourceKind: "jsonl"
    };

    const records: AdapterRecord[] = [];
    for await (const record of codexAdapter.backfill(source, {
      byteOffset,
      cursorId: "cursor:test",
      cwd: "/workspace/masthead",
      model: "gpt-5",
      sourceId: source.sourceId,
      sourcePath: path,
      sourceSessionId: "session-real"
    })) records.push(record);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      cursorAfter: { sourceSessionId: "session-real" },
      sourceRecordKey: `${path}:3`,
      normalized: { value: { role: "assistant", sessionId: "session-real", text: "second" } }
    });
  });
});
