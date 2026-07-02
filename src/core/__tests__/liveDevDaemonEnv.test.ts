import { describe, expect, test } from "vitest";
import { buildLiveDevDaemonEnv } from "../liveDevDaemonEnv";

const baseInput = {
  allowedOrigins: "http://127.0.0.1:5173",
  dataDirectory: "/tmp/masthead-data",
  diagnosticLogFile: "/tmp/masthead-data/runtime/daemon.log",
  host: "127.0.0.1",
  port: 17373
};

describe("live dev daemon environment", () => {
  test("enables hook transcript catch-up by default", () => {
    const env = buildLiveDevDaemonEnv({ ...baseInput, env: {} });

    expect(env.MASTHEAD_HOOK_TRANSCRIPT_CATCHUP).toBe("1");
  });

  test("keeps explicit hook transcript catch-up opt-out", () => {
    const env = buildLiveDevDaemonEnv({
      ...baseInput,
      env: { MASTHEAD_HOOK_TRANSCRIPT_CATCHUP: "0" }
    });

    expect(env.MASTHEAD_HOOK_TRANSCRIPT_CATCHUP).toBe("0");
  });

  test("preserves existing responsive dev defaults", () => {
    const env = buildLiveDevDaemonEnv({ ...baseInput, env: {} });

    expect(env).toMatchObject({
      MASTHEAD_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
      MASTHEAD_DATA_DIR: "/tmp/masthead-data",
      MASTHEAD_DIAGNOSTIC_LOG_FILE: "/tmp/masthead-data/runtime/daemon.log",
      MASTHEAD_GIT_REFRESH_MS: "0",
      MASTHEAD_HOST: "127.0.0.1",
      MASTHEAD_LIVE_COPY: "0",
      MASTHEAD_LLM_COPY: "0",
      MASTHEAD_PORT: "17373",
      MASTHEAD_REMOTE_ENRICHMENT: "0",
      MASTHEAD_SKIP_BACKGROUND_HYDRATION: "1",
      MASTHEAD_SKIP_MIGRATION_QUICK_CHECK: "1"
    });
  });

  test("enables live headline by default when an OpenAI key is inherited", () => {
    const env = buildLiveDevDaemonEnv({
      ...baseInput,
      env: { OPENAI_API_KEY: "sk-test" }
    });

    expect(env.MASTHEAD_LIVE_COPY).toBe("1");
    expect(env.MASTHEAD_LLM_COPY).toBe("0");
    expect(env.MASTHEAD_REMOTE_ENRICHMENT).toBe("0");
  });

  test("keeps legacy live headline opt-out when an OpenAI key is inherited", () => {
    const env = buildLiveDevDaemonEnv({
      ...baseInput,
      env: { OPENAI_API_KEY: "sk-test", MASTHEAD_LLM_COPY: "0" }
    });

    expect(env.MASTHEAD_LIVE_COPY).toBe("0");
    expect(env.MASTHEAD_LLM_COPY).toBe("0");
    expect(env.MASTHEAD_REMOTE_ENRICHMENT).toBe("0");
  });

  test("keeps explicit launcher overrides", () => {
    const env = buildLiveDevDaemonEnv({
      ...baseInput,
      env: {
        MASTHEAD_DEV_NODE_OPTIONS: "--trace-warnings",
        MASTHEAD_GIT_REFRESH_MS: "2500",
        MASTHEAD_LIVE_COPY: "0",
        MASTHEAD_LLM_COPY: "1",
        MASTHEAD_REMOTE_ENRICHMENT: "1",
        MASTHEAD_SKIP_BACKGROUND_HYDRATION: "0",
        MASTHEAD_SKIP_MIGRATION_QUICK_CHECK: "0"
      }
    });

    expect(env).toMatchObject({
      MASTHEAD_GIT_REFRESH_MS: "2500",
      MASTHEAD_LIVE_COPY: "0",
      MASTHEAD_LLM_COPY: "1",
      MASTHEAD_REMOTE_ENRICHMENT: "1",
      MASTHEAD_SKIP_BACKGROUND_HYDRATION: "0",
      MASTHEAD_SKIP_MIGRATION_QUICK_CHECK: "0",
      NODE_OPTIONS: "--trace-warnings"
    });
  });
});
