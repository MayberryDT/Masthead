#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const tempDir = await mkdtemp(join(tmpdir(), "masthead-endpoint-matrix-"));
let daemon;

try {
  const databasePath = join(tempDir, "masthead.sqlite");
  const storePath = join(tempDir, "legacy", "events.ndjson");

  daemon = await startDaemon({
    codexHome: join(tempDir, "codex-home"),
    databasePath,
    storePath
  });

  const matrix = await runEndpointMatrix(daemon.baseUrl);

  if (matrix.exitCode !== 0) {
    console.error(matrix.stdout);
    console.error(matrix.stderr);
    process.exit(matrix.exitCode);
  }

  console.log(matrix.stdout);
} finally {
  if (daemon) await stopChild(daemon.child, "SIGINT");
  if (process.env.MASTHEAD_KEEP_SMOKE_DIR !== "1") {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function startDaemon({ databasePath, storePath, codexHome }) {
  const child = spawn(process.execPath, ["scripts/masthead-ingest-server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MASTHEAD_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
      MASTHEAD_CODEX_HOME: codexHome,
      MASTHEAD_DATA_DIR: dirname(databasePath),
      MASTHEAD_DB_PATH: databasePath,
      MASTHEAD_GIT_REFRESH_MS: "0",
      MASTHEAD_PORT: "0",
      MASTHEAD_STORE_PATH: storePath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    const baseUrl = await readServerUrl(child);
    return { baseUrl, child };
  } catch (error) {
    await stopChild(child, "SIGINT");
    throw error;
  }
}

function readServerUrl(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => settle(reject, new Error(`daemon did not start: ${output}`)), 8_000);

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };

    const onStdout = (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) settle(resolve, `http://127.0.0.1:${match[1]}`);
    };

    const onStderr = (chunk) => {
      output += chunk.toString();
    };

    const onError = (error) => settle(reject, error);
    const onExit = (code) => {
      if (code !== null && code !== 0) settle(reject, new Error(`daemon exited ${code}: ${output}`));
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("error", onError);
    child.on("exit", onExit);
  });
}

function runEndpointMatrix(baseUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/masthead-endpoint-matrix.js", baseUrl], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

async function stopChild(child, signal) {
  if (child.exitCode !== null) return;
  child.kill(signal);
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
