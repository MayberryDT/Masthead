import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { claudeCodeCandidatePaths } from "../claudeCode/discovery.ts";
import { cursorCandidatePaths } from "../cursor/discovery.ts";
import { discoverGrokSources, grokCandidatePaths } from "../grok/discovery.ts";
import { ompCandidatePaths } from "../omp/discovery.ts";
import { opencodeCandidatePaths } from "../opencode/discovery.ts";
import { piCandidatePaths } from "../pi/discovery.ts";
import type { DiscoveryContext } from "../types.ts";

const redirectedHome = "/tmp/masthead-redirected-home";
const escapeRoot = "/tmp/should-not-escape-adapter-home";

const redirectedContext: DiscoveryContext = {
  exclusions: [],
  homeDir: redirectedHome,
  now: "2026-08-07T00:00:00.000Z"
};

const realHomeContext: DiscoveryContext = {
  exclusions: [],
  homeDir: homedir(),
  now: "2026-08-07T00:00:00.000Z"
};

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("adapter discovery homeDir isolation", () => {
  test("ignores absolute env home overrides when context.homeDir is redirected", () => {
    vi.stubEnv("MASTHEAD_OMP_HOME", escapeRoot);
    vi.stubEnv("OMP_HOME", escapeRoot);
    vi.stubEnv("OH_MY_PI_HOME", escapeRoot);
    vi.stubEnv("MASTHEAD_OPENCODE_HOME", escapeRoot);
    vi.stubEnv("OPENCODE_HOME", escapeRoot);
    vi.stubEnv("MASTHEAD_PI_HOME", escapeRoot);
    vi.stubEnv("PI_HOME", escapeRoot);
    vi.stubEnv("MASTHEAD_CLAUDE_CODE_HOME", escapeRoot);
    vi.stubEnv("CLAUDE_HOME", escapeRoot);
    vi.stubEnv("MASTHEAD_CURSOR_HOME", escapeRoot);
    vi.stubEnv("CURSOR_DB_PATH", join(escapeRoot, "state.vscdb"));
    vi.stubEnv("MASTHEAD_GROK_HOME", escapeRoot);
    vi.stubEnv("GROK_HOME", escapeRoot);

    const paths = [
      ...ompCandidatePaths(redirectedContext),
      ...opencodeCandidatePaths(redirectedContext),
      ...piCandidatePaths(redirectedContext),
      ...claudeCodeCandidatePaths(redirectedContext),
      ...cursorCandidatePaths(redirectedContext),
      ...grokCandidatePaths(redirectedContext)
    ].map((candidate) => candidate.relativePath);

    expect(paths.some((path) => path === escapeRoot || path.startsWith(`${escapeRoot}/`))).toBe(false);
    expect(paths.every((path) => path.startsWith(redirectedHome))).toBe(true);
  });

  test("honors absolute env home overrides only when context.homeDir is the real home", () => {
    vi.stubEnv("MASTHEAD_OMP_HOME", escapeRoot);
    vi.stubEnv("MASTHEAD_OPENCODE_HOME", escapeRoot);
    vi.stubEnv("MASTHEAD_PI_HOME", escapeRoot);
    vi.stubEnv("MASTHEAD_CLAUDE_CODE_HOME", escapeRoot);
    vi.stubEnv("MASTHEAD_CURSOR_HOME", escapeRoot);
    vi.stubEnv("CURSOR_DB_PATH", join(escapeRoot, "state.vscdb"));
    vi.stubEnv("MASTHEAD_GROK_HOME", escapeRoot);

    expect(ompCandidatePaths(realHomeContext).some((candidate) => candidate.relativePath === escapeRoot)).toBe(true);
    expect(opencodeCandidatePaths(realHomeContext).some((candidate) => candidate.relativePath.startsWith(escapeRoot))).toBe(true);
    expect(piCandidatePaths(realHomeContext).some((candidate) => candidate.relativePath === escapeRoot)).toBe(true);
    expect(claudeCodeCandidatePaths(realHomeContext).every((candidate) => candidate.relativePath.startsWith(escapeRoot))).toBe(true);
    expect(cursorCandidatePaths(realHomeContext).some((candidate) => candidate.relativePath === join(escapeRoot, "state.vscdb"))).toBe(true);
    expect(cursorCandidatePaths(realHomeContext).some((candidate) => candidate.relativePath.startsWith(join(escapeRoot, "User")))).toBe(true);
    expect(grokCandidatePaths(realHomeContext).every((candidate) => candidate.relativePath.startsWith(escapeRoot))).toBe(true);
  });

  test("includes Linux, macOS, and Windows Cursor defaults under a redirected home", () => {
    const paths = cursorCandidatePaths(redirectedContext).map((candidate) => candidate.relativePath);

    expect(paths).toEqual(expect.arrayContaining([
      join(redirectedHome, ".config", "Cursor", "User", "globalStorage", "state.vscdb"),
      join(redirectedHome, ".config", "Cursor", "User", "workspaceStorage"),
      join(redirectedHome, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb"),
      join(redirectedHome, "Library", "Application Support", "Cursor", "User", "workspaceStorage"),
      join(redirectedHome, "AppData", "Roaming", "Cursor", "User", "globalStorage", "state.vscdb"),
      join(redirectedHome, "AppData", "Roaming", "Cursor", "User", "workspaceStorage")
    ]));
  });

  test("bounds Grok chat_history walks by maxDepth", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "masthead-grok-depth-"));
    tempDirs.push(homeDir);
    const shallowDir = join(homeDir, ".grok", "sessions", "a", "b");
    const deepDir = join(homeDir, ".grok", "sessions", "a", "b", "c", "d", "e", "f");
    await mkdir(shallowDir, { recursive: true });
    await mkdir(deepDir, { recursive: true });
    await writeFile(join(shallowDir, "chat_history.jsonl"), '{"type":"user","content":"shallow"}\n');
    await writeFile(join(deepDir, "chat_history.jsonl"), '{"type":"user","content":"deep"}\n');

    const sources = await discoverGrokSources({
      exclusions: [],
      homeDir,
      now: "2026-08-07T00:00:00.000Z"
    });

    expect(sources.map((source) => source.path)).toEqual([join(shallowDir, "chat_history.jsonl")]);
    expect(grokCandidatePaths({ exclusions: [], homeDir, now: "2026-08-07T00:00:00.000Z" }).every((candidate) => candidate.maxDepth === 5)).toBe(true);
  });
});
