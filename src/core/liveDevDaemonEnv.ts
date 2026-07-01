export type LiveDevDaemonEnvInput = {
  allowedOrigins: string;
  dataDirectory: string;
  diagnosticLogFile: string;
  env: NodeJS.ProcessEnv;
  host: string;
  port: number;
};

export function buildLiveDevDaemonEnv(input: LiveDevDaemonEnvInput): NodeJS.ProcessEnv {
  const env = input.env;
  const legacyLlmCopy = env.MASTHEAD_LLM_COPY;
  return {
    MASTHEAD_ALLOWED_ORIGINS: input.allowedOrigins,
    MASTHEAD_DATA_DIR: input.dataDirectory,
    MASTHEAD_DIAGNOSTIC_LOG_FILE: input.diagnosticLogFile,
    MASTHEAD_GIT_REFRESH_MS: env.MASTHEAD_GIT_REFRESH_MS ?? "0",
    MASTHEAD_HOOK_TRANSCRIPT_CATCHUP: env.MASTHEAD_HOOK_TRANSCRIPT_CATCHUP ?? "1",
    MASTHEAD_HOST: input.host,
    MASTHEAD_LIVE_COPY: env.MASTHEAD_LIVE_COPY ?? legacyLlmCopy ?? (env.OPENAI_API_KEY ? "1" : "0"),
    MASTHEAD_LLM_COPY: legacyLlmCopy ?? "0",
    MASTHEAD_PORT: String(input.port),
    MASTHEAD_REMOTE_ENRICHMENT: env.MASTHEAD_REMOTE_ENRICHMENT ?? legacyLlmCopy ?? "0",
    MASTHEAD_SKIP_BACKGROUND_HYDRATION: env.MASTHEAD_SKIP_BACKGROUND_HYDRATION ?? "1",
    MASTHEAD_SKIP_MIGRATION_QUICK_CHECK: env.MASTHEAD_SKIP_MIGRATION_QUICK_CHECK ?? "1",
    NODE_OPTIONS: env.MASTHEAD_DEV_NODE_OPTIONS ?? ""
  };
}
