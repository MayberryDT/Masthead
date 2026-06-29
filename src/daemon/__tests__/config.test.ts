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
});
