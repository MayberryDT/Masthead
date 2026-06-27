#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const fixtureDir = resolve("fixtures/adapters/codex");
let id = 0;
let ownedTempDir;
let databasePath = process.env.MASTHEAD_DB_PATH;
let mcp;

try {
  if (!databasePath) {
    const seeded = await createSmokeDatabase();
    databasePath = seeded.databasePath;
    ownedTempDir = seeded.tempDir;
  }

  mcp = spawn(process.execPath, ["dist/daemon/src/mcp/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, MASTHEAD_DB_PATH: databasePath },
    stdio: ["pipe", "pipe", "pipe"]
  });

  const initialized = await rpc(mcp, "initialize", {});
  assert(initialized.result?.serverInfo?.name === "masthead", "initialize failed");
  const tools = await rpc(mcp, "tools/list", {});
  const toolNames = tools.result.tools.map((tool) => tool.name).sort();
  assert(JSON.stringify(toolNames) === JSON.stringify([
    "get_masthead_coverage",
    "get_project_history",
    "get_session",
    "get_session_excerpt",
    "list_project_sessions",
    "search_sessions"
  ]), `unexpected MCP tools: ${toolNames.join(", ")}`);
  assert(toolNames.every((name) => !/write|delete|clear|import|install|uninstall|approve|run|execute/i.test(name)), "MCP exposed a write-capable tool name");

  const search = await callTool(mcp, "search_sessions", { query: "Logbook", limit: 5 });
  assert(search.sessions.length > 0, "MCP search returned no sessions");
  assert(search.sessions[0].sourceRefs?.length > 0, "MCP search missing source refs");
  const sessionId = search.sessions[0].sessionId;
  const project = search.sessions[0].project || "Masthead";

  const session = await callTool(mcp, "get_session", { sessionId, maxBytes: 4_000 });
  assert(session.sourceRefs?.length > 0, "MCP session missing source refs");
  assert(JSON.stringify(session).includes("Historical untrusted"), "MCP session missing historical-untrusted label");

  const excerpt = await callTool(mcp, "get_session_excerpt", { sessionId, query: "Logbook", maxBytes: 512 });
  assert(excerpt.sourceRefs?.length > 0, "MCP excerpt missing source refs");
  assert(Buffer.byteLength(excerpt.text, "utf8") <= 512 + 128, "MCP excerpt exceeded response bound");
  assert(excerpt.text.includes("Historical untrusted"), "MCP excerpt missing historical-untrusted label");

  const projectSessions = await callTool(mcp, "list_project_sessions", { project, limit: 5 });
  assert(projectSessions.sessions.length > 0, "MCP project session list returned no sessions");

  const history = await callTool(mcp, "get_project_history", { project, limit: 5 });
  assert(history.sessions.length > 0, "MCP project history returned no sessions");

  const coverage = await callTool(mcp, "get_masthead_coverage", {});
  assert(coverage.sessions >= search.sessions.length, "MCP coverage did not include imported sessions");
  assert(dbCount(databasePath, "mcp_query_log") >= 6, "MCP query audit log was not written");

  const output = { ok: true, databasePath, tools: toolNames, auditRows: dbCount(databasePath, "mcp_query_log") };
  if (process.argv.includes("--json")) console.log(JSON.stringify(output, null, 2));
  else console.log(`Masthead MCP smoke passed. DB: ${databasePath}`);
} finally {
  if (mcp) await stopProcess(mcp);
  if (ownedTempDir && process.env.MASTHEAD_KEEP_SMOKE_DIR !== "1") await rm(ownedTempDir, { force: true, recursive: true });
}

async function createSmokeDatabase() {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-mcp-smoke-"));
  const codexHome = join(tempDir, "codex-home");
  const nested = join(codexHome, ".codex", "sessions", "2026", "06", "25", "masthead");
  const databasePath = join(tempDir, "masthead.sqlite");
  const storePath = join(tempDir, "events.ndjson");
  await mkdir(nested, { recursive: true });
  for (const name of ["rollout-basic.jsonl", "rollout-tools.jsonl", "rollout-compacted.jsonl", "rollout-partial.jsonl"]) {
    await cp(join(fixtureDir, name), join(nested, name));
  }
  let daemon;
  try {
    daemon = await startDaemon({ codexHome, databasePath, storePath });
    const sources = await postJson(daemon.baseUrl, "/sources/discover", {});
    const source = sources.sources?.find((entry) => entry.sourceId === "codex-sessions");
    assert(source, "expected Codex sessions source discovery");
    await runImport(daemon.baseUrl, source.sourceId, "metadata");
    await postJson(daemon.baseUrl, "/sources/codex/approve-transcripts", {});
    await runImport(daemon.baseUrl, source.sourceId, "transcript");
    assert(dbCount(databasePath, "sessions") >= 4, "expected seeded smoke sessions");
    return { databasePath, tempDir };
  } catch (error) {
    await rm(tempDir, { force: true, recursive: true });
    throw error;
  } finally {
    if (daemon) await stopDaemon(daemon);
  }
}

async function startDaemon({ codexHome, databasePath, storePath }) {
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

async function runImport(baseUrl, sourceId, kind) {
  const queued = await postJson(baseUrl, "/imports", { sourceId, kind });
  assert(queued.importJobId, `${kind} import job id missing`);
  return waitForImportJob(baseUrl, queued.importJobId);
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

function rpc(process, method, params) {
  return sendLine(process, { jsonrpc: "2.0", id: nextId(), method, params });
}

async function callTool(process, name, args) {
  const response = await rpc(process, "tools/call", { name, arguments: args });
  const text = response.result?.content?.[0]?.text;
  assert(typeof text === "string", `${name} returned no text content`);
  return JSON.parse(text);
}

function nextId() {
  id += 1;
  return id;
}

function sendLine(process, payload) {
  return new Promise((resolve, reject) => {
    let output = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => settle(reject, new Error(`MCP timeout waiting for ${payload.method}; stderr=${stderr}`)), 8_000);
    const cleanup = () => {
      clearTimeout(timeout);
      process.stdout.off("data", onStdout);
      process.stderr.off("data", onStderr);
      process.off("error", onError);
      process.off("exit", onExit);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onStdout = (chunk) => {
      output += chunk.toString();
      const lines = output.split("\n").filter(Boolean);
      if (lines.length === 0) return;
      try {
        settle(resolve, JSON.parse(lines[0]));
      } catch (error) {
        settle(reject, error);
      }
    };
    const onStderr = (chunk) => {
      stderr += chunk.toString();
    };
    const onError = (error) => settle(reject, error);
    const onExit = (code) => settle(reject, new Error(`MCP server exited ${code}; stderr=${stderr}`));
    process.stdout.on("data", onStdout);
    process.stderr.on("data", onStderr);
    process.on("error", onError);
    process.on("exit", onExit);
    process.stdin.write(`${JSON.stringify(payload)}\n`);
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

function dbCount(databasePath, table) {
  const db = new DatabaseSync(databasePath);
  try {
    return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  } finally {
    db.close();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function stopProcess(process) {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    process.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
