#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const host = process.env.MASTHEAD_HOST || "127.0.0.1";
const collectorPort = process.env.MASTHEAD_PORT || "17373";
const uiPort = process.env.MASTHEAD_UI_PORT || "5173";
const projectionUrl = `http://${host}:${collectorPort}/projection`;
const allowedOrigins =
  process.env.MASTHEAD_ALLOWED_ORIGINS || `http://${host}:${uiPort},http://localhost:${uiPort},tauri://localhost,http://tauri.localhost`;
const children = new Set();
let shuttingDown = false;

console.log("Starting Masthead live app");
console.log(`Collector: http://${host}:${collectorPort}`);
console.log(`App:       http://${host}:${uiPort}`);

const collector = start("collector", process.execPath, ["scripts/masthead-ingest-server.js"], {
  MASTHEAD_HOST: host,
  MASTHEAD_PORT: collectorPort,
  MASTHEAD_ALLOWED_ORIGINS: allowedOrigins
});

await waitForHealth(`http://${host}:${collectorPort}/health`, 8_000);

const viteBin = resolve("node_modules/vite/bin/vite.js");
start("ui", process.execPath, [viteBin, "--host", host, "--port", uiPort, "--strictPort"], {
  VITE_MASTHEAD_PROJECTION_URL: projectionUrl
});

console.log("Masthead is ready.");
console.log(`Open http://${host}:${uiPort}`);

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
    if (collector.exitCode !== null) break;
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
  setTimeout(() => process.exit(exitCode), 250).unref();
}
