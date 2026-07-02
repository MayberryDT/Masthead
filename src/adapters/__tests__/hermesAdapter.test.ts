import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { hermesAdapter } from "../hermes/adapter.ts";
import type { AdapterRecord, DiscoveredSource } from "../types.ts";

const tempDirs: string[] = [];

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

async function collect(records: AsyncIterable<AdapterRecord>): Promise<AdapterRecord[]> {
  const output: AdapterRecord[] = [];
  for await (const record of records) output.push(record);
  return output;
}

function messageValue(record: AdapterRecord): Record<string, unknown> {
  expect(record.normalized.kind).toBe("message");
  return record.normalized.value as Record<string, unknown>;
}
