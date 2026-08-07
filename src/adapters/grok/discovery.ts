import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { hash } from "../generic/jsonlAdapterKit.ts";
import type { DiscoveryContext } from "../types.ts";
import type { DiscoveredSource } from "../types.ts";
import type { AdapterPathCandidate } from "../pathTypes.ts";

const GROK_SESSION_MAX_DEPTH = 5;

export function grokCandidatePaths(context: DiscoveryContext): AdapterPathCandidate[] {
  const root = grokHomeRoot(context);
  return [
    {
      confidence: "heuristic",
      contentKind: "jsonl-tree",
      maxDepth: GROK_SESSION_MAX_DEPTH,
      purpose: "Grok hook event history",
      relativePath: join(root, "hooks"),
      runtime: "grok",
      sourceKind: "jsonl"
    },
    {
      confidence: "heuristic",
      contentKind: "jsonl-tree",
      maxDepth: GROK_SESSION_MAX_DEPTH,
      purpose: "Grok session transcripts",
      relativePath: join(root, "sessions"),
      runtime: "grok",
      sourceKind: "jsonl"
    }
  ];
}

export async function discoverGrokSources(context: DiscoveryContext): Promise<DiscoveredSource[]> {
  const root = grokHomeRoot(context);
  const paths = await chatHistoryPaths(join(root, "sessions"), 0, GROK_SESSION_MAX_DEPTH);
  return paths.map((path) => ({
    confidence: "heuristic",
    path,
    runtime: "grok",
    schemaVersion: "grok-jsonl-tree",
    sourceId: `grok:${hash(path)}`,
    sourceKind: "jsonl"
  }));
}

function grokHomeRoot(context: DiscoveryContext): string {
  // Redirected/test homes must stay under context.homeDir and never escape via GROK_HOME.
  if (context.homeDir === homedir()) {
    return process.env.MASTHEAD_GROK_HOME ?? process.env.GROK_HOME ?? join(context.homeDir, ".grok");
  }
  return join(context.homeDir, ".grok");
}

async function chatHistoryPaths(directory: string, depth: number, maxDepth: number): Promise<string[]> {
  if (depth > maxDepth) return [];
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await chatHistoryPaths(path, depth + 1, maxDepth)));
    else if (entry.isFile() && entry.name === "chat_history.jsonl") paths.push(path);
  }
  return paths.toSorted();
}
