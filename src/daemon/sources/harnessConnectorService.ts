import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { LIVE_CONNECTOR_RUNTIMES, type LiveConnectorRuntime } from "../../adapters/liveRuntimes.ts";
import {
  deriveLiveStatus,
  summarizeConnectors,
  type ConnectorPresence,
  type HarnessConnectorDto,
  type HarnessConnectorsSnapshotDto
} from "../../shared/harnessConnectors.ts";
import type { DaemonConfig } from "../config.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";
import { getLiveConnectorSettings } from "../liveConnectorSettings.ts";
import {
  clearConnectorActivation,
  getConnectorActivation,
  type StoredConnectorActivation
} from "./connectorActivationStore.ts";
import { preflightAllAdapters, type AdapterPreflightResult } from "./sourcePreflight.ts";

/**
 * Merge presence preflight + live connector settings + activation store into
 * the Sources V2 harness connector snapshot.
 */
export async function listHarnessConnectors(
  db: MastheadDatabase,
  config: DaemonConfig
): Promise<HarnessConnectorsSnapshotDto> {
  const now = new Date().toISOString();
  const dataDirectory = dirname(config.databasePath);
  const context = {
    homeDir: config.codexHomeDir,
    now,
    exclusions: [] as import("../../adapters/types.ts").SourceExclusion[]
  };

  const [preflights, liveSettings, latestByRuntime] = await Promise.all([
    preflightAllAdapters(context),
    getLiveConnectorSettings(config),
    Promise.resolve(latestLiveEventAtByRuntime(db))
  ]);

  const preflightByRuntime = new Map(preflights.map((preflight) => [preflight.runtime, preflight]));
  const liveByRuntime = new Map(liveSettings.map((setting) => [setting.runtime, setting]));

  const connectors: HarnessConnectorDto[] = [];

  for (const runtime of LIVE_CONNECTOR_RUNTIMES) {
    const live = liveByRuntime.get(runtime);
    if (!live) {
      // Should not happen: getLiveConnectorSettings covers every LIVE_CONNECTOR_RUNTIMES entry.
      continue;
    }

    const pre = preflightByRuntime.get(runtime);
    const presence = resolvePresence(runtime, config, pre);
    const lastLiveEventAt = latestByRuntime.get(runtime);

    let storedActivation = await getConnectorActivation(dataDirectory, runtime);

    // Auto-clear host activation once a real live event arrives after the flag was set
    // (e.g. Codex hooks trusted and emitting).
    if (storedActivation && lastLiveEventAt && isIsoAfter(lastLiveEventAt, storedActivation.setAt)) {
      await clearConnectorActivation(dataDirectory, runtime);
      storedActivation = undefined;
    }

    // When missingEvents already includes "enabled", deriveLiveStatus maps that to enable_plugin.
    // Prefer store activation when present; otherwise leave deriveLiveStatus to handle enable_plugin.
    const activation = toConnectorActivation(storedActivation);

    const derived = deriveLiveStatus({
      installed: live.installed,
      configExists: live.configExists,
      missingEvents: live.missingEvents,
      mismatchedEvents: live.mismatchedEvents,
      error: live.error,
      activation,
      lastLiveEventAt
    });

    connectors.push({
      runtime,
      label: live.label,
      presence,
      live: derived.live,
      actionRequired: derived.actionRequired,
      actionMessage: derived.actionMessage,
      configPath: live.configPath,
      endpoint: live.endpoint,
      stateEndpoint: live.stateEndpoint,
      lastLiveEventAt,
      lastTest: undefined,
      checkedPaths: pre?.checkedPaths.map((path) => path.path) ?? [],
      diagnostics: (pre?.diagnostics ?? []).map((diagnostic) => diagnostic.message),
      supportsActions: true,
      historyFound: (pre?.discoveredCount ?? 0) > 0,
      historySessionCount: pre?.discoveredCount
    });
  }

  return {
    generatedAt: now,
    summary: summarizeConnectors(connectors),
    connectors
  };
}

/** Discover re-scans presence + live status. For V1 this is the same recompute as list. */
export async function discoverHarnessConnectors(
  db: MastheadDatabase,
  config: DaemonConfig
): Promise<HarnessConnectorsSnapshotDto> {
  return listHarnessConnectors(db, config);
}

/** Latest live_state_reports.observed_at per runtime. */
export function latestLiveEventAtByRuntime(db: MastheadDatabase): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT runtime AS runtime, MAX(observed_at) AS observedAt
       FROM live_state_reports
       GROUP BY runtime`
    )
    .all() as Array<{ runtime: string; observedAt: string | null }>;

  const result = new Map<string, string>();
  for (const row of rows) {
    if (row.runtime && row.observedAt) {
      result.set(row.runtime, row.observedAt);
    }
  }
  return result;
}

function resolvePresence(
  runtime: LiveConnectorRuntime,
  config: DaemonConfig,
  pre: AdapterPreflightResult | undefined
): ConnectorPresence {
  if (pre && pre.state !== "not_detected" && pre.state !== "planned") {
    return "found";
  }

  if (pathHintsExist(runtime, config, pre)) {
    return "found";
  }

  return "not_found";
}

/**
 * Presence path hints when preflight is not_detected/planned/missing.
 * Codex may lack session history while `~/.codex` exists; other runtimes use
 * preflight checkedPaths that exist on disk.
 */
function pathHintsExist(
  runtime: LiveConnectorRuntime,
  config: DaemonConfig,
  pre: AdapterPreflightResult | undefined
): boolean {
  if (runtime === "codex") {
    return existsSync(join(resolve(config.codexHomeDir), ".codex"));
  }

  if (pre?.checkedPaths.some((path) => path.exists)) {
    return true;
  }

  return false;
}

function toConnectorActivation(
  stored: StoredConnectorActivation | undefined
): { required: StoredConnectorActivation["required"]; message: string } | undefined {
  if (!stored) return undefined;
  return {
    required: stored.required,
    message: stored.message
  };
}

/** ISO-8601 string compare (same format sorts lexicographically by time). */
function isIsoAfter(candidate: string, baseline: string): boolean {
  return candidate > baseline;
}
