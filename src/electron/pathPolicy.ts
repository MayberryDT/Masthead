import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export type PackagedDaemonPaths = {
  daemonEntry: string;
  daemonRoot: string;
  hookScript: string;
  mcpEntry: string;
  nodePath: string;
  releaseJson: string;
};

export type MastheadPathPolicyOptions = {
  additionalRoots?: string[];
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

/** Lexical containment: candidate is root or a descendant (no symlink resolution). */
export function isPathInsideRoot(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Known Masthead data-directory roots. Paths opened from the desktop shell must
 * realpath-resolve inside one of these (or an explicit additional root).
 */
export function knownMastheadDataRoots(options: MastheadPathPolicyOptions = {}): string[] {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const xdgData = env.XDG_DATA_HOME || join(home, ".local", "share");
  const xdgConfig = env.XDG_CONFIG_HOME || join(home, ".config");
  const roots = [
    ...(env.MASTHEAD_DATA_DIR ? [resolve(env.MASTHEAD_DATA_DIR)] : []),
    join(xdgData, "masthead-dev"),
    join(xdgConfig, "masthead-production"),
    join(xdgConfig, "masthead"),
    join(xdgConfig, "Masthead"),
    join(home, "Library", "Application Support", "Masthead"),
    join(home, "Library", "Application Support", "Masthead Dev"),
    join(home, "AppData", "Local", "Masthead"),
    join(home, "AppData", "Local", "Masthead Dev"),
    join(home, "AppData", "Roaming", "Masthead"),
    ...(options.additionalRoots ?? []).map((root) => resolve(root))
  ];
  return [...new Set(roots.map((root) => resolve(root)))];
}

function temporaryFilesystemRoots(): string[] {
  if (process.platform === "win32") {
    return [resolve(process.env.TEMP || process.env.TMP || "C:\\Temp")];
  }
  return [resolve("/tmp")];
}

function isTrustedTempMastheadPath(resolvedPath: string): boolean {
  // Isolated acceptance / doctor runs place data under /tmp/masthead-*.
  for (const temporaryRoot of temporaryFilesystemRoots()) {
    if (!isPathInsideRoot(temporaryRoot, resolvedPath)) continue;
    const rel = relative(temporaryRoot, resolvedPath);
    if (!rel || rel === "..") continue;
    const firstComponent = rel.split(sep)[0] ?? "";
    // Require a masthead-owned prefix, not a substring match ("not-masthead").
    if (/^masthead([._-]|$)/i.test(firstComponent)) return true;
  }
  return false;
}

/**
 * Sync ownership probe used by callers that only have a path string.
 * Accepts known Masthead roots (and children) plus /tmp/masthead-* trees.
 * Does not follow symlinks — pair with {@link assertSafeMastheadDataDirectory}
 * before opening paths from untrusted IPC.
 */
export function isMastheadOwnedDirectory(path: string, options: MastheadPathPolicyOptions = {}): boolean {
  if (typeof path !== "string" || !path.trim() || path.includes("\0")) return false;
  const resolvedPath = resolve(path);
  if (knownMastheadDataRoots(options).some((root) => isPathInsideRoot(root, resolvedPath))) {
    return true;
  }
  return isTrustedTempMastheadPath(resolvedPath);
}

/**
 * Realpath-based containment under known Masthead roots.
 * Rejects missing paths, non-directories, leaf symlinks, and symlink escapes
 * whose canonical target falls outside trusted roots.
 */
export async function assertSafeMastheadDataDirectory(
  path: string,
  options: MastheadPathPolicyOptions = {}
): Promise<string> {
  if (typeof path !== "string" || !path.trim()) {
    throw new Error("Data directory path is required.");
  }
  if (path.includes("\0")) {
    throw new Error(`Refusing to open a non-Masthead data directory: ${path}`);
  }

  const requestedPath = resolve(path);
  if (!isMastheadOwnedDirectory(requestedPath, options)) {
    throw new Error(`Refusing to open a non-Masthead data directory: ${path}`);
  }

  let leafInfo;
  try {
    leafInfo = await lstat(requestedPath);
  } catch {
    throw new Error(`Data directory does not exist: ${path}`);
  }

  if (leafInfo.isSymbolicLink()) {
    throw new Error(`Refusing to open a symlinked data directory: ${path}`);
  }
  if (!leafInfo.isDirectory()) {
    throw new Error(`Data path is not a directory: ${path}`);
  }

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(requestedPath);
  } catch {
    throw new Error(`Data directory does not exist: ${path}`);
  }

  if (!isMastheadOwnedDirectory(canonicalPath, options)) {
    throw new Error(`Refusing to open a non-Masthead data directory: ${path}`);
  }

  return canonicalPath;
}

export function packagedDaemonPaths(resourcesPath: string): PackagedDaemonPaths {
  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  const daemonRoot = join(resourcesPath, "daemon");
  return {
    daemonRoot,
    nodePath: join(daemonRoot, nodeName),
    daemonEntry: join(daemonRoot, "dist", "src", "daemon", "main.js"),
    hookScript: join(daemonRoot, "scripts", "masthead-hook.js"),
    mcpEntry: join(daemonRoot, "dist", "src", "mcp", "server.js"),
    releaseJson: join(daemonRoot, "release.json")
  };
}
