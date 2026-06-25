import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { discoverCodexTranscriptFiles } from "../discovery.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("codex recursive transcript discovery", () => {
  test("discovers nested Codex rollout files", async () => {
    const home = join(tmpdir(), `codex-home-${Date.now()}`);
    tempDirs.push(home);
    const rollout = join(home, ".codex", "sessions", "2026", "06", "25", "rollout-a.jsonl");
    await mkdir(join(home, ".codex", "sessions", "2026", "06", "25"), { recursive: true });
    await writeFile(rollout, "{}\n", "utf8");

    const sources = await discoverCodexTranscriptFiles({ homeDir: home, now: "2026-06-25T12:00:00.000Z", exclusions: [] });

    expect(sources.map((source) => source.path)).toContain(rollout);
    expect(sources).toContainEqual(
      expect.objectContaining({
        confidence: "authoritative",
        path: rollout,
        runtime: "codex",
        runtimeVersion: "file",
        schemaVersion: "codex-transcript-jsonl",
        sourceKind: "jsonl"
      })
    );
  });
});
