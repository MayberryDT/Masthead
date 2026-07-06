import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import type { DaemonConfig } from "../config";
import { installLiveConnector } from "../liveConnectorSettings";

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
  test("generated OMP extension prefers session manager identity over event session files", async () => {
    const tempDir = await makeTempDir();
    const extensionPath = join(tempDir, "masthead-live.js");
    const originalExtensionPath = process.env.MASTHEAD_OMP_EXTENSION;
    const originalFetch = globalThis.fetch;
    const requests: Array<Record<string, unknown>> = [];

    process.env.MASTHEAD_OMP_EXTENSION = extensionPath;
    globalThis.fetch = (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
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

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      sessionId: "omp-stable-manager-session",
      sessionFile: "/home/user/.omp/agent/sessions/project/turn-scoped-child.jsonl",
      sessionName: "Root OMP session",
      source: "masthead-live-connector"
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
