import { redactPath } from "./redaction.ts";
import type { GitChangedPath, GitSnapshot } from "./types";

export type GitDiffStat = {
  additions: number;
  deletions: number;
};

export type GitDiffStats = ReadonlyMap<string, GitDiffStat> | Record<string, GitDiffStat>;

export type BuildGitSnapshotInput = {
  snapshotId?: string;
  sessionId: string;
  repoRoot: string;
  worktreePath: string;
  gitCommonDir: string;
  branch?: string;
  headSha?: string;
  observedAt: string;
  statusPorcelain: string;
  numstat?: string | GitDiffStats;
};

type GitPathStatus = GitChangedPath["status"];

export function buildGitSnapshot(input: BuildGitSnapshotInput): GitSnapshot {
  requirePresent("sessionId", input.sessionId);
  requirePresent("repoRoot", input.repoRoot);
  requirePresent("worktreePath", input.worktreePath);
  requirePresent("gitCommonDir", input.gitCommonDir);
  requirePresent("observedAt", input.observedAt);

  const stats = typeof input.numstat === "string" ? parseGitNumstat(input.numstat) : input.numstat;
  const snapshot: GitSnapshot = {
    snapshotId: input.snapshotId ?? defaultSnapshotId(input),
    sessionId: input.sessionId,
    repoRoot: input.repoRoot,
    worktreePath: input.worktreePath,
    gitCommonDir: input.gitCommonDir,
    changedPaths: parseGitStatusPorcelain(input.statusPorcelain, stats),
    observedAt: input.observedAt
  };

  if (input.branch) snapshot.branch = input.branch;
  if (input.headSha) snapshot.headSha = input.headSha;

  return snapshot;
}

export function parseGitStatusPorcelain(output: string, stats?: GitDiffStats): GitChangedPath[] {
  const changedPaths: GitChangedPath[] = [];

  for (const line of output.replace(/\0/g, "\n").split(/\r?\n/)) {
    if (!line) continue;

    const indexStatus = line[0] ?? " ";
    const worktreeStatus = line[1] ?? " ";
    const rawPath = line.length > 3 ? line.slice(3) : "";

    if (indexStatus === "!" && worktreeStatus === "!") continue;
    if (indexStatus === "?" && worktreeStatus === "?") {
      changedPaths.push(makeChangedPath(statusTargetPath(rawPath), "untracked", false, stats));
      continue;
    }

    const path = statusTargetPath(rawPath);
    const stagedStatus = porcelainCodeToStatus(indexStatus);
    const unstagedStatus = porcelainCodeToStatus(worktreeStatus);

    if (stagedStatus) changedPaths.push(makeChangedPath(path, stagedStatus, true, stats));
    if (unstagedStatus) changedPaths.push(makeChangedPath(path, unstagedStatus, false, stats));
  }

  return changedPaths;
}

export function parseGitNumstat(output: string): Map<string, GitDiffStat> {
  const stats = new Map<string, GitDiffStat>();

  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;

    const [rawAdditions, rawDeletions, ...rawPathParts] = line.split("\t");
    const additions = parseCount(rawAdditions);
    const deletions = parseCount(rawDeletions);
    if (additions === undefined || deletions === undefined || rawPathParts.length === 0) continue;

    stats.set(diffStatTargetPath(rawPathParts.join("\t")), { additions, deletions });
  }

  return stats;
}

function makeChangedPath(path: string, status: GitPathStatus, staged: boolean, stats?: GitDiffStats): GitChangedPath {
  const redactedPath = redactPath(path);
  const changedPath: GitChangedPath = {
    path: redactedPath.path,
    status,
    staged,
    sensitivity: redactedPath.sensitivity
  };

  if (redactedPath.sensitivity === "metadata") {
    const stat = lookupStat(stats, redactedPath.path);
    if (stat) {
      changedPath.additions = stat.additions;
      changedPath.deletions = stat.deletions;
    }
  }

  return changedPath;
}

function porcelainCodeToStatus(code: string): GitPathStatus | undefined {
  switch (code) {
    case "A":
      return "added";
    case "C":
      return "added";
    case "D":
      return "deleted";
    case "M":
    case "T":
    case "U":
      return "modified";
    case "R":
      return "renamed";
    default:
      return undefined;
  }
}

function lookupStat(stats: GitDiffStats | undefined, path: string): GitDiffStat | undefined {
  if (!stats) return undefined;
  if (isReadonlyMap(stats)) return stats.get(path);
  return stats[path];
}

function isReadonlyMap(stats: GitDiffStats): stats is ReadonlyMap<string, GitDiffStat> {
  return typeof (stats as ReadonlyMap<string, GitDiffStat>).get === "function";
}

function statusTargetPath(rawPath: string): string {
  const renameSeparator = rawPath.lastIndexOf(" -> ");
  const targetPath = renameSeparator === -1 ? rawPath : rawPath.slice(renameSeparator + " -> ".length);
  return normalizeGitPath(targetPath);
}

function diffStatTargetPath(rawPath: string): string {
  const path = rawPath.trim();
  const braceRename = path.match(/^(.*)\{(.+?) => (.+?)\}(.*)$/);
  if (braceRename) {
    return normalizeGitPath(`${braceRename[1]}${braceRename[3]}${braceRename[4]}`);
  }

  const renameSeparator = path.lastIndexOf(" => ");
  if (renameSeparator !== -1) {
    return normalizeGitPath(path.slice(renameSeparator + " => ".length));
  }

  return normalizeGitPath(path);
}

function normalizeGitPath(path: string): string {
  return unquoteGitPath(path.trim()).replace(/\\/g, "/").replace(/^\.\//, "");
}

function unquoteGitPath(path: string): string {
  if (!path.startsWith("\"") || !path.endsWith("\"")) return path;

  return path
    .slice(1, -1)
    .replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)))
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function parseCount(value: string | undefined): number | undefined {
  if (!value || value === "-") return undefined;

  const count = Number.parseInt(value, 10);
  return Number.isNaN(count) ? undefined : count;
}

function requirePresent(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
}

function defaultSnapshotId(input: BuildGitSnapshotInput): string {
  return `git:${input.sessionId}:${input.observedAt}:${input.gitCommonDir}:${input.worktreePath}`;
}
