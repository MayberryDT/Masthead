import { ADAPTER_CAPABILITY_PROFILES, type AdapterCapabilityProfile } from "../../adapters/capabilities.ts";

export type AdapterImplementationState = "active" | "scan_target" | "planned";

export type SupportedAdapter = AdapterCapabilityProfile & {
  name: string;
  enabled: boolean;
  implementationState: AdapterImplementationState;
};

export const supportedAdapters: SupportedAdapter[] = ADAPTER_CAPABILITY_PROFILES.map((capability) => ({
  ...capability,
  enabled: capability.runtimeStatus === "import_adapter" || capability.runtimeStatus === "scan_target",
  implementationState: capability.runtimeStatus === "import_adapter" ? "active" : capability.runtimeStatus === "scan_target" ? "scan_target" : "planned",
  name: capability.label
}));

export const SUPPORTED_ADAPTERS = supportedAdapters;
