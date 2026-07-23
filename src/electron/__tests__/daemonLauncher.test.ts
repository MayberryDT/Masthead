import { afterEach, describe, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import currentHealth from "../../../fixtures/protocol/current-health.json";
import { spawn, type ChildProcess } from "node:child_process";
import {
  DAEMON_STARTUP_HEALTH_TIMEOUT_MS,
  buildDaemonEnv,
  cliEntryForTarget,
  connectorBaseUrl,
  parseCompatibleHealth,
  resolveDaemonLaunchTarget,
  startLiveConnector,
  verifyInstanceLauncher
} from "../daemonLauncher";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Electron daemon launcher policy", () => {
  test("aligns Electron startup health with the five-minute production lifecycle budget", () => {
    expect(DAEMON_STARTUP_HEALTH_TIMEOUT_MS).toBe(300_000);
  });

  test("derives the packaged CLI entry with Windows path semantics", () => {
    expect(cliEntryForTarget({ entryPath: "C:\\Masthead\\dist\\src\\daemon\\main.js" }, "win32"))
      .toBe("C:\\Masthead\\dist\\src\\cli\\mastheadctl.js");
  });
  test("verifies the exact manifest assignment rather than a matching comment", async () => {
    const directory = await mkdtemp(join(tmpdir(), "masthead-launcher-verify-"));
    const launcher = join(directory, "mastheadctl");
    const manifest = join(directory, "masthead-instance.json");
    try {
      await writeFile(launcher, `#!/bin/sh\nexec env MASTHEAD_INSTANCE_MANIFEST='${manifest}' '/usr/bin/node' '/app/cli.js' "$@"\n`);
      await chmod(launcher, 0o755);
      await expect(verifyInstanceLauncher(launcher, manifest, "/usr/bin/node", "/app/cli.js")).resolves.toBeUndefined();
      await writeFile(launcher, `#!/bin/sh\nexec env MASTHEAD_INSTANCE_MANIFEST='${manifest}' '/usr/bin/node' '/app/cli.js' "$@"\necho extra\n`);
      await expect(verifyInstanceLauncher(launcher, manifest, "/usr/bin/node", "/app/cli.js")).rejects.toThrow("does not bind");
      await writeFile(launcher, `#!/bin/sh\nexec env MASTHEAD_INSTANCE_MANIFEST='${manifest}' '/usr/bin/node' '/wrong/cli.js' "$@"\n`);
      await expect(verifyInstanceLauncher(launcher, manifest, "/usr/bin/node", "/app/cli.js")).rejects.toThrow("does not bind");
      await writeFile(launcher, `# ${manifest}\nexec env MASTHEAD_INSTANCE_MANIFEST='/wrong/manifest.json' '/usr/bin/node' '/app/cli.js' "$@"\n`);
      await expect(verifyInstanceLauncher(launcher, manifest, "/usr/bin/node", "/app/cli.js")).rejects.toThrow("does not bind");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
  test("builds loopback connector URLs", () => {
    expect(connectorBaseUrl(17373)).toBe("http://127.0.0.1:17373");
  });

  test("parses compatible Masthead health and rejects incompatible responses", () => {
    const compatible = parseCompatibleHealth(compatibleHealth("/tmp/masthead"));

    expect(compatible).toMatchObject({
      apiVersion: 1,
      buildSha: "development",
      databaseId: "database:test",
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
        instanceDir: "/tmp/masthead",
        instanceManifest: "/tmp/masthead/masthead-instance.json",
        port: 17373
      })
    ).toMatchObject({
      MASTHEAD_ALLOWED_ORIGINS: "masthead://app,http://localhost:5173",
      MASTHEAD_DATA_DIR: "/tmp/masthead",
      MASTHEAD_DB_PATH: "/tmp/masthead/masthead.sqlite",
      MASTHEAD_CLI_COMMAND: "/home/test/.local/bin/mastheadctl",
      MASTHEAD_HOST: "127.0.0.1",
      MASTHEAD_INSTANCE_DIR: "/tmp/masthead",
      MASTHEAD_INSTANCE_MANIFEST: "/tmp/masthead/masthead-instance.json",
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

  test.each(["MASTHEAD_INSTANCE_DIR", "MASTHEAD_INSTANCE_MANIFEST", "MASTHEAD_CLI_COMMAND"])(
    "rejects an independent %s override before launcher write or spawn",
    (field) => {
      expect(() => resolveDaemonLaunchTarget({
        currentDir: "/repo",
        env: { MASTHEAD_DATA_DIR: "/tmp/masthead", [field]: "/tmp/other" },
        resourcesPath: "/opt/Masthead/resources",
        userDataDir: "/tmp/masthead"
      })).toThrow("derived exactly");
    }
  );

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
        return jsonResponse(authoringCapabilities("/tmp/masthead/bin/mastheadctl"));
      }
      return new Response("{}", { status: 200 });
    }));
    const owned = new Set<never>();

    const result = await startLiveConnector(
      connectorInput("/tmp/masthead/bin/mastheadctl"),
      ["masthead://app"],
      owned,
      {
        prepareAuthoringLauncher: async ({ baseUrl, port }) => {
          events.push(`prepare:${baseUrl}:${port}`);
        },
        verifyAuthoringLauncher: async () => undefined,
        verifyAuthoringManifest: async () => { events.push("verify-manifest"); }
      }
    );

    expect(result).toMatchObject({ baseUrl: "http://127.0.0.1:17373", started: false });
    expect(events).toEqual([
      "fetch:/health",
      "fetch:/workbench/authoring/capabilities",
      "prepare:http://127.0.0.1:17373:17373",
      "verify-manifest",
      "fetch:/projection"
    ]);
  });

  test.each([
    ["bare command", authoringCapabilities("mastheadctl")],
    ["wrong absolute command", authoringCapabilities("/other/mastheadctl")],
    ["incomplete contract", { ...authoringCapabilities("/tmp/masthead/bin/mastheadctl"), operations: ["open"] }],
    ["legacy V3 contract", {
      ...authoringCapabilities("/tmp/masthead/bin/mastheadctl"),
      bundleVersion: "workbench-authoring-v3",
      operations: ["suggestions", "open", "status", "evidence", "context", "submit", "finish"]
    }],
    ["legacy V4 contract", {
      ...authoringCapabilities("/tmp/masthead/bin/mastheadctl"),
      bundleVersion: "workbench-authoring-v4",
      policyVersion: "guided-authoring-v1",
      maxSessionsPerAssignment: 12,
      canarySessions: 3,
      operations: ["start", "inspect", "scaffold", "save", "review", "finish"]
    }],
    ["reordered V5 contract", {
      ...authoringCapabilities("/tmp/masthead/bin/mastheadctl"),
      operations: ["start", "bootstrap", "claim", "inspect", "scaffold", "save", "finish", "status", "receipt"]
    }]
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
      startLiveConnector(connectorInput("/tmp/masthead/bin/mastheadctl"), ["masthead://app"], owned, {
        prepareAuthoringLauncher: prepare,
        findAvailablePort: async () => 17374
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
      startLiveConnector(connectorInput("/tmp/masthead/bin/mastheadctl"), ["masthead://app"], owned)
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
      startLiveConnector(connectorInput("/tmp/masthead/bin/mastheadctl"), ["masthead://app"], owned)
    ).rejects.toThrow("same database");
    expect(owned.size).toBe(0);
  });

  test("does not spawn or return when active-port launcher preparation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const owned = new Set<never>();

    await expect(
      startLiveConnector(connectorInput("/tmp/masthead/bin/mastheadctl"), ["masthead://app"], owned, {
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
        connectorInput("/tmp/masthead/bin/mastheadctl", {
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
      startLiveConnector(connectorInput("/tmp/masthead/bin/mastheadctl"), ["masthead://app"], owned, {
        prepareAuthoringLauncher: prepare,
        findAvailablePort: async () => 17374
      })
    ).rejects.toThrow("fallback launcher selected");
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: expect.any(String), port: expect.any(Number) }));
    expect(prepare.mock.calls[0]?.[0].port).toBeGreaterThan(17373);
    expect(owned.size).toBe(0);
  });

  test.each(["health-timeout", "manifest-mismatch", "warm-failure"])(
    "stops and awaits the exact spawned child after %s",
    async (failure) => {
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
      const child = fakeChild();
      const owned = new Set<ChildProcess>();
      const health = parseCompatibleHealth(compatibleHealth("/tmp/masthead"))!;
      const options = {
        prepareAuthoringLauncher: async () => undefined,
        verifyAuthoringLauncher: async () => undefined,
        spawnChild: (() => child.value) as typeof import("node:child_process").spawn,
        waitForCollector: async () => {
          if (failure === "health-timeout") throw new Error("health timeout");
          return health;
        },
        verifyAuthoringManifest: async () => {
          if (failure === "manifest-mismatch") throw new Error("manifest mismatch");
        },
        warmConnector: async () => {
          if (failure === "warm-failure") throw new Error("warm failed");
        }
      };
      await expect(startLiveConnector(
        connectorInput("/tmp/masthead/bin/mastheadctl"),
        ["masthead://app"],
        owned,
        options
      )).rejects.toThrow();
      expect(child.signals).toEqual(["SIGTERM"]);
      expect(child.exited).toBe(true);
      expect(owned.size).toBe(0);
    }
  );

  test("escalates the exact owned child to SIGKILL when it ignores SIGTERM", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const child = fakeChild(true);
    const owned = new Set<ChildProcess>();
    await expect(startLiveConnector(connectorInput("/tmp/masthead/bin/mastheadctl"), ["masthead://app"], owned, {
      childTerminationGraceMs: 1,
      prepareAuthoringLauncher: async () => undefined,
      verifyAuthoringLauncher: async () => undefined,
      spawnChild: (() => child.value) as typeof import("node:child_process").spawn,
      waitForCollector: async () => { throw new Error("original health failure"); }
    })).rejects.toThrow("original health failure");
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(child.exited).toBe(true);
    expect(owned.size).toBe(0);
  });

  test("refuses SIGKILL when the spawned PID now has a different process-start identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const child = fakeChild(true);
    const owned = new Set<ChildProcess>();
    const processStartIdentities = ["spawned-at-100", "spawned-at-200"];

    await expect(startLiveConnector(connectorInput("/tmp/masthead/bin/mastheadctl"), ["masthead://app"], owned, {
      childTerminationGraceMs: 1,
      prepareAuthoringLauncher: async () => undefined,
      readProcessStartIdentity: async () => processStartIdentities.shift(),
      verifyAuthoringLauncher: async () => undefined,
      spawnChild: (() => child.value) as typeof import("node:child_process").spawn,
      waitForCollector: async () => { throw new Error("original health failure"); }
    })).rejects.toThrow("Refusing SIGKILL");

    expect(child.signals).toEqual(["SIGTERM"]);
    expect(child.exited).toBe(false);
    expect(owned.size).toBe(1);
  });

  test("SIGKILLs a real spawned child that ignores SIGTERM when its process-start identity is unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    let realChild: ChildProcess | undefined;
    let ready: Promise<void> | undefined;
    const owned = new Set<ChildProcess>();

    try {
      await expect(startLiveConnector(connectorInput("/tmp/masthead/bin/mastheadctl"), ["masthead://app"], owned, {
        childTerminationGraceMs: 20,
        prepareAuthoringLauncher: async () => undefined,
        verifyAuthoringLauncher: async () => undefined,
        spawnChild: (() => {
          realChild = spawn(process.execPath, [
            "-e",
            "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1_000);"
          ], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
          ready = new Promise((resolveReady, rejectReady) => {
            realChild!.once("error", rejectReady);
            realChild!.once("exit", (code, signal) => rejectReady(new Error(`fixture exited before ready: ${code ?? signal}`)));
            realChild!.once("message", () => resolveReady());
          });
          return realChild;
        }) as typeof import("node:child_process").spawn,
        waitForCollector: async () => {
          await ready;
          throw new Error("original health failure");
        }
      })).rejects.toThrow("original health failure");

      expect(realChild?.signalCode).toBe("SIGKILL");
      expect(owned.size).toBe(0);
    } finally {
      if (realChild?.exitCode === null && realChild.signalCode === null) realChild.kill("SIGKILL");
    }
  });
});

function fakeChild(ignoreTerm = false): { exited: boolean; signals: string[]; value: ChildProcess } {
  const emitter = new EventEmitter() as ChildProcess;
  const state = { exited: false, signals: [] as string[], value: emitter };
  Object.defineProperties(emitter, {
    exitCode: { configurable: true, get: () => state.exited ? 0 : null },
    signalCode: { configurable: true, get: () => null },
    pid: { value: process.pid }
  });
  emitter.kill = ((signal?: NodeJS.Signals | number) => {
    state.signals.push(String(signal));
    if (ignoreTerm && signal === "SIGTERM") return true;
    queueMicrotask(() => {
      state.exited = true;
      emitter.emit("exit", 0, signal);
    });
    return true;
  }) as ChildProcess["kill"];
  return state;
}

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
    ...currentHealth,
    buildSha: "development",
    data: { ...currentHealth.data, databaseId: "database:test", databasePath, dataDirectory, migrationState: "ready" },
    runtime: {
      ...currentHealth.runtime,
      authoringCommand: `${dataDirectory}/bin/mastheadctl`,
      baseUrl: "http://127.0.0.1:17373",
      daemonInstanceId: "instance:test",
      instanceManifest: `${dataDirectory}/masthead-instance.json`,
      instanceDir: dataDirectory,
      host: "127.0.0.1",
      mode: "primary",
      pid: process.pid,
      port: 17373,
      writable: true
    }
  };
}

function authoringCapabilities(command: string) {
  return {
    bundleVersion: "workbench-authoring-v5",
    capability: "artifact_authoring",
    command,
    baseUrl: "http://127.0.0.1:17373",
    buildSha: "development",
    databaseId: "database:test",
    instanceId: "instance:test",
    instanceManifest: "/tmp/masthead/masthead-instance.json",
    policyVersion: "workbench-authoring-v5",
    minimumSessionsPerPack: 5,
    maximumSessionsPerPack: 12,
    operations: ["bootstrap", "start", "claim", "inspect", "scaffold", "save", "finish", "status", "receipt"],
    protocol: "masthead.workbench.authoring/v1",
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200
  });
}
