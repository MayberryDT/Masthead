import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
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

export async function acquireDatabaseWriterLock(databasePath: string): Promise<DatabaseWriterLock> {
  const canonicalDatabasePath = await canonicalWriterDatabasePath(databasePath);
  const lockPath = `${canonicalDatabasePath}.lock`;
  return acquireOwnerDirectoryLock(lockPath, canonicalDatabasePath);
}

export type LegacyDataDirectoryGuard = {
  lockPath: string;
  release: () => Promise<void>;
};

export async function acquireLegacyDataDirectoryGuard(dataDirectory: string): Promise<LegacyDataDirectoryGuard> {
  const runtimeDirectory = join(dataDirectory, "runtime");
  await mkdir(runtimeDirectory, { recursive: true });
  const lockPath = join(runtimeDirectory, "database.lock");
  const coordinationPath = `${lockPath}.canonical-coordination`;
  const ownersPath = `${lockPath}.canonical-owners`;
  const coordinationLock = await acquireCoordinationLock(coordinationPath);
  const token = randomUUID();
  const ownerPath = join(ownersPath, `${token}.json`);
  let ownerIdentity: { device: number; inode: number } | undefined;
  try {
    const existing = await readLockJson(lockPath);
    if (existing && existing.protocol !== "canonical-database-lock-v2") {
      const pid = numberField(existing.pid);
      if (pid && processIsAlive(pid)) {
        throw new Error(`A legacy data-directory writer already owns ${lockPath} (pid ${pid}).`);
      }
      await rm(lockPath, { force: true });
    }
    await mkdir(ownersPath, { recursive: true });
    await writeFile(ownerPath, JSON.stringify({ pid: process.pid, token }), { encoding: "utf8", flag: "wx" });
    const ownerStat = await stat(ownerPath);
    ownerIdentity = { device: ownerStat.dev, inode: ownerStat.ino };
    const owners = await liveLegacyGuardOwners(ownersPath);
    await writeLegacySentinel(lockPath, owners[0]?.pid ?? process.pid);
  } catch (error) {
    await rm(ownerPath, { force: true });
    throw error;
  } finally {
    await coordinationLock.release();
  }

  return {
    lockPath,
    release: async () => {
      const releaseCoordination = await acquireCoordinationLock(coordinationPath);
      try {
        if (ownerIdentity) await releaseOwnedPath(ownerPath, token, ownerIdentity.device, ownerIdentity.inode);
        const owners = await liveLegacyGuardOwners(ownersPath);
        if (owners.length > 0) await writeLegacySentinel(lockPath, owners[0].pid);
        else if ((await readLockJson(lockPath))?.protocol === "canonical-database-lock-v2") await rm(lockPath, { force: true });
      } finally {
        await releaseCoordination.release();
      }
    }
  };
}

async function canonicalWriterDatabasePath(databasePath: string, seen = new Set<string>()): Promise<string> {
  const absolutePath = resolve(databasePath);
  if (seen.has(absolutePath)) throw new Error(`Database path contains a symbolic-link cycle: ${absolutePath}`);
  seen.add(absolutePath);
  try {
    const pathStat = await lstat(absolutePath);
    if (pathStat.isSymbolicLink()) {
      const target = await readlink(absolutePath);
      return canonicalWriterDatabasePath(resolve(dirname(absolutePath), target), seen);
    }
    return await realpath(absolutePath);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }
  const absoluteDirectory = dirname(absolutePath);
  await mkdir(absoluteDirectory, { recursive: true });
  const canonicalDirectory = await realpath(absoluteDirectory);
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

async function acquireOwnerDirectoryLock(lockPath: string, databasePath: string): Promise<DatabaseWriterLock> {
  await ensureOwnerDirectory(lockPath);
  const token = randomUUID();
  const ownerPath = join(lockPath, `${token}.json`);
  const pending: OwnerRecord = {
    createdAt: new Date().toISOString(),
    databasePath,
    ownerPath,
    pid: process.pid,
    state: "pending",
    token
  };
  await writeFile(ownerPath, JSON.stringify(pending, null, 2), { encoding: "utf8", flag: "wx" });
  try {
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
    return {
      lockPath,
      ownerPath,
      token,
      release: () => releaseOwnedPath(ownerPath, token, identity.dev, identity.ino)
    };
  } catch (error) {
    await rm(ownerPath, { force: true });
    throw error;
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

async function acquireCoordinationLock(lockPath: string): Promise<DatabaseWriterLock> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    try {
      return await acquireOwnerDirectoryLock(lockPath, lockPath);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("already owned")) throw error;
      await delay(20);
    }
  }
  throw new Error(`Timed out coordinating legacy database ownership at ${lockPath}.`);
}

async function liveLegacyGuardOwners(ownersPath: string): Promise<Array<{ ownerPath: string; pid: number; token: string }>> {
  const owners: Array<{ ownerPath: string; pid: number; token: string }> = [];
  for (const entry of await readdir(ownersPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const ownerPath = join(ownersPath, entry.name);
    const value = await readLockJson(ownerPath);
    const pid = numberField(value?.pid);
    const token = typeof value?.token === "string" ? value.token : undefined;
    if (!pid || !token || !processIsAlive(pid)) {
      await rm(ownerPath, { force: true });
      continue;
    }
    owners.push({ ownerPath, pid, token });
  }
  return owners;
}

async function writeLegacySentinel(lockPath: string, pid: number): Promise<void> {
  const metadata = {
    createdAt: new Date().toISOString(),
    pid,
    protocol: "canonical-database-lock-v2"
  };
  try {
    const handle = await open(lockPath, "wx");
    try {
      await handle.writeFile(JSON.stringify(metadata, null, 2), "utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!isErrno(error, "EEXIST")) throw error;
    const existing = await readLockJson(lockPath);
    if (existing?.protocol !== "canonical-database-lock-v2") {
      const existingPid = numberField(existing?.pid);
      throw new Error(`A legacy data-directory writer already owns ${lockPath}${existingPid ? ` (pid ${existingPid})` : ""}.`);
    }
    await writeJsonAtomic(lockPath, metadata);
  }
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
