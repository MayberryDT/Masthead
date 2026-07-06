import { join } from "node:path";
import type { DiscoveryContext } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

export function grokCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  const root = process.env.MASTHEAD_GROK_HOME ?? process.env.GROK_HOME ?? join(context.homeDir, ".grok");
  return [
    {
      confidence: "heuristic",
      contentKind: "jsonl-tree",
      maxDepth: 5,
      purpose: "Grok hook event history",
      relativePath: join(root, "hooks"),
      runtime: "grok",
      sourceKind: "jsonl"
    },
    {
      confidence: "heuristic",
      contentKind: "jsonl-tree",
      maxDepth: 5,
      purpose: "Grok session transcripts",
      relativePath: join(root, "sessions"),
      runtime: "grok",
      sourceKind: "jsonl"
    }
  ];
}
