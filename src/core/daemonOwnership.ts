import { mkdir, open, readFile, realpath, rm, writeFile, type FileHandle } from "node:fs/promises";
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
  release: () => Promise<void>;
};

export async function acquireDatabaseWriterLock(databasePath: string): Promise<DatabaseWriterLock> {
  const canonicalDatabasePath = await canonicalWriterDatabasePath(databasePath);
  const lockPath = `${canonicalDatabasePath}.lock`;
  const handle = await createLockFile(lockPath);
  await handle.writeFile(
    JSON.stringify(
      {
        pid: process.pid,
        createdAt: new Date().toISOString(),
        databasePath: canonicalDatabasePath
      },
      null,
      2
    ),
    "utf8"
  );
  await handle.close();

  return {
    lockPath,
    release: async () => {
      await rm(lockPath, { force: true });
    }
  };
}

async function canonicalWriterDatabasePath(databasePath: string): Promise<string> {
  const absolutePath = resolve(databasePath);
  const absoluteDirectory = dirname(absolutePath);
  await mkdir(absoluteDirectory, { recursive: true });
  const canonicalDirectory = await realpath(absoluteDirectory);
  try {
    return await realpath(absolutePath);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
    return join(canonicalDirectory, basename(absolutePath));
  }
}

async function createLockFile(lockPath: string): Promise<FileHandle> {
  try {
    return await open(lockPath, "wx");
  } catch (error) {
    if (isErrno(error, "EEXIST") && (await removeStaleLock(lockPath))) {
      return open(lockPath, "wx");
    }
    const detail = await readLockDetail(lockPath);
    throw new Error(
      `Masthead database is already owned by another writable daemon at ${lockPath}${detail ? ` (${detail})` : ""}; the lock protects the same canonical database.`
    );
  }
}

async function removeStaleLock(lockPath: string): Promise<boolean> {
  const detail = await readLockJson(lockPath);
  const pid = typeof detail?.pid === "number" ? detail.pid : undefined;
  if (pid && processIsAlive(pid)) return false;
  await rm(lockPath, { force: true });
  return true;
}

async function readLockDetail(lockPath: string): Promise<string | undefined> {
  const detail = await readLockJson(lockPath);
  if (!detail) return undefined;
  const pid = typeof detail.pid === "number" ? detail.pid : undefined;
  const createdAt = typeof detail.createdAt === "string" ? detail.createdAt : undefined;
  return [pid ? `pid ${pid}` : undefined, createdAt ? `created ${createdAt}` : undefined].filter(Boolean).join(", ");
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
  } catch {
    return false;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
