import { resolve } from "node:path";
import { homedir } from "node:os";

export type DaemonConfig = {
  host: string;
  port: number;
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
    codexHomeDir: resolve(env.MASTHEAD_CODEX_HOME || homedir()),
    gitRefreshMs: Number.isFinite(configuredGitRefreshMs) ? configuredGitRefreshMs : 5_000,
    allowedOrigins,
    fixturePath: resolve("fixtures/v0/replay-three-sessions-board.json"),
    storePath: resolve(env.MASTHEAD_STORE_PATH || ".masthead/events.ndjson"),
    databasePath: resolve(env.MASTHEAD_DB_PATH || ".masthead/masthead.sqlite"),
    llmCopyEnabled: env.MASTHEAD_LLM_COPY === "1",
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.MASTHEAD_OPENAI_MODEL
  };
}
