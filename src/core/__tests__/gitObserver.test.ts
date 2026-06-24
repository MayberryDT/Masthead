import { describe, expect, test } from "vitest";
import { buildGitSnapshot, parseGitNumstat, parseGitStatusPorcelain } from "../gitObserver";

describe("Git observer parsing", () => {
  test("builds an explicit repo/worktree snapshot from porcelain status", () => {
    const snapshot = buildGitSnapshot({
      snapshotId: "snapshot-1",
      sessionId: "session-1",
      repoRoot: "/workspace/masthead",
      worktreePath: "/workspace/masthead-feature",
      gitCommonDir: "/workspace/masthead/.git/worktrees/feature",
      branch: "agent/feature",
      headSha: "abc123",
      observedAt: "2026-06-23T02:00:00.000Z",
      statusPorcelain: [
        "M  src/staged.ts",
        " M src/unstaged.ts",
        "MM src/both.ts",
        "A  src/new.ts",
        " D src/deleted.ts",
        "?? src/untracked.ts",
        "!! dist/cache.js"
      ].join("\n"),
      numstat: [
        "3\t1\tsrc/staged.ts",
        "2\t0\tsrc/unstaged.ts",
        "5\t2\tsrc/both.ts",
        "1\t0\tsrc/new.ts",
        "0\t4\tsrc/deleted.ts"
      ].join("\n")
    });

    expect(snapshot).toEqual({
      snapshotId: "snapshot-1",
      sessionId: "session-1",
      repoRoot: "/workspace/masthead",
      worktreePath: "/workspace/masthead-feature",
      gitCommonDir: "/workspace/masthead/.git/worktrees/feature",
      branch: "agent/feature",
      headSha: "abc123",
      observedAt: "2026-06-23T02:00:00.000Z",
      changedPaths: [
        {
          path: "src/staged.ts",
          status: "modified",
          staged: true,
          additions: 3,
          deletions: 1,
          sensitivity: "metadata"
        },
        {
          path: "src/unstaged.ts",
          status: "modified",
          staged: false,
          additions: 2,
          deletions: 0,
          sensitivity: "metadata"
        },
        {
          path: "src/both.ts",
          status: "modified",
          staged: true,
          additions: 5,
          deletions: 2,
          sensitivity: "metadata"
        },
        {
          path: "src/both.ts",
          status: "modified",
          staged: false,
          additions: 5,
          deletions: 2,
          sensitivity: "metadata"
        },
        {
          path: "src/new.ts",
          status: "added",
          staged: true,
          additions: 1,
          deletions: 0,
          sensitivity: "metadata"
        },
        {
          path: "src/deleted.ts",
          status: "deleted",
          staged: false,
          additions: 0,
          deletions: 4,
          sensitivity: "metadata"
        },
        {
          path: "src/untracked.ts",
          status: "untracked",
          staged: false,
          sensitivity: "metadata"
        }
      ]
    });
  });

  test("keeps env and secret paths path-only even when diff stats are provided", () => {
    const changedPaths = parseGitStatusPorcelain(
      [" M .env.local", "A  config/service.pem", "?? src/visible.ts"].join("\n"),
      parseGitNumstat(["12\t4\t.env.local", "3\t1\tconfig/service.pem"].join("\n"))
    );

    expect(changedPaths).toEqual([
      {
        path: ".env.local",
        status: "modified",
        staged: false,
        sensitivity: "sensitive_path_only"
      },
      {
        path: "config/service.pem",
        status: "added",
        staged: true,
        sensitivity: "sensitive_path_only"
      },
      {
        path: "src/visible.ts",
        status: "untracked",
        staged: false,
        sensitivity: "metadata"
      }
    ]);
  });

  test("tolerates renames and preserves follow-on unstaged worktree status", () => {
    const changedPaths = parseGitStatusPorcelain(
      ["R  src/old-name.ts -> src/new-name.ts", "RM src/config.old.ts -> src/config.new.ts"].join("\n"),
      parseGitNumstat(["4\t1\tsrc/old-name.ts => src/new-name.ts", "7\t3\tsrc/{config.old.ts => config.new.ts}"].join("\n"))
    );

    expect(changedPaths).toEqual([
      {
        path: "src/new-name.ts",
        status: "renamed",
        staged: true,
        additions: 4,
        deletions: 1,
        sensitivity: "metadata"
      },
      {
        path: "src/config.new.ts",
        status: "renamed",
        staged: true,
        additions: 7,
        deletions: 3,
        sensitivity: "metadata"
      },
      {
        path: "src/config.new.ts",
        status: "modified",
        staged: false,
        additions: 7,
        deletions: 3,
        sensitivity: "metadata"
      }
    ]);
  });

  test("requires explicit repo, worktree, common-dir, and session identity", () => {
    expect(() =>
      buildGitSnapshot({
        sessionId: "session-1",
        repoRoot: "/workspace/masthead",
        worktreePath: "",
        gitCommonDir: "/workspace/masthead/.git",
        observedAt: "2026-06-23T02:00:00.000Z",
        statusPorcelain: ""
      })
    ).toThrow("worktreePath is required");
  });
});
