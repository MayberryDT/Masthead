import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DiscoveryContext, DiscoveredSource } from "../types.ts";

export async function discoverCodexSources(context: DiscoveryContext): Promise<DiscoveredSource[]> {
  const root = join(context.homeDir, ".codex");
  const candidates = [
    { id: "session-index", path: join(root, "session_index.jsonl"), kind: "jsonl" as const },
    { id: "history", path: join(root, "history.jsonl"), kind: "jsonl" as const },
    { id: "sessions", path: join(root, "sessions"), kind: "jsonl" as const },
    { id: "archived-sessions", path: join(root, "archived_sessions"), kind: "jsonl" as const }
  ];
  const sources: DiscoveredSource[] = [];
  for (const candidate of candidates) {
    if (isExcluded(candidate.path, context.exclusions)) continue;
    if (!(await exists(candidate.path))) continue;
    const info = await stat(candidate.path);
    sources.push({
      confidence: "authoritative",
      path: candidate.path,
      runtime: "codex",
      runtimeVersion: info.isDirectory() ? "directory" : "file",
      schemaVersion: "codex-local-jsonl",
      sourceId: `codex-${candidate.id}`,
      sourceKind: candidate.kind
    });
  }
  return sources;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isExcluded(path: string, exclusions: DiscoveryContext["exclusions"]): boolean {
  return exclusions.some((exclusion) => path.includes(exclusion.pattern));
}
