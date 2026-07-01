import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("Masthead Dev launcher template", () => {
  test("does not rebuild the daemon when an existing daemon is healthy", async () => {
    const source = await readFile("scripts/install-electron-dev-launcher.js", "utf8");

    const healthCheckIndex = source.indexOf('if daemon_is_compatible "$port"; then');
    const buildIndex = source.indexOf("Building Masthead daemon...");

    expect(healthCheckIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeGreaterThan(healthCheckIndex);
    expect(source).not.toContain('"$NPM_BIN" run dev:electron');
    expect(source).toContain('CANONICAL_RENDERER_URL="http://127.0.0.1:5173"');
    expect(source).toContain('MASTHEAD_ELECTRON_RENDERER_URL="$CANONICAL_RENDERER_URL"');
    expect(source).toContain('ELECTRON_BIN="$APP_DIR/node_modules/electron/dist/electron"');
    expect(source).toContain('"$ELECTRON_BIN" "$APP_DIR"');
    expect(source).not.toContain('"$NODE_BIN" "$APP_DIR/node_modules/.bin/electron-forge" start');
    expect(source).toContain("KillMode=control-group");
  });

  test("loads ignored local env and pins the UI to the compatible daemon", async () => {
    const source = await readFile("scripts/install-electron-dev-launcher.js", "utf8");

    expect(source).toContain("load_local_env");
    expect(source).toContain('"$APP_DIR/.env" "$APP_DIR/.env.local"');
    expect(source).toContain("daemon_is_compatible");
    expect(source).toContain("j?.data?.dataDirectory === process.env.EXPECTED_DATA_DIR");
    expect(source).toContain('ACTIVE_PROJECTION_URL="$ACTIVE_DAEMON_BASE_URL/projection"');
    expect(source).toContain('VITE_MASTHEAD_PROJECTION_URL="$ACTIVE_PROJECTION_URL"');
    expect(source).toContain('MASTHEAD_PORT="$ACTIVE_DAEMON_PORT"');
  });
});
