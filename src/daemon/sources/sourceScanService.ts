import { createHash } from "node:crypto";
import { scanAdapters } from "../../adapters/registry.ts";
import type { AdapterMaturity } from "../../adapters/capabilities.ts";
import type { AdapterDiagnostic, DiscoveredSource, DiscoveryContext, RuntimeKind } from "../../adapters/types.ts";
import { supportedAdapters } from "./supportedAdapters.ts";
import { preflightAllAdapters, type SourcePreflightDto } from "./sourcePreflight.ts";

export type AdapterScanResult = {
  runtime: RuntimeKind;
  label: string;
  state: "connected" | "degraded" | "not_detected" | "planned";
  maturity: AdapterMaturity;
  discoveredSessions: number;
  checkedPaths: SourcePreflightDto[];
  diagnostics: AdapterDiagnostic[];
  sources: DiscoveredSource[];
};

export type SourceScanResult = {
  scanId: string;
  generatedAt: string;
  adapters: AdapterScanResult[];
};

export async function scanLocalSources(context: DiscoveryContext): Promise<SourceScanResult> {
  const [discovered, preflights] = await Promise.all([
    Promise.all(scanAdapters.map((adapter) => adapter.discover(context).catch((): DiscoveredSource[] => []))),
    preflightAllAdapters(context)
  ]);
  const sources = discovered.flat();

  return {
    adapters: supportedAdapters
      .filter((adapter) => adapter.enabled)
      .map((capability) => {
        const runtimeSources = sources.filter((source) => source.runtime === capability.runtime);
        const preflight = preflights.find((item) => item.runtime === capability.runtime);
        return {
          checkedPaths: preflight?.checkedPaths ?? [],
          diagnostics: preflight?.diagnostics ?? [],
          discoveredSessions: preflight?.discoveredCount ?? runtimeSources.length,
          label: capability.label,
          maturity: capability.maturity,
          runtime: capability.runtime,
          sources: runtimeSources,
          state: preflight?.state ?? "not_detected"
        };
      }),
    generatedAt: context.now,
    scanId: `scan:${createHash("sha256").update(context.now).digest("hex").slice(0, 12)}`
  };
}
