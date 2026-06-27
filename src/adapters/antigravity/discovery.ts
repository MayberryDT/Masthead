import { join } from "node:path";
import type { DiscoveryContext } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

export function antigravityCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  const root = process.env.MASTHEAD_ANTIGRAVITY_HOME ?? process.env.ANTIGRAVITY_HOME ?? join(context.homeDir, ".config", "Antigravity");
  return [
    candidate("Antigravity local state", root, "directory", "inference"),
    candidate("Antigravity global storage", join(root, "User", "globalStorage"), "sqlite-file", "sqlite"),
    candidate("Antigravity workspace storage", join(root, "User", "workspaceStorage"), "sqlite-file", "sqlite")
  ];
}

function candidate(purpose: string, relativePath: string, contentKind: AdapterPathCandidate["contentKind"], sourceKind: AdapterPathCandidate["sourceKind"]): AdapterPathCandidate {
  return { confidence: "heuristic", contentKind, maxDepth: 5, purpose, relativePath, runtime: "antigravity", sourceKind };
}
