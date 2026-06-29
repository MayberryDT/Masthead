import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("Masthead Dev launcher template", () => {
  test("does not rebuild the daemon when an existing daemon is healthy", async () => {
    const source = await readFile("scripts/install-electron-dev-launcher.js", "utf8");

    const healthCheckIndex = source.indexOf("if daemon_is_healthy; then");
    const buildIndex = source.indexOf("Building Masthead daemon...");

    expect(healthCheckIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeGreaterThan(healthCheckIndex);
    expect(source).not.toContain('"$NPM_BIN" run dev:electron');
  });
});
