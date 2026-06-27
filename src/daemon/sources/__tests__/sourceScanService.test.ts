import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { scanLocalSources } from "../sourceScanService.ts";

const activeScanRuntimes = ["codex", "cursor", "claude_code", "antigravity", "opencode", "aider", "openclaw", "hermes", "pi"] as const;
const adapterHomeEnvKeys = [
  "MASTHEAD_CURSOR_HOME",
  "MASTHEAD_CLAUDE_CODE_HOME",
  "CLAUDE_HOME",
  "MASTHEAD_ANTIGRAVITY_HOME",
  "ANTIGRAVITY_HOME",
  "MASTHEAD_OPENCODE_HOME",
  "OPENCODE_HOME",
  "MASTHEAD_AIDER_HOME",
  "AIDER_HOME",
  "MASTHEAD_OPENCLAW_HOME",
  "OPENCLAW_HOME",
  "MASTHEAD_HERMES_HOME",
  "HERMES_HOME",
  "MASTHEAD_PI_HOME",
  "PI_HOME"
] as const;

const tempDirs: string[] = [];
let savedEnv: Partial<Record<(typeof adapterHomeEnvKeys)[number], string | undefined>>;

beforeEach(() => {
  savedEnv = Object.fromEntries(adapterHomeEnvKeys.map((key) => [key, process.env[key]]));
  for (const key of adapterHomeEnvKeys) delete process.env[key];
});

afterEach(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("source scan service", () => {
  test("returns all active adapters and excludes legacy Gemini CLI", async () => {
    const homeDir = await makeHome("masthead-source-scan-active-");

    const scan = await scanLocalSources({ exclusions: [], homeDir, now: "2026-06-27T10:00:00.000Z" });

    expect(scan.generatedAt).toBe("2026-06-27T10:00:00.000Z");
    expect(scan.scanId).toMatch(/^scan:[a-f0-9]{12}$/);
    expect(scan.adapters.map((adapter) => adapter.runtime)).toEqual([...activeScanRuntimes]);
    expect(scan.adapters.map((adapter) => adapter.runtime)).not.toContain("gemini_cli");
  });

  test("does not treat arbitrary home files as source candidates", async () => {
    const homeDir = await makeHome("masthead-source-scan-bounded-");
    const arbitraryDir = join(homeDir, "Documents", "random-agent-export");
    const arbitraryTranscript = join(arbitraryDir, "session.jsonl");
    await mkdir(arbitraryDir, { recursive: true });
    await writeFile(arbitraryTranscript, "{\"sessionId\":\"arbitrary\"}\n");

    const scan = await scanLocalSources({ exclusions: [], homeDir, now: "2026-06-27T10:00:00.000Z" });
    const checkedPaths = scan.adapters.flatMap((adapter) => adapter.checkedPaths.map((path) => path.path));
    const sourcePaths = scan.adapters.flatMap((adapter) => adapter.sources.map((source) => source.path));

    expect(checkedPaths).not.toContain(arbitraryDir);
    expect(checkedPaths).not.toContain(arbitraryTranscript);
    expect(sourcePaths).not.toContain(arbitraryTranscript);
    expect(scan.adapters.every((adapter) => adapter.sources.every((source) => source.path !== arbitraryTranscript))).toBe(true);
  });
});

async function makeHome(prefix: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(tempDir);
  const homeDir = join(tempDir, "home");
  await mkdir(homeDir, { recursive: true });
  return homeDir;
}
