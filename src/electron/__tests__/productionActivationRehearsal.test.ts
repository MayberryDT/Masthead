import { createHash } from "node:crypto";
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import * as productionActivationRehearsal from "../../../scripts/masthead-production-activation-rehearsal.js";
import {
  assertPackageBoundMatrixCoverage,
  assertIdentityBoundSignalingAvailable,
  cleanupDisposableRehearsalRoot,
  combineRehearsalAndCleanupFailures,
  formatRehearsalFailure,
  runBoundedFixtureSubprocess,
  runRehearsalCaseWithCleanup,
  runInstalledStartAndFinalizeProof,
  runPackageBoundCrashMatrix,
  runProductionActivationRehearsal,
  selectProductionCompanionIdentities,
  signalFixtureProcessIdentity,
  validateRehearsalBundle,
  waitForExactReadyHealth
} from "../../../scripts/masthead-production-activation-rehearsal.js";
import {
  assertPackageBoundCrashBoundary,
  packageBoundCrashBoundaryContract
} from "../../../scripts/masthead-production-crash-boundaries.js";
import {
  resolvePackagedBundleLayout,
  writePackagedBundleManifest
} from "../../../scripts/packaged-bundle-manifest.js";

const TEST_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(TEST_PATH), "../../..");
const SCRIPT_PATH = join(PROJECT_ROOT, "scripts", "masthead-production-activation-rehearsal.js");
const cleanup: string[] = [];

type ClaimedExternalControlGroup = {
  controlGroup: string;
  startPid: number;
  trustedIdentities: Array<{ pid: number; starttime: string }>;
};

type ClaimedProcessSetAdapters = {
  listFixtureCgroupDirectories?: () => Promise<string[]>;
  readCgroupTreePids: (controlGroup: string) => Promise<number[]>;
  readProcessIdentity: (pid: number) => Promise<{
    pid: number;
    ppid: number;
    starttime: string;
  } | undefined>;
  resolveRegisteredScope: (scopeUnit: string) => Promise<{
    controlGroup?: string;
    pids: number[];
  }>;
};

const inspectClaimedFixtureProcessSetForTest = async (
  input: {
    fixtureRoot: string;
    currentScope: string;
    claimedExternalControlGroups: ClaimedExternalControlGroup[];
    userControlGroupRoot: string;
    deadline?: number;
  },
  adapters: ClaimedProcessSetAdapters
) => (productionActivationRehearsal as unknown as {
  inspectClaimedFixtureProcessSetForTest: (
    helperInput: typeof input,
    helperAdapters: ClaimedProcessSetAdapters
  ) => Promise<Array<{
    controlGroup?: string;
    pid: number;
    ppid: number;
    signalSafe: boolean;
    starttime: string;
  }>>;
}).inspectClaimedFixtureProcessSetForTest(input, adapters);

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

async function validSuppliedLifecycleBundle(root: string, lifecycleSource: string) {
  const bundle = join(root, "bundle");
  const daemonRoot = join(bundle, "resources", "daemon");
  const scriptsRoot = join(daemonRoot, "scripts");
  const distRoot = join(daemonRoot, "dist", "src");
  const nodePath = join(daemonRoot, process.platform === "win32" ? "node.exe" : "node");
  await Promise.all([
    mkdir(scriptsRoot, { recursive: true }),
    mkdir(join(distRoot, "daemon"), { recursive: true }),
    mkdir(join(distRoot, "cli"), { recursive: true }),
    mkdir(join(distRoot, "core"), { recursive: true }),
    mkdir(join(distRoot, "shared"), { recursive: true })
  ]);
  await cp(process.execPath, nodePath);
  await chmod(nodePath, 0o755);
  await Promise.all([
    writeFile(join(bundle, "package.json"), '{"type":"module"}\n'),
    writeFile(join(bundle, process.platform === "win32" ? "masthead.exe" : "masthead"), "test executable\n", { mode: 0o755 }),
    writeFile(join(bundle, "resources", "app.asar"), "test app\n"),
    writeFile(join(bundle, "resources", "masthead-logo-sail.png"), Buffer.from("test logo")),
    writeFile(join(daemonRoot, "release.json"), `${JSON.stringify({ gitSha: "b".repeat(40), version: "test-bundle" })}\n`),
    writeFile(join(scriptsRoot, "masthead-production.js"), lifecycleSource),
    cp(join(PROJECT_ROOT, "scripts", "packaged-bundle-manifest.js"), join(scriptsRoot, "packaged-bundle-manifest.js")),
    cp(join(PROJECT_ROOT, "scripts", "masthead-production-cold-activation.js"), join(scriptsRoot, "masthead-production-cold-activation.js")),
    ...["masthead-hook.js", "resolve-hook-runtime.js"].map((name) => writeFile(join(scriptsRoot, name), "export {};\n")),
    writeFile(join(distRoot, "daemon", "main.js"), "export {};\n"),
    writeFile(join(distRoot, "daemon", "productionTransitionMaintenance.js"), "export {};\n"),
    writeFile(join(distRoot, "cli", "mastheadctl.js"), "export {};\n"),
    writeFile(join(distRoot, "core", "daemonOwnership.js"), "export {};\n"),
    writeFile(join(distRoot, "shared", "protocol.js"), "export {};\n")
  ]);
  const layout = await resolvePackagedBundleLayout(bundle, process.platform);
  const manifest = await writePackagedBundleManifest(layout);
  if (!layout.nodePath) throw new Error("valid test bundle has no packaged Node runtime");
  return { bundle, layout: { ...layout, nodePath: layout.nodePath }, manifest, livePaths: [] };
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
    const runnerStart = source.indexOf("export async function runProductionActivationRehearsal");
    const cleanupStart = source.indexOf("} finally {", runnerStart);
    const stopAttempt = source.indexOf("runInstalledLifecycleCommand(installedLauncher, [\"stop\"]", cleanupStart);
    const removeRoot = source.indexOf("await cleanupDisposableRehearsalRoot(rehearsalRoot", cleanupStart);
    const preservedFailure = source.indexOf("combineRehearsalAndCleanupFailures(rehearsalRoot", cleanupStart);

    expect(cleanupStart).toBeGreaterThan(-1);
    expect(stopAttempt).toBeGreaterThan(cleanupStart);
    expect(removeRoot).toBeGreaterThan(stopAttempt);
    expect(preservedFailure).toBeGreaterThan(removeRoot);
    expect(source.slice(cleanupStart, removeRoot)).not.toContain(".catch(() => undefined)");
    expect(source.slice(cleanupStart, stopAttempt)).not.toContain("preserveFixtureRoot");
    expect(source).toContain("failure.preserveFixtureRoot = true");
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

  test.skipIf(process.platform === "win32")("times out and terminates the complete fixture-bound process set", async () => {
    const root = await temporaryDirectory("masthead-rehearsal-bounded-process-set-");
    const descendantPidPath = join(root, "descendant.pid");
    const source = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { env: process.env, stdio: 'ignore' });",
      "writeFileSync(process.argv[1], String(child.pid));",
      "setInterval(() => undefined, 1000);"
    ].join("\n");

    await expect(runBoundedFixtureSubprocess(process.execPath, ["-e", source, descendantPidPath], {
      environment: process.env,
      fixtureRoot: root,
      postKillTimeoutMs: 1_000,
      timeoutMs: 100
    })).rejects.toThrow("timed out after 100ms");

    const descendantPid = Number(await readFile(descendantPidPath, "utf8"));
    expect(Number.isSafeInteger(descendantPid)).toBe(true);
    const statLine = await readFile(`/proc/${descendantPid}/stat`, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    const close = statLine?.lastIndexOf(")") ?? -1;
    const state = close < 0 ? undefined : statLine?.slice(close + 2).trim().split(/\s+/u)[0];
    expect(state === undefined || state === "Z").toBe(true);
  });

  test("bounds post-kill proof independently and marks uncertain fixture roots for preservation", async () => {
    const root = await temporaryDirectory("masthead-rehearsal-uncertain-process-set-");
    const startedAt = Date.now();
    let failure: unknown;
    try {
      await runBoundedFixtureSubprocess(process.execPath, ["-e", "setTimeout(() => undefined, 300)"], {
        environment: process.env,
        fixtureRoot: root,
        postKillTimeoutMs: 40,
        processSetAdapters: {
          inspect: async () => [{ pid: 999_999, starttime: "fixture-descendant" }],
          signalIdentity: async () => ({ status: "signaled" })
        },
        timeoutMs: 20
      });
    } catch (error) {
      failure = error;
    }

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(failure).toMatchObject({ preserveFixtureRoot: true, fixtureRoot: root });
    await expect(cleanupDisposableRehearsalRoot(root, failure)).resolves.toBe(false);
    await expect(readdir(root)).resolves.toEqual([]);
  });

  test("clears its deadline when the contained executable cannot start", async () => {
    const root = await temporaryDirectory("masthead-rehearsal-spawn-error-");
    const timeoutsBefore = process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;

    await expect(runBoundedFixtureSubprocess(join(root, "missing-node"), [], {
      environment: process.env,
      fixtureRoot: root,
      timeoutMs: 30_000
    })).resolves.toMatchObject({ code: 1, stderr: expect.stringContaining("No such file or directory") });
    await new Promise((resolvePromise) => setImmediate(resolvePromise));

    expect(process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length).toBeLessThanOrEqual(timeoutsBefore);
  });

  test.skipIf(process.platform !== "linux")("terminates and preserves a fixture whose subprocess exceeds its combined output limit", async () => {
    const root = await temporaryDirectory("masthead-rehearsal-output-limit-");
    const source = [
      "process.stdout.write(Buffer.alloc(256 * 1024, 120));",
      "setInterval(() => undefined, 1000);"
    ].join("\n");
    const startedAt = Date.now();
    let failure: unknown;

    try {
      await runBoundedFixtureSubprocess(process.execPath, ["-e", source], {
        environment: process.env,
        fixtureRoot: root,
        maxOutputBytes: 1_024,
        postKillTimeoutMs: 1_000,
        timeoutMs: 2_000
      });
    } catch (error) {
      failure = error;
    }

    expect(Date.now() - startedAt).toBeLessThan(1_500);
    expect(failure).toMatchObject({ preserveFixtureRoot: true, fixtureRoot: root });
    expect(String(failure)).toContain("combined stdout/stderr limit of 1024 bytes");
    await expect(cleanupDisposableRehearsalRoot(root, failure)).resolves.toBe(false);
  });

  test.skipIf(process.platform !== "linux")("rejects and cleans a detached descendant that removes the fixture marker", async () => {
    const root = await temporaryDirectory("masthead-rehearsal-normal-exit-leak-");
    const descendantPidPath = join(root, "descendant.pid");
    const source = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const child = spawn(process.execPath, ['-e', 'setTimeout(() => undefined, 1000)'], { detached: true, env: { PATH: process.env.PATH }, stdio: 'ignore' });",
      "writeFileSync(process.argv[1], String(child.pid));",
      "child.unref();"
    ].join("\n");

    await expect(runBoundedFixtureSubprocess(process.execPath, ["-e", source, descendantPidPath], {
      environment: process.env,
      fixtureRoot: root,
      postKillTimeoutMs: 500,
      timeoutMs: 2_000
    })).rejects.toThrow("left unexpected fixture processes");

    const descendantPid = Number(await readFile(descendantPidPath, "utf8"));
    const statLine = await readFile(`/proc/${descendantPid}/stat`, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    const close = statLine?.lastIndexOf(")") ?? -1;
    const state = close < 0 ? undefined : statLine?.slice(close + 2).trim().split(/\s+/u)[0];
    expect(state === undefined || state === "Z").toBe(true);
  });

  test("gives just-stopped companions a bounded natural-exit grace before classifying them as leaks", async () => {
    const root = await temporaryDirectory("masthead-rehearsal-natural-exit-grace-");
    const companion = { pid: 999_998, starttime: "stopping-companion" };
    let scans = 0;
    let signals = 0;

    await expect(runBoundedFixtureSubprocess(process.execPath, ["-e", ""], {
      environment: process.env,
      fixtureRoot: root,
      naturalExitGraceMs: 100,
      postKillTimeoutMs: 250,
      processSetAdapters: {
        inspect: async () => scans++ < 2 ? [companion] : [],
        signalIdentity: async () => {
          signals += 1;
          return { status: "signaled" };
        }
      },
      timeoutMs: 1_000
    })).resolves.toMatchObject({ code: 0, allowedLiveIdentities: [] });

    expect(signals).toBe(0);
  });

  test("uses one identity-bound signal operation and accepts a reused result safely", async () => {
    const root = await temporaryDirectory("masthead-rehearsal-pid-reuse-");
    let scans = 0;
    let signals = 0;

    await expect(runBoundedFixtureSubprocess(process.execPath, ["-e", "setTimeout(() => undefined, 80)"], {
      environment: process.env,
      fixtureRoot: root,
      postKillTimeoutMs: 250,
      processSetAdapters: {
        inspect: async () => scans++ === 0 ? [{ pid: 999_999, starttime: "reused" }] : [],
        signalIdentity: async (record) => {
          expect(record).toEqual({ pid: 999_999, starttime: "reused" });
          signals += 1;
          return { status: "reused", observedStarttime: "replacement" };
        }
      },
      timeoutMs: 20
    })).rejects.toThrow();

    expect(signals).toBe(1);
  });

  test("ignores membership churn in an unrelated pre-existing Codex scope", async () => {
    const fixtureRoot = "/fixture/rehearsal";
    const userControlGroupRoot = "/user.slice/user-1000.slice/user@1000.service";
    let globalTreeScans = 0;

    await expect(inspectClaimedFixtureProcessSetForTest({
      claimedExternalControlGroups: [],
      currentScope: "masthead-rehearsal-owned.scope",
      fixtureRoot,
      userControlGroupRoot
    }, {
      listFixtureCgroupDirectories: async () => {
        globalTreeScans += 1;
        return [`${userControlGroupRoot}/app.slice/app-codex-existing.scope`];
      },
      readCgroupTreePids: async () => [],
      readProcessIdentity: async () => undefined,
      resolveRegisteredScope: async () => ({
        controlGroup: `${userControlGroupRoot}/app.slice/masthead-rehearsal-owned.scope`,
        pids: []
      })
    })).resolves.toEqual([]);

    expect(globalTreeScans).toBe(0);
  });

  test("accepts only the exact claimed app-masthead scope for the trusted Electron PID", async () => {
    const fixtureRoot = "/fixture/rehearsal";
    const userControlGroupRoot = "/user.slice/user-1000.slice/user@1000.service";
    const controlGroup = `${userControlGroupRoot}/app.slice/app-masthead-101.scope`;
    const identities = new Map([
      [101, { pid: 101, ppid: 1, starttime: "electron-start" }],
      [202, { pid: 202, ppid: 101, starttime: "daemon-start" }]
    ]);

    const observed = await inspectClaimedFixtureProcessSetForTest({
      claimedExternalControlGroups: [{
        controlGroup,
        startPid: 101,
        trustedIdentities: [{ pid: 101, starttime: "electron-start" }]
      }],
      currentScope: "masthead-rehearsal-owned.scope",
      fixtureRoot,
      userControlGroupRoot
    }, {
      readCgroupTreePids: async (requested) => requested === controlGroup ? [101, 202] : [],
      readProcessIdentity: async (pid) => identities.get(pid),
      resolveRegisteredScope: async () => ({ pids: [] })
    });

    expect(observed).toEqual([
      { controlGroup, pid: 101, ppid: 1, signalSafe: false, starttime: "electron-start" },
      { controlGroup, pid: 202, ppid: 101, signalSafe: false, starttime: "daemon-start" }
    ]);
    expect(selectProductionCompanionIdentities(
      { started: true, pid: 101 },
      { runtime: { pid: 202 } },
      observed
    )).toEqual(observed);
  });

  test("fails closed when a claimed app-masthead scope names the wrong start PID", async () => {
    const fixtureRoot = "/fixture/rehearsal";
    const userControlGroupRoot = "/user.slice/user-1000.slice/user@1000.service";
    const controlGroup = `${userControlGroupRoot}/app.slice/app-masthead-999.scope`;

    await expect(inspectClaimedFixtureProcessSetForTest({
      claimedExternalControlGroups: [{
        controlGroup,
        startPid: 101,
        trustedIdentities: [{ pid: 101, starttime: "electron-start" }]
      }],
      currentScope: "masthead-rehearsal-owned.scope",
      fixtureRoot,
      userControlGroupRoot
    }, {
      readCgroupTreePids: async () => [101],
      readProcessIdentity: async () => ({ pid: 101, ppid: 1, starttime: "electron-start" }),
      resolveRegisteredScope: async () => ({ pids: [] })
    })).rejects.toThrow("does not match trusted Electron PID 101");
  });

  test("fails closed when a claimed app-masthead scope is outside the user cgroup subtree", async () => {
    const fixtureRoot = "/fixture/rehearsal";
    const userControlGroupRoot = "/user.slice/user-1000.slice/user@1000.service";

    await expect(inspectClaimedFixtureProcessSetForTest({
      claimedExternalControlGroups: [{
        controlGroup: "/system.slice/app-masthead-101.scope",
        startPid: 101,
        trustedIdentities: [{ pid: 101, starttime: "electron-start" }]
      }],
      currentScope: "masthead-rehearsal-owned.scope",
      fixtureRoot,
      userControlGroupRoot
    }, {
      readCgroupTreePids: async () => [101],
      readProcessIdentity: async () => ({ pid: 101, ppid: 1, starttime: "electron-start" }),
      resolveRegisteredScope: async () => ({ pids: [] })
    })).rejects.toThrow("outside the user cgroup subtree");
  });

  test("fails closed when a trusted claimed-scope PID has been reused", async () => {
    const fixtureRoot = "/fixture/rehearsal";
    const userControlGroupRoot = "/user.slice/user-1000.slice/user@1000.service";
    const controlGroup = `${userControlGroupRoot}/app.slice/app-masthead-101.scope`;

    await expect(inspectClaimedFixtureProcessSetForTest({
      claimedExternalControlGroups: [{
        controlGroup,
        startPid: 101,
        trustedIdentities: [{ pid: 101, starttime: "electron-start" }]
      }],
      currentScope: "masthead-rehearsal-owned.scope",
      fixtureRoot,
      userControlGroupRoot
    }, {
      readCgroupTreePids: async () => [101],
      readProcessIdentity: async () => ({ pid: 101, ppid: 1, starttime: "replacement-start" }),
      resolveRegisteredScope: async () => ({ pids: [] })
    })).rejects.toThrow("trusted process identity changed for PID 101");
  });

  test("fails closed when a trusted claimed-scope identity is unreadable", async () => {
    const fixtureRoot = "/fixture/rehearsal";
    const userControlGroupRoot = "/user.slice/user-1000.slice/user@1000.service";
    const controlGroup = `${userControlGroupRoot}/app.slice/app-masthead-101.scope`;

    await expect(inspectClaimedFixtureProcessSetForTest({
      claimedExternalControlGroups: [{
        controlGroup,
        startPid: 101,
        trustedIdentities: [{ pid: 101, starttime: "electron-start" }]
      }],
      currentScope: "masthead-rehearsal-owned.scope",
      fixtureRoot,
      userControlGroupRoot
    }, {
      readCgroupTreePids: async () => [101],
      readProcessIdentity: async () => undefined,
      resolveRegisteredScope: async () => ({ pids: [] })
    })).rejects.toThrow("trusted process identity is unreadable for PID 101");
  });

  test("never signals an unexpected process attributed to a claimed external scope", async () => {
    const root = await temporaryDirectory("masthead-rehearsal-claimed-external-");
    let signalCalls = 0;
    let failure: unknown;

    try {
      await runBoundedFixtureSubprocess(process.execPath, ["-e", ""], {
        environment: process.env,
        fixtureRoot: root,
        naturalExitGraceMs: 0,
        postKillTimeoutMs: 250,
        processSetAdapters: {
          inspect: async () => [{
            controlGroup: "/user.slice/user-1000.slice/user@1000.service/app.slice/app-masthead-401.scope",
            pid: 401,
            ppid: 1,
            signalSafe: false,
            starttime: "external-start"
          }],
          signalIdentity: async () => {
            signalCalls += 1;
            return { status: "signaled" };
          }
        },
        timeoutMs: 1_000
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      cause: { message: expect.stringContaining("preserved without signaling") }
    });
    expect(signalCalls).toBe(0);
  });

  test("kills a detached marker-cleared descendant found in an owned registered scope", async () => {
    const root = await temporaryDirectory("masthead-rehearsal-owned-scope-descendant-");
    const userControlGroupRoot = "/user.slice/user-1000.slice/user@1000.service";
    const ownedControlGroup = `${userControlGroupRoot}/app.slice/masthead-rehearsal-owned.scope`;
    const descendant = { pid: 303, ppid: 1, starttime: "detached-start" };
    const observed = await inspectClaimedFixtureProcessSetForTest({
      claimedExternalControlGroups: [],
      currentScope: "masthead-rehearsal-owned.scope",
      fixtureRoot: root,
      userControlGroupRoot
    }, {
      readCgroupTreePids: async () => [],
      readProcessIdentity: async (pid) => pid === descendant.pid ? descendant : undefined,
      resolveRegisteredScope: async () => ({ controlGroup: ownedControlGroup, pids: [descendant.pid] })
    });
    let scans = 0;
    const signals: Array<{ record: unknown; signal: string }> = [];

    expect(observed).toEqual([{ ...descendant, signalSafe: true }]);
    await expect(runBoundedFixtureSubprocess(process.execPath, ["-e", ""], {
      environment: process.env,
      fixtureRoot: root,
      naturalExitGraceMs: 0,
      postKillTimeoutMs: 250,
      processSetAdapters: {
        inspect: async () => scans++ === 0 ? observed : [],
        signalIdentity: async (record, signal) => {
          signals.push({ record, signal });
          return { status: "signaled" };
        }
      },
      timeoutMs: 1_000
    })).rejects.toThrow("left unexpected fixture processes: 303");

    expect(signals).toEqual([{ record: { ...descendant, signalSafe: true }, signal: "SIGKILL" }]);
  });

  test.skipIf(process.platform !== "linux")("signals only the pidfd-bound process identity", async () => {
    await expect(assertIdentityBoundSignalingAvailable()).resolves.toBeUndefined();
    const child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], { stdio: "ignore" });
    try {
      const statLine = await readFile(`/proc/${child.pid}/stat`, "utf8");
      const close = statLine.lastIndexOf(")");
      const starttime = statLine.slice(close + 2).trim().split(/\s+/u)[19];
      await expect(signalFixtureProcessIdentity(
        { pid: child.pid!, starttime: `${starttime}-replacement` },
        "SIGKILL"
      )).resolves.toMatchObject({ status: "reused", observedStarttime: starttime });
      expect(() => process.kill(child.pid!, 0)).not.toThrow();
      await expect(signalFixtureProcessIdentity(
        { pid: child.pid!, starttime },
        "SIGKILL"
      )).resolves.toEqual({ status: "signaled" });
      await once(child, "close");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  });

  test.skipIf(process.platform !== "linux")("does not misclassify an ordinary exit 137 as SIGKILL", async () => {
    const root = await temporaryDirectory("masthead-rehearsal-exit-137-");
    await expect(runBoundedFixtureSubprocess(process.execPath, ["-e", "process.exit(137)"], {
      environment: process.env,
      fixtureRoot: root,
      timeoutMs: 2_000
    })).resolves.toMatchObject({ code: 137, signal: null });
  });

  test.skipIf(process.platform !== "linux")("allows only explicitly captured live companion identities after child exit", async () => {
    const root = await temporaryDirectory("masthead-rehearsal-allowed-companion-");
    const source = [
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'setTimeout(() => undefined, 300)'], { env: process.env, stdio: 'ignore' });",
      "child.unref();"
    ].join("\n");

    const result = await runBoundedFixtureSubprocess(process.execPath, ["-e", source], {
      captureAllowedLiveIdentities: async ({ inspectProcesses }) => {
        const processes = await inspectProcesses();
        expect(processes).toHaveLength(1);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
        return inspectProcesses();
      },
      environment: process.env,
      fixtureRoot: root,
      postKillTimeoutMs: 500,
      timeoutMs: 2_000
    });

    expect(result.allowedLiveIdentities).toHaveLength(1);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
  });

  test("binds every operational child to the bounded fixture subprocess runner", async () => {
    const source = await readFile(SCRIPT_PATH, "utf8");

    expect(source).toContain("runBoundedFixtureSubprocess");
    expect(source).not.toContain("await once(child, \"close\")");
    expect(source).toContain("postKillTimeoutMs");
    expect(source).toContain("cleanupDisposableRehearsalRoot");
    expect(source).toContain("SYSTEMD_RUN_PATH");
    expect(source).toContain("cgroup.procs");
    expect(source).not.toContain("fixtureCgroupBaselines");
    expect(source).not.toContain("listFixtureCgroupDirectories");
    expect(source).not.toContain("snapshotCgroupMemberships");
    expect(source).toContain("fixtureExternalClaims");
    expect(source).toContain("app-masthead-${claim.startPid}.scope");
    expect(source).toContain("Fixture process set exceeded its bounded identity limit");
    expect(source).toContain("unexpected in a claimed external cgroup; preserved without signaling");
    expect(source).not.toContain("registerFixtureProcessCgroup");
    expect(source).not.toContain("identityMatches");
    expect(source).not.toContain("process.kill(pid, signal)");
    expect(source).not.toContain("stdio: \"inherit\"");
    expect(source).toContain("Claimed external scope process identity is unreadable");
  });

  test("uses packaged default offline and exact live proofs in the crash matrix", async () => {
    const source = await readFile(SCRIPT_PATH, "utf8");

    expect(source).not.toContain("assertOffline: async () => undefined");
    expect(source).not.toContain("verifyLiveProof: async () => undefined");
    expect(source).not.toContain("assertManifestWriterGuard: async () => undefined");
    expect(source).not.toContain("readProcess: async");
    expect(source).not.toContain("fetchHealth: async");
    expect(source).toContain("captureProductionCompanionIdentities");
    expect(source).toContain("startInstalledLifecycleWithIdentityCapture");
    expect(source).toMatch(/runInstalledLifecycleCommand\(\s+receipt\.stagedSurface\.launcherPath,\s+\["stop"\]/u);
    expect(source).not.toContain("startMatrixLiveProofDaemon");
  });

  test("carries exact identities from installed start into operational finalize", async () => {
    const identities = [
      { pid: 202, starttime: "daemon-start" }
    ];
    const receipt = {
      receiptPath: "/fixture/receipt.json",
      baseUrl: "http://127.0.0.1:12345",
      instanceDir: "/fixture/instance",
      instanceManifestPath: "/fixture/instance/masthead-instance.json",
      activeInstanceLauncherPath: "/fixture/instance/mastheadctl",
      dataDirectory: "/fixture/data",
      databasePath: "/fixture/data/masthead.sqlite",
      buildSha: "a".repeat(40)
    };
    const calls: Array<{ args: string[]; options: Record<string, unknown> }> = [];
    let startAttempts = 0;
    const runLifecycleCommand = async (_launcher: string, args: string[], _environment: NodeJS.ProcessEnv, options = {}) => {
      calls.push({ args, options });
      if (args[0] === "start") {
        startAttempts += 1;
        if (startAttempts === 1) throw new Error("Production process command line changed during scan.");
        return { started: true, fixtureProcessIdentities: identities };
      }
      return { finalized: true };
    };

    await expect(runInstalledStartAndFinalizeProof("/fixture/launcher", receipt, {}, {
      fetchHealth: async () => ({
        ok: true,
        buildSha: receipt.buildSha,
        runtime: {
          mode: "primary",
          writable: true,
          baseUrl: receipt.baseUrl,
          instanceDir: receipt.instanceDir,
          instanceManifest: receipt.instanceManifestPath,
          authoringCommand: receipt.activeInstanceLauncherPath
        },
        data: {
          dataDirectory: receipt.dataDirectory,
          databasePath: receipt.databasePath,
          migrationState: "ready"
        }
      }),
      runLifecycleCommand
    })).resolves.toMatchObject({ fixtureProcessIdentities: identities });

    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ args: ["start"], options: { captureAllowedLiveIdentities: expect.any(Function) } });
    expect(calls[1]).toMatchObject({ args: ["start"], options: { captureAllowedLiveIdentities: expect.any(Function) } });
    expect(calls[2]).toEqual({
      args: ["finalize", "--receipt", receipt.receiptPath],
      options: { allowedLiveIdentities: identities }
    });
  });

  test("captures genuine fixture-marked descendants of the exact Electron and daemon roots", () => {
    const observed = [
      { pid: 101, ppid: 1, starttime: "electron" },
      { pid: 202, ppid: 101, starttime: "daemon" },
      { pid: 303, ppid: 101, starttime: "chromium-child" },
      { pid: 404, ppid: 303, starttime: "chromium-grandchild" }
    ];

    expect(selectProductionCompanionIdentities(
      { started: true, pid: 101 },
      { runtime: { pid: 202 } },
      observed
    )).toEqual(observed);
  });

  test("accepts a live daemon whose trusted Electron bootstrap exited after spawning it", () => {
    const observed = [
      { pid: 202, ppid: 101, starttime: "daemon" },
      { pid: 303, ppid: 202, starttime: "daemon-child" }
    ];

    expect(selectProductionCompanionIdentities(
      { started: true, pid: 101 },
      { runtime: { pid: 202 } },
      observed
    )).toEqual(observed);
  });

  test("rejects capture when the exact health daemon PID is not live", () => {
    const observed = [
      { pid: 101, ppid: 1, starttime: "electron" },
      { pid: 303, ppid: 101, starttime: "chromium-child" }
    ];

    expect(() => selectProductionCompanionIdentities(
      { started: true, pid: 101 },
      { runtime: { pid: 202 } },
      observed
    )).toThrow("expected live daemon PID 202 was not observed");
  });

  test("rejects an unrelated marked process with complete observed identity diagnostics", () => {
    const observed = [
      { pid: 101, ppid: 1, starttime: "electron" },
      { pid: 202, ppid: 101, starttime: "daemon" },
      { pid: 505, ppid: 1, starttime: "unrelated" }
    ];

    expect(() => selectProductionCompanionIdentities(
      { started: true, pid: 101 },
      { runtime: { pid: 202 } },
      observed
    )).toThrow("observed=101/1/electron,202/101/daemon,505/1/unrelated");
  });

  test("waits through transient health states until the exact candidate is ready", async () => {
    const receipt = {
      baseUrl: "http://127.0.0.1:12345",
      instanceDir: "/fixture/instance",
      instanceManifestPath: "/fixture/instance/masthead-instance.json",
      activeInstanceLauncherPath: "/fixture/instance/mastheadctl",
      dataDirectory: "/fixture/data",
      databasePath: "/fixture/data/masthead.sqlite",
      buildSha: "a".repeat(40)
    };
    const exactHealth = {
      ok: true,
      buildSha: receipt.buildSha,
      runtime: {
        mode: "primary",
        writable: true,
        baseUrl: receipt.baseUrl,
        instanceDir: receipt.instanceDir,
        instanceManifest: receipt.instanceManifestPath,
        authoringCommand: receipt.activeInstanceLauncherPath
      },
      data: {
        dataDirectory: receipt.dataDirectory,
        databasePath: receipt.databasePath,
        migrationState: "ready"
      }
    };
    let attempts = 0;

    await expect(waitForExactReadyHealth(receipt, {
      fetchHealth: async () => {
        attempts += 1;
        if (attempts === 1) return undefined;
        if (attempts === 2) return { ok: false, runtime: { mode: "starting" } };
        return exactHealth;
      },
      retryDelayMs: 1,
      timeoutMs: 100
    })).resolves.toBe(exactHealth);
    expect(attempts).toBe(3);
  });

  test("bounds exact health readiness at a hard deadline", async () => {
    const startedAt = Date.now();
    let attempts = 0;

    await expect(waitForExactReadyHealth({
      baseUrl: "http://127.0.0.1:12345",
      instanceDir: "/fixture/instance",
      instanceManifestPath: "/fixture/instance/masthead-instance.json",
      activeInstanceLauncherPath: "/fixture/instance/mastheadctl",
      dataDirectory: "/fixture/data",
      databasePath: "/fixture/data/masthead.sqlite",
      buildSha: "a".repeat(40)
    }, {
      fetchHealth: async () => { attempts += 1; return undefined; },
      retryDelayMs: 1,
      timeoutMs: 20
    })).rejects.toThrow("exact ready primary health before 20ms deadline");

    expect(attempts).toBeGreaterThan(1);
    expect(Date.now() - startedAt).toBeLessThan(250);
  });

  test("preserves the original rehearsal failure and cleanup failure together", () => {
    const original = new Error("finalize failed");
    const cleanupFailure = new Error("stop proof failed");
    const failure = combineRehearsalAndCleanupFailures("/fixture/root", original, cleanupFailure);

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({
      preserveFixtureRoot: true,
      fixtureRoot: "/fixture/root",
      errors: [original, cleanupFailure]
    });
    expect(formatRehearsalFailure(failure)).toContain("finalize failed");
    expect(formatRehearsalFailure(failure)).toContain("stop proof failed");
  });

  test("retains a fixture-preserving body failure when finalization cleanup also fails", async () => {
    const bodyFailure = Object.assign(new Error("boundary proof uncertain"), {
      preserveFixtureRoot: true,
      fixtureRoot: "/fixture/root"
    });
    const cleanupFailure = new Error("identity-bound stop proof failed");
    let failure: unknown;

    try {
      await runRehearsalCaseWithCleanup(
        "/fixture/root",
        async () => { throw bodyFailure; },
        async () => { throw cleanupFailure; }
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      preserveFixtureRoot: true,
      fixtureRoot: "/fixture/root",
      errors: [bodyFailure, cleanupFailure]
    });
    expect(formatRehearsalFailure(failure)).toContain("boundary proof uncertain");
    expect(formatRehearsalFailure(failure)).toContain("identity-bound stop proof failed");
  });

  test("stages the actual verified supplied bundle as the package-bound candidate", async () => {
    const source = await readFile(SCRIPT_PATH, "utf8");

    expect(source).toContain("sourceBundlePath: context.verified.bundle");
    expect(source).toContain("bundleDigest: context.verified.manifest.bundleDigest");
    expect(source).not.toContain("runnableCandidate");
    expect(source).not.toContain("matrixLiveProofDaemonSource");
    expect(source).not.toContain("matrixOwnershipProbeSource");
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

  test("maps every required crash hook to an exact durable boundary contract", () => {
    const contract = packageBoundCrashBoundaryContract();

    expect(Object.keys(contract)).toEqual(EXPECTED_PACKAGE_BOUND_CASE_IDS);
    expect(contract).toEqual({
      "stage:candidate-copy:SIGKILL": { current: "baseline", journalPhase: null, ownedStageCount: 0, present: ["stage-intent", "candidate"], absent: ["instance-stage", "lifecycle-stage", "desktop-stage", "pending-receipt", "receipt"] },
      "stage:instance-stage:SIGKILL": { current: "baseline", journalPhase: null, ownedStageCount: 3, present: ["stage-intent", "candidate", "instance-stage"], absent: ["lifecycle-stage", "desktop-stage", "pending-receipt", "receipt"] },
      "stage:surface-stage:SIGKILL": { current: "baseline", journalPhase: null, ownedStageCount: 3, present: ["stage-intent", "candidate", "instance-stage", "lifecycle-stage", "desktop-stage"], absent: ["pending-receipt", "receipt"] },
      "stage:receipt-publication:SIGKILL": { current: "baseline", journalPhase: null, ownedStageCount: 3, present: ["stage-intent", "candidate", "instance-stage", "lifecycle-stage", "desktop-stage", "pending-receipt", "receipt"], absent: [] },
      "stage:intent-removal:SIGKILL": { current: "baseline", journalPhase: null, ownedStageCount: null, present: ["candidate", "instance-stage", "lifecycle-stage", "desktop-stage", "pending-receipt", "receipt"], absent: ["stage-intent"] },
      "activate:current:SIGKILL": { current: "candidate", journalPhase: "before-current", present: ["candidate", "journal", "receipt-before", "journal-receipt-before", "instance-stage", "lifecycle-stage", "desktop-stage"], absent: ["stage-intent", "pending-receipt", "receipt-after", "journal-receipt-after", "instance-active", "lifecycle-active", "desktop-active"] },
      "activate:instance-launcher:SIGKILL": { current: "candidate", journalPhase: "before-instance-launcher", present: ["candidate", "journal", "receipt-before", "journal-receipt-before", "instance-stage", "lifecycle-stage", "desktop-stage", "instance-active"], absent: ["stage-intent", "pending-receipt", "receipt-after", "journal-receipt-after", "lifecycle-active", "desktop-active"] },
      "activate:lifecycle-launcher:SIGKILL": { current: "candidate", journalPhase: "before-lifecycle-launcher", present: ["candidate", "journal", "receipt-before", "journal-receipt-before", "instance-stage", "lifecycle-stage", "desktop-stage", "instance-active", "lifecycle-active"], absent: ["stage-intent", "pending-receipt", "receipt-after", "journal-receipt-after", "desktop-active"] },
      "activate:desktop:SIGKILL": { current: "candidate", journalPhase: "before-desktop", present: ["candidate", "journal", "receipt-before", "journal-receipt-before", "instance-stage", "lifecycle-stage", "desktop-stage", "instance-active", "lifecycle-active", "desktop-active"], absent: ["stage-intent", "pending-receipt", "receipt-after", "journal-receipt-after"] },
      "activate:activation-pre-commit:SIGKILL": { current: "candidate", journalPhase: "before-activation-commit", present: ["candidate", "journal", "receipt-before", "journal-receipt-after", "instance-stage", "lifecycle-stage", "desktop-stage", "instance-active", "lifecycle-active", "desktop-active"], absent: ["stage-intent", "pending-receipt", "receipt-after", "journal-receipt-before"] },
      "activate:activation-commit:SIGKILL": { current: "candidate", journalPhase: "activation-committed", present: ["candidate", "journal", "receipt-before", "journal-receipt-after", "instance-stage", "lifecycle-stage", "desktop-stage", "instance-active", "lifecycle-active", "desktop-active"], absent: ["stage-intent", "pending-receipt", "receipt-after", "journal-receipt-before"] },
      "activate:activation-receipt:SIGKILL": { current: "candidate", journalPhase: "activation-committed", present: ["candidate", "journal", "receipt-after", "journal-receipt-after", "instance-stage", "lifecycle-stage", "desktop-stage", "instance-active", "lifecycle-active", "desktop-active"], absent: ["stage-intent", "pending-receipt", "receipt-before", "journal-receipt-before"] },
      "finalize:rollback-bundle:SIGKILL": { current: "candidate", journalPhase: "finalize-cleanup-after-artifact-<rollback-bundle-basename>", present: ["candidate", "receipt", "journal", "instance-stage", "lifecycle-stage", "desktop-stage", "instance-active", "lifecycle-active", "desktop-active"], absent: ["rollback-bundle", "completion-marker"] },
      "finalize:rollback-bundle:exit": { current: "candidate", journalPhase: "finalize-cleanup-after-artifact-<rollback-bundle-basename>", present: ["candidate", "receipt", "journal", "instance-stage", "lifecycle-stage", "desktop-stage", "instance-active", "lifecycle-active", "desktop-active"], absent: ["rollback-bundle", "completion-marker"] },
      "finalize:staged-0:SIGKILL": { current: "candidate", journalPhase: "finalize-cleanup-after-staged-0", present: ["candidate", "receipt", "journal", "lifecycle-stage", "desktop-stage", "instance-active", "lifecycle-active", "desktop-active"], absent: ["rollback-bundle", "instance-stage", "completion-marker"] },
      "finalize:staged-0:exit": { current: "candidate", journalPhase: "finalize-cleanup-after-staged-0", present: ["candidate", "receipt", "journal", "lifecycle-stage", "desktop-stage", "instance-active", "lifecycle-active", "desktop-active"], absent: ["rollback-bundle", "instance-stage", "completion-marker"] },
      "finalize:staged-1:SIGKILL": { current: "candidate", journalPhase: "finalize-cleanup-after-staged-1", present: ["candidate", "receipt", "journal", "desktop-stage", "instance-active", "lifecycle-active", "desktop-active"], absent: ["rollback-bundle", "instance-stage", "lifecycle-stage", "completion-marker"] },
      "finalize:staged-1:exit": { current: "candidate", journalPhase: "finalize-cleanup-after-staged-1", present: ["candidate", "receipt", "journal", "desktop-stage", "instance-active", "lifecycle-active", "desktop-active"], absent: ["rollback-bundle", "instance-stage", "lifecycle-stage", "completion-marker"] },
      "finalize:staged-2:SIGKILL": { current: "candidate", journalPhase: "finalize-cleanup-after-staged-2", present: ["candidate", "receipt", "journal", "instance-active", "lifecycle-active", "desktop-active"], absent: ["rollback-bundle", "instance-stage", "lifecycle-stage", "desktop-stage", "completion-marker"] },
      "finalize:staged-2:exit": { current: "candidate", journalPhase: "finalize-cleanup-after-staged-2", present: ["candidate", "receipt", "journal", "instance-active", "lifecycle-active", "desktop-active"], absent: ["rollback-bundle", "instance-stage", "lifecycle-stage", "desktop-stage", "completion-marker"] },
      "finalize:receipt:SIGKILL": { current: "candidate", journalPhase: "finalize-cleanup-after-receipt", present: ["candidate", "journal", "completion-marker", "instance-active", "lifecycle-active", "desktop-active"], absent: ["rollback-bundle", "instance-stage", "lifecycle-stage", "desktop-stage", "receipt"] },
      "finalize:receipt:exit": { current: "candidate", journalPhase: "finalize-cleanup-after-receipt", present: ["candidate", "journal", "completion-marker", "instance-active", "lifecycle-active", "desktop-active"], absent: ["rollback-bundle", "instance-stage", "lifecycle-stage", "desktop-stage", "receipt"] },
      "finalize:journal:SIGKILL": { current: "candidate", journalPhase: null, present: ["candidate", "completion-marker", "instance-active", "lifecycle-active", "desktop-active"], absent: ["rollback-bundle", "instance-stage", "lifecycle-stage", "desktop-stage", "receipt", "journal"] },
      "finalize:journal:exit": { current: "candidate", journalPhase: null, present: ["candidate", "completion-marker", "instance-active", "lifecycle-active", "desktop-active"], absent: ["rollback-bundle", "instance-stage", "lifecycle-stage", "desktop-stage", "receipt", "journal"] }
    });
  });

  test("rejects a staged placeholder that does not match its durable intent reservation", async () => {
    const root = await temporaryDirectory("masthead-boundary-placeholder-");
    const productionRoot = join(root, "production");
    const homeDir = join(root, "home");
    const baseline = join(productionRoot, "Masthead-linux-x64-matrix-baseline");
    const candidate = join(productionRoot, "Masthead-linux-x64-matrix-candidate-00000000-0000-4000-8000-000000000000");
    const nonce = "00000000-0000-4000-8000-000000000000";
    const instanceStage = join(productionRoot, `.mastheadctl.${nonce}.staged`);
    const lifecycleStage = join(homeDir, ".local", "bin", `masthead-production.${nonce}.staged`);
    const desktopStage = join(homeDir, ".local", "share", "applications", `ai.animas.masthead.desktop.${nonce}.staged`);
    const intentPath = join(productionRoot, ".masthead-install-stage.intent.json");
    await Promise.all([
      mkdir(baseline, { recursive: true }),
      mkdir(candidate, { recursive: true }),
      mkdir(dirname(lifecycleStage), { recursive: true }),
      mkdir(dirname(desktopStage), { recursive: true })
    ]);
    await symlink(baseline, join(productionRoot, "current"));
    await writeFile(instanceStage, "placeholder", { mode: 0o644 });
    const reservation = (path: string, body: string, mode: number) => ({
      schemaVersion: 1,
      path,
      quarantinePath: join(dirname(path), `.${basename(path)}.${nonce}.cleanup`),
      sha256: createHash("sha256").update(body).digest("hex"),
      mode
    });
    await writeFile(intentPath, `${JSON.stringify({
      schemaVersion: 1,
      productionRoot,
      homeDir,
      lifecycleLeasePath: join(root, "launcher.lease.sqlite"),
      stagingNonce: nonce,
      target: candidate,
      ownsCandidate: true,
      temporaryTarget: join(productionRoot, `.masthead-candidate.${nonce}.staged`),
      stagedInstanceLauncherPath: instanceStage,
      launcherPath: join(homeDir, ".local", "bin", "masthead-production"),
      launcherStage: lifecycleStage,
      desktopPath: join(homeDir, ".local", "share", "applications", "ai.animas.masthead.desktop"),
      desktopStage,
      receiptPath: join(productionRoot, `.masthead-install-${nonce}.receipt.json`),
      ownedStages: [
        reservation(instanceStage, "expected instance", 0o755),
        reservation(lifecycleStage, "expected lifecycle", 0o755),
        reservation(desktopStage, "expected desktop", 0o644)
      ]
    })}\n`);

    await expect(assertPackageBoundCrashBoundary(
      { id: "stage:instance-stage:SIGKILL" },
      { baseline, productionRoot }
    )).rejects.toThrow("did not establish durable boundary stage:instance-stage:SIGKILL");
  });

  test("activation-receipt reads the durable after-receipt even when passed stale path authority", async () => {
    const root = await temporaryDirectory("masthead-boundary-activation-receipt-");
    const productionRoot = join(root, "production");
    const candidate = join(productionRoot, "Masthead-linux-x64-matrix-candidate");
    const homeDir = join(root, "home");
    const dataDir = join(root, "data");
    const receiptPath = join(productionRoot, ".masthead-install-receipt.receipt.json");
    const stagePaths = [
      join(productionRoot, ".mastheadctl.receipt.staged"),
      join(homeDir, ".local", "bin", "masthead-production.receipt.staged"),
      join(homeDir, ".local", "share", "applications", "ai.animas.masthead.desktop.receipt.staged")
    ];
    const activePaths = [
      join(dataDir, "bin", "mastheadctl"),
      join(homeDir, ".local", "bin", "masthead-production"),
      join(homeDir, ".local", "share", "applications", "ai.animas.masthead.desktop")
    ];
    await Promise.all([
      mkdir(candidate, { recursive: true }),
      ...stagePaths.map((path) => mkdir(dirname(path), { recursive: true })),
      ...activePaths.map((path) => mkdir(dirname(path), { recursive: true }))
    ]);
    await symlink(candidate, join(productionRoot, "current"));
    const stagedFiles = [];
    for (const [index, path] of stagePaths.entries()) {
      const body = `stage-${index}`;
      await Promise.all([
        writeFile(path, body, { mode: 0o644 }),
        writeFile(activePaths[index], body, { mode: 0o644 })
      ]);
      stagedFiles.push({ path, sha256: createHash("sha256").update(body).digest("hex"), mode: 0o644 });
    }
    const staleReceipt = {
      receiptPath,
      target: candidate,
      activeInstanceLauncherPath: activePaths[0],
      stagedInstanceLauncherPath: stagePaths[0],
      stagedFiles,
      stagedSurface: {
        launcherPath: activePaths[1],
        launcherStage: stagePaths[1],
        desktopPath: activePaths[2],
        desktopStage: stagePaths[2]
      }
    };
    const durableReceipt = { ...staleReceipt, activatedAt: "2026-07-19T00:00:00.000Z" };
    await Promise.all([
      writeFile(receiptPath, `${JSON.stringify(durableReceipt)}\n`),
      writeFile(join(productionRoot, ".masthead-install-activation.journal.json"), `${JSON.stringify({
        phase: "activation-committed",
        receipt: durableReceipt
      })}\n`)
    ]);

    await expect(assertPackageBoundCrashBoundary(
      { id: "activate:activation-receipt:SIGKILL" },
      { baseline: join(productionRoot, "unused"), productionRoot },
      staleReceipt
    )).resolves.toBeUndefined();
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
    const verified = await validSuppliedLifecycleBundle(root, [
      "export async function stageProductionInstallation() { return { staged: true }; }",
      "export async function activateStagedProductionInstallation() { return { activated: true }; }",
      "export async function finalizeStagedProductionInstallation() { return { finalized: true }; }",
      ""
    ].join("\n"));

    await expect(runPackageBoundCrashMatrix(verified, process.env)).rejects.toThrow(
      "stage:candidate-copy:SIGKILL"
    );
  });

  test("cannot certify a supplied lifecycle that emits candidate-copy before copying the candidate", async () => {
    const root = await temporaryDirectory("masthead-rehearsal-premature-hook-");
    const lifecycleSource = await readFile(join(PROJECT_ROOT, "scripts", "masthead-production.js"), "utf8");
    const prematureLifecycle = lifecycleSource
      .replace(
        "  if (!sourceIsDirectBundle && !targetExists) {",
        '  await input.onStageStep?.("candidate-copy");\n  if (!sourceIsDirectBundle && !targetExists) {'
      )
      .replace(
        '  await input.onStageStep?.("candidate-copy");\n  const manifest =',
        "  const manifest ="
      );
    expect(prematureLifecycle).not.toBe(lifecycleSource);
    const verified = await validSuppliedLifecycleBundle(root, prematureLifecycle);

    let failure: unknown;
    try {
      await runPackageBoundCrashMatrix(verified, process.env);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      cause: { message: "Packaged lifecycle did not establish durable boundary stage:candidate-copy:SIGKILL." }
    });
  });

});
