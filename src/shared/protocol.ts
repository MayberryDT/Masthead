export const MASTHEAD_API_VERSION = 1;
export const MASTHEAD_MIN_CLIENT_API_VERSION = 1;
export const MASTHEAD_PRODUCT = "masthead";

export type MastheadCapability =
  | "live_projection"
  | "canonical_sessions"
  | "logbook_search"
  | "source_discovery"
  | "adapter_inventory"
  | "import_jobs"
  | "mcp_status"
  | "settings"
  | "data_lifecycle";

export const REQUIRED_CLIENT_CAPABILITIES: MastheadCapability[] = [
  "live_projection",
  "canonical_sessions",
  "logbook_search",
  "source_discovery",
  "adapter_inventory",
  "import_jobs",
  "mcp_status",
  "settings",
  "data_lifecycle"
];

export type MastheadRuntimeMode = "primary" | "read_only_bridge";

export type MastheadHealthDto = {
  ok: true;
  product: typeof MASTHEAD_PRODUCT;
  apiVersion: number;
  schemaVersion: number;
  buildVersion: string;
  buildSha?: string;
  capabilities: MastheadCapability[];
  runtime: {
    daemonInstanceId: string;
    startedAt: string;
    mode: MastheadRuntimeMode;
    writable: boolean;
    host: string;
    port: number;
    upstream?: {
      baseUrl: string;
      daemonInstanceId: string;
    };
  };
  data: {
    dataDirectory: string;
    databasePath: string;
    databaseId: string;
    migrationState: "ready" | "migrating" | "failed";
    sessions: number;
    sources: number;
  };
  live: {
    events: number;
    diagnostics: number;
    gitSnapshots: number;
  };
};

export type DaemonCompatibility =
  | { state: "compatible"; apiVersion: number }
  | { state: "degraded"; reason: "migration_failed" }
  | { state: "incompatible"; reason: "missing_protocol_identity" }
  | { state: "incompatible"; reason: "wrong_product"; product: unknown }
  | { state: "incompatible"; reason: "unsupported_api_version"; apiVersion: unknown; requiredApiVersion: number }
  | { state: "incompatible"; reason: "missing_capabilities"; missingCapabilities: MastheadCapability[] }
  | { state: "malformed"; reason: "not_an_object" | "health_not_ok" | "missing_required_fields" };

export function classifyDaemonHealth(
  value: unknown,
  requiredApiVersion = MASTHEAD_API_VERSION,
  requiredCapabilities = REQUIRED_CLIENT_CAPABILITIES
): DaemonCompatibility {
  if (!isRecord(value)) {
    return { state: "malformed", reason: "not_an_object" };
  }

  if (value.ok !== true) {
    return { state: "malformed", reason: "health_not_ok" };
  }

  if (!("product" in value) || !("apiVersion" in value)) {
    return { state: "incompatible", reason: "missing_protocol_identity" };
  }

  if (value.product !== MASTHEAD_PRODUCT) {
    return { state: "incompatible", reason: "wrong_product", product: value.product };
  }

  if (typeof value.apiVersion !== "number" || value.apiVersion !== requiredApiVersion) {
    return {
      state: "incompatible",
      reason: "unsupported_api_version",
      apiVersion: value.apiVersion,
      requiredApiVersion
    };
  }

  const capabilities = new Set(Array.isArray(value.capabilities) ? value.capabilities : []);
  const missingCapabilities = requiredCapabilities.filter((capability) => !capabilities.has(capability));
  if (missingCapabilities.length > 0) {
    return { state: "incompatible", reason: "missing_capabilities", missingCapabilities };
  }

  const runtime = isRecord(value.runtime) ? value.runtime : undefined;
  const data = isRecord(value.data) ? value.data : undefined;

  if (
    !runtime ||
    !stringValue(runtime.daemonInstanceId) ||
    !stringValue(runtime.startedAt) ||
    !["primary", "read_only_bridge"].includes(String(runtime.mode)) ||
    booleanValue(runtime.writable) === undefined ||
    !stringValue(runtime.host) ||
    numberValue(runtime.port) === undefined ||
    !data ||
    !stringValue(data.dataDirectory) ||
    !stringValue(data.databasePath) ||
    !stringValue(data.databaseId) ||
    !["ready", "migrating", "failed"].includes(String(data.migrationState))
  ) {
    return { state: "malformed", reason: "missing_required_fields" };
  }

  if (data.migrationState === "failed") {
    return { state: "degraded", reason: "migration_failed" };
  }

  return { state: "compatible", apiVersion: value.apiVersion };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
