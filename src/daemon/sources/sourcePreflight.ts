import type { AdapterDiagnostic, DiscoveryContext, RuntimeKind } from "../../adapters/types.ts";
import { supportedAdapters, type SupportedAdapter } from "./supportedAdapters.ts";
import { preflightAdapterCandidates } from "./sourcePreflightCandidates.ts";

export type SourcePreflightDto = {
  path: string;
  exists: boolean;
  readable: boolean;
  kind: "file" | "directory" | "missing" | "other";
  fileCount: number;
  byteCount: number;
  candidateSessionCount: number;
  lastModifiedAt?: string;
  diagnostics: AdapterDiagnostic[];
};

export type AdapterPreflightResult = {
  runtime: RuntimeKind;
  label: string;
  capability: SupportedAdapter;
  state: "connected" | "degraded" | "not_detected" | "planned";
  discoveredCount: number;
  diagnostics: AdapterDiagnostic[];
  checkedPaths: SourcePreflightDto[];
};

export type SourcePreflightResult = AdapterPreflightResult;

export async function preflightAllAdapters(context: DiscoveryContext): Promise<AdapterPreflightResult[]> {
  return Promise.all(supportedAdapters.filter((adapter) => adapter.enabled).map((adapter) => preflightOneAdapter(adapter, context)));
}

export async function sourcePreflight(context: DiscoveryContext): Promise<AdapterPreflightResult[]> {
  return preflightAllAdapters(context);
}

async function preflightOneAdapter(adapter: SupportedAdapter, context: DiscoveryContext): Promise<AdapterPreflightResult> {
  if (adapter.implementationState === "planned" || adapter.maturity === "planned") {
    return {
      capability: adapter,
      checkedPaths: [],
      diagnostics: [],
      discoveredCount: 0,
      label: adapter.label,
      runtime: adapter.runtime,
      state: "planned"
    };
  }

  const checkedPaths = await preflightAdapterCandidates(adapter.runtime, context);
  const diagnostics = [...checkedPaths.flatMap((path) => path.diagnostics)];
  const discoveredCount = checkedPaths.reduce((total, path) => total + path.candidateSessionCount, 0);
  const errors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const state = errors ? "degraded" : discoveredCount > 0 ? "connected" : "not_detected";

  if (state === "not_detected") {
    diagnostics.push({
      code: `${adapter.runtime}_sources_not_detected`,
      message: `No ${adapter.label} local session store was found in known locations.`,
      observedAt: context.now,
      severity: "warning"
    });
  }

  return {
    capability: adapter,
    checkedPaths,
    diagnostics,
    discoveredCount,
    label: adapter.label,
    runtime: adapter.runtime,
    state
  };
}
