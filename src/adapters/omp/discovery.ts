import { homedir } from "node:os";
import { join } from "node:path";
import type { DiscoveryContext } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

export function ompCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  // Redirected/test homes must stay under context.homeDir and never escape via OMP_HOME.
  const envHome = context.homeDir === homedir()
    ? process.env.MASTHEAD_OMP_HOME ?? process.env.OMP_HOME ?? process.env.OH_MY_PI_HOME
    : undefined;
  const roots = [
    envHome,
    join(context.homeDir, ".omp", "agent", "sessions"),
    join(context.homeDir, ".oh-my-pi", "agent", "sessions"),
    join(context.homeDir, ".local", "share", "omp", "agent", "sessions"),
    join(context.homeDir, ".local", "share", "oh-my-pi", "agent", "sessions"),
    join(context.homeDir, ".config", "omp", "agent", "sessions"),
    join(context.homeDir, ".config", "oh-my-pi", "agent", "sessions")
  ].filter(Boolean) as string[];

  return roots.map((relativePath) => ({
    confidence: "heuristic",
    contentKind: "jsonl-tree",
    maxDepth: 5,
    purpose: "Oh My Pi session history",
    relativePath,
    runtime: "omp",
    sourceKind: "jsonl"
  }));
}
