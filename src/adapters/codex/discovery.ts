import { homedir } from "node:os";
import { join } from "node:path";
import type { DiscoveryContext } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

export function codexCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  // A test or explicitly redirected Masthead home must never escape into the
  // running Codex process' real history through CODEX_HOME.
  const root = context.homeDir === homedir() && process.env.CODEX_HOME
    ? process.env.CODEX_HOME
    : join(context.homeDir, ".codex");
  return [{
    confidence: "authoritative",
    contentKind: "jsonl-tree",
    maxDepth: 8,
    purpose: "Codex rollout session history",
    relativePath: join(root, "sessions"),
    runtime: "codex",
    sourceKind: "jsonl"
  }];
}
