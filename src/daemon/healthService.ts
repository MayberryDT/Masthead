import { dirname } from "node:path";
import type { MastheadCapability, MastheadHealthDto } from "../shared/protocol.ts";
import { MASTHEAD_API_VERSION, MASTHEAD_PRODUCT } from "../shared/protocol.ts";
import type { DaemonConfig } from "./config.ts";
import { CURRENT_SCHEMA_VERSION, getOrCreateDatabaseIdentity } from "./db/schema.ts";
import type { MastheadDatabase } from "./db/sqlite.ts";
import { resolveReleaseIdentity } from "./releaseIdentity.ts";

const capabilities: MastheadCapability[] = [
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

export type HealthServiceRuntime = {
  daemonInstanceId: string;
  pid: number;
  baseUrl: () => string;
  instanceDir: string;
  instanceManifest: string;
  authoringCommand: string;
  startedAt: string;
  port: () => number;
};

export type LiveHealthCounts = {
  diagnostics: number;
  events: number;
  gitSnapshots: number;
  sessions: number;
  sources: number;
};

export function buildMastheadHealth(
  config: DaemonConfig,
  database: MastheadDatabase,
  runtime: HealthServiceRuntime,
  live: LiveHealthCounts
): MastheadHealthDto {
  const release = resolveReleaseIdentity();
  return {
    ok: true,
    product: MASTHEAD_PRODUCT,
    apiVersion: MASTHEAD_API_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    buildVersion: release.version,
    buildSha: release.gitSha,
    capabilities,
    runtime: {
      daemonInstanceId: runtime.daemonInstanceId,
      pid: runtime.pid,
      baseUrl: runtime.baseUrl(),
      instanceDir: runtime.instanceDir,
      instanceManifest: runtime.instanceManifest,
      authoringCommand: runtime.authoringCommand,
      authoringContractVersion: "workbench-authoring-v5",
      startedAt: runtime.startedAt,
      mode: "primary",
      writable: true,
      hookTranscriptCatchupEnabled: config.hookTranscriptCatchupEnabled,
      host: config.host,
      port: runtime.port()
    },
    data: {
      dataDirectory: config.dataDirectory ?? dirname(config.databasePath),
      databasePath: config.databasePath,
      databaseId: getOrCreateDatabaseIdentity(database),
      migrationState: "ready",
      sessions: live.sessions,
      sources: live.sources
    },
    live
  };
}
