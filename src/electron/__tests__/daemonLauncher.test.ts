import { describe, expect, test } from "vitest";
import { buildDaemonEnv, connectorBaseUrl, parseCompatibleHealth, resolveDaemonLaunchTarget } from "../daemonLauncher";

describe("Electron daemon launcher policy", () => {
  test("builds loopback connector URLs", () => {
    expect(connectorBaseUrl(17373)).toBe("http://127.0.0.1:17373");
  });

  test("parses compatible Masthead health and rejects incompatible responses", () => {
    const compatible = parseCompatibleHealth({
      ok: true,
      product: "masthead",
      apiVersion: 1,
      buildSha: "development",
      capabilities: ["live_projection", "canonical_sessions", "logbook_search", "source_discovery", "adapter_inventory", "mcp_status", "settings", "artifact_authoring"],
      data: {
        databaseId: "db",
        databasePath: "/tmp/masthead/masthead.sqlite",
        dataDirectory: "/tmp/masthead",
        migrationState: "ready"
      },
      runtime: { mode: "primary" }
    });

    expect(compatible).toMatchObject({
      apiVersion: 1,
      buildSha: "development",
      databaseId: "db",
      databasePath: "/tmp/masthead/masthead.sqlite",
      dataDirectory: "/tmp/masthead",
      mode: "primary"
    });
    expect(parseCompatibleHealth({ ok: true, product: "other", apiVersion: 1, capabilities: [] })).toBeUndefined();
    expect(
      parseCompatibleHealth({
        ok: true,
        product: "masthead",
        apiVersion: 1,
        capabilities: ["live_projection", "canonical_sessions", "logbook_search", "source_discovery", "adapter_inventory", "mcp_status", "settings"]
      })
    ).toBeUndefined();
    expect(
      parseCompatibleHealth({
        ok: true,
        product: "masthead",
        apiVersion: 1,
        capabilities: ["live_projection", "canonical_sessions", "logbook_search", "source_discovery", "adapter_inventory", "mcp_status", "settings", "artifact_authoring"],
        data: { migrationState: "failed" }
      })
    ).toBeUndefined();
  });

  test("builds daemon env with canonical data and MCP overrides", () => {
    expect(
      buildDaemonEnv({
        allowedOrigins: ["masthead://app", "http://localhost:5173"],
        dataDirectory: "/tmp/masthead",
        databasePath: "/tmp/masthead/masthead.sqlite",
        hookScript: "/opt/Masthead/resources/daemon/scripts/masthead-hook.js",
        legacyStorePath: "/tmp/masthead/legacy/events.ndjson",
        mcpCommand: "/opt/Masthead/resources/daemon/node",
        mcpEntry: "/opt/Masthead/resources/daemon/dist/src/mcp/server.js",
        port: 17373
      })
    ).toMatchObject({
      MASTHEAD_ALLOWED_ORIGINS: "masthead://app,http://localhost:5173",
      MASTHEAD_DATA_DIR: "/tmp/masthead",
      MASTHEAD_DB_PATH: "/tmp/masthead/masthead.sqlite",
      MASTHEAD_HOST: "127.0.0.1",
      MASTHEAD_HOOK_SCRIPT: "/opt/Masthead/resources/daemon/scripts/masthead-hook.js",
      MASTHEAD_MCP_COMMAND: "/opt/Masthead/resources/daemon/node",
      MASTHEAD_MCP_ENTRY: "/opt/Masthead/resources/daemon/dist/src/mcp/server.js",
      MASTHEAD_PORT: "17373",
      MASTHEAD_STORE_PATH: "/tmp/masthead/legacy/events.ndjson"
    });
  });

  test("resolves development daemon launch target from env overrides", () => {
    expect(
      resolveDaemonLaunchTarget({
        currentDir: "/repo",
        env: {
          MASTHEAD_DAEMON_ENTRY: "/repo/dist/daemon/src/daemon/main.js",
          MASTHEAD_NODE_PATH: "/usr/bin/node",
          MASTHEAD_PORT: "17374",
          MASTHEAD_PROJECT_DIR: "/repo"
        },
        resourcesPath: "/opt/Masthead/resources",
        userDataDir: "/tmp/masthead"
      })
    ).toMatchObject({
      cwd: "/repo",
      dataDirectory: "/tmp/masthead",
      entryPath: "/repo/dist/daemon/src/daemon/main.js",
      nodePath: "/usr/bin/node",
      port: 17374
    });
  });

  test("uses the Electron dev data directory fallback before userData", () => {
    expect(
      resolveDaemonLaunchTarget({
        currentDir: "/repo",
        defaultDataDir: "/home/tyler/.local/share/masthead-dev",
        env: {
          MASTHEAD_DAEMON_ENTRY: "/repo/dist/daemon/src/daemon/main.js",
          MASTHEAD_NODE_PATH: "/usr/bin/node",
          MASTHEAD_PROJECT_DIR: "/repo"
        },
        resourcesPath: "/opt/Masthead/resources",
        userDataDir: "/home/tyler/.config/masthead"
      })
    ).toMatchObject({
      dataDirectory: "/home/tyler/.local/share/masthead-dev",
      databasePath: "/home/tyler/.local/share/masthead-dev/masthead.sqlite",
      legacyStorePath: "/home/tyler/.local/share/masthead-dev/legacy/events.ndjson"
    });
  });

  test("resolves packaged hook script from daemon resources", () => {
    expect(
      resolveDaemonLaunchTarget({
        currentDir: "/ignored",
        env: {},
        resourcesPath: "/opt/Masthead/resources",
        userDataDir: "/home/tyler/.config/Masthead"
      })
    ).toMatchObject({
      cwd: "/home/tyler/.config/Masthead",
      entryPath: "/opt/Masthead/resources/daemon/dist/src/daemon/main.js",
      hookScript: "/opt/Masthead/resources/daemon/scripts/masthead-hook.js",
      nodePath: "/opt/Masthead/resources/daemon/node"
    });
  });
});
