import { join } from "node:path";
import type { DiscoveryContext } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

export function aiderCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  const root = process.env.MASTHEAD_AIDER_HOME ?? process.env.AIDER_HOME ?? join(context.homeDir, ".aider");
  return [
    candidate(root, "markdown-files"),
    candidate(join(context.homeDir, ".aider.chat.history.md"), "directory"),
    candidate(join(context.homeDir, ".aider.input.history"), "directory")
  ];
}

function candidate(relativePath: string, contentKind: AdapterPathCandidate["contentKind"]): AdapterPathCandidate {
  return { confidence: "heuristic", contentKind, maxDepth: 4, purpose: "Aider chat history", relativePath, runtime: "aider", sourceKind: "ui_signal" };
}
