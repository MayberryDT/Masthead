import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";

export default defineConfig({
  plugins: [mastheadConnectorManager()],
  server: {
    watch: {
      ignored: ["**/src-tauri/target/**", "**/src-tauri/gen/**", "**/dist/**"]
    }
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"]
  }
});

const connectorCommand = "node dist/daemon/src/daemon/main.js";
let collectorProcess: ChildProcess | undefined;

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

async function startCollectorFromDevServer(projectRoot: string) {
  if (await collectorHealthy()) {
    return {
      ok: true,
      started: false,
      command: connectorCommand,
      message: "Local Masthead collector is already running."
    };
  }

  if (collectorProcess && collectorProcess.exitCode === null) {
    return {
      ok: true,
      started: false,
      command: connectorCommand,
      message: "Local Masthead collector is already starting."
    };
  }

  const scriptPath = join(projectRoot, "dist", "daemon", "src", "daemon", "main.js");
  if (!existsSync(scriptPath)) {
    throw new Error(`Masthead daemon build not found at ${scriptPath}. Run npm run build:daemon first.`);
  }

  collectorProcess = spawn(process.execPath, [scriptPath], {
    cwd: projectRoot,
    detached: true,
    env: { ...process.env, MASTHEAD_HOST: "127.0.0.1", MASTHEAD_PORT: process.env.MASTHEAD_PORT ?? "17373" },
    stdio: "ignore"
  });
  collectorProcess.unref();

  await waitForCollector();
  return {
    ok: true,
    started: true,
    command: connectorCommand,
    message: "Started local Masthead collector."
  };
}

async function waitForCollector(): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (await collectorHealthy()) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("Started collector process, but /health did not respond.");
}

async function collectorHealthy(): Promise<boolean> {
  try {
    const response = await fetch("http://127.0.0.1:17373/health", {
      signal: AbortSignal.timeout(400)
    });
    return response.ok;
  } catch {
    return false;
  }
}

function sendJson(response: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void }, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}
