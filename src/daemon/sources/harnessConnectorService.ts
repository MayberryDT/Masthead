import { existsSync } from "node:fs";
import { accessSync, constants as fsConstants, readdirSync } from "node:fs";
import { dirname, join, resolve, delimiter } from "node:path";
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
import { readRuntimeHookLastTest } from "../settingsService.ts";
import {
  clearConnectorActivation,
  getConnectorActivation,
  type StoredConnectorActivation
} from "./connectorActivationStore.ts";
/** CLI names that prove a harness is actually installed (not just a Masthead plugin path). */
const HARNESS_BINARIES: Record<LiveConnectorRuntime, readonly string[]> = {
  codex: ["codex"],
  claude_code: ["claude"],
  cursor: ["cursor", "cursor-agent"],
  grok: ["grok"],
  opencode: ["opencode"],
  omp: ["omp", "oh-my-pi"],
  pi: ["pi"],
  hermes: ["hermes"]
};

/**
 * Merge lightweight harness presence + live connector settings + activation store.
 *
 * Intentionally does NOT run full history preflight/session counting — that is Workbench work
 * and made Sources refresh multi-minute. Presence uses CLI-on-PATH + real home markers only.
 */
export async function listHarnessConnectors(
  db: MastheadDatabase,
  config: DaemonConfig
): Promise<HarnessConnectorsSnapshotDto> {
  const now = new Date().toISOString();
  const dataDirectory = dirname(config.databasePath);

  const [liveSettings, latestByRuntime] = await Promise.all([
    getLiveConnectorSettings(config),
    Promise.resolve(latestLiveEventAtByRuntime(db))
  ]);

  const liveByRuntime = new Map(liveSettings.map((setting) => [setting.runtime, setting]));

  const connectors: HarnessConnectorDto[] = [];

  for (const runtime of LIVE_CONNECTOR_RUNTIMES) {
    const live = liveByRuntime.get(runtime);
    if (!live) {
      // Should not happen: getLiveConnectorSettings covers every LIVE_CONNECTOR_RUNTIMES entry.
      continue;
    }

    const presence = resolvePresence(runtime, config);
    const observedLiveAt = latestByRuntime.get(runtime);
    // Only surface last live event when the harness is actually present — avoids
    // synthetic/settings-test timestamps making missing harnesses look active.
    const lastLiveEventAt = presence === "found" ? observedLiveAt : undefined;

    let storedActivation = await getConnectorActivation(dataDirectory, runtime);

    // Auto-clear host activation once a real live event arrives after the flag was set
    // (e.g. Codex hooks trusted and emitting). Use raw observed time, not display-filtered.
    if (storedActivation && observedLiveAt && isIsoAfter(observedLiveAt, storedActivation.setAt)) {
      await clearConnectorActivation(dataDirectory, runtime);
      storedActivation = undefined;
    }

    // When missingEvents already includes "enabled", deriveLiveStatus maps that to enable_plugin.
    // Prefer store activation when present; otherwise leave deriveLiveStatus to handle enable_plugin.
    const activation = toConnectorActivation(storedActivation);

    let derived = deriveLiveStatus({
      installed: live.installed,
      configExists: live.configExists,
      missingEvents: live.missingEvents,
      mismatchedEvents: live.mismatchedEvents,
      error: live.error,
      activation,
      lastLiveEventAt
    });

    // Harness missing: do not claim Ready just because we wrote a plugin file under its home.
    if (presence === "not_found" && derived.live === "ready") {
      derived = { live: "not_installed" };
    }

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
      lastTest: readRuntimeHookLastTest(db, runtime),
      checkedPaths: presenceCheckedPaths(runtime, config),
      diagnostics: [],
      supportsActions: true,
      historyFound: false,
      historySessionCount: 0
    });
  }

  return {
    generatedAt: now,
    summary: summarizeConnectors(connectors),
    connectors
  };
}

/** Refresh re-scans harness presence + live connector status only (no history import work). */
export async function discoverHarnessConnectors(
  db: MastheadDatabase,
  config: DaemonConfig
): Promise<HarnessConnectorsSnapshotDto> {
  return listHarnessConnectors(db, config);
}

/** Latest live_state_reports.observed_at per runtime (excluding synthetic test sessions). */
export function latestLiveEventAtByRuntime(db: MastheadDatabase): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT runtime AS runtime, MAX(observed_at) AS observedAt
       FROM live_state_reports
       WHERE source_session_id IS NULL
          OR (
            source_session_id NOT LIKE 'masthead-hook-test-%'
            AND source_session_id NOT LIKE 'now-proof-%'
            AND source_session_id NOT LIKE 'masthead-settings-%'
          )
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

/**
 * Presence = harness is installed on this machine.
 * Strong signals only: harness CLI on PATH, or a real home marker (not Masthead-only files).
 * Masthead writing a plugin under ~/.pi (etc.) must NOT count as the harness existing.
 */
export function resolvePresence(runtime: LiveConnectorRuntime, config: DaemonConfig): ConnectorPresence {
  if (harnessBinaryOnPath(runtime)) {
    return "found";
  }

  if (hasRealHarnessHome(runtime, config)) {
    return "found";
  }

  return "not_found";
}

function presenceCheckedPaths(runtime: LiveConnectorRuntime, config: DaemonConfig): string[] {
  const home = resolve(config.codexHomeDir);
  const roots: Partial<Record<LiveConnectorRuntime, string[]>> = {
    codex: [join(home, ".codex")],
    claude_code: [join(home, ".claude")],
    cursor: [join(home, ".cursor")],
    grok: [join(home, ".grok")],
    opencode: [join(home, ".config", "opencode"), join(home, ".local", "share", "opencode")],
    omp: [join(home, ".omp"), join(home, ".oh-my-pi")],
    pi: [join(home, ".pi")],
    hermes: [join(home, ".hermes")]
  };
  return (roots[runtime] ?? []).filter((path) => existsSync(path));
}

function hasRealHarnessHome(runtime: LiveConnectorRuntime, config: DaemonConfig): boolean {
  const home = resolve(config.codexHomeDir);
  if (runtime === "codex") return hasRealCodexHome(config);
  if (runtime === "claude_code") return hasNonMastheadEntries(join(home, ".claude"), { allow: ["projects", "settings.json", "history"] });
  if (runtime === "cursor") return hasNonMastheadEntries(join(home, ".cursor"), { allow: ["projects", "chats", "extensions"] });
  if (runtime === "grok") return hasNonMastheadEntries(join(home, ".grok"), { allow: ["sessions", "hooks"] });
  if (runtime === "opencode") {
    return (
      hasNonMastheadEntries(join(home, ".config", "opencode"), { allow: ["plugins", "config"] }) ||
      hasNonMastheadEntries(join(home, ".local", "share", "opencode"), { allow: ["storage", "sessions"] })
    );
  }
  if (runtime === "omp") {
    return (
      hasNonMastheadEntries(join(home, ".omp"), { allow: ["agent"] }) ||
      hasNonMastheadEntries(join(home, ".oh-my-pi"), { allow: ["agent"] })
    );
  }
  if (runtime === "pi") {
    // ~/.pi/agent/extensions/masthead-live.js alone is NOT Pi installed.
    return hasRealPiHome(join(home, ".pi"));
  }
  if (runtime === "hermes") {
    return hasNonMastheadEntries(join(home, ".hermes"), { allow: ["sessions", "config.yaml", "hermes-agent", "state.db"] });
  }
  return false;
}

function hasNonMastheadEntries(
  root: string,
  options: { allow?: string[]; denyOnlyMasthead?: boolean } = {}
): boolean {
  if (!existsSync(root)) return false;
  try {
    const entries = readdirSync(root);
    if (entries.length === 0) return false;
    const nonMasthead = entries.filter((name) => !name.includes("masthead"));
    if (nonMasthead.length === 0) return false;
    if (options.allow?.length) {
      // Prefer known real harness markers when present.
      if (nonMasthead.some((name) => options.allow!.includes(name))) return true;
    }
    // For shallow homes: any non-masthead entry counts (e.g. sessions dir).
    return nonMasthead.length > 0;
  } catch {
    return false;
  }
}

function harnessBinaryOnPath(runtime: LiveConnectorRuntime): boolean {
  const names = HARNESS_BINARIES[runtime] ?? [];
  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of pathDirs) {
      const candidate = join(dir, name);
      try {
        accessSync(candidate, fsConstants.X_OK);
        return true;
      } catch {
        // try next
      }
    }
  }
  return false;
}

function hasRealCodexHome(config: DaemonConfig): boolean {
  const root = join(resolve(config.codexHomeDir), ".codex");
  if (!existsSync(root)) return false;
  try {
    const entries = readdirSync(root);
    // sessions, config.toml, auth.json, etc. prove Codex itself; hooks.json alone may be ours.
    return entries.some((name) => name !== "hooks.json" && !name.includes("masthead"));
  } catch {
    return false;
  }
}

/** True only when Pi has real install content beyond Masthead's extension install path. */
function hasRealPiHome(root: string): boolean {
  if (!existsSync(root)) return false;
  try {
    const top = readdirSync(root).filter((name) => !name.includes("masthead"));
    if (top.length === 0) return false;
    // Only agent/ with only extensions/masthead* is still not a real Pi install.
    if (top.length === 1 && top[0] === "agent") {
      const agentRoot = join(root, "agent");
      const agentEntries = readdirSync(agentRoot).filter((name) => !name.includes("masthead"));
      if (agentEntries.length === 0) return false;
      if (agentEntries.length === 1 && agentEntries[0] === "extensions") {
        const extRoot = join(agentRoot, "extensions");
        const extEntries = readdirSync(extRoot);
        return extEntries.some((name) => !name.includes("masthead"));
      }
      return true;
    }
    return true;
  } catch {
    return false;
  }
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
