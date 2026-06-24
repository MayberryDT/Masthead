import { resourceKeysForEvent } from "./risk.ts";
import type { ConflictCard, EvidenceRef, GitSnapshot, NormalizedEvent } from "./types";

export function detectConflicts(snapshots: GitSnapshot[]): ConflictCard[] {
  const pathIndex = new Map<string, GitSnapshot[]>();

  for (const snapshot of snapshots) {
    for (const changedPath of snapshot.changedPaths) {
      if (changedPath.sensitivity === "sensitive_path_only") continue;
      const key = `${snapshot.gitCommonDir}::${changedPath.path}`;
      pathIndex.set(key, [...(pathIndex.get(key) ?? []), snapshot]);
    }
  }

  const conflicts: ConflictCard[] = [];
  for (const [key, matches] of pathIndex) {
    const uniqueSessionIds = [...new Set(matches.map((snapshot) => snapshot.sessionId))];
    if (uniqueSessionIds.length < 2) continue;

    const [gitCommonDir, sharedPath] = key.split("::");
    const worktreePaths = [...new Set(matches.map((snapshot) => snapshot.worktreePath))];
    const evidence: EvidenceRef[] = matches.map((snapshot) => ({
      id: snapshot.snapshotId,
      kind: "git_snapshot",
      observedAt: snapshot.observedAt,
      source: "git.observer"
    }));

    conflicts.push({
      conflictId: `conflict:${gitCommonDir}:${sharedPath}`,
      type: "exact_file_overlap",
      severity: "high",
      sessionIds: uniqueSessionIds,
      repo: {
        gitCommonDir,
        worktreePaths
      },
      sharedPaths: [sharedPath],
      attribution: worktreePaths.length === 1 ? "degraded" : "direct",
      title: `Same tracked path changed by ${uniqueSessionIds.length} active sessions`,
      evidence
    });
  }

  return conflicts;
}

type SharedResourceConflictOptions = {
  activeSessionIds?: string[];
};

export function detectSharedResourceConflicts(
  events: NormalizedEvent[],
  options: SharedResourceConflictOptions = {}
): ConflictCard[] {
  const resources = new Map<string, NormalizedEvent[]>();
  const activeSessionIds = options.activeSessionIds ? new Set(options.activeSessionIds) : undefined;

  for (const event of events) {
    if (!event.sessionId) continue;
    if (activeSessionIds && !activeSessionIds.has(event.sessionId)) continue;
    for (const resourceKey of resourceKeysForEvent(event)) {
      resources.set(resourceKey, [...(resources.get(resourceKey) ?? []), event]);
    }
  }

  const conflicts: ConflictCard[] = [];
  for (const [resourceKey, matches] of resources) {
    const sessionIds = [...new Set(matches.flatMap((event) => (event.sessionId ? [event.sessionId] : [])))];
    if (sessionIds.length < 2) continue;

    const evidence: EvidenceRef[] = matches.map((event) => ({
      id: event.eventId,
      kind: "event",
      observedAt: event.occurredAt,
      source: `${event.source.adapter}.${event.source.surface}`
    }));
    const worktreePaths = [
      ...new Set(matches.flatMap((event) => (event.workspace?.worktreePath ? [event.workspace.worktreePath] : [])))
    ];
    const gitCommonDir =
      matches.find((event) => event.workspace?.gitCommonDir)?.workspace?.gitCommonDir ??
      matches.find((event) => event.workspace?.repoRoot)?.workspace?.repoRoot ??
      "unknown";

    conflicts.push({
      conflictId: `conflict:shared-resource:${sanitizeConflictPart(resourceKey)}`,
      type: "shared_resource",
      severity: resourceKey.startsWith("migration:") || resourceKey.startsWith("local-db:") ? "high" : "medium",
      sessionIds,
      repo: {
        gitCommonDir,
        worktreePaths
      },
      sharedPaths: [resourceKey],
      attribution: "direct",
      title: `Shared local resource used by ${sessionIds.length} active sessions`,
      evidence
    });
  }

  return conflicts;
}

function sanitizeConflictPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
