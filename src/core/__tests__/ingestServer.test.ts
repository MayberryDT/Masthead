import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, test } from "vitest";

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
const serverScript = fileURLToPath(new URL("../../../dist/daemon/src/daemon/main.js", import.meta.url));
const execFileAsync = promisify(execFile);
type TestServerProcess = ChildProcessByStdio<null, Readable, Readable>;

describe("ingest server live projection", () => {
  const servers: TestServerProcess[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(servers.map(stopServer));
    servers.length = 0;
    await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
    tempDirs.length = 0;
  });

  test("normalizes hooks, dedupes provider events, projects live board state, and persists across restart", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "events.ndjson");
    const firstServer = await startServer(storePath);
    servers.push(firstServer.child);

    const accepted = await postJson(firstServer.baseUrl, "/ingest", liveApprovalPayload("server-approval"));
    expect(accepted.status).toBe("accepted");
    expect(accepted.events).toBe(1);

    const duplicate = await postJson(firstServer.baseUrl, "/ingest", liveApprovalPayload("server-approval"));
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.events).toBe(1);

    const projection = await getJson(firstServer.baseUrl, "/projection?expandedSessionId=server-live");
    expect(projection).toMatchObject({
      ok: true,
      source: "live",
      events: 1,
      projection: {
        summary: {
          active: 1,
          needsAttention: 1,
          conflicts: 0,
          completed: 0
        }
      }
    });
    expect(projection.projection.cards[0]).toMatchObject({
      sessionId: "server-live",
      project: "Masthead",
      title: "Server live projection",
      primaryStatus: "waiting_for_approval"
    });
    expect(projection.projection.attentionQueue[0]).toMatchObject({
      type: "approval_requested",
      severity: "P0",
      affectedCommandIds: ["cmd-server-live"]
    });
    const events = await getJson(firstServer.baseUrl, "/events");
    expect(events).toMatchObject({
      ok: true,
      events: [expect.objectContaining({ eventId: "codex:server-approval", sessionId: "server-live" })],
      gitSnapshots: [],
      diagnostics: []
    });

    await stopServer(firstServer.child);
    servers.length = 0;

    const restartedServer = await startServer(storePath);
    servers.push(restartedServer.child);
    const restartedProjection = await getJson(restartedServer.baseUrl, "/projection?expandedSessionId=server-live");

    expect(restartedProjection.events).toBe(1);
    expect(restartedProjection.projection.cards[0]).toMatchObject({
      sessionId: "server-live",
      title: "Server live projection"
    });
    const restartedEvents = await getJson(restartedServer.baseUrl, "/events");
    expect(restartedEvents.events).toHaveLength(1);
    expect(restartedEvents.events[0]).toMatchObject({ sessionId: "server-live" });
  });

  test("malformed hook payload records a diagnostic without accepting an event", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const server = await startServer(join(tempDir, "events.ndjson"));
    servers.push(server.child);

    const response = await fetch(`${server.baseUrl}/ingest`, {
      body: "{bad json",
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      status: "malformed",
      events: 0,
      diagnostic: {
        code: "malformed_json"
      }
    });

    const health = await getJson(server.baseUrl, "/health");
    expect(health).toMatchObject({ events: 0, diagnostics: 1 });
  });

  test("reports non-secret LLM copy status without exposing the API key", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const server = await startServer(join(tempDir, "events.ndjson"), {
      MASTHEAD_LLM_COPY: "1",
      OPENAI_API_KEY: "redacted-local-test-key",
      MASTHEAD_OPENAI_MODEL: "gpt-5-nano-2025-08-07"
    });
    servers.push(server.child);

    const health = await getJson(server.baseUrl, "/health");
    const serialized = JSON.stringify(health);

    expect(health.llmCopy).toMatchObject({
      enabled: true,
      configured: true,
      model: "gpt-5-nano-2025-08-07",
      cacheEntries: 0
    });
    expect(serialized).not.toContain("redacted-local-test-key");
    expect(serialized).not.toContain("OPENAI_API_KEY");
  });

  test("applies local retention to persisted live event history", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const server = await startServer(join(tempDir, "events.ndjson"));
    servers.push(server.child);

    await postJson(server.baseUrl, "/ingest", liveApprovalPayload("server-retention"));
    const retainedBefore = await getJson(server.baseUrl, "/events");
    expect(retainedBefore.events).toHaveLength(1);

    const pruned = await postJson(server.baseUrl, "/retention", {
      policy: {
        cutoffAt: "2026-06-24T00:00:00.000Z",
        recordTypes: ["event"],
        keepUnresolvedAttention: true
      }
    });

    expect(pruned.result).toMatchObject({
      removedRecords: 1,
      removedRecordIds: ["event:codex:server-retention"],
      retainedRecords: 0,
      touchedExternalState: false
    });
    expect(pruned.events).toBe(0);
    const retainedAfter = await getJson(server.baseUrl, "/events");
    expect(retainedAfter.events).toEqual([]);
    const projection = await getJson(server.baseUrl, "/projection");
    expect(projection.projection.cards).toEqual([]);
  });

  test("clears persisted live collector history without touching external state", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const server = await startServer(join(tempDir, "events.ndjson"));
    servers.push(server.child);

    await postJson(server.baseUrl, "/ingest", liveApprovalPayload("server-clear"));
    expect((await getJson(server.baseUrl, "/events")).events).toHaveLength(1);

    const cleared = await postJson(server.baseUrl, "/clear", {});

    expect(cleared.result).toMatchObject({
      removedRecords: 1,
      touchedExternalState: false
    });
    expect(cleared.events).toBe(0);
    expect(cleared.gitSnapshots).toBe(0);
    expect((await getJson(server.baseUrl, "/events")).events).toEqual([]);
    expect((await getJson(server.baseUrl, "/projection")).projection.cards).toEqual([]);
  });

  test("mirrors live collector records into the daemon SQLite raw journal", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);

    await postJson(server.baseUrl, "/ingest", liveApprovalPayload("server-sqlite"));
    await postJson(server.baseUrl, "/ingest", liveApprovalPayload("server-sqlite"));

    const rowsBeforeClear = rawJournalRows(databasePath);
    expect(rowsBeforeClear).toHaveLength(1);
    expect(rowsBeforeClear[0]).toMatchObject({
      source_kind: "hook",
      source_record_key: "event:codex:server-sqlite"
    });
    expect(ingestSourceRows(databasePath)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adapter: "codex",
          endpoint: "http://127.0.0.1:17373/ingest",
          source_id: "codex-hook-local",
          source_kind: "hook"
        })
      ])
    );
    expect(JSON.parse(rowsBeforeClear[0].payload_json)).toMatchObject({
      recordId: "event:codex:server-sqlite",
      recordType: "event",
      value: {
        eventId: "codex:server-sqlite",
        sessionId: "server-live"
      }
    });

    await postJson(server.baseUrl, "/clear", {});

    expect(rawJournalRows(databasePath)).toEqual([]);
  });

  test("updates canonical session graph and materialized Board state in SQLite", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);

    await postJson(server.baseUrl, "/ingest", liveApprovalPayload("server-canonical"));
    await getJson(server.baseUrl, "/projection?expandedSessionId=server-live");
    const logbook = await getJson(server.baseUrl, "/logbook/search?q=Server");
    const blankLogbook = await getJson(server.baseUrl, "/logbook/search?q=");

    const db = new DatabaseSync(databasePath);
    try {
      expect(db.prepare("SELECT source_session_id, project_label, title FROM sessions").all()).toEqual([
        { project_label: "Masthead", source_session_id: "server-live", title: "Server live projection" }
      ]);
      expect(db.prepare("SELECT signal_kind, severity FROM runtime_signals").all()).toEqual([
        { severity: "warning", signal_kind: "approval.requested" }
      ]);
      const boardRows = db.prepare("SELECT projection_json FROM board_sessions").all() as Array<{ projection_json: string }>;
      expect(boardRows.map((row) => JSON.parse(row.projection_json))).toEqual([
        expect.objectContaining({ sessionId: "server-live", title: "Server live projection" })
      ]);
      expect(logbook).toMatchObject({
        ok: true,
        sessions: [expect.objectContaining({ title: "Server live projection" })]
      });
      expect(blankLogbook).toMatchObject({
        ok: true,
        sessions: [expect.objectContaining({ title: "Server live projection" })]
      });
    } finally {
      db.close();
    }
  });

  test("data lifecycle endpoints summarize, export, and delete canonical session data", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);

    await postJson(server.baseUrl, "/ingest", liveApprovalPayload("server-data-lifecycle"));
    await getJson(server.baseUrl, "/projection?expandedSessionId=server-live");

    expect(await getJson(server.baseUrl, "/data/summary")).toMatchObject({
      ok: true,
      summary: {
        rawEvents: 1,
        sessions: 1
      }
    });
    expect(await getJson(server.baseUrl, "/data/export")).toMatchObject({
      ok: true,
      export: {
        metadata: {
          format: "masthead.session-graph.v1",
          schemaVersion: 1
        },
        sessions: [expect.objectContaining({ source_session_id: "server-live" })]
      }
    });

    const deleted = await postJson(server.baseUrl, "/data/delete", {});

    expect(deleted).toMatchObject({
      ok: true,
      result: {
        rawEvents: 1,
        sessions: 1
      },
      events: 0,
      gitSnapshots: 0
    });
    expect(await getJson(server.baseUrl, "/data/summary")).toMatchObject({
      ok: true,
      summary: {
        rawEvents: 0,
        sessions: 0
      }
    });
    const db = new DatabaseSync(databasePath);
    try {
      expect(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM raw_events").get()).toEqual({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM session_search").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  test("hydrates canonical sessions from an existing event journal before persisting Board state", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const firstServer = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(firstServer.child);

    const accepted = await postJson(firstServer.baseUrl, "/ingest", liveApprovalPayload("server-legacy-journal"));
    const acceptedEvent = accepted.event as { eventId: string; occurredAt: string };
    await appendFile(
      storePath,
      `${JSON.stringify({
        recordId: `event:${acceptedEvent.eventId}`,
        recordType: "event",
        observedAt: acceptedEvent.occurredAt,
        value: accepted.event
      })}\n`,
      "utf8"
    );
    await stopServer(firstServer.child);
    servers.length = 0;
    await rm(databasePath, { force: true });
    await rm(`${databasePath}-shm`, { force: true });
    await rm(`${databasePath}-wal`, { force: true });

    const restartedServer = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(restartedServer.child);

    const projection = await waitForProjectionCard(restartedServer.baseUrl, "/projection?expandedSessionId=server-live");
    expect(projection.projection.cards[0]).toMatchObject({
      sessionId: "server-live",
      title: "Server live projection"
    });

    const db = new DatabaseSync(databasePath);
    try {
      expect(db.prepare("SELECT source_session_id FROM sessions").all()).toEqual([{ source_session_id: "server-live" }]);
      expect(db.prepare("SELECT session_id FROM board_sessions").all()).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test("discovers Codex sources and imports metadata into canonical sessions", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const codexHome = join(tempDir, "home");
    await mkdir(join(codexHome, ".codex"), { recursive: true });
    await writeFile(
      join(codexHome, ".codex", "session_index.jsonl"),
      `${JSON.stringify({
        session_id: "historical-session",
        timestamp: "2026-06-24T12:00:00.000Z",
        project: "Masthead",
        title: "Historical Codex session"
      })}\n`,
      "utf8"
    );
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_CODEX_HOME: codexHome, MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);

    const sources = await postJson(server.baseUrl, "/sources/discover", {});
    expect(sources).toMatchObject({
      ok: true,
      sources: [expect.objectContaining({ sourceId: "codex-session-index", sourceKind: "jsonl" })]
    });

    const imported = await postJson(server.baseUrl, "/sources/codex/import-metadata", {});
    expect(imported).toMatchObject({ ok: true, queued: 1, sources: 1 });
    await waitForImportJobs(server.baseUrl, jobIds(imported));
    const search = await getJson(server.baseUrl, "/logbook/search?q=Historical");
    expect(search).toMatchObject({
      ok: true,
      sessions: [expect.objectContaining({ title: "Historical Codex session" })]
    });

    const db = new DatabaseSync(databasePath);
    try {
      expect(db.prepare("SELECT source_session_id, project_label, title FROM sessions").all()).toEqual([
        {
          project_label: "Masthead",
          source_session_id: "historical-session",
          title: "Historical Codex session"
        }
      ]);
    } finally {
      db.close();
    }
  });

  test("runs metadata import through the generic import job endpoint", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const codexHome = join(tempDir, "home");
    await mkdir(join(codexHome, ".codex"), { recursive: true });
    await writeFile(
      join(codexHome, ".codex", "session_index.jsonl"),
      `${JSON.stringify({
        session_id: "job-session",
        timestamp: "2026-06-24T12:00:00.000Z",
        project: "Masthead",
        title: "Import job Codex session"
      })}\n`,
      "utf8"
    );
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_CODEX_HOME: codexHome, MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);

    await getJson(server.baseUrl, "/sources");
    const imported = await postJson(server.baseUrl, "/imports", {
      kind: "metadata",
      sourceId: "codex-session-index"
    });

    expect(imported).toMatchObject({
      ok: true,
      job: {
        status: "queued"
      }
    });
    const imports = await waitForImport(server.baseUrl, "codex-session-index");
    expect(imports.imports).toEqual([expect.objectContaining({ sourceId: "codex-session-index", status: "succeeded" })]);
  });

  test("imports Codex transcripts incrementally using persisted cursors", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const codexHome = join(tempDir, "home");
    const sessionsDir = join(codexHome, ".codex", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const nestedSessionsDir = join(sessionsDir, "2026", "06", "24");
    await mkdir(nestedSessionsDir, { recursive: true });
    const transcriptPath = join(nestedSessionsDir, "historical-session.jsonl");
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        content: "First transcript message",
        role: "user",
        session_id: "historical-session",
        timestamp: "2026-06-24T12:00:00.000Z"
      })}\n`,
      "utf8"
    );
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_CODEX_HOME: codexHome, MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);

    const unapproved = await fetch(`${server.baseUrl}/sources/codex/import-transcripts`, {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    expect(unapproved.status).toBe(409);

    expect(await postJson(server.baseUrl, "/sources/codex/approve-transcripts", {})).toMatchObject({ ok: true });
    const firstImport = await postJson(server.baseUrl, "/sources/codex/import-transcripts", {});
    expect(firstImport).toMatchObject({ ok: true, queued: 1 });
    await waitForImportJobs(server.baseUrl, jobIds(firstImport));
    await appendFile(
      transcriptPath,
      `${JSON.stringify({
        content: "Second transcript message",
        role: "assistant",
        session_id: "historical-session",
        timestamp: "2026-06-24T12:05:00.000Z"
      })}\n`,
      "utf8"
    );
    const secondImport = await postJson(server.baseUrl, "/sources/codex/import-transcripts", {});
    expect(secondImport).toMatchObject({ ok: true, queued: 1 });
    await waitForImportJobs(server.baseUrl, jobIds(secondImport));

    const db = new DatabaseSync(databasePath);
    try {
      expect(db.prepare("SELECT role, text_redacted FROM messages ORDER BY observed_at").all()).toEqual([
        { role: "user", text_redacted: "First transcript message" },
        { role: "assistant", text_redacted: "Second transcript message" }
      ]);
      expect(db.prepare("SELECT byte_offset FROM ingest_cursors WHERE source_path = ?").get(transcriptPath)).toMatchObject({
        byte_offset: Buffer.byteLength(await readTranscriptFixture(transcriptPath))
      });
    } finally {
      db.close();
    }
  });

  test("collects live Git snapshots and projects exact-file conflicts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const seedRepoPath = join(tempDir, "repo-seed");
    const repoPath = join(tempDir, "repo-a");
    const secondWorktreePath = join(tempDir, "repo-b");
    await createCleanRepo(seedRepoPath);
    await git(seedRepoPath, ["worktree", "add", "-b", "session-git-a", repoPath]);
    await git(seedRepoPath, ["worktree", "add", "-b", "session-git-b", secondWorktreePath]);
    await writeFile(join(repoPath, "src/shared.ts"), "export const value = 2;\n", "utf8");
    await writeFile(join(secondWorktreePath, "src/shared.ts"), "export const value = 3;\n", "utf8");
    const server = await startServer(join(tempDir, "events.ndjson"));
    servers.push(server.child);

    await postJson(server.baseUrl, "/ingest", liveSessionPayload("server-git-a", "session-git-a", repoPath));
    const accepted = await postJson(
      server.baseUrl,
      "/ingest",
      liveSessionPayload("server-git-b", "session-git-b", secondWorktreePath, "session-git-b")
    );
    expect(accepted.gitSnapshots).toBe(2);

    const projection = await getJson(server.baseUrl, "/projection?expandedSessionId=session-git-a");

    expect(projection.gitSnapshots).toBe(2);
    expect(projection.projection.summary.conflicts).toBe(1);
    expect(projection.projection.conflicts[0]).toMatchObject({
      type: "exact_file_overlap",
      severity: "high",
      attribution: "direct",
      sharedPaths: ["src/shared.ts"],
      sessionIds: ["session-git-a", "session-git-b"]
    });
    expect(projection.projection.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: "session-git-a", changedFileCount: 1, indicators: expect.arrayContaining(["conflict"]) }),
        expect.objectContaining({ sessionId: "session-git-b", changedFileCount: 1, indicators: expect.arrayContaining(["conflict"]) })
      ])
    );
  });

  test("refreshes known live Git sessions after later file changes", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const repoPath = join(tempDir, "repo");
    await createCleanRepo(repoPath);
    const server = await startServer(join(tempDir, "events.ndjson"), { MASTHEAD_GIT_REFRESH_MS: "0" });
    servers.push(server.child);

    const accepted = await postJson(server.baseUrl, "/ingest", liveSessionPayload("server-refresh", "session-refresh", repoPath));
    expect(accepted.gitSnapshots).toBe(1);
    let projection = await getJson(server.baseUrl, "/projection?expandedSessionId=session-refresh");
    expect(projection.projection.cards[0]).toMatchObject({ sessionId: "session-refresh", changedFileCount: 0 });

    await writeFile(join(repoPath, "src/shared.ts"), "export const value = 3;\n", "utf8");
    const refresh = await postJson(server.baseUrl, "/refresh", {});
    expect(refresh.refreshed).toBe(1);
    expect(refresh.gitSnapshots).toBe(2);
    const events = await getJson(server.baseUrl, "/events");
    expect(events.gitSnapshots).toHaveLength(2);

    projection = await getJson(server.baseUrl, "/projection?expandedSessionId=session-refresh");
    expect(projection.projection.cards[0]).toMatchObject({
      sessionId: "session-refresh",
      changedFileCount: 1,
      primaryStatus: "editing"
    });
  });
});

async function startServer(
  storePath: string,
  env: Record<string, string> = {}
): Promise<{ baseUrl: string; child: TestServerProcess }> {
  const child = spawn(process.execPath, [serverScript], {
    cwd: projectRoot,
    env: {
      ...process.env,
      MASTHEAD_DATA_DIR: dirname(storePath),
      MASTHEAD_PORT: "0",
      MASTHEAD_DB_PATH: join(dirname(storePath), "masthead.sqlite"),
      MASTHEAD_STORE_PATH: storePath,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const baseUrl = await readServerUrl(child);
  return { baseUrl, child };
}

function readServerUrl(child: TestServerProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 5_000);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(`http://127.0.0.1:${match[1]}`);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`server exited with ${code}: ${output}`));
      }
    });
  });
}

async function stopServer(child: TestServerProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  child.kill("SIGINT");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(202);
  return response.json() as Promise<Record<string, unknown>>;
}

async function getJson(baseUrl: string, path: string): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, any>>;
}

async function waitForProjectionCard(baseUrl: string, path: string): Promise<Record<string, any>> {
  const deadline = Date.now() + 1500;
  let projection = await getJson(baseUrl, path);
  while (Date.now() < deadline) {
    if (projection.projection?.cards?.[0]) return projection;
    await new Promise((resolve) => setTimeout(resolve, 20));
    projection = await getJson(baseUrl, path);
  }
  return projection;
}

async function waitForImport(baseUrl: string, sourceId: string): Promise<Record<string, any>> {
  const deadline = Date.now() + 1500;
  let imports = await getJson(baseUrl, "/imports");
  while (Date.now() < deadline) {
    if (imports.imports?.some((job: { sourceId: string; status: string }) => job.sourceId === sourceId && job.status === "succeeded")) {
      return imports;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    imports = await getJson(baseUrl, "/imports");
  }
  return imports;
}

async function waitForImportJobs(baseUrl: string, importJobIds: string[]): Promise<Record<string, any>> {
  const deadline = Date.now() + 1500;
  let imports = await getJson(baseUrl, "/imports");
  while (Date.now() < deadline) {
    const finished = imports.imports?.filter((job: { importJobId: string; status: string }) => importJobIds.includes(job.importJobId)) ?? [];
    if (finished.length === importJobIds.length && finished.every((job: { status: string }) => job.status === "succeeded")) return imports;
    await new Promise((resolve) => setTimeout(resolve, 20));
    imports = await getJson(baseUrl, "/imports");
  }
  return imports;
}

function jobIds(response: Record<string, any>): string[] {
  return (response.jobs ?? []).map((job: { importJobId: string }) => job.importJobId);
}

function liveApprovalPayload(providerEventId: string): Record<string, unknown> {
  return {
    provider_event_id: providerEventId,
    event: "approval_requested",
    session_id: "server-live",
    timestamp: "2026-06-23T03:30:00.000Z",
    cwd: "/workspace/masthead",
    repo_root: "/workspace/masthead",
    git_common_dir: "/workspace/masthead/.git",
    branch: "agent/server-live",
    project: "Masthead",
    title: "Server live projection",
    command_id: "cmd-server-live",
    blast_radius: "production",
    summary: "Server live approval"
  };
}

function liveSessionPayload(providerEventId: string, sessionId: string, repoPath: string, branch = "master"): Record<string, unknown> {
  return {
    provider_event_id: providerEventId,
    event: "session_started",
    session_id: sessionId,
    timestamp: "2026-06-23T03:35:00.000Z",
    cwd: repoPath,
    repo_root: repoPath,
    branch,
    project: "Masthead",
    title: `Live Git ${sessionId}`
  };
}

async function createDirtyRepo(repoPath: string): Promise<void> {
  await createCleanRepo(repoPath);
  await writeFile(join(repoPath, "src/shared.ts"), "export const value = 2;\n", "utf8");
}

async function createCleanRepo(repoPath: string): Promise<void> {
  await mkdir(join(repoPath, "src"), { recursive: true });
  await git(repoPath, ["init"]);
  await git(repoPath, ["config", "user.email", "masthead@example.test"]);
  await git(repoPath, ["config", "user.name", "Masthead Test"]);
  await writeFile(join(repoPath, "src/shared.ts"), "export const value = 1;\n", "utf8");
  await git(repoPath, ["add", "src/shared.ts"]);
  await git(repoPath, ["commit", "-m", "initial"]);
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

function rawJournalRows(databasePath: string): Array<{ source_kind: string; source_record_key: string; payload_json: string }> {
  const db = new DatabaseSync(databasePath);
  try {
    return db
      .prepare("SELECT source_kind, source_record_key, payload_json FROM raw_events ORDER BY observed_at, raw_event_id")
      .all() as Array<{ source_kind: string; source_record_key: string; payload_json: string }>;
  } finally {
    db.close();
  }
}

function ingestSourceRows(databasePath: string): Array<{ adapter: string; endpoint: string | null; source_id: string; source_kind: string }> {
  const db = new DatabaseSync(databasePath);
  try {
    return db
      .prepare("SELECT adapter, endpoint, source_id, source_kind FROM ingest_sources ORDER BY source_id")
      .all() as Array<{ adapter: string; endpoint: string | null; source_id: string; source_kind: string }>;
  } finally {
    db.close();
  }
}

async function readTranscriptFixture(path: string): Promise<string> {
  return readFile(path, "utf8");
}
