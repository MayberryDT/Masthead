import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { hash } from "../generic/jsonlAdapterKit.ts";
import type { DiscoveryContext } from "../types.ts";
import type { DiscoveredSource } from "../types.ts";
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

export async function discoverGrokSources(context: DiscoveryContext): Promise<DiscoveredSource[]> {
  const root = process.env.MASTHEAD_GROK_HOME ?? process.env.GROK_HOME ?? join(context.homeDir, ".grok");
  const paths = await chatHistoryPaths(join(root, "sessions"));
  return paths.map((path) => ({
    confidence: "heuristic",
    path,
    runtime: "grok",
    schemaVersion: "grok-jsonl-tree",
    sourceId: `grok:${hash(path)}`,
    sourceKind: "jsonl"
  }));
}

async function chatHistoryPaths(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await chatHistoryPaths(path)));
    else if (entry.isFile() && entry.name === "chat_history.jsonl") paths.push(path);
  }
  return paths.toSorted();
}
