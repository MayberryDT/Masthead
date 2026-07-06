import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { pathCandidatesForRuntime, ADAPTER_PATH_CANDIDATES } from "../pathCandidates.ts";
import { preflightAdapterPathCandidate, preflightAdapterRuntime } from "../preflight.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

const tempDirs: string[] = [];
const SUPPORTED_RUNTIMES = ["cursor", "claude_code", "opencode", "grok", "hermes", "pi", "omp"] as const;

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("adapter path candidates", () => {
  test("declares only bounded relative paths for supported runtimes", () => {
    expect(ADAPTER_PATH_CANDIDATES).not.toEqual([]);
    for (const candidate of ADAPTER_PATH_CANDIDATES) {
      expect(candidate.relativePath).not.toBe("");
      expect(candidate.relativePath).not.toBe(".");
      expect(candidate.relativePath.startsWith("/")).toBe(false);
      expect(candidate.relativePath.startsWith("..")).toBe(false);
      expect(SUPPORTED_RUNTIMES).toContain(candidate.runtime);
      expect(candidate.maxDepth).toBeGreaterThan(0);
      expect(candidate.maxDepth).toBeLessThanOrEqual(5);
    }
  });

  test("keeps Grok candidates to known hook and session JSONL trees", () => {
    expect(pathCandidatesForRuntime("grok").map((candidate) => candidate.relativePath)).toEqual([
      ".grok/hooks",
      ".grok/sessions"
    ]);
    expect(pathCandidatesForRuntime("grok")).toEqual([
      expect.objectContaining({ contentKind: "jsonl-tree", sourceKind: "jsonl" }),
      expect.objectContaining({ contentKind: "jsonl-tree", sourceKind: "jsonl" })
    ]);
  });
});

describe("adapter preflight utilities", () => {
  test("preflights a declared Grok JSONL tree without crawling arbitrary home files", async () => {
    const homeDir = await makeHome("masthead-preflight-");
    await writeFile(join(homeDir, "stray.jsonl"), '{"ignored":true}\n', "utf8");
    await mkdir(join(homeDir, ".grok", "sessions", "2026", "06"), { recursive: true });
    await writeFile(join(homeDir, ".grok", "sessions", "2026", "06", "one.jsonl"), '{"id":"one"}\n', "utf8");

    const result = await preflightAdapterRuntime(
      { exclusions: [], homeDir, now: "2026-06-27T12:00:00.000Z" },
      "grok",
      pathCandidatesForRuntime("grok").filter((candidate) => candidate.relativePath === ".grok/sessions")
    );

    expect(result).toMatchObject({
      discoveredCount: 1,
      runtime: "grok",
      state: "connected"
    });
    expect(result.checkedPaths).toEqual([
      expect.objectContaining({
        absolutePath: join(homeDir, ".grok", "sessions"),
        candidateFileCount: 1,
        exists: true
      })
    ]);
  });

  test("reports missing candidates without diagnostics", async () => {
    const homeDir = await makeHome("masthead-preflight-missing-");
    const candidate = pathCandidatesForRuntime("grok")[0]!;

    const result = await preflightAdapterPathCandidate(
      { exclusions: [], homeDir, now: "2026-06-27T12:00:00.000Z" },
      candidate
    );

    expect(result).toMatchObject({
      exists: false,
      readable: false,
      runtime: "grok"
    });
    expect(result.diagnostics).toEqual([]);
  });

  test("surfaces malformed JSONL diagnostics for supported file candidates", async () => {
    const homeDir = await makeHome("masthead-preflight-jsonl-file-");
    await mkdir(join(homeDir, ".claude"), { recursive: true });
    await writeFile(join(homeDir, ".claude", "history.jsonl"), "{ bad json\n", "utf8");
    const candidate: AdapterPathCandidate = {
      confidence: "heuristic",
      contentKind: "jsonl-file",
      purpose: "Claude Code history transcript file",
      relativePath: ".claude/history.jsonl",
      runtime: "claude_code",
      sourceKind: "jsonl"
    };

    const result = await preflightAdapterPathCandidate(
      { exclusions: [], homeDir, now: "2026-06-27T12:00:00.000Z" },
      candidate
    );

    expect(result).toMatchObject({
      candidateRecordCount: 0,
      exists: true,
      readable: true,
      runtime: "claude_code"
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
