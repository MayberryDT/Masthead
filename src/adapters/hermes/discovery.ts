import { basename, join } from "node:path";
import type { DiscoveryContext } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

export function hermesCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  const root = process.env.MASTHEAD_HERMES_HOME ?? process.env.HERMES_HOME ?? join(context.homeDir, ".hermes");
  const sessionsRoot = basename(root) === "sessions" ? root : join(root, "sessions");
  const localShareRoot = join(context.homeDir, ".local", "share", "hermes");
  return [
    { confidence: "heuristic", contentKind: "sqlite-file", maxDepth: 1, purpose: "Hermes SQLite state", relativePath: join(root, "state.db"), runtime: "hermes", sourceKind: "sqlite" },
    { confidence: "heuristic", contentKind: "jsonl-tree", maxDepth: 1, purpose: "Hermes local sessions", relativePath: sessionsRoot, runtime: "hermes", sourceKind: "jsonl" },
    { confidence: "heuristic", contentKind: "jsonl-tree", maxDepth: 1, purpose: "Hermes local data sessions", relativePath: join(localShareRoot, "sessions"), runtime: "hermes", sourceKind: "jsonl" }
  ];
}
