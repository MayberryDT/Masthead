import { ADAPTER_CAPABILITY_PROFILES, type AdapterCapabilityProfile } from "../../adapters/capabilities.ts";

export type AdapterImplementationState = "active" | "planned";

export type SupportedAdapter = AdapterCapabilityProfile & {
  name: string;
  enabled: boolean;
  implementationState: AdapterImplementationState;
};

export const supportedAdapters: SupportedAdapter[] = ADAPTER_CAPABILITY_PROFILES.map((capability) => ({
  ...capability,
  enabled: capability.lifecycle === "active",
  implementationState: capability.lifecycle === "active" ? "active" : "planned",
  name: capability.label
}));

export const SUPPORTED_ADAPTERS = supportedAdapters;
