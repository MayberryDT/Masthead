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

  test("can disable hook transcript catch-up for responsive live previews", () => {
    const config = daemonConfigFromEnv({ MASTHEAD_HOOK_TRANSCRIPT_CATCHUP: "0" });

    expect(config.hookTranscriptCatchupEnabled).toBe(false);
  });
});
