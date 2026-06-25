#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const fixtureDir = resolve("fixtures/adapters/codex");
const statePath = resolve(".masthead/smoke-import-state.json");

const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-smoke-"));
let server;
let restarted;

try {
  const codexHome = join(tempDir, "codex-home");
  const nested = join(codexHome, ".codex", "sessions", "2026", "06", "25", "masthead");
  const databasePath = join(tempDir, "masthead.sqlite");
  const storePath = join(tempDir, "events.ndjson");
  await mkdir(nested, { recursive: true });
  await cp(join(fixtureDir, "rollout-basic.jsonl"), join(nested, "rollout-basic.jsonl"));
  await cp(join(fixtureDir, "rollout-tools.jsonl"), join(nested, "rollout-tools.jsonl"));
  await cp(join(fixtureDir, "rollout-compacted.jsonl"), join(nested, "rollout-compacted.jsonl"));
  await cp(join(fixtureDir, "rollout-partial.jsonl"), join(nested, "rollout-partial.jsonl"));

  server = await startDaemon({ codexHome, databasePath, storePath });
  const sources = await getJson(server.baseUrl, "/sources");
  assert(sources.sources.length > 0, "expected Codex source discovery");
  const sessionSource = sources.sources.find((source) => source.sourceId === "codex-sessions");
  assert(sessionSource, "expected Codex sessions source discovery");
  const sourceId = sessionSource.sourceId;

  const metadata = await postJson(server.baseUrl, "/imports", { sourceId, kind: "metadata" });
  assert(metadata.importJobId, "metadata import job id missing");
  await waitForImportJob(server.baseUrl, metadata.importJobId);
  await postJson(server.baseUrl, "/sources/codex/approve-transcripts", {});
  const transcript = await postJson(server.baseUrl, "/imports", { sourceId, kind: "transcript" });
  assert(transcript.importJobId, "transcript import job id missing");
  await waitForImportJob(server.baseUrl, transcript.importJobId);

  assertDb(databasePath, {
    minSessions: 4,
    minMessages: 3,
    minToolCalls: 1
  });
  const search = await getJson(server.baseUrl, "/logbook/search?q=Logbook&limit=10");
  assert(search.sessions.length > 0, "expected Logbook search results");

  const beforeRestart = dbCounts(databasePath, ["sessions", "messages", "tool_calls", "tool_results", "session_search"]);
  await stopDaemon(server);
  server = undefined;

  restarted = await startDaemon({ codexHome, databasePath, storePath });
  const restartMetadata = await postJson(restarted.baseUrl, "/imports", { sourceId, kind: "metadata" });
  await waitForImportJob(restarted.baseUrl, restartMetadata.importJobId);
  const restartTranscript = await postJson(restarted.baseUrl, "/imports", { sourceId, kind: "transcript" });
  await waitForImportJob(restarted.baseUrl, restartTranscript.importJobId);
  const afterRestart = dbCounts(databasePath, ["sessions", "messages", "tool_calls", "tool_results", "session_search"]);
  assertCountsEqual(afterRestart, beforeRestart, "expected idempotent import counts after restart");

  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({ databasePath, codexHome, generatedAt: new Date().toISOString() }, null, 2), "utf8");
  console.log(`Masthead import smoke passed. DB: ${databasePath}`);
} finally {
  if (server) await stopDaemon(server);
  if (restarted) await stopDaemon(restarted);
}

async function startDaemon({ codexHome, databasePath, storePath }) {
  const child = spawn(process.execPath, ["scripts/masthead-ingest-server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MASTHEAD_CODEX_HOME: codexHome,
      MASTHEAD_DB_PATH: databasePath,
      MASTHEAD_STORE_PATH: storePath,
      MASTHEAD_PORT: "0",
      MASTHEAD_GIT_REFRESH_MS: "0"
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
    const timeout = setTimeout(() => {
      settle(reject, new Error(`daemon did not start: ${output}`));
    }, 8_000);
    const onStdout = (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      settle(resolve, `http://127.0.0.1:${match[1]}`);
    };
    const onStderr = (chunk) => {
      output += chunk.toString();
    };
    const onError = (error) => {
      settle(reject, error);
    };
    const onExit = (code) => {
      if (code !== null && code !== 0) {
        settle(reject, new Error(`daemon exited ${code}: ${output}`));
      }
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("error", onError);
    child.on("exit", onExit);
  });
}

async function stopDaemon(server) {
  await stopChild(server.child, "SIGINT");
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

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

async function waitForImportJob(baseUrl, importJobId) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const response = await getJson(baseUrl, `/imports/${importJobId}`);
    if (response.job?.status === "succeeded") return response.job;
    if (response.job?.status === "failed") throw new Error(`import job failed: ${response.job.failureMessage || importJobId}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for import job: ${importJobId}`);
}

function assertDb(databasePath, { minSessions, minMessages, minToolCalls }) {
  assert(dbCount(databasePath, "sessions") >= minSessions, "expected canonical sessions");
  assert(dbCount(databasePath, "messages") >= minMessages, "expected canonical messages");
  assert(dbCount(databasePath, "tool_calls") >= minToolCalls, "expected canonical tool calls");
}

function dbCount(databasePath, table) {
  const db = new DatabaseSync(databasePath);
  try {
    return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  } finally {
    db.close();
  }
}

function dbCounts(databasePath, tables) {
  return Object.fromEntries(tables.map((table) => [table, dbCount(databasePath, table)]));
}

function assertCountsEqual(actual, expected, message) {
  for (const [table, count] of Object.entries(expected)) {
    assert(actual[table] === count, `${message}: ${table} expected ${count}, got ${actual[table]}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
