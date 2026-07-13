import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildDaemonEnv,
  connectorBaseUrl,
  parseCompatibleHealth,
  resolveDaemonLaunchTarget,
  startLiveConnector
} from "../daemonLauncher";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
        cliCommand: "/home/test/.local/bin/mastheadctl",
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
        cliCommand: "/home/test/.local/bin/mastheadctl",
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
      MASTHEAD_CLI_COMMAND: "/home/test/.local/bin/mastheadctl",
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

  test("prepares the actual port-bound launcher before returning a compatible collector", async () => {
    const events: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      events.push(`fetch:${url.pathname}`);
      if (url.pathname === "/health") return jsonResponse(compatibleHealth("/tmp/masthead"));
      if (url.pathname === "/workbench/authoring/capabilities") {
        return jsonResponse(authoringCapabilities("/home/test/.local/bin/mastheadctl"));
      }
      return new Response("{}", { status: 200 });
    }));
    const owned = new Set<never>();

    const result = await startLiveConnector(
      connectorInput("/home/test/.local/bin/mastheadctl"),
      ["masthead://app"],
      owned,
      {
        prepareAuthoringLauncher: async ({ baseUrl, port }) => {
          events.push(`prepare:${baseUrl}:${port}`);
        }
      }
    );

    expect(result).toMatchObject({ baseUrl: "http://127.0.0.1:17373", started: false });
    expect(events).toEqual([
      "fetch:/health",
      "fetch:/workbench/authoring/capabilities",
      "prepare:http://127.0.0.1:17373:17373",
      "fetch:/projection"
    ]);
  });

  test.each([
    ["bare command", authoringCapabilities("mastheadctl")],
    ["wrong absolute command", authoringCapabilities("/other/mastheadctl")],
    ["incomplete contract", { ...authoringCapabilities("/home/test/.local/bin/mastheadctl"), operations: ["open"] }]
  ])("refuses a same-database collector with %s without starting a duplicate", async (_label, capabilities) => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/health") return jsonResponse(compatibleHealth("/tmp/masthead"));
      if (url.pathname === "/workbench/authoring/capabilities") return jsonResponse(capabilities);
      return new Response("{}", { status: 200 });
    }));
    const owned = new Set<never>();
    const prepare = vi.fn();

    await expect(
      startLiveConnector(connectorInput("/home/test/.local/bin/mastheadctl"), ["masthead://app"], owned, {
        prepareAuthoringLauncher: prepare
      })
    ).rejects.toThrow("same database");
    expect(prepare).not.toHaveBeenCalled();
    expect(owned.size).toBe(0);
  });

  test("refuses same-database health missing the authoring contract without starting a duplicate", async () => {
    const health = compatibleHealth("/tmp/masthead");
    health.capabilities = health.capabilities.filter((capability) => capability !== "artifact_authoring");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(health)));
    const owned = new Set<never>();

    await expect(
      startLiveConnector(connectorInput("/home/test/.local/bin/mastheadctl"), ["masthead://app"], owned)
    ).rejects.toThrow("same database");
    expect(owned.size).toBe(0);
  });

  test("treats an unreadable capability endpoint on a healthy same-database daemon as incompatible", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/health") return jsonResponse(compatibleHealth("/tmp/masthead"));
      throw new Error("capabilities timed out");
    }));
    const owned = new Set<never>();

    await expect(
      startLiveConnector(connectorInput("/home/test/.local/bin/mastheadctl"), ["masthead://app"], owned)
    ).rejects.toThrow("same database");
    expect(owned.size).toBe(0);
  });

  test("does not spawn or return when active-port launcher preparation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const owned = new Set<never>();

    await expect(
      startLiveConnector(connectorInput("/home/test/.local/bin/mastheadctl"), ["masthead://app"], owned, {
        prepareAuthoringLauncher: async () => {
          throw new Error("launcher write failed");
        }
      })
    ).rejects.toThrow("launcher write failed");
    expect(owned.size).toBe(0);
  });

  test("refuses a collector using the same canonical database through a different data directory", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse(compatibleHealth("/tmp/other-data", "/tmp/shared/masthead.sqlite"))
    ));
    const owned = new Set<never>();

    await expect(
      startLiveConnector(
        connectorInput("/home/test/.local/bin/mastheadctl", {
          MASTHEAD_DB_PATH: "/tmp/shared/../shared/masthead.sqlite"
        }),
        ["masthead://app"],
        owned
      )
    ).rejects.toThrow("same database");
    expect(owned.size).toBe(0);
  });

  test("treats the same data directory with a different canonical database as another collector", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse(compatibleHealth("/tmp/masthead", "/tmp/other/masthead.sqlite"))
    ));
    const owned = new Set<never>();
    const prepare = vi.fn(async (_input: { baseUrl: string; port: number }) => {
      throw new Error("fallback launcher selected");
    });

    await expect(
      startLiveConnector(connectorInput("/home/test/.local/bin/mastheadctl"), ["masthead://app"], owned, {
        prepareAuthoringLauncher: prepare
      })
    ).rejects.toThrow("fallback launcher selected");
    expect(prepare).toHaveBeenCalledWith({ baseUrl: expect.any(String), port: expect.any(Number) });
    expect(prepare.mock.calls[0]?.[0].port).toBeGreaterThan(17373);
    expect(owned.size).toBe(0);
  });
});

function connectorInput(cliCommand: string, env: Record<string, string> = {}) {
  return {
    currentDir: "/tmp",
    env: {
      MASTHEAD_CLI_COMMAND: cliCommand,
      MASTHEAD_DAEMON_ENTRY: process.execPath,
      MASTHEAD_DATA_DIR: "/tmp/masthead",
      MASTHEAD_NODE_PATH: process.execPath,
      ...env
    },
    resourcesPath: "/opt/Masthead/resources",
    userDataDir: "/tmp/masthead"
  };
}

function compatibleHealth(dataDirectory: string, databasePath = `${dataDirectory}/masthead.sqlite`) {
  return {
    apiVersion: 1,
    capabilities: ["live_projection", "canonical_sessions", "logbook_search", "source_discovery", "adapter_inventory", "mcp_status", "settings", "artifact_authoring"],
    data: { databasePath, dataDirectory, migrationState: "ready" },
    ok: true,
    product: "masthead"
  };
}

function authoringCapabilities(command: string) {
  return {
    bundleVersion: "workbench-authoring-v2",
    capability: "artifact_authoring",
    command,
    databaseId: "database:test",
    evidencePolicy: "candidate_scoped_canonical_evidence",
    evidenceRequirements: {
      adr: ["context", "decision", "alternatives"],
      incident_timeline: ["symptom", "ordered_events", "remediation"],
      runbook: ["problem", "change", "verification"]
    },
    operations: ["candidates", "open", "status", "evidence", "submit", "finish"],
    protocol: "masthead.workbench.authoring/v1",
    transport: "daemon_http"
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200
  });
}
