import { access, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  acquireDatabaseWriterLock,
  acquireLegacyDataDirectoryGuard,
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

    await expect(acquireDatabaseWriterLock(aliasPath)).rejects.toThrow("already owned");
  });

  test("elects exactly one owner when concurrent contenders reclaim stale ownership", async () => {
    const tempDir = await createTempDir("masthead-stale-db-lock-");
    const databasePath = join(tempDir, "masthead.sqlite");
    const lockPath = `${databasePath}.lock`;
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, "stale.json"), JSON.stringify({
      createdAt: "2026-01-01T00:00:00.000Z",
      databasePath,
      pid: 2_147_483_647,
      state: "acquired",
      token: "stale"
    }), "utf8");

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => acquireDatabaseWriterLock(databasePath))
    );
    const winners = results.filter((result): result is PromiseFulfilledResult<DatabaseWriterLock> => result.status === "fulfilled");
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(19);
    locks.push(winners[0].value);
  });

  test("an obsolete owner cannot release a successor's lock", async () => {
    const tempDir = await createTempDir("masthead-token-db-lock-");
    const databasePath = join(tempDir, "masthead.sqlite");
    const first = await acquireDatabaseWriterLock(databasePath);
    await rm(first.ownerPath, { force: true });
    const successor = await acquireDatabaseWriterLock(databasePath);
    locks.push(successor);

    await first.release();
    await expect(acquireDatabaseWriterLock(databasePath)).rejects.toThrow("already owned");
  });

  test("the legacy guardian exits and removes its sentinel after all owners disappear", async () => {
    const tempDir = await createTempDir("masthead-legacy-guardian-crash-");
    const first = await acquireLegacyDataDirectoryGuard(tempDir);
    const second = await acquireLegacyDataDirectoryGuard(tempDir);
    const ownersPath = join(tempDir, "runtime", "database.lock.canonical-owners");
    const sentinelPath = join(tempDir, "runtime", "database.lock");
    const sentinel = JSON.parse(await readFile(sentinelPath, "utf8")) as { guardian: boolean; pid: number };
    expect(sentinel.guardian).toBe(true);

    for (const owner of await readdir(ownersPath)) await rm(join(ownersPath, owner), { force: true });
    await waitForMissingPath(sentinelPath);
    await waitForPidToStop(sentinel.pid);
    expect(processIsAlive(sentinel.pid)).toBe(false);
    await first.release();
    await second.release();
  });
});

async function createTempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(path);
  return path;
}

async function waitForMissingPath(path: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (!(await access(path).then(() => true).catch(() => false))) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`Path remained after guardian cleanup: ${path}`);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidToStop(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (!processIsAlive(pid)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`Guardian PID ${pid} remained alive.`);
}
