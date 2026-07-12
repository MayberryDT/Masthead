import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import type { DaemonConfig } from "../config";
import {
  disableHermesPluginInConfig,
  enableHermesPluginInConfig,
  getLiveConnectorSetting,
  installLiveConnector,
  isHermesPluginEnabledInConfig,
  liveConnectorCommand,
  resolveLiveConnectorCommandPaths,
  runLiveConnectorRoundTrip,
  uninstallLiveConnector
} from "../liveConnectorSettings";

type OmpSessionManager = {
  getCwd?: () => string;
  getSessionFile?: () => string;
  getSessionId?: () => string;
  getSessionName?: () => string;
};

type OmpContext = {
  cwd?: string;
  sessionManager?: OmpSessionManager;
};

type OmpHandler = (event?: Record<string, unknown>, ctx?: OmpContext) => Promise<void>;
type OmpConnector = (pi: { on: (event: string, handler: OmpHandler) => void }) => void;

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("live connector settings", () => {
  test("live connector install commands pin MASTHEAD_RUNTIME for every live runtime", () => {
    const config = configFor("/tmp/masthead-live-connector-pin");
    for (const runtime of ["codex", "claude_code", "cursor", "grok", "opencode", "omp", "pi", "hermes"] as const) {
      const command = liveConnectorCommand(config, runtime);
      expect(command).toContain(`MASTHEAD_RUNTIME='${runtime}'`);
      expect(command).toContain(`/ingest?runtime=${runtime}`);
      expect(command).toContain("MASTHEAD_STATE_URL=");
    }
  });

  test("packaged connector paths expand a tilde home before shell quoting", () => {
    const resolved = resolveLiveConnectorCommandPaths({
      execPath: "/home/test/.local/share/masthead-production/build/resources/daemon/node",
      exists: () => true,
      homeDir: "~"
    });

    expect(resolved.nodePath).toMatch(/^\//);
    expect(resolved.nodePath).not.toContain("/~");
    expect(resolved.scriptPath).toMatch(/^\//);
  });

  test("connector verification fails when the managed hook command cannot launch", async () => {
    const originalHookScript = process.env.MASTHEAD_HOOK_SCRIPT;
    process.env.MASTHEAD_HOOK_SCRIPT = "/definitely-missing/masthead-hook.js";
    try {
      const result = await runLiveConnectorRoundTrip(configFor("/tmp/masthead-command-verification"), {
        runtimes: ["codex"]
      });
      expect(result.status).toBe("failed");
      expect(result.message).toContain("managed connector command");
    } finally {
      if (originalHookScript === undefined) delete process.env.MASTHEAD_HOOK_SCRIPT;
      else process.env.MASTHEAD_HOOK_SCRIPT = originalHookScript;
    }
  });

  test("connector verification fails when the managed command cannot reach Masthead", async () => {
    const config = { ...configFor("/tmp/masthead-command-network-verification"), port: 65_534 };
    const result = await runLiveConnectorRoundTrip(config, { runtimes: ["codex"] });

    expect(result.status).toBe("failed");
    expect(result.message).toContain("managed connector command failed");
  });

  test("Hermes install writes a Python plugin and enables it in config.yaml", async () => {
    const tempDir = await makeTempDir();
    const config = configFor(tempDir);
    await mkdir(join(tempDir, ".hermes"), { recursive: true });
    await writeFile(join(tempDir, ".hermes", "config.yaml"), "model: test\nplugins:\n  enabled: []\n", "utf8");

    await installLiveConnector(config, "hermes");
    const setting = await getLiveConnectorSetting(config, "hermes");
    expect(setting.installed).toBe(true);
    expect(setting.configPath).toContain("plugin.yaml");

    const pluginYaml = await readFile(join(tempDir, ".hermes", "plugins", "masthead-live", "plugin.yaml"), "utf8");
    const initPy = await readFile(join(tempDir, ".hermes", "plugins", "masthead-live", "__init__.py"), "utf8");
    const hermesConfig = await readFile(join(tempDir, ".hermes", "config.yaml"), "utf8");
    expect(pluginYaml).toContain("name: masthead-live");
    expect(initPy).toContain("on_session_start");
    expect(initPy).toContain("runtime=hermes");
    expect(isHermesPluginEnabledInConfig(hermesConfig, "masthead-live")).toBe(true);

    await uninstallLiveConnector(config, "hermes");
    const after = await getLiveConnectorSetting(config, "hermes");
    expect(after.installed).toBe(false);
    expect(isHermesPluginEnabledInConfig(await readFile(join(tempDir, ".hermes", "config.yaml"), "utf8"), "masthead-live")).toBe(false);
  });

  test("enable/disable Hermes plugin config helpers preserve other plugins", () => {
    const empty = "plugins:\n  enabled: []\n";
    const enabled = enableHermesPluginInConfig(empty, "masthead-live");
    expect(enabled).toContain("- masthead-live");
    const withOther = enableHermesPluginInConfig("plugins:\n  enabled:\n    - disk-cleanup\n", "masthead-live");
    expect(withOther).toContain("- disk-cleanup");
    expect(withOther).toContain("- masthead-live");
    expect(disableHermesPluginInConfig(withOther, "masthead-live")).toContain("- disk-cleanup");
    expect(disableHermesPluginInConfig(withOther, "masthead-live")).not.toContain("masthead-live");
  });

  test("generated OpenCode plugin does not post blocked state for questions or needs_input", async () => {
    const tempDir = await makeTempDir();
    const pluginPath = join(tempDir, "masthead-opencode-live.js");
    const originalPluginPath = process.env.MASTHEAD_OPENCODE_PLUGIN;
    const originalFetch = globalThis.fetch;
    const requests: Array<{ body: Record<string, unknown>; url: string }> = [];

    process.env.MASTHEAD_OPENCODE_PLUGIN = pluginPath;
    globalThis.fetch = (async (input, init) => {
      requests.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown>, url: String(input) });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    try {
      await installLiveConnector(configFor(tempDir), "opencode");
      const connectorModule = (await import(`${pathToFileURL(pluginPath).href}?test=${Date.now()}`)) as {
        default: () => Promise<{ event: (input: { event: Record<string, unknown> }) => Promise<void> }>;
      };
      const connector = await connectorModule.default();
      await connector.event({
        event: {
          type: "question",
          properties: {
            session: { id: "opencode-question-session" },
            status: "needs_input",
            cwd: "/workspace/masthead"
          }
        }
      });
    } finally {
      if (originalPluginPath === undefined) delete process.env.MASTHEAD_OPENCODE_PLUGIN;
      else process.env.MASTHEAD_OPENCODE_PLUGIN = originalPluginPath;
      globalThis.fetch = originalFetch;
    }

    expect(requests.some((request) => request.url.includes("/ingest?runtime=opencode"))).toBe(true);
    expect(requests.filter((request) => request.url.includes("/live/state")).map((request) => request.body.state)).not.toContain("blocked");
  });

  test("generated OMP extension prefers session manager identity over event session files", async () => {
    const tempDir = await makeTempDir();
    const extensionPath = join(tempDir, "masthead-live.js");
    const originalExtensionPath = process.env.MASTHEAD_OMP_EXTENSION;
    const originalFetch = globalThis.fetch;
    const requests: Array<{ body: Record<string, unknown>; url: string }> = [];

    process.env.MASTHEAD_OMP_EXTENSION = extensionPath;
    globalThis.fetch = (async (input, init) => {
      requests.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown>, url: String(input) });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    try {
      await installLiveConnector(configFor(tempDir), "omp");
      // Dynamic import is intentional: this test executes the connector file generated into a temp OMP extension path.
      const connectorModule = (await import(`${pathToFileURL(extensionPath).href}?test=${Date.now()}`)) as { default: OmpConnector };
      const handlers = new Map<string, OmpHandler>();
      connectorModule.default({
        on: (event, handler) => handlers.set(event, handler)
      });

      const sessionStart = handlers.get("session_start");
      expect(sessionStart).toBeDefined();
      await sessionStart?.(
        {
          session_file: "/home/user/.omp/agent/sessions/project/turn-scoped-child.jsonl"
        },
        {
          cwd: "/workspace/masthead",
          sessionManager: {
            getCwd: () => "/workspace/masthead",
            getSessionFile: () => "/home/user/.omp/agent/sessions/project/root-session.jsonl",
            getSessionId: () => "omp-stable-manager-session",
            getSessionName: () => "Root OMP session"
          }
        }
      );
    } finally {
      if (originalExtensionPath === undefined) delete process.env.MASTHEAD_OMP_EXTENSION;
      else process.env.MASTHEAD_OMP_EXTENSION = originalExtensionPath;
      globalThis.fetch = originalFetch;
    }

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toContain("/ingest?runtime=omp");
    expect(requests[0]?.body).toMatchObject({
      sessionId: "omp-stable-manager-session",
      sessionFile: "/home/user/.omp/agent/sessions/project/turn-scoped-child.jsonl",
      sessionName: "Root OMP session",
      source: "masthead-live-connector"
    });
    expect(requests[1]?.url).toContain("/live/state");
    expect(requests[1]?.body).toMatchObject({
      runtime: "omp",
      source: "masthead:omp-extension",
      sourceSessionId: "omp-stable-manager-session",
      state: "idle"
    });
  });
});

async function makeTempDir(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-live-connector-"));
  tempDirs.push(tempDir);
  return tempDir;
}

function configFor(tempDir: string): DaemonConfig {
  return {
    allowedOrigins: [],
    codexHomeDir: tempDir,
    databasePath: join(tempDir, "masthead.sqlite"),
    fixturePath: "fixtures/v0/replay-three-sessions-board.json",
    gitRefreshMs: 60_000,
    hookTranscriptCatchupEnabled: true,
    host: "127.0.0.1",
    llmCopyEnabled: false,
    port: 17373,
    storePath: join(tempDir, "events.ndjson")
  };
}
