#!/usr/bin/env node
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { buildGitSnapshot } from "../src/core/gitObserver.ts";
import { createIngestionState, ingestCodexHookPayload } from "../src/core/ingestion.ts";
import { projectLiveEvents } from "../src/core/liveProjection.ts";
import { createOpenAISessionCopyEnricher } from "../src/core/openaiSessionCopy.ts";
import { createFileBackedStore } from "../src/core/store.ts";

const execFileAsync = promisify(execFile);
const host = process.env.MASTHEAD_HOST || "127.0.0.1";
const configuredPort = Number.parseInt(process.env.MASTHEAD_PORT || "", 10);
const port = Number.isFinite(configuredPort) ? configuredPort : 17373;
const configuredGitRefreshMs = Number.parseInt(process.env.MASTHEAD_GIT_REFRESH_MS || "", 10);
const gitRefreshMs = Number.isFinite(configuredGitRefreshMs) ? configuredGitRefreshMs : 5_000;
const allowedOrigins = (process.env.MASTHEAD_ALLOWED_ORIGINS || [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "tauri://localhost",
  "http://tauri.localhost"
].join(","))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const fixturePath = resolve("fixtures/v0/replay-three-sessions-board.json");
const storePath = resolve(process.env.MASTHEAD_STORE_PATH || ".masthead/events.ndjson");
const store = await createFileBackedStore(storePath);
const state = createIngestionState(store.readEvents());
const gitSnapshots = store.readGitSnapshots();
const gitSnapshotSignatures = new Map(gitSnapshots.map((snapshot) => [snapshot.sessionId, gitSnapshotSignature(snapshot)]));
const sessionCopyEnricher = createOpenAISessionCopyEnricher({
  enabled: process.env.MASTHEAD_LLM_COPY === "1",
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.MASTHEAD_OPENAI_MODEL
});

await mkdir(dirname(storePath), { recursive: true });

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);

  if (request.method === "OPTIONS") {
    sendJson(request, response, 204, undefined);
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(request, response, 200, {
      ok: true,
      events: state.events.length,
      diagnostics: state.diagnostics.length,
      gitSnapshots: gitSnapshots.length,
      storePath,
      projectionUrl: `http://${host}:${port}/projection`,
      ingestUrl: `http://${host}:${port}/ingest`,
      allowedOrigins,
      llmCopy: sessionCopyEnricher.status()
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/fixture") {
    try {
      const fixture = await readFile(fixturePath, "utf8");
      sendJson(request, response, 200, JSON.parse(fixture));
    } catch (error) {
      sendJson(request, response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/events") {
    sendJson(request, response, 200, {
      ok: true,
      events: state.events,
      gitSnapshots,
      diagnostics: state.diagnostics,
      gitRefreshMs
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/projection") {
    const liveEnvelope = projectLiveEvents(state.events, gitSnapshots, {
      selectedSessionId: url.searchParams.get("selectedSessionId") || url.searchParams.get("expandedSessionId") || undefined,
      diagnostics: state.diagnostics.length
    });
    liveEnvelope.projection = await sessionCopyEnricher.enrichProjection(liveEnvelope.projection);
    sendJson(
      request,
      response,
      200,
      liveEnvelope
    );
    return;
  }

  if ((request.method === "POST" || request.method === "GET") && url.pathname === "/refresh") {
    const refreshed = await refreshKnownGitSnapshots();
    sendJson(request, response, 202, {
      ok: true,
      refreshed,
      gitSnapshots: gitSnapshots.length,
      events: state.events.length
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/retention") {
    try {
      const body = await readBody(request);
      const parsed = body ? JSON.parse(body) : {};
      const policy = parsed.policy ?? parsed;
      const result = await store.pruneLocalData(policy);
      state.events.length = 0;
      state.events.push(...store.readEvents());
      gitSnapshots.length = 0;
      gitSnapshots.push(...store.readGitSnapshots());
      gitSnapshotSignatures.clear();
      for (const gitSnapshot of gitSnapshots) {
        gitSnapshotSignatures.set(gitSnapshot.sessionId, gitSnapshotSignature(gitSnapshot));
      }
      sendJson(request, response, 202, {
        ok: true,
        result,
        events: state.events.length,
        gitSnapshots: gitSnapshots.length
      });
    } catch (error) {
      sendJson(request, response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/clear") {
    try {
      const result = await store.clearLocalData();
      state.events.length = 0;
      gitSnapshots.length = 0;
      gitSnapshotSignatures.clear();
      sendJson(request, response, 202, {
        ok: true,
        result,
        events: state.events.length,
        gitSnapshots: gitSnapshots.length
      });
    } catch (error) {
      sendJson(request, response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/ingest") {
    const body = await readBody(request);
    const result = ingestCodexHookPayload(body, state, { receivedAt: new Date().toISOString() });

    if (result.status === "malformed") {
      sendJson(request, response, 400, {
        ok: false,
        status: result.status,
        diagnostic: result.diagnostic,
        events: state.events.length
      });
      return;
    }

    if (result.status === "accepted") {
      await store.append({
        recordId: `event:${result.event.eventId}`,
        recordType: "event",
        observedAt: result.event.occurredAt,
        value: result.event
      });
      const gitSnapshot = await collectGitSnapshot(result.event);
      if (gitSnapshot) {
        await appendGitSnapshotIfChanged(gitSnapshot);
      }
    }

    sendJson(request, response, 202, {
      ok: true,
      status: result.status,
      event: result.event,
      gitSnapshots: gitSnapshots.length,
      events: state.events.length
    });
    return;
  }

  sendJson(request, response, 404, { ok: false, error: "not found" });
});

server.listen(port, host, () => {
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  console.log(`Masthead ingest server listening at http://${host}:${boundPort}`);
  console.log(`POST hook payloads to http://${host}:${boundPort}/ingest`);
  console.log(`GET live projection at http://${host}:${boundPort}/projection`);
  console.log(`Persisting normalized events to ${storePath}`);
  if (gitRefreshMs > 0) console.log(`Refreshing known Git sessions every ${gitRefreshMs}ms`);
});

const gitRefreshTimer =
  gitRefreshMs > 0
    ? setInterval(() => {
        void refreshKnownGitSnapshots();
      }, gitRefreshMs).unref()
    : undefined;

process.on("SIGINT", () => {
  if (gitRefreshTimer) clearInterval(gitRefreshTimer);
  server.close(() => process.exit(0));
});

function readBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
  });
}

function sendJson(request, response, status, body) {
  const origin = request.headers.origin;
  const allowedOrigin = typeof origin === "string" && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  response.writeHead(status, {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-origin": allowedOrigin,
    "vary": "origin",
    "content-type": "application/json"
  });
  response.end(body === undefined ? "" : JSON.stringify(body, null, 2));
}

async function collectGitSnapshot(event) {
  if (!event.sessionId || !event.workspace) return undefined;

  const worktreePath = event.workspace.worktreePath || event.workspace.cwd || event.workspace.repoRoot;
  if (!worktreePath) return undefined;

  try {
    const [repoRoot, gitCommonDir, branch, headSha, statusPorcelain, numstat] = await Promise.all([
      gitOutput(worktreePath, ["rev-parse", "--show-toplevel"]),
      gitOutput(worktreePath, ["rev-parse", "--git-common-dir"]),
      gitOutput(worktreePath, ["branch", "--show-current"]),
      gitOutput(worktreePath, ["rev-parse", "HEAD"]),
      gitOutput(worktreePath, ["status", "--porcelain"], { trim: false }),
      gitOutput(worktreePath, ["diff", "--numstat", "HEAD", "--"])
    ]);

    return buildGitSnapshot({
      sessionId: event.sessionId,
      repoRoot: event.workspace.repoRoot || repoRoot,
      worktreePath,
      gitCommonDir: event.workspace.gitCommonDir || gitCommonDir,
      branch: event.workspace.branch || branch || undefined,
      headSha: event.workspace.headSha || headSha || undefined,
      observedAt: new Date().toISOString(),
      statusPorcelain,
      numstat
    });
  } catch {
    return undefined;
  }
}

async function refreshKnownGitSnapshots() {
  const eventsBySession = new Map();
  for (const event of state.events.toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    eventsBySession.set(event.sessionId, event);
  }

  let refreshed = 0;
  for (const event of eventsBySession.values()) {
    if (!event?.sessionId || event.type === "session.completed") continue;
    const gitSnapshot = await collectGitSnapshot(event);
    if (!gitSnapshot) continue;
    if (await appendGitSnapshotIfChanged(gitSnapshot)) refreshed += 1;
  }
  return refreshed;
}

async function appendGitSnapshotIfChanged(gitSnapshot) {
  const signature = gitSnapshotSignature(gitSnapshot);
  if (gitSnapshotSignatures.get(gitSnapshot.sessionId) === signature) return false;

  gitSnapshotSignatures.set(gitSnapshot.sessionId, signature);
  gitSnapshots.push(gitSnapshot);
  await store.append({
    recordId: `git_snapshot:${gitSnapshot.snapshotId}`,
    recordType: "git_snapshot",
    observedAt: gitSnapshot.observedAt,
    value: gitSnapshot
  });
  return true;
}

function gitSnapshotSignature(snapshot) {
  return JSON.stringify({
    repoRoot: snapshot.repoRoot,
    worktreePath: snapshot.worktreePath,
    gitCommonDir: snapshot.gitCommonDir,
    branch: snapshot.branch,
    headSha: snapshot.headSha,
    changedPaths: snapshot.changedPaths.map((changedPath) => ({
      path: changedPath.path,
      status: changedPath.status,
      staged: changedPath.staged,
      additions: changedPath.additions,
      deletions: changedPath.deletions,
      sensitivity: changedPath.sensitivity
    }))
  });
}

async function gitOutput(cwd, args, options = {}) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: 2_000,
    windowsHide: true
  });
  return options.trim === false ? stdout.replace(/\r?\n$/, "") : stdout.trim();
}
