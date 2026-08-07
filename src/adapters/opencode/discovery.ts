import { homedir } from "node:os";
import { join } from "node:path";
import type { DiscoveryContext } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

export function opencodeCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  // Redirected/test homes must stay under context.homeDir and never escape via OPENCODE_HOME.
  const envHome = context.homeDir === homedir()
    ? process.env.MASTHEAD_OPENCODE_HOME ?? process.env.OPENCODE_HOME
    : undefined;
  const roots = [
    envHome,
    join(context.homeDir, ".opencode"),
    join(context.homeDir, ".local", "share", "opencode"),
    join(context.homeDir, ".config", "opencode")
  ].filter(Boolean) as string[];
  return roots.flatMap((relativePath): AdapterPathCandidate[] => [
    {
      confidence: "heuristic",
      contentKind: "sqlite-file",
      maxDepth: 0,
      purpose: "OpenCode session database",
      relativePath: join(relativePath, "opencode.db"),
      runtime: "opencode",
      sourceKind: "sqlite"
    },
    {
      confidence: "heuristic",
      contentKind: "jsonl-tree",
      legacy: true,
      maxDepth: 6,
      purpose: "Legacy OpenCode session history",
      relativePath: join(relativePath, "sessions"),
      runtime: "opencode",
      sourceKind: "jsonl"
    }
  ]);
}
