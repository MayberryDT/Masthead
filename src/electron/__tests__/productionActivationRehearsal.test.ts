import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  assertPackageBoundMatrixCoverage,
  runPackageBoundCrashMatrix,
  runProductionActivationRehearsal,
  validateRehearsalBundle
} from "../../../scripts/masthead-production-activation-rehearsal.js";

const TEST_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(TEST_PATH), "../../..");
const SCRIPT_PATH = join(PROJECT_ROOT, "scripts", "masthead-production-activation-rehearsal.js");
const cleanup: string[] = [];
const EXPECTED_PACKAGE_BOUND_CASE_IDS = [
  "stage:candidate-copy:SIGKILL", "stage:instance-stage:SIGKILL", "stage:surface-stage:SIGKILL",
  "stage:receipt-publication:SIGKILL", "stage:intent-removal:SIGKILL",
  "activate:current:SIGKILL", "activate:instance-launcher:SIGKILL", "activate:lifecycle-launcher:SIGKILL",
  "activate:desktop:SIGKILL", "activate:activation-pre-commit:SIGKILL", "activate:activation-commit:SIGKILL",
  "activate:activation-receipt:SIGKILL",
  "finalize:rollback-bundle:SIGKILL", "finalize:rollback-bundle:exit",
  "finalize:staged-0:SIGKILL", "finalize:staged-0:exit",
  "finalize:staged-1:SIGKILL", "finalize:staged-1:exit",
  "finalize:staged-2:SIGKILL", "finalize:staged-2:exit",
  "finalize:receipt:SIGKILL", "finalize:receipt:exit",
  "finalize:journal:SIGKILL", "finalize:journal:exit"
];

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

  test("rejects a temporary parent inside live production before allocating any rehearsal artifact", async () => {
    const home = await temporaryDirectory("masthead-rehearsal-live-tmp-home-");
    const liveProduction = join(home, ".local", "share", "masthead-production");
    const liveTmp = join(liveProduction, "tmp");
    await mkdir(liveTmp, { recursive: true });

    await expect(runProductionActivationRehearsal(
      ["--bundle", join(home, "missing-bundle-outside-production")],
      { HOME: home, TMPDIR: liveTmp }
    )).rejects.toThrow("temporary parent overlaps live production state");
    expect(await readdir(liveTmp)).toEqual([]);
  });

  test("CLI live-temporary-parent refusal exits nonzero without allocating state", async () => {
    const home = await temporaryDirectory("masthead-rehearsal-live-tmp-cli-home-");
    const liveTmp = join(home, ".local", "share", "masthead-production", "tmp");
    await mkdir(liveTmp, { recursive: true });
    const child = spawn(process.execPath, [SCRIPT_PATH, "--bundle", join(home, "missing-bundle")], {
      env: { ...process.env, HOME: home, TMPDIR: liveTmp },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const [code] = await once(child, "close");

    expect(code).toBe(1);
    expect(await readdir(liveTmp)).toEqual([]);
  });

  test("CLI invalid-bundle refusal exits nonzero without allocating state", async () => {
    const isolatedTmp = await temporaryDirectory("masthead-rehearsal-invalid-cli-tmp-");
    const child = spawn(process.execPath, [SCRIPT_PATH, "--bundle", join(isolatedTmp, "missing-bundle")], {
      env: { ...process.env, TMPDIR: isolatedTmp },
      stdio: "ignore"
    });
    const [code] = await once(child, "close");

    expect(code).toBe(1);
    expect(await readdir(isolatedTmp)).toEqual([]);
  });

  test("reports CLI failure with exitCode after cleanup control flow instead of process.exit", async () => {
    const source = await readFile(SCRIPT_PATH, "utf8");

    expect(source).not.toMatch(/\bprocess\.exit\s*\(/u);
    expect(source).toContain("process.exitCode = 1");
  });

  test("proves daemon exit before deleting disposable rehearsal state", async () => {
    const source = await readFile(SCRIPT_PATH, "utf8");
    const cleanupStart = source.indexOf("} finally {");
    const stopAttempt = source.indexOf("runInstalledLifecycleCommand(installedLauncher, [\"stop\"]", cleanupStart);
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
    expect(source).toContain("runPackagedLifecycleCommand(verified, [\"stop\"]");
    expect(source).toContain("runPackagedLifecycleCommand(verified, [\"status\"]");
    expect(source).toContain("baselineStatus.running !== false");
  });

  test("drives the supplied package through lifecycle subprocess JSON commands", async () => {
    const source = await readFile(SCRIPT_PATH, "utf8");

    expect(source).toContain("runPackagedLifecycleCommand");
    expect(source).toContain("runInstalledLifecycleCommand");
    for (const command of ["stage", "activate", "finalize", "start", "stop"]) {
      expect(source).toContain(`\"${command}\"`);
    }
    expect(source).not.toContain("spawnPackagedDaemon(receipt");
    expect(source).not.toContain("await stopChild(daemon)");
  });

  test("pins the exact 24 package-bound crash boundaries independently of the generated matrix", async () => {
    expect(EXPECTED_PACKAGE_BOUND_CASE_IDS).toHaveLength(24);
    expect(new Set(EXPECTED_PACKAGE_BOUND_CASE_IDS).size).toBe(24);
    expect(() => assertPackageBoundMatrixCoverage(EXPECTED_PACKAGE_BOUND_CASE_IDS)).not.toThrow();
    const source = await readFile(SCRIPT_PATH, "utf8");
    expect(source).toContain("await import(process.argv[1])");
    expect(source).not.toContain("node_modules\", \"vitest");
    expect(source).not.toContain("executeCase:");
  });

  test("rejects zero, missing, duplicated, and renamed package-bound matrix cases", () => {
    expect(() => assertPackageBoundMatrixCoverage([])).toThrow("executed 0 of 24 required cases");
    expect(() => assertPackageBoundMatrixCoverage(["stage:candidate-copy:SIGKILL"])).toThrow(
      "executed 1 of 24 required cases"
    );
    const valid = Array.from({ length: 24 }, (_, index) => `case-${index}`);
    expect(() => assertPackageBoundMatrixCoverage(valid.slice(0, -1), valid)).toThrow("executed 23 of 24 required cases");
    expect(() => assertPackageBoundMatrixCoverage([...valid.slice(0, -1), valid[0]], valid)).toThrow("matrix case set changed");
    expect(() => assertPackageBoundMatrixCoverage([...valid.slice(0, -1), "renamed-case"], valid)).toThrow(
      "matrix case set changed"
    );
  });

  test("cannot certify a supplied package whose lifecycle module no longer crashes at a required hook", async () => {
    const root = await temporaryDirectory("masthead-rehearsal-broken-package-");
    const resourcesPath = join(root, "resources");
    const scriptsPath = join(resourcesPath, "daemon", "scripts");
    await mkdir(scriptsPath, { recursive: true });
    await writeFile(join(scriptsPath, "masthead-production.js"), [
      "export async function stageProductionInstallation() { return { staged: true }; }",
      "export async function activateStagedProductionInstallation() { return { activated: true }; }",
      "export async function finalizeStagedProductionInstallation() { return { finalized: true }; }",
      ""
    ].join("\n"));
    const verified = {
      bundle: root,
      layout: {
        bundleRoot: root,
        executablePath: join(root, "masthead"),
        nodePath: process.execPath,
        resourcesPath
      },
      manifest: {
        bundleDigest: "a".repeat(64),
        release: { gitSha: "b".repeat(40), version: "0.1.0" }
      },
      livePaths: []
    };

    await expect(runPackageBoundCrashMatrix(verified, process.env)).rejects.toThrow(
      "stage:candidate-copy:SIGKILL"
    );
  });

});
