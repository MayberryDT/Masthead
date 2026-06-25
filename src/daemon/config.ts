import { resolve } from "node:path";
import { homedir } from "node:os";
import { resolveMastheadDataPaths } from "../shared/dataPaths.ts";

export type DaemonConfig = {
  host: string;
  port: number;
  dataDirectory?: string;
  codexHomeDir: string;
  gitRefreshMs: number;
  allowedOrigins: string[];
  fixturePath: string;
  storePath: string;
  databasePath: string;
  llmCopyEnabled: boolean;
  openaiApiKey?: string;
  openaiModel?: string;
};

export function daemonConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const host = env.MASTHEAD_HOST || "127.0.0.1";
  const configuredPort = Number.parseInt(env.MASTHEAD_PORT || "", 10);
  const configuredGitRefreshMs = Number.parseInt(env.MASTHEAD_GIT_REFRESH_MS || "", 10);
  const dataPaths = resolveMastheadDataPaths({ env });
  const allowedOrigins = (env.MASTHEAD_ALLOWED_ORIGINS || [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "tauri://localhost",
    "http://tauri.localhost"
  ].join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    host,
    port: Number.isFinite(configuredPort) ? configuredPort : 17373,
    dataDirectory: dataPaths.dataDirectory,
    codexHomeDir: resolve(env.MASTHEAD_CODEX_HOME || homedir()),
    gitRefreshMs: Number.isFinite(configuredGitRefreshMs) ? configuredGitRefreshMs : 5_000,
    allowedOrigins,
    fixturePath: resolve("fixtures/v0/replay-three-sessions-board.json"),
    storePath: dataPaths.legacyJournalPath,
    databasePath: dataPaths.databasePath,
    llmCopyEnabled: env.MASTHEAD_LLM_COPY === "1",
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.MASTHEAD_OPENAI_MODEL
  };
}
