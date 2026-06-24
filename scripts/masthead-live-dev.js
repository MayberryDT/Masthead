#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { buildLiveDevPlan, startReadOnlyConnectorBridge } from "../src/core/worktreeConnector.ts";

const plan = await buildLiveDevPlan(process.env);
const children = new Set();
const bridges = new Set();
let shuttingDown = false;

console.log("Starting Masthead live app");
console.log(`App:       ${plan.uiUrl}`);

let collector;
if (plan.connector.mode === "primary") {
  console.log(`Connector: ${plan.connector.baseUrl} (primary)`);
  collector = start("collector", process.execPath, ["scripts/masthead-ingest-server.js"], {
    MASTHEAD_HOST: plan.host,
    MASTHEAD_PORT: String(plan.connector.port),
    MASTHEAD_ALLOWED_ORIGINS: plan.allowedOrigins
  });

  await waitForHealth(`${plan.connector.baseUrl}/health`, 8_000);
} else {
  console.log(`Connector: ${plan.connector.baseUrl} (read-only worktree bridge)`);
  console.log(`Upstream:  ${plan.connector.upstreamBaseUrl}`);
  const bridge = await startReadOnlyConnectorBridge({
    allowedOrigins: plan.allowedOrigins,
    host: plan.host,
    port: plan.connector.port,
    upstreamBaseUrl: plan.connector.upstreamBaseUrl
  });
  bridges.add(bridge);
  await waitForHealth(`${bridge.baseUrl}/health`, 8_000);
}

const viteBin = resolve("node_modules/vite/bin/vite.js");
start("ui", process.execPath, [viteBin, "--host", plan.host, "--port", String(plan.uiPort), "--strictPort"], {
  VITE_MASTHEAD_PROJECTION_URL: plan.projectionUrl
});

console.log("Masthead is ready.");
console.log(`Open ${plan.uiUrl}`);

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

function start(label, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.add(child);

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => writePrefixed(label, chunk));
  child.stderr.on("data", (chunk) => writePrefixed(label, chunk));
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    console.error(`${label} exited${signal ? ` by ${signal}` : ""}${typeof code === "number" ? ` with ${code}` : ""}.`);
    stopAll(typeof code === "number" && code !== 0 ? code : 1);
  });

  return child;
}

async function waitForHealth(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (collector && collector.exitCode !== null) break;
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (response.ok) return;
    } catch {
      // Retry until the collector finishes binding.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Masthead collector did not become healthy at ${url}.`);
}

function writePrefixed(label, chunk) {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (!line) continue;
    console.log(`[${label}] ${line}`);
  }
}

function stopAll(exitCode = 0) {
  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
  for (const bridge of bridges) {
    void bridge.close();
  }
  setTimeout(() => process.exit(exitCode), 250).unref();
}
