import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { DiscoveredSource } from "../../types.ts";
import { parseCodexTranscript } from "../transcriptParser.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("codex transcript partial writes", () => {
  test("does not consume an incomplete final JSON line", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "codex-partial-"));
    tempDirs.push(tempDir);
    const file = join(tempDir, "rollout-partial.jsonl");
    const fixture = await readFile(join(process.cwd(), "fixtures", "adapters", "codex", "rollout-partial.jsonl"), "utf8");
    await writeFile(file, fixture.trimEnd(), "utf8");

    const records = await collect(parseCodexTranscript(source(file)));

    const activeFile = fixture.trimEnd();
    const completePrefix = activeFile.slice(0, activeFile.lastIndexOf("\n") + 1);
    expect(records).toHaveLength(2);
    expect(records.at(-1)?.sourceRecordKey).toBe(`${file}:${Buffer.byteLength(completePrefix)}`);
  });
});

function source(path: string): DiscoveredSource {
  return {
    confidence: "authoritative",
    path,
    runtime: "codex",
    runtimeVersion: "file",
    schemaVersion: "codex-transcript-jsonl",
    sourceId: "codex-rollout-partial",
    sourceKind: "jsonl"
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}
