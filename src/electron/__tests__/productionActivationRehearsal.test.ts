import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  runProductionActivationRehearsal,
  validateRehearsalBundle
} from "../../../scripts/masthead-production-activation-rehearsal.js";

const TEST_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(TEST_PATH), "../../..");
const SCRIPT_PATH = join(PROJECT_ROOT, "scripts", "masthead-production-activation-rehearsal.js");
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function temporaryDirectory(prefix: string) {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(path);
  return path;
}

describe("production activation rehearsal CLI", () => {
  test("requires exactly one absolute bundle argument", async () => {
    await expect(validateRehearsalBundle([])).rejects.toThrow("requires --bundle <absolute-path>");
    await expect(validateRehearsalBundle(["--bundle", "relative-bundle"])).rejects.toThrow("must be absolute");
  });

  test("refuses a nonexistent bundle without allocating rehearsal state", async () => {
    const isolatedTmp = await temporaryDirectory("masthead-rehearsal-cli-tmp-");
    const missingBundle = join(isolatedTmp, "does-not-exist");

    await expect(runProductionActivationRehearsal(["--bundle", missingBundle])).rejects.toThrow(
      `bundle does not exist: ${missingBundle}`
    );
    expect(await readdir(isolatedTmp)).toEqual([]);
  });

  test("refuses a malformed packaged bundle without allocating rehearsal state", async () => {
    const root = await temporaryDirectory("masthead-rehearsal-malformed-");
    const isolatedTmp = join(root, "tmp");
    const malformedBundle = join(root, "bundle");
    await mkdir(join(malformedBundle, "resources"), { recursive: true });
    await mkdir(isolatedTmp);
    await writeFile(join(malformedBundle, "resources", "release-manifest.json"), "{");

    await expect(runProductionActivationRehearsal(["--bundle", malformedBundle])).rejects.toThrow(
      "Packaged content manifest is unreadable"
    );
    expect(await readdir(isolatedTmp)).toEqual([]);
  });

  test("refuses bundles inside live production state before inspecting their contents", async () => {
    const home = await temporaryDirectory("masthead-rehearsal-live-home-");
    const liveBundle = join(home, ".local", "share", "masthead-production", "candidate");
    await mkdir(liveBundle, { recursive: true });

    await expect(validateRehearsalBundle(["--bundle", liveBundle], { HOME: home })).rejects.toThrow(
      "refuses a bundle inside live production state"
    );
  });

  test("all validation failures happen before the runner creates disposable state", async () => {
    const isolatedTmp = await temporaryDirectory("masthead-rehearsal-runner-tmp-");
    const previousTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = isolatedTmp;
    try {
      await expect(runProductionActivationRehearsal(["--bundle", "relative-bundle"])).rejects.toThrow("must be absolute");
      expect(await readdir(isolatedTmp)).toEqual([]);
    } finally {
      if (previousTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpdir;
    }
  });

  test("reports CLI failure with exitCode after cleanup control flow instead of process.exit", async () => {
    const source = await readFile(SCRIPT_PATH, "utf8");

    expect(source).not.toMatch(/\bprocess\.exit\s*\(/u);
    expect(source).toContain("process.exitCode = 1");
  });

  test("proves daemon exit before deleting disposable rehearsal state", async () => {
    const source = await readFile(SCRIPT_PATH, "utf8");
    const cleanupStart = source.indexOf("} finally {");
    const stopAttempt = source.indexOf("await stopChild(daemon)", cleanupStart);
    const preservedFailure = source.indexOf("preserved ${rehearsalRoot}", cleanupStart);
    const removeRoot = source.indexOf("await rm(rehearsalRoot", cleanupStart);

    expect(cleanupStart).toBeGreaterThan(-1);
    expect(stopAttempt).toBeGreaterThan(cleanupStart);
    expect(preservedFailure).toBeGreaterThan(stopAttempt);
    expect(removeRoot).toBeGreaterThan(preservedFailure);
    expect(source.slice(cleanupStart, removeRoot)).not.toContain(".catch(() => undefined)");
  });

  test("uses the default production stop scan and proves the isolated baseline is offline", async () => {
    const source = await readFile(SCRIPT_PATH, "utf8");

    expect(source).not.toContain("readProcesses: async () => []");
    expect(source).toContain("stopProduction(baselineConfig)");
    expect(source).toContain("statusProduction(baselineConfig)");
    expect(source).toContain("baselineStatus.running !== false");
  });
});
