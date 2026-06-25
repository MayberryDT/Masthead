import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  installMastheadHookConfig,
  uninstallMastheadHookConfig,
  verifyMastheadHookConfig,
  type CodexHookConfig,
  type HookEventName
} from "../core/hookAdmin.ts";
import { getDataSummary, type DataSummary } from "./db/dataLifecycleRepository.ts";
import { globalMcpAccessEnabled } from "./db/mcpQueryRepository.ts";
import { listProjects } from "./db/sessionQueryRepository.ts";
import { sourcePolicyEnabled } from "./db/sourcePolicyRepository.ts";
import type { MastheadDatabase } from "./db/sqlite.ts";
import type { DaemonConfig } from "./config.ts";

export type SettingsOptionDto = {
  value: string;
  label: string;
};

export type HookLastTestDto = {
  testedAt: string;
  status: "passed" | "failed";
  message: string;
};

export type CodexHookSettingsDto = {
  configPath: string;
  configExists: boolean;
  installed: boolean;
  missingEvents: HookEventName[];
  mismatchedEvents: HookEventName[];
  command: string;
  endpoint: string;
  latestBackupPath?: string;
  lastEventAt?: string;
  lastTest?: HookLastTestDto;
  error?: string;
};

export type SettingsStateDto = {
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
      status: "complete" | "partial" | "disabled";
    };
  };
  privacy: {
    transcriptImportEnabled: boolean;
    mcpAccessEnabled: boolean;
    redactionEnabled: true;
  };
  storage: {
    databasePath: string;
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

const hookLastTestKey = "codex_hook_last_test";

export async function getSettingsState(db: MastheadDatabase, config: DaemonConfig): Promise<SettingsStateDto> {
  const dataSummary = getDataSummary(db);
  return {
    deletionTargets: deletionTargets(db),
    enrichment: {
      currentEnrichments: dataSummary.enrichments,
      health: enrichmentHealth(db, dataSummary.sessions),
      model: config.openaiModel ?? "deterministic",
      provider: config.llmCopyEnabled && config.openaiApiKey ? "OpenAI" : "Deterministic fallback",
      remoteModelEnabled: Boolean(config.llmCopyEnabled && config.openaiApiKey),
      sessionCount: dataSummary.sessions
    },
    hooks: await getCodexHookSettings(db, config),
    privacy: {
      mcpAccessEnabled: globalMcpAccessEnabled(db),
      redactionEnabled: true,
      transcriptImportEnabled: sourcePolicyEnabled(db, "transcript_import")
    },
    storage: {
      dataSummary,
      databasePath: config.databasePath,
      storePath: config.storePath
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
    queued: Math.max(0, sessionCount - complete - failed - disabled),
    status: sessionCount === 0 || complete >= sessionCount ? "complete" : disabled >= sessionCount ? "disabled" : "partial"
  };
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
    return {
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
    };
  } catch (error) {
    return {
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
    };
  }
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

export async function testCodexHooks(db: MastheadDatabase, config: DaemonConfig): Promise<CodexHookSettingsDto> {
  const settings = await getCodexHookSettings(db, config);
  const lastTest: HookLastTestDto = {
    message: settings.installed ? "Codex hooks file contains the expected Masthead hook command." : "Masthead hook entries are not fully installed.",
    status: settings.installed ? "passed" : "failed",
    testedAt: new Date().toISOString()
  };
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
