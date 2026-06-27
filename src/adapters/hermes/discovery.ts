import { join } from "node:path";
import type { DiscoveryContext } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

export function hermesCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  const root = process.env.MASTHEAD_HERMES_HOME ?? process.env.HERMES_HOME ?? join(context.homeDir, ".hermes");
  return [
    { confidence: "heuristic", contentKind: "sqlite-file", maxDepth: 1, purpose: "Hermes SQLite state", relativePath: join(root, "state.db"), runtime: "hermes", sourceKind: "sqlite" },
    { confidence: "heuristic", contentKind: "jsonl-tree", maxDepth: 5, purpose: "Hermes local history", relativePath: root, runtime: "hermes", sourceKind: "jsonl" },
    { confidence: "heuristic", contentKind: "jsonl-tree", maxDepth: 5, purpose: "Hermes local data", relativePath: join(context.homeDir, ".local", "share", "hermes"), runtime: "hermes", sourceKind: "jsonl" }
  ];
}
