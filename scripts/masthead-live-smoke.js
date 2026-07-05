#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const tempDir = await mkdtemp(join(tmpdir(), "masthead-live-smoke-"));
let server;

try {
  const databasePath = join(tempDir, "masthead.sqlite");
  const storePath = join(tempDir, "events.ndjson");
  server = await startDaemon({ codexHome: join(tempDir, "codex-home"), databasePath, storePath });

  const health = await getJson(server.baseUrl, "/health");
  assert(health.ok === true, "health did not report ok");
  assert(health.databasePath === databasePath, "health reported the wrong database path");
  assert(health.storePath === storePath, "health reported the wrong store path");

  const accepted = await postJson(server.baseUrl, "/ingest", livePayload("codex", "live-smoke-approval"));
  assert(accepted.status === "accepted", `expected accepted ingest, got ${accepted.status}`);
  assert(accepted.events === 1, `expected one live event, got ${accepted.events}`);

  const duplicate = await postJson(server.baseUrl, "/ingest", livePayload("codex", "live-smoke-approval"));
  assert(duplicate.status === "duplicate", `expected duplicate ingest, got ${duplicate.status}`);
  assert(duplicate.events === 1, "duplicate ingest should not append an event");

  let expectedLiveEvents = 1;
  for (const runtime of ["claude_code", "cursor", "grok", "opencode"]) {
    expectedLiveEvents += 1;
    const runtimeAccepted = await postJson(server.baseUrl, `/ingest?runtime=${runtime}`, livePayload(runtime, `live-smoke-${runtime}`));
    assert(runtimeAccepted.status === "accepted", `expected accepted ${runtime} ingest, got ${runtimeAccepted.status}`);
    assert(runtimeAccepted.events === expectedLiveEvents, `expected ${expectedLiveEvents} cumulative live events after ${runtime}, got ${runtimeAccepted.events}`);
  }

  const projection = await getJson(server.baseUrl, "/projection?expandedSessionId=live-smoke-session");
  assert(projection.projection?.cards?.some((card) => card.sessionId === "live-smoke-session"), "projection missing live smoke session");
  for (const runtime of ["codex", "claude_code", "cursor", "grok", "opencode"]) {
    const expectedSourceSessionId = liveSessionId(runtime);
    const card = projection.projection?.cards?.find((item) => item.runtime === runtime && item.sourceSessionId === expectedSourceSessionId);
    assert(card, `projection missing ${runtime} live smoke card`);
    assert(card.canonicalSessionId && card.canonicalSessionId !== expectedSourceSessionId, `${runtime} card missing canonical session id`);
  }

  const events = await getJson(server.baseUrl, "/events");
  assert(events.events?.length === 5, "events endpoint should return five accepted events");

  const logbook = await getJson(server.baseUrl, "/logbook/search?q=Live%20smoke");
  assert(logbook.sessions?.some((session) => session.title === "Live smoke approval"), "logbook search missing live smoke session");

  const data = await getJson(server.baseUrl, "/data/summary");
  assert(data.summary?.sessions >= 1, "data summary missing canonical session");

  assertDatabase(databasePath);
  console.log(`Masthead live smoke passed. DB: ${databasePath}`);
} finally {
  if (server) await stopDaemon(server);
  if (process.env.MASTHEAD_KEEP_SMOKE_DIR !== "1") await rm(tempDir, { force: true, recursive: true });
}

function livePayload(runtime, providerEventId) {
  const sessionId = liveSessionId(runtime);
  const shared = {
    provider_event_id: providerEventId,
    timestamp: "2026-06-25T00:00:00.000Z",
    cwd: "/workspace/masthead-smoke",
    repo_root: "/workspace/masthead-smoke",
    git_common_dir: "/workspace/masthead-smoke/.git",
    branch: "agent/live-smoke",
    project: "Masthead",
    title: "Live smoke approval",
    command_id: "cmd-live-smoke",
    blast_radius: "local",
    summary: "Live smoke approval"
  };
  if (runtime === "cursor") {
    return {
      ...shared,
      hookEventName: "sessionStart",
      sessionId
    };
  }
  if (runtime === "claude_code" || runtime === "grok") {
    return {
      ...shared,
      hookEventName: "SessionStart",
      sessionId
    };
  }
  if (runtime === "opencode") {
    return {
      ...shared,
      directory: shared.cwd,
      sessionID: sessionId,
      time: shared.timestamp,
      type: "session.created"
    };
  }
  return {
    ...shared,
    event: "approval_requested",
    session_id: sessionId
  };
}

function liveSessionId(runtime) {
  return runtime === "codex" ? "live-smoke-session" : `live-smoke-${runtime}-session`;
}

function assertDatabase(databasePath) {
  const db = new DatabaseSync(databasePath);
  try {
    const sessions = db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE source_session_id = ?").get("live-smoke-session").count;
    const signals = db.prepare("SELECT COUNT(*) AS count FROM runtime_signals JOIN sessions USING (session_id) WHERE sessions.source_session_id = ?").get("live-smoke-session").count;
    const rawEvents = db.prepare("SELECT COUNT(*) AS count FROM raw_events WHERE source_record_key = ?").get("event:codex:live-smoke-approval").count;
    assert(sessions === 1, `expected one canonical session row, got ${sessions}`);
    assert(signals >= 1, "expected at least one runtime signal row");
    assert(rawEvents === 1, `expected one raw event row, got ${rawEvents}`);
    const runtimeRows = db
      .prepare(
        `SELECT runtimes.runtime_kind AS runtime, COUNT(*) AS count
        FROM sessions
        JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
        GROUP BY runtimes.runtime_kind`
      )
      .all();
    const runtimeCounts = new Map(runtimeRows.map((row) => [row.runtime, row.count]));
    for (const runtime of ["codex", "claude_code", "cursor", "grok", "opencode"]) {
      assert(runtimeCounts.get(runtime) === 1, `expected one canonical ${runtime} session row, got ${runtimeCounts.get(runtime) ?? 0}`);
    }
  } finally {
    db.close();
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
