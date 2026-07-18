import { join } from "node:path";
import type { DiscoveryContext } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

export function opencodeCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  const roots = [process.env.MASTHEAD_OPENCODE_HOME ?? process.env.OPENCODE_HOME, join(context.homeDir, ".opencode"), join(context.homeDir, ".local", "share", "opencode"), join(context.homeDir, ".config", "opencode")].filter(Boolean) as string[];
  return roots.map((relativePath) => ({
    confidence: "heuristic",
    contentKind: "sqlite-file",
    maxDepth: 0,
    purpose: "OpenCode session database",
    relativePath: join(relativePath, "opencode.db"),
    runtime: "opencode",
    sourceKind: "sqlite"
  }));
}
