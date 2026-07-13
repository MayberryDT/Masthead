import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { writePackagedBundleManifest } from "../../../scripts/packaged-bundle-manifest.js";
import {
  acquireLifecycleLease,
  classifyProductionProcess,
  installProductionLauncher,
  startProduction,
  stopProduction,
  transitionProduction
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
  await writeFile(join(daemonRoot, "dist", "src", "daemon", "main.js"), "daemon");
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
  test("reads proc executable symlink text so deleted kernel identities remain observable", async () => {
    const source = await readFile("scripts/masthead-production.js", "utf8");
    expect(source).toContain('readlink(join(processRoot, "exe"))');
    expect(source).not.toContain('realpath(join(processRoot, "exe"))');
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
      stop: async () => { calls.push("stop"); return { stopped: true }; },
      swapCurrent: async () => { calls.push("swap"); }
    });
    expect(receipt).toMatchObject({ started: { started: true }, stopped: { stopped: true } });
    expect(calls).toEqual(["stage", "stop", "swap", "activate-launchers", "start", "release"]);
    const { access } = await import("node:fs/promises");
    await expect(access(staleBundle)).rejects.toMatchObject({ code: "ENOENT" });
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
    const receipt = await startProduction({ ...config, gitSha: "a".repeat(40), version: "0.1.0" }, {
      acquireLease: async () => ({ release: async () => undefined }),
      captureSpawned: async () => undefined,
      currentTarget: async () => target,
      fetchHealth: async () => undefined,
      ownershipProbe: async () => undefined,
      portBindable: async () => true,
      readProcesses: async () => [],
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
      restoreCurrent: async () => calls.push("restore-current"),
      restoreLaunchers: async () => calls.push("restore-launchers"),
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
      "restore-current", "restore-launchers", "restart-old", "release"
    ]);
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
