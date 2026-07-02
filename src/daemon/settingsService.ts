import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  installMastheadHookConfig,
  uninstallMastheadHookConfig,
  verifyMastheadHookConfig,
  type CodexHookConfig,
  type HookEventName
} from "../core/hookAdmin.ts";
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
};

export type CodexHookSettingsDto = {
  configPath: string;
  configExists: boolean;
  installed: boolean;
  missingEvents: HookEventName[];
  mismatchedEvents: HookEventName[];
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

type HooksConfigRead = {
  config: CodexHookConfig;
  existed: boolean;
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
  const configPath = codexHooksPath(config);
  const command = hookCommand(config);
  const endpoint = ingestEndpoint(config);
  const latestBackupPath = await latestHookBackupPath(configPath).catch(() => undefined);
  const lastTest = readHookLastTest(db);
  const lastEventAt = latestRawHookEventAt(db);

  try {
    const { config: hookConfig, existed } = await readHooksConfig(configPath, { allowMissing: true });
    const verification = verifyMastheadHookConfig(hookConfig, { command });
    return withHarnessCaptureIntegrations({
      command,
      configExists: existed,
      configPath,
      endpoint,
      installed: verification.installed,
      lastEventAt,
      lastTest,
      latestBackupPath,
      mismatchedEvents: verification.mismatchedEvents,
      missingEvents: verification.missingEvents
    });
  } catch (error) {
    return withHarnessCaptureIntegrations({
      command,
      configExists: false,
      configPath,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
      installed: false,
      lastEventAt,
      lastTest,
      latestBackupPath,
      mismatchedEvents: [],
      missingEvents: []
    });
  }
}

function withHarnessCaptureIntegrations(settings: CodexHookSettingsBaseDto): CodexHookSettingsDto {
  return {
    ...settings,
    integrations: scanTargetHarnesses().map((entry) => harnessCaptureIntegration(entry, settings))
  };
}

function harnessCaptureIntegration(entry: HarnessCatalogEntry, codexSettings: CodexHookSettingsBaseDto): HarnessCaptureIntegrationDto {
  if (entry.runtime === "codex") {
    return {
      actionSurface: "settings",
      captureMode: "live_hook",
      configPath: codexSettings.configPath,
      description: "Live local hook events are installed, tested, and removed from this Settings card.",
      label: entry.label,
      runtime: entry.runtime,
      status: codexCaptureStatus(codexSettings),
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

function codexCaptureStatus(settings: CodexHookSettingsBaseDto): HarnessCaptureStatus {
  if (settings.error) return "needs_repair";
  if (settings.installed && settings.missingEvents.length === 0 && settings.mismatchedEvents.length === 0) return "installed";
  if (settings.configExists) return "needs_repair";
  return "not_installed";
}

export async function installCodexHooks(db: MastheadDatabase, config: DaemonConfig): Promise<CodexHookSettingsDto> {
  const configPath = codexHooksPath(config);
  const { config: hookConfig, existed } = await readHooksConfig(configPath, { allowMissing: true });
  if (existed) await createHookBackup(configPath, "install");
  await writeHooksConfig(configPath, installMastheadHookConfig(hookConfig, { command: hookCommand(config), timeout: 1 }));
  return getCodexHookSettings(db, config);
}

export async function uninstallCodexHooks(db: MastheadDatabase, config: DaemonConfig): Promise<CodexHookSettingsDto> {
  const configPath = codexHooksPath(config);
  const { config: hookConfig, existed } = await readHooksConfig(configPath, { allowMissing: true });
  if (existed) await createHookBackup(configPath, "uninstall");
  await writeHooksConfig(configPath, uninstallMastheadHookConfig(hookConfig));
  return getCodexHookSettings(db, config);
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
      message: "Masthead hook entries are not fully installed, so the round-trip test was not run.",
      status: "failed",
      testedAt: new Date().toISOString()
    };
  } else {
    lastTest = await runHookRoundTrip(config, options.endpoint);
  }

  writeHookLastTest(db, lastTest);
  return getCodexHookSettings(db, config);
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

function codexHooksPath(config: DaemonConfig): string {
  return resolve(process.env.MASTHEAD_CODEX_HOOKS || join(config.codexHomeDir, ".codex", "hooks.json"));
}

function hookCommand(config: DaemonConfig): string {
  const scriptPath = resolve(process.env.MASTHEAD_HOOK_SCRIPT || "scripts/masthead-hook.js");
  return `MASTHEAD_INGEST_URL=${ingestEndpoint(config)} MASTHEAD_HOOK_TIMEOUT_MS=750 ${quoteShell(process.execPath)} ${quoteShell(scriptPath)}`;
}

function ingestEndpoint(config: DaemonConfig): string {
  return `http://${config.host}:${config.port}/ingest`;
}

async function readHooksConfig(configPath: string, options: { allowMissing: boolean }): Promise<HooksConfigRead> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT") && options.allowMissing) return { config: {}, existed: false };
    throw error;
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Hook config must contain a JSON object: ${configPath}`);
  }
  return { config: parsed as CodexHookConfig, existed: true };
}

async function writeHooksConfig(configPath: string, config: CodexHookConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  const mode = await targetMode(configPath);
  const tmpPath = join(dirname(configPath), `.${configPath.split("/").at(-1)}.masthead-tmp-${backupStamp()}.json`);
  await writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await chmod(tmpPath, mode);
  await rename(tmpPath, configPath);
}

async function createHookBackup(configPath: string, operation: string): Promise<string> {
  await assertRegularHookFile(configPath);
  const backupPath = `${configPath}.masthead-backup-${backupStamp()}-${operation}.json`;
  await copyFile(configPath, backupPath);
  return backupPath;
}

async function latestHookBackupPath(configPath: string): Promise<string | undefined> {
  const dir = dirname(configPath);
  const prefix = `${configPath.split("/").at(-1)}.masthead-backup-`;
  const entries = await readdir(dir, { withFileTypes: true });
  const backups = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const path = join(dir, entry.name);
        const info = await stat(path);
        return { path, mtimeMs: info.mtimeMs, name: entry.name };
      })
  );
  backups.sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
  return backups[0]?.path;
}

async function targetMode(configPath: string): Promise<number> {
  try {
    const info = await lstat(configPath);
    if (info.isSymbolicLink()) throw new Error(`Refusing to mutate symlinked hook config: ${configPath}`);
    if (!info.isFile()) throw new Error(`Hook config path is not a regular file: ${configPath}`);
    return info.mode & 0o777;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return 0o600;
    throw error;
  }
}

async function assertRegularHookFile(configPath: string): Promise<void> {
  const info = await lstat(configPath);
  if (info.isSymbolicLink()) throw new Error(`Refusing to mutate symlinked hook config: ${configPath}`);
  if (!info.isFile()) throw new Error(`Hook config path is not a regular file: ${configPath}`);
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

async function runHookRoundTrip(config: DaemonConfig, endpoint = ingestEndpoint(config)): Promise<HookLastTestDto> {
  const testedAt = new Date().toISOString();
  const sourceEventId = `masthead-settings-hook-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const response = await fetch(endpoint, {
      body: JSON.stringify({
        cwd: process.cwd(),
        event: "session_started",
        provider_event_id: sourceEventId,
        session_id: `masthead-hook-test-${sourceEventId}`,
        source: "masthead-settings",
        timestamp: testedAt
      }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const body = (await response.json().catch(() => undefined)) as { status?: string } | undefined;
    if (!response.ok) {
      return {
        message: `Hook round-trip failed: ingest endpoint returned ${response.status}.`,
        status: "failed",
        testedAt
      };
    }
    return {
      message:
        body?.status === "accepted"
          ? "Hook round-trip passed: Masthead accepted a synthetic Codex lifecycle event."
          : `Hook round-trip reached Masthead, but ingest reported ${body?.status ?? "an unknown status"}.`,
      status: body?.status === "accepted" ? "passed" : "failed",
      testedAt
    };
  } catch (error) {
    return {
      message: `Hook round-trip failed: ${error instanceof Error ? error.message : String(error)}`,
      status: "failed",
      testedAt
    };
  }
}

function latestRawHookEventAt(db: MastheadDatabase): string | undefined {
  const row = db.prepare("SELECT MAX(observed_at) AS observedAt FROM raw_events").get() as { observedAt: string | null };
  return row.observedAt ?? undefined;
}

function backupStamp(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${process.hrtime.bigint()}`;
}

function quoteShell(value: string): string {
  if (!/[\s"'$`\\]/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
