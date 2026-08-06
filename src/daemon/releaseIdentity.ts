import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ReleaseIdentity = {
  gitSha: string;
  version: string;
};

const DEVELOPMENT: ReleaseIdentity = {
  gitSha: "development",
  version: "development"
};

/**
 * Resolve product build identity for health, capabilities, and authoring.
 * Preference order:
 * 1. MASTHEAD_BUILD_SHA + MASTHEAD_BUILD_VERSION (non-empty; either may be set alone with file fill-in)
 * 2. MASTHEAD_RELEASE_JSON path or release.json next to the packaged daemon root / module
 * 3. package.json version + development SHA (dev checkouts)
 * 4. development / development
 */
export function resolveReleaseIdentity(env: NodeJS.ProcessEnv = process.env): ReleaseIdentity {
  const envSha = nonEmpty(env.MASTHEAD_BUILD_SHA);
  const envVersion = nonEmpty(env.MASTHEAD_BUILD_VERSION);
  const fromFile = readReleaseJsonCandidates(env);

  const gitSha = envSha || fromFile?.gitSha;
  const version = envVersion || fromFile?.version || packageJsonVersion();

  if (gitSha && version) return { gitSha, version };
  if (gitSha) return { gitSha, version: version || DEVELOPMENT.version };
  if (version && version !== DEVELOPMENT.version) {
    return { gitSha: DEVELOPMENT.gitSha, version };
  }
  return { ...DEVELOPMENT };
}

export function releaseJsonPathBesideDaemonEntry(daemonEntryPath: string): string {
  // .../daemon/dist/src/daemon/main.js → .../daemon/release.json
  return resolve(daemonEntryPath, "..", "..", "..", "..", "release.json");
}

export function releaseJsonPathBesideMcpEntry(mcpEntryPath: string): string {
  // .../daemon/dist/src/mcp/server.js → .../daemon/release.json
  return resolve(mcpEntryPath, "..", "..", "..", "..", "release.json");
}

export function readReleaseJsonFile(path: string): ReleaseIdentity | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { gitSha?: unknown; version?: unknown };
    const gitSha = typeof parsed.gitSha === "string" ? parsed.gitSha.trim() : "";
    const version = typeof parsed.version === "string" ? parsed.version.trim() : "";
    if (!gitSha || !version) return undefined;
    return { gitSha, version };
  } catch {
    return undefined;
  }
}

function readReleaseJsonCandidates(env: NodeJS.ProcessEnv): ReleaseIdentity | undefined {
  const candidates: string[] = [];
  const explicit = nonEmpty(env.MASTHEAD_RELEASE_JSON);
  if (explicit) candidates.push(isAbsolute(explicit) ? explicit : resolve(explicit));

  // Packaged Electron: process.argv[1] is usually the daemon entry under resources/daemon/dist/...
  for (const arg of process.argv.slice(1, 4)) {
    if (typeof arg === "string" && arg.includes("daemon") && arg.includes("dist") && arg.endsWith(".js")) {
      candidates.push(releaseJsonPathBesideDaemonEntry(arg));
      candidates.push(releaseJsonPathBesideMcpEntry(arg));
    }
  }

  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    // Compiled: dist/daemon/src/daemon/releaseIdentity.js → ../../../../release.json is wrong;
    // from dist/daemon/src/daemon → ../../../.. = dist, need ../../../../release at daemon root:
    // dist/daemon/src/daemon -> .. = daemon (src), ../.. = src, ../../.. = dist, ../../../.. = daemon root
    candidates.push(resolve(moduleDir, "..", "..", "..", "..", "release.json"));
    candidates.push(resolve(moduleDir, "..", "..", "..", "release.json"));
  } catch {
    // import.meta may be unavailable in some test shims
  }

  candidates.push(resolve(process.cwd(), "release.json"));
  candidates.push(resolve(process.cwd(), ".electron-resources", "daemon", "release.json"));

  for (const path of candidates) {
    const identity = readReleaseJsonFile(path);
    if (identity) return identity;
  }
  return undefined;
}

function packageJsonVersion(): string | undefined {
  try {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      version?: unknown;
    };
    if (typeof packageJson.version === "string" && packageJson.version.trim()) return packageJson.version.trim();
  } catch {
    // Packaged daemon cwd is the data directory, not the repo root.
  }
  return undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
