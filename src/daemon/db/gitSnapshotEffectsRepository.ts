import { createHash } from "node:crypto";
import type { GitSnapshot } from "../../core/types.ts";
import type { MastheadDatabase } from "./sqlite.ts";

export function upsertFileEffectsFromGitSnapshot(db: MastheadDatabase, canonicalSessionId: string, snapshot: GitSnapshot): number {
  if (!db.prepare("SELECT 1 FROM sessions WHERE session_id = ?").get(canonicalSessionId)) return 0;
  const insert = db.prepare(
    `INSERT INTO file_effects (file_effect_id, session_id, path, effect_kind, staged, additions, deletions, observed_at, source_ref_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, path, effect_kind, observed_at) DO NOTHING`
  );
  let inserted = 0;
  for (const changedPath of snapshot.changedPaths.slice(0, 200)) {
    const path = safeGitPath(changedPath.path, snapshot);
    if (!path) continue;
    const result = insert.run(
      gitFileEffectId(canonicalSessionId, snapshot.snapshotId, path, changedPath.status),
      canonicalSessionId,
      path,
      changedPath.status,
      changedPath.staged ? 1 : 0,
      changedPath.additions ?? null,
      changedPath.deletions ?? null,
      snapshot.observedAt,
      JSON.stringify([
        {
          confidence: "authoritative",
          snapshotId: snapshot.snapshotId,
          sourceKind: "git_snapshot",
          sourceRuntime: "masthead-git-observer"
        }
      ])
    ) as { changes?: number };
    inserted += result.changes ?? 0;
  }
  return inserted;
}

function safeGitPath(value: string, snapshot: GitSnapshot): string | undefined {
  const normalized = normalizePath(value);
  if (!normalized) return undefined;
  const relative = normalized.startsWith("/")
    ? [snapshot.repoRoot, snapshot.worktreePath].map((root) => relativeToRoot(normalized, root)).find((candidate): candidate is string => Boolean(candidate))
    : normalized.replace(/^\.\//, "");
  if (!relative) return undefined;
  if (relative.startsWith("../") || relative.includes("/../") || relative.startsWith("~")) return undefined;
  if (relative.startsWith(".ssh/") || relative.includes("/.ssh/")) return undefined;
  if (/^https?:\/\//i.test(relative)) return undefined;
  return relative;
}

function relativeToRoot(path: string, root: string | undefined): string | undefined {
  const normalizedRoot = normalizePath(root);
  if (!normalizedRoot || !path.startsWith(`${normalizedRoot}/`)) return undefined;
  return path.slice(normalizedRoot.length + 1);
}

function normalizePath(value: string | undefined): string | undefined {
  const normalized = value?.trim().replaceAll("\\", "/").replace(/^['"]|['"]$/g, "");
  if (!normalized) return undefined;
  return normalized.replace(/\/+/g, "/");
}

function gitFileEffectId(sessionId: string, snapshotId: string, path: string, effectKind: string): string {
  return `file_effect:${createHash("sha256").update(`${sessionId}\0${snapshotId}\0${path}\0${effectKind}`).digest("hex")}`;
}
