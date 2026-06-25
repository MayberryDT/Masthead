#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const fixtureDir = resolve("fixtures/adapters/codex");
const tempDir = await mkdtemp(join(tmpdir(), "masthead-import-smoke-"));
let server;
let restarted;

try {
  const codexHome = join(tempDir, "codex-home");
  const nested = join(codexHome, ".codex", "sessions", "2026", "06", "25", "masthead");
  const databasePath = join(tempDir, "masthead.sqlite");
  const storePath = join(tempDir, "events.ndjson");
  await mkdir(nested, { recursive: true });
  await copyTranscriptFixtures(nested);

  server = await startDaemon({ codexHome, databasePath, storePath });
  const sourceId = await assertCodexSource(server.baseUrl);
  await runImport(server.baseUrl, sourceId, "metadata");
  await postJson(server.baseUrl, "/sources/codex/approve-transcripts", {});
  await runImport(server.baseUrl, sourceId, "transcript");

  assertDb(databasePath, {
    minSessions: 4,
    minMessages: 3,
    minToolCalls: 1
  });
  await assertSearch(server.baseUrl);

  const beforeRestart = dbCounts(databasePath, ["sessions", "messages", "tool_calls", "tool_results", "session_search", "import_jobs"]);
  await stopDaemon(server);
  server = undefined;

  restarted = await startDaemon({ codexHome, databasePath, storePath });
  await runImport(restarted.baseUrl, sourceId, "metadata");
  await runImport(restarted.baseUrl, sourceId, "transcript");
  const afterRestart = dbCounts(databasePath, ["sessions", "messages", "tool_calls", "tool_results", "session_search", "import_jobs"]);
  assertCountsStable(afterRestart, beforeRestart, ["sessions", "messages", "tool_calls", "tool_results", "session_search"]);
  assert(afterRestart.import_jobs >= beforeRestart.import_jobs, "import job audit rows should remain append-only");

  const output = {
    ok: true,
    databasePath,
    imported: dbCounts(databasePath, ["sessions", "turns", "messages", "tool_calls", "tool_results", "session_search"]),
    tempDir: process.env.MASTHEAD_KEEP_SMOKE_DIR === "1" ? tempDir : undefined
  };
  if (process.argv.includes("--json")) console.log(JSON.stringify(output, null, 2));
  else console.log(`Masthead import smoke passed. DB: ${databasePath}`);
} finally {
  if (server) await stopDaemon(server);
  if (restarted) await stopDaemon(restarted);
  if (process.env.MASTHEAD_KEEP_SMOKE_DIR !== "1") await rm(tempDir, { force: true, recursive: true });
}

async function copyTranscriptFixtures(targetDir) {
  for (const name of ["rollout-basic.jsonl", "rollout-tools.jsonl", "rollout-compacted.jsonl", "rollout-partial.jsonl"]) {
    await cp(join(fixtureDir, name), join(targetDir, name));
  }
}

async function assertCodexSource(baseUrl) {
  const sources = await getJson(baseUrl, "/sources");
  assert(Array.isArray(sources.sources) && sources.sources.length > 0, "expected source discovery results");
  const sessionSource = sources.sources.find((source) => source.sourceId === "codex-sessions");
  assert(sessionSource, "expected Codex sessions source discovery");
  return sessionSource.sourceId;
}

async function runImport(baseUrl, sourceId, kind) {
  const queued = await postJson(baseUrl, "/imports", { sourceId, kind });
  assert(queued.importJobId, `${kind} import job id missing`);
  return waitForImportJob(baseUrl, queued.importJobId);
}

async function assertSearch(baseUrl) {
  const search = await getJson(baseUrl, "/logbook/search?q=Logbook&limit=10");
  assert(search.sessions?.length > 0, "expected Logbook search results");
  const sessions = await getJson(baseUrl, "/sessions?q=Logbook&limit=10");
  assert(sessions.sessions?.length > 0, "expected canonical session search results");
}

async function startDaemon({ codexHome, databasePath, storePath }) {
  const child = spawn(process.execPath, ["scripts/masthead-ingest-server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MASTHEAD_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
      MASTHEAD_CODEX_HOME: codexHome,
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

async function stopDaemon(instance) {
  await stopChild(instance.child, "SIGINT");
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
  const deadline = Date.now() + 5_000;
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

function assertCountsStable(actual, expected, tables) {
  for (const table of tables) {
    assert(actual[table] === expected[table], `expected stable ${table}: expected ${expected[table]}, got ${actual[table]}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
