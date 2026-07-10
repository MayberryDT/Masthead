import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { MastheadCapability, MastheadHealthDto } from "../shared/protocol.ts";
import { MASTHEAD_API_VERSION, MASTHEAD_PRODUCT } from "../shared/protocol.ts";
import type { DaemonConfig } from "./config.ts";
import { CURRENT_SCHEMA_VERSION, getOrCreateDatabaseIdentity } from "./db/schema.ts";
import type { MastheadDatabase } from "./db/sqlite.ts";

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
  return {
    ok: true,
    product: MASTHEAD_PRODUCT,
    apiVersion: MASTHEAD_API_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    buildVersion: buildVersion(),
    buildSha: process.env.MASTHEAD_BUILD_SHA || "development",
    capabilities,
    runtime: {
      daemonInstanceId: runtime.daemonInstanceId,
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

function buildVersion(): string {
  if (process.env.MASTHEAD_BUILD_VERSION) return process.env.MASTHEAD_BUILD_VERSION;

  try {
    const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version?: unknown };
    if (typeof packageJson.version === "string" && packageJson.version.trim()) return packageJson.version;
  } catch {
    // Development and tests may run from a compiled output directory without package metadata.
  }

  return "development";
}
