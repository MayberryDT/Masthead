#!/usr/bin/env node
import { createServer } from "node:http";

const port = parsePort(process.argv[process.argv.indexOf("--port") + 1], 17373);
const host = "127.0.0.1";

const server = createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      events: 18,
      diagnostics: 0,
      gitSnapshots: 18,
      databasePath: "/tmp/masthead-legacy/masthead.sqlite"
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/projection") {
    sendJson(response, 200, {
      ok: true,
      source: "live",
      events: 18,
      projection: { cards: [] }
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/events") {
    sendJson(response, 200, { ok: true, events: [], diagnostics: [], gitSnapshots: [] });
    return;
  }

  if (request.method === "GET" && url.pathname === "/sources") {
    sendJson(response, 200, { ok: true, sources: [] });
    return;
  }

  sendJson(response, 404, { ok: false, error: "not found" });
});

server.listen(port, host, () => {
  console.log(`legacy Masthead fixture daemon listening at http://${host}:${port}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}
