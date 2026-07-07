import { HARNESS_CATALOG, type HarnessRuntimeStatus } from "./harnessCatalog.ts";
import { RUNTIME_KINDS, type RuntimeKind, type SourceKind } from "./types.ts";

export type AdapterMaturity = "planned" | "detector" | "metadata" | "transcript" | "full";
export type AdapterLifecycle = "active" | "scan_target" | "catalog_only" | "cloud_reference" | "legacy_planned";

export type AdapterCapability = {
  runtime: RuntimeKind;
  label: string;
  description: string;
  maturity: AdapterMaturity;
  sourceKinds: SourceKind[];
  supportsMetadataImport: boolean;
  supportsTranscriptImport: boolean;
  supportsLiveWatch: boolean;
  supportsTokenUsage: boolean;
  supportsFileEffects: boolean;
  supportsMcpExposure: boolean;
};

export type AdapterCapabilityProfile = AdapterCapability & {
  lifecycle: AdapterLifecycle;
  runtimeStatus: HarnessRuntimeStatus;
};

const RUNTIME_ORDER = new Map<string, number>(RUNTIME_KINDS.map((runtime, index) => [runtime, index]));

export const ADAPTER_CAPABILITY_PROFILES: AdapterCapabilityProfile[] = [...HARNESS_CATALOG].sort(
  (a, b) => (RUNTIME_ORDER.get(a.runtime) ?? Number.MAX_SAFE_INTEGER) - (RUNTIME_ORDER.get(b.runtime) ?? Number.MAX_SAFE_INTEGER)
).map((entry) => ({
  description: entry.description,
  label: entry.label,
  lifecycle: lifecycleForStatus(entry.runtimeStatus),
  maturity: maturityForSupportLevel(entry.supportLevel),
  runtime: entry.runtime,
  runtimeStatus: entry.runtimeStatus,
  sourceKinds: entry.sourceKinds,
  supportsFileEffects: entry.supportsFileEffects,
  supportsLiveWatch: entry.supportsLiveWatch,
  supportsMcpExposure: entry.supportsMcpExposure,
  supportsMetadataImport: entry.supportsMetadataImport,
  supportsTokenUsage: entry.supportsTokenUsage,
  supportsTranscriptImport: entry.supportsTranscriptImport
}));

export function adapterCapabilityProfile(runtime: RuntimeKind): AdapterCapabilityProfile {
  return ADAPTER_CAPABILITY_PROFILES.find((profile) => profile.runtime === runtime)!;
}

export function canImportMetadata(capability: AdapterCapability): boolean {
  return capability.supportsMetadataImport && capability.maturity !== "planned" && capability.maturity !== "detector";
}

export function canImportTranscripts(capability: AdapterCapability): boolean {
  return capability.supportsTranscriptImport && (capability.maturity === "transcript" || capability.maturity === "full");
}

function lifecycleForStatus(status: HarnessRuntimeStatus): AdapterLifecycle {
  if (status === "import_adapter") return "active";
  if (status === "scan_target") return "scan_target";
  if (status === "cloud_reference") return "cloud_reference";
  if (status === "legacy") return "legacy_planned";
  return "catalog_only";
}

function maturityForSupportLevel(supportLevel: (typeof HARNESS_CATALOG)[number]["supportLevel"]): AdapterMaturity {
  if (supportLevel === "active_full") return "full";
  if (supportLevel === "active_transcript") return "transcript";
  if (supportLevel === "active_metadata") return "metadata";
  if (supportLevel === "detector_only") return "detector";
  return "planned";
}
