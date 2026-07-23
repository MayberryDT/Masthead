import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolveMastheadDataPaths } from "../shared/dataPaths.ts";
import { classifyDaemonHealth } from "../shared/protocol.ts";
import { locateCompatibleDaemon } from "./daemonLocator.ts";
import { readDaemonOwnershipMetadata, type DaemonOwnershipMetadata } from "./daemonOwnership.ts";

export type ConnectorMode = "primary" | "bridge" | "isolated_primary";

export type LiveDevPlan = {
  host: string;
  uiPort: number;
  uiUrl: string;
  allowedOrigins: string;
  projectionUrl: string;
  connector:
    | {
        mode: "primary";
        port: number;
        baseUrl: string;
        dataDirectory: string;
      }
    | {
        mode: "bridge";
        port: number;
        baseUrl: string;
        upstreamBaseUrl: string;
      }
    | {
        mode: "isolated_primary";
        port: number;
        baseUrl: string;
        incompatibleAt: number;
        incompatibleBaseUrl: string;
        dataDirectory?: string;
      };
};

export type LiveDevProbes = {
  findAvailablePort?: (host: string, startPort: number) => Promise<number>;
  getConnectorHealth?: (baseUrl: string) => Promise<Record<string, unknown> | undefined>;
  getOwnedDaemonMetadata?: (dataDirectory: string) => Promise<DaemonOwnershipMetadata | undefined>;
  isPortAvailable?: (host: string, port: number) => Promise<boolean>;
};

export type ReadOnlyBridge = {
  baseUrl: string;
  close: () => Promise<void>;
  server: Server;
};

const defaultHost = "127.0.0.1";
const defaultConnectorPort = 17373;
const defaultUiPort = 5173;
const staticReadOnlyBridgePaths = new Set([
  "/health",
  "/projection",
  "/events",
  "/fixture",
  "/diagnostics/runtime",
  "/adapters",
  "/sources",
  "/sources/setup",
  "/sources/advanced",
  "/sources/connectors",
  "/sessions",
  "/projects",
  "/imports",
  "/data/summary",
  "/data/revisions",
  "/knowledge-flow/summary",
  "/usage/summary",
  "/mcp/status",
  "/mcp/launch-config",
  "/mcp/tools",
  "/mcp/audit",
  "/settings",
  "/settings/hooks",
  "/workbench/missing-sessions",
  "/workbench/sessions",
  "/workbench/activity",
  "/workbench/not-added-summary",
  "/workbench/import-health-summary",
  "/workbench/not-added",
  "/workbench/authoring/capabilities",
  "/workbench/authoring/canaries/pending",
  "/logbook/summary",
  "/logbook/artifacts",
  "/logbook/search"
]);

const staticReadOnlyBridgePostPaths: Record<string, true> = {
  "/imports/repair/preview": true,
  "/mcp/launch-config/validate": true,
  "/mcp/test-connection": true,
  "/settings/llm-provider/models": true
};

export function isAllowedReadOnlyBridgeRequest(method: string | undefined, pathname: string): boolean {
  if (method === "POST") return staticReadOnlyBridgePostPaths[pathname] === true;
  if (method !== "GET") return false;
  if (staticReadOnlyBridgePaths.has(pathname)) return true;
  return (
    /^\/workbench\/authoring\/requests\/[^/]+$/.test(pathname) ||
    /^\/workbench\/authoring\/assignments\/[^/]+\/(?:review|scaffold|receipt)$/.test(pathname) ||
    /^\/workbench\/authoring\/v5\/requests\/[^/]+(?:\/(?:bootstrap|receipt))?$/.test(pathname) ||
    /^\/workbench\/authoring\/v5\/packs\/[^/]+\/scaffold$/.test(pathname) ||
    /^\/workbench\/authoring\/runs\/[^/]+(?:\/(?:context|evidence))?$/.test(pathname) ||
    /^\/settings\/hooks\/[^/]+$/.test(pathname) ||
    /^\/logbook\/artifacts\/[^/]+$/.test(pathname) ||
    /^\/sessions\/[^/]+(?:\/excerpts|\/dossier|\/transcript)?$/.test(pathname) ||
    /^\/imports\/[^/]+(?:\/report)?$/.test(pathname)
  );
}

export async function buildLiveDevPlan(
  env: NodeJS.ProcessEnv = process.env,
  probes: LiveDevProbes = {}
): Promise<LiveDevPlan> {
  const host = env.MASTHEAD_HOST || defaultHost;
  const requestedConnectorPort = parsePort(env.MASTHEAD_PORT, defaultConnectorPort);
  const requestedUiPort = parsePort(env.MASTHEAD_UI_PORT, defaultUiPort);
  const findPort = probes.findAvailablePort ?? findAvailablePort;
  const getOwnedDaemon = probes.getOwnedDaemonMetadata ?? readDaemonOwnershipMetadata;
  const isAvailable = probes.isPortAvailable ?? isPortAvailable;
  const getHealth = probes.getConnectorHealth ?? getConnectorHealth;
  const uiPort = env.MASTHEAD_UI_PORT ? requestedUiPort : await findPort(host, requestedUiPort);
  const uiUrl = `http://${host}:${uiPort}`;
  const allowedOrigins = env.MASTHEAD_ALLOWED_ORIGINS || defaultAllowedOrigins(host, uiPort);
  const upstreamBaseUrl = connectorBaseUrl(
    env.MASTHEAD_UPSTREAM_URL || env.MASTHEAD_PRIMARY_CONNECTOR_URL || `http://${host}:${requestedConnectorPort}`
  );
  const connectorMode = env.MASTHEAD_CONNECTOR_MODE || "auto";
  const expectedDataDirectory = env.MASTHEAD_DATA_DIR;

  if (connectorMode === "primary") {
    return primaryPlan(host, requestedConnectorPort, uiPort, uiUrl, allowedOrigins, env);
  }

  if (connectorMode === "bridge") {
    await requireHealthyConnector(upstreamBaseUrl, getHealth);
    return bridgePlan(env, host, requestedConnectorPort, uiPort, uiUrl, allowedOrigins, upstreamBaseUrl, findPort);
  }

  if (connectorMode !== "auto") {
    throw new Error(`Unsupported MASTHEAD_CONNECTOR_MODE "${connectorMode}". Use auto, primary, or bridge.`);
  }

  if (await isAvailable(host, requestedConnectorPort)) {
    return primaryPlan(host, requestedConnectorPort, uiPort, uiUrl, allowedOrigins, env);
  }

  const located = await locateCompatibleDaemon(upstreamBaseUrl, getHealth);
  if (located.compatibility.state === "compatible") {
    return bridgePlan(env, host, requestedConnectorPort, uiPort, uiUrl, allowedOrigins, upstreamBaseUrl, findPort);
  }

  const ownedDaemon = await getOwnedDaemon(resolveMastheadDataPaths({ env }).dataDirectory);
  if (ownedDaemon) {
    const owned = await locateCompatibleDaemon(ownedDaemon.baseUrl, getHealth);
    if (owned.compatibility.state === "compatible") {
      return bridgePlan(env, host, requestedConnectorPort, uiPort, uiUrl, allowedOrigins, ownedDaemon.baseUrl, findPort);
    }
  }

  return isolatedPrimaryPlan(env, host, requestedConnectorPort, uiPort, uiUrl, allowedOrigins, findPort);
}

export async function startReadOnlyConnectorBridge(options: {
  allowedOrigins: string | string[];
  host: string;
  port: number;
  upstreamBaseUrl: string;
}): Promise<ReadOnlyBridge> {
  const allowedOrigins = Array.isArray(options.allowedOrigins)
    ? options.allowedOrigins
    : options.allowedOrigins
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
  const upstreamBaseUrl = connectorBaseUrl(options.upstreamBaseUrl);
  let baseUrl = `http://${options.host}:${options.port}`;

  const server = createServer((request, response) => {
    void handleBridgeRequest(request, response, {
      allowedOrigins,
      baseUrl,
      host: options.host,
      port: options.port,
      upstreamBaseUrl
    });
  });

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
    server.listen(options.port, options.host);
  });

  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : options.port;
  baseUrl = `http://${options.host}:${boundPort}`;

  return {
    baseUrl,
    server,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

export function connectorBaseUrl(input: string): string {
  const url = new URL(input);
  if (["/projection", "/health", "/events", "/fixture"].includes(url.pathname)) {
    url.pathname = "/";
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function bridgePlan(
  env: NodeJS.ProcessEnv,
  host: string,
  requestedConnectorPort: number,
  uiPort: number,
  uiUrl: string,
  allowedOrigins: string,
  upstreamBaseUrl: string,
  findPort: (host: string, startPort: number) => Promise<number>
): Promise<LiveDevPlan> {
  const requestedBridgePort = parsePort(env.MASTHEAD_BRIDGE_PORT, requestedConnectorPort + 1);
  const bridgePort = env.MASTHEAD_BRIDGE_PORT ? requestedBridgePort : await findPort(host, requestedBridgePort);
  const baseUrl = `http://${host}:${bridgePort}`;

  return {
    host,
    uiPort,
    uiUrl,
    allowedOrigins,
    projectionUrl: `${baseUrl}/projection`,
    connector: {
      mode: "bridge",
      port: bridgePort,
      baseUrl,
      upstreamBaseUrl
    }
  };
}

function primaryPlan(
  host: string,
  connectorPort: number,
  uiPort: number,
  uiUrl: string,
  allowedOrigins: string,
  env: NodeJS.ProcessEnv = process.env
): LiveDevPlan {
  const baseUrl = `http://${host}:${connectorPort}`;
  return {
    host,
    uiPort,
    uiUrl,
    allowedOrigins,
    projectionUrl: `${baseUrl}/projection`,
    connector: {
      mode: "primary",
      port: connectorPort,
      baseUrl,
      dataDirectory: resolveMastheadDataPaths({ env }).dataDirectory
    }
  };
}

async function isolatedPrimaryPlan(
  env: NodeJS.ProcessEnv,
  host: string,
  incompatibleAt: number,
  uiPort: number,
  uiUrl: string,
  allowedOrigins: string,
  findPort: (host: string, startPort: number) => Promise<number>
): Promise<LiveDevPlan> {
  const connectorPort = await findPort(host, incompatibleAt + 1);
  const baseUrl = `http://${host}:${connectorPort}`;
  return {
    host,
    uiPort,
    uiUrl,
    allowedOrigins,
    projectionUrl: `${baseUrl}/projection`,
    connector: {
      mode: "isolated_primary",
      port: connectorPort,
      baseUrl,
      incompatibleAt,
      incompatibleBaseUrl: `http://${host}:${incompatibleAt}`,
      dataDirectory: resolveMastheadDataPaths({ env }).dataDirectory
    }
  };
}

async function requireHealthyConnector(
  baseUrl: string,
  getHealth: (baseUrl: string) => Promise<Record<string, unknown> | undefined>
): Promise<void> {
  const health = await getHealth(baseUrl);
  const compatibility = classifyDaemonHealth(health);
  if (compatibility.state === "compatible") return;
  throw new Error(
    `Port ${new URL(baseUrl).port} is busy, but no compatible Masthead connector responded at ${baseUrl}/health (${compatibility.state}).`
  );
}

async function handleBridgeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    allowedOrigins: string[];
    baseUrl: string;
    host: string;
    port: number;
    upstreamBaseUrl: string;
  }
): Promise<void> {
  const requestUrl = new URL(request.url || "/", `http://${options.host}:${options.port}`);
  const headers = corsHeaders(request, options.allowedOrigins);

  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }

  if (!isAllowedReadOnlyBridgeRequest(request.method, requestUrl.pathname)) {
    sendJson(response, 405, headers, { ok: false, error: "read-only Masthead worktree bridge" });
    return;
  }

  try {
    const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, `${options.upstreamBaseUrl}/`);
    const method = request.method || "GET";
    const requestBody = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(request);
    const requestHeaders: Record<string, string> = { accept: request.headers.accept || "application/json" };
    if (typeof request.headers["content-type"] === "string") requestHeaders["content-type"] = request.headers["content-type"];
    const upstreamResponse = await fetch(target, {
      body: requestBody,
      headers: requestHeaders,
      method
    });
    const body = await upstreamResponse.text();
    const contentType = upstreamResponse.headers.get("content-type") || "application/json";
    response.writeHead(upstreamResponse.status, {
      ...headers,
      "cache-control": upstreamResponse.headers.get("cache-control") || "no-cache",
      "content-type": contentType
    });
    response.end(requestUrl.pathname === "/health" ? rewriteHealthBody(body, options) : body);
  } catch (error) {
    sendJson(response, 502, headers, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function rewriteHealthBody(
  body: string,
  options: {
    baseUrl: string;
    upstreamBaseUrl: string;
  }
): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const runtime = isRecord(parsed.runtime) ? parsed.runtime : undefined;
    const upstreamDaemonInstanceId =
      runtime && typeof runtime.daemonInstanceId === "string" ? runtime.daemonInstanceId : "legacy/unknown";
    return JSON.stringify(
      {
        ...parsed,
        ...(runtime
          ? {
              runtime: {
                ...runtime,
                mode: "read_only_bridge",
                writable: false,
                baseUrl: options.baseUrl,
                instanceDir: undefined,
                instanceManifest: undefined,
                authoringCommand: undefined,
                host: options.baseUrl ? new URL(options.baseUrl).hostname : runtime.host,
                port: options.baseUrl ? Number(new URL(options.baseUrl).port) : runtime.port,
                upstream: {
                  baseUrl: options.upstreamBaseUrl,
                  daemonInstanceId: upstreamDaemonInstanceId
                }
              }
            }
          : {}),
        bridge: {
          mode: "read_only",
          upstreamBaseUrl: options.upstreamBaseUrl
        },
        eventsUrl: `${options.baseUrl}/events`,
        projectionUrl: `${options.baseUrl}/projection`,
        readOnly: true
      },
      null,
      2
    );
  } catch {
    return body;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  }
  return body;
}


function corsHeaders(request: IncomingMessage, allowedOrigins: string[]): Record<string, string> {
  const origin = request.headers.origin;
  const allowedOrigin = typeof origin === "string" && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-origin": allowedOrigin,
    "vary": "origin"
  };
}

function sendJson(response: ServerResponse, status: number, headers: Record<string, string>, body: unknown): void {
  response.writeHead(status, { ...headers, "content-type": "application/json" });
  response.end(JSON.stringify(body, null, 2));
}

async function getConnectorHealth(baseUrl: string): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await fetch(`${connectorBaseUrl(baseUrl)}/health`, { headers: { accept: "application/json" } });
    if (!response.ok) return undefined;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function findAvailablePort(host: string, startPort: number): Promise<number> {
  for (let port = startPort; port <= 65535; port += 1) {
    if (await isPortAvailable(host, port)) return port;
  }
  throw new Error(`No available port found at or above ${startPort}.`);
}

async function isPortAvailable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function defaultAllowedOrigins(host: string, uiPort: number): string {
  const origins = new Set([`http://${host}:${uiPort}`, "masthead://app"]);
  if (host === "127.0.0.1") origins.add(`http://localhost:${uiPort}`);
  if (host === "localhost") origins.add(`http://127.0.0.1:${uiPort}`);
  return Array.from(origins).join(",");
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed;
  return fallback;
}
