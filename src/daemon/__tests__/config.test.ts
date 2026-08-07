import { describe, expect, test } from "vitest";
import { daemonConfigFromEnv } from "../config";

describe("daemon config", () => {
  test("allows Electron Forge fallback renderer ports in local development by default", () => {
    const config = daemonConfigFromEnv({});

    expect(config.allowedOrigins).toContain("http://127.0.0.1:5173");
    expect(config.allowedOrigins).toContain("http://localhost:5173");
    expect(config.allowedOrigins).toContain("http://127.0.0.1:5180");
    expect(config.allowedOrigins).toContain("http://localhost:5180");
    expect(config.allowedOrigins).toContain("masthead://app");
  });

  test("defaults to loopback and rejects non-loopback MASTHEAD_HOST binds", () => {
    expect(daemonConfigFromEnv({}).host).toBe("127.0.0.1");
    expect(daemonConfigFromEnv({ MASTHEAD_HOST: "localhost" }).host).toBe("localhost");
    expect(daemonConfigFromEnv({ MASTHEAD_HOST: "::1" }).host).toBe("::1");
    expect(() => daemonConfigFromEnv({ MASTHEAD_HOST: "0.0.0.0" })).toThrow(/loopback/i);
    expect(() => daemonConfigFromEnv({ MASTHEAD_HOST: "192.168.1.10" })).toThrow(/loopback/i);
  });

  test("maps migration quick-check skip from the environment", () => {
    expect(daemonConfigFromEnv({}).skipMigrationQuickCheck).toBe(false);
    expect(daemonConfigFromEnv({ MASTHEAD_SKIP_MIGRATION_QUICK_CHECK: "1" }).skipMigrationQuickCheck).toBe(true);
  });

  test("can disable background hydration for responsive live previews", () => {
    const config = daemonConfigFromEnv({ MASTHEAD_BACKGROUND_HYDRATION: "0" });

    expect(config.backgroundHydrationEnabled).toBe(false);
  });

  test("maps legacy background hydration skip from the dev launcher", () => {
    const config = daemonConfigFromEnv({ MASTHEAD_SKIP_BACKGROUND_HYDRATION: "1" });

    expect(config.backgroundHydrationEnabled).toBe(false);
  });

  test("keeps historical recovery work off by default in production", () => {
    const config = daemonConfigFromEnv({ MASTHEAD_PRODUCTION_ROOT: "/opt/masthead" });

    expect(config.backgroundHydrationEnabled).toBe(false);
    expect(config.legacyWorkbenchBackfillEnabled).toBe(false);
    expect(config.gitRefreshMs).toBe(0);
    expect(config.hookTranscriptCatchupEnabled).toBe(false);
    expect(config.liveCaptureEnrichmentEnabled).toBe(false);
    expect(config.liveWorkbenchReconciliationOnEveryEvent).toBe(false);
    expect(config.liveSearchIndexOnEveryEvent).toBe(false);
  });

  test("permits an explicit production maintenance run", () => {
    const config = daemonConfigFromEnv({
      MASTHEAD_BACKGROUND_HYDRATION: "1",
      MASTHEAD_GIT_REFRESH_MS: "60000",
      MASTHEAD_HOOK_TRANSCRIPT_CATCHUP: "1",
      MASTHEAD_LEGACY_WORKBENCH_BACKFILL: "1",
      MASTHEAD_LIVE_CAPTURE_ENRICHMENT: "1",
      MASTHEAD_LIVE_WORKBENCH_RECONCILIATION: "1",
      MASTHEAD_LIVE_SEARCH_INDEXING: "1",
      MASTHEAD_PRODUCTION_ROOT: "/opt/masthead"
    });

    expect(config.backgroundHydrationEnabled).toBe(true);
    expect(config.gitRefreshMs).toBe(60_000);
    expect(config.hookTranscriptCatchupEnabled).toBe(true);
    expect(config.legacyWorkbenchBackfillEnabled).toBe(true);
    expect(config.liveCaptureEnrichmentEnabled).toBe(true);
    expect(config.liveWorkbenchReconciliationOnEveryEvent).toBe(true);
    expect(config.liveSearchIndexOnEveryEvent).toBe(true);
  });

  test("enables hook transcript catch-up by default", () => {
    const config = daemonConfigFromEnv({});

    expect(config.hookTranscriptCatchupEnabled).toBe(true);
  });

  test("can disable hook transcript catch-up for responsive live previews", () => {
    const config = daemonConfigFromEnv({ MASTHEAD_HOOK_TRANSCRIPT_CATCHUP: "0" });

    expect(config.hookTranscriptCatchupEnabled).toBe(false);
  });

  test("enables GPT-5 Nano live headline by default when an OpenAI key is present", () => {
    const config = daemonConfigFromEnv({ OPENAI_API_KEY: "sk-test" });

    expect(config.llmCopyEnabled).toBe(true);
    expect(config.liveCopyEnabled).toBe(true);
    expect(config.remoteEnrichmentEnabled).toBe(false);
    expect(config.openaiModel).toBeUndefined();
  });

  test("allows an explicit environment flag to disable live headline even when a key is present", () => {
    const config = daemonConfigFromEnv({ MASTHEAD_LLM_COPY: "0", OPENAI_API_KEY: "sk-test" });

    expect(config.llmCopyEnabled).toBe(false);
    expect(config.liveCopyEnabled).toBe(false);
    expect(config.remoteEnrichmentEnabled).toBe(false);
  });

  test("splits live headline from durable remote enrichment flags", () => {
    const keyOnly = daemonConfigFromEnv({ OPENAI_API_KEY: "sk-test" });
    expect(keyOnly.liveCopyEnabled).toBe(true);
    expect(keyOnly.remoteEnrichmentEnabled).toBe(false);

    const remoteEnabled = daemonConfigFromEnv({ MASTHEAD_REMOTE_ENRICHMENT: "1", OPENAI_API_KEY: "sk-test" });
    expect(remoteEnabled.liveCopyEnabled).toBe(true);
    expect(remoteEnabled.remoteEnrichmentEnabled).toBe(true);

    const liveDisabled = daemonConfigFromEnv({ MASTHEAD_LIVE_COPY: "0", OPENAI_API_KEY: "sk-test" });
    expect(liveDisabled.liveCopyEnabled).toBe(false);
    expect(liveDisabled.remoteEnrichmentEnabled).toBe(false);
  });

  test("lets specific flags override the legacy LLM copy flag", () => {
    const config = daemonConfigFromEnv({
      MASTHEAD_LIVE_COPY: "0",
      MASTHEAD_LLM_COPY: "1",
      MASTHEAD_REMOTE_ENRICHMENT: "0",
      OPENAI_API_KEY: "sk-test"
    });

    expect(config.llmCopyEnabled).toBe(false);
    expect(config.liveCopyEnabled).toBe(false);
    expect(config.remoteEnrichmentEnabled).toBe(false);
  });

  test("keeps legacy LLM copy compatibility when specific flags are absent", () => {
    const config = daemonConfigFromEnv({ MASTHEAD_LLM_COPY: "1", OPENAI_API_KEY: "sk-test" });

    expect(config.llmCopyEnabled).toBe(true);
    expect(config.liveCopyEnabled).toBe(true);
    expect(config.remoteEnrichmentEnabled).toBe(true);
  });

  test("configures a durable remote enrichment timeout separately from live headline", () => {
    expect(daemonConfigFromEnv({}).remoteEnrichmentTimeoutMs).toBe(60_000);
    expect(daemonConfigFromEnv({ MASTHEAD_REMOTE_ENRICHMENT_TIMEOUT_MS: "15000" }).remoteEnrichmentTimeoutMs).toBe(15_000);
  });
});
