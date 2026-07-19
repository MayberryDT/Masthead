import { spawn } from "node:child_process";
import { once } from "node:events";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { lstat, mkdir, mkdtemp, open as openFile, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { writePackagedBundleManifest } from "../../../scripts/packaged-bundle-manifest.js";
import {
  acquireLifecycleLease,
  activateStagedProductionInstallation,
  assertColdProductionOffline,
  captureMaintenanceSentinel,
  captureLegacyTargetIdentity,
  classifyProductionProcess,
  coldActivateProduction,
  clearExactMaintenanceSentinel,
  installDisabledProductionSurface,
  installProductionLauncher,
  productionHealthPollPolicy,
  productionMaintenanceTimeoutPolicy,
  readOwnedProcessStrict,
  readProductionProcesses,
  waitForProductionHealth,
  startProduction,
  stageProductionInstallation,
  statusProduction,
  stopColdMaintenanceChildren,
  stopProduction,
  transitionProduction,
  waitForMaintenanceChild
} from "../../../scripts/masthead-production.js";

const cleanup: string[] = [];
const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function fixture({ includeIcon = true, iconContents = VALID_PNG } = {}) {
  const root = await mkdtemp(join(tmpdir(), "masthead-production-launcher-"));
  cleanup.push(root);
  const productionRoot = join(root, "production");
  const homeDir = join(root, "home");
  const target = join(productionRoot, "Masthead-linux-x64-0.1.0-deadbeef");
  const daemonRoot = join(target, "resources", "daemon");
  await mkdir(join(daemonRoot, "scripts"), { recursive: true });
  await mkdir(join(daemonRoot, "dist", "src", "daemon"), { recursive: true });
  await mkdir(join(daemonRoot, "dist", "src", "cli"), { recursive: true });
  await mkdir(join(daemonRoot, "dist", "src", "core"), { recursive: true });
  await mkdir(join(target, "resources"), { recursive: true });
  await mkdir(join(homeDir, ".local", "bin"), { recursive: true });
  await mkdir(join(homeDir, ".local", "share", "applications"), { recursive: true });
  await writeFile(join(target, "masthead"), "binary", { mode: 0o755 });
  await writeFile(join(daemonRoot, "node"), "node", { mode: 0o755 });
  await writeFile(join(daemonRoot, "scripts", "masthead-production.js"), "script");
  await writeFile(join(daemonRoot, "scripts", "masthead-production-cold-activation.js"), "cold activation");
  await writeFile(join(daemonRoot, "scripts", "packaged-bundle-manifest.js"), "verifier");
  await writeFile(join(daemonRoot, "scripts", "masthead-hook.js"), "hook");
  await writeFile(join(daemonRoot, "scripts", "resolve-hook-runtime.js"), "resolver");
  await writeFile(join(daemonRoot, "dist", "src", "daemon", "main.js"), "daemon");
  await writeFile(join(daemonRoot, "dist", "src", "cli", "mastheadctl.js"), "cli");
  await writeFile(join(daemonRoot, "dist", "src", "daemon", "productionTransitionMaintenance.js"), "maintenance");
  await writeFile(join(daemonRoot, "dist", "src", "daemon", "databaseBackup.js"), [
    "export async function withExclusiveDatabaseMaintenance() {",
    "  throw new Error('maintenance-only ownership probe rejected a missing database');",
    "}",
    ""
  ].join("\n"));
  await writeFile(join(daemonRoot, "dist", "src", "core", "daemonOwnership.js"), [
    "export async function probeExclusiveDatabaseStartupOwnership() {",
    "  return undefined;",
    "}",
    ""
  ].join("\n"));
  await writeFile(join(target, "resources", "app.asar"), "app");
  if (includeIcon) {
    await writeFile(join(target, "resources", "masthead-logo-sail.png"), iconContents);
  }
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

async function legacyBoundaryFixture() {
  const value = await fixture();
  const candidate = await secondBundle(value.productionRoot, value.target);
  const { rm } = await import("node:fs/promises");
  await rm(join(value.target, "resources", "daemon", "release.json"));
  await rm(join(value.target, "resources", "release-manifest.json"));
  await writeFile(join(value.homeDir, ".local", "bin", "masthead-production"), [
    "#!/usr/bin/env bash",
    `exec '${join(value.target, "masthead")}' \"$@\"`,
    ""
  ].join("\n"), { mode: 0o755 });
  return { ...value, candidate, legacyTarget: value.target };
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

function legacyIdentity(path: string) {
  return { device: "42", inode: "84", path };
}

describe("production lifecycle launcher", () => {
  test("stages and activates an instance-bound production installation without runtime or database side effects", async () => {
    const { config, homeDir, productionRoot, target: oldTarget } = await fixture();
    const candidate = await secondBundle(productionRoot, oldTarget);
    const activeInstanceLauncherPath = join(config.dataDirectory, "bin", "mastheadctl");
    await mkdir(join(config.dataDirectory, "bin"), { recursive: true });
    await writeFile(activeInstanceLauncherPath, "old launcher");
    const forbidden = () => { throw new Error("forbidden runtime side effect"); };

    const receipt = await stageProductionInstallation({
      bundleDigest: candidate.bundleDigest,
      sourceBundlePath: candidate.target,
      dataDirectory: config.dataDirectory,
      homeDir,
      productionRoot,
      openDatabase: forbidden,
      launch: forbidden,
      probe: forbidden,
      cleanupBundles: forbidden
    } as never);

    expect(receipt).toMatchObject({ databaseOpened: false, launched: false, staged: true });
    expect(await realpath(join(productionRoot, "current"))).toBe(oldTarget);
    expect(await readFile(activeInstanceLauncherPath, "utf8")).toBe("old launcher");
    expect(await readFile(receipt.stagedInstanceLauncherPath, "utf8")).toContain("MASTHEAD_INSTANCE_MANIFEST");
    expect(JSON.parse(await readFile(receipt.receiptPath, "utf8"))).toMatchObject({
      receiptVersion: "masthead-production-stage-v1",
      stagingNonce: receipt.stagingNonce,
      target: candidate.target
    });
    await expect(lstat(receipt.instanceManifestPath)).rejects.toMatchObject({ code: "ENOENT" });

    const activated = await activateStagedProductionInstallation(receipt, {
      openDatabase: forbidden,
      runMaintenance: forbidden,
      launch: forbidden,
      probe: forbidden,
      writeManifest: forbidden,
      runDesktopDatabaseCommand: () => undefined
    });
    expect(activated).toMatchObject({ activated: true, databaseOpened: false, launched: false });
    expect(await realpath(join(productionRoot, "current"))).toBe(candidate.target);
    expect(await readFile(activeInstanceLauncherPath, "utf8")).toContain("MASTHEAD_INSTANCE_MANIFEST");
    await expect(lstat(receipt.instanceManifestPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await realpath(oldTarget)).toBe(oldTarget);
  });

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

  test("gives prepare and restore a twelve-hour operation deadline with SIGTERM only", async () => {
    const source = await readFile("scripts/masthead-production.js", "utf8");
    const coldActivationReference = await readFile("docs/reference/production-cold-activation.md", "utf8");
    expect(productionMaintenanceTimeoutPolicy()).toEqual({ exitGraceMs: 30_000, timeoutMs: 43_200_000 });
    expect(source).toContain("PRODUCTION_MAINTENANCE_TIMEOUT_MS = 43_200_000");
    expect(coldActivationReference).toContain("twelve-hour hard deadline");
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

  test("captures a timed-out maintenance sentinel before SIGTERM and clears it only after exact close", async () => {
    const calls: string[] = [];
    const child = Object.assign(new EventEmitter(), {
      kill: () => {
        calls.push("kill");
        setTimeout(() => {
          child.emit("exit", null, "SIGTERM");
          child.stdout.end();
          child.stderr.end();
          child.emit("close", null, "SIGTERM");
        }, 5);
        return true;
      },
      pid: 4545,
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      unref: () => undefined
    });
    await expect(waitForMaintenanceChild(
      child as any,
      "prepare",
      10,
      100,
      Promise.resolve({ pid: 4545, starttime: "child-start" }),
      async () => ({ pid: 4545, starttime: "child-start" }),
      {
        capture: async (identity) => {
          calls.push(`capture:${identity.pid}:${identity.starttime}`);
          return { exact: true };
        },
        cleanup: async (identity, evidence) => {
          calls.push(`cleanup:${identity.pid}:${identity.starttime}:${String(evidence.exact)}`);
        }
      }
    )).rejects.toThrow("exited after SIGTERM");
    expect(calls).toEqual([
      "capture:4545:child-start",
      "kill",
      "cleanup:4545:child-start:true"
    ]);
  });

  test("does not signal when the maintenance PID identity changes after sentinel capture", async () => {
    let identityReads = 0;
    let killCount = 0;
    const child = Object.assign(new EventEmitter(), {
      kill: () => { killCount += 1; return true; },
      pid: 4646,
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      unref: () => undefined
    });
    await expect(waitForMaintenanceChild(
      child as any,
      "prepare",
      10,
      100,
      Promise.resolve({ pid: 4646, starttime: "child-start" }),
      async () => {
        identityReads += 1;
        return { pid: 4646, starttime: identityReads === 1 ? "child-start" : "replacement-start" };
      },
      {
        capture: async () => ({ exact: true }),
        cleanup: async () => undefined
      }
    )).rejects.toMatchObject({ code: "maintenance_child_exit_unproven" });
    expect(killCount).toBe(0);
  });

  test("serializes exact close behind timeout sentinel capture and fails closed when the child exits during capture", async () => {
    let captureStartedResolve!: () => void;
    let releaseCapture!: (value: { exact: boolean }) => void;
    const captureStarted = new Promise<void>((resolve) => { captureStartedResolve = resolve; });
    const capturePending = new Promise<{ exact: boolean }>((resolve) => { releaseCapture = resolve; });
    let identityReads = 0;
    let killCount = 0;
    let cleanupCount = 0;
    const child = Object.assign(new EventEmitter(), {
      kill: () => { killCount += 1; return true; },
      pid: 4747,
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      unref: () => undefined
    });
    const wait = waitForMaintenanceChild(
      child as any,
      "prepare",
      10,
      200,
      Promise.resolve({ pid: 4747, starttime: "child-start" }),
      async () => {
        identityReads += 1;
        return identityReads === 1 ? { pid: 4747, starttime: "child-start" } : undefined;
      },
      {
        capture: async () => {
          captureStartedResolve();
          return capturePending;
        },
        cleanup: async () => { cleanupCount += 1; }
      }
    );
    await captureStarted;
    child.emit("exit", 0, null);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", 0, null);
    releaseCapture({ exact: true });

    await expect(wait).rejects.toThrow("exited before sentinel capture could be revalidated");
    expect(killCount).toBe(0);
    expect(cleanupCount).toBe(0);
  });

  test("clears only the exact captured maintenance compatibility sentinel under offline leases", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-maintenance-sentinel-"));
    cleanup.push(root);
    const dataDirectory = join(root, "data");
    const runtimeDirectory = join(dataDirectory, "runtime");
    const databasePath = join(dataDirectory, "masthead.sqlite");
    const lockPath = join(runtimeDirectory, "database.lock");
    const identity = { pid: 7777, starttime: "child-start" };
    const body = `${JSON.stringify({
      createdAt: "2026-07-13T12:00:00.000Z",
      pid: identity.pid,
      protocol: "canonical-data-directory-lock-v4",
      token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    }, null, 2)}\n`;
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(databasePath, "database", "utf8");
    await writeFile(lockPath, body, "utf8");
    const evidence = await captureMaintenanceSentinel({ dataDirectory }, identity);
    const calls: string[] = [];
    await clearExactMaintenanceSentinel({ dataDirectory, databasePath }, identity, evidence, {
      assertFullyOffline: async () => { calls.push("fully-offline"); },
      assertRuntimeOffline: async () => { calls.push("runtime-offline"); },
      statProcess: async () => { throw Object.assign(new Error("child absent"), { code: "ENOENT" }); },
      remove: async (path: string) => {
        for (const leasePath of [
          `${databasePath}.lease.sqlite`,
          join(runtimeDirectory, "database.lease.sqlite")
        ]) {
          const contender = new DatabaseSync(leasePath);
          try {
            expect(() => contender.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;")).toThrow(/locked|busy/iu);
          } finally {
            contender.close();
          }
        }
        calls.push("leases-held");
        await rm(path);
      }
    });
    await expect(lstat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(calls).toEqual(["runtime-offline", "leases-held", "runtime-offline", "fully-offline"]);
  });

  test("refuses stale-sentinel cleanup after replacement, content drift, live PID reuse, or offline failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-maintenance-sentinel-races-"));
    cleanup.push(root);
    const dataDirectory = join(root, "data");
    const runtimeDirectory = join(dataDirectory, "runtime");
    const databasePath = join(dataDirectory, "masthead.sqlite");
    const lockPath = join(runtimeDirectory, "database.lock");
    const replacementPath = join(runtimeDirectory, "replacement.lock");
    const identity = { pid: 8888, starttime: "child-start" };
    const exact = JSON.stringify({
      createdAt: "2026-07-13T12:00:00.000Z",
      pid: identity.pid,
      protocol: "canonical-data-directory-lock-v4",
      token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    });
    const replacement = JSON.stringify({
      createdAt: "2026-07-13T12:01:00.000Z",
      pid: 9999,
      protocol: "canonical-data-directory-lock-v4",
      token: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    });
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(databasePath, "database", "utf8");
    const adapters = {
      acquireLeases: async () => ({ release: async () => undefined }),
      assertFullyOffline: async () => undefined,
      assertRuntimeOffline: async () => undefined,
      statProcess: async () => { throw Object.assign(new Error("child absent"), { code: "ENOENT" }); }
    };

    await writeFile(lockPath, exact, "utf8");
    const replacedEvidence = await captureMaintenanceSentinel({ dataDirectory }, identity);
    await writeFile(replacementPath, replacement, "utf8");
    await rename(replacementPath, lockPath);
    await expect(clearExactMaintenanceSentinel(
      { dataDirectory, databasePath }, identity, replacedEvidence, adapters
    )).rejects.toThrow("sentinel identity changed");
    await expect(readFile(lockPath, "utf8")).resolves.toBe(replacement);

    await writeFile(lockPath, exact, "utf8");
    const driftEvidence = await captureMaintenanceSentinel({ dataDirectory }, identity);
    const sameInodeTokenDrift = exact.replace(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    );
    await writeFile(lockPath, sameInodeTokenDrift, "utf8");
    await expect(clearExactMaintenanceSentinel(
      { dataDirectory, databasePath }, identity, driftEvidence, adapters
    )).rejects.toThrow("sentinel identity changed");
    await expect(readFile(lockPath, "utf8")).resolves.toBe(sameInodeTokenDrift);

    await writeFile(lockPath, exact, "utf8");
    const liveEvidence = await captureMaintenanceSentinel({ dataDirectory }, identity);
    await expect(clearExactMaintenanceSentinel(
      { dataDirectory, databasePath }, identity, liveEvidence,
      { ...adapters, statProcess: async () => ({}) }
    )).rejects.toThrow("maintenance PID is present");
    await expect(readFile(lockPath, "utf8")).resolves.toBe(exact);

    await expect(clearExactMaintenanceSentinel(
      { dataDirectory, databasePath }, identity, liveEvidence,
      { ...adapters, assertRuntimeOffline: async () => { throw new Error("runtime not offline"); } }
    )).rejects.toThrow("runtime not offline");
    await expect(readFile(lockPath, "utf8")).resolves.toBe(exact);
  });

  test("atomically quarantines a final-boundary replacement instead of deleting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-maintenance-quarantine-race-"));
    cleanup.push(root);
    const dataDirectory = join(root, "data");
    const runtimeDirectory = join(dataDirectory, "runtime");
    const databasePath = join(dataDirectory, "masthead.sqlite");
    const lockPath = join(runtimeDirectory, "database.lock");
    const replacementPath = join(runtimeDirectory, "replacement.lock");
    const identity = { pid: 8989, starttime: "child-start" };
    const sentinel = (pid: number, token: string) => JSON.stringify({
      createdAt: "2026-07-13T12:00:00.000Z",
      pid,
      protocol: "canonical-data-directory-lock-v4",
      token
    });
    const exact = sentinel(identity.pid, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    const replacement = sentinel(9999, "ffffffff-ffff-4fff-8fff-ffffffffffff");
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(databasePath, "database", "utf8");
    await writeFile(lockPath, exact, "utf8");
    const evidence = await captureMaintenanceSentinel({ dataDirectory }, identity);
    await writeFile(replacementPath, replacement, "utf8");
    await expect(clearExactMaintenanceSentinel({ dataDirectory, databasePath }, identity, evidence, {
      acquireLeases: async () => ({ release: async () => undefined }),
      assertFullyOffline: async () => undefined,
      assertRuntimeOffline: async () => undefined,
      rename: async (source: string, destination: string) => {
        await rename(replacementPath, source);
        await rename(source, destination);
      },
      statProcess: async () => { throw Object.assign(new Error("child absent"), { code: "ENOENT" }); }
    })).rejects.toThrow("atomic quarantine");
    await expect(readFile(lockPath, "utf8")).resolves.toBe(replacement);
    expect((await readdir(runtimeDirectory)).filter((name) => name.includes("maintenance-cleanup"))).toEqual([]);

    await writeFile(lockPath, exact, "utf8");
    const secondEvidence = await captureMaintenanceSentinel({ dataDirectory }, identity);
    await writeFile(replacementPath, replacement, "utf8");
    const newer = sentinel(10_000, "11111111-1111-4111-8111-111111111111");
    await expect(clearExactMaintenanceSentinel({ dataDirectory, databasePath }, identity, secondEvidence, {
      acquireLeases: async () => ({ release: async () => undefined }),
      assertFullyOffline: async () => undefined,
      assertRuntimeOffline: async () => undefined,
      rename: async (source: string, destination: string) => {
        await rename(replacementPath, source);
        await rename(source, destination);
        await writeFile(source, newer, "utf8");
      },
      statProcess: async () => { throw Object.assign(new Error("child absent"), { code: "ENOENT" }); }
    })).rejects.toThrow("replacement was preserved");
    await expect(readFile(lockPath, "utf8")).resolves.toBe(newer);
    const quarantines = (await readdir(runtimeDirectory)).filter((name) => name.includes("maintenance-cleanup"));
    expect(quarantines).toHaveLength(1);
    await expect(readFile(join(runtimeDirectory, quarantines[0]), "utf8")).resolves.toBe(replacement);
  });

  test("binds sentinel bytes to an O_NOFOLLOW file descriptor", async () => {
    const root = await mkdtemp(join(tmpdir(), "masthead-maintenance-nofollow-"));
    cleanup.push(root);
    const dataDirectory = join(root, "data");
    const runtimeDirectory = join(dataDirectory, "runtime");
    const lockPath = join(runtimeDirectory, "database.lock");
    const movedPath = join(runtimeDirectory, "moved.lock");
    const targetPath = join(runtimeDirectory, "target.lock");
    const identity = { pid: 9090, starttime: "child-start" };
    const body = JSON.stringify({
      createdAt: "2026-07-13T12:00:00.000Z",
      pid: identity.pid,
      protocol: "canonical-data-directory-lock-v4",
      token: "22222222-2222-4222-8222-222222222222"
    });
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(lockPath, body, "utf8");
    await writeFile(targetPath, body, "utf8");
    await expect(captureMaintenanceSentinel({ dataDirectory }, identity, {
      open: async (path: string, flags: number) => {
        await rename(path, movedPath);
        await symlink(targetPath, path);
        return openFile(path, flags);
      }
    })).rejects.toMatchObject({ code: "ELOOP" });
    await expect(readFile(movedPath, "utf8")).resolves.toBe(body);
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

  test("skips proven other-effective-UID proc entries before EACCES but fails closed for same-UID EACCES", async () => {
    const procRoot = await mkdtemp(join(tmpdir(), "masthead-proc-uid-filter-"));
    cleanup.push(procRoot);
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    const otherUid = currentUid === 0 ? 1 : 0;
    const permissionDenied = () => Object.assign(new Error("permission denied reading proc executable"), { code: "EACCES" });

    await mkdir(join(procRoot, "1490"));
    await writeFile(join(procRoot, "1490", "status"), [
      "Name:\troot-owned",
      `Uid:\t${otherUid}\t${otherUid}\t${otherUid}\t${otherUid}`,
      ""
    ].join("\n"));
    let otherInspected = false;
    await expect(readOwnedProcessStrict(1490, {
      currentUid,
      processRoot: procRoot,
      readProcess: async () => { otherInspected = true; throw permissionDenied(); }
    })).resolves.toBeUndefined();
    expect(otherInspected).toBe(false);

    await mkdir(join(procRoot, "1491"));
    await writeFile(join(procRoot, "1491", "status"), [
      "Name:\tsame-user",
      `Uid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}`,
      ""
    ].join("\n"));
    await writeFile(join(procRoot, "1491", "cmdline"), Buffer.from("/production/Masthead-linux-x64-new/masthead\0"));
    await expect(readOwnedProcessStrict(1491, {
      currentUid,
      processRoot: procRoot,
      readProcess: async () => { throw permissionDenied(); }
    })).rejects.toMatchObject({ code: "EACCES" });
  });

  test("fails closed when effective UID cannot be established, except a stat-proven other owner", async () => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    const otherUid = currentUid === 0 ? 1 : 0;
    const denied = Object.assign(new Error("status permission denied"), { code: "EACCES" });
    await expect(readOwnedProcessStrict(1492, {
      currentUid,
      readStatus: async () => { throw denied; },
      stat: async () => ({ uid: otherUid })
    })).resolves.toBeUndefined();
    await expect(readOwnedProcessStrict(1493, {
      currentUid,
      readStatus: async () => "Name:\tmissing-uid\n",
      stat: async () => ({ uid: currentUid })
    })).rejects.toThrow("effective UID could not be established");
  });

  test("skips an identity-stable same-UID zombie before protected cmdline, exe, or environment reads", async () => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    let metadataReads = 0;
    let statReads = 0;
    let statusReads = 0;
    await expect(readOwnedProcessStrict(1488, {
      currentUid,
      readCommandLine: async () => { metadataReads += 1; throw Object.assign(new Error("protected cmdline"), { code: "EACCES" }); },
      readEnvironment: async () => { metadataReads += 1; throw Object.assign(new Error("protected environ"), { code: "EACCES" }); },
      readExecutable: async () => { metadataReads += 1; throw Object.assign(new Error("protected exe"), { code: "EACCES" }); },
      readStatLine: async () => {
        statReads += 1;
        return `1488 (zypak-sandbox) Z ${Array(18).fill("0").join(" ")} zombie-start`;
      },
      readStatus: async () => {
        statusReads += 1;
        return `Name:\tzypak-sandbox\nState:\tZ (zombie)\nUid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\nThreads:\t1\n`;
      }
    })).resolves.toBeUndefined();
    expect(metadataReads).toBe(0);
    expect(statReads).toBe(2);
    expect(statusReads).toBe(2);
  });

  test("re-verifies transient zombie thread cardinality before failing closed", async () => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    let metadataReads = 0;
    let statusReads = 0;
    await expect(readOwnedProcessStrict(1488, {
      currentUid,
      readCommandLine: async () => { metadataReads += 1; return Buffer.alloc(0); },
      readEnvironment: async () => { metadataReads += 1; return Buffer.alloc(0); },
      readExecutable: async () => { metadataReads += 1; return "/usr/bin/unrelated"; },
      readStatLine: async () => `1488 (gio-launch-desktop) Z ${Array(18).fill("0").join(" ")} stable-start`,
      readStatus: async () => {
        statusReads += 1;
        const threads = statusReads === 1 ? "0" : "1";
        return `Name:\tgio-launch-desktop\nState:\tZ (zombie)\nUid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\nThreads:\t${threads}\n`;
      }
    })).resolves.toBeUndefined();
    expect(metadataReads).toBe(0);
    expect(statusReads).toBeGreaterThanOrEqual(3);
  });

  test("fails closed if a zombie PID identity changes while its exclusion is verified", async () => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    let statusReads = 0;
    await expect(readOwnedProcessStrict(1489, {
      currentUid,
      readCommandLine: async () => Buffer.alloc(0),
      readExecutable: async () => { throw Object.assign(new Error("protected exe"), { code: "EACCES" }); },
      readStatLine: async () => `1489 (process) Z ${Array(18).fill("0").join(" ")} stable-start`,
      readStatus: async () => {
        statusReads += 1;
        const state = statusReads === 1 ? "Z (zombie)" : "S (sleeping)";
        return `Name:\tprocess\nState:\t${state}\nUid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\nThreads:\t1\n`;
      }
    })).rejects.toThrow("zombie identity changed during scan");

    let statReads = 0;
    await expect(readOwnedProcessStrict(1489, {
      currentUid,
      readCommandLine: async () => Buffer.alloc(0),
      readExecutable: async () => { throw Object.assign(new Error("protected exe"), { code: "EACCES" }); },
      readStatLine: async () => {
        statReads += 1;
        return `1489 (process) Z ${Array(18).fill("0").join(" ")} zombie-start-${statReads}`;
      },
      readStatus: async () => `Name:\tprocess\nState:\tZ (zombie)\nUid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\nThreads:\t1\n`
    })).rejects.toThrow("zombie identity changed during scan");
  });

  test.each([
    ["missing", ""],
    ["malformed", "Threads:\tmany\n"],
    ["multiple", "Threads:\t2\n"]
  ])("does not exclude a zombie thread-group leader when its thread count is %s", async (_label, threadsLine) => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    let metadataReads = 0;
    const vanishedExecutable = Object.assign(new Error("zombie leader has no executable"), { code: "ENOENT" });
    await expect(readOwnedProcessStrict(1487, {
      currentUid,
      readCommandLine: async () => { metadataReads += 1; return Buffer.alloc(0); },
      readExecutable: async () => { metadataReads += 1; throw vanishedExecutable; },
      readStatLine: async () => `1487 (leader) Z ${Array(18).fill("0").join(" ")} group-start`,
      readStatus: async () => `Name:\tleader\nState:\tZ (zombie)\nUid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\n${threadsLine}`
    })).rejects.toThrow("thread-group cardinality is unproven");
    expect(metadataReads).toBe(0);
  });

  test("fails closed for every inconsistent or malformed zombie identity field", async () => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    const otherUid = currentUid === 0 ? 1 : 0;
    const status = ({ state = "Z (zombie)", uid = currentUid, threads = "1" } = {}) =>
      `Name:\tprocess\nState:\t${state}\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\nThreads:\t${threads}\n`;
    const statLine = ({ pid = 1486, state = "Z", starttime = "stable-start" } = {}) =>
      `${pid} (process) ${state} ${Array(18).fill("0").join(" ")} ${starttime}`;
    const cases = [
      { label: "initial stat state", stats: [statLine({ state: "S" }), statLine()] },
      { label: "verified stat state", stats: [statLine(), statLine({ state: "S" })] },
      { label: "verified status state", statuses: [status(), status({ state: "S (sleeping)" })] },
      { label: "verified effective UID", statuses: [status(), status({ uid: otherUid })] },
      { label: "verified thread count", statuses: [status(), status({ threads: "2" })] },
      { label: "initial stat PID", stats: [statLine({ pid: 9999 }), statLine()] },
      { label: "verified stat PID", stats: [statLine(), statLine({ pid: 9999 })] },
      { label: "verified status State", statuses: [status(), `Name:\tprocess\nUid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\nThreads:\t1\n`] },
      { label: "verified status Uid", statuses: [status(), "Name:\tprocess\nState:\tZ (zombie)\nThreads:\t1\n"] }
    ];
    for (const scenario of cases) {
      let metadataReads = 0;
      let statReads = 0;
      let statusReads = 0;
      const statuses = scenario.statuses || [status(), status()];
      const stats = scenario.stats || [statLine(), statLine()];
      await expect(readOwnedProcessStrict(1486, {
        currentUid,
        readCommandLine: async () => { metadataReads += 1; return Buffer.alloc(0); },
        readExecutable: async () => { metadataReads += 1; throw Object.assign(new Error("protected exe"), { code: "EACCES" }); },
        readStatLine: async () => stats[Math.min(statReads++, stats.length - 1)],
        readStatus: async () => statuses[Math.min(statusReads++, statuses.length - 1)]
      }), scenario.label).rejects.toThrow("zombie identity changed during scan");
      expect(metadataReads, scenario.label).toBe(0);
    }

    await expect(readOwnedProcessStrict(1486, {
      currentUid,
      readStatLine: async () => "malformed stat",
      readStatus: async () => status()
    })).rejects.toThrow("stat identity is malformed");
  });

  test.each([
    ["first stat", "first_stat"],
    ["second status", "second_status"],
    ["second stat", "second_stat"]
  ])("fails closed when zombie verification %s is permission denied", async (_label, failurePoint) => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    const denied = Object.assign(new Error("zombie verification permission denied"), { code: "EACCES" });
    let metadataReads = 0;
    let statReads = 0;
    let statusReads = 0;
    await expect(readOwnedProcessStrict(1485, {
      currentUid,
      readCommandLine: async () => { metadataReads += 1; return Buffer.alloc(0); },
      readExecutable: async () => { metadataReads += 1; throw denied; },
      readStatLine: async () => {
        statReads += 1;
        if (failurePoint === "first_stat" && statReads === 1) throw denied;
        if (failurePoint === "second_stat" && statReads === 2) throw denied;
        return `1485 (zombie) Z ${Array(18).fill("0").join(" ")} stable-start`;
      },
      readStatus: async () => {
        statusReads += 1;
        if (failurePoint === "second_status" && statusReads === 2) throw denied;
        return `Name:\tzombie\nState:\tZ (zombie)\nUid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\nThreads:\t1\n`;
      }
    })).rejects.toMatchObject({ code: "EACCES" });
    expect(metadataReads).toBe(0);
  });

  test.each([
    ["first stat", "first_stat", "ENOENT"],
    ["second status", "second_status", "ESRCH"],
    ["second stat", "second_stat", "ENOENT"]
  ])("treats zombie disappearance during %s verification as a race", async (_label, failurePoint, code) => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    const disappeared = Object.assign(new Error("zombie disappeared"), { code });
    let metadataReads = 0;
    let statReads = 0;
    let statusReads = 0;
    await expect(readOwnedProcessStrict(1484, {
      currentUid,
      readCommandLine: async () => { metadataReads += 1; return Buffer.alloc(0); },
      readExecutable: async () => { metadataReads += 1; throw disappeared; },
      readStatLine: async () => {
        statReads += 1;
        if (failurePoint === "first_stat" && statReads === 1) throw disappeared;
        if (failurePoint === "second_stat" && statReads === 2) throw disappeared;
        return `1484 (zombie) Z ${Array(18).fill("0").join(" ")} stable-start`;
      },
      readStatus: async () => {
        statusReads += 1;
        if (failurePoint === "second_status" && statusReads === 2) throw disappeared;
        return `Name:\tzombie\nState:\tZ (zombie)\nUid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\nThreads:\t1\n`;
      }
    })).resolves.toBeUndefined();
    expect(metadataReads).toBe(0);
  });

  test("recovers unrelated same-UID systemd user process discovery after unreadable exe inspection", async () => {
    const procRoot = await mkdtemp(join(tmpdir(), "masthead-proc-systemd-user-"));
    cleanup.push(procRoot);
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    await mkdir(join(procRoot, "1490"));
    await writeFile(join(procRoot, "1490", "status"), [
      "Name:\tsystemd",
      `Uid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}`,
      ""
    ].join("\n"));
    await writeFile(join(procRoot, "1490", "cmdline"), Buffer.from("/usr/lib/systemd/systemd\0--user\0"));
    let strictInspection = false;
    await expect(readOwnedProcessStrict(1490, {
      currentUid,
      processRoot: procRoot,
      readCommandLine: () => readFile(join(procRoot, "1490", "cmdline")),
      readProcess: async () => {
        strictInspection = true;
        throw Object.assign(new Error("permission denied reading exe"), { code: "EACCES" });
      },
      scanContext: {
        dataDirectory: "/home/user/.config/masthead-production",
        databasePath: "/home/user/.config/masthead-production/masthead.sqlite",
        productionRoot: "/home/user/.local/share/masthead-production",
        target: "/home/user/.local/share/masthead-production/Masthead-linux-x64-candidate"
      }
    })).resolves.toBeUndefined();
    expect(strictInspection).toBe(true);
  });

  test("keeps a readable production-root executable even when its same-UID command line looks unrelated", async () => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    const record = processRecord({
      argv: ["./helper", "--quiet"],
      exe: "/production/Masthead-linux-x64-old/resources/helper",
      pid: 1496,
      starttime: "helper-start"
    });
    let inspected = 0;
    await expect(readOwnedProcessStrict(1496, {
      currentUid,
      readCommandLine: async () => Buffer.from("./helper\0--quiet\0"),
      readProcess: async () => { inspected += 1; return record as any; },
      readStatus: async () => `Uid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\n`,
      scanContext: {
        dataDirectory: "/data",
        databasePath: "/data/masthead.sqlite",
        productionRoot: "/production",
        target: "/production/Masthead-linux-x64-new"
      }
    })).resolves.toEqual(record);
    expect(inspected).toBe(1);
  });

  test("skips an exact unrelated executable without reading its protected environment even when argv mentions production", async () => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    const deniedEnvironment = Object.assign(new Error("permission denied reading environ"), { code: "EACCES" });
    let environmentReads = 0;
    await expect(readOwnedProcessStrict(1497, {
      currentUid,
      readCommandLine: async () => Buffer.from("/production/Masthead-linux-x64-new/masthead\0--user-data-dir=/data\0--database=/data/masthead.sqlite\0"),
      readExecutable: async () => "/usr/bin/codex",
      readEnvironment: async () => { environmentReads += 1; throw deniedEnvironment; },
      readProcess: async () => { throw deniedEnvironment; },
      readStatLine: async () => `1497 (codex) S ${Array(18).fill("0").join(" ")} 1497-start`,
      readStatus: async () => `Uid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\n`,
      scanContext: {
        dataDirectory: "/data",
        databasePath: "/data/masthead.sqlite",
        productionRoot: "/production",
        target: "/production/Masthead-linux-x64-new"
      }
    })).resolves.toBeUndefined();
    expect(environmentReads).toBe(0);
  });

  test.each([
    ["Electron", "/production/Masthead-linux-x64-old/masthead", ["/production/Masthead-linux-x64-old/masthead", "--user-data-dir=/data"]],
    ["daemon", "/production/Masthead-linux-x64-old/resources/daemon/node", ["/production/Masthead-linux-x64-old/resources/daemon/node", "/production/Masthead-linux-x64-old/resources/daemon/dist/src/daemon/main.js"]],
    ["maintenance", "/production/Masthead-linux-x64-new/resources/daemon/node", ["/production/Masthead-linux-x64-new/resources/daemon/node", "/production/Masthead-linux-x64-new/resources/daemon/dist/src/daemon/productionTransitionMaintenance.js", "restore"]],
    ["bland production-root helper", "/production/Masthead-linux-x64-old/resources/helper", ["./helper", "--quiet"]],
    ["deleted production-root helper", "/production/Masthead-linux-x64-old/resources/helper (deleted)", ["./helper", "--quiet"]]
  ])("fails closed for an exact %s executable when its environment is protected", async (_label, exe, argv) => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    const deniedEnvironment = Object.assign(new Error("permission denied reading environ"), { code: "EACCES" });
    await expect(readOwnedProcessStrict(1498, {
      currentUid,
      readCommandLine: async () => Buffer.from(`${argv.join("\0")}\0`),
      readExecutable: async () => exe,
      readEnvironment: async () => { throw deniedEnvironment; },
      readProcess: async () => { throw deniedEnvironment; },
      readStatLine: async () => `1498 (helper) S ${Array(18).fill("0").join(" ")} 1498-start`,
      readStatus: async () => `Uid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\n`,
      scanContext: {
        dataDirectory: "/data",
        databasePath: "/data/masthead.sqlite",
        productionRoot: "/production",
        target: "/production/Masthead-linux-x64-new"
      }
    })).rejects.toMatchObject({ code: "EACCES" });
  });

  test("returns an identity-stable production-root record from granular proc metadata", async () => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    let commandLineReads = 0;
    let executableReads = 0;
    let statReads = 0;
    await expect(readOwnedProcessStrict(1501, {
      currentUid,
      readCommandLine: async () => {
        commandLineReads += 1;
        return Buffer.from("/production/Masthead-linux-x64-old/masthead\0--user-data-dir=/data\0");
      },
      readEnvironment: async () => Buffer.from("MASTHEAD_DATA_DIR=/data\0MASTHEAD_DB_PATH=/data/masthead.sqlite\0"),
      readExecutable: async () => {
        executableReads += 1;
        return "/production/Masthead-linux-x64-old/masthead";
      },
      readStatLine: async () => {
        statReads += 1;
        return `1501 (masthead) S ${Array(18).fill("0").join(" ")} stable-start`;
      },
      readStatus: async () => `Uid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\n`,
      scanContext: {
        dataDirectory: "/data",
        databasePath: "/data/masthead.sqlite",
        productionRoot: "/production",
        target: "/production/Masthead-linux-x64-new"
      }
    })).resolves.toEqual({
      argv: ["/production/Masthead-linux-x64-old/masthead", "--user-data-dir=/data"],
      environ: { MASTHEAD_DATA_DIR: "/data", MASTHEAD_DB_PATH: "/data/masthead.sqlite" },
      exe: "/production/Masthead-linux-x64-old/masthead",
      pid: 1501,
      starttime: "stable-start"
    });
    expect(commandLineReads).toBe(2);
    expect(executableReads).toBe(3);
    expect(statReads).toBe(3);
  });

  test("does not use exact executable exclusion for a malformed command line or a reused PID", async () => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    const context = {
      dataDirectory: "/data",
      databasePath: "/data/masthead.sqlite",
      productionRoot: "/production",
      target: "/production/Masthead-linux-x64-new"
    };
    const deniedEnvironment = Object.assign(new Error("permission denied reading environ"), { code: "EACCES" });
    await expect(readOwnedProcessStrict(1499, {
      currentUid,
      readCommandLine: async () => Buffer.from("/usr/bin/codex"),
      readExecutable: async () => "/usr/bin/codex",
      readEnvironment: async () => { throw deniedEnvironment; },
      readProcess: async () => { throw deniedEnvironment; },
      readStatLine: async () => `1499 (codex) S ${Array(18).fill("0").join(" ")} 1499-start`,
      readStatus: async () => `Uid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\n`,
      scanContext: context
    })).rejects.toMatchObject({ code: "EACCES" });

    let statReads = 0;
    await expect(readOwnedProcessStrict(1500, {
      currentUid,
      readCommandLine: async () => Buffer.from("/usr/bin/codex\0run\0--database=/data/masthead.sqlite\0"),
      readExecutable: async () => "/usr/bin/codex",
      readEnvironment: async () => { throw deniedEnvironment; },
      readProcess: async () => { throw deniedEnvironment; },
      readStatLine: async () => {
        statReads += 1;
        return `1500 (codex) S ${Array(18).fill("0").join(" ")} 1500-start-${statReads}`;
      },
      readStatus: async () => `Uid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\n`,
      scanContext: context
    })).rejects.toThrow("identity changed during scan");
  });

  test.each([
    ["outside-to-production exec", ["/usr/bin/codex", "/production/Masthead-linux-x64-new/masthead"], false, "executable identity changed during scan"],
    ["production-to-outside exec after environment capture", ["/production/Masthead-linux-x64-new/masthead", "/production/Masthead-linux-x64-new/masthead", "/usr/bin/codex"], true, "executable identity changed during scan"],
    ["production executable deletion transition", ["/production/Masthead-linux-x64-new/masthead", "/production/Masthead-linux-x64-new/masthead (deleted)"], false, "executable identity changed during scan"]
  ])("fails closed across a same-PID %s", async (_label, executables, expectEnvironmentRead, expectedError) => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    let executableReads = 0;
    let environmentReads = 0;
    await expect(readOwnedProcessStrict(1502, {
      currentUid,
      readCommandLine: async () => Buffer.from("/production/Masthead-linux-x64-new/masthead\0--user-data-dir=/data\0"),
      readEnvironment: async () => {
        environmentReads += 1;
        return Buffer.from("MASTHEAD_DATA_DIR=/data\0MASTHEAD_DB_PATH=/data/masthead.sqlite\0");
      },
      readExecutable: async () => executables[Math.min(executableReads++, executables.length - 1)],
      readStatLine: async () => `1502 (process) S ${Array(18).fill("0").join(" ")} stable-start`,
      readStatus: async () => `Uid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\n`,
      scanContext: {
        dataDirectory: "/data",
        databasePath: "/data/masthead.sqlite",
        productionRoot: "/production",
        target: "/production/Masthead-linux-x64-new"
      }
    })).rejects.toThrow(expectedError);
    expect(environmentReads > 0).toBe(expectEnvironmentRead);
  });

  test("fails closed when a repeated exact executable read becomes inaccessible", async () => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    let executableReads = 0;
    const denied = Object.assign(new Error("permission denied verifying exe"), { code: "EACCES" });
    await expect(readOwnedProcessStrict(1503, {
      currentUid,
      readCommandLine: async () => Buffer.from("/usr/bin/codex\0run\0--database=/data/masthead.sqlite\0"),
      readExecutable: async () => {
        executableReads += 1;
        if (executableReads > 1) throw denied;
        return "/usr/bin/codex";
      },
      readStatLine: async () => `1503 (codex) S ${Array(18).fill("0").join(" ")} stable-start`,
      readStatus: async () => `Uid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\n`,
      scanContext: {
        dataDirectory: "/data",
        databasePath: "/data/masthead.sqlite",
        productionRoot: "/production",
        target: "/production/Masthead-linux-x64-new"
      }
    })).rejects.toMatchObject({ code: "EACCES" });
  });

  test("fails closed when argv changes across an otherwise stable production executable identity", async () => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    let commandLineReads = 0;
    await expect(readOwnedProcessStrict(1504, {
      currentUid,
      readCommandLine: async () => {
        commandLineReads += 1;
        return Buffer.from(commandLineReads === 1
          ? "/production/Masthead-linux-x64-new/masthead\0--user-data-dir=/data\0"
          : "/usr/bin/codex\0run\0");
      },
      readEnvironment: async () => Buffer.from("MASTHEAD_DATA_DIR=/data\0MASTHEAD_DB_PATH=/data/masthead.sqlite\0"),
      readExecutable: async () => "/production/Masthead-linux-x64-new/masthead",
      readStatLine: async () => `1504 (process) S ${Array(18).fill("0").join(" ")} stable-start`,
      readStatus: async () => `Uid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\n`,
      scanContext: {
        dataDirectory: "/data",
        databasePath: "/data/masthead.sqlite",
        productionRoot: "/production",
        target: "/production/Masthead-linux-x64-new"
      }
    })).rejects.toThrow("command line changed during scan");
  });

  test.each([
    ["old Electron", ["/production/Masthead-linux-x64-old/masthead", "--user-data-dir=/data"]],
    ["new Electron", ["/production/Masthead-linux-x64-new/masthead", "--user-data-dir=/data"]],
    ["deleted Electron command", ["/production/Masthead-linux-x64-old/masthead", "--type=renderer"]],
    ["daemon", ["/production/Masthead-linux-x64-old/resources/daemon/node", "/production/Masthead-linux-x64-old/resources/daemon/dist/src/daemon/main.js"]],
    ["maintenance", ["/production/Masthead-linux-x64-new/resources/daemon/node", "/production/Masthead-linux-x64-new/resources/daemon/dist/src/daemon/productionTransitionMaintenance.js", "restore", "--request", "{\"databasePath\":\"/data/masthead.sqlite\"}"]],
    ["production identifier", ["/usr/bin/node", "worker.js", "/data/masthead.sqlite"]]
  ])("routes candidate-looking %s command lines through strict inspection", async (_label, argv) => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    let strictInspections = 0;
    const record = processRecord({ argv, pid: 1494 });
    await expect(readOwnedProcessStrict(1494, {
      currentUid,
      readCommandLine: async () => Buffer.from(`${argv.join("\0")}\0`),
      readProcess: async () => { strictInspections += 1; return record as any; },
      readStatus: async () => `Uid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\n`,
      scanContext: {
        dataDirectory: "/data",
        databasePath: "/data/masthead.sqlite",
        productionRoot: "/production",
        target: "/production/Masthead-linux-x64-new"
      }
    })).resolves.toEqual(record);
    expect(strictInspections).toBe(1);
  });

  test("fails closed when a candidate-looking or malformed same-UID command has unreadable exe", async () => {
    const currentUid = typeof process.geteuid === "function" ? process.geteuid() : 1000;
    const context = {
      dataDirectory: "/data",
      databasePath: "/data/masthead.sqlite",
      productionRoot: "/production",
      target: "/production/Masthead-linux-x64-new"
    };
    const denied = () => Object.assign(new Error("permission denied reading exe"), { code: "EACCES" });
    for (const commandLine of [
      Buffer.from("/production/Masthead-linux-x64-new/masthead\0--user-data-dir=/data\0"),
      Buffer.alloc(0)
    ]) {
      await expect(readOwnedProcessStrict(1495, {
        currentUid,
        readCommandLine: async () => commandLine,
        readProcess: async () => { throw denied(); },
        readStatus: async () => `Uid:\t${currentUid}\t${currentUid}\t${currentUid}\t${currentUid}\n`,
        scanContext: context
      })).rejects.toMatchObject({ code: "EACCES" });
    }
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
    expect(desktop).toContain("StartupWMClass=masthead");
  });

  test("refreshes the Linux desktop database after atomically installing the production entry", async () => {
    const { config, homeDir, productionRoot, target } = await fixture();
    const calls: Array<{ command: string; args: string[] }> = [];

    await installProductionLauncher({
      bundleDigest: config.bundleDigest,
      bundlePath: target,
      homeDir,
      productionRoot
    }, {
      runDesktopDatabaseCommand: (command: string, args: string[]) => {
        calls.push({ args, command });
      }
    });

    expect(calls).toEqual([{
      args: [join(homeDir, ".local", "share", "applications")],
      command: "update-desktop-database"
    }]);
  });

  test("keeps production launcher installation successful when desktop cache refresh is unavailable", async () => {
    const { config, homeDir, productionRoot, target } = await fixture();

    await expect(installProductionLauncher({
      bundleDigest: config.bundleDigest,
      bundlePath: target,
      homeDir,
      productionRoot
    }, {
      runDesktopDatabaseCommand: () => {
        throw new Error("update-desktop-database unavailable");
      }
    })).resolves.toMatchObject({ target });
  });

  test("refuses to install a production desktop entry without its packaged app icon", async () => {
    const { config, homeDir, productionRoot, target } = await fixture({ includeIcon: false });

    await expect(installProductionLauncher({
      bundleDigest: config.bundleDigest,
      bundlePath: target,
      homeDir,
      productionRoot
    })).rejects.toThrow("Production app icon is missing or unreadable");
  });

  test("refuses a readable production app icon that is not a valid PNG", async () => {
    const { config, homeDir, productionRoot, target } = await fixture({ iconContents: Buffer.alloc(0) });

    await expect(installProductionLauncher({
      bundleDigest: config.bundleDigest,
      bundlePath: target,
      homeDir,
      productionRoot
    })).rejects.toThrow("Production app icon is not a valid PNG");
  });

  test("refuses an iconless production transition before lifecycle mutation", async () => {
    const { config, homeDir, productionRoot, target } = await fixture({ includeIcon: false });
    let lifecycleStarted = false;

    await expect(transitionProduction({
      bundleDigest: config.bundleDigest,
      bundlePath: target,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => {
        lifecycleStarted = true;
        throw new Error("Lifecycle mutation started");
      }
    })).rejects.toThrow("Production app icon is missing or unreadable");
    expect(lifecycleStarted).toBe(false);
  });

  test("refuses an iconless cold-activation candidate before lifecycle mutation", async () => {
    const { config, homeDir, productionRoot, target } = await fixture({ includeIcon: false });
    let lifecycleStarted = false;

    await expect(coldActivateProduction({
      bundleDigest: config.bundleDigest,
      bundlePath: target,
      dataDirectory: config.dataDirectory,
      databasePath: config.databasePath,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => {
        lifecycleStarted = true;
        throw new Error("Lifecycle mutation started");
      }
    })).rejects.toThrow("Production app icon is missing or unreadable");
    expect(lifecycleStarted).toBe(false);
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

  test("activates a staged desktop identity before refreshing the Linux desktop database", async () => {
    const { config, homeDir, productionRoot, target } = await fixture();
    const launcherPath = join(homeDir, ".local", "bin", "masthead-production");
    const desktopPath = join(homeDir, ".local", "share", "applications", "ai.animas.masthead.desktop");
    await writeFile(launcherPath, `MASTHEAD_BUNDLE_DIGEST='${config.bundleDigest}'\n`, { mode: 0o755 });
    await writeFile(desktopPath, "previous desktop entry\n");
    const refreshCalls: string[] = [];

    await transitionProduction({
      bundleDigest: config.bundleDigest,
      bundlePath: target,
      dataDirectory: config.dataDirectory,
      homeDir,
      port: config.port,
      productionRoot
    }, {
      acquireLease: async () => ({ release: async () => undefined }),
      completeMaintenance: async () => undefined,
      currentTarget: async () => target,
      prepareMaintenance: async () => ({ databaseId: "database:test", targetSchemaVersion: 1 }),
      readMaintenanceJournal: async () => undefined,
      runDesktopDatabaseCommand: (command: string) => {
        expect(readFileSync(desktopPath, "utf8")).toContain("StartupWMClass=masthead");
        refreshCalls.push(command);
      },
      start: async () => ({ started: true }),
      stop: async () => ({ stopped: true })
    });

    expect(await readFile(desktopPath, "utf8")).toContain("StartupWMClass=masthead");
    expect(refreshCalls).toEqual(["update-desktop-database"]);
  });

  test("requires explicit cold activation for a legacy current target with no attestable release identity", async () => {
    const { candidate, config, homeDir, legacyTarget, productionRoot } = await legacyBoundaryFixture();
    let prepared = false;
    await expect(transitionProduction({
      bundleDigest: candidate.bundleDigest,
      bundlePath: candidate.target,
      dataDirectory: config.dataDirectory,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => ({ release: async () => undefined }),
      prepareMaintenance: async () => { prepared = true; }
    })).rejects.toThrow();
    expect(prepared).toBe(false);
    expect(await realpath(join(productionRoot, "current"))).toBe(legacyTarget);
  });

  test("cold-activates a fully attested candidate without reading or executing the legacy bundle", async () => {
    const { candidate, config, homeDir, legacyTarget, productionRoot } = await legacyBoundaryFixture();
    const nonce = "21212121-2121-4121-8121-212121212121";
    const oldIdentity = legacyIdentity(legacyTarget);
    const calls: string[] = [];
    let current = legacyTarget;
    const result = await coldActivateProduction({
      bundleDigest: candidate.bundleDigest,
      bundlePath: candidate.target,
      dataDirectory: config.dataDirectory,
      databasePath: config.databasePath,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => ({ release: async () => calls.push("release") }),
      assertLegacyIdentity: async () => calls.push("assert-legacy"),
      assertOffline: async () => calls.push("offline"),
      attestCandidate: async () => calls.push("attest-candidate"),
      captureLegacyIdentity: async () => oldIdentity,
      cleanupBundles: async () => calls.push("cleanup-bundles"),
      completeMaintenance: async (request: any) => calls.push(`complete:${request.nonce}`),
      currentTarget: async () => current,
      createNonce: () => nonce,
      installCandidateSurface: async () => calls.push("candidate-surface"),
      installDisabledSurface: async () => calls.push("disabled"),
      prepareMaintenance: async (request: any) => {
        calls.push("prepare");
        expect(request).toMatchObject({
          databasePath: config.databasePath,
          legacyTarget: oldIdentity,
          newBundle: candidate,
          rollbackMode: "offline_only"
        });
        expect(request).not.toHaveProperty("oldBundle");
        return {
          ...request,
          databaseId: "legacy-db",
          schemaVersion: 2,
          sourceSchemaVersion: 21,
          state: "ready_to_activate",
          targetSchemaVersion: 23
        };
      },
      readMaintenanceJournal: async () => undefined,
      start: async (startConfig: any) => {
        calls.push("start-candidate");
        expect(startConfig).toMatchObject({
          expectedDatabaseId: "legacy-db",
          expectedSchemaVersion: 23,
          target: candidate.target
        });
        return { started: true };
      },
      swapCurrent: async () => { calls.push("swap-candidate"); current = candidate.target; },
      verifyCandidate: async () => calls.push("verify-candidate")
    });
    expect(result).toMatchObject({ activated: true, coldActivated: true, target: candidate.target });
    expect(calls).toEqual([
      "attest-candidate", "offline", "disabled", "offline", "prepare", "assert-legacy", "attest-candidate",
      "swap-candidate", "candidate-surface", "attest-candidate", "start-candidate", "attest-candidate", "assert-legacy",
      "verify-candidate",
      `complete:${nonce}`, "cleanup-bundles", "release"
    ]);
  });

  test("does not roll back a committed healthy candidate when success-only bundle cleanup fails", async () => {
    const { candidate, config, homeDir, legacyTarget, productionRoot } = await legacyBoundaryFixture();
    const nonce = "28282828-2828-4828-8828-282828282828";
    const oldIdentity = legacyIdentity(legacyTarget);
    const calls: string[] = [];
    await expect(coldActivateProduction({
      bundleDigest: candidate.bundleDigest,
      bundlePath: candidate.target,
      dataDirectory: config.dataDirectory,
      databasePath: config.databasePath,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => ({ release: async () => calls.push("release") }),
      assertLegacyIdentity: async () => undefined,
      assertOffline: async () => undefined,
      attestCandidate: async () => undefined,
      captureLegacyIdentity: async () => oldIdentity,
      cleanupBundles: async () => { calls.push("cleanup-bundles"); throw new Error("bundle cleanup failed"); },
      completeMaintenance: async () => calls.push("commit"),
      createNonce: () => nonce,
      currentTarget: async () => legacyTarget,
      installCandidateSurface: async () => calls.push("candidate-surface"),
      installDisabledSurface: async () => calls.push("disabled"),
      prepareMaintenance: async (request: any) => ({
        ...request,
        databaseId: "legacy-db",
        schemaVersion: 2,
        sourceSchemaVersion: 21,
        state: "ready_to_activate",
        targetSchemaVersion: 23
      }),
      readMaintenanceJournal: async () => undefined,
      restoreMaintenance: async () => { calls.push("restore"); },
      start: async () => ({ started: true }),
      stopCandidate: async () => calls.push("stop-candidate"),
      stopMaintenance: async () => calls.push("stop-maintenance"),
      swapCurrent: async () => undefined,
      verifyCandidate: async () => calls.push("verify-candidate")
    })).rejects.toThrow("bundle cleanup failed");
    expect(calls).toEqual([
      "disabled", "candidate-surface", "verify-candidate", "commit", "cleanup-bundles", "release"
    ]);
  });

  test("re-attests identities after startup verification and before durable completion", async () => {
    const { candidate, config, homeDir, legacyTarget, productionRoot } = await legacyBoundaryFixture();
    const nonce = "29292929-2929-4929-8929-292929292929";
    const oldIdentity = legacyIdentity(legacyTarget);
    const calls: string[] = [];
    let attestations = 0;
    let journalReads = 0;
    let receipt: any;
    await expect(coldActivateProduction({
      bundleDigest: candidate.bundleDigest,
      bundlePath: candidate.target,
      dataDirectory: config.dataDirectory,
      databasePath: config.databasePath,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => ({ release: async () => calls.push("release") }),
      assertLegacyIdentity: async () => undefined,
      assertOffline: async () => undefined,
      attestCandidate: async () => {
        attestations += 1;
        calls.push(`attest:${attestations}`);
        if (attestations === 4) throw new Error("candidate replaced during startup verification");
      },
      captureLegacyIdentity: async () => oldIdentity,
      cleanupBundles: async () => calls.push("cleanup-bundles"),
      completeMaintenance: async () => calls.push("complete-rollback"),
      createNonce: () => nonce,
      currentTarget: async () => legacyTarget,
      installCandidateSurface: async () => calls.push("candidate-surface"),
      installDisabledSurface: async () => calls.push("disabled"),
      prepareMaintenance: async (request: any) => {
        receipt = {
          ...request,
          databaseId: "legacy-db",
          schemaVersion: 2,
          sourceSchemaVersion: 21,
          state: "ready_to_activate",
          targetSchemaVersion: 23
        };
        return receipt;
      },
      readMaintenanceJournal: async () => (++journalReads === 1 ? undefined : receipt),
      restoreCurrent: async () => calls.push("restore-current"),
      restoreMaintenance: async (request: any) => ({ ...request, state: "restored" }),
      start: async () => { calls.push("start-candidate"); return { started: true }; },
      stopCandidate: async () => calls.push("stop-candidate"),
      stopMaintenance: async () => calls.push("stop-maintenance"),
      swapCurrent: async () => undefined
    })).rejects.toThrow("candidate replaced during startup verification; cold rollback offline=true");
    expect(calls).toContain("attest:4");
    expect(calls).toContain("complete-rollback");
    expect(calls).not.toContain("cleanup-bundles");
  });

  test("rolls back when the candidate dies during final identity attestation before commit", async () => {
    const { candidate, config, homeDir, legacyTarget, productionRoot } = await legacyBoundaryFixture();
    const nonce = "30303030-3030-4030-8030-303030303030";
    const oldIdentity = legacyIdentity(legacyTarget);
    const calls: string[] = [];
    let attestations = 0;
    let candidateAlive = true;
    let journalReads = 0;
    let receipt: any;
    await expect(coldActivateProduction({
      bundleDigest: candidate.bundleDigest,
      bundlePath: candidate.target,
      dataDirectory: config.dataDirectory,
      databasePath: config.databasePath,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => ({ release: async () => calls.push("release") }),
      assertLegacyIdentity: async () => undefined,
      assertOffline: async () => calls.push("offline"),
      attestCandidate: async () => {
        attestations += 1;
        if (attestations === 4) candidateAlive = false;
      },
      captureLegacyIdentity: async () => oldIdentity,
      cleanupBundles: async () => calls.push("cleanup-bundles"),
      completeMaintenance: async (request: any) => calls.push(request.state === "restored" ? "complete-rollback" : "complete-success"),
      createNonce: () => nonce,
      currentTarget: async () => legacyTarget,
      installCandidateSurface: async () => undefined,
      installDisabledSurface: async () => undefined,
      prepareMaintenance: async (request: any) => {
        receipt = {
          ...request,
          databaseId: "legacy-db",
          schemaVersion: 2,
          sourceSchemaVersion: 21,
          state: "ready_to_activate",
          targetSchemaVersion: 23
        };
        return receipt;
      },
      readMaintenanceJournal: async () => (++journalReads === 1 ? undefined : receipt),
      restoreCurrent: async () => calls.push("restore-current"),
      restoreMaintenance: async (request: any) => ({ ...request, state: "restored" }),
      start: async () => ({ started: true }),
      stopCandidate: async () => calls.push("stop-candidate"),
      stopMaintenance: async () => calls.push("stop-maintenance"),
      swapCurrent: async () => undefined,
      verifyCandidate: async () => {
        calls.push("verify-candidate");
        if (!candidateAlive) throw new Error("candidate topology disappeared after attestation");
      }
    })).rejects.toThrow("candidate topology disappeared after attestation; cold rollback offline=true");
    expect(calls).toContain("complete-rollback");
    expect(calls).not.toContain("complete-success");
    expect(calls).not.toContain("cleanup-bundles");
  });

  test("requires an explicit database path before cold activation acquires the lifecycle lease", async () => {
    const { candidate, config, homeDir, productionRoot } = await legacyBoundaryFixture();
    let leased = false;
    await expect((coldActivateProduction as any)({
      bundleDigest: candidate.bundleDigest,
      bundlePath: candidate.target,
      dataDirectory: config.dataDirectory,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => { leased = true; return { release: async () => undefined }; }
    })).rejects.toThrow("explicit --db-path");
    expect(leased).toBe(false);
  });

  test("cold activation refuses failed offline preconditions before maintenance or mutation", async () => {
    const { candidate, config, homeDir, legacyTarget, productionRoot } = await legacyBoundaryFixture();
    const calls: string[] = [];
    const oldIdentity = legacyIdentity(legacyTarget);
    await expect(coldActivateProduction({
      bundleDigest: candidate.bundleDigest,
      bundlePath: candidate.target,
      dataDirectory: config.dataDirectory,
      databasePath: config.databasePath,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => ({ release: async () => calls.push("release") }),
      assertLegacyIdentity: async () => undefined,
      assertOffline: async () => { calls.push("offline"); throw new Error("production health is present"); },
      captureLegacyIdentity: async () => oldIdentity,
      currentTarget: async () => legacyTarget,
      installDisabledSurface: async () => calls.push("disabled"),
      prepareMaintenance: async () => calls.push("prepare"),
      readMaintenanceJournal: async () => undefined,
      swapCurrent: async () => calls.push("swap")
    })).rejects.toThrow("production health is present");
    expect(calls).toEqual(["offline", "release"]);
  });

  test("re-proves offline after disabling and refuses a legacy-start race before maintenance", async () => {
    const { candidate, config, homeDir, legacyTarget, productionRoot } = await legacyBoundaryFixture();
    const calls: string[] = [];
    let offlineProofs = 0;
    await expect(coldActivateProduction({
      bundleDigest: candidate.bundleDigest,
      bundlePath: candidate.target,
      dataDirectory: config.dataDirectory,
      databasePath: config.databasePath,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => ({ release: async () => calls.push("release") }),
      assertOffline: async () => {
        offlineProofs += 1;
        calls.push(`offline:${offlineProofs}`);
        if (offlineProofs === 2) throw new Error("legacy process started during disable boundary");
      },
      captureLegacyIdentity: async () => legacyIdentity(legacyTarget),
      currentTarget: async () => legacyTarget,
      installDisabledSurface: async () => calls.push("disabled"),
      prepareMaintenance: async () => calls.push("prepare"),
      readMaintenanceJournal: async () => undefined
    })).rejects.toThrow("legacy process started during disable boundary");
    expect(calls).toEqual(["offline:1", "disabled", "offline:2", "release"]);
  });

  test("cold offline proof rejects any production-root executable, health, port, or ownership conflict", async () => {
    const { candidate, config } = await legacyBoundaryFixture();
    const coldConfig = {
      ...config,
      bundleDigest: candidate.bundleDigest,
      gitSha: candidate.gitSha,
      target: candidate.target,
      version: candidate.version
    };
    const unknownProductionChild = processRecord({
      argv: [join(candidate.target, "masthead"), "--type=utility"],
      environ: {},
      exe: join(candidate.target, "masthead")
    });
    await expect(assertColdProductionOffline(coldConfig, {
      readProcesses: async () => [unknownProductionChild]
    })).rejects.toThrow("empty production process set");

    const base = {
      fetchHealth: async () => undefined,
      ownershipProbe: async () => undefined,
      portBindable: async () => true,
      readProcesses: async () => []
    };
    await expect(assertColdProductionOffline(coldConfig, {
      ...base,
      fetchHealth: async () => ({ ok: true })
    })).rejects.toThrow("health to be absent");
    await expect(assertColdProductionOffline(coldConfig, {
      ...base,
      portBindable: async () => false
    })).rejects.toThrow("bindable");
    await expect(assertColdProductionOffline(coldConfig, {
      ...base,
      ownershipProbe: async () => { throw new Error("database ownership unavailable"); }
    })).rejects.toThrow("database ownership unavailable");
  });

  test("cold activation leaves a deterministic disabled surface after a receipt-clean prepare failure", async () => {
    const { candidate, config, homeDir, legacyTarget, productionRoot } = await legacyBoundaryFixture();
    const calls: string[] = [];
    const oldIdentity = legacyIdentity(legacyTarget);
    await expect(coldActivateProduction({
      bundleDigest: candidate.bundleDigest,
      bundlePath: candidate.target,
      dataDirectory: config.dataDirectory,
      databasePath: config.databasePath,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => ({ release: async () => calls.push("release") }),
      assertLegacyIdentity: async () => undefined,
      assertOffline: async () => calls.push("offline"),
      captureLegacyIdentity: async () => oldIdentity,
      currentTarget: async () => legacyTarget,
      installDisabledSurface: async () => calls.push("disabled"),
      prepareMaintenance: async () => { calls.push("prepare"); throw new Error("migration rejected and internally restored"); },
      readMaintenanceJournal: async () => undefined,
      restoreCurrent: async () => calls.push("restore-current"),
      stopCandidate: async () => calls.push("stop-candidate"),
      stopMaintenance: async () => calls.push("stop-maintenance")
    })).rejects.toThrow("cold rollback offline=true");
    expect(calls).toEqual([
      "offline", "disabled", "offline", "prepare", "disabled", "stop-maintenance", "stop-candidate",
      "restore-current", "offline", "release"
    ]);
  });

  test("cold activation restores the receipt-bound database and never restarts legacy after candidate failure", async () => {
    const { candidate, config, homeDir, legacyTarget, productionRoot } = await legacyBoundaryFixture();
    const nonce = "22222222-3333-4333-8333-222222222222";
    const oldIdentity = legacyIdentity(legacyTarget);
    const request = {
      databaseId: "legacy-db",
      databasePath: config.databasePath,
      legacyTarget: oldIdentity,
      newBundle: candidate,
      nonce,
      rollbackMode: "offline_only",
      schemaVersion: 2,
      sourceSchemaVersion: 21,
      state: "ready_to_activate",
      targetSchemaVersion: 23
    };
    const calls: string[] = [];
    let journalReads = 0;
    await expect(coldActivateProduction({
      bundleDigest: candidate.bundleDigest,
      bundlePath: candidate.target,
      dataDirectory: config.dataDirectory,
      databasePath: config.databasePath,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => ({ release: async () => calls.push("release") }),
      assertLegacyIdentity: async () => undefined,
      assertOffline: async () => calls.push("offline"),
      captureLegacyIdentity: async () => oldIdentity,
      createNonce: () => nonce,
      completeMaintenance: async () => calls.push("complete"),
      currentTarget: async () => legacyTarget,
      installCandidateSurface: async () => calls.push("candidate-surface"),
      installDisabledSurface: async () => calls.push("disabled"),
      prepareMaintenance: async () => request,
      readMaintenanceJournal: async () => (++journalReads === 1 ? undefined : request),
      restoreCurrent: async () => calls.push("restore-current"),
      restoreMaintenance: async (value: any) => {
        calls.push("restore-database");
        return { ...value, databaseId: "legacy-db", sourceSchemaVersion: 21, state: "restored" };
      },
      start: async () => { calls.push("start-candidate"); throw new Error("candidate health failed"); },
      stopCandidate: async () => calls.push("stop-candidate"),
      stopMaintenance: async () => calls.push("stop-maintenance"),
      swapCurrent: async () => calls.push("swap-candidate")
    })).rejects.toThrow("cold rollback offline=true");
    expect(calls).toEqual([
      "offline", "disabled", "offline", "swap-candidate", "candidate-surface", "start-candidate", "disabled",
      "stop-maintenance", "stop-candidate", "restore-database", "restore-current", "offline", "complete", "release"
    ]);
    expect(calls).not.toContain("start-legacy");
  });

  test.each(["snapshot_ready", "ready_to_activate", "restoring", "restore_failed", "restored"])(
    "cold activation rerun recovers offline-only %s journals from either current position",
    async (state) => {
      for (const currentPosition of ["legacy", "candidate"] as const) {
        const { candidate, config, homeDir, legacyTarget, productionRoot } = await legacyBoundaryFixture();
        const nonce = "23232323-2323-4323-8323-232323232323";
        const oldIdentity = legacyIdentity(legacyTarget);
        const journal = {
          databaseId: "legacy-db",
          databasePath: config.databasePath,
          legacyTarget: oldIdentity,
          newBundle: candidate,
          nonce,
          rollbackMode: "offline_only",
          schemaVersion: 2,
          sourceSchemaVersion: 21,
          state,
          targetSchemaVersion: 23
        };
        const calls: string[] = [];
        const result = await coldActivateProduction({
          bundleDigest: candidate.bundleDigest,
          bundlePath: candidate.target,
          dataDirectory: config.dataDirectory,
          databasePath: config.databasePath,
          homeDir,
          productionRoot
        }, {
          acquireLease: async () => ({ release: async () => calls.push("release") }),
          assertLegacyIdentity: async () => undefined,
          assertOffline: async () => calls.push("offline"),
          completeMaintenance: async () => calls.push("complete"),
          currentTarget: async () => currentPosition === "legacy" ? legacyTarget : candidate.target,
          installDisabledSurface: async () => calls.push("disabled"),
          prepareMaintenance: async () => { calls.push("prepare"); throw new Error("must not prepare"); },
          readMaintenanceJournal: async () => journal,
          restoreCurrent: async () => calls.push("restore-current"),
          restoreMaintenance: async (value: any) => {
            calls.push("restore-database");
            return { ...value, databaseId: "legacy-db", sourceSchemaVersion: 21, state: "restored" };
          },
          start: async () => { calls.push("start"); throw new Error("must not start"); },
          stopCandidate: async () => calls.push("stop-candidate"),
          stopMaintenance: async () => calls.push("stop-maintenance")
        });
        expect(result).toMatchObject({ activated: false, coldActivated: true, recovered: true, target: legacyTarget });
        expect(calls).toEqual([
          "disabled", "stop-maintenance", "stop-candidate", "restore-database", "restore-current", "offline", "complete", "release"
        ]);
      }
    }
  );

  test("installs a deterministic disabled cold-rollback launcher that executes neither legacy nor candidate", async () => {
    const { candidate, homeDir, legacyTarget } = await legacyBoundaryFixture();
    const databasePath = join(homeDir, "data", "masthead.sqlite");
    const receipt = await installDisabledProductionSurface({ databasePath, homeDir });
    const wrapper = await readFile(receipt.launcherPath, "utf8");
    const desktop = await readFile(receipt.desktopPath, "utf8");
    expect(wrapper).toContain("Masthead production is offline after legacy cold activation");
    expect(wrapper).toContain("exit 78");
    expect(wrapper).not.toContain(candidate.target);
    expect(wrapper).not.toContain(legacyTarget);
    expect(desktop).toContain(`Exec=${receipt.launcherPath}`);
    expect(desktop).toContain("Name=Masthead (Offline)");
    expect(desktop).not.toContain(candidate.target);
    expect(desktop).not.toContain(legacyTarget);

    const child = spawn(receipt.launcherPath, [], { stdio: ["ignore", "pipe", "pipe"] });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const [code] = await once(child, "close");
    expect(code).toBe(78);
    expect(Buffer.concat(stderr).toString("utf8")).toContain("--cold-activate");

    await mkdir(join(homeDir, "data"), { recursive: true });
    await writeFile(`${databasePath}.production-transition.json`, JSON.stringify({
      rollbackMode: "offline_only",
      schemaVersion: 2,
      state: "restore_failed"
    }));
    const status = spawn(receipt.launcherPath, ["status"], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    status.stdout.on("data", (chunk) => stdout.push(chunk));
    const [statusCode] = await once(status, "close");
    expect(statusCode).toBe(0);
    expect(JSON.parse(Buffer.concat(stdout).toString("utf8"))).toEqual({ coldActivation: { pending: true } });
  });

  test("captures exact legacy device and inode identities above Number.MAX_SAFE_INTEGER", async () => {
    const productionRoot = "/production";
    const target = "/production/Masthead-linux-x64-legacy";
    await expect(captureLegacyTargetIdentity(target, productionRoot, {
      lstat: async () => ({
        dev: 90071992547409931234n,
        ino: 90071992547409939876n,
        isDirectory: () => true,
        isSymbolicLink: () => false
      }),
      realpath: async (path: string) => path
    })).resolves.toEqual({
      device: "90071992547409931234",
      inode: "90071992547409939876",
      path: target
    });
  });

  test("ordinary install and start reject an offline-only journal before process or surface mutation", async () => {
    const { candidate, config, homeDir, legacyTarget, productionRoot } = await legacyBoundaryFixture();
    const pending = {
      databaseId: "legacy-db",
      databasePath: config.databasePath,
      legacyTarget: legacyIdentity(legacyTarget),
      newBundle: candidate,
      nonce: "24242424-2424-4424-8424-242424242424",
      rollbackMode: "offline_only",
      schemaVersion: 2,
      sourceSchemaVersion: 21,
      state: "ready_to_activate",
      targetSchemaVersion: 23
    };
    const installCalls: string[] = [];
    await expect(transitionProduction({
      bundleDigest: candidate.bundleDigest,
      bundlePath: candidate.target,
      dataDirectory: config.dataDirectory,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => ({ release: async () => installCalls.push("release") }),
      readMaintenanceJournal: async () => pending,
      stageLaunchers: async () => installCalls.push("stage"),
      stop: async () => installCalls.push("stop")
    })).rejects.toThrow("--cold-activate");
    expect(installCalls).toEqual(["release"]);

    const startCalls: string[] = [];
    await expect(startProduction({
      ...config,
      bundleDigest: candidate.bundleDigest,
      gitSha: candidate.gitSha,
      target: candidate.target,
      version: candidate.version
    }, {
      acquireLease: async () => ({ release: async () => startCalls.push("release") }),
      currentTarget: async () => { startCalls.push("current"); return candidate.target; },
      readMaintenanceJournal: async () => pending,
      readProcesses: async () => { startCalls.push("processes"); return []; }
    })).rejects.toThrow("ordinary start is disabled");
    expect(startCalls).toEqual(["release"]);
  });

  test("cold activation refuses a replaced legacy directory before swap or database restore", async () => {
    const { candidate, config, homeDir, legacyTarget, productionRoot } = await legacyBoundaryFixture();
    const { rename, rm } = await import("node:fs/promises");
    const displaced = `${legacyTarget}-displaced`;
    let receipt: any;
    const calls: string[] = [];
    await expect(coldActivateProduction({
      bundleDigest: candidate.bundleDigest,
      bundlePath: candidate.target,
      dataDirectory: config.dataDirectory,
      databasePath: config.databasePath,
      homeDir,
      productionRoot
    }, {
      acquireLease: async () => ({ release: async () => calls.push("release") }),
      assertOffline: async () => undefined,
      currentTarget: async () => legacyTarget,
      installDisabledSurface: async () => calls.push("disabled"),
      prepareMaintenance: async (request: any) => {
        await rename(legacyTarget, displaced);
        await mkdir(legacyTarget);
        receipt = {
          ...request,
          databaseId: "legacy-db",
          schemaVersion: 2,
          sourceSchemaVersion: 21,
          state: "ready_to_activate",
          targetSchemaVersion: 23
        };
        return receipt;
      },
      readMaintenanceJournal: async () => receipt,
      restoreMaintenance: async () => { calls.push("restore-database"); },
      stopCandidate: async () => calls.push("stop-candidate"),
      stopMaintenance: async () => calls.push("stop-maintenance"),
      swapCurrent: async () => calls.push("swap")
    })).rejects.toThrow("filesystem identity changed");
    expect(calls).not.toContain("swap");
    expect(calls).not.toContain("restore-database");
    await rm(legacyTarget, { recursive: true });
    await rename(displaced, legacyTarget);
  });

  test("stops only an exact receipt-bound orphan maintenance child with SIGTERM", async () => {
    const { candidate, config, productionRoot } = await legacyBoundaryFixture();
    const coldConfig = {
      ...config,
      bundleDigest: candidate.bundleDigest,
      gitSha: candidate.gitSha,
      target: candidate.target,
      version: candidate.version
    };
    const request = {
      databasePath: config.databasePath,
      legacyTarget: legacyIdentity(join(productionRoot, "Masthead-linux-x64-legacy")),
      newBundle: candidate,
      nonce: "25252525-2525-4525-8525-252525252525",
      rollbackMode: "offline_only"
    };
    const runtime = {
      node: join(candidate.target, "resources", "daemon", "node"),
      maintenance: join(candidate.target, "resources", "daemon", "dist", "src", "daemon", "productionTransitionMaintenance.js")
    };
    const record = processRecord({
      argv: [runtime.node, runtime.maintenance, "restore", "--request", JSON.stringify(request)],
      environ: { MASTHEAD_DATA_DIR: config.dataDirectory, MASTHEAD_DB_PATH: config.databasePath },
      exe: runtime.node,
      pid: 77,
      starttime: "exact-start"
    });
    const signals: Array<[number, string]> = [];
    let scans = 0;
    await stopColdMaintenanceChildren(coldConfig, request, {
      readProcess: async () => record,
      readProcesses: async () => (++scans === 1 ? [record] : []),
      signal: (pid: number, signal: string) => signals.push([pid, signal]),
      waitForExit: async () => true
    });
    expect(signals).toEqual([[77, "SIGTERM"]]);

    await expect(stopColdMaintenanceChildren(coldConfig, { ...request, nonce: "26262626-2626-4626-8626-262626262626" }, {
      readProcesses: async () => [record],
      signal: (pid: number, signal: string) => signals.push([pid, signal])
    })).rejects.toThrow("unrecognized maintenance child");
    expect(signals).toEqual([[77, "SIGTERM"]]);
  });

  test("status reports an offline-only cold journal without mutating it", async () => {
    const { candidate, config, legacyTarget } = await legacyBoundaryFixture();
    const pending = {
      databaseId: "legacy-db",
      legacyTarget: legacyIdentity(legacyTarget),
      newBundle: candidate,
      nonce: "27272727-2727-4727-8727-272727272727",
      rollbackMode: "offline_only",
      schemaVersion: 2,
      state: "restore_failed"
    };
    const result = await statusProduction({
      ...config,
      bundleDigest: candidate.bundleDigest,
      gitSha: candidate.gitSha,
      target: candidate.target,
      version: candidate.version
    }, {
      currentTarget: async () => candidate.target,
      fetchHealth: async () => undefined,
      readMaintenanceJournal: async () => pending,
      readProcesses: async () => []
    });
    expect(result).toMatchObject({
      coldActivation: {
        databaseId: "legacy-db",
        legacyTarget,
        nonce: pending.nonce,
        pending: true,
        state: "restore_failed",
        target: candidate.target
      }
    });
  });

  test("the public cold CLI forwards an explicit database path", async () => {
    const source = await readFile("scripts/masthead-production.js", "utf8");
    expect(source).toContain('argv.includes("--cold-activate") ? coldActivateProduction : transitionProduction');
    expect(source).toContain('databasePath: option(argv, "--db-path")');
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
    expect(classifyProductionProcess({ ...electron, argv: [electron.argv.join(" ")] }, config))
      .toMatchObject({ role: "electron", target });
    expect(classifyProductionProcess(daemon, config)).toMatchObject({ role: "daemon", target });
    expect(classifyProductionProcess({ ...electron, argv: [...electron.argv, "--type=renderer"] }, config)).toBeUndefined();
    expect(classifyProductionProcess({ ...electron, environ: {} }, config)).toMatchObject({ role: "electron", target });
    expect(classifyProductionProcess({
      ...electron,
      argv: [...electron.argv, "--user-data-dir=/tmp/other-masthead-profile"]
    }, config)).toBeUndefined();
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

  test("start reaches Electron when the first-run database does not exist", async () => {
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
    let scans = 0;

    await expect(startProduction({ ...config, gitSha: "a".repeat(40), version: "0.1.0" }, {
      acquireLease: async () => ({ release: async () => undefined }),
      captureSpawned: async () => electron,
      currentTarget: async () => target,
      fetchHealth: async () => undefined,
      portBindable: async () => true,
      readProcesses: async () => (++scans === 1 ? [] : [electron, daemon]),
      spawnElectron: async () => 42,
      waitForHealth: async () => ({
        buildSha: "a".repeat(40), buildVersion: "0.1.0",
        data: { dataDirectory: config.dataDirectory, databasePath: config.databasePath },
        ok: true, product: "masthead", runtime: { port: config.port, writable: true }
      })
    })).resolves.toMatchObject({ pid: 42, started: true });
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
