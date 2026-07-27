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
  | "usage_stats"
  | "settings"
  | "data_lifecycle"
  | "artifact_authoring";

export const REQUIRED_CLIENT_CAPABILITIES: MastheadCapability[] = [
  "live_projection",
  "canonical_sessions",
  "logbook_search",
  "source_discovery",
  "adapter_inventory",
  "import_jobs",
  "mcp_status",
  "usage_stats",
  "settings",
  "data_lifecycle",
  "artifact_authoring"
];

export type MastheadRuntimeMode = "primary" | "read_only_bridge";

export type MastheadHealthDto = {
  ok: true;
  product: typeof MASTHEAD_PRODUCT;
  apiVersion: number;
  schemaVersion: number;
  buildVersion: string;
  buildSha: string;
  capabilities: MastheadCapability[];
  runtime: {
    daemonInstanceId: string;
    pid: number;
    baseUrl: string;
    instanceDir?: string;
    instanceManifest?: string;
    authoringCommand?: string;
    authoringContractVersion?: "workbench-authoring-v5";
    startedAt: string;
    mode: MastheadRuntimeMode;
    writable: boolean;
    hookTranscriptCatchupEnabled?: boolean;
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
    !stringValue(value.buildSha) ||
    !stringValue(runtime.daemonInstanceId) ||
    !positiveInteger(runtime.pid) ||
    !stringValue(runtime.baseUrl) ||
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

  if (
    (runtime.mode === "primary" && runtime.writable !== true) ||
    (runtime.mode === "read_only_bridge" && runtime.writable !== false)
  ) return { state: "malformed", reason: "missing_required_fields" };

  try {
    const baseUrl = new URL(String(runtime.baseUrl));
    if (
      baseUrl.protocol !== "http:" ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.pathname !== "/" ||
      baseUrl.search ||
      baseUrl.hash
      || baseUrl.hostname !== runtime.host
      || Number(baseUrl.port || 80) !== runtime.port
    ) return { state: "malformed", reason: "missing_required_fields" };
    if (
      runtime.mode === "primary" &&
      (!stringValue(runtime.instanceDir) || !stringValue(runtime.instanceManifest) || !stringValue(runtime.authoringCommand) ||
        !isCanonicalAbsoluteProtocolPath(String(runtime.instanceDir)) ||
        !isCanonicalAbsoluteProtocolPath(String(runtime.instanceManifest)) ||
        !isCanonicalAbsoluteProtocolPath(String(runtime.authoringCommand)) ||
        !isCanonicalAbsoluteProtocolPath(String(data.dataDirectory)) ||
        !isCanonicalAbsoluteProtocolPath(String(data.databasePath)) ||
        !isManifestInsideInstanceDir(String(runtime.instanceManifest), String(runtime.instanceDir)))
    ) {
      return { state: "malformed", reason: "missing_required_fields" };
    }
    if (runtime.mode === "primary") {
      const instanceDir = canonicalProtocolPath(String(runtime.instanceDir));
      const dataDirectory = canonicalProtocolPath(String(data.dataDirectory));
      const expectedManifest = `${instanceDir}/masthead-instance.json`;
      const windows = /^[A-Za-z]:\//u.test(instanceDir) || instanceDir.startsWith("//");
      const expectedCommand = `${instanceDir}/bin/${windows ? "mastheadctl.cmd" : "mastheadctl"}`;
      if (
        instanceDir !== dataDirectory ||
        canonicalProtocolPath(String(runtime.instanceManifest)) !== expectedManifest ||
        canonicalProtocolPath(String(runtime.authoringCommand)) !== expectedCommand
      ) return { state: "malformed", reason: "missing_required_fields" };
    } else if (runtime.instanceManifest !== undefined || runtime.authoringCommand !== undefined || runtime.instanceDir !== undefined) {
      return { state: "malformed", reason: "missing_required_fields" };
    }
  } catch {
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

function positiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value);
}

function isManifestInsideInstanceDir(manifest: string, instanceDir: string): boolean {
  const normalizedManifest = manifest.replace(/\\/gu, "/");
  const normalizedDir = instanceDir.replace(/\\/gu, "/").replace(/\/+$/u, "");
  return normalizedManifest === `${normalizedDir}/masthead-instance.json`;
}

function canonicalProtocolPath(value: string): string {
  const normalized = value.replace(/\\/gu, "/").replace(/\/+$/u, "");
  const prefix = normalized.startsWith("//") ? "//" : normalized.startsWith("/") ? "/" : "";
  const body = prefix ? normalized.slice(prefix.length) : normalized;
  const segments: string[] = [];
  for (const segment of body.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `${prefix}${segments.join("/")}`;
}

function isCanonicalAbsoluteProtocolPath(value: string): boolean {
  if (!isAbsolutePath(value)) return false;
  const normalized = value.replace(/\\/gu, "/").replace(/\/+$/u, "");
  return normalized === canonicalProtocolPath(value);
}
