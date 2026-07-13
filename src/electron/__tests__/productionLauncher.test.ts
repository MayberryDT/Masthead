import { spawn } from "node:child_process";
import { once } from "node:events";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { writePackagedBundleManifest } from "../../../scripts/packaged-bundle-manifest.js";
import {
  acquireLifecycleLease,
  classifyProductionProcess,
  installProductionLauncher,
  productionHealthPollPolicy,
  readProductionProcesses,
  waitForProductionHealth,
  startProduction,
  stopProduction,
  transitionProduction,
  waitForMaintenanceChild
} from "../../../scripts/masthead-production.js";

const cleanup: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "masthead-production-launcher-"));
  cleanup.push(root);
  const productionRoot = join(root, "production");
  const homeDir = join(root, "home");
  const target = join(productionRoot, "Masthead-linux-x64-0.1.0-deadbeef");
  const daemonRoot = join(target, "resources", "daemon");
  await mkdir(join(daemonRoot, "scripts"), { recursive: true });
  await mkdir(join(daemonRoot, "dist", "src", "daemon"), { recursive: true });
  await mkdir(join(target, "resources"), { recursive: true });
  await mkdir(join(homeDir, ".local", "bin"), { recursive: true });
  await mkdir(join(homeDir, ".local", "share", "applications"), { recursive: true });
  await writeFile(join(target, "masthead"), "binary", { mode: 0o755 });
  await writeFile(join(daemonRoot, "node"), "node", { mode: 0o755 });
  await writeFile(join(daemonRoot, "scripts", "masthead-production.js"), "script");
  await writeFile(join(daemonRoot, "scripts", "packaged-bundle-manifest.js"), "verifier");
  await writeFile(join(daemonRoot, "scripts", "masthead-hook.js"), "hook");
  await writeFile(join(daemonRoot, "scripts", "resolve-hook-runtime.js"), "resolver");
  await writeFile(join(daemonRoot, "dist", "src", "daemon", "main.js"), "daemon");
  await writeFile(join(daemonRoot, "dist", "src", "daemon", "productionTransitionMaintenance.js"), "maintenance");
  await writeFile(join(target, "resources", "app.asar"), "app");
  await writeFile(join(daemonRoot, "release.json"), JSON.stringify({
    gitSha: "a".repeat(40),
    version: "0.1.0"
  }));
  await symlink(target, join(productionRoot, "current"));
  const manifest = await writePackagedBundleManifest({
    bundleRoot: target,
    executablePath: join(target, "masthead"),
    resourcesPath: join(target, "resources")
  });
  return {
    config: {
      bundleDigest: manifest.bundleDigest,
      dataDirectory: join(root, "data"),
      databasePath: join(root, "data", "masthead.sqlite"),
      port: 17383,
      productionRoot,
      target
    },
    homeDir,
    productionRoot,
    root,
    target
  };
}

async function secondBundle(productionRoot: string, sourceTarget: string) {
  const { cp, rm } = await import("node:fs/promises");
  const target = join(productionRoot, "Masthead-linux-x64-0.2.0-candidate");
  await cp(sourceTarget, target, { recursive: true });
  await writeFile(join(target, "masthead"), "candidate-binary", { mode: 0o755 });
  await writeFile(join(target, "resources", "app.asar"), "candidate-app");
  await writeFile(join(target, "resources", "daemon", "release.json"), JSON.stringify({
    gitSha: "b".repeat(40),
    version: "0.2.0"
  }));
  await rm(join(target, "resources", "release-manifest.json"), { force: true });
  const manifest = await writePackagedBundleManifest({
    bundleRoot: target,
    executablePath: join(target, "masthead"),
    resourcesPath: join(target, "resources")
  });
  return {
    bundleDigest: manifest.bundleDigest,
    gitSha: "b".repeat(40),
    target,
    version: "0.2.0"
  };
}

function processRecord(overrides: Record<string, unknown> = {}) {
  return {
    argv: [],
    environ: {},
    exe: "/usr/bin/other",
    pid: 42,
    starttime: "100",
    ...overrides
  };
}

describe("production lifecycle launcher", () => {
  test("allows five bounded minutes for activation health without extending for maintenance", () => {
    expect(productionHealthPollPolicy()).toEqual({
      intervalMs: 250,
      maxAttempts: 1_200,
      timeoutMs: 300_000
    });
    expect(productionHealthPollPolicy().maxAttempts).toBeGreaterThan(120);
  });

  test("enforces the five minute wall-clock deadline including request time and sleep", async () => {
    let now = 0;
    let requests = 0;
    const sleeps: number[] = [];
    await expect(waitForProductionHealth({ port: 17383 }, {
      delay: async (milliseconds: number) => { sleeps.push(milliseconds); now += milliseconds; },
      fetchHealth: async (_port: number, timeoutMs: number) => { requests += 1; now += timeoutMs; return undefined; },
      now: () => now
    })).rejects.toThrow("within 5 minutes");
    expect(now).toBe(300_000);
    expect(requests).toBe(300);
    expect(sleeps).toHaveLength(300);
    expect(Math.max(...sleeps)).toBe(250);
  });

  test("rejects a successful health response that arrives after the monotonic deadline", async () => {
    let now = 0;
    await expect(waitForProductionHealth({ port: 17383 }, {
      delay: async (milliseconds: number) => { now += milliseconds; },
      fetchHealth: async () => {
        now += 300_001;
        return { ok: true };
      },
      now: () => now
    })).rejects.toThrow("within 5 minutes");
    expect(now).toBe(300_001);
  });

  test("never extends ordinary startup to the former migration-aware window", async () => {
    let now = 0;
    await expect(waitForProductionHealth({ port: 17383 }, {
      delay: async (milliseconds: number) => { now += milliseconds; },
      fetchHealth: async (_port: number, timeoutMs: number) => {
        now += timeoutMs;
        return now >= 360_000 ? { ok: true } : undefined;
      },
      now: () => now
    })).rejects.toThrow("within 5 minutes");
    expect(now).toBe(300_000);
  });

  test("bounds the external maintenance child at 30 minutes with SIGTERM only", async () => {
    const source = await readFile("scripts/masthead-production.js", "utf8");
    expect(source).toContain("PRODUCTION_MAINTENANCE_TIMEOUT_MS = 1_800_000");
    expect(source).toContain('child.kill("SIGTERM")');
    expect(source).not.toContain('child.kill("SIGKILL")');
    expect(source).not.toContain("migrationStageActive");

    const child = spawn(process.execPath, ["-e", [
      'process.on("SIGTERM", () => setTimeout(() => process.exit(0), 75))',
      "setInterval(() => undefined, 1000)"
    ].join(";")], { stdio: ["ignore", "pipe", "pipe"] });
    await once(child, "spawn");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    const startedAt = Date.now();
    await expect(waitForMaintenanceChild(child, "test", 10, 500)).rejects.toThrow("exited after SIGTERM");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(70);
    expect(child.exitCode).toBe(0);

    const unproven = spawn(process.execPath, ["-e", [
      'process.on("SIGTERM", () => setTimeout(() => process.exit(0), 100))',
      "setInterval(() => undefined, 1000)"
    ].join(";")], { stdio: ["ignore", "pipe", "pipe"] });
    await once(unproven, "spawn");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    await expect(waitForMaintenanceChild(unproven, "test", 10, 20))
      .rejects.toMatchObject({ code: "maintenance_child_exit_unproven" });
    expect(unproven.exitCode).toBeNull();
    await once(unproven, "close");

    const errorOnly = Object.assign(new EventEmitter(), {
      kill: () => true,
      pid: 4242,
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      unref: () => undefined
    });
    const errorOnlyWait = waitForMaintenanceChild(
      errorOnly as any,
      "test",
      10,
      20,
      Promise.resolve({ pid: 4242, starttime: "observed-start" })
    );
    errorOnly.emit("error", new Error("pipe error is not process exit"));
    await expect(errorOnlyWait).rejects.toMatchObject({ code: "maintenance_child_exit_unproven" });

    const rejectedIdentityChild = Object.assign(new EventEmitter(), {
      kill: () => true,
      pid: 4243,
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      unref: () => undefined
    });
    const rejectedIdentityWait = waitForMaintenanceChild(
      rejectedIdentityChild as any,
      "test",
      100,
      20,
      Promise.reject(new Error("identity capture failed early"))
    );
    rejectedIdentityChild.emit("close", 1, null);
    await expect(rejectedIdentityWait).rejects.toMatchObject({ code: "maintenance_child_exit_unproven" });

    const neverSettlingIdentity = new Promise<{ pid: number; starttime: string }>(() => undefined);
    const neverIdentifiedChild = Object.assign(new EventEmitter(), {
      kill: () => true,
      pid: 4244,
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      unref: () => undefined
    });
    const neverIdentifiedWait = waitForMaintenanceChild(
      neverIdentifiedChild as any,
      "test",
      10,
      20,
      neverSettlingIdentity
    );
    await expect(Promise.race([
      neverIdentifiedWait,
      new Promise((_, reject) => setTimeout(() => reject(new Error("identity wait remained unbounded")), 100))
    ])).rejects.toMatchObject({ code: "maintenance_child_exit_unproven" });

    const closedBeforeIdentity = Object.assign(new EventEmitter(), {
      kill: () => true,
      pid: 4245,
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      unref: () => undefined
    });
    const closedBeforeIdentityWait = waitForMaintenanceChild(
      closedBeforeIdentity as any,
      "test",
      100,
      20,
      new Promise(() => undefined)
    );
    closedBeforeIdentity.emit("close", 0, null);
    await expect(Promise.race([
      closedBeforeIdentityWait,
      new Promise((_, reject) => setTimeout(() => reject(new Error("closed identity wait remained unbounded")), 100))
    ])).rejects.toMatchObject({ code: "maintenance_child_exit_unproven" });

    let exitedKillCount = 0;
    const exitedBeforeClose = Object.assign(new EventEmitter(), {
      kill: () => { exitedKillCount += 1; return true; },
      pid: 4343,
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      unref: () => undefined
    });
    const exitedWait = waitForMaintenanceChild(
      exitedBeforeClose as any,
      "test",
      10,
      100,
      Promise.resolve({ pid: 4343, starttime: "original" }),
      async () => ({ pid: 4343, starttime: "reused" })
    );
    exitedBeforeClose.emit("exit", 0, null);
    setTimeout(() => {
      exitedBeforeClose.stdout.end('{"completed":true}');
      exitedBeforeClose.stderr.end();
      exitedBeforeClose.emit("close", 0, null);
    }, 30);
    await expect(exitedWait).resolves.toEqual({ completed: true });
    expect(exitedKillCount).toBe(0);

    let reusedKillCount = 0;
    const reused = Object.assign(new EventEmitter(), {
      kill: () => { reusedKillCount += 1; return true; },
      pid: 4444,
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      unref: () => undefined
    });
    await expect(waitForMaintenanceChild(
      reused as any,
      "test",
      10,
      20,
      Promise.resolve({ pid: 4444, starttime: "original" }),
      async () => ({ pid: 4444, starttime: "replacement" })
    )).rejects.toMatchObject({ code: "maintenance_child_exit_unproven" });
    expect(reusedKillCount).toBe(0);
  });

  test("reads proc executable symlink text so deleted kernel identities remain observable", async () => {
    const source = await readFile("scripts/masthead-production.js", "utf8");
    expect(source).toContain('readlink(join(processRoot, "exe"))');
    expect(source).not.toContain('realpath(join(processRoot, "exe"))');
  });

  test("fails closed when the bounded process scan exceeds its entry budget or hits a non-race read error", async () => {
    await expect(readProductionProcesses({
      entries: async () => ["1", "2", "3"],
      maxEntries: 2,
      readProcess: async () => undefined
    })).rejects.toThrow("entry budget");
    await expect(readProductionProcesses({
      entries: async () => ["1"],
      readProcess: async () => { throw Object.assign(new Error("too many open files"), { code: "EMFILE" }); }
    })).rejects.toThrow("too many open files");
    const startedAt = Date.now();
    await expect(readProductionProcesses({
      entries: async () => ["1"],
      readProcess: async () => new Promise(() => undefined),
      timeoutMs: 10
    })).rejects.toThrow("bounded deadline");
    expect(Date.now() - startedAt).toBeLessThan(100);
  });

  test("installs an atomic wrapper and desktop entry pinned to the immutable target and release identity", async () => {
    const { config, homeDir, productionRoot, target } = await fixture();

    const receipt = await installProductionLauncher({
      bundleDigest: config.bundleDigest,
      bundlePath: target,
      dataDirectory: config.dataDirectory,
      homeDir,
      port: config.port,
      productionRoot
    });

    const wrapper = await readFile(receipt.launcherPath, "utf8");
    const desktop = await readFile(receipt.desktopPath, "utf8");
    expect(wrapper).toContain(`MASTHEAD_PRODUCTION_TARGET='${await realpath(target)}'`);
    expect(wrapper).toContain("MASTHEAD_BUILD_VERSION='0.1.0'");
    expect(wrapper).toContain(`MASTHEAD_BUILD_SHA='${"a".repeat(40)}'`);
    expect(wrapper).toContain(`MASTHEAD_BUNDLE_DIGEST='${config.bundleDigest}'`);
    expect(wrapper).toContain(`MASTHEAD_DATA_DIR='${config.dataDirectory}'`);
    expect(wrapper).toContain(`MASTHEAD_DB_PATH='${config.databasePath}'`);
    expect(wrapper).toContain("MASTHEAD_PORT='17383'");
    expect(wrapper).toContain(`MASTHEAD_LIFECYCLE_LEASE='${join(homeDir, ".local", "state", "masthead-production", "launcher.lease.sqlite")}'`);
    expect(wrapper).toContain("resources/daemon/scripts/masthead-production.js");
    expect(wrapper).not.toContain("/current/");
    expect(desktop).toContain(`Exec=${receipt.launcherPath}`);
    expect(desktop).toContain("Name=Masthead");
  });

  test("refuses a bundle outside the production root or a current symlink pointing elsewhere", async () => {
    const { config, homeDir, productionRoot, target } = await fixture();
    await expect(installProductionLauncher({
      bundleDigest: config.bundleDigest,
      bundlePath: join(config.dataDirectory, "Masthead-linux-x64-bad"),
      homeDir,
      productionRoot
    })).rejects.toThrow("direct child");

    const wrongCurrent = join(productionRoot, "current");
    const { rm } = await import("node:fs/promises");
    await rm(wrongCurrent);
    await symlink(join(productionRoot, "missing"), wrongCurrent);
    await expect(installProductionLauncher({ bundleDigest: config.bundleDigest, bundlePath: target, homeDir, productionRoot })).rejects.toThrow(
      "current symlink"
    );
  });

  test("rejects a version-named bundle symlink even when it resolves inside the production root", async () => {
    const { config, homeDir, productionRoot, target } = await fixture();
    const alias = join(productionRoot, "Masthead-linux-x64-alias");
    await symlink(target, alias);
    const { rm } = await import("node:fs/promises");
    await rm(join(productionRoot, "current"));
    await symlink(alias, join(productionRoot, "current"));
    await expect(installProductionLauncher({ bundleDigest: config.bundleDigest, bundlePath: alias, homeDir, productionRoot }))
      .rejects.toThrow("must not be a symbolic link");
  });

  test("rejects bundle tampering and a self-rebaselined manifest against the pinned digest", async () => {
    const { config, homeDir, productionRoot, target } = await fixture();
    await writeFile(join(target, "masthead"), "tampered");
    await expect(installProductionLauncher({
      bundleDigest: config.bundleDigest, bundlePath: target, homeDir, productionRoot
    })).rejects.toThrow("content manifest");
    await writePackagedBundleManifest({
      bundleRoot: target, executablePath: join(target, "masthead"), resourcesPath: join(target, "resources")
    });
    await expect(startProduction(config, {})).rejects.toThrow("pinned bundle digest");
  });

  test("transitions by staging launchers before stop, then swapping target, activating launchers, and starting", async () => {
    const { config, homeDir, productionRoot, target } = await fixture();
    const staleBundle = join(productionRoot, "Masthead-linux-x64-stale");
    await mkdir(staleBundle);
    const calls: string[] = [];
    const receipt = await transitionProduction({
      bundleDigest: config.bundleDigest,
      bundlePath: target,
      dataDirectory: config.dataDirectory,
      homeDir,
      port: config.port,
      productionRoot
    }, {
      acquireLease: async () => ({ release: async () => { calls.push("release"); } }),
      activateLaunchers: async () => { calls.push("activate-launchers"); },
      currentTarget: async () => target,
      stageLaunchers: async () => { calls.push("stage"); return {
        previousLauncher: { body: Buffer.from(`MASTHEAD_BUNDLE_DIGEST='${config.bundleDigest}'\n`), exists: true },
        staged: true
      }; },
      start: async () => { calls.push("start"); return { started: true }; },
      prepareMaintenance: async () => { calls.push("maintenance"); return { nonce: "transition" }; },
      completeMaintenance: async () => { calls.push("complete-maintenance"); },
      stop: async () => { calls.push("stop"); return { stopped: true }; },
      swapCurrent: async () => { calls.push("swap"); }
    });
    expect(receipt).toMatchObject({ started: { started: true }, stopped: { stopped: true } });
    expect(calls).toEqual(["stage", "stop", "maintenance", "swap", "activate-launchers", "start", "complete-maintenance", "release"]);
    const { access } = await import("node:fs/promises");
    await expect(access(staleBundle)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each(["snapshot_ready", "ready_to_activate", "restoring", "restore_failed", "restored"])(
    "public install rerun recovers the authoritative %s journal without generating a fresh transition",
    async (state) => {
      const { config, homeDir, productionRoot, target: oldTarget } = await fixture();
      const candidate = await secondBundle(productionRoot, oldTarget);
      if (state !== "snapshot_ready") {
        const { rm } = await import("node:fs/promises");
        await rm(join(productionRoot, "current"));
        await symlink(candidate.target, join(productionRoot, "current"));
      }
      const nonce = "12121212-1212-4212-8212-121212121212";
      await mkdir(config.dataDirectory, { recursive: true });
      await writeFile(`${config.databasePath}.production-transition.json`, JSON.stringify({
        databaseId: "db-recovered",
        databasePath: config.databasePath,
        newBundle: candidate,
        nonce,
        oldBundle: { bundleDigest: config.bundleDigest, gitSha: "a".repeat(40), target: oldTarget, version: "0.1.0" },
        schemaVersion: 1,
        sourceSchemaVersion: 21,
        state
      }));
      const calls: string[] = [];
      const result = await transitionProduction({
        bundleDigest: candidate.bundleDigest, bundlePath: candidate.target, dataDirectory: config.dataDirectory, homeDir, productionRoot
      }, {
        acquireLease: async () => ({ release: async () => calls.push("release") }),
        cleanupRecoveredBundles: async () => calls.push("cleanup-bundles"),
        completeMaintenance: async (request: any) => calls.push(`complete:${request.nonce}`),
        prepareMaintenance: async () => { calls.push("prepare-new"); throw new Error("must not prepare"); },
        recoverLaunchers: async () => calls.push("recover-launchers"),
        restoreCurrent: async () => calls.push("restore-current"),
        restoreMaintenance: async (request: any) => {
          calls.push(`restore:${request.nonce}`);
          return {
            ...request,
            databaseId: "db-recovered",
            sourceSchemaVersion: 21,
            state: "restored"
          };
        },
        stageLaunchers: async () => { calls.push("stage-new"); throw new Error("must not stage"); },
        start: async (candidate: any) => {
          calls.push(`start:${candidate.transitionNonce}:${candidate.expectedSchemaVersion}`);
          return { started: true };
        },
        stop: async () => { calls.push("stop"); return { stopped: true }; }
      });
      expect(result).toMatchObject({ activated: false, recovered: true });
      expect(calls).toEqual([
        "stop",
        `restore:${nonce}`,
        "restore-current",
        "recover-launchers",
        `start:${nonce}:21`,
        `complete:${nonce}`,
        "cleanup-bundles",
        "release"
      ]);
    }
  );

  test("public install recovery rejects a third current target before stop or restore", async () => {
    const { config, homeDir, productionRoot, target: oldTarget } = await fixture();
    const candidate = await secondBundle(productionRoot, oldTarget);
    await mkdir(config.dataDirectory, { recursive: true });
    await writeFile(`${config.databasePath}.production-transition.json`, JSON.stringify({
      databaseId: "db-recovered",
      databasePath: config.databasePath,
      newBundle: candidate,
      nonce: "15151515-1515-4515-8515-151515151515",
      oldBundle: { bundleDigest: config.bundleDigest, gitSha: "a".repeat(40), target: oldTarget, version: "0.1.0" },
      schemaVersion: 1,
      sourceSchemaVersion: 23,
      state: "snapshot_ready"
    }));
    let stopped = false;
    let restored = false;
    await expect(transitionProduction({
      bundleDigest: candidate.bundleDigest,
      bundlePath: candidate.target,
      dataDirectory: config.dataDirectory,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => ({ release: async () => undefined }),
      currentTarget: async () => join(productionRoot, "Masthead-linux-x64-third"),
      restoreMaintenance: async () => { restored = true; },
      stop: async () => { stopped = true; }
    })).rejects.toThrow("neither the receipt old nor new bundle");
    expect(stopped).toBe(false);
    expect(restored).toBe(false);
  });

  test("public install recovery rejects a symlink journal before stop", async () => {
    const { config, homeDir, productionRoot, root, target } = await fixture();
    await mkdir(config.dataDirectory, { recursive: true });
    const outsideJournal = join(root, "outside-transition.json");
    await writeFile(outsideJournal, JSON.stringify({ state: "snapshot_ready" }));
    await symlink(outsideJournal, `${config.databasePath}.production-transition.json`);
    let stopped = false;
    await expect(transitionProduction({
      bundleDigest: config.bundleDigest,
      bundlePath: target,
      dataDirectory: config.dataDirectory,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => ({ release: async () => undefined }),
      stop: async () => { stopped = true; }
    })).rejects.toThrow("transition journal is invalid");
    expect(stopped).toBe(false);
  });

  test("public install rejects an unknown journal state before staging or stopping", async () => {
    const { config, homeDir, productionRoot, target } = await fixture();
    await mkdir(config.dataDirectory, { recursive: true });
    await writeFile(`${config.databasePath}.production-transition.json`, JSON.stringify({ state: "future_state" }));
    let staged = false;
    let stopped = false;
    await expect(transitionProduction({
      bundleDigest: config.bundleDigest,
      bundlePath: target,
      dataDirectory: config.dataDirectory,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => ({ release: async () => undefined }),
      stageLaunchers: async () => { staged = true; },
      stop: async () => { stopped = true; }
    })).rejects.toThrow("unsupported state");
    expect(staged).toBe(false);
    expect(stopped).toBe(false);
  });

  test("public start recovery keeps the restored journal when old health validation fails", async () => {
    const { config, productionRoot, target: oldTarget } = await fixture();
    const candidate = await secondBundle(productionRoot, oldTarget);
    const { rm } = await import("node:fs/promises");
    await rm(join(productionRoot, "current"));
    await symlink(candidate.target, join(productionRoot, "current"));
    const nonce = "14141414-1414-4414-8414-141414141414";
    const journalPath = `${config.databasePath}.production-transition.json`;
    const journal = {
      databaseId: "db-recovered",
      databasePath: config.databasePath,
      newBundle: candidate,
      nonce,
      oldBundle: { bundleDigest: config.bundleDigest, gitSha: "a".repeat(40), target: oldTarget, version: "0.1.0" },
      schemaVersion: 1,
      sourceSchemaVersion: 23,
      state: "restore_failed"
    };
    await mkdir(config.dataDirectory, { recursive: true });
    await writeFile(journalPath, JSON.stringify(journal));
    const electron = processRecord({
      argv: [join(oldTarget, "masthead"), `--user-data-dir=${config.dataDirectory}`],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(oldTarget, "masthead")
    });
    const daemon = processRecord({
      argv: [join(oldTarget, "resources", "daemon", "node"), join(oldTarget, "resources", "daemon", "dist", "src", "daemon", "main.js")],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(oldTarget, "resources", "daemon", "node"), pid: 43, starttime: "daemon"
    });
    let completed = false;
    let cleaned = false;
    await expect(startProduction({
      ...config,
      bundleDigest: candidate.bundleDigest,
      gitSha: candidate.gitSha,
      target: candidate.target,
      version: candidate.version
    }, {
      acquireLease: async () => ({ release: async () => undefined }),
      cleanupInterruptedStart: async () => { cleaned = true; },
      completeInterruptedStart: async () => { completed = true; },
      currentTarget: async () => oldTarget,
      fetchHealth: async () => ({
        buildSha: "a".repeat(40), buildVersion: "0.1.0",
        data: { dataDirectory: config.dataDirectory, databaseId: "wrong-db", databasePath: config.databasePath },
        ok: true, product: "masthead", runtime: { port: config.port, writable: true }, schemaVersion: 23
      }),
      readProcesses: async () => [electron, daemon],
      recoverStartSurface: async () => undefined,
      restoreInterruptedStart: async (request: any) => {
        await writeFile(journalPath, JSON.stringify({ ...journal, state: "restored" }));
        return { ...request, state: "restored" };
      },
      stopInterruptedStart: async () => undefined
    })).rejects.toThrow("database identity/schema");
    expect(completed).toBe(false);
    expect(cleaned).toBe(false);
    expect(JSON.parse(await readFile(journalPath, "utf8"))).toMatchObject({ nonce, state: "restored" });
  });

  test("refuses a version-named transition symlink that escapes the production root before stopping", async () => {
    const { config, homeDir, productionRoot, root, target } = await fixture();
    const { cp } = await import("node:fs/promises");
    const outside = join(root, "outside-bundle");
    await cp(target, outside, { recursive: true });
    const escape = join(productionRoot, "Masthead-linux-x64-escape");
    await symlink(outside, escape);
    let stopped = false;
    await expect(transitionProduction({
      bundleDigest: config.bundleDigest,
      bundlePath: escape,
      dataDirectory: config.dataDirectory,
      homeDir,
      productionRoot
    }, {
      stop: async () => { stopped = true; }
    })).rejects.toThrow("must not be a symbolic link");
    expect(stopped).toBe(false);
  });

  test("classifies only exact production Electron main and daemon processes across versioned roots", async () => {
    const { config, target } = await fixture();
    const electron = processRecord({
      argv: [join(target, "masthead"), `--user-data-dir=${config.dataDirectory}`],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(target, "masthead")
    });
    const daemon = processRecord({
      argv: [
        join(target, "resources", "daemon", "node"),
        join(target, "resources", "daemon", "dist", "src", "daemon", "main.js")
      ],
      environ: {
        MASTHEAD_DATA_DIR: config.dataDirectory,
        MASTHEAD_DB_PATH: config.databasePath,
        MASTHEAD_PORT: String(config.port)
      },
      exe: join(target, "resources", "daemon", "node")
    });

    expect(classifyProductionProcess(electron, config)).toMatchObject({ role: "electron", target });
    expect(classifyProductionProcess(daemon, config)).toMatchObject({ role: "daemon", target });
    expect(classifyProductionProcess({ ...electron, argv: [...electron.argv, "--type=renderer"] }, config)).toBeUndefined();
    expect(classifyProductionProcess({ ...electron, environ: {} }, config)).toBeUndefined();
    expect(classifyProductionProcess({ ...daemon, environ: { ...daemon.environ, MASTHEAD_PORT: "9" } }, config))
      .toMatchObject({ role: "daemon", target });
  });

  test("classifies deleted old-target executables only when their exact argv and production identity still match", async () => {
    const { config, productionRoot, target } = await fixture();
    const oldTarget = join(productionRoot, "Masthead-linux-x64-0.0.9-old");
    const oldElectron = join(oldTarget, "masthead");
    const oldNode = join(oldTarget, "resources", "daemon", "node");
    const oldDaemon = join(oldTarget, "resources", "daemon", "dist", "src", "daemon", "main.js");
    const electron = processRecord({
      argv: [oldElectron, `--user-data-dir=${config.dataDirectory}`],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: `${oldElectron} (deleted)`
    });
    const daemon = processRecord({
      argv: [oldNode, oldDaemon],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: `${oldNode} (deleted)`
    });

    expect(classifyProductionProcess(electron, config)).toMatchObject({ role: "electron", target: oldTarget });
    expect(classifyProductionProcess(daemon, config)).toMatchObject({ role: "daemon", target: oldTarget });
    expect(classifyProductionProcess({ ...electron, exe: `${oldElectron} (deleted) (deleted)` }, config)).toBeUndefined();
    expect(classifyProductionProcess({ ...electron, exe: `${oldTarget} (deleted)/masthead` }, config)).toBeUndefined();
    expect(classifyProductionProcess({ ...electron, argv: [join(target, "masthead"), ...electron.argv.slice(1)] }, config))
      .toBeUndefined();
    expect(classifyProductionProcess({ ...daemon, argv: [join(target, "resources", "daemon", "node"), oldDaemon] }, config))
      .toBeUndefined();
  });

  test("start rejects an old-target process and an unrelated listener before spawning", async () => {
    const { config, productionRoot, target } = await fixture();
    const oldTarget = join(productionRoot, "Masthead-linux-x64-0.0.9-old");
    await mkdir(oldTarget);
    const oldProcess = processRecord({
      argv: [join(oldTarget, "masthead"), `--user-data-dir=${config.dataDirectory}`],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(oldTarget, "masthead")
    });
    let spawned = false;
    const baseDeps = {
      acquireLease: async () => ({ release: async () => undefined }),
      currentTarget: async () => target,
      fetchHealth: async () => undefined,
      ownershipProbe: async () => undefined,
      portBindable: async () => true,
      readProcesses: async () => [oldProcess],
      spawnElectron: async () => { spawned = true; return 90; },
      waitForHealth: async () => ({})
    };
    await expect(startProduction(config, baseDeps)).rejects.toThrow("old production target");
    expect(spawned).toBe(false);

    await expect(startProduction(config, {
      ...baseDeps,
      portBindable: async () => false,
      readProcesses: async () => []
    })).rejects.toThrow("port 17383");
    expect(spawned).toBe(false);
  });

  test.each(["snapshot_ready", "ready_to_activate", "restoring", "restore_failed", "restored"])(
    "start refuses the malformed %s crash journal before inspecting or spawning processes",
    async (state) => {
      const { config } = await fixture();
      await mkdir(config.dataDirectory, { recursive: true });
      await writeFile(`${config.databasePath}.production-transition.json`, JSON.stringify({
        newBundle: { target: config.target },
        nonce: "11111111-1111-4111-8111-111111111111",
        oldBundle: { target: config.target },
        state
      }));
      let inspected = false;
      await expect(startProduction(config, {
        acquireLease: async () => ({ release: async () => undefined }),
        currentTarget: async () => { inspected = true; return config.target; }
      })).rejects.toThrow("recovery receipt does not match");
      expect(inspected).toBe(false);
    }
  );

  test.each(["snapshot_ready", "ready_to_activate", "restoring", "restore_failed", "restored"])(
    "public start rerun recovers %s with the journal nonce before accepting old health",
    async (state) => {
      const { config, productionRoot, target: oldTarget } = await fixture();
      const candidate = await secondBundle(productionRoot, oldTarget);
      const startsFromCandidate = state !== "snapshot_ready";
      if (startsFromCandidate) {
        const { rm } = await import("node:fs/promises");
        await rm(join(productionRoot, "current"));
        await symlink(candidate.target, join(productionRoot, "current"));
      }
      const wrapperConfig = startsFromCandidate ? {
        ...config,
        bundleDigest: candidate.bundleDigest,
        gitSha: candidate.gitSha,
        target: candidate.target,
        version: candidate.version
      } : config;
      const nonce = "13131313-1313-4313-8313-131313131313";
      const journalPath = `${config.databasePath}.production-transition.json`;
      const journal = {
        databaseId: "db-recovered",
        databasePath: config.databasePath,
        newBundle: candidate,
        nonce,
        oldBundle: { bundleDigest: config.bundleDigest, gitSha: "a".repeat(40), target: oldTarget, version: "0.1.0" },
        schemaVersion: 1,
        sourceSchemaVersion: 23,
        state
      };
      await mkdir(config.dataDirectory, { recursive: true });
      await writeFile(journalPath, JSON.stringify(journal));
      const electron = processRecord({
        argv: [join(oldTarget, "masthead"), `--user-data-dir=${config.dataDirectory}`],
        environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
        exe: join(oldTarget, "masthead")
      });
      const daemon = processRecord({
        argv: [join(oldTarget, "resources", "daemon", "node"), join(oldTarget, "resources", "daemon", "dist", "src", "daemon", "main.js")],
        environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
        exe: join(oldTarget, "resources", "daemon", "node"), pid: 43, starttime: "daemon"
      });
      const calls: string[] = [];
      let surfaceRecovered = false;
      const result = await startProduction(wrapperConfig, {
        acquireLease: async () => ({ release: async () => calls.push("release") }),
        completeInterruptedStart: async (request: any) => {
          calls.push(`complete:${request.nonce}`);
          const { rm } = await import("node:fs/promises");
          await rm(journalPath);
        },
        cleanupInterruptedStart: async () => calls.push("cleanup-bundles"),
        currentTarget: async () => surfaceRecovered ? oldTarget : (startsFromCandidate ? candidate.target : oldTarget),
        fetchHealth: async () => ({
          buildSha: "a".repeat(40), buildVersion: "0.1.0",
          data: { dataDirectory: config.dataDirectory, databaseId: "db-recovered", databasePath: config.databasePath },
          ok: true, product: "masthead", runtime: { port: config.port, writable: true }, schemaVersion: 23
        }),
        readProcesses: async () => [electron, daemon],
        recoverStartSurface: async () => { calls.push("recover-surface"); surfaceRecovered = true; },
        restoreInterruptedStart: async (request: any) => {
          calls.push(`restore:${request.nonce}`);
          await writeFile(journalPath, JSON.stringify({ ...journal, state: "restored" }));
          return { ...request, databaseId: "db-recovered", sourceSchemaVersion: 23, state: "restored" };
        },
        stopInterruptedStart: async () => calls.push("stop")
      });
      expect(result).toMatchObject({ alreadyRunning: true, started: false });
      expect(calls).toEqual([
        "stop", `restore:${nonce}`, "recover-surface", `complete:${nonce}`, "cleanup-bundles", "release"
      ]);
      await expect(readFile(journalPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    }
  );

  test("start accepts only matching pinned health and passes pinned environment to Electron", async () => {
    const { config, target } = await fixture();
    const health = {
      buildSha: "a".repeat(40),
      buildVersion: "0.1.0",
      data: { dataDirectory: config.dataDirectory, databasePath: config.databasePath },
      ok: true,
      product: "masthead",
      runtime: { port: config.port, writable: true }
    };
    let launch: unknown;
    const electron = processRecord({
      argv: [join(target, "masthead"), `--user-data-dir=${config.dataDirectory}`],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(target, "masthead")
    });
    const daemon = processRecord({
      argv: [join(target, "resources", "daemon", "node"), join(target, "resources", "daemon", "dist", "src", "daemon", "main.js")],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(target, "resources", "daemon", "node"), pid: 43, starttime: "daemon"
    });
    let scans = 0;
    const receipt = await startProduction({ ...config, gitSha: "a".repeat(40), version: "0.1.0" }, {
      acquireLease: async () => ({ release: async () => undefined }),
      captureSpawned: async () => undefined,
      currentTarget: async () => target,
      fetchHealth: async () => undefined,
      ownershipProbe: async () => undefined,
      portBindable: async () => true,
      readProcesses: async () => (++scans === 1 ? [] : [electron, daemon]),
      spawnElectron: async (input: unknown) => { launch = input; return 90; },
      waitForHealth: async () => health
    });
    expect(receipt).toMatchObject({ pid: 90, started: true });
    expect(launch).toMatchObject({
      args: [`--user-data-dir=${config.dataDirectory}`],
      env: expect.objectContaining({
        MASTHEAD_BUILD_SHA: "a".repeat(40),
        MASTHEAD_BUILD_VERSION: "0.1.0",
        MASTHEAD_DATA_DIR: config.dataDirectory,
        MASTHEAD_DB_PATH: config.databasePath,
        MASTHEAD_PORT: "17383"
      }),
      executable: join(target, "masthead")
    });
  });

  test.each([
    ["incomplete", 1],
    ["duplicate", 3]
  ])("cleans up when post-health topology is %s", async (_label, count) => {
    const { config, target } = await fixture();
    const electron = processRecord({
      argv: [join(target, "masthead"), `--user-data-dir=${config.dataDirectory}`],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(target, "masthead")
    });
    const daemon = processRecord({
      argv: [join(target, "resources", "daemon", "node"), join(target, "resources", "daemon", "dist", "src", "daemon", "main.js")],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(target, "resources", "daemon", "node"), pid: 43, starttime: "daemon"
    });
    const topology = count === 1 ? [electron] : [electron, daemon, { ...daemon, pid: 44, starttime: "duplicate" }];
    let scans = 0;
    let cleaned = false;
    await expect(startProduction(config, {
      acquireLease: async () => ({ release: async () => undefined }),
      captureSpawned: async () => electron,
      cleanupSpawned: async () => { cleaned = true; return { stopped: true }; },
      currentTarget: async () => target,
      fetchHealth: async () => undefined,
      ownershipProbe: async () => undefined,
      portBindable: async () => true,
      readProcesses: async () => (++scans === 1 ? [] : topology),
      spawnElectron: async () => 42,
      waitForHealth: async () => ({
        buildSha: "a".repeat(40), buildVersion: "0.1.0",
        data: { dataDirectory: config.dataDirectory, databasePath: config.databasePath },
        ok: true, product: "masthead", runtime: { port: config.port, writable: true }
      })
    })).rejects.toThrow("exactly one Electron main and one daemon");
    expect(cleaned).toBe(true);
  });

  test("start returns already running only for an exact pinned process with matching health", async () => {
    const { config, target } = await fixture();
    const electron = processRecord({
      argv: [join(target, "masthead"), `--user-data-dir=${config.dataDirectory}`],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(target, "masthead")
    });
    const health = {
      buildSha: "a".repeat(40),
      buildVersion: "0.1.0",
      data: { dataDirectory: config.dataDirectory, databasePath: config.databasePath },
      ok: true,
      product: "masthead",
      runtime: { port: config.port, writable: true }
    };
    const daemon = processRecord({
      argv: [
        join(target, "resources", "daemon", "node"),
        join(target, "resources", "daemon", "dist", "src", "daemon", "main.js")
      ],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(target, "resources", "daemon", "node"),
      pid: 43,
      starttime: "101"
    });
    let spawned = false;
    const dependencies = {
      acquireLease: async () => ({ release: async () => undefined }),
      currentTarget: async () => target,
      fetchHealth: async () => health,
      readProcesses: async () => [electron, daemon],
      spawnElectron: async () => { spawned = true; return 90; }
    };
    await expect(startProduction({ ...config, gitSha: "a".repeat(40), version: "0.1.0" }, dependencies))
      .resolves.toMatchObject({ alreadyRunning: true, pids: [42, 43], started: false });
    expect(spawned).toBe(false);
    await expect(startProduction({ ...config, gitSha: "b".repeat(40), version: "0.1.0" }, dependencies))
      .rejects.toThrow("health does not match pinned");
    await expect(startProduction({
      ...config,
      expectedDatabaseId: "database-from-maintenance-receipt",
      expectedSchemaVersion: 23,
      gitSha: "a".repeat(40),
      version: "0.1.0"
    }, dependencies)).rejects.toThrow("database identity/schema");
    expect(spawned).toBe(false);
  });

  test("start rejects incomplete or duplicate pinned process topology", async () => {
    const { config, target } = await fixture();
    const electron = processRecord({
      argv: [join(target, "masthead"), `--user-data-dir=${config.dataDirectory}`],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(target, "masthead")
    });
    const health = {
      buildSha: "a".repeat(40), buildVersion: "0.1.0",
      data: { dataDirectory: config.dataDirectory, databasePath: config.databasePath },
      ok: true, product: "masthead", runtime: { port: config.port, writable: true }
    };
    const base = {
      acquireLease: async () => ({ release: async () => undefined }),
      currentTarget: async () => target,
      fetchHealth: async () => health,
      readProcesses: async () => [electron]
    };
    await expect(startProduction({ ...config, gitSha: "a".repeat(40), version: "0.1.0" }, base))
      .rejects.toThrow("exactly one Electron main and one daemon");
    await expect(startProduction({ ...config, gitSha: "a".repeat(40), version: "0.1.0" }, {
      ...base, readProcesses: async () => [electron, { ...electron, pid: 44, starttime: "duplicate" }]
    })).rejects.toThrow("exactly one Electron main and one daemon");
  });

  test("start cleans an orphan daemon and proves the full offline boundary when health validation fails", async () => {
    const { config, target } = await fixture();
    const captured = processRecord({
      argv: [join(target, "masthead"), `--user-data-dir=${config.dataDirectory}`],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(target, "masthead"), pid: 90, starttime: "spawned"
    });
    const calls: string[] = [];
    const daemon = processRecord({
      argv: [
        join(target, "resources", "daemon", "node"),
        join(target, "resources", "daemon", "dist", "src", "daemon", "main.js")
      ],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(target, "resources", "daemon", "node"), pid: 91, starttime: "daemon"
    });
    let scans = 0;
    await expect(startProduction({ ...config, gitSha: "a".repeat(40), version: "0.1.0" }, {
      acquireLease: async () => ({ release: async () => undefined }),
      captureSpawned: async () => captured,
      currentTarget: async () => target,
      fetchHealth: async () => undefined,
      ownershipProbe: async () => undefined,
      portBindable: async () => true,
      readProcess: async (pid: number) => pid === 91 ? daemon : undefined,
      readProcesses: async () => (++scans === 1 ? [] : scans === 2 ? [daemon] : []),
      signal: (pid: number, signal: string) => calls.push(`${signal}:${pid}`),
      spawnElectron: async () => 90,
      waitForExit: async () => true,
      waitForHealth: async () => ({ ok: false })
    })).rejects.toThrow("cleanup stopped=true");
    expect(calls).toEqual(["SIGTERM:91"]);
  });

  test("PID reuse quarantines the replacement while orphan daemon cleanup still completes", async () => {
    const { config, target } = await fixture();
    const captured = processRecord({
      argv: [join(target, "masthead"), `--user-data-dir=${config.dataDirectory}`],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(target, "masthead"), pid: 90, starttime: "original"
    });
    const replacement = { ...captured, starttime: "replacement" };
    const daemon = processRecord({
      argv: [join(target, "resources", "daemon", "node"), join(target, "resources", "daemon", "dist", "src", "daemon", "main.js")],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(target, "resources", "daemon", "node"), pid: 91, starttime: "daemon"
    });
    const signals: number[] = [];
    let scans = 0;
    await expect(startProduction(config, {
      acquireLease: async () => ({ release: async () => undefined }),
      captureSpawned: async () => captured,
      currentTarget: async () => target,
      fetchHealth: async () => undefined,
      ownershipProbe: async () => undefined,
      portBindable: async () => true,
      readProcess: async (pid: number) => pid === 90 ? replacement : daemon,
      readProcesses: async () => (++scans === 1 ? [] : scans === 2 ? [replacement, daemon] : [replacement]),
      signal: (pid: number) => signals.push(pid),
      spawnElectron: async () => 90,
      waitForExit: async () => true,
      waitForHealth: async () => ({ ok: false })
    })).rejects.toThrow("cleanup stopped=true");
    expect(signals).toEqual([91]);
  });

  test("transition restores old target and launchers and restarts old identity when new start fails", async () => {
    const { config, homeDir, productionRoot, target } = await fixture();
    const oldTarget = target;
    const calls: string[] = [];
    let starts = 0;
    await expect(transitionProduction({
      bundleDigest: config.bundleDigest, bundlePath: target, dataDirectory: config.dataDirectory, homeDir, productionRoot
    }, {
      acquireLease: async () => ({ release: async () => calls.push("release") }),
      activateLaunchers: async () => calls.push("activate-launchers"),
      currentTarget: async () => oldTarget,
      cleanupCandidate: async () => calls.push("cleanup-candidate"),
      completeMaintenance: async () => calls.push("complete-rollback"),
      restoreCurrent: async () => calls.push("restore-current"),
      restoreLaunchers: async () => calls.push("restore-launchers"),
      prepareMaintenance: async () => ({ nonce: "transition" }),
      restoreMaintenance: async () => { calls.push("restore-database"); return { databaseId: "db", sourceSchemaVersion: 22 }; },
      stageLaunchers: async () => { calls.push("stage"); return {
        previousLauncher: { body: Buffer.from(`MASTHEAD_BUNDLE_DIGEST='${config.bundleDigest}'\n`), exists: true },
        staged: true
      }; },
      start: async () => { starts += 1; calls.push(starts === 1 ? "start-new" : "restart-old"); if (starts === 1) throw new Error("new failed"); },
      stop: async () => calls.push("stop"),
      swapCurrent: async () => calls.push("swap")
    })).rejects.toThrow("rollback restarted=true");
    expect(calls).toEqual([
      "stage", "stop", "swap", "activate-launchers", "start-new",
      "cleanup-candidate", "restore-database", "restore-current", "restore-launchers", "restart-old", "complete-rollback", "release"
    ]);
  });

  test("maintenance failure never swaps and only restarts the unchanged old target after child rollback", async () => {
    const { config, homeDir, productionRoot, target } = await fixture();
    const calls: string[] = [];
    await expect(transitionProduction({
      bundleDigest: config.bundleDigest, bundlePath: target, dataDirectory: config.dataDirectory, homeDir, productionRoot
    }, {
      acquireLease: async () => ({ release: async () => calls.push("release") }),
      currentTarget: async () => target,
      completeMaintenance: async () => calls.push("complete-rollback"),
      prepareMaintenance: async () => { calls.push("maintenance"); throw new Error("partial migration restored"); },
      restoreMaintenance: async () => { calls.push("restore-database"); return { databaseId: "db", sourceSchemaVersion: 23 }; },
      stageLaunchers: async () => ({
        previousLauncher: { body: Buffer.from(`MASTHEAD_BUNDLE_DIGEST='${config.bundleDigest}'\n`), exists: true },
        staged: true
      }),
      start: async () => calls.push("restart-old"),
      stop: async () => calls.push("stop"),
      swapCurrent: async () => calls.push("swap")
    })).rejects.toThrow("pre-activation restart=true");
    expect(calls).toEqual(["stop", "maintenance", "restore-database", "restart-old", "complete-rollback", "release"]);
  });

  test("unproven maintenance child exit fails closed without restore, restart, or swap", async () => {
    const { config, homeDir, productionRoot, target } = await fixture();
    const calls: string[] = [];
    const unproven = Object.assign(new Error("maintenance child exit unproven"), {
      code: "maintenance_child_exit_unproven"
    });
    await expect(transitionProduction({
      bundleDigest: config.bundleDigest, bundlePath: target, dataDirectory: config.dataDirectory, homeDir, productionRoot
    }, {
      acquireLease: async () => ({ release: async () => calls.push("release") }),
      currentTarget: async () => target,
      prepareMaintenance: async () => { calls.push("maintenance"); throw unproven; },
      restoreMaintenance: async () => calls.push("restore-database"),
      stageLaunchers: async () => ({
        previousLauncher: { body: Buffer.from(`MASTHEAD_BUNDLE_DIGEST='${config.bundleDigest}'\n`), exists: true },
        staged: true
      }),
      start: async () => calls.push("restart-old"),
      stop: async () => calls.push("stop"),
      swapCurrent: async () => calls.push("swap")
    })).rejects.toThrow("pre-activation recovery skipped");
    expect(calls).toEqual(["stop", "maintenance", "release"]);
  });

  test("transition never rolls current back while immutable candidate cleanup is unresolved", async () => {
    const { config, homeDir, productionRoot, target } = await fixture();
    const calls: string[] = [];
    await expect(transitionProduction({
      bundleDigest: config.bundleDigest, bundlePath: target, dataDirectory: config.dataDirectory, homeDir, productionRoot
    }, {
      acquireLease: async () => ({ release: async () => calls.push("release") }),
      activateLaunchers: async () => calls.push("activate-launchers"),
      cleanupCandidate: async () => { calls.push("cleanup-candidate"); throw new Error("daemon still verifying backup"); },
      currentTarget: async () => target,
      restoreCurrent: async () => calls.push("restore-current"),
      restoreLaunchers: async () => calls.push("restore-launchers"),
      prepareMaintenance: async () => ({ nonce: "transition" }),
      restoreMaintenance: async () => { calls.push("restore-database"); return { databaseId: "db", sourceSchemaVersion: 22 }; },
      stageLaunchers: async () => ({
        previousLauncher: { body: Buffer.from(`MASTHEAD_BUNDLE_DIGEST='${config.bundleDigest}'\n`), exists: true },
        staged: true
      }),
      start: async () => { throw new Error("health timeout; cleanup stopped=false; cleanup error=daemon blocked"); },
      stop: async () => undefined,
      swapCurrent: async () => calls.push("swap")
    })).rejects.toThrow("rollback skipped; candidate cleanup error=daemon still verifying backup");
    expect(calls).toEqual(["swap", "activate-launchers", "cleanup-candidate", "release"]);
  });

  test("transition fails closed before current/launcher rollback when receipt-bound database restore fails", async () => {
    const { config, homeDir, productionRoot, target } = await fixture();
    const calls: string[] = [];
    await expect(transitionProduction({
      bundleDigest: config.bundleDigest, bundlePath: target, dataDirectory: config.dataDirectory, homeDir, productionRoot
    }, {
      acquireLease: async () => ({ release: async () => calls.push("release") }),
      activateLaunchers: async () => calls.push("activate-launchers"),
      cleanupCandidate: async () => calls.push("cleanup-candidate"),
      currentTarget: async () => target,
      prepareMaintenance: async () => ({ databaseId: "db", targetSchemaVersion: 23 }),
      restoreCurrent: async () => calls.push("restore-current"),
      restoreLaunchers: async () => calls.push("restore-launchers"),
      restoreMaintenance: async () => { calls.push("restore-database"); throw new Error("snapshot hash mismatch"); },
      stageLaunchers: async () => ({
        previousLauncher: { body: Buffer.from(`MASTHEAD_BUNDLE_DIGEST='${config.bundleDigest}'\n`), exists: true },
        staged: true
      }),
      start: async () => { throw new Error("candidate health failed"); },
      stop: async () => undefined,
      swapCurrent: async () => calls.push("swap")
    })).rejects.toThrow("rollback restarted=false");
    expect(calls).toEqual([
      "swap", "activate-launchers", "cleanup-candidate", "restore-database", "release"
    ]);
  });

  test("failed start reports the exact cleanup error detail", async () => {
    const { config, target } = await fixture();
    await expect(startProduction(config, {
      acquireLease: async () => ({ release: async () => undefined }),
      captureSpawned: async () => undefined,
      cleanupSpawned: async () => ({ error: "daemon PID 91 did not stop after migration-aware SIGTERM wait", stopped: false }),
      currentTarget: async () => target,
      fetchHealth: async () => undefined,
      ownershipProbe: async () => undefined,
      portBindable: async () => true,
      readProcesses: async () => [],
      spawnElectron: async () => 90,
      waitForHealth: async () => { throw new Error("health timeout"); }
    })).rejects.toThrow("cleanup error=daemon PID 91 did not stop");
  });

  test("stop revalidates PID identity, sends SIGTERM only, and passes every offline gate", async () => {
    const { config, target } = await fixture();
    const electron = processRecord({
      argv: [join(target, "masthead"), `--user-data-dir=${config.dataDirectory}`],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(target, "masthead"),
      pid: 51,
      starttime: "original"
    });
    const signals: Array<[number, string]> = [];
    let reads = 0;
    let owned = false;
    const receipt = await stopProduction(config, {
      acquireLease: async () => ({ release: async () => undefined }),
      fetchHealth: async () => undefined,
      ownershipProbe: async () => { owned = true; },
      portBindable: async () => true,
      readProcess: async () => electron,
      readProcesses: async () => (++reads === 1 ? [electron] : []),
      signal: (pid: number, signal: string) => { signals.push([pid, signal]); },
      waitForExit: async () => true
    });
    expect(receipt).toEqual({ stopped: true, stoppedPids: [51] });
    expect(signals).toEqual([[51, "SIGTERM"]]);
    expect(owned).toBe(true);
  });

  test("stop signals the daemon before Electron and tolerates a captured process already being gone", async () => {
    const { config, target } = await fixture();
    const electron = processRecord({
      argv: [join(target, "masthead"), `--user-data-dir=${config.dataDirectory}`],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(target, "masthead"),
      pid: 10,
      starttime: "electron"
    });
    const daemon = processRecord({
      argv: [
        join(target, "resources", "daemon", "node"),
        join(target, "resources", "daemon", "dist", "src", "daemon", "main.js")
      ],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(target, "resources", "daemon", "node"),
      pid: 20,
      starttime: "daemon"
    });
    const signalled: number[] = [];
    let scan = 0;
    await stopProduction(config, {
      acquireLease: async () => ({ release: async () => undefined }),
      fetchHealth: async () => undefined,
      ownershipProbe: async () => undefined,
      portBindable: async () => true,
      readProcess: async (pid: number) => pid === 20 ? daemon : undefined,
      readProcesses: async () => (++scan === 1 ? [electron, daemon] : []),
      signal: (pid: number) => { signalled.push(pid); },
      waitForExit: async () => true
    });
    expect(signalled).toEqual([20]);
  });

  test("stop safely revalidates and signals an exact deleted old-target process", async () => {
    const { config, productionRoot } = await fixture();
    const oldTarget = join(productionRoot, "Masthead-linux-x64-0.0.9-old");
    const executable = join(oldTarget, "masthead");
    const electron = processRecord({
      argv: [executable, `--user-data-dir=${config.dataDirectory}`],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: `${executable} (deleted)`,
      pid: 81,
      starttime: "old-start"
    });
    const signals: Array<[number, string]> = [];
    let scans = 0;
    await stopProduction(config, {
      acquireLease: async () => ({ release: async () => undefined }),
      fetchHealth: async () => undefined,
      ownershipProbe: async () => undefined,
      portBindable: async () => true,
      readProcess: async () => electron,
      readProcesses: async () => (++scans === 1 ? [electron] : []),
      signal: (pid: number, signal: string) => { signals.push([pid, signal]); },
      waitForExit: async () => true
    });
    expect(signals).toEqual([[81, "SIGTERM"]]);
  });

  test("stop fails closed on PID reuse, timeout, health, listener, or ownership failure", async () => {
    const { config, target } = await fixture();
    const electron = processRecord({
      argv: [join(target, "masthead"), `--user-data-dir=${config.dataDirectory}`],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: join(target, "masthead"),
      pid: 51,
      starttime: "original"
    });
    const base = {
      acquireLease: async () => ({ release: async () => undefined }),
      fetchHealth: async () => undefined,
      ownershipProbe: async () => undefined,
      portBindable: async () => true,
      readProcess: async () => ({ ...electron, starttime: "replacement" }),
      readProcesses: async () => [electron],
      signal: () => undefined,
      waitForExit: async () => true
    };
    await expect(stopProduction(config, base)).rejects.toThrow("PID identity changed");
    await expect(stopProduction(config, { ...base, readProcess: async () => electron, waitForExit: async () => false }))
      .rejects.toThrow("did not stop after SIGTERM");
    await expect(stopProduction(config, {
      ...base,
      fetchHealth: async () => ({}),
      readProcess: async () => electron,
      readProcesses: async () => []
    })).rejects.toThrow("health endpoint remains available");
    await expect(stopProduction(config, {
      ...base,
      portBindable: async () => false,
      readProcess: async () => electron,
      readProcesses: async () => []
    })).rejects.toThrow("port remains occupied");
    await expect(stopProduction(config, {
      ...base,
      ownershipProbe: async () => { throw new Error("stale sentinel"); },
      readProcess: async () => electron,
      readProcesses: async () => []
    })).rejects.toThrow("stale sentinel");
  });

  test("serializes lifecycle commands with an auto-released SQLite lease", async () => {
    const { root } = await fixture();
    const leasePath = join(root, "state", "launcher.lease.sqlite");
    const first = await acquireLifecycleLease(leasePath);
    await expect(acquireLifecycleLease(leasePath)).rejects.toThrow("lifecycle command is already running");
    await first.release();
    const second = await acquireLifecycleLease(leasePath);
    await second.release();
  });
});
