import { spawn } from "node:child_process";
import { once } from "node:events";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  acquireDatabaseWriterLock,
  acquireLegacyDataDirectoryGuard,
  assertWritableDatabaseLocation,
  type DatabaseWriterLock
} from "../daemonOwnership.ts";

const tempDirs: string[] = [];
const locks: DatabaseWriterLock[] = [];

afterEach(async () => {
  await Promise.all(locks.splice(0).map((lock) => lock.release().catch(() => undefined)));
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("database writer lock", () => {
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

  test("a crashed process automatically releases its SQLite lease", async () => {
    const tempDir = await createTempDir("masthead-crashed-db-lease-");
    const databasePath = join(tempDir, "masthead.sqlite");
    const leasePath = `${databasePath}.lease.sqlite`;
    const child = spawn(process.execPath, [
      "--input-type=module",
      "-e",
      "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;'); console.log('ready'); setInterval(() => {}, 1000);",
      leasePath
    ], { stdio: ["ignore", "pipe", "ignore"] });
    const childExit = once(child, "exit");
    try {
      await once(child.stdout!, "data");
      await expect(acquireDatabaseWriterLock(databasePath)).rejects.toThrow("already leased");
      child.kill("SIGKILL");
      await childExit;

      const recovered = await acquireDatabaseWriterLock(databasePath);
      locks.push(recovered);
      expect(recovered.lockPath).toBe(leasePath);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await childExit;
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
