import { sessionAdapters } from "../../adapters/registry.ts";
import type { DiscoveryContext, DiscoveredSource } from "../../adapters/types.ts";
import { preflightAllAdapters, type AdapterPreflightResult } from "./sourcePreflight.ts";

export type SourceDiscoveryRequest = {
  homeDir?: string;
  codexHomeDir?: string;
  now: string;
  exclusions?: DiscoveryContext["exclusions"];
};

export type SourceDiscoverySnapshot = {
  sources: DiscoveredSource[];
  preflights: AdapterPreflightResult[];
};

export async function discoverSourceSnapshot(request: SourceDiscoveryRequest): Promise<SourceDiscoverySnapshot> {
  const homeDir = request.homeDir ?? request.codexHomeDir;
  if (!homeDir) throw new Error("homeDir is required");
  const context: DiscoveryContext = {
    exclusions: request.exclusions ?? [],
    homeDir,
    now: request.now
  };
  const [sourceGroups, preflights] = await Promise.all([
    Promise.all(
      sessionAdapters.map((adapter) =>
        adapter.discover(context).catch((): DiscoveredSource[] => [])
      )
    ),
    preflightAllAdapters(context)
  ]);
  return {
    preflights,
    sources: sourceGroups.flat()
  };
}
