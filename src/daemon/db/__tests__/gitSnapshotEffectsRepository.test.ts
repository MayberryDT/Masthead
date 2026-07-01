import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { GitSnapshot } from "../../../core/types.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { upsertFileEffectsFromGitSnapshot } from "../gitSnapshotEffectsRepository.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("git snapshot file effects", () => {
  test("persists changed paths as idempotent durable file effects without root paths", async () => {
    const db = await openTestDatabase();
    seedSession(db);
    const snapshot: GitSnapshot = {
      branch: "main",
      changedPaths: [
        {
          additions: 3,
          deletions: 1,
          path: "src/ui/SessionCard.tsx",
          sensitivity: "metadata",
          staged: true,
          status: "modified"
        },
        {
          path: "/home/tyler/Documents/Masthead/.ssh/config",
          sensitivity: "sensitive_path_only",
          staged: false,
          status: "modified"
        }
      ],
      gitCommonDir: "/home/tyler/Documents/Masthead/.git",
      observedAt: "2026-06-28T16:00:00.000Z",
      repoRoot: "/home/tyler/Documents/Masthead",
      sessionId: "source-session-1",
      snapshotId: "snapshot-1",
      worktreePath: "/home/tyler/Documents/Masthead"
    };

    expect(upsertFileEffectsFromGitSnapshot(db, "session-1", snapshot)).toBe(1);
    expect(upsertFileEffectsFromGitSnapshot(db, "session-1", snapshot)).toBe(0);

    expect(db.prepare("SELECT path, effect_kind, staged, additions, deletions, source_ref_json AS sourceRef FROM file_effects").all()).toEqual([
      {
        additions: 3,
        deletions: 1,
        effect_kind: "modified",
        path: "src/ui/SessionCard.tsx",
        sourceRef: JSON.stringify([
          {
            confidence: "authoritative",
            snapshotId: "snapshot-1",
            sourceKind: "git_snapshot",
            sourceRuntime: "masthead-git-observer"
          }
        ]),
        staged: 1
      }
    ]);
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-git-effects-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedSession(db: MastheadDatabase): void {
  const now = "2026-06-25T12:00:00.000Z";
  db.prepare("INSERT INTO hosts (host_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)").run("host:test", now, now);
  db.prepare("INSERT INTO runtimes (runtime_id, runtime_kind, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    "runtime:codex",
    "codex",
    now,
    now
  );
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, lifecycle,
      last_activity_at, source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("session-1", "host:test", "runtime:codex", "source-session-1", "Masthead", "running", now, "authoritative", now, now);
}
