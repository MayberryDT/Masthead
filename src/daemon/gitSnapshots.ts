import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildGitSnapshot } from "../core/gitObserver.ts";
import type { GitSnapshot, NormalizedEvent } from "../core/types.ts";

const execFileAsync = promisify(execFile);

export async function collectGitSnapshot(event: NormalizedEvent): Promise<GitSnapshot | undefined> {
  if (!event.sessionId || !event.workspace) return undefined;

  const worktreePath = event.workspace.worktreePath || event.workspace.cwd || event.workspace.repoRoot;
  if (!worktreePath) return undefined;

  try {
    const [repoRoot, gitCommonDir, branch, headSha, statusPorcelain, numstat] = await Promise.all([
      gitOutput(worktreePath, ["rev-parse", "--show-toplevel"]),
      gitOutput(worktreePath, ["rev-parse", "--git-common-dir"]),
      gitOutput(worktreePath, ["branch", "--show-current"]),
      gitOutput(worktreePath, ["rev-parse", "HEAD"]),
      gitOutput(worktreePath, ["status", "--porcelain"], { trim: false }),
      gitOutput(worktreePath, ["diff", "--numstat", "HEAD", "--"])
    ]);

    return buildGitSnapshot({
      sessionId: event.sessionId,
      repoRoot: event.workspace.repoRoot || repoRoot,
      worktreePath,
      gitCommonDir: event.workspace.gitCommonDir || gitCommonDir,
      branch: event.workspace.branch || branch || undefined,
      headSha: event.workspace.headSha || headSha || undefined,
      observedAt: new Date().toISOString(),
      statusPorcelain,
      numstat
    });
  } catch {
    return undefined;
  }
}

export function gitSnapshotSignature(snapshot: GitSnapshot): string {
  return JSON.stringify({
    repoRoot: snapshot.repoRoot,
    worktreePath: snapshot.worktreePath,
    gitCommonDir: snapshot.gitCommonDir,
    branch: snapshot.branch,
    headSha: snapshot.headSha,
    changedPaths: snapshot.changedPaths.map((changedPath) => ({
      path: changedPath.path,
      status: changedPath.status,
      staged: changedPath.staged,
      additions: changedPath.additions,
      deletions: changedPath.deletions,
      sensitivity: changedPath.sensitivity
    }))
  });
}

async function gitOutput(cwd: string, args: string[], options: { trim?: false } = {}): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: 2_000,
    windowsHide: true
  });
  return options.trim === false ? stdout.replace(/\r?\n$/, "") : stdout.trim();
}
