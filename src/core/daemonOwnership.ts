import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readlink, realpath, rm, stat, writeFile } from "node:fs/promises";
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
};

export async function acquireDatabaseWriterLock(databasePath: string): Promise<DatabaseWriterLock> {
  const canonicalDatabasePath = await canonicalWriterDatabasePath(databasePath);
  const lockPath = `${canonicalDatabasePath}.lease.sqlite`;
  return acquireSqliteLease(
    lockPath,
    `Masthead database is already leased by another writable daemon at ${lockPath}; the lease protects the same canonical database.`
  );
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

export async function acquireLegacyDataDirectoryGuard(dataDirectory: string): Promise<LegacyDataDirectoryGuard> {
  const runtimeDirectory = join(dataDirectory, "runtime");
  await mkdir(runtimeDirectory, { recursive: true });
  const lockPath = join(runtimeDirectory, "database.lock");
  const leasePath = join(runtimeDirectory, "database.lease.sqlite");
  const lease = acquireSqliteLease(
    leasePath,
    `A writable daemon already owns canonical data directory ${dataDirectory} through ${leasePath}.`
  );
  try {
    const sentinel = await acquireCompatibilitySentinel(lockPath, dataDirectory);
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

async function acquireCompatibilitySentinel(lockPath: string, dataDirectory: string): Promise<CompatibilitySentinel> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const token = randomUUID();
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify({
          createdAt: new Date().toISOString(),
          pid: process.pid,
          protocol: "canonical-data-directory-lock-v4",
          token
        }, null, 2), "utf8");
        const identity = await handle.stat();
        return {
          release: () => releaseCompatibilitySentinel(lockPath, token, identity.dev, identity.ino)
        };
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
      const [existing, identity] = await Promise.all([readLockJson(lockPath), stat(lockPath).catch(() => undefined)]);
      if (!identity) continue;
      const pid = numberField(existing?.pid);
      if (pid && processIsAlive(pid)) {
        throw new Error(
          `A writable daemon already owns canonical data directory ${dataDirectory} at ${lockPath}${lockDetail(existing || {})}.`
        );
      }
      if (!pid && Date.now() - identity.mtimeMs < 1_000) {
        await delay(20);
        continue;
      }
      await rm(lockPath, { force: true });
    }
  }
  throw new Error(`Timed out acquiring compatibility sentinel at ${lockPath}.`);
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
    if (isErrno(error, "EPERM")) return true;
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
