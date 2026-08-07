import { homedir } from "node:os";
import { join } from "node:path";
import type { DiscoveryContext } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

export function claudeCodeCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  // Redirected/test homes must stay under context.homeDir and never escape via CLAUDE_HOME.
  const root = context.homeDir === homedir()
    ? process.env.MASTHEAD_CLAUDE_CODE_HOME ?? process.env.CLAUDE_HOME ?? join(context.homeDir, ".claude")
    : join(context.homeDir, ".claude");
  return [
    candidate("Claude Code project transcripts", join(root, "projects")),
    candidate("Claude Code conversations", join(root, "conversations")),
    candidate("Claude Code history", join(root, "history"))
  ];
}

function candidate(purpose: string, relativePath: string): AdapterPathCandidate {
  return {
    confidence: "heuristic",
    contentKind: "jsonl-tree",
    maxDepth: 6,
    purpose,
    relativePath,
    runtime: "claude_code",
    sourceKind: "jsonl"
  };
}
