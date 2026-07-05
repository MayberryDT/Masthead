import { dirname, resolve } from "node:path";
import { scanTargetHarnesses, type HarnessCatalogEntry } from "../adapters/harnessCatalog.ts";
import type { RuntimeKind } from "../adapters/types.ts";
import { getDataSummary, type DataSummary } from "./db/dataLifecycleRepository.ts";
import { globalMcpAccessEnabled } from "./db/mcpQueryRepository.ts";
import { CURRENT_SCHEMA_VERSION, getOrCreateDatabaseIdentity } from "./db/schema.ts";
import { listProjects } from "./db/sessionQueryRepository.ts";
import { sourcePolicyEnabled } from "./db/sourcePolicyRepository.ts";
import type { MastheadDatabase } from "./db/sqlite.ts";
import type { DaemonConfig } from "./config.ts";
import { isWeakSessionTitle } from "../shared/sessionTextQuality.ts";
import { effectiveLlmProvider, getLlmProviderSettings, type LlmProviderSettingsDto } from "./llmSettings.ts";
import {
  baseIngestEndpoint,
  getLiveConnectorSetting,
  getLiveConnectorSettings,
  installLiveConnector,
  installLiveConnectors,
  latestLiveConnectorBackupPath,
  LIVE_CONNECTOR_RUNTIMES,
  runLiveConnectorRoundTrip,
  uninstallLiveConnector,
  uninstallLiveConnectors,
  type LiveConnectorRuntime,
  type LiveConnectorSettings
} from "./liveConnectorSettings.ts";

export type SettingsOptionDto = {
  value: string;
  label: string;
};

export type HookLastTestDto = {
  testedAt: string;
  status: "passed" | "failed";
  message: string;
};

export type HarnessCaptureMode = "live_hook" | "transcript_import" | "metadata_import" | "source_discovery";
export type HarnessCaptureStatus = "installed" | "needs_repair" | "not_installed" | "managed_in_sources" | "discovery_only";
export type HarnessCaptureActionSurface = "settings" | "sources";

export type HarnessCaptureIntegrationDto = {
  runtime: RuntimeKind;
  label: string;
  captureMode: HarnessCaptureMode;
  status: HarnessCaptureStatus;
  actionSurface: HarnessCaptureActionSurface;
  supportsActions: boolean;
  description: string;
  configPath?: string;
  endpoint?: string;
};

export type CodexHookSettingsDto = {
  configPath: string;
  configExists: boolean;
  installed: boolean;
  missingEvents: string[];
  mismatchedEvents: string[];
  integrations: HarnessCaptureIntegrationDto[];
  command: string;
  endpoint: string;
  latestBackupPath?: string;
  lastEventAt?: string;
  lastTest?: HookLastTestDto;
  error?: string;
};

export type SettingsRuntimeIdentityDto = {
  product: "masthead";
  apiVersion: 1;
  schemaVersion: number;
  runtime: {
    mode: "primary";
    writable: true;
    host: string;
    port: number;
  };
  data: {
    databaseId: string;
    databasePath: string;
    dataDirectory: string;
    migrationState: "ready";
    storePath: string;
  };
  capabilities: string[];
};

export type SettingsStateDto = SettingsRuntimeIdentityDto & {
  hooks: CodexHookSettingsDto;
  enrichment: {
    provider: string;
    remoteModelEnabled: boolean;
    model: string;
    currentEnrichments: number;
    sessionCount: number;
    health: {
      complete: number;
      queued: number;
      failed: number;
      disabled: number;
      gitSnapshotsWithoutFileEffects?: number;
      repeatedFailedFingerprints?: number;
      sessionsWithMessagesButNoEffects?: number;
      status: "complete" | "partial" | "disabled";
      weakCurrentTitles?: number;
    };
  };
  llm: LlmProviderSettingsDto;
  privacy: {
    transcriptImportEnabled: boolean;
    mcpAccessEnabled: boolean;
    redactionEnabled: true;
  };
  storage: {
    databasePath: string;
    dataDirectory: string;
    storePath: string;
    dataSummary: DataSummary;
  };
  deletionTargets: {
    projects: SettingsOptionDto[];
    runtimes: SettingsOptionDto[];
    hosts: SettingsOptionDto[];
  };
};

type CodexHookSettingsBaseDto = Omit<CodexHookSettingsDto, "integrations">;

const hookLastTestKey = "codex_hook_last_test";

export function settingsRuntimeIdentity(config: DaemonConfig, db: MastheadDatabase): SettingsRuntimeIdentityDto {
  const databasePath = resolve(config.databasePath);
  const dataDirectory = dirname(databasePath);
  return {
    apiVersion: 1,
    capabilities: [
      "live_projection",
      "canonical_sessions",
      "logbook_search",
      "source_discovery",
      "adapter_inventory",
      "import_jobs",
      "mcp_status",
      "usage_stats",
      "settings",
      "data_lifecycle"
    ],
    schemaVersion: CURRENT_SCHEMA_VERSION,
    data: {
      databaseId: getOrCreateDatabaseIdentity(db),
      databasePath,
      dataDirectory,
      migrationState: "ready",
      storePath: resolve(config.storePath)
    },
    product: "masthead",
    runtime: {
      host: config.host,
      mode: "primary",
      port: config.port,
      writable: true
    }
  };
}

export async function getSettingsState(db: MastheadDatabase, config: DaemonConfig): Promise<SettingsStateDto> {
  const dataSummary = getDataSummary(db);
  const identity = settingsRuntimeIdentity(config, db);
  const llm = getLlmProviderSettings(db, config);
  const effectiveProvider = effectiveLlmProvider(db, config);
  const remoteModelEnabled = effectiveProvider.remoteEnrichmentEnabled && effectiveProvider.configured;
  return {
    ...identity,
    deletionTargets: deletionTargets(db),
    enrichment: {
      currentEnrichments: dataSummary.enrichments,
      health: enrichmentHealth(db, dataSummary.sessions),
      model: remoteModelEnabled ? effectiveProvider.model : effectiveProvider.remoteEnrichmentEnabled ? effectiveProvider.model || "Not configured" : "deterministic",
      provider: effectiveProvider.remoteEnrichmentEnabled ? effectiveProvider.label : "Deterministic fallback",
      remoteModelEnabled,
      sessionCount: dataSummary.sessions
    },
    hooks: await getCodexHookSettings(db, config),
    llm,
    privacy: {
      mcpAccessEnabled: globalMcpAccessEnabled(db),
      redactionEnabled: true,
      transcriptImportEnabled: sourcePolicyEnabled(db, "transcript_import")
    },
    storage: {
      dataDirectory: identity.data.dataDirectory,
      dataSummary,
      databasePath: identity.data.databasePath,
      storePath: identity.data.storePath
    }
  };
}

function enrichmentHealth(db: MastheadDatabase, sessionCount: number): SettingsStateDto["enrichment"]["health"] {
  const complete = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT session_id) AS count
        FROM session_enrichments
        WHERE enrichment_kind = 'session_capsule'
          AND status = 'current'`
      )
      .get() as { count: number }
  ).count;
  const failed = (
    db.prepare("SELECT COUNT(*) AS count FROM session_enrichments WHERE status = 'failed'").get() as { count: number }
  ).count;
  const disabled = (
    db.prepare("SELECT COUNT(*) AS count FROM session_enrichments WHERE status = 'disabled'").get() as { count: number }
  ).count;
  return {
    complete,
    disabled,
    failed,
    gitSnapshotsWithoutFileEffects: gitSnapshotsWithoutFileEffects(db),
    queued: Math.max(0, sessionCount - complete - failed - disabled),
    repeatedFailedFingerprints: repeatedFailedFingerprints(db),
    sessionsWithMessagesButNoEffects: sessionsWithMessagesButNoEffects(db),
    status: sessionCount === 0 || complete >= sessionCount ? "complete" : disabled >= sessionCount ? "disabled" : "partial",
    weakCurrentTitles: weakCurrentTitles(db)
  };
}

function weakCurrentTitles(db: MastheadDatabase): number {
  const rows = db
    .prepare(
      `SELECT
        sessions.session_id AS sessionId,
        sessions.source_session_id AS sourceSessionId,
        sessions.project_label AS project,
        session_enrichments.content_json AS contentJson
      FROM session_enrichments
      JOIN sessions ON sessions.session_id = session_enrichments.session_id
      WHERE session_enrichments.enrichment_kind = 'session_capsule'
        AND session_enrichments.status = 'current'`
    )
    .all() as Array<{ contentJson: string | null; project: string | null; sessionId: string; sourceSessionId: string }>;
  return rows.filter((row) => {
    const content = parseJson(row.contentJson);
    const title = isRecord(content) && typeof content.title === "string" ? content.title : undefined;
    return isWeakSessionTitle(title, {
      project: row.project ?? undefined,
      sessionId: row.sessionId,
      sourceSessionId: row.sourceSessionId
    });
  }).length;
}

function sessionsWithMessagesButNoEffects(db: MastheadDatabase): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS count
        FROM sessions
        WHERE deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM messages WHERE messages.session_id = sessions.session_id)
          AND NOT EXISTS (SELECT 1 FROM file_effects WHERE file_effects.session_id = sessions.session_id)`
      )
      .get() as { count: number }
  ).count;
}

function repeatedFailedFingerprints(db: MastheadDatabase): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS count
        FROM (
          SELECT session_id, enrichment_kind, prompt_version, content_fingerprint
          FROM session_enrichments
          WHERE status = 'failed'
          GROUP BY session_id, enrichment_kind, prompt_version, content_fingerprint
          HAVING COUNT(*) > 1
        )`
      )
      .get() as { count: number }
  ).count;
}

function gitSnapshotsWithoutFileEffects(db: MastheadDatabase): number {
  const gitSnapshots = (
    db.prepare("SELECT COUNT(*) AS count FROM raw_events WHERE source_id = 'masthead-git-observer'").get() as { count: number }
  ).count;
  if (gitSnapshots === 0) return 0;
  const gitFileEffects = (
    db.prepare("SELECT COUNT(*) AS count FROM file_effects WHERE source_ref_json LIKE '%git_snapshot%'").get() as { count: number }
  ).count;
  return Math.max(0, gitSnapshots - gitFileEffects);
}

function parseJson(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function getCodexHookSettings(db: MastheadDatabase, config: DaemonConfig): Promise<CodexHookSettingsDto> {
  const connectors = await getLiveConnectorSettings(config);
  const codexConnector = connectorByRuntime(connectors, "codex");
  const latestBackupPath = (await latestLiveConnectorBackupPath(config)) ?? codexConnector.latestBackupPath;
  const lastTest = readHookLastTest(db);
  const lastEventAt = latestRawHookEventAt(db);

  return withHarnessCaptureIntegrations(
    {
      command: codexConnector.command,
      configExists: connectors.some((connector) => connector.configExists),
      configPath: codexConnector.configPath,
      endpoint: baseIngestEndpoint(config),
      error: connectors.find((connector) => connector.error)?.error,
      installed: connectors.every((connector) => connector.installed),
      lastEventAt,
      lastTest,
      latestBackupPath,
      mismatchedEvents: connectorEvents(connectors, "mismatchedEvents"),
      missingEvents: connectorEvents(connectors, "missingEvents")
    },
    connectors
  );
}

export async function getRuntimeHookSettings(db: MastheadDatabase, config: DaemonConfig, runtime: LiveConnectorRuntime): Promise<CodexHookSettingsDto> {
  const connectors = await getLiveConnectorSettings(config);
  const connector = connectorByRuntime(connectors, runtime);
  return hookSettingsForConnector(db, connector, connectors);
}

function withHarnessCaptureIntegrations(settings: CodexHookSettingsBaseDto, connectors: LiveConnectorSettings[]): CodexHookSettingsDto {
  return {
    ...settings,
    integrations: scanTargetHarnesses().map((entry) => harnessCaptureIntegration(entry, connectors))
  };
}

function harnessCaptureIntegration(entry: HarnessCatalogEntry, connectors: LiveConnectorSettings[]): HarnessCaptureIntegrationDto {
  const connector = connectors.find((item) => item.runtime === entry.runtime);
  if (connector) {
    return {
      actionSurface: "settings",
      captureMode: "live_hook",
      configPath: connector.configPath,
      description: `Live local ${entry.label} events are installed, tested, and removed from this Settings card.`,
      endpoint: connector.endpoint,
      label: entry.label,
      runtime: entry.runtime,
      status: connectorCaptureStatus(connector),
      supportsActions: true
    };
  }

  const captureMode = harnessCaptureMode(entry);
  const status: HarnessCaptureStatus = captureMode === "source_discovery" ? "discovery_only" : "managed_in_sources";
  return {
    actionSurface: "sources",
    captureMode,
    description: harnessCaptureDescription(entry, captureMode),
    label: entry.label,
    runtime: entry.runtime,
    status,
    supportsActions: false
  };
}

function harnessCaptureMode(entry: HarnessCatalogEntry): HarnessCaptureMode {
  if (entry.runtimeStatus === "scan_target") return "source_discovery";
  if (entry.supportLevel === "active_metadata") return "metadata_import";
  if (entry.supportLevel === "active_full" || entry.supportLevel === "active_transcript") return "transcript_import";
  return "metadata_import";
}

function harnessCaptureDescription(entry: HarnessCatalogEntry, captureMode: HarnessCaptureMode): string {
  if (captureMode === "source_discovery") {
    return `Masthead can discover likely ${entry.label} local state in Sources. A full import or live hook adapter is not wired yet.`;
  }
  if (captureMode === "metadata_import") {
    return `Imported from local ${entry.label} session metadata through Sources.`;
  }
  return `Imported from local ${entry.label} transcript history through Sources.`;
}

function connectorCaptureStatus(settings: Pick<LiveConnectorSettings, "configExists" | "error" | "installed" | "mismatchedEvents" | "missingEvents">): HarnessCaptureStatus {
  if (settings.error) return "needs_repair";
  if (settings.installed && settings.missingEvents.length === 0 && settings.mismatchedEvents.length === 0) return "installed";
  if (settings.configExists) return "needs_repair";
  return "not_installed";
}

export async function installCodexHooks(db: MastheadDatabase, config: DaemonConfig): Promise<CodexHookSettingsDto> {
  await installLiveConnectors(config);
  return getCodexHookSettings(db, config);
}

export async function installRuntimeHooks(db: MastheadDatabase, config: DaemonConfig, runtime: LiveConnectorRuntime): Promise<CodexHookSettingsDto> {
  await installLiveConnector(config, runtime);
  return getRuntimeHookSettings(db, config, runtime);
}

export async function uninstallCodexHooks(db: MastheadDatabase, config: DaemonConfig): Promise<CodexHookSettingsDto> {
  await uninstallLiveConnectors(config);
  return getCodexHookSettings(db, config);
}

export async function uninstallRuntimeHooks(db: MastheadDatabase, config: DaemonConfig, runtime: LiveConnectorRuntime): Promise<CodexHookSettingsDto> {
  await uninstallLiveConnector(config, runtime);
  return getRuntimeHookSettings(db, config, runtime);
}

export async function testCodexHooks(
  db: MastheadDatabase,
  config: DaemonConfig,
  options: { endpoint?: string } = {}
): Promise<CodexHookSettingsDto> {
  const settings = await getCodexHookSettings(db, config);
  let lastTest: HookLastTestDto;

  if (!settings.installed) {
    lastTest = {
      message: "Masthead live connector entries are not fully installed, so the round-trip test was not run.",
      status: "failed",
      testedAt: new Date().toISOString()
    };
  } else {
    lastTest = await runLiveConnectorRoundTrip(config, { endpoint: options.endpoint, runtimes: LIVE_CONNECTOR_RUNTIMES });
  }

  writeHookLastTest(db, lastTest);
  return getCodexHookSettings(db, config);
}

export async function testRuntimeHooks(
  db: MastheadDatabase,
  config: DaemonConfig,
  runtime: LiveConnectorRuntime,
  options: { endpoint?: string } = {}
): Promise<CodexHookSettingsDto> {
  const settings = await getRuntimeHookSettings(db, config, runtime);
  let lastTest: HookLastTestDto;

  if (!settings.installed) {
    const connector = await getLiveConnectorSetting(config, runtime);
    lastTest = {
      message: `${connector.label} live connector entries are not fully installed, so the round-trip test was not run.`,
      status: "failed",
      testedAt: new Date().toISOString()
    };
  } else {
    lastTest = await runLiveConnectorRoundTrip(config, { endpoint: options.endpoint, runtimes: [runtime] });
  }

  writeHookLastTest(db, lastTest);
  return getRuntimeHookSettings(db, config, runtime);
}

function deletionTargets(db: MastheadDatabase): SettingsStateDto["deletionTargets"] {
  return {
    hosts: uniqueOptions(
      (
        db
          .prepare(
            `SELECT COALESCE(hostname, host_id) AS value
            FROM hosts
            ORDER BY value`
          )
          .all() as Array<{ value: string | null }>
      ).map((row) => row.value)
    ),
    projects: listProjects(db).map((project) => ({
      label: project.project,
      value: project.project
    })),
    runtimes: uniqueOptions(
      (
        db
          .prepare(
            `SELECT runtime_kind AS value
            FROM runtimes
            ORDER BY runtime_kind`
          )
          .all() as Array<{ value: string | null }>
      ).map((row) => row.value)
    )
  };
}

function uniqueOptions(values: Array<string | null | undefined>): SettingsOptionDto[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).map((value) => ({ label: value, value }));
}

function writeHookLastTest(db: MastheadDatabase, input: HookLastTestDto): void {
  db.prepare(
    `INSERT INTO app_settings (setting_key, setting_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET
      setting_json = excluded.setting_json,
      updated_at = excluded.updated_at`
  ).run(hookLastTestKey, JSON.stringify(input), input.testedAt);
}

function readHookLastTest(db: MastheadDatabase): HookLastTestDto | undefined {
  const row = db.prepare("SELECT setting_json AS value FROM app_settings WHERE setting_key = ?").get(hookLastTestKey) as
    | { value: string }
    | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as HookLastTestDto;
  } catch {
    return undefined;
  }
}

function latestRawHookEventAt(db: MastheadDatabase): string | undefined {
  const row = db.prepare("SELECT MAX(observed_at) AS observedAt FROM raw_events").get() as { observedAt: string | null };
  return row.observedAt ?? undefined;
}

function hookSettingsForConnector(
  db: MastheadDatabase,
  connector: LiveConnectorSettings,
  connectors: LiveConnectorSettings[]
): CodexHookSettingsDto {
  const lastTest = readHookLastTest(db);
  const lastEventAt = latestRawHookEventAt(db);
  return withHarnessCaptureIntegrations(
    {
      command: connector.command,
      configExists: connector.configExists,
      configPath: connector.configPath,
      endpoint: connector.endpoint,
      error: connector.error,
      installed: connector.installed,
      lastEventAt,
      lastTest,
      latestBackupPath: connector.latestBackupPath,
      mismatchedEvents: connector.mismatchedEvents,
      missingEvents: connector.missingEvents
    },
    connectors
  );
}

function connectorByRuntime(connectors: LiveConnectorSettings[], runtime: RuntimeKind): LiveConnectorSettings {
  const connector = connectors.find((item) => item.runtime === runtime);
  if (!connector) throw new Error(`Missing live connector settings for ${runtime}`);
  return connector;
}

function connectorEvents(connectors: LiveConnectorSettings[], key: "mismatchedEvents" | "missingEvents"): string[] {
  return connectors.flatMap((connector) => connector[key].map((eventName) => `${connector.runtime}:${eventName}`));
}
