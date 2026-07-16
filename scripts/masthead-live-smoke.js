#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const tempDir = await mkdtemp(join(tmpdir(), "masthead-live-smoke-"));
const RELEASE_LIVE_RUNTIMES = ["codex", "cursor", "claude_code", "opencode", "grok", "hermes", "pi", "omp"];
const PRIMARY_LIVE_RUNTIME = "claude_code";
const SHARED_LIVE_SESSION_ID = "live-smoke-shared-source-session";
let server;

try {
  const databasePath = join(tempDir, "masthead.sqlite");
  const storePath = join(tempDir, "events.ndjson");
  server = await startDaemon({ codexHome: join(tempDir, "legacy-home"), databasePath, storePath });

  const health = await getJson(server.baseUrl, "/health");
  assert(health.ok === true, "health did not report ok");
  assert(health.databasePath === databasePath, "health reported the wrong database path");
  assert(health.storePath === storePath, "health reported the wrong store path");

  const accepted = await postJson(server.baseUrl, `/ingest?runtime=${PRIMARY_LIVE_RUNTIME}`, livePayload(PRIMARY_LIVE_RUNTIME, "live-smoke-approval"));
  assert(accepted.status === "accepted", `expected accepted ingest, got ${accepted.status}`);
  assert(accepted.events === 1, `expected one live event, got ${accepted.events}`);

  const duplicate = await postJson(server.baseUrl, `/ingest?runtime=${PRIMARY_LIVE_RUNTIME}`, livePayload(PRIMARY_LIVE_RUNTIME, "live-smoke-approval"));
  assert(duplicate.status === "duplicate", `expected duplicate ingest, got ${duplicate.status}`);
  assert(duplicate.events === 1, "duplicate ingest should not append an event");

  let expectedLiveEvents = 1;
  for (const runtime of RELEASE_LIVE_RUNTIMES.filter((runtime) => runtime !== PRIMARY_LIVE_RUNTIME)) {
    expectedLiveEvents += 1;
    const runtimeAccepted = await postJson(server.baseUrl, `/ingest?runtime=${runtime}`, livePayload(runtime, `live-smoke-${runtime}`));
    assert(runtimeAccepted.status === "accepted", `expected accepted ${runtime} ingest, got ${runtimeAccepted.status}`);
    assert(runtimeAccepted.events === expectedLiveEvents, `expected ${expectedLiveEvents} cumulative live events after ${runtime}, got ${runtimeAccepted.events}`);
  }
  for (const runtime of RELEASE_LIVE_RUNTIMES) {
    const stateAccepted = await postJson(server.baseUrl, "/live/state", liveStatePayload(runtime, "working", `live-smoke-${runtime}-working`, 1));
    assert(stateAccepted.status === "accepted", `expected accepted ${runtime} working state, got ${stateAccepted.status}`);
  }

  const primaryState = await getJson(server.baseUrl, `/live/state?runtime=${PRIMARY_LIVE_RUNTIME}&sourceSessionId=${liveSessionId(PRIMARY_LIVE_RUNTIME)}`);
  assert(primaryState.reports?.[0]?.state === "working", "live state endpoint missing primary working report");

  await postJson(server.baseUrl, "/ingest?runtime=codex", livePayload("codex", "live-smoke-shared-codex", SHARED_LIVE_SESSION_ID));
  await postJson(server.baseUrl, "/ingest?runtime=opencode", livePayload("opencode", "live-smoke-shared-opencode", SHARED_LIVE_SESSION_ID));

  const projection = await getJson(server.baseUrl, `/projection?expandedSessionId=${liveSessionId(PRIMARY_LIVE_RUNTIME)}`);
  assert(projection.projection?.cards?.some((card) => card.sessionId === liveSessionId(PRIMARY_LIVE_RUNTIME)), "projection missing live smoke session");
  for (const runtime of RELEASE_LIVE_RUNTIMES) {
    const expectedSourceSessionId = liveSessionId(runtime);
    const card = projection.projection?.cards?.find((item) => item.runtime === runtime && item.sourceSessionId === expectedSourceSessionId);
    assert(card, `projection missing ${runtime} live smoke card`);
    assert(card.canonicalSessionId && card.canonicalSessionId !== expectedSourceSessionId, `${runtime} card missing canonical session id`);
    assert(card.displayState === "working", `${runtime} card display state should be working, got ${card.displayState}`);
    assert(card.runtimeState === "working", `${runtime} card runtime state should be working, got ${card.runtimeState}`);
  }
  await postJson(server.baseUrl, "/live/state", liveStatePayload(PRIMARY_LIVE_RUNTIME, "blocked", "live-smoke-primary-blocked", 2));
  let stateProjection = await getJson(server.baseUrl, `/projection?expandedSessionId=${liveSessionId(PRIMARY_LIVE_RUNTIME)}`);
  let primaryCard = stateProjection.projection?.cards?.find((card) => card.sessionId === liveSessionId(PRIMARY_LIVE_RUNTIME));
  assert(primaryCard?.displayState === "blocked", `primary card should become blocked, got ${primaryCard?.displayState}`);
  assert(primaryCard?.lifecycle === "running", `blocked primary card should stay in live lifecycle, got ${primaryCard?.lifecycle}`);
  await postJson(server.baseUrl, "/live/state", liveStatePayload(PRIMARY_LIVE_RUNTIME, "idle", "live-smoke-primary-idle", 3));
  stateProjection = await getJson(server.baseUrl, `/projection?expandedSessionId=${liveSessionId(PRIMARY_LIVE_RUNTIME)}`);
  primaryCard = stateProjection.projection?.cards?.find((card) => card.sessionId === liveSessionId(PRIMARY_LIVE_RUNTIME));
  assert(["idle", "done"].includes(primaryCard?.displayState), `primary card should become idle/done, got ${primaryCard?.displayState}`);

  const events = await getJson(server.baseUrl, "/events");
  assert(events.events?.length === RELEASE_LIVE_RUNTIMES.length + 2, `events endpoint should return ${RELEASE_LIVE_RUNTIMES.length + 2} accepted events`);

  const workbench = await getJson(server.baseUrl, "/workbench/sessions?limit=50");
  const shallowLiveSession = workbench.sessions?.find((session) => session.title === "Live smoke approval");
  assert(
    shallowLiveSession?.publicationStatus === "publish_path" &&
      shallowLiveSession?.nextAction === "review_quality" &&
      shallowLiveSession?.qualityStatus === "unchecked",
    "shallow live smoke session did not remain on the Workbench quality-review path"
  );

  const logbook = await getJson(server.baseUrl, "/logbook/artifacts?q=Live%20smoke");
  assert(logbook.total === 0, "unpublished live smoke session should not appear in artifact-first Logbook");

  const data = await getJson(server.baseUrl, "/data/summary");
  assert(data.summary?.sessions >= 1, "data summary missing canonical session");

  assertDatabase(databasePath);
  console.log(`Masthead live smoke passed. DB: ${databasePath}`);
} finally {
  if (server) await stopDaemon(server);
  if (process.env.MASTHEAD_KEEP_SMOKE_DIR !== "1") await rm(tempDir, { force: true, recursive: true });
}

function livePayload(runtime, providerEventId, sourceSessionId = liveSessionId(runtime)) {
  const sessionId = sourceSessionId;
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
  if (runtime === "codex" || runtime === "claude_code" || runtime === "grok") {
    return {
      ...shared,
      hookEventName: "SessionStart",
      sessionId
    };
  }
  if (runtime === "omp") {
    return {
      ...shared,
      sessionId,
      type: "session_start"
    };
  }
  if (runtime === "pi" || runtime === "hermes") {
    return {
      ...shared,
      event: "session_start",
      session_id: sessionId
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
  return `live-smoke-${runtime}-session`;
}

function liveStatePayload(runtime, state, sourceEventId, seq) {
  return {
    runtime,
    source: `masthead:${runtime}:live-smoke`,
    sourceEventId,
    sourceSessionId: liveSessionId(runtime),
    state,
    authority: "plugin",
    observedAt: new Date(Date.now() + seq * 1000).toISOString(),
    cwd: "/workspace/masthead-smoke",
    seq
  };
}

function assertDatabase(databasePath) {
  const db = new DatabaseSync(databasePath);
  try {
    const sessions = db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE source_session_id = ?").get(liveSessionId(PRIMARY_LIVE_RUNTIME)).count;
    const rawEvents = db.prepare("SELECT COUNT(*) AS count FROM raw_events WHERE source_record_key = ?").get(`event:${PRIMARY_LIVE_RUNTIME}:live-smoke-approval`).count;
    assert(sessions === 1, `expected one canonical session row, got ${sessions}`);
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
    for (const runtime of RELEASE_LIVE_RUNTIMES) {
      const expected = runtime === "codex" || runtime === "opencode" ? 2 : 1;
      assert(runtimeCounts.get(runtime) === expected, `expected ${expected} canonical ${runtime} session rows, got ${runtimeCounts.get(runtime) ?? 0}`);
    }
    const sharedRows = db
      .prepare("SELECT session_id AS sessionId, source_session_id AS sourceSessionId FROM sessions WHERE source_session_id = ?")
      .all(SHARED_LIVE_SESSION_ID);
    assert(sharedRows.length === 2, `expected two canonical rows for shared source session, got ${sharedRows.length}`);
    assert(new Set(sharedRows.map((row) => row.sessionId)).size === 2, "shared source session canonical ids should remain runtime-scoped");
    const stateReports = db.prepare("SELECT COUNT(*) AS count FROM live_state_reports").get().count;
    assert(stateReports >= RELEASE_LIVE_RUNTIMES.length + 2, `expected live state reports, got ${stateReports}`);
  } finally {
    db.close();
  }
}

async function startDaemon({ codexHome, databasePath, storePath }) {
  const child = spawn(process.execPath, ["scripts/masthead-ingest-server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      GEMINI_API_KEY: "",
      GOOGLE_API_KEY: "",
      MASTHEAD_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
      MASTHEAD_CODEX_HOME: codexHome,
      MASTHEAD_DATA_DIR: dirname(databasePath),
      MASTHEAD_DB_PATH: databasePath,
      MASTHEAD_GIT_REFRESH_MS: "0",
      MASTHEAD_HOST: "127.0.0.1",
      MASTHEAD_LEGACY_DATA_DIR: "",
      MASTHEAD_LIVE_COPY: "0",
      MASTHEAD_LLM_COPY: "0",
      MASTHEAD_PORT: "0",
      MASTHEAD_REMOTE_ENRICHMENT: "0",
      MASTHEAD_STORE_PATH: storePath,
      OPENAI_API_KEY: ""
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
