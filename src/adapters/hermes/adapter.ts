import { basename } from "node:path";
import { createLocalAdapter, genericCodingProfile } from "../generic/localAdapterFactory.ts";
import type { DiscoveredSource } from "../types.ts";
import { hermesCandidatePaths } from "./discovery.ts";
import { backfillHermesSource, parseHermesTranscriptUnit, planHermesTranscriptUnits } from "./transcriptUnit.ts";

const baseHermesAdapter = createLocalAdapter({ runtime: "hermes", candidatePaths: hermesCandidatePaths, jsonlProfile: genericCodingProfile("hermes") });

export const hermesAdapter = {
  ...baseHermesAdapter,
  backfill: backfillHermesSource,
  async discover(...args: Parameters<typeof baseHermesAdapter.discover>) {
    return dedupeSessionFilePairs(await baseHermesAdapter.discover(...args));
  },
  parseTranscriptUnit: parseHermesTranscriptUnit,
  planTranscriptUnits: planHermesTranscriptUnits
};

function dedupeSessionFilePairs(sources: DiscoveredSource[]): DiscoveredSource[] {
  const keyed = new Map<string, DiscoveredSource>();
  const unkeyed: DiscoveredSource[] = [];
  for (const source of sources) {
    if (source.path && basename(source.path) === "sessions.json") continue;
    const key = hermesSessionFileKey(source);
    if (!key) {
      unkeyed.push(source);
      continue;
    }
    const current = keyed.get(key);
    if (!current || source.path?.endsWith(".jsonl")) keyed.set(key, source);
  }
  return [...unkeyed, ...keyed.values()];
}

function hermesSessionFileKey(source: DiscoveredSource): string | undefined {
  if (!source.path || source.sourceKind !== "jsonl") return undefined;
  const name = basename(source.path);
  if (!name.endsWith(".json") && !name.endsWith(".jsonl")) return undefined;
  return name.replace(/\.(jsonl|json)$/i, "").replace(/^session_/, "");
}
