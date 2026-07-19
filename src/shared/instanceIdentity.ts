import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, win32 } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { GuidedAuthoringRequestDto } from "./guidedAuthoring.ts";
import type { WorkbenchAuthoringCapabilitiesDto } from "./workbenchAuthoring.ts";

export type MastheadInstanceManifest = {
  schemaVersion: 1;
  instanceId: string;
  baseUrl: string;
  databaseId: string;
  buildSha: string;
  pid: number;
  instanceDir: string;
  updatedAt: string;
};

export type GuidedAuthoringExpectedIdentity = Pick<
  MastheadInstanceManifest,
  "baseUrl" | "databaseId" | "buildSha" | "instanceId"
> & { instanceManifest: string };

export type MastheadInstancePaths = {
  instanceDir: string;
  instanceManifest: string;
  launcherPath: string;
};

export type MastheadInstanceManifestGuard = {
  guardPath: string;
  release: () => Promise<void>;
};

export type GuidedAuthoringIdentityErrorCode =
  | "base_url_identity_mismatch"
  | "database_identity_mismatch"
  | "build_identity_mismatch"
  | "manifest_identity_mismatch"
  | "instance_identity_mismatch";

export class GuidedAuthoringIdentityError extends Error {
  readonly code: GuidedAuthoringIdentityErrorCode;
  readonly actual: string;
  readonly expected: string;

  constructor(code: GuidedAuthoringIdentityErrorCode, actual: string, expected: string) {
    super(`${code}: expected ${expected}, received ${actual}`);
    this.name = "GuidedAuthoringIdentityError";
    this.code = code;
    this.actual = actual;
    this.expected = expected;
  }
}

export function canonicalInstancePaths(instanceDir: string, platform: NodeJS.Platform = process.platform): MastheadInstancePaths {
  const windows = platform === "win32";
  const pathApi = windows ? win32 : { isAbsolute, join, resolve };
  const canonicalDir = pathApi.resolve(requiredAbsolute(instanceDir, "instance directory", windows));
  return {
    instanceDir: canonicalDir,
    instanceManifest: pathApi.join(canonicalDir, "masthead-instance.json"),
    launcherPath: pathApi.join(canonicalDir, "bin", windows ? "mastheadctl.cmd" : "mastheadctl")
  };
}

export function normalizeMastheadBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Masthead base URL must be an unauthenticated HTTP origin");
  }
  return url.toString().replace(/\/$/, "");
}

export function parseMastheadInstanceManifest(value: unknown, expectedPath?: string): MastheadInstanceManifest {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error("invalid_instance_manifest");
  const manifest: MastheadInstanceManifest = {
    schemaVersion: 1,
    instanceId: requiredString(value.instanceId, "instanceId"),
    baseUrl: normalizeMastheadBaseUrl(requiredString(value.baseUrl, "baseUrl")),
    databaseId: requiredString(value.databaseId, "databaseId"),
    buildSha: requiredString(value.buildSha, "buildSha"),
    pid: requiredPositiveInteger(value.pid, "pid"),
    instanceDir: requiredCanonicalPath(value.instanceDir, "instanceDir"),
    updatedAt: requiredTimestamp(value.updatedAt)
  };
  const paths = canonicalInstancePaths(manifest.instanceDir, pathPlatform(manifest.instanceDir));
  if (expectedPath && canonicalPath(expectedPath) !== canonicalPath(paths.instanceManifest)) {
    throw new Error("manifest_identity_mismatch");
  }
  return manifest;
}

export async function readMastheadInstanceManifest(path: string): Promise<MastheadInstanceManifest> {
  const canonicalPathValue = requiredCanonicalPath(path, "instance manifest");
  return parseMastheadInstanceManifest(JSON.parse(await readFile(canonicalPathValue, "utf8")), canonicalPathValue);
}

export async function writeMastheadInstanceManifestAtomic(path: string, manifest: MastheadInstanceManifest): Promise<void> {
  const canonicalPathValue = requiredCanonicalPath(path, "instance manifest");
  parseMastheadInstanceManifest(manifest, canonicalPathValue);
  await mkdir(dirname(canonicalPathValue), { recursive: true });
  const temporaryPath = `${canonicalPathValue}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, canonicalPathValue);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function removeOwnedMastheadInstanceManifest(path: string, instanceId: string): Promise<boolean> {
  try {
    const manifest = await readMastheadInstanceManifest(path);
    if (manifest.instanceId !== instanceId) return false;
    await rm(path, { force: true });
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
}

export async function acquireMastheadInstanceManifestGuard(input: {
  instanceDir: string;
  instanceId: string;
  pid?: number;
  startedAt: string;
  isProcessAlive?: (pid: number) => boolean;
}): Promise<MastheadInstanceManifestGuard> {
  const instanceDir = canonicalInstancePaths(input.instanceDir).instanceDir;
  const guardPath = join(instanceDir, ".masthead-instance-writer.sqlite");
  const pid = input.pid ?? process.pid;
  await mkdir(instanceDir, { recursive: true });
  const database = new DatabaseSync(guardPath);
  try {
    database.exec([
      "PRAGMA busy_timeout = 0;",
      "CREATE TABLE IF NOT EXISTS manifest_writer_owner (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), instance_id TEXT NOT NULL, pid INTEGER NOT NULL, started_at TEXT NOT NULL);",
      "BEGIN EXCLUSIVE;"
    ].join("\n"));
    database.prepare("INSERT OR REPLACE INTO manifest_writer_owner(singleton, instance_id, pid, started_at) VALUES (1, ?, ?, ?)")
      .run(input.instanceId, pid, input.startedAt);
  } catch (error) {
    database.close();
    if (error instanceof Error && /database is (?:busy|locked)/iu.test(error.message)) {
      throw new Error("instance_manifest_writer_active", { cause: error });
    }
    throw error;
  }
  let released = false;
  return {
    guardPath,
    release: async () => {
      if (released) return;
      try {
        database.exec("ROLLBACK;");
      } finally {
        database.close();
        released = true;
      }
    }
  };
}

export function identityFromManifest(manifest: MastheadInstanceManifest, instanceManifest: string): GuidedAuthoringExpectedIdentity {
  return {
    baseUrl: manifest.baseUrl,
    buildSha: manifest.buildSha,
    databaseId: manifest.databaseId,
    instanceId: manifest.instanceId,
    instanceManifest: requiredCanonicalPath(instanceManifest, "instance manifest")
  };
}

export function identityFromCapabilities(capabilities: WorkbenchAuthoringCapabilitiesDto): GuidedAuthoringExpectedIdentity {
  if (capabilities.bundleVersion !== "workbench-authoring-v3") throw new Error("authoring_identity_unavailable");
  if (
    typeof capabilities.baseUrl !== "string" ||
    typeof capabilities.buildSha !== "string" ||
    typeof capabilities.instanceManifest !== "string" ||
    typeof capabilities.instanceId !== "string"
  ) throw new Error("authoring_identity_unavailable");
  return {
    baseUrl: normalizeMastheadBaseUrl(capabilities.baseUrl),
    buildSha: capabilities.buildSha,
    databaseId: capabilities.databaseId,
    instanceId: capabilities.instanceId,
    instanceManifest: requiredCanonicalPath(capabilities.instanceManifest, "instance manifest")
  };
}

export function assertServerGuidedAuthoringIdentity(
  expected: GuidedAuthoringExpectedIdentity,
  current: GuidedAuthoringExpectedIdentity
): void {
  assertGuidedAuthoringExpectedIdentity(current, expected);
}

export function assertGuidedAuthoringExpectedIdentity(
  actual: GuidedAuthoringExpectedIdentity,
  expected: GuidedAuthoringExpectedIdentity
): void {
  compare("base_url_identity_mismatch", normalizeMastheadBaseUrl(actual.baseUrl), normalizeMastheadBaseUrl(expected.baseUrl));
  compare("database_identity_mismatch", actual.databaseId, expected.databaseId);
  compare("build_identity_mismatch", actual.buildSha, expected.buildSha);
  compare("manifest_identity_mismatch", canonicalPath(actual.instanceManifest), canonicalPath(expected.instanceManifest));
  compare("instance_identity_mismatch", actual.instanceId, expected.instanceId);
}

export function assertStableGuidedRequestBinding(
  request: Pick<GuidedAuthoringRequestDto, "baseUrl" | "databaseId" | "buildSha" | "instanceManifest" | "creationInstanceId">,
  current: GuidedAuthoringExpectedIdentity
): void {
  compare("base_url_identity_mismatch", normalizeMastheadBaseUrl(request.baseUrl), normalizeMastheadBaseUrl(current.baseUrl));
  compare("database_identity_mismatch", request.databaseId, current.databaseId);
  compare("build_identity_mismatch", request.buildSha, current.buildSha);
  compare("manifest_identity_mismatch", canonicalPath(request.instanceManifest), canonicalPath(current.instanceManifest));
}

function compare(code: GuidedAuthoringIdentityErrorCode, actual: string, expected: string): void {
  if (actual !== expected) throw new GuidedAuthoringIdentityError(code, actual, expected);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw new Error(`invalid_instance_manifest_${field}`);
  return value;
}

function requiredPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`invalid_instance_manifest_${field}`);
  return value;
}

function requiredTimestamp(value: unknown): string {
  const timestamp = requiredString(value, "updatedAt");
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("invalid_instance_manifest_updatedAt");
  return timestamp;
}

function requiredCanonicalPath(value: unknown, field: string): string {
  const path = requiredString(value, field);
  const canonical = canonicalPath(path);
  if (canonical !== path) throw new Error(`invalid_instance_manifest_${field}`);
  return path;
}

function requiredAbsolute(value: string, field: string, windows: boolean): string {
  const trimmed = value.trim();
  if (!trimmed || !(windows ? win32.isAbsolute(trimmed) : isAbsolute(trimmed))) throw new Error(`Masthead ${field} must be absolute`);
  return trimmed;
}

function canonicalPath(value: string): string {
  const windows = pathPlatform(value) === "win32";
  return windows ? win32.resolve(requiredAbsolute(value, "path", true)) : resolve(requiredAbsolute(value, "path", false));
}

function pathPlatform(path: string): NodeJS.Platform {
  return win32.isAbsolute(path) && !isAbsolute(path) ? "win32" : process.platform;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
