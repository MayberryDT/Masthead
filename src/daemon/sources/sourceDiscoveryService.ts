import { discoverCodexSources } from "../../adapters/codex/discovery.ts";
import type { DiscoveryContext, DiscoveredSource } from "../../adapters/types.ts";
import { sourcePreflight, type SourcePreflightResult } from "./sourcePreflight.ts";

export type SourceDiscoveryRequest = {
  codexHomeDir: string;
  now: string;
  exclusions?: DiscoveryContext["exclusions"];
};

export type SourceDiscoverySnapshot = {
  sources: DiscoveredSource[];
  preflights: SourcePreflightResult[];
};

export async function discoverSourceSnapshot(request: SourceDiscoveryRequest): Promise<SourceDiscoverySnapshot> {
  const context: DiscoveryContext = {
    exclusions: request.exclusions ?? [],
    homeDir: request.codexHomeDir,
    now: request.now
  };
  const [sources, preflights] = await Promise.all([discoverCodexSources(context), sourcePreflight(context)]);
  return { preflights, sources };
}
