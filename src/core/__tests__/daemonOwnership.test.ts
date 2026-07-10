import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { acquireDatabaseWriterLock, type DatabaseWriterLock } from "../daemonOwnership.ts";

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

    const results = await Promise.allSettled([
      acquireDatabaseWriterLock(databasePath),
      acquireDatabaseWriterLock(databasePath)
    ]);
    const winners = results.filter((result): result is PromiseFulfilledResult<DatabaseWriterLock> => result.status === "fulfilled");
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
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
});

async function createTempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(path);
  return path;
}
