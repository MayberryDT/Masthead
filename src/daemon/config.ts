import { resolve } from "node:path";
import { homedir } from "node:os";
import { resolveMastheadDataPaths } from "../shared/dataPaths.ts";

export type DaemonConfig = {
  host: string;
  port: number;
  dataDirectory?: string;
  codexHomeDir: string;
  backgroundHydrationEnabled?: boolean;
  gitRefreshMs: number;
  allowedOrigins: string[];
  fixturePath: string;
  storePath: string;
  databasePath: string;
  legacyDataDirectory?: string;
  llmCopyEnabled: boolean;
  hookTranscriptCatchupEnabled: boolean;
  openaiApiKey?: string;
  openaiModel?: string;
};

export function daemonConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const host = env.MASTHEAD_HOST || "127.0.0.1";
  const configuredPort = Number.parseInt(env.MASTHEAD_PORT || "", 10);
  const configuredGitRefreshMs = Number.parseInt(env.MASTHEAD_GIT_REFRESH_MS || "", 10);
  const dataPaths = resolveMastheadDataPaths({ env });
  const allowedOrigins = (env.MASTHEAD_ALLOWED_ORIGINS || defaultAllowedOrigins().join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    host,
    port: Number.isFinite(configuredPort) ? configuredPort : 17373,
    dataDirectory: dataPaths.dataDirectory,
    codexHomeDir: resolve(env.MASTHEAD_CODEX_HOME || homedir()),
    backgroundHydrationEnabled: env.MASTHEAD_BACKGROUND_HYDRATION !== "0",
    gitRefreshMs: Number.isFinite(configuredGitRefreshMs) ? configuredGitRefreshMs : 60_000,
    allowedOrigins,
    fixturePath: resolve("fixtures/v0/replay-three-sessions-board.json"),
    storePath: dataPaths.legacyJournalPath,
    databasePath: dataPaths.databasePath,
    legacyDataDirectory: env.MASTHEAD_LEGACY_DATA_DIR ? resolve(env.MASTHEAD_LEGACY_DATA_DIR) : undefined,
    llmCopyEnabled: env.MASTHEAD_LLM_COPY === "1",
    hookTranscriptCatchupEnabled: env.MASTHEAD_HOOK_TRANSCRIPT_CATCHUP !== "0",
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.MASTHEAD_OPENAI_MODEL
  };
}

function defaultAllowedOrigins(): string[] {
  const origins = new Set<string>(["masthead://app"]);
  for (let port = 5173; port <= 5199; port += 1) {
    origins.add(`http://127.0.0.1:${port}`);
    origins.add(`http://localhost:${port}`);
  }
  return Array.from(origins);
}
