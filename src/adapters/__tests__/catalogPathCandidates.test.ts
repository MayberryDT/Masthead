import { describe, expect, test, vi } from "vitest";
import { catalogPathCandidatesForRuntime } from "../catalogPathCandidates.ts";
import type { DiscoveryContext } from "../types.ts";

const context: DiscoveryContext = {
  exclusions: [],
  homeDir: "/home/tester",
  now: "2026-06-23T02:04:00.000Z"
};

const SCAN_RUNTIMES = ["codex", "cursor", "claude_code", "opencode", "grok", "hermes", "pi", "omp"] as const;

describe("catalog path candidates", () => {
  test("expands home and Windows application data placeholders from catalog paths", () => {
    vi.stubEnv("APPDATA", "/Users/tester/AppData/Roaming");
    vi.stubEnv("LOCALAPPDATA", "/Users/tester/AppData/Local");
    try {
      const cursorPaths = catalogPathCandidatesForRuntime("cursor", context).map((candidate) => candidate.relativePath);

      expect(cursorPaths).toContain("/home/tester/Library/Application Support/Cursor/User/globalStorage/state.vscdb");
      expect(cursorPaths).toContain("/Users/tester/AppData/Roaming/Cursor/User/globalStorage/state.vscdb");
      expect(cursorPaths.some((path) => path.includes("%APPDATA%"))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("creates catalog candidates for every scannable catalog runtime including Codex", () => {
    expect(SCAN_RUNTIMES.flatMap((runtime) => catalogPathCandidatesForRuntime(runtime, context))).not.toEqual([]);
    expect(
      SCAN_RUNTIMES.every((runtime) =>
        catalogPathCandidatesForRuntime(runtime, context).every((candidate) => candidate.runtime === runtime)
      )
    ).toBe(true);
    expect(catalogPathCandidatesForRuntime("codex", context).map((candidate) => candidate.relativePath)).toEqual([
      "/home/tester/.codex/sessions",
      "/home/tester/.codex/hooks.json"
    ]);
    expect(catalogPathCandidatesForRuntime("codex", context).map((candidate) => candidate.relativePath)).not.toContain(
      "/home/tester/.codex"
    );
  });

  test("uses catalog Grok hook and session roots as bounded candidates", () => {
    const grokCandidates = catalogPathCandidatesForRuntime("grok", context);

    expect(grokCandidates.map((candidate) => candidate.relativePath)).toEqual([
      "/home/tester/.grok/hooks",
      "/home/tester/.grok/sessions"
    ]);
    expect(grokCandidates).toEqual([
      expect.objectContaining({ contentKind: "directory", maxDepth: 4, sourceKind: "inference" }),
      expect.objectContaining({ contentKind: "jsonl-tree", maxDepth: 4, sourceKind: "jsonl" })
    ]);
  });

  test("uses bounded depth for directory candidates", () => {
    const ompCandidates = catalogPathCandidatesForRuntime("omp", context);
    expect(ompCandidates.map((candidate) => candidate.relativePath)).toContain("/home/tester/.omp/agent/sessions");
    expect(ompCandidates.every((candidate) => candidate.maxDepth !== undefined && candidate.maxDepth <= 5)).toBe(true);
  });
});
