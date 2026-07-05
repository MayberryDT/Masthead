import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import pkg from "./package.json" with { type: "json" };
import { REQUIRED_CLIENT_CAPABILITIES } from "./src/shared/protocol";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [mastheadConnectorManager()],
  server: {
    watch: {
      ignored: ["**/dist/**"]
    }
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    hookTimeout: 30_000,
    testTimeout: 30_000
  }
});

const connectorCommand = "node dist/daemon/src/daemon/main.js";
let collectorProcess: ChildProcess | undefined;
let collectorProcessBaseUrl: string | undefined;

function mastheadConnectorManager(): Plugin {
  return {
    name: "masthead-connector-manager",
    configureServer(server) {
      server.middlewares.use("/__masthead/connector/start", async (request, response) => {
        if (request.method !== "POST") {
          sendJson(response, 405, { ok: false, message: "Connector start requires POST." });
          return;
        }

        try {
          const result = await startCollectorFromDevServer(server.config.root);
          sendJson(response, 202, result);
        } catch (error) {
          sendJson(response, 500, {
            ok: false,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      });
    }
  };
}

export async function startCollectorFromDevServer(projectRoot: string) {
  const requestedPort = parsePort(process.env.MASTHEAD_PORT, 17373);
  const requestedBaseUrl = connectorBaseUrl(requestedPort);
  const probe = await probeCollector(requestedBaseUrl);
  if (probe.state === "compatible") {
    return connectorStartResult(false, requestedBaseUrl, "Local Masthead collector is already running.", probe.health);
  }

  const port = await resolveDevConnectorPort(requestedPort, probe.state, (startPort) => findAvailablePort("127.0.0.1", startPort));
  const baseUrl = connectorBaseUrl(port);
  if (collectorProcess && collectorProcess.exitCode === null) {
    const startingBaseUrl = collectorProcessBaseUrl ?? baseUrl;
    const health = await waitForCollector(startingBaseUrl);
    return connectorStartResult(false, startingBaseUrl, "Local Masthead collector is already starting.", health);
  }

  const scriptPath = join(projectRoot, "dist", "daemon", "src", "daemon", "main.js");
  if (!existsSync(scriptPath)) {
    throw new Error(`Masthead daemon build not found at ${scriptPath}. Run npm run build:daemon first.`);
  }

  collectorProcess = spawn(process.execPath, [scriptPath], {
    cwd: projectRoot,
    detached: true,
    env: {
      ...process.env,
      MASTHEAD_DATA_DIR: process.env.MASTHEAD_DATA_DIR,
      MASTHEAD_HOST: "127.0.0.1",
      MASTHEAD_PORT: String(port)
    },
    stdio: "ignore"
  });
  collectorProcess.unref();
  collectorProcessBaseUrl = baseUrl;

  const health = await waitForCollector(baseUrl);
  return connectorStartResult(true, baseUrl, "Started local Masthead collector.", health);
}

async function waitForCollector(baseUrl: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const probe = await probeCollector(baseUrl);
    if (probe.state === "compatible") return probe.health;
    await delay(120);
  }
  throw new Error("Started collector process, but /health did not respond with a compatible Masthead protocol.");
}

async function probeCollector(baseUrl: string): Promise<{ state: "compatible"; health: Record<string, unknown> } | { state: "incompatible" | "offline" }> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(400) });
    if (!response.ok) return { state: "incompatible" };
    let health: unknown;
    try {
      health = await response.json();
    } catch {
      return { state: "incompatible" };
    }
    return isCompatibleMastheadHealth(health) ? { state: "compatible", health } : { state: "incompatible" };
  } catch {
    return { state: "offline" };
  }
}

export function isCompatibleMastheadHealth(body: unknown): body is Record<string, unknown> {
  if (!body || typeof body !== "object") return false;
  const record = body as Record<string, unknown>;
  if (record.ok !== true || record.product !== "masthead" || record.apiVersion !== 1) return false;
  const capabilities = Array.isArray(record.capabilities) ? record.capabilities : [];
  if (!REQUIRED_CLIENT_CAPABILITIES.every((capability) => capabilities.includes(capability))) {
    return false;
  }
  const data = typeof record.data === "object" && record.data !== null ? (record.data as Record<string, unknown>) : undefined;
  return data?.migrationState !== "failed";
}

function connectorStartResult(started: boolean, baseUrl: string, message: string, health: Record<string, unknown>) {
  return { ok: true, started, command: connectorCommand, health, message, baseUrl, projectionUrl: `${baseUrl}/projection` };
}

function connectorBaseUrl(port = parsePort(process.env.MASTHEAD_PORT, 17373)): string {
  return `http://127.0.0.1:${port}`;
}

export async function resolveDevConnectorPort(
  requestedPort: number,
  probeState: "compatible" | "incompatible" | "offline",
  findPort: (startPort: number) => Promise<number>
): Promise<number> {
  return probeState === "incompatible" ? findPort(requestedPort + 1) : requestedPort;
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed;
  return fallback;
}

async function findAvailablePort(host: string, startPort: number): Promise<number> {
  for (let port = startPort; port <= 65535; port += 1) {
    if (await portAvailable(host, port)) return port;
  }
  throw new Error(`No available Masthead connector port found from ${startPort}.`);
}

function portAvailable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sendJson(response: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void }, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}
