import { join } from "node:path";
import type { DiscoveryContext } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

export function piCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  const roots = [process.env.MASTHEAD_PI_HOME ?? process.env.PI_HOME, join(context.homeDir, ".pi"), join(context.homeDir, ".local", "share", "pi"), join(context.homeDir, ".config", "pi")].filter(Boolean) as string[];
  return roots.map((relativePath) => ({ confidence: "heuristic", contentKind: "jsonl-tree", maxDepth: 5, purpose: "Pi local session history", relativePath, runtime: "pi", sourceKind: "jsonl" }));
}
