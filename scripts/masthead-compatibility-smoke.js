#!/usr/bin/env node

import { createServer } from "node:http";
import { BLOCKED_MUTATION_ENDPOINTS, READ_ONLY_ENDPOINTS, READ_ONLY_POST_ENDPOINTS, validateEndpointMatrix } from "./masthead-endpoint-matrix.js";

const { startReadOnlyConnectorBridge } = await import("../dist/daemon/src/core/worktreeConnector.js");

const upstreamRequests = [];
const upstream = createServer((request, response) => {
  void handleUpstream(request, response, upstreamRequests);
});
let bridge;

try {
  const matrix = await validateEndpointMatrix();
  assert(matrix.ok, `endpoint matrix failed: ${matrix.checks.filter((check) => !check.ok).map((check) => check.label).join(", ")}`);

  await listen(upstream, 0, "127.0.0.1");
  const upstreamBaseUrl = serverBaseUrl(upstream);
  bridge = await startReadOnlyConnectorBridge({
    allowedOrigins: "http://127.0.0.1:5173",
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl
  });

  for (const entry of READ_ONLY_ENDPOINTS) {
    const response = await fetch(`${bridge.baseUrl}${entry.path}`, {
      headers: { accept: "application/json", origin: "http://127.0.0.1:5173" },
      method: entry.method
    });
    assert(response.ok, `${entry.method} ${entry.path} returned ${response.status}`);
    assert(response.headers.get("access-control-allow-origin") === "http://127.0.0.1:5173", `${entry.path} missing bridge CORS header`);
    const body = await response.json();
    assert(body.ok === true, `${entry.path} did not return an ok upstream body`);
    if (entry.path === "/health") {
      assert(body.readOnly === true, "bridge health did not mark readOnly");
      assert(body.bridge?.mode === "read_only", "bridge health missing read_only mode");
      assert(body.projectionUrl === `${bridge.baseUrl}/projection`, "bridge health did not rewrite projectionUrl");
      assert(body.eventsUrl === `${bridge.baseUrl}/events`, "bridge health did not rewrite eventsUrl");
    }
  }

  for (const entry of READ_ONLY_POST_ENDPOINTS) {
    const response = await fetch(`${bridge.baseUrl}${entry.path}`, {
      body: JSON.stringify(entry.body ?? {}),
      headers: { accept: "application/json", "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      method: entry.method
    });
    assert(response.ok, `${entry.method} ${entry.path} returned ${response.status}`);
    const body = await response.json();
    assert(body.ok === true, `${entry.path} did not return ok`);
    assert(body.forwardedBody === JSON.stringify(entry.body ?? {}), `${entry.path} did not forward request body`);
  }

  const upstreamCountBeforeBlocked = upstreamRequests.length;
  for (const entry of BLOCKED_MUTATION_ENDPOINTS) {
    const response = await fetch(`${bridge.baseUrl}${entry.path}`, {
      body: JSON.stringify({ blocked: true }),
      headers: { accept: "application/json", "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      method: entry.method
    });
    assert(response.status === 405, `${entry.method} ${entry.path} should be blocked, got ${response.status}`);
    const body = await response.json();
    assert(body.error === "read-only Masthead worktree bridge", `${entry.path} returned the wrong block reason`);
  }
  assert(upstreamRequests.length === upstreamCountBeforeBlocked, "blocked mutation endpoints reached the upstream connector");

  const output = {
    ok: true,
    bridgeBaseUrl: bridge.baseUrl,
    upstreamBaseUrl,
    allowedReadEndpoints: READ_ONLY_ENDPOINTS.length,
    allowedPostEndpoints: READ_ONLY_POST_ENDPOINTS.length,
    blockedMutationEndpoints: BLOCKED_MUTATION_ENDPOINTS.length
  };
  if (process.argv.includes("--json")) console.log(JSON.stringify(output, null, 2));
  else console.log(`Masthead compatibility smoke passed. Bridge: ${bridge.baseUrl}`);
} finally {
  if (bridge) await bridge.close();
  await closeServer(upstream);
}

async function handleUpstream(request, response, requests) {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const body = await readRequestBody(request);
  requests.push({ method: request.method, path: `${url.pathname}${url.search}`, body });

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      events: 3,
      gitSnapshots: 1,
      projectionUrl: `${serverBaseUrl(upstream)}/projection`,
      eventsUrl: `${serverBaseUrl(upstream)}/events`
    });
    return;
  }

  if (request.method === "GET") {
    sendJson(response, 200, responseBodyForGet(url));
    return;
  }

  if (request.method === "POST" && (url.pathname === "/mcp/launch-config/validate" || url.pathname === "/mcp/test-connection")) {
    sendJson(response, 200, { ok: true, endpoint: url.pathname, forwardedBody: body });
    return;
  }

  sendJson(response, 500, { ok: false, error: `unexpected upstream request ${request.method} ${url.pathname}` });
}

function responseBodyForGet(url) {
  if (url.pathname === "/sessions/session-1") return { ok: true, session: { sessionId: "session-1", title: "Bridge session" } };
  if (url.pathname === "/sessions/session-1/excerpts") return { ok: true, excerpts: [{ excerptId: "excerpt-1", text: "Bridge excerpt" }] };
  if (url.pathname === "/imports/import-1") return { ok: true, job: { importJobId: "import-1", status: "succeeded" } };
  if (url.pathname === "/mcp/status") return { ok: true, status: { ready: true, readOnly: true } };
  if (url.pathname === "/mcp/launch-config") return { ok: true, launchConfig: { command: process.execPath, args: ["server.js"], env: {} }, validation: { ready: true } };
  if (url.pathname === "/mcp/tools") return { ok: true, tools: [{ name: "search_sessions" }] };
  if (url.pathname === "/mcp/audit") return { ok: true, audit: [] };
  if (url.pathname === "/settings") return { ok: true, settings: { runtime: { collector: { status: "ready" } } } };
  if (url.pathname === "/settings/hooks/codex") return { ok: true, hooks: { installed: true } };
  if (url.pathname === "/logbook/search") return { ok: true, sessions: [{ sessionId: "session-1" }], total: 1 };
  return { ok: true, endpoint: url.pathname };
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function serverBaseUrl(server) {
  const address = server.address();
  assert(typeof address === "object" && address, "server does not have an address");
  return `http://127.0.0.1:${address.port}`;
}

async function readRequestBody(request) {
  let body = "";
  for await (const chunk of request) body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  return body;
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body, null, 2));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
