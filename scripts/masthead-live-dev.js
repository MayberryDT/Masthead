#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { removeDaemonOwnershipMetadata, writeDaemonOwnershipMetadata } from "../dist/daemon/src/core/daemonOwnership.js";
import { buildLiveDevDaemonEnv } from "../dist/daemon/src/core/liveDevDaemonEnv.js";
import { buildLiveDevPlan, startReadOnlyConnectorBridge } from "../dist/daemon/src/core/worktreeConnector.js";
import { classifyDaemonHealth } from "../dist/daemon/src/shared/protocol.js";

loadLocalEnv();

const children = new Set();
const bridges = new Set();
let shuttingDown = false;
const healthTimeoutMs = Number.parseInt(process.env.MASTHEAD_DEV_HEALTH_TIMEOUT_MS ?? "60000", 10);
let collector;
let activeHealth;
let ownershipPath;
let outputClosed = false;

process.stdout.on("error", handleOutputError);
process.stderr.on("error", handleOutputError);

try {
  const plan = await buildLiveDevPlan(process.env);

  writeLine("Starting Masthead live app");
  writeLine(`App:       ${plan.uiUrl}`);

  if (plan.connector.mode === "primary" || plan.connector.mode === "isolated_primary") {
    if (plan.connector.mode === "isolated_primary") {
      writeLine(`Found incompatible Masthead daemon at ${plan.connector.incompatibleBaseUrl}`, "warn");
      writeLine("Starting current daemon on an isolated port.", "warn");
    }
    writeLine(`Connector: ${plan.connector.baseUrl} (${plan.connector.mode === "primary" ? "primary" : "isolated primary"})`);
    collector = start(
      "collector",
      process.execPath,
      ["dist/daemon/src/daemon/main.js"],
      buildLiveDevDaemonEnv({
        allowedOrigins: plan.allowedOrigins,
        dataDirectory: plan.connector.dataDirectory,
        diagnosticLogFile: join(plan.connector.dataDirectory, "runtime", "daemon.log"),
        env: process.env,
        host: plan.host,
        port: plan.connector.port
      })
    );

    activeHealth = await waitForHealth(`${plan.connector.baseUrl}/health`, healthTimeoutMs);
    ownershipPath = await writeOwnership(plan.connector.baseUrl, activeHealth);
  } else {
    writeLine(`Connector: ${plan.connector.baseUrl} (read-only worktree bridge)`);
    writeLine(`Upstream:  ${plan.connector.upstreamBaseUrl}`);
    const bridge = await startReadOnlyConnectorBridge({
      allowedOrigins: plan.allowedOrigins,
      host: plan.host,
      port: plan.connector.port,
      upstreamBaseUrl: plan.connector.upstreamBaseUrl
    });
    bridges.add(bridge);
    activeHealth = await waitForHealth(`${bridge.baseUrl}/health`, healthTimeoutMs);
  }

  printStartupIdentity(plan, activeHealth);

  const viteBin = resolve("node_modules/vite/bin/vite.js");
  start("ui", process.execPath, [viteBin, "--host", plan.host, "--port", String(plan.uiPort), "--strictPort"], {
    NODE_OPTIONS: process.env.MASTHEAD_DEV_NODE_OPTIONS ?? "",
    VITE_MASTHEAD_PROJECTION_URL: plan.projectionUrl
  });

  writeLine("Masthead is ready.");
  writeLine(`Open ${plan.uiUrl}`);
} catch (error) {
  writeLine(error instanceof Error ? error.stack ?? error.message : String(error), "error");
  stopAll(1);
}
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
    writeLine(`${label} exited${signal ? ` by ${signal}` : ""}${typeof code === "number" ? ` with ${code}` : ""}.`, "error");
    stopAll(typeof code === "number" && code !== 0 ? code : 1);
  });

  return child;
}

function loadLocalEnv() {
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = unquoteEnvValue(match[2]);
    }
  }
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function waitForHealth(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (collector && collector.exitCode !== null) break;
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (response.ok) {
        const health = await response.json();
        if (classifyDaemonHealth(health).state === "compatible") return health;
      }
    } catch {
      // Retry until the collector finishes binding.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Masthead collector did not become healthy at ${url}.`);
}

async function writeOwnership(baseUrl, health) {
  const dataDirectory = health?.data?.dataDirectory;
  const daemonInstanceId = health?.runtime?.daemonInstanceId;
  if (!dataDirectory || !daemonInstanceId) return undefined;
  return writeDaemonOwnershipMetadata(dataDirectory, {
    daemonInstanceId,
    pid: collector.pid,
    baseUrl,
    apiVersion: health.apiVersion,
    buildSha: health.buildSha,
    dataDirectory,
    startedAt: health.runtime.startedAt
  });
}

function printStartupIdentity(plan, health) {
  writeLine("Runtime identity");
  writeLine(`UI:        ${plan.uiUrl}`);
  writeLine(`Daemon:    ${plan.connector.baseUrl}`);
  writeLine(`Mode:      ${health?.runtime?.mode ?? plan.connector.mode}`);
  writeLine(`API:       ${health?.apiVersion ?? "unknown"}`);
  writeLine(`Build SHA: ${health?.buildSha ?? "unknown"}`);
  writeLine(`Database:  ${health?.data?.databasePath ?? "unknown"}`);
  writeLine(`DB ID:     ${health?.data?.databaseId ?? "unknown"}`);
  writeLine(`Source root: ${process.env.MASTHEAD_CODEX_HOME ?? "default"}`);
}

function writePrefixed(label, chunk) {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (!line) continue;
    writeLine(`[${label}] ${line}`);
  }
}

function writeLine(message, method = "log") {
  if (outputClosed) return;
  try {
    console[method](message);
  } catch (error) {
    if (isBrokenPipeError(error)) {
      outputClosed = true;
      return;
    }
    throw error;
  }
}

function handleOutputError(error) {
  if (isBrokenPipeError(error)) {
    outputClosed = true;
    return;
  }
  throw error;
}

function isBrokenPipeError(error) {
  return typeof error === "object" && error !== null && error.code === "EPIPE";
}

function stopAll(exitCodeOrSignal = 0) {
  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
  for (const bridge of bridges) {
    void bridge.close();
  }
  void removeDaemonOwnershipMetadata(ownershipPath);
  const exitCode = signalExitCode(exitCodeOrSignal);
  setTimeout(() => process.exit(exitCode), 250).unref();
}

function signalExitCode(value) {
  if (typeof value === "number") return value;
  if (value === "SIGINT") return 130;
  if (value === "SIGTERM") return 143;
  return 1;
}
