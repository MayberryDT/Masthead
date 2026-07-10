import { randomUUID } from "node:crypto";
import { lstat, link, mkdir, open, readFile, readdir, readlink, realpath, rename, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

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
  ownerPath: string;
  release: () => Promise<void>;
  token: string;
};

export type DatabaseWriterLockOptions = {
  coordinationAfterOpen?: () => Promise<void>;
  coordinationBlankReclaimMs?: number;
};

export async function acquireDatabaseWriterLock(
  databasePath: string,
  options: DatabaseWriterLockOptions = {}
): Promise<DatabaseWriterLock> {
  const canonicalDatabasePath = await canonicalWriterDatabasePath(databasePath);
  const lockPath = `${canonicalDatabasePath}.lock`;
  return acquireOwnerDirectoryLock(lockPath, canonicalDatabasePath, options);
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
  const ownership = await acquireAtomicFileMutex(lockPath, {
    failWhenLive: true,
    liveError: (metadata) =>
      new Error(`A writable daemon already owns canonical data directory ${dataDirectory} at ${lockPath}${lockDetail(metadata)}.`),
    metadata: { protocol: "canonical-data-directory-lock-v3" }
  });
  return {
    lockPath,
    release: ownership.release
  };
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

type OwnerRecord = {
  createdAt: string;
  databasePath: string;
  ownerPath: string;
  pid: number;
  state: "acquired" | "pending";
  token: string;
};

async function acquireOwnerDirectoryLock(
  lockPath: string,
  databasePath: string,
  options: DatabaseWriterLockOptions
): Promise<DatabaseWriterLock> {
  const winnerCoordination = await acquireAtomicFileMutex(`${lockPath}.winner`, {
    afterOpen: options.coordinationAfterOpen,
    blankReclaimMs: options.coordinationBlankReclaimMs,
    failWhenLive: false,
    metadata: { purpose: "canonical-writer-election" }
  });
  let ownerPath: string | undefined;
  try {
    await ensureOwnerDirectory(lockPath);
    const token = randomUUID();
    ownerPath = join(lockPath, `${token}.json`);
    const pending: OwnerRecord = {
      createdAt: new Date().toISOString(),
      databasePath,
      ownerPath,
      pid: process.pid,
      state: "pending",
      token
    };
    await writeFile(ownerPath, JSON.stringify(pending, null, 2), { encoding: "utf8", flag: "wx" });
    const owners = await liveOwnerRecords(lockPath);
    const acquired = owners.find((owner) => owner.token !== token && owner.state === "acquired");
    if (acquired) throw ownershipError(lockPath, acquired);
    const pendingOwners = owners
      .filter((owner) => owner.state === "pending")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.token.localeCompare(right.token));
    if (pendingOwners[0]?.token !== token) throw ownershipError(lockPath, pendingOwners[0]);
    const acquiredRecord = { ...pending, state: "acquired" as const };
    await writeJsonAtomic(ownerPath, acquiredRecord);
    const identity = await stat(ownerPath);
    const acquiredOwnerPath = ownerPath;
    return {
      lockPath,
      ownerPath: acquiredOwnerPath,
      token,
      release: () => releaseOwnedPath(acquiredOwnerPath, token, identity.dev, identity.ino)
    };
  } catch (error) {
    if (ownerPath) await rm(ownerPath, { force: true });
    throw error;
  } finally {
    await winnerCoordination.release();
  }
}

async function ensureOwnerDirectory(lockPath: string): Promise<void> {
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (!isErrno(error, "EEXIST")) throw error;
    const pathStat = await stat(lockPath);
    if (pathStat.isDirectory()) return;
    const legacy = await readLockJson(lockPath);
    const pid = numberField(legacy?.pid);
    if (pid && processIsAlive(pid)) throw ownershipError(lockPath, ownerRecordFromLegacy(lockPath, legacy));
    await rm(lockPath, { force: true });
    await mkdir(lockPath);
  }
}

async function liveOwnerRecords(lockPath: string): Promise<OwnerRecord[]> {
  const records: OwnerRecord[] = [];
  for (const entry of await readdir(lockPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const ownerPath = join(lockPath, entry.name);
    const record = ownerRecord(await readLockJson(ownerPath), ownerPath);
    if (!record) throw new Error(`Masthead database ownership record is unreadable at ${ownerPath}.`);
    if (!processIsAlive(record.pid)) {
      await rm(ownerPath, { force: true });
      continue;
    }
    records.push(record);
  }
  return records;
}

function ownerRecord(value: Record<string, unknown> | undefined, ownerPath: string): OwnerRecord | undefined {
  const state = value?.state;
  const pid = numberField(value?.pid);
  if (
    !pid ||
    (state !== "pending" && state !== "acquired") ||
    typeof value?.createdAt !== "string" ||
    typeof value.databasePath !== "string" ||
    typeof value.token !== "string"
  ) return undefined;
  return { createdAt: value.createdAt, databasePath: value.databasePath, ownerPath, pid, state, token: value.token };
}

function ownerRecordFromLegacy(lockPath: string, value: Record<string, unknown> | undefined): OwnerRecord | undefined {
  const pid = numberField(value?.pid);
  if (!pid) return undefined;
  return {
    createdAt: typeof value?.createdAt === "string" ? value.createdAt : "unknown",
    databasePath: lockPath.replace(/\.lock$/u, ""),
    ownerPath: lockPath,
    pid,
    state: "acquired",
    token: "legacy"
  };
}

function ownershipError(lockPath: string, owner: OwnerRecord | undefined): Error {
  const detail = owner ? ` (pid ${owner.pid}, created ${owner.createdAt}, token ${owner.token})` : "";
  return new Error(
    `Masthead database is already owned by another writable daemon at ${lockPath}${detail}; the lock protects the same canonical database.`
  );
}

async function releaseOwnedPath(ownerPath: string, token: string, device: number, inode: number): Promise<void> {
  try {
    const [currentStat, current] = await Promise.all([stat(ownerPath), readLockJson(ownerPath)]);
    if (currentStat.dev !== device || currentStat.ino !== inode || current?.token !== token) return;
    await rm(ownerPath);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }
}

type AtomicFileMutex = {
  release: () => Promise<void>;
};

type AtomicFileMutexOptions = {
  afterOpen?: () => Promise<void>;
  blankReclaimMs?: number;
  failWhenLive: boolean;
  liveError?: (metadata: Record<string, unknown>) => Error;
  metadata: Record<string, unknown>;
};

async function acquireAtomicFileMutex(lockPath: string, options: AtomicFileMutexOptions): Promise<AtomicFileMutex> {
  const blankReclaimMs = options.blankReclaimMs ?? 1_000;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const token = randomUUID();
    let handle: FileHandle | undefined;
    try {
      handle = await open(lockPath, "wx");
      await options.afterOpen?.();
      const metadata = { ...options.metadata, createdAt: new Date().toISOString(), pid: process.pid, token };
      await handle.writeFile(JSON.stringify(metadata, null, 2), "utf8");
      const [handleStat, pathStat] = await Promise.all([handle.stat(), stat(lockPath).catch(() => undefined)]);
      if (!pathStat || !sameInode(handleStat, pathStat)) {
        await handle.close();
        handle = undefined;
        continue;
      }
      return atomicFileMutexOwnership(lockPath, handle, token, handleStat.dev, handleStat.ino);
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      if (!isErrno(error, "EEXIST")) throw error;
      const existingHandle = await open(lockPath, "r").catch(() => undefined);
      if (!existingHandle) continue;
      try {
        const existingStat = await existingHandle.stat();
        const existing = await readJsonHandle(existingHandle);
        const existingPid = numberField(existing?.pid);
        if (existingPid && processIsAlive(existingPid)) {
          if (options.failWhenLive) throw options.liveError?.(existing || {}) ?? new Error(`Lock is already owned at ${lockPath}.`);
          await delay(20);
          continue;
        }
        if (!existingPid && Date.now() - existingStat.mtimeMs < blankReclaimMs) {
          await delay(20);
          continue;
        }
        await reclaimExactMutexInode(lockPath, existingStat.dev, existingStat.ino);
      } finally {
        await existingHandle.close();
      }
    }
  }
  throw new Error(`Timed out acquiring filesystem coordination at ${lockPath}.`);
}

function atomicFileMutexOwnership(
  lockPath: string,
  handle: FileHandle,
  token: string,
  device: number,
  inode: number
): AtomicFileMutex {
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      try {
        const [pathStat, current] = await Promise.all([stat(lockPath), readLockJson(lockPath)]);
        if (pathStat.dev === device && pathStat.ino === inode && current?.token === token) await rm(lockPath);
      } catch (error) {
        if (!isErrno(error, "ENOENT")) throw error;
      } finally {
        await handle.close();
      }
    }
  };
}

async function reclaimExactMutexInode(lockPath: string, device: number, inode: number): Promise<void> {
  const claimPath = `${lockPath}.reclaim-${process.pid}-${randomUUID()}`;
  try {
    await link(lockPath, claimPath);
  } catch (error) {
    if (isErrno(error, "EEXIST") || isErrno(error, "ENOENT")) return;
    throw error;
  }
  try {
    const [claimStat, pathStat] = await Promise.all([stat(claimPath), stat(lockPath).catch(() => undefined)]);
    if (claimStat.dev !== device || claimStat.ino !== inode) return;
    if (pathStat && sameInode(claimStat, pathStat)) await rm(lockPath);
  } finally {
    await rm(claimPath, { force: true });
  }
}

async function readJsonHandle(handle: FileHandle): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await handle.readFile("utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function sameInode(left: { dev: number; ino: number }, right: { dev: number; ino: number }): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function lockDetail(metadata: Record<string, unknown>): string {
  const pid = numberField(metadata.pid);
  const createdAt = typeof metadata.createdAt === "string" ? metadata.createdAt : undefined;
  const values = [pid ? `pid ${pid}` : undefined, createdAt ? `created ${createdAt}` : undefined].filter(Boolean);
  return values.length > 0 ? ` (${values.join(", ")})` : "";
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
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
