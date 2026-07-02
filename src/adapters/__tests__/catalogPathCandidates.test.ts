import { describe, expect, test, vi } from "vitest";
import { catalogPathCandidatesForRuntime } from "../catalogPathCandidates.ts";
import type { DiscoveryContext } from "../types.ts";

const context: DiscoveryContext = {
  exclusions: [],
  homeDir: "/home/tester",
  now: "2026-06-23T02:04:00.000Z"
};

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

  test("omits project candidates until explicit project roots are available", () => {
    const paths = catalogPathCandidatesForRuntime("aider", context).map((candidate) => candidate.relativePath);
    expect(paths).toContain("/home/tester/.aider");
    expect(paths.some((path) => path.startsWith("project:"))).toBe(false);
    expect(paths.some((path) => path.includes(".aider*"))).toBe(false);
  });

  test("uses bounded depth for directory candidates", () => {
    const ompCandidates = catalogPathCandidatesForRuntime("omp", context);
    expect(ompCandidates.map((candidate) => candidate.relativePath)).toContain("/home/tester/.omp/agent/sessions");
    expect(ompCandidates.every((candidate) => candidate.maxDepth !== undefined && candidate.maxDepth <= 4)).toBe(true);
  });

  test("does not create candidates for cloud references or legacy runtimes", () => {
    expect(catalogPathCandidatesForRuntime("devin", context)).toEqual([]);
    expect(catalogPathCandidatesForRuntime("gemini_cli", context)).toEqual([]);
  });
});
