import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readFile, readlink, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type DaemonOwnershipMetadata = {
  daemonInstanceId: string;
  pid: number;
  baseUrl: string;
  apiVersion: number;
  buildSha?: string;
  dataDirectory: string;
  startedAt: string;
};

export async function writeDaemonOwnershipMetadata(
  dataDirectory: string,
  metadata: DaemonOwnershipMetadata
): Promise<string> {
  const runtimeDirectory = join(dataDirectory, "runtime");
  await mkdir(runtimeDirectory, { recursive: true });
  const metadataPath = join(runtimeDirectory, "daemon.json");
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
  return metadataPath;
}

export async function removeDaemonOwnershipMetadata(metadataPath: string | undefined): Promise<void> {
  if (!metadataPath) return;
  await rm(metadataPath, { force: true });
}

export async function readDaemonOwnershipMetadata(dataDirectory: string): Promise<DaemonOwnershipMetadata | undefined> {
  const parsed = await readLockJson(join(dataDirectory, "runtime", "daemon.json"));
  if (!parsed) return undefined;
  if (
    typeof parsed.daemonInstanceId !== "string" ||
    typeof parsed.pid !== "number" ||
    typeof parsed.baseUrl !== "string" ||
    typeof parsed.apiVersion !== "number" ||
    typeof parsed.dataDirectory !== "string" ||
    typeof parsed.startedAt !== "string"
  ) {
    return undefined;
  }
  return {
    daemonInstanceId: parsed.daemonInstanceId,
    pid: parsed.pid,
    baseUrl: parsed.baseUrl,
    apiVersion: parsed.apiVersion,
    buildSha: typeof parsed.buildSha === "string" ? parsed.buildSha : undefined,
    dataDirectory: parsed.dataDirectory,
    startedAt: parsed.startedAt
  };
}

export type DatabaseWriterLock = {
  lockPath: string;
  release: () => Promise<void>;
  readonly [writerLeaseBrand]: true;
  isHeld: () => boolean;
};

const writerLeaseBrand: unique symbol = Symbol("masthead-database-writer-lease");

export async function acquireDatabaseWriterLock(databasePath: string): Promise<DatabaseWriterLock> {
  const canonicalDatabasePath = await canonicalWriterDatabasePath(databasePath);
  const lockPath = `${canonicalDatabasePath}.lease.sqlite`;
  const lease = acquireSqliteLease(
    lockPath,
    `Masthead database is already leased by another writable daemon at ${lockPath}; the lease protects the same canonical database.`
  );
  return { ...lease, [writerLeaseBrand]: true };
}

export async function assertWritableDatabaseLocation(databasePath: string, dataDirectory: string): Promise<void> {
  const canonicalDatabasePath = await canonicalPathReadOnly(databasePath);
  const canonicalDataDirectory = await canonicalPathReadOnly(dataDirectory);
  if (dirname(canonicalDatabasePath) !== canonicalDataDirectory) {
    throw new Error(
      `Writable Masthead database overrides must stay inside the canonical data directory during the legacy-lock transition: ${canonicalDatabasePath} is outside ${canonicalDataDirectory}. Move the database into that data directory or stop all legacy daemons before changing the layout.`
    );
  }
}

export type LegacyDataDirectoryGuard = {
  lockPath: string;
  release: () => Promise<void>;
};

export async function acquireLegacyDataDirectoryGuard(
  dataDirectory: string,
  writerLease?: DatabaseWriterLock
): Promise<LegacyDataDirectoryGuard> {
  const runtimeDirectory = join(dataDirectory, "runtime");
  await mkdir(runtimeDirectory, { recursive: true });
  const lockPath = join(runtimeDirectory, "database.lock");
  const leasePath = join(runtimeDirectory, "database.lease.sqlite");
  const lease = acquireSqliteLease(
    leasePath,
    `A writable daemon already owns canonical data directory ${dataDirectory} through ${leasePath}.`
  );
  try {
    const sentinel = await acquireCompatibilitySentinel(
      lockPath,
      dataDirectory,
      writerLeaseMatchesDataDirectory(writerLease, dataDirectory)
    );
    return {
      lockPath,
      release: async () => {
        try {
          await sentinel.release();
        } finally {
          await lease.release();
        }
      }
    };
  } catch (error) {
    await lease.release();
    throw error;
  }
}

/** Mirrors daemon startup ownership without requiring or creating the first-run database. */
export async function probeExclusiveDatabaseStartupOwnership(
  databasePath: string,
  dataDirectory: string
): Promise<void> {
  await assertWritableDatabaseLocation(databasePath, dataDirectory);
  const writerLease = await acquireDatabaseWriterLock(databasePath);
  let legacyGuard: LegacyDataDirectoryGuard | undefined;
  try {
    legacyGuard = await acquireLegacyDataDirectoryGuard(dataDirectory, writerLease);
  } finally {
    try {
      await legacyGuard?.release();
    } finally {
      await writerLease.release();
    }
  }
}

async function canonicalWriterDatabasePath(databasePath: string, seen = new Set<string>()): Promise<string> {
  const canonicalPath = await canonicalPathReadOnly(databasePath, seen);
  await mkdir(dirname(canonicalPath), { recursive: true });
  return canonicalPath;
}

async function canonicalPathReadOnly(path: string, seen = new Set<string>()): Promise<string> {
  const absolutePath = resolve(path);
  if (seen.has(absolutePath)) throw new Error(`Database path contains a symbolic-link cycle: ${absolutePath}`);
  seen.add(absolutePath);
  try {
    const pathStat = await lstat(absolutePath);
    if (pathStat.isSymbolicLink()) {
      const target = await readlink(absolutePath);
      return canonicalPathReadOnly(resolve(dirname(absolutePath), target), seen);
    }
    return await realpath(absolutePath);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }
  const absoluteDirectory = dirname(absolutePath);
  if (absoluteDirectory === absolutePath) return absolutePath;
  const canonicalDirectory = await canonicalPathReadOnly(absoluteDirectory, seen);
  return join(canonicalDirectory, basename(absolutePath));
}

type Lease = {
  lockPath: string;
  release: () => Promise<void>;
  isHeld: () => boolean;
};

function acquireSqliteLease(lockPath: string, busyMessage: string): Lease {
  const database = new DatabaseSync(lockPath);
  try {
    database.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;");
  } catch (error) {
    database.close();
    if (isSqliteBusy(error)) throw new Error(busyMessage, { cause: error });
    throw error;
  }
  let released = false;
  return {
    lockPath,
    isHeld: () => !released,
    release: async () => {
      if (released) return;
      released = true;
      try {
        database.exec("ROLLBACK;");
      } finally {
        database.close();
      }
    }
  };
}

type CompatibilitySentinel = {
  release: () => Promise<void>;
};

async function acquireCompatibilitySentinel(
  lockPath: string,
  dataDirectory: string,
  staleCleanupAllowed: boolean
): Promise<CompatibilitySentinel> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const token = randomUUID();
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.chmod(0o600);
        const created = await handle.stat();
        const currentUid = typeof process.getuid === "function" ? process.getuid() : created.uid;
        if (
          !created.isFile() || created.nlink !== 1 || created.uid !== currentUid ||
          (created.mode & 0o777) !== 0o600
        ) throw new Error("Compatibility sentinel creation did not establish exact private file ownership.");
        await handle.writeFile(JSON.stringify({
          createdAt: new Date().toISOString(),
          pid: process.pid,
          protocol: "canonical-data-directory-lock-v4",
          token
        }, null, 2), "utf8");
        await handle.sync();
        const identity = await handle.stat();
        if (
          !sameFileIdentity(created, identity) || !identity.isFile() || identity.nlink !== 1 ||
          identity.uid !== currentUid || (identity.mode & 0o777) !== 0o600
        ) throw new Error("Compatibility sentinel identity changed during exact creation.");
        return {
          release: () => releaseCompatibilitySentinel(lockPath, token, identity.dev, identity.ino)
        };
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
      if (staleCleanupAllowed && await clearProvenStaleCompatibilitySentinel(lockPath)) continue;
      const [existing, identity] = await Promise.all([readLockJson(lockPath), lstat(lockPath).catch(() => undefined)]);
      if (!identity) continue;
      const pid = numberField(existing?.pid);
      if (pid && processIsAlive(pid)) {
        throw new Error(
          `A writable daemon already owns canonical data directory ${dataDirectory} at ${lockPath}${lockDetail(existing || {})}.`
        );
      }
      throw new Error(
        `Compatibility sentinel at ${lockPath}${lockDetail(existing || {})} is stale or unreadable. Masthead will not remove it automatically because a legacy daemon may replace it concurrently. Confirm no legacy Masthead daemon is running, then remove or repair ${lockPath} and retry.`
      );
    }
  }
  throw new Error(`Timed out acquiring compatibility sentinel at ${lockPath}.`);
}

async function clearProvenStaleCompatibilitySentinel(lockPath: string): Promise<boolean> {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(lockPath, constants.O_RDONLY | noFollow);
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 2 || before.size > 4_096) return false;
    if ((before.mode & 0o022) !== 0) return false;
    if (typeof process.getuid === "function" && before.uid !== process.getuid()) return false;
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFileIdentity(before, after) || bytes.byteLength !== before.size) return false;
    const record = parseCanonicalCompatibilitySentinel(bytes.toString("utf8"));
    if (!record || processIsAlive(record.pid)) return false;

    const quarantinePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
    await rename(lockPath, quarantinePath);
    const moved = await lstat(quarantinePath);
    if (!sameFileIdentity(before, moved)) {
      await restoreQuarantinedReplacement(lockPath, quarantinePath);
      throw new Error("Compatibility sentinel identity changed during stale cleanup; replacement preserved.");
    }
    if (processIsAlive(record.pid)) {
      await restoreQuarantinedReplacement(lockPath, quarantinePath);
      throw new Error("Compatibility sentinel PID became live during stale cleanup; sentinel preserved.");
    }
    await handle.close();
    handle = undefined;
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return true;
    if (isErrno(error, "ELOOP")) return false;
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseCanonicalCompatibilitySentinel(value: string): { pid: number } | undefined {
  try {
    const record = JSON.parse(value) as Record<string, unknown>;
    const pid = numberField(record.pid);
    const keys = Object.keys(record).sort();
    const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
    const parsedCreatedAt = Date.parse(createdAt);
    if (
      keys.join("\0") !== ["createdAt", "pid", "protocol", "token"].join("\0") ||
      !pid ||
      record.protocol !== "canonical-data-directory-lock-v4" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt) ||
      !Number.isFinite(parsedCreatedAt) ||
      new Date(parsedCreatedAt).toISOString() !== createdAt ||
      parsedCreatedAt > Date.now() ||
      typeof record.token !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(record.token)
    ) return undefined;
    return { pid };
  } catch {
    return undefined;
  }
}

async function restoreQuarantinedReplacement(lockPath: string, quarantinePath: string): Promise<void> {
  try {
    await link(quarantinePath, lockPath);
  } catch (error) {
    if (!isErrno(error, "EEXIST")) throw error;
  }
}

function sameFileIdentity(left: { dev: number | bigint; ino: number | bigint }, right: { dev: number | bigint; ino: number | bigint }): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function releaseCompatibilitySentinel(
  lockPath: string,
  token: string,
  device: number,
  inode: number
): Promise<void> {
  try {
    const [identity, current] = await Promise.all([stat(lockPath), readLockJson(lockPath)]);
    if (identity.dev === device && identity.ino === inode && current?.token === token) await rm(lockPath);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }
}

function isSqliteBusy(error: unknown): boolean {
  return error instanceof Error && /database is (?:busy|locked)/iu.test(error.message);
}

function lockDetail(metadata: Record<string, unknown>): string {
  const pid = numberField(metadata.pid);
  const createdAt = typeof metadata.createdAt === "string" ? metadata.createdAt : undefined;
  const values = [pid ? `pid ${pid}` : undefined, createdAt ? `created ${createdAt}` : undefined].filter(Boolean);
  return values.length > 0 ? ` (${values.join(", ")})` : "";
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

async function readLockJson(lockPath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isErrno(error, "ESRCH");
  }
}

function writerLeaseMatchesDataDirectory(
  writerLease: DatabaseWriterLock | undefined,
  dataDirectory: string
): boolean {
  return Boolean(
    writerLease?.[writerLeaseBrand] === true &&
    writerLease.isHeld() &&
    dirname(writerLease.lockPath) === resolve(dataDirectory)
  );
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
