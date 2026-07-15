import { createServer, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import currentHealth from "../../../fixtures/protocol/current-health.json";
import {
  buildLiveDevPlan,
  connectorBaseUrl,
  isAllowedReadOnlyBridgeRequest,
  startReadOnlyConnectorBridge,
  type ReadOnlyBridge
} from "../worktreeConnector";


describe("Masthead worktree connector planning", () => {
  const servers: Server[] = [];
  const bridges: ReadOnlyBridge[] = [];

  afterEach(async () => {
    await Promise.all(bridges.map((bridge) => bridge.close()));
    bridges.length = 0;
    await Promise.all(servers.map(closeServer));
    servers.length = 0;
  });

  test("uses a primary connector when the default connector port is available", async () => {
    const plan = await buildLiveDevPlan(
      {},
      {
        findAvailablePort: async (_host, startPort) => startPort,
        getConnectorHealth: async () => undefined,
        isPortAvailable: async (_host, port) => port === 17373
      }
    );

    expect(plan).toMatchObject({
      projectionUrl: "http://127.0.0.1:17373/projection",
      uiPort: 5173,
      connector: {
        mode: "primary",
        port: 17373
      }
    });
  });

  test("auto-bridges a secondary worktree to the healthy primary connector", async () => {
    const plan = await buildLiveDevPlan(
      {},
      {
        findAvailablePort: async (_host, startPort) => (startPort === 5173 ? 5180 : startPort),
        getConnectorHealth: async () => currentHealth,
        isPortAvailable: async () => false
      }
    );

    expect(plan).toMatchObject({
      projectionUrl: "http://127.0.0.1:17374/projection",
      uiPort: 5180,
      connector: {
        mode: "bridge",
        port: 17374,
        upstreamBaseUrl: "http://127.0.0.1:17373"
      }
    });
    expect(plan.allowedOrigins).toContain("http://127.0.0.1:5180");
    expect(plan.allowedOrigins).toContain("http://localhost:5180");
  });

  test("starts an isolated primary when the default port has a legacy daemon", async () => {
    const plan = await buildLiveDevPlan(
      {},
      {
        findAvailablePort: async (_host, startPort) => (startPort === 5173 ? 5180 : 17374),
        getConnectorHealth: async () => ({ ok: true, events: 12 }),
        isPortAvailable: async () => false
      }
    );

    expect(plan).toMatchObject({
      projectionUrl: "http://127.0.0.1:17374/projection",
      uiPort: 5180,
      connector: {
        mode: "isolated_primary",
        port: 17374,
        baseUrl: "http://127.0.0.1:17374",
        incompatibleAt: 17373
      }
    });
  });

  test("explicit bridge mode rejects an incompatible upstream", async () => {
    await expect(
      buildLiveDevPlan(
        { MASTHEAD_CONNECTOR_MODE: "bridge" },
        {
          findAvailablePort: async (_host, startPort) => startPort,
          getConnectorHealth: async () => ({ ok: true, events: 12 }),
          isPortAvailable: async () => false
        }
      )
    ).rejects.toThrow("no compatible Masthead connector");
  });

  test("bridges to an owned compatible daemon on a non-default port", async () => {
    const plan = await buildLiveDevPlan(
      { MASTHEAD_DATA_DIR: "/tmp/masthead" },
      {
        findAvailablePort: async (_host, startPort) => (startPort === 5173 ? 5180 : 17375),
        getConnectorHealth: async (baseUrl) => (baseUrl.endsWith(":17374") ? currentHealth : { ok: true, events: 12 }),
        getOwnedDaemonMetadata: async () => ({
          apiVersion: 1,
          baseUrl: "http://127.0.0.1:17374",
          daemonInstanceId: "owned",
          dataDirectory: "/tmp/masthead",
          pid: 123,
          startedAt: "2026-06-25T00:00:00.000Z"
        }),
        isPortAvailable: async () => false
      }
    );

    expect(plan).toMatchObject({
      projectionUrl: "http://127.0.0.1:17375/projection",
      connector: {
        mode: "bridge",
        port: 17375,
        upstreamBaseUrl: "http://127.0.0.1:17374"
      }
    });
  });

  test("accepts an upstream projection URL but stores its connector base URL", () => {
    expect(connectorBaseUrl("http://127.0.0.1:17373/projection?selectedSessionId=s1")).toBe("http://127.0.0.1:17373");
  });

  test.each([
    "/sessions",
    "/sessions/session-1",
    "/sessions/session-1/excerpts",
    "/sessions/session-1/dossier",
    "/sessions/session-1/transcript",
    "/projects",
    "/adapters",
    "/imports",
    "/imports/job-1/report",
    "/data/summary",
    "/knowledge-flow/summary",
    "/logbook/summary",
    "/logbook/artifacts",
    "/logbook/artifacts/artifact-1",
    "/logbook/search",
    "/mcp/status",
    "/mcp/launch-config",
    "/mcp/tools",
    "/mcp/audit",
    "/workbench/sessions",
    "/workbench/activity",
    "/workbench/not-added-summary",
    "/workbench/import-health-summary",
    "/workbench/not-added",
    "/workbench/authoring/capabilities",
    "/workbench/authoring/runs/authoring%3Arun",
    "/workbench/authoring/runs/authoring%3Arun/evidence",
    "/workbench/authoring/runs/authoring%3Arun/context"
  ])("forwards canonical read endpoint %s", async (pathname) => {
    expect(isAllowedReadOnlyBridgeRequest("GET", pathname)).toBe(true);
  });

  test.each([
    "/mcp/launch-config/validate",
    "/mcp/test-connection",
    "/settings/llm-provider/models",
    "/workbench/authoring/suggestions"
  ])("forwards read-only POST endpoint %s", async (pathname) => {
    expect(isAllowedReadOnlyBridgeRequest("POST", pathname)).toBe(true);
  });

  test("forwards read-only source scans but blocks source writes", () => {
    expect(isAllowedReadOnlyBridgeRequest("GET", "/sources/connectors")).toBe(true);
    expect(isAllowedReadOnlyBridgeRequest("POST", "/sources/scan")).toBe(false);
    expect(isAllowedReadOnlyBridgeRequest("POST", "/sources/connect")).toBe(false);
    expect(isAllowedReadOnlyBridgeRequest("POST", "/sources/codex/import-metadata")).toBe(false);
    expect(isAllowedReadOnlyBridgeRequest("POST", "/sources/connectors/discover")).toBe(false);
    expect(isAllowedReadOnlyBridgeRequest("POST", "/sources/connectors/codex/enable")).toBe(false);
    expect(isAllowedReadOnlyBridgeRequest("POST", "/sources/connectors/codex/test")).toBe(false);
    expect(isAllowedReadOnlyBridgeRequest("POST", "/sources/connectors/codex/uninstall")).toBe(false);
    expect(isAllowedReadOnlyBridgeRequest("POST", "/sources/connectors/codex/confirm-activation")).toBe(false);
  });

  test("still blocks mutations", () => {
    expect(isAllowedReadOnlyBridgeRequest("POST", "/imports/repair/preview")).toBe(true);
    expect(isAllowedReadOnlyBridgeRequest("POST", "/imports/repair/apply")).toBe(false);
    expect(isAllowedReadOnlyBridgeRequest("POST", "/imports")).toBe(false);
    expect(isAllowedReadOnlyBridgeRequest("POST", "/imports/job-1/report")).toBe(false);
    expect(isAllowedReadOnlyBridgeRequest("POST", "/data/delete")).toBe(false);
    expect(isAllowedReadOnlyBridgeRequest("POST", "/workbench/authoring/runs")).toBe(false);
    expect(isAllowedReadOnlyBridgeRequest("POST", "/workbench/authoring/runs/authoring%3Arun/submit")).toBe(false);
    expect(isAllowedReadOnlyBridgeRequest("POST", "/workbench/authoring/runs/authoring%3Arun/finish")).toBe(false);
  });

  test("proxies read endpoints through a read-only worktree bridge", async () => {
    const upstream = createServer((request, response) => {
      if (request.url === "/health") {
        sendJson(response, 200, {
          ...currentHealth,
          live: {
            events: 3,
            diagnostics: 0,
            gitSnapshots: 0
          },
          projectionUrl: "http://127.0.0.1:17373/projection"
        });
        return;
      }

      if (request.url === "/projection") {
        sendJson(response, 200, {
          ok: true,
          source: "live",
          events: 3,
          projection: { cards: [] }
        });
        return;
      }

      if (request.url === "/sources") {
        sendJson(response, 200, {
          ok: true,
          sources: [{ sourceId: "codex-sessions", runtime: "codex", sourceKind: "jsonl", confidence: "authoritative" }]
        });
        return;
      }

      if (
        request.url === "/logbook/artifacts?q=Server" ||
        request.url === "/logbook/search?q=Server"
      ) {
        sendJson(response, 200, {
          artifacts: [{ artifactId: "artifact-1", kind: "runbook", title: "Server logbook artifact" }],
          total: 1
        });
        return;
      }

      if (request.url === "/sessions/session-1/excerpts?limit=8") {
        sendJson(response, 200, {
          ok: true,
          excerpts: [{ excerptId: "excerpt-1", kind: "message", text: "Bridge excerpt" }]
        });
        return;
      }

      sendJson(response, 404, { ok: false });
    });
    servers.push(upstream);
    const upstreamBaseUrl = await listen(upstream);

    const bridge = await startReadOnlyConnectorBridge({
      allowedOrigins: ["http://127.0.0.1:5180"],
      host: "127.0.0.1",
      port: 0,
      upstreamBaseUrl
    });
    bridges.push(bridge);

    const healthResponse = await fetch(`${bridge.baseUrl}/health`, {
      headers: { origin: "http://127.0.0.1:5180" }
    });
    const health = (await healthResponse.json()) as Record<string, unknown>;

    expect(healthResponse.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5180");
    expect(health).toMatchObject({
      ok: true,
      product: "masthead",
      runtime: {
        mode: "read_only_bridge",
        writable: false,
        upstream: {
          baseUrl: upstreamBaseUrl,
          daemonInstanceId: "fixture-daemon"
        }
      },
      bridge: {
        mode: "read_only",
        upstreamBaseUrl
      },
      projectionUrl: `${bridge.baseUrl}/projection`,
      readOnly: true
    });

    const projectionResponse = await fetch(`${bridge.baseUrl}/projection`, {
      headers: { origin: "http://127.0.0.1:5180" }
    });
    await expect(projectionResponse.json()).resolves.toMatchObject({ ok: true, source: "live", events: 3 });

    const sourcesResponse = await fetch(`${bridge.baseUrl}/sources`, {
      headers: { origin: "http://127.0.0.1:5180" }
    });
    await expect(sourcesResponse.json()).resolves.toMatchObject({
      ok: true,
      sources: [expect.objectContaining({ sourceId: "codex-sessions" })]
    });

    const logbookResponse = await fetch(`${bridge.baseUrl}/logbook/artifacts?q=Server`, {
      headers: { origin: "http://127.0.0.1:5180" }
    });
    await expect(logbookResponse.json()).resolves.toMatchObject({
      artifacts: [expect.objectContaining({ title: "Server logbook artifact" })],
      total: 1
    });

    const compatibilityLogbookResponse = await fetch(`${bridge.baseUrl}/logbook/search?q=Server`, {
      headers: { origin: "http://127.0.0.1:5180" }
    });
    const compatibilityLogbook = await compatibilityLogbookResponse.json();
    expect(compatibilityLogbook).toMatchObject({
      artifacts: [expect.objectContaining({ title: "Server logbook artifact" })],
      total: 1
    });
    expect(compatibilityLogbook).not.toHaveProperty("sessions");

    const excerptResponse = await fetch(`${bridge.baseUrl}/sessions/session-1/excerpts?limit=8`, {
      headers: { origin: "http://127.0.0.1:5180" }
    });
    await expect(excerptResponse.json()).resolves.toMatchObject({
      ok: true,
      excerpts: [expect.objectContaining({ text: "Bridge excerpt" })]
    });

    const blockedResponse = await fetch(`${bridge.baseUrl}/clear`, { method: "POST" });
    await expect(blockedResponse.json()).resolves.toMatchObject({
      ok: false,
      error: "read-only Masthead worktree bridge"
    });
    expect(blockedResponse.status).toBe(405);

    const blockedSourceWrite = await fetch(`${bridge.baseUrl}/sources/codex/import-metadata`, { method: "POST" });
    await expect(blockedSourceWrite.json()).resolves.toMatchObject({
      ok: false,
      error: "read-only Masthead worktree bridge"
    });
    expect(blockedSourceWrite.status).toBe(405);
  });
});

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
