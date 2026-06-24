import { createServer, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { buildLiveDevPlan, connectorBaseUrl, startReadOnlyConnectorBridge, type ReadOnlyBridge } from "../worktreeConnector";

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
        getConnectorHealth: async () => ({ ok: true, events: 12 }),
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

  test("accepts an upstream projection URL but stores its connector base URL", () => {
    expect(connectorBaseUrl("http://127.0.0.1:17373/projection?selectedSessionId=s1")).toBe("http://127.0.0.1:17373");
  });

  test("proxies read endpoints through a read-only worktree bridge", async () => {
    const upstream = createServer((request, response) => {
      if (request.url === "/health") {
        sendJson(response, 200, {
          ok: true,
          events: 3,
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

    const blockedResponse = await fetch(`${bridge.baseUrl}/clear`, { method: "POST" });
    await expect(blockedResponse.json()).resolves.toMatchObject({
      ok: false,
      error: "read-only Masthead worktree bridge"
    });
    expect(blockedResponse.status).toBe(405);
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
