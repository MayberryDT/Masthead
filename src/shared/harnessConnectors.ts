import type { LiveConnectorRuntime } from "../adapters/liveRuntimes.ts";

export type ConnectorPresence = "not_found" | "found";
export type ConnectorLive = "not_installed" | "needs_action" | "ready" | "error";
export type ConnectorActionRequired =
  | "trust_hooks"
  | "enable_plugin"
  | "login"
  | "repair"
  | "restart_host"
  | "confirm_activation";

export type ConnectorActivation = {
  required: ConnectorActionRequired;
  message: string;
};

export type HarnessConnectorDto = {
  runtime: LiveConnectorRuntime;
  label: string;
  presence: ConnectorPresence;
  live: ConnectorLive;
  actionRequired?: ConnectorActionRequired;
  actionMessage?: string;
  configPath?: string;
  endpoint?: string;
  stateEndpoint?: string;
  lastLiveEventAt?: string;
  lastTest?: { status: "passed" | "failed"; testedAt: string; message: string };
  checkedPaths?: string[];
  diagnostics?: string[];
  supportsActions: boolean;
  historyFound?: boolean;
  historySessionCount?: number;
};

export type HarnessConnectorsSnapshotDto = {
  generatedAt: string;
  summary: {
    ready: number;
    needsAction: number;
    notInstalled: number;
    notFound: number;
    error: number;
  };
  connectors: HarnessConnectorDto[];
};

export function deriveLiveStatus(input: {
  installed: boolean;
  configExists: boolean;
  missingEvents: string[];
  mismatchedEvents: string[];
  error?: string;
  activation?: ConnectorActivation;
  lastLiveEventAt?: string;
}): { live: ConnectorLive; actionRequired?: ConnectorActionRequired; actionMessage?: string } {
  if (input.error) {
    return { live: "error", actionMessage: input.error };
  }

  if (!input.installed) {
    if (input.missingEvents.includes("enabled") && input.configExists) {
      return {
        live: "needs_action",
        actionRequired: "enable_plugin",
        actionMessage: "Plugin files present but not enabled in host config."
      };
    }
    if (input.configExists && (input.mismatchedEvents.length > 0 || input.missingEvents.length > 0)) {
      return {
        live: "needs_action",
        actionRequired: "repair",
        actionMessage: "Live connector files need repair."
      };
    }
    return { live: "not_installed" };
  }

  if (input.activation) {
    return {
      live: "needs_action",
      actionRequired: input.activation.required,
      actionMessage: input.activation.message
    };
  }

  if (input.mismatchedEvents.length > 0) {
    return {
      live: "needs_action",
      actionRequired: "repair",
      actionMessage: "Live connector files need repair."
    };
  }

  return { live: "ready" };
}

export function summarizeConnectors(
  connectors: HarnessConnectorDto[]
): HarnessConnectorsSnapshotDto["summary"] {
  return {
    ready: connectors.filter((c) => c.live === "ready").length,
    needsAction: connectors.filter((c) => c.live === "needs_action").length,
    notInstalled: connectors.filter((c) => c.live === "not_installed").length,
    notFound: connectors.filter((c) => c.presence === "not_found").length,
    error: connectors.filter((c) => c.live === "error").length
  };
}
