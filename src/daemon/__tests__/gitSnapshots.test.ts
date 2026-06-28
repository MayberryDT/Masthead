import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import type { NormalizedEvent } from "../../core/types";
import { collectGitSnapshot } from "../gitSnapshots";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

describe("Git snapshot collection", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, { force: true, recursive: true })));
  });

  test("can skip diff stats while preserving changed path detection", async () => {
    const repoPath = await createCleanRepo();
    await writeFile(join(repoPath, "src/shared.ts"), "export const value = 2;\n", "utf8");
    const event = liveSessionEvent(repoPath);

    const withStats = await collectGitSnapshot(event);
    expect(withStats?.changedPaths).toEqual([
      expect.objectContaining({
        additions: 1,
        deletions: 1,
        path: "src/shared.ts",
        status: "modified"
      })
    ]);

    const withoutStats = await collectGitSnapshot(event, { includeDiffStats: false });
    expect(withoutStats?.changedPaths).toEqual([
      expect.objectContaining({
        path: "src/shared.ts",
        status: "modified"
      })
    ]);
    expect(withoutStats?.changedPaths[0]).not.toHaveProperty("additions");
    expect(withoutStats?.changedPaths[0]).not.toHaveProperty("deletions");
  });
});

async function createCleanRepo(): Promise<string> {
  const repoPath = await mkdtemp(join(tmpdir(), "masthead-git-snapshot-"));
  tempDirs.push(repoPath);
  await mkdir(join(repoPath, "src"), { recursive: true });
  await git(repoPath, ["init"]);
  await git(repoPath, ["config", "user.email", "masthead@example.test"]);
  await git(repoPath, ["config", "user.name", "Masthead Test"]);
  await writeFile(join(repoPath, "src/shared.ts"), "export const value = 1;\n", "utf8");
  await git(repoPath, ["add", "src/shared.ts"]);
  await git(repoPath, ["commit", "-m", "initial"]);
  return repoPath;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

function liveSessionEvent(repoPath: string): NormalizedEvent {
  return {
    schemaVersion: 1,
    eventId: "event-git-snapshot",
    sessionId: "session-git-snapshot",
    source: {
      adapter: "codex",
      surface: "hook"
    },
    occurredAt: "2026-06-28T16:00:00.000Z",
    receivedAt: "2026-06-28T16:00:00.000Z",
    type: "session.started",
    workspace: {
      cwd: repoPath,
      repoRoot: repoPath,
      worktreePath: repoPath
    },
    summary: "Live Git snapshot",
    payload: {},
    sensitivity: "metadata",
    payloadHash: "hash-git-snapshot",
    evidence: []
  };
}
