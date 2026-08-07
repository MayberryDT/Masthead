import { resolve } from "node:path";
import { homedir } from "node:os";
import { resolveMastheadDataPaths } from "../shared/dataPaths.ts";
import { assertLoopbackBindHost } from "../shared/loopbackHost.ts";

export type DaemonConfig = {
  host: string;
  port: number;
  dataDirectory?: string;
  codexHomeDir: string;
  backgroundHydrationEnabled?: boolean;
  /**
   * Undefined preserves the historical behavior for programmatic/test daemon
   * configurations. Environment-derived production configs set this explicitly.
   */
  legacyWorkbenchBackfillEnabled?: boolean;
  gitRefreshMs: number;
  allowedOrigins: string[];
  fixturePath: string;
  storePath: string;
  databasePath: string;
  legacyDataDirectory?: string;
  llmCopyEnabled: boolean;
  liveCopyEnabled?: boolean;
  /**
   * Whether capture-time live events may run the full deterministic enrichment
   * pipeline. Production keeps capture responsive and leaves this to Workbench.
   */
  liveCaptureEnrichmentEnabled?: boolean;
  /**
   * Whether each live event may reconcile the complete transcript into the
   * Workbench. Production waits for session completion so a busy live session
   * cannot repeatedly rehash its full evidence on the HTTP event loop.
   */
  liveWorkbenchReconciliationOnEveryEvent?: boolean;
  /**
   * Whether live events update the session full-text index immediately.
   * Production defers this until completion so active sessions cannot make
   * the authoring daemon spend its event loop rewriting large FTS documents.
   */
  liveSearchIndexOnEveryEvent?: boolean;
  remoteEnrichmentEnabled?: boolean;
  remoteEnrichmentTimeoutMs?: number;
  liveCopyCacheMs?: number;
  liveCopyTimeoutMs?: number;
  liveCopyProjectionBudgetMs?: number;
  liveCopyMaxConcurrent?: number;
  hookTranscriptCatchupEnabled: boolean;
  openaiApiKey?: string;
  openaiModel?: string;
  skipMigrationQuickCheck?: boolean;
};

export function daemonConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const host = assertLoopbackBindHost(env.MASTHEAD_HOST || "127.0.0.1");
  const configuredPort = Number.parseInt(env.MASTHEAD_PORT || "", 10);
  const configuredGitRefreshMs = Number.parseInt(env.MASTHEAD_GIT_REFRESH_MS || "", 10);
  const productionRuntime = Boolean(env.MASTHEAD_PRODUCTION_ROOT?.trim());
  const dataPaths = resolveMastheadDataPaths({ env });
  const allowedOrigins = (env.MASTHEAD_ALLOWED_ORIGINS || defaultAllowedOrigins().join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const legacyLlmCopy = optionalBoolean(env.MASTHEAD_LLM_COPY);
  const configuredBackgroundHydration = optionalBoolean(env.MASTHEAD_BACKGROUND_HYDRATION);
  const liveCopyEnabled = optionalBoolean(env.MASTHEAD_LIVE_COPY) ?? legacyLlmCopy ?? Boolean(env.OPENAI_API_KEY?.trim());
  const remoteEnrichmentEnabled = optionalBoolean(env.MASTHEAD_REMOTE_ENRICHMENT) ?? legacyLlmCopy ?? false;
  const remoteEnrichmentTimeoutMs = optionalPositiveInteger(env.MASTHEAD_REMOTE_ENRICHMENT_TIMEOUT_MS) ?? 60_000;

  return {
    host,
    port: Number.isFinite(configuredPort) ? configuredPort : 17373,
    dataDirectory: dataPaths.dataDirectory,
    codexHomeDir: resolve(env.MASTHEAD_CODEX_HOME || homedir()),
    backgroundHydrationEnabled: configuredBackgroundHydration ??
      (env.MASTHEAD_SKIP_BACKGROUND_HYDRATION !== "1" && !productionRuntime),
    gitRefreshMs: Number.isFinite(configuredGitRefreshMs) ? configuredGitRefreshMs : (productionRuntime ? 0 : 60_000),
    allowedOrigins,
    fixturePath: resolve("fixtures/v0/replay-three-sessions-board.json"),
    storePath: dataPaths.legacyJournalPath,
    databasePath: dataPaths.databasePath,
    legacyDataDirectory: env.MASTHEAD_LEGACY_DATA_DIR ? resolve(env.MASTHEAD_LEGACY_DATA_DIR) : undefined,
    llmCopyEnabled: liveCopyEnabled,
    liveCopyEnabled,
    liveCaptureEnrichmentEnabled:
      optionalBoolean(env.MASTHEAD_LIVE_CAPTURE_ENRICHMENT) ?? !productionRuntime,
    liveWorkbenchReconciliationOnEveryEvent:
      optionalBoolean(env.MASTHEAD_LIVE_WORKBENCH_RECONCILIATION) ?? !productionRuntime,
    liveSearchIndexOnEveryEvent:
      optionalBoolean(env.MASTHEAD_LIVE_SEARCH_INDEXING) ?? !productionRuntime,
    remoteEnrichmentEnabled,
    remoteEnrichmentTimeoutMs,
    liveCopyCacheMs: optionalPositiveInteger(env.MASTHEAD_LIVE_COPY_CACHE_MS),
    liveCopyTimeoutMs: optionalPositiveInteger(env.MASTHEAD_LIVE_COPY_TIMEOUT_MS),
    liveCopyProjectionBudgetMs: optionalPositiveInteger(env.MASTHEAD_LIVE_COPY_PROJECTION_BUDGET_MS),
    liveCopyMaxConcurrent: optionalPositiveInteger(env.MASTHEAD_LIVE_COPY_MAX_CONCURRENT),
    hookTranscriptCatchupEnabled: optionalBoolean(env.MASTHEAD_HOOK_TRANSCRIPT_CATCHUP) ?? !productionRuntime,
    legacyWorkbenchBackfillEnabled: optionalBoolean(env.MASTHEAD_LEGACY_WORKBENCH_BACKFILL) ?? !productionRuntime,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.MASTHEAD_OPENAI_MODEL,
    skipMigrationQuickCheck: env.MASTHEAD_SKIP_MIGRATION_QUICK_CHECK === "1"
  };
}

function optionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "1") return true;
  if (value === "0") return false;
  return undefined;
}

function optionalPositiveInteger(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function defaultAllowedOrigins(): string[] {
  const origins = new Set<string>(["masthead://app"]);
  for (let port = 5173; port <= 5199; port += 1) {
    origins.add(`http://127.0.0.1:${port}`);
    origins.add(`http://localhost:${port}`);
  }
  return Array.from(origins);
}
