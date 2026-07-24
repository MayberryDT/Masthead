import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  acquireDatabaseWriterLock,
  acquireLegacyDataDirectoryGuard,
  assertWritableDatabaseLocation,
  probeExclusiveDatabaseStartupOwnership,
  type DatabaseWriterLock
} from "../daemonOwnership.ts";

const tempDirs: string[] = [];
const locks: Array<{ release: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(locks.splice(0).map((lock) => lock.release().catch(() => undefined)));
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("database writer lock", () => {
  test("proves exclusive startup ownership before a first-run database exists", async () => {
    const dataDirectory = await createTempDir("masthead-first-run-ownership-");
    const databasePath = join(dataDirectory, "masthead.sqlite");

    await probeExclusiveDatabaseStartupOwnership(databasePath, dataDirectory);

    await expect(accessPath(databasePath)).resolves.toBe(false);
    await expect(probeExclusiveDatabaseStartupOwnership(databasePath, dataDirectory)).resolves.toBeUndefined();
  });

  test.skipIf(process.platform === "win32")("resolves a dangling database symlink to its absent target", async () => {
    const tempDir = await createTempDir("masthead-dangling-db-lock-");
    const targetPath = join(tempDir, "target.sqlite");
    const aliasPath = join(tempDir, "alias.sqlite");
    await symlink("target.sqlite", aliasPath, "file");
    const targetLock = await acquireDatabaseWriterLock(targetPath);
    locks.push(targetLock);

    await expect(acquireDatabaseWriterLock(aliasPath)).rejects.toThrow("already leased");
  });

  test.skipIf(process.platform === "win32")("validates a dangling database symlink without creating target directories", async () => {
    const tempDir = await createTempDir("masthead-read-only-db-location-");
    const aliasPath = join(tempDir, "alias.sqlite");
    const targetDirectory = join(tempDir, "missing-target");
    const dataDirectory = join(tempDir, "missing-data");
    await symlink(join("missing-target", "masthead.sqlite"), aliasPath, "file");

    await expect(assertWritableDatabaseLocation(aliasPath, dataDirectory)).rejects.toThrow("is outside");
    await expect(accessPath(targetDirectory)).resolves.toBe(false);
    await expect(accessPath(dataDirectory)).resolves.toBe(false);
  });

  test("elects exactly one SQLite lease owner across concurrent contenders", async () => {
    const tempDir = await createTempDir("masthead-concurrent-db-lease-");
    const databasePath = join(tempDir, "masthead.sqlite");

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => acquireDatabaseWriterLock(databasePath))
    );
    const winners = results.filter((result): result is PromiseFulfilledResult<DatabaseWriterLock> => result.status === "fulfilled");
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(19);
    locks.push(winners[0].value);
  });

  test("release rolls back the lease and allows a successor", async () => {
    const tempDir = await createTempDir("masthead-released-db-lease-");
    const databasePath = join(tempDir, "masthead.sqlite");
    const first = await acquireDatabaseWriterLock(databasePath);
    await expect(acquireDatabaseWriterLock(databasePath)).rejects.toThrow("already leased");
    await first.release();
    const successor = await acquireDatabaseWriterLock(databasePath);
    locks.push(successor);
  });

  test("serializes concurrent data-directory guard acquisition and release", async () => {
    const dataDirectory = await createTempDir("masthead-concurrent-data-lease-");
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => acquireLegacyDataDirectoryGuard(dataDirectory))
    );
    const winners = results.filter((result) => result.status === "fulfilled");
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(19);

    await winners[0].value.release();
    const successor = await acquireLegacyDataDirectoryGuard(dataDirectory);
    locks.push(successor);
  });

  test.skipIf(process.platform === "win32")("creates the compatibility sentinel mode 0600 under umask 0002", async () => {
    const dataDirectory = await createTempDir("masthead-sentinel-mode-");
    const previousUmask = process.umask(0o002);
    let guard;
    try {
      guard = await acquireLegacyDataDirectoryGuard(dataDirectory);
    } finally {
      process.umask(previousUmask);
    }
    locks.push(guard);

    const info = await lstat(join(dataDirectory, "runtime", "database.lock"));
    expect(info.mode & 0o777).toBe(0o600);
  });

  test("blocks on a stale compatibility sentinel without mutating it", async () => {
    const dataDirectory = await createTempDir("masthead-stale-data-sentinel-");
    const lockPath = join(dataDirectory, "runtime", "database.lock");
    const staleSentinel = JSON.stringify({
      createdAt: "2026-01-01T00:00:00.000Z",
      pid: 2_147_483_647,
      token: "stale-owner"
    });
    await mkdir(join(dataDirectory, "runtime"), { recursive: true });
    await writeFile(lockPath, staleSentinel, "utf8");

    await expect(acquireLegacyDataDirectoryGuard(dataDirectory)).rejects.toThrow(
      `Confirm no legacy Masthead daemon is running, then remove or repair ${lockPath}`
    );
    await expect(readFile(lockPath, "utf8")).resolves.toBe(staleSentinel);

    await rm(lockPath);
    const repaired = await acquireLegacyDataDirectoryGuard(dataDirectory);
    locks.push(repaired);
  });

  test("clears a proven-stale canonical V4 sentinel before acquiring ownership", async () => {
    const dataDirectory = await createTempDir("masthead-proven-stale-data-sentinel-");
    const lockPath = join(dataDirectory, "runtime", "database.lock");
    await mkdir(join(dataDirectory, "runtime"), { recursive: true });
    await writeFile(lockPath, JSON.stringify({
      createdAt: "2026-01-01T00:00:00.000Z",
      pid: 2_147_483_647,
      protocol: "canonical-data-directory-lock-v4",
      token: "11111111-1111-4111-8111-111111111111"
    }, null, 2), { encoding: "utf8", mode: 0o600 });

    await expect(acquireLegacyDataDirectoryGuard(dataDirectory)).rejects.toThrow("will not remove it automatically");
    const writerLease = await acquireDatabaseWriterLock(join(dataDirectory, "masthead.sqlite"));
    locks.push(writerLease);
    const recovered = await acquireLegacyDataDirectoryGuard(dataDirectory, writerLease);
    locks.push(recovered);

    const current = JSON.parse(await readFile(lockPath, "utf8")) as { pid: number; protocol: string; token: string };
    expect(current).toMatchObject({ pid: process.pid, protocol: "canonical-data-directory-lock-v4" });
    expect(current.token).not.toBe("11111111-1111-4111-8111-111111111111");
    const quarantined = (await readdir(join(dataDirectory, "runtime")))
      .filter((name) => name.startsWith("database.lock.stale-"));
    expect(quarantined).toHaveLength(1);
    await expect(readFile(join(dataDirectory, "runtime", quarantined[0]!), "utf8"))
      .resolves.toContain("11111111-1111-4111-8111-111111111111");
  });

  test.each([
    ["extra property", { extra: true }],
    ["future timestamp", { createdAt: "2999-01-01T00:00:00.000Z" }]
  ])("preserves a stale sentinel with a noncanonical %s", async (_label, override) => {
    const dataDirectory = await createTempDir("masthead-noncanonical-data-sentinel-");
    const lockPath = join(dataDirectory, "runtime", "database.lock");
    await mkdir(join(dataDirectory, "runtime"), { recursive: true });
    await writeFile(lockPath, JSON.stringify({
      createdAt: "2026-01-01T00:00:00.000Z",
      pid: 2_147_483_647,
      protocol: "canonical-data-directory-lock-v4",
      token: "33333333-3333-4333-8333-333333333333",
      ...override
    }), { encoding: "utf8", mode: 0o600 });
    const writerLease = await acquireDatabaseWriterLock(join(dataDirectory, "masthead.sqlite"));
    locks.push(writerLease);

    await expect(acquireLegacyDataDirectoryGuard(dataDirectory, writerLease)).rejects.toThrow("will not remove it automatically");
    await expect(readFile(lockPath, "utf8")).resolves.toContain("33333333-3333-4333-8333-333333333333");
  });

  test("preserves a stale sentinel with unsafe permissions or multiple links", async () => {
    const dataDirectory = await createTempDir("masthead-unsafe-data-sentinel-");
    const runtimeDirectory = join(dataDirectory, "runtime");
    const lockPath = join(runtimeDirectory, "database.lock");
    const linkedPath = join(runtimeDirectory, "database-linked.lock");
    await mkdir(runtimeDirectory, { recursive: true });
    const sentinel = JSON.stringify({
      createdAt: "2026-01-01T00:00:00.000Z",
      pid: 2_147_483_647,
      protocol: "canonical-data-directory-lock-v4",
      token: "44444444-4444-4444-8444-444444444444"
    });
    await writeFile(lockPath, sentinel, { encoding: "utf8", mode: 0o600 });
    const writerLease = await acquireDatabaseWriterLock(join(dataDirectory, "masthead.sqlite"));
    locks.push(writerLease);

    await chmod(lockPath, 0o622);
    await expect(acquireLegacyDataDirectoryGuard(dataDirectory, writerLease)).rejects.toThrow("will not remove it automatically");
    await chmod(lockPath, 0o600);
    await link(lockPath, linkedPath);
    await expect(acquireLegacyDataDirectoryGuard(dataDirectory, writerLease)).rejects.toThrow("will not remove it automatically");
    await expect(readFile(linkedPath, "utf8")).resolves.toBe(sentinel);
  });

  test("does not delete a live replacement compatibility sentinel", async () => {
    const dataDirectory = await createTempDir("masthead-live-data-sentinel-");
    const lockPath = join(dataDirectory, "runtime", "database.lock");
    const replacementPath = join(dataDirectory, "runtime", "replacement.lock");
    const liveSentinel = JSON.stringify({
      createdAt: "2026-07-10T00:00:00.000Z",
      pid: process.pid,
      token: "live-owner"
    });
    await mkdir(join(dataDirectory, "runtime"), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ pid: 2_147_483_647, token: "stale-owner" }), "utf8");
    await writeFile(replacementPath, liveSentinel, "utf8");
    await rename(replacementPath, lockPath);

    await expect(acquireLegacyDataDirectoryGuard(dataDirectory)).rejects.toThrow("already owns canonical data directory");
    await expect(readFile(lockPath, "utf8")).resolves.toBe(liveSentinel);
  });

  test.skipIf(process.platform === "win32")("preserves a symlinked stale compatibility sentinel", async () => {
    const dataDirectory = await createTempDir("masthead-symlinked-data-sentinel-");
    const runtimeDirectory = join(dataDirectory, "runtime");
    const sentinelTarget = join(runtimeDirectory, "sentinel-target.json");
    const lockPath = join(runtimeDirectory, "database.lock");
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(sentinelTarget, JSON.stringify({
      createdAt: "2026-01-01T00:00:00.000Z",
      pid: 2_147_483_647,
      protocol: "canonical-data-directory-lock-v4",
      token: "22222222-2222-4222-8222-222222222222"
    }), "utf8");
    await symlink("sentinel-target.json", lockPath, "file");

    await expect(acquireLegacyDataDirectoryGuard(dataDirectory)).rejects.toThrow("will not remove it automatically");
    expect((await lstat(lockPath)).isSymbolicLink()).toBe(true);
    await expect(readFile(sentinelTarget, "utf8")).resolves.toContain("22222222-2222-4222-8222-222222222222");
  });

  test("a crashed process automatically releases its SQLite lease", async () => {
    const tempDir = await createTempDir("masthead-crashed-db-lease-");
    const databasePath = join(tempDir, "masthead.sqlite");
    const leasePath = `${databasePath}.lease.sqlite`;
    const childArguments = [
      "--input-type=module",
      "-e",
      "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;'); console.log('ready'); setInterval(() => {}, 1000);",
      leasePath
    ];
    const child = spawn(process.execPath, childArguments, { stdio: ["ignore", "pipe", "ignore"] });
    expect(child.spawnfile).toBe(process.execPath);
    expect(child.spawnargs).toEqual([process.execPath, ...childArguments]);
    const childIdentity = await captureOwnedChildIdentity(child);
    const childExit = once(child, "exit");
    try {
      await waitForOwnedChildReady(child, 5_000);
      await expect(acquireDatabaseWriterLock(databasePath)).rejects.toThrow("already leased");
      await terminateOwnedChild(child, childIdentity, childExit, 5_000);

      const recovered = await acquireDatabaseWriterLock(databasePath);
      locks.push(recovered);
      expect(recovered.lockPath).toBe(leasePath);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        await terminateOwnedChild(child, childIdentity, childExit, 5_000);
      }
    }
  });
});

async function createTempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(path);
  return path;
}

function accessPath(path: string): Promise<boolean> {
  return lstat(path).then(() => true).catch(() => false);
}

type OwnedChildIdentity = { pid: number; starttime?: string };

async function captureOwnedChildIdentity(child: ChildProcess): Promise<OwnedChildIdentity> {
  if (!Number.isSafeInteger(child.pid) || !child.pid || child.pid < 1) throw new Error("crash-child PID was not assigned");
  if (process.platform !== "linux") return { pid: child.pid };
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const starttime = await linuxProcessStarttime(child.pid);
    if (starttime) return { pid: child.pid, starttime };
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`crash-child ${child.pid} start identity was not observable within 2000ms`);
}

async function waitForOwnedChildReady(child: ChildProcess, timeoutMs: number): Promise<void> {
  const ready = once(child.stdout!, "data").then(() => undefined);
  const exited = once(child, "exit").then(([code, signal]) => {
    throw new Error(`crash-child exited before readiness (code=${code}, signal=${signal ?? "none"})`);
  });
  const failed = once(child, "error").then(([error]) => { throw error; });
  await bounded(Promise.race([ready, exited, failed]), timeoutMs, "crash-child did not signal readiness");
}

async function terminateOwnedChild(
  child: ChildProcess,
  expected: OwnedChildIdentity,
  childExit: Promise<unknown[]>,
  timeoutMs: number
): Promise<void> {
  if (child.pid !== expected.pid) throw new Error("crash-child PID changed before cleanup");
  if (process.platform === "linux") {
    const currentStarttime = await linuxProcessStarttime(expected.pid);
    if (!currentStarttime) {
      await bounded(childExit, timeoutMs, "crash-child exit event was not observed after process disappearance");
      return;
    }
    if (!expected.starttime || currentStarttime !== expected.starttime) {
      throw new Error("crash-child PID was reused before cleanup; no signal was sent");
    }
    const children = await readFile(`/proc/${expected.pid}/task/${expected.pid}/children`, "utf8");
    if (children.trim()) throw new Error(`crash-child unexpectedly owns descendants: ${children.trim()}`);
  }
  if (!child.kill("SIGKILL")) throw new Error("crash-child exact SIGKILL was not accepted");
  await bounded(childExit, timeoutMs, "crash-child did not exit after exact SIGKILL");
  if (process.platform === "linux" && await linuxProcessStarttime(expected.pid) === expected.starttime) {
    throw new Error("crash-child exact PID/start identity remained after cleanup");
  }
}

async function linuxProcessStarttime(pid: number): Promise<string | undefined> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) throw new Error("malformed proc stat");
    return stat.slice(close + 1).trim().split(/\s+/u)[19];
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && ["ENOENT", "ESRCH"].includes(String(error.code))) {
      return undefined;
    }
    throw error;
  }
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${message} within ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
