import { join } from "node:path";
import type { DiscoveryContext } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

export function openclawCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  const roots = [process.env.MASTHEAD_OPENCLAW_HOME ?? process.env.OPENCLAW_HOME, join(context.homeDir, ".openclaw"), join(context.homeDir, ".local", "share", "openclaw"), join(context.homeDir, ".config", "openclaw")].filter(Boolean) as string[];
  return roots.map((relativePath) => ({ confidence: "heuristic", contentKind: "jsonl-tree", maxDepth: 6, purpose: "OpenClaw local session history", relativePath, runtime: "openclaw", sourceKind: "jsonl" }));
}
