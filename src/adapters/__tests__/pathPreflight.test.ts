import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { pathCandidatesForRuntime, ADAPTER_PATH_CANDIDATES } from "../pathCandidates.ts";
import { preflightAdapterPathCandidate, preflightAdapterRuntime } from "../preflight.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("adapter path candidates", () => {
  test("declares only bounded relative paths", () => {
    expect(ADAPTER_PATH_CANDIDATES).not.toEqual([]);
    for (const candidate of ADAPTER_PATH_CANDIDATES) {
      expect(candidate.relativePath).not.toBe("");
      expect(candidate.relativePath).not.toBe(".");
      expect(candidate.relativePath.startsWith("/")).toBe(false);
      expect(candidate.relativePath.startsWith("..")).toBe(false);
    }
    expect(ADAPTER_PATH_CANDIDATES.map((candidate) => candidate.runtime)).not.toContain("crush");
  });

  test("keeps Codex candidates to known local store paths", () => {
    expect(pathCandidatesForRuntime("codex").map((candidate) => candidate.relativePath)).toEqual([
      ".codex/session_index.jsonl",
      ".codex/history.jsonl",
      ".codex/sessions",
      ".codex/archived_sessions"
    ]);
  });
});

describe("adapter preflight utilities", () => {
  test("preflights a declared JSONL tree without crawling arbitrary home files", async () => {
    const homeDir = await makeHome("masthead-preflight-");
    await writeFile(join(homeDir, "stray.jsonl"), '{"ignored":true}\n', "utf8");
    await mkdir(join(homeDir, ".codex", "sessions", "2026", "06"), { recursive: true });
    await writeFile(join(homeDir, ".codex", "sessions", "2026", "06", "one.jsonl"), '{"id":"one"}\n', "utf8");

    const result = await preflightAdapterRuntime(
      { exclusions: [], homeDir, now: "2026-06-27T12:00:00.000Z" },
      "codex",
      pathCandidatesForRuntime("codex").filter((candidate) => candidate.relativePath === ".codex/sessions")
    );

    expect(result).toMatchObject({
      discoveredCount: 1,
      runtime: "codex",
      state: "connected"
    });
    expect(result.checkedPaths).toEqual([
      expect.objectContaining({
        absolutePath: join(homeDir, ".codex", "sessions"),
        candidateFileCount: 1,
        exists: true
      })
    ]);
  });

  test("reports missing candidates without diagnostics", async () => {
    const homeDir = await makeHome("masthead-preflight-missing-");
    const candidate = pathCandidatesForRuntime("codex")[0]!;

    const result = await preflightAdapterPathCandidate(
      { exclusions: [], homeDir, now: "2026-06-27T12:00:00.000Z" },
      candidate
    );

    expect(result).toMatchObject({
      exists: false,
      readable: false,
      runtime: "codex"
    });
    expect(result.diagnostics).toEqual([]);
  });

  test("surfaces malformed JSONL diagnostics for file candidates", async () => {
    const homeDir = await makeHome("masthead-preflight-jsonl-file-");
    await mkdir(join(homeDir, ".codex"), { recursive: true });
    await writeFile(join(homeDir, ".codex", "history.jsonl"), "{ bad json\n", "utf8");
    const candidate = pathCandidatesForRuntime("codex").find((item) => item.relativePath === ".codex/history.jsonl")!;

    const result = await preflightAdapterPathCandidate(
      { exclusions: [], homeDir, now: "2026-06-27T12:00:00.000Z" },
      candidate
    );

    expect(result).toMatchObject({
      candidateRecordCount: 0,
      exists: true,
      readable: true
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "jsonl_malformed_line",
        severity: "warning"
      })
    ]);
  });
});

async function makeHome(prefix: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(tempDir);
  const homeDir = join(tempDir, "home");
  await mkdir(homeDir, { recursive: true });
  return homeDir;
}
