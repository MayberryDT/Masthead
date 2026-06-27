import { join } from "node:path";
import type { DiscoveryContext } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

export function opencodeCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  const roots = [process.env.MASTHEAD_OPENCODE_HOME ?? process.env.OPENCODE_HOME, join(context.homeDir, ".opencode"), join(context.homeDir, ".local", "share", "opencode"), join(context.homeDir, ".config", "opencode")].filter(Boolean) as string[];
  return roots.map((relativePath) => ({ confidence: "heuristic", contentKind: "jsonl-tree", maxDepth: 6, purpose: "OpenCode local session history", relativePath, runtime: "opencode", sourceKind: "jsonl" }));
}
