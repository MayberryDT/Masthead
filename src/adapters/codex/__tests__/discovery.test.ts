import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { discoverCodexSources } from "../discovery.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("codex source discovery", () => {
  test("finds index, history, sessions, and archived sessions without reading transcript bodies", async () => {
    const home = join(tmpdir(), `codex-home-${Date.now()}`);
    tempDirs.push(home);
    await mkdir(join(home, ".codex", "sessions"), { recursive: true });
    await mkdir(join(home, ".codex", "archived_sessions"), { recursive: true });
    await writeFile(join(home, ".codex", "session_index.jsonl"), "", "utf8");
    await writeFile(join(home, ".codex", "history.jsonl"), "", "utf8");
    await writeFile(join(home, ".codex", "sessions", "2026-06-24.jsonl"), "do not parse me", "utf8");
    await writeFile(join(home, ".codex", "archived_sessions", "rollout-2026-06-24-session.jsonl"), "do not parse me", "utf8");

    const sources = await discoverCodexSources({ homeDir: home, now: "2026-06-24T12:00:00.000Z", exclusions: [] });

    expect(sources.map((source) => source.path?.replace(home, "~"))).toEqual(
      expect.arrayContaining([
        "~/.codex/session_index.jsonl",
        "~/.codex/history.jsonl",
        "~/.codex/sessions",
        "~/.codex/archived_sessions"
      ])
    );
    expect(sources.every((source) => source.runtime === "codex" && source.confidence === "authoritative")).toBe(true);
  });

  test("applies source exclusions before reporting discovered paths", async () => {
    const home = join(tmpdir(), `codex-home-${Date.now()}`);
    tempDirs.push(home);
    await mkdir(join(home, ".codex", "sessions"), { recursive: true });
    await writeFile(join(home, ".codex", "history.jsonl"), "", "utf8");

    const sources = await discoverCodexSources({
      homeDir: home,
      now: "2026-06-24T12:00:00.000Z",
      exclusions: [{ pattern: "history.jsonl", reason: "test exclusion" }]
    });

    expect(sources.map((source) => source.sourceId)).toEqual(["codex-sessions"]);
  });
});
