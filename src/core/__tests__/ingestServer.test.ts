import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, test } from "vitest";
import { applySessionArtifact, publishSessionArtifact } from "../../daemon/db/sessionArtifactRepository.ts";
import { setSourcePolicy } from "../../daemon/db/sourcePolicyRepository.ts";
import { markWorkbenchPublished } from "../../daemon/db/workbenchPipelineRepository.ts";

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
const serverScript = fileURLToPath(new URL("../../../dist/daemon/src/daemon/main.js", import.meta.url));
const execFileAsync = promisify(execFile);
const DEFAULT_LIVE_RUNTIME = "claude_code";
const DEFAULT_LIVE_INGEST_PATH = `/ingest?runtime=${DEFAULT_LIVE_RUNTIME}`;

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
          active: 0,
          needsAttention: 1,
          conflicts: 0,
          completed: 0,
          needsAction: 0
        }
      }
    });
    expect(projection.projection.cards[0]).toMatchObject({
      sessionId: "server-live",
      project: "Masthead",
      title: "Server live projection",
      primaryStatus: "stalled",
      stateLabel: "Idle"
    });
    expect(projection.projection.attentionQueue[0]).toMatchObject({
      type: "approval_requested",
      severity: "P0",
      affectedCommandIds: ["cmd-server-live"]
    });
    const events = await getJson(firstServer.baseUrl, "/events");
    expect(events).toMatchObject({
      ok: true,
      events: [expect.objectContaining({ eventId: "claude_code:server-approval", sessionId: "server-live" })],
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

    const response = await fetch(`${server.baseUrl}${DEFAULT_LIVE_INGEST_PATH}`, {
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

  test("reports non-secret Board headline status without exposing the API key", async () => {
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

    expect(health.boardHeadlines).toMatchObject({
      enabled: true,
      configured: true,
      model: "gpt-5-nano-2025-08-07"
    });
    expect(serialized).not.toContain("redacted-local-test-key");
    expect(serialized).not.toContain("OPENAI_API_KEY");
  });

  test("returns useful deterministic Board copy while transcript evidence is absent", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const server = await startServer(join(tempDir, "events.ndjson"), {
      MASTHEAD_LLM_COPY: "1",
      OPENAI_API_KEY: "redacted-local-test-key"
    });
    servers.push(server.child);

    await postJson(server.baseUrl, "/ingest", liveApprovalPayload("server-headline-pending"));

    const projection = await getJson(server.baseUrl, "/projection?expandedSessionId=server-live");
    const card = projection.projection.cards[0];

    expect(card).toMatchObject({
      sessionId: "server-live",
      headline: {
        source: "offline",
        status: "ready"
      },
      headlineRefresh: {
        status: "pending",
        failureMessage: expect.stringMatching(/transcript evidence/i)
      }
    });
    expect(card.headline.headline).not.toMatch(/waiting for transcript/i);
    expect(card.headlineInput).toBeDefined();
  });

  test("applies local retention to persisted live event history", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const server = await startServer(join(tempDir, "events.ndjson"));
    servers.push(server.child);
    const databaseId = await activeDatabaseId(server.baseUrl);

    await postJson(server.baseUrl, "/ingest", liveApprovalPayload("server-retention"));
    const retainedBefore = await getJson(server.baseUrl, "/events");
    expect(retainedBefore.events).toHaveLength(1);

    const pruned = await postJson(server.baseUrl, "/retention", {
      databaseId,
      policy: {
        cutoffAt: "2026-06-24T00:00:00.000Z",
        recordTypes: ["event"],
        keepUnresolvedAttention: true
      }
    });

    expect(pruned.result).toMatchObject({
      removedRecords: 1,
      removedRecordIds: ["event:claude_code:server-retention"],
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
    const databaseId = await activeDatabaseId(server.baseUrl);

    await postJson(server.baseUrl, "/ingest", liveApprovalPayload("server-clear"));
    expect((await getJson(server.baseUrl, "/events")).events).toHaveLength(1);

    const cleared = await postJson(server.baseUrl, "/clear", { databaseId });

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
    const databaseId = await activeDatabaseId(server.baseUrl);

    await postJson(server.baseUrl, "/ingest", liveApprovalPayload("server-sqlite"));
    await postJson(server.baseUrl, "/ingest", liveApprovalPayload("server-sqlite"));

    const rowsBeforeClear = rawJournalRows(databasePath);
    expect(rowsBeforeClear).toHaveLength(1);
    expect(rowsBeforeClear[0]).toMatchObject({
      source_kind: "hook",
      source_record_key: "event:claude_code:server-sqlite"
    });
    expect(ingestSourceRows(databasePath)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adapter: "claude_code",
          endpoint: "http://127.0.0.1:17373/ingest",
          source_id: "claude-code-hook-local",
          source_kind: "hook"
        })
      ])
    );
    expect(JSON.parse(rowsBeforeClear[0].payload_json)).toMatchObject({
      recordId: "event:claude_code:server-sqlite",
      recordType: "event",
      value: {
        eventId: "claude_code:server-sqlite",
        sessionId: "server-live"
      }
    });

    await postJson(server.baseUrl, "/clear", { databaseId });

    expect(rawJournalRows(databasePath)).toEqual([]);
  });

  test("ingests and replays runtime-specific live hooks under focused live sources", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const firstServer = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(firstServer.child);

    const accepted = await postJson(firstServer.baseUrl, "/ingest?runtime=claude_code", liveClaudePromptPayload("claude-server-prompt"));

    expect(accepted).toMatchObject({
      status: "accepted",
      events: 1,
      event: {
        eventId: "claude_code:claude-server-prompt",
        sessionId: "claude-server-live",
        source: {
          adapter: "claude_code",
          surface: "hook"
        }
      }
    });
    await waitFor(() => {
      expect(rawJournalRows(databasePath).map((row) => row.source_record_key)).toEqual([
        "event:claude_code:claude-server-prompt"
      ]);
      expect(ingestSourceRows(databasePath)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            adapter: "claude_code",
            endpoint: "http://127.0.0.1:17373/ingest",
            source_id: "claude-code-hook-local",
            source_kind: "hook"
          })
        ])
      );
      expect(sessionRuntimeRows(databasePath)).toEqual([
        {
          runtime_kind: "claude_code",
          source_session_id: "claude-server-live"
        }
      ]);
    });

    await stopServer(firstServer.child);
    servers.length = 0;

    const restartedServer = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(restartedServer.child);
    const restartedProjection = await getJson(restartedServer.baseUrl, "/projection?expandedSessionId=claude-server-live");

    expect(restartedProjection.events).toBe(1);
    expect(restartedProjection.projection.cards[0]).toMatchObject({
      sessionId: "claude-server-live",
      runtime: "claude_code",
      title: "Claude live projection"
    });
  });

  test("updates canonical session graph without mutating Board state on projection reads", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);

    await postJson(server.baseUrl, "/ingest", liveApprovalPayload("server-canonical"));
    await getJson(server.baseUrl, "/projection?expandedSessionId=server-live");

    const db = new DatabaseSync(databasePath);
    try {
      expect(db.prepare("SELECT source_session_id, project_label, title FROM sessions").all()).toEqual([
        { project_label: "Masthead", source_session_id: "server-live", title: "Server live projection" }
      ]);
      expect(db.prepare("SELECT signal_kind, severity FROM runtime_signals").all()).toEqual([
        { severity: "warning", signal_kind: "approval.requested" }
      ]);
      expect(db.prepare("SELECT projection_json FROM board_sessions").all()).toEqual([]);
      publishSourceSession(db, "server-live", "Server live projection");
    } finally {
      db.close();
    }

    const logbook = await getJson(server.baseUrl, "/logbook/search?q=Server");
    const blankLogbook = await getJson(server.baseUrl, "/logbook/search?q=");
    expect(logbook).toMatchObject({
      ok: true,
      artifacts: [expect.objectContaining({ title: "Server live projection" })]
    });
    expect(logbook).not.toHaveProperty("sessions");
    expect(blankLogbook).toMatchObject({
      ok: true,
      artifacts: [expect.objectContaining({ title: "Server live projection" })]
    });
    expect(blankLogbook).not.toHaveProperty("sessions");
  });

  test("defers successful PostToolUse events out of immediate projection while preserving high-value turns", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);

    await postJson(server.baseUrl, "/ingest", liveQuestionPayload("server-live-question"));
    await postJson(server.baseUrl, "/ingest", liveSuccessfulToolPayload("server-live-tool"));

    const projection = await getJson(server.baseUrl, "/projection?expandedSessionId=server-live");
    const card = projection.projection.cards[0];

    expect(card.sessionId).toBe("server-live");
    expect(card.headlineInput.facts.recentTranscriptMessages).toEqual(
      expect.arrayContaining(["Lightweight live facts"])
    );
    expect(card.headlineInput.facts.recentToolNames).not.toContain("npm run noisy-tool-stat");

    await waitForToolResultRowCount(databasePath, 1);
    expect(rawJournalRows(databasePath).map((row) => row.source_record_key)).toEqual([
      "event:claude_code:server-live-question",
      "event:claude_code:server-live-tool"
    ]);
    expect(toolResultRows(databasePath)).toEqual([expect.objectContaining({ exit_code: 0, status: "succeeded" })]);
  });

  test("command starts clear stale user-question state in the live projection", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);

    await postJson(server.baseUrl, "/ingest", liveQuestionPayload("server-live-question"));
    await postJson(server.baseUrl, "/ingest", liveStartedToolPayload("server-live-tool-start"));

    const projection = await getJson(server.baseUrl, "/projection?expandedSessionId=server-live");
    const card = projection.projection.cards[0];

    expect(card.sessionId).toBe("server-live");
    expect(card).toMatchObject({
      lifecycle: "running",
      primaryStatus: "reading",
      stateLabel: "Running"
    });
  });

  test("deferred PostToolUse flushing after Stop keeps the canonical session running", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);

    await postJson(server.baseUrl, "/ingest", liveSuccessfulToolPayload("server-live-tool-after-stop"));
    await postJson(
      server.baseUrl,
      "/ingest",
      liveSessionCompletedPayload("server-live-stop-after-tool", "server-live", "/workspace/masthead", "2026-06-24T12:03:00.000Z")
    );
    await waitForToolResultRowCount(databasePath, 1);

    expect(sessionLifecycleRows(databasePath)).toEqual([
      {
        ended_at: null,
        lifecycle: "running",
        outcome_label: null,
        source_session_id: "server-live"
      }
    ]);
  });

  test("deferred command start enriches an immediate failed command finish", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);

    await postJson(server.baseUrl, "/ingest", liveFailedToolPayload("server-live-failed-finish"));
    await postJson(server.baseUrl, "/ingest", liveToolStartPayload("server-live-start-after-failed-finish"));
    await waitForToolCallStartedAt(databasePath, "2026-06-24T12:01:30.000Z");

    expect(toolCallRows(databasePath)).toEqual([
      expect.objectContaining({
        arguments_redacted_json: JSON.stringify({ command: "npm run failing-tool", commandId: "call-failing-tool" }),
        started_at: "2026-06-24T12:01:30.000Z",
        tool_name: "shell"
      })
    ]);
    expect(toolResultRows(databasePath)).toEqual([expect.objectContaining({ exit_code: 1, status: "failed" })]);
  });

  test("clear discards pending deferred events so deleted state is not repopulated", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);
    const databaseId = await activeDatabaseId(server.baseUrl);

    await postJson(server.baseUrl, "/ingest", liveSuccessfulToolPayload("server-live-clear-pending"));
    await postJson(server.baseUrl, "/clear", { databaseId });
    await delay(900);

    expect(rawJournalRows(databasePath)).toEqual([]);
    expect(toolResultRows(databasePath)).toEqual([]);
    expect((await getJson(server.baseUrl, "/events")).events).toEqual([]);
  });

  test("clear discards a stalled pre-barrier ingest so deleted state is not repopulated", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);
    const databaseId = await activeDatabaseId(server.baseUrl);

    await postJson(server.baseUrl, "/ingest", liveQuestionPayload("server-before-stalled-clear"));
    const stalled = await startStalledJsonPost(server.baseUrl, "/ingest", liveApprovalPayload("server-stalled-clear"));

    await postJson(server.baseUrl, "/clear", { databaseId });
    stalled.finish();
    const stale = await stalled.response;

    expect(stale.status).toBe(202);
    expect(stale.body).toMatchObject({
      ok: true,
      status: "stale",
      events: 0,
      gitSnapshots: 0
    });
    expect(rawJournalRows(databasePath)).toEqual([]);
    expect((await getJson(server.baseUrl, "/events")).events).toEqual([]);
  });

  test("project-scoped data delete accounts for pending deferred events before deleting", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);
    const databaseId = await activeDatabaseId(server.baseUrl);

    await postJson(server.baseUrl, "/ingest", liveSuccessfulToolPayload("server-live-delete-pending"));
    const deleted = await postJson(server.baseUrl, "/data/delete", {
      databaseId,
      scope: {
        kind: "project",
        project: "Masthead"
      }
    });
    await delay(900);

    expect(deleted).toMatchObject({
      ok: true,
      preview: {
        rawEvents: 1,
        sessions: 1
      },
      result: {
        rawEvents: 1,
        sessions: 1
      }
    });
    expect(rawJournalRows(databasePath)).toEqual([]);
    expect(toolResultRows(databasePath)).toEqual([]);
  });

  test("retention prunes pending deferred raw events instead of letting them reappear", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);
    const databaseId = await activeDatabaseId(server.baseUrl);

    await postJson(server.baseUrl, "/ingest", liveSuccessfulToolPayload("server-live-retention-pending"));
    const retained = await postJson(server.baseUrl, "/retention", {
      databaseId,
      policy: {
        cutoffAt: "2026-06-25T00:00:00.000Z",
        recordTypes: ["event"],
        keepUnresolvedAttention: false
      }
    });
    await delay(900);

    expect(retained.result).toMatchObject({
      removedRecords: 1,
      removedRecordIds: ["event:claude_code:server-live-retention-pending"]
    });
    expect(rawJournalRows(databasePath)).toEqual([]);
  });

  test("data lifecycle endpoints summarize, export, and delete canonical session data", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);
    const databaseId = await activeDatabaseId(server.baseUrl);

    await postJson(server.baseUrl, "/ingest", liveApprovalPayload("server-data-lifecycle"));
    await getJson(server.baseUrl, "/projection?expandedSessionId=server-live");

    expect(await getJson(server.baseUrl, withDatabaseId("/data/summary", databaseId))).toMatchObject({
      ok: true,
      summary: {
        rawEvents: 1,
        sessions: 1
      }
    });
    expect(await postJsonOk(server.baseUrl, "/data/export", { databaseId })).toMatchObject({
      ok: true,
      export: {
        metadata: {
          format: "masthead.session-graph.v1",
          schemaVersion: 1
        },
        sessions: [expect.objectContaining({ source_session_id: "server-live" })]
      }
    });

    const deleted = await postJson(server.baseUrl, "/data/delete", { databaseId, scope: { kind: "all" } });

    expect(deleted).toMatchObject({
      ok: true,
      result: {
        rawEvents: 1,
        sessions: 1
      },
      events: 0,
      gitSnapshots: 0
    });
    expect(await getJson(server.baseUrl, withDatabaseId("/data/summary", databaseId))).toMatchObject({
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
      expect(db.prepare("SELECT session_id FROM board_sessions").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("discovers OpenCode sources and imports metadata into canonical sessions", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const homeDir = join(tempDir, "home");
    const opencodeDir = join(homeDir, ".opencode", "sessions");
    await mkdir(opencodeDir, { recursive: true });
    await writeFile(
      join(opencodeDir, "historical-session.jsonl"),
      `${JSON.stringify({
        session_id: "historical-session",
        timestamp: "2026-06-24T12:00:00.000Z",
        project: "Masthead",
        title: "Historical OpenCode session",
        role: "assistant",
        content: "Historical OpenCode metadata"
      })}\n`,
      "utf8"
    );
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_CODEX_HOME: homeDir, MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);

    const sources = await postJson(server.baseUrl, "/sources/discover", {});
    const opencodeSource = (sources.sources as Array<{ runtime?: string; sourceId?: string; sourceKind?: string }>).find(
      (source) => source.runtime === "opencode"
    );
    expect(opencodeSource).toMatchObject({ runtime: "opencode", sourceKind: "jsonl" });

    const imported = await postJson(server.baseUrl, "/adapters/opencode/import-metadata", {});
    expect(imported).toMatchObject({ ok: true, queued: 1, sources: 1 });
    await waitForImportJobs(server.baseUrl, jobIds(imported));

    const db = new DatabaseSync(databasePath);
    try {
      expect(db.prepare("SELECT source_session_id FROM sessions").all()).toEqual([
        {
          source_session_id: "historical-session"
        }
      ]);
      publishSourceSession(db, "historical-session", "Historical OpenCode metadata");
    } finally {
      db.close();
    }

    const search = await getJson(server.baseUrl, "/logbook/search?q=Historical");
    expect(search).toMatchObject({
      ok: true,
      artifacts: [expect.objectContaining({ title: "Historical OpenCode metadata" })]
    });
    expect(search).not.toHaveProperty("sessions");
  });

  test("runs metadata import through the generic import job endpoint", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const homeDir = join(tempDir, "home");
    const opencodeDir = join(homeDir, ".opencode", "sessions");
    await mkdir(opencodeDir, { recursive: true });
    await writeFile(
      join(opencodeDir, "job-session.jsonl"),
      `${JSON.stringify({
        session_id: "job-session",
        timestamp: "2026-06-24T12:00:00.000Z",
        project: "Masthead",
        title: "Import job OpenCode session",
        role: "assistant",
        content: "Import job OpenCode metadata"
      })}\n`,
      "utf8"
    );
    const storePath = join(tempDir, "events.ndjson");
    const databasePath = join(tempDir, "masthead.sqlite");
    const server = await startServer(storePath, { MASTHEAD_CODEX_HOME: homeDir, MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);

    const sources = await postJson(server.baseUrl, "/sources/discover", {});
    const sourceId = (sources.sources as Array<{ runtime?: string; sourceId?: string }>).find(
      (source) => source.runtime === "opencode"
    )?.sourceId;
    expect(sourceId).toBeTruthy();
    const imported = await postJson(server.baseUrl, "/imports", {
      kind: "metadata",
      sourceId
    });

    expect(imported).toMatchObject({
      ok: true,
      job: {
        status: "queued"
      }
    });
    const imports = await waitForImport(server.baseUrl, sourceId as string);
    expect(imports.imports).toEqual([expect.objectContaining({ sourceId, status: "succeeded" })]);
  });

  test("imports OpenCode transcripts incrementally using persisted cursors", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const homeDir = join(tempDir, "home");
    const sessionsDir = join(homeDir, ".opencode", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const transcriptPath = join(sessionsDir, "historical-session.jsonl");
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
    const server = await startServer(storePath, { MASTHEAD_CODEX_HOME: homeDir, MASTHEAD_DB_PATH: databasePath });
    servers.push(server.child);

    const sources = await postJson(server.baseUrl, "/sources/discover", {});
    const sourceId = (sources.sources as Array<{ runtime?: string; sourceId?: string }>).find((source) => source.runtime === "opencode")
      ?.sourceId;
    expect(sourceId).toBeTruthy();

    const unapproved = await fetch(`${server.baseUrl}/imports`, {
      body: JSON.stringify({ kind: "transcript", sourceId }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    expect(unapproved.status).toBe(409);

    const policyDb = new DatabaseSync(databasePath);
    try {
      setSourcePolicy(policyDb, {
        decidedAt: "2026-07-08T12:00:00.000Z",
        enabled: true,
        policyKind: "transcript_import",
        sourceId: sourceId as string
      });
    } finally {
      policyDb.close();
    }

    const firstImport = await postJson(server.baseUrl, "/imports", { kind: "transcript", sourceId });
    expect(firstImport).toMatchObject({ ok: true, job: { status: "queued" } });
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
    const secondImport = await postJson(server.baseUrl, "/imports", { kind: "transcript", sourceId });
    expect(secondImport).toMatchObject({ ok: true, job: { status: "queued" } });
    await waitForImportJobs(server.baseUrl, jobIds(secondImport));

    const db = new DatabaseSync(databasePath);
    try {
      expect(db.prepare("SELECT role, text_redacted FROM messages ORDER BY observed_at").all()).toEqual([
        { role: "user", text_redacted: "First transcript message" },
        { role: "assistant", text_redacted: "Second transcript message" }
      ]);
      expect(db.prepare("SELECT byte_offset FROM ingest_cursors WHERE source_path = ?").get(transcriptPath)).toMatchObject({
        byte_offset: Buffer.byteLength(await readFile(transcriptPath, "utf8"))
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
    expect(accepted.gitSnapshots).toBe(0);
    const refreshed = await postJson(server.baseUrl, "/refresh", {});
    expect(refreshed.gitSnapshots).toBe(2);

    const projection = await getJson(server.baseUrl, "/projection?expandedSessionId=session-git-a");

    expect(projection.gitSnapshots).toBe(2);
    expect(projection.projection.summary.conflicts).toBe(1);
    expect(projection.projection.conflicts[0]).toMatchObject({
      type: "exact_file_overlap",
      severity: "high",
      attribution: "direct",
      sharedPaths: ["src/shared.ts"],
      sessionIds: expect.arrayContaining(["session-git-a", "session-git-b"])
    });
    expect(projection.projection.conflicts[0].sessionIds).toHaveLength(2);
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
    expect(accepted.gitSnapshots).toBe(0);
    expect((await postJson(server.baseUrl, "/refresh", {})).gitSnapshots).toBe(1);
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
      changedFileCount: 1
    });
  });

  test("deferred workspace events after Stop can append non-terminal Git snapshots", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "masthead.sqlite");
    const repoPath = join(tempDir, "repo");
    await createCleanRepo(repoPath);
    const server = await startServer(join(tempDir, "events.ndjson"), { MASTHEAD_DB_PATH: databasePath, MASTHEAD_GIT_REFRESH_MS: "0" });
    servers.push(server.child);

    await postJson(server.baseUrl, "/ingest", liveSessionPayload("server-completed-unrefreshed-start", "session-completed-unrefreshed", repoPath));
    const completedPayload = liveSessionCompletedPayload("server-completed-unrefreshed-stop", "session-completed-unrefreshed", repoPath);
    delete completedPayload["cwd"];
    delete completedPayload["repo_root"];
    await postJson(server.baseUrl, "/ingest", completedPayload);

    await writeFile(join(repoPath, "src/shared.ts"), "export const value = 4;\n", "utf8");
    await postJson(
      server.baseUrl,
      "/ingest",
      liveSuccessfulToolPayload(
        "server-completed-unrefreshed-late-tool",
        "session-completed-unrefreshed",
        repoPath,
        "2026-06-23T03:37:00.000Z"
      )
    );
    await waitForToolResultRowCount(databasePath, 1);
    await delay(300);

    const refresh = await postJson(server.baseUrl, "/refresh", {});
    expect(refresh.gitSnapshots).toBeGreaterThanOrEqual(1);
    expect(gitSnapshotRawRows(databasePath).map(gitSnapshotIdFromRawRow)).not.toEqual(
      expect.arrayContaining([expect.stringContaining(":terminal:claude_code:server-completed-unrefreshed-stop")])
    );
  });

  test("refresh does not capture a terminal Git snapshot after turn completion", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-ingest-server-"));
    tempDirs.push(tempDir);
    const repoPath = join(tempDir, "repo");
    await createCleanRepo(repoPath);
    const server = await startServer(join(tempDir, "events.ndjson"), { MASTHEAD_GIT_REFRESH_MS: "0" });
    servers.push(server.child);

    await postJson(server.baseUrl, "/ingest", liveSessionPayload("server-completed-refresh-start", "session-completed-refresh", repoPath));
    expect((await postJson(server.baseUrl, "/refresh", {})).gitSnapshots).toBe(1);

    const completedPayload = liveSessionCompletedPayload("server-completed-refresh-stop", "session-completed-refresh", repoPath);
    delete completedPayload["cwd"];
    delete completedPayload["repo_root"];
    await postJson(server.baseUrl, "/ingest", completedPayload);

    const refresh = await postJson(server.baseUrl, "/refresh", {});

    expect(refresh.refreshed).toBe(0);
    expect(refresh.gitSnapshots).toBe(1);
    expect(gitSnapshotRawRows(join(tempDir, "masthead.sqlite"))).toHaveLength(1);
    expect(gitSnapshotRawRows(join(tempDir, "masthead.sqlite")).map(gitSnapshotIdFromRawRow)).not.toEqual(
      expect.arrayContaining([expect.stringContaining(":terminal:claude_code:server-completed-refresh-stop")])
    );

    await writeFile(join(repoPath, "src/shared.ts"), "export const value = 4;\n", "utf8");
    await postJson(
      server.baseUrl,
      "/ingest",
      liveSuccessfulToolPayload(
        "server-completed-refresh-late-tool",
        "session-completed-refresh",
        repoPath,
        "2026-06-23T03:37:00.000Z"
      )
    );
    await waitForToolResultRowCount(join(tempDir, "masthead.sqlite"), 1);
    expect((await getJson(server.baseUrl, "/events")).gitSnapshots.length).toBeGreaterThanOrEqual(1);
    expect(gitSnapshotRawRows(join(tempDir, "masthead.sqlite")).length).toBeGreaterThanOrEqual(1);

    const secondRefresh = await postJson(server.baseUrl, "/refresh", {});
    expect(secondRefresh.gitSnapshots).toBeGreaterThanOrEqual(2);
    expect((await getJson(server.baseUrl, "/events")).gitSnapshots.length).toBeGreaterThanOrEqual(2);
    expect(gitSnapshotRawRows(join(tempDir, "masthead.sqlite")).length).toBeGreaterThanOrEqual(2);
    expect(gitSnapshotRawRows(join(tempDir, "masthead.sqlite")).map(gitSnapshotIdFromRawRow)).not.toEqual(
      expect.arrayContaining([expect.stringContaining(":terminal:claude_code:server-completed-refresh-stop")])
    );
  });
});

async function startServer(
  storePath: string,
  env: Record<string, string> = {}
): Promise<{ baseUrl: string; child: TestServerProcess }> {
  const defaultCodexHome = join(dirname(storePath), "codex-home");
  if (!env.MASTHEAD_CODEX_HOME) {
    await mkdir(join(defaultCodexHome, ".codex"), { recursive: true });
  }
  const child = spawn(process.execPath, [serverScript], {
    cwd: projectRoot,
    env: {
      ...process.env,
      MASTHEAD_CODEX_HOME: defaultCodexHome,
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
    const timeout = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 15_000);

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
  const requestPath = path === "/ingest" ? DEFAULT_LIVE_INGEST_PATH : path;
  const response = await fetch(`${baseUrl}${requestPath}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(202);
  return response.json() as Promise<Record<string, unknown>>;
}

async function postJsonOk(baseUrl: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

async function startStalledJsonPost(
  baseUrl: string,
  path: string,
  body: unknown
): Promise<{ finish: () => void; response: Promise<{ body: Record<string, unknown>; status: number }> }> {
  const requestPath = path === "/ingest" ? DEFAULT_LIVE_INGEST_PATH : path;
  const target = new URL(`${baseUrl}${requestPath}`);
  const payload = JSON.stringify(body);
  const splitAt = Math.max(1, Math.floor(payload.length / 2));
  let finish: (() => void) | undefined;

  let requestStarted: () => void = () => undefined;
  let requestFailed: (error: Error) => void = () => undefined;
  const started = new Promise<void>((resolve, reject) => {
    requestStarted = resolve;
    requestFailed = reject;
  });

  const response = new Promise<{ body: Record<string, unknown>; status: number }>((resolve, reject) => {
    const request = httpRequest(
      {
        headers: {
          connection: "close",
          "content-length": Buffer.byteLength(payload),
          "content-type": "application/json",
          expect: "100-continue"
        },
        hostname: target.hostname,
        method: "POST",
        path: `${target.pathname}${target.search}`,
        port: Number(target.port)
      },
      (incoming) => {
        let raw = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk) => {
          raw += chunk;
        });
        incoming.on("end", () => {
          resolve({ body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {}, status: incoming.statusCode ?? 0 });
        });
      }
    );
    request.on("continue", () => {
      request.write(payload.slice(0, splitAt));
      finish = () => request.end(payload.slice(splitAt));
      requestStarted();
    });
    request.on("error", (error) => {
      requestFailed(error);
      reject(error);
    });
    request.flushHeaders();
  });

  await started;
  return {
    finish: () => finish?.(),
    response
  };
}

async function getJson(baseUrl: string, path: string): Promise<Record<string, any>> {
  const response = await fetch(`${baseUrl}${path}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, any>>;
}

async function activeDatabaseId(baseUrl: string): Promise<string> {
  const settings = await getJson(baseUrl, "/settings");
  return settings.settings.data.databaseId as string;
}

function withDatabaseId(path: string, databaseId: string): string {
  const url = new URL(path, "http://masthead.test");
  url.searchParams.set("databaseId", databaseId);
  return `${url.pathname}${url.search}`;
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

async function waitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 1500;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  assertion();
  throw lastError;
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

async function waitForToolResultRowCount(databasePath: string, count: number): Promise<void> {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    if (toolResultRows(databasePath).length === count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForToolCallStartedAt(databasePath: string, startedAt: string): Promise<void> {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    if (toolCallRows(databasePath).some((row) => row.started_at === startedAt)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jobIds(response: Record<string, any>): string[] {
  if (response.job?.importJobId) return [response.job.importJobId];
  if (response.importJobId) return [response.importJobId];
  return (response.jobs ?? []).map((job: { importJobId: string }) => job.importJobId);
}

function publishSourceSession(db: DatabaseSync, sourceSessionId: string, artifactTitle: string): void {
  db.exec("PRAGMA busy_timeout = 3000;");
  const row = db
    .prepare(
      `SELECT session_id AS sessionId, project_label AS project
       FROM sessions
       WHERE source_session_id = ? AND deleted_at IS NULL`
    )
    .get(sourceSessionId) as { project: string | null; sessionId: string } | undefined;
  expect(row?.sessionId).toBeTruthy();
  markWorkbenchPublished(db, {
    actor: { kind: "system", id: "test" },
    publishedVia: "test",
    sessionId: row!.sessionId
  });
  const artifact = applySessionArtifact(db, {
    artifactKind: "session_dossier",
    confidence: "high",
    content: { problemStatement: artifactTitle },
    contentFingerprint: `test:${sourceSessionId}`,
    createdBy: "test",
    evidenceRefs: [],
    projectLabel: row!.project ?? undefined,
    schemaVersion: "session-dossier-v1",
    sessionId: row!.sessionId,
    summary: artifactTitle,
    title: artifactTitle,
    validation: { ok: true }
  });
  publishSessionArtifact(db, artifact.artifactId);
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

function liveQuestionPayload(providerEventId: string): Record<string, unknown> {
  return {
    provider_event_id: providerEventId,
    event: "user_question",
    session_id: "server-live",
    timestamp: "2026-06-24T12:01:00.000Z",
    cwd: "/workspace/masthead",
    repo_root: "/workspace/masthead",
    project: "Masthead",
    title: "Lightweight live facts",
    message: "Make Masthead live facts lightweight."
  };
}

function liveClaudePromptPayload(providerEventId: string): Record<string, unknown> {
  return {
    provider_event_id: providerEventId,
    hookEventName: "UserPromptSubmit",
    sessionId: "claude-server-live",
    timestamp: "2026-06-23T03:31:00.000Z",
    cwd: "/workspace/masthead",
    workspaceRoot: "/workspace/masthead",
    gitBranch: "agent/claude-live",
    project: "Masthead",
    title: "Claude live projection",
    prompt: "RAW_PROMPT_NOT_STORED"
  };
}


function liveStartedToolPayload(providerEventId: string): Record<string, unknown> {
  return {
    provider_event_id: providerEventId,
    hookEventName: "PreToolUse",
    sessionId: "server-live",
    timestamp: new Date().toISOString(),
    cwd: "/workspace/masthead",
    repo_root: "/workspace/masthead",
    project: "Masthead",
    toolName: "Read",
    toolUseId: "call-active-tool",
    toolInput: {
      path: "src/app/App.tsx"
    }
  };
}

function liveSuccessfulToolPayload(
  providerEventId: string,
  sessionId = "server-live",
  repoPath = "/workspace/masthead",
  timestamp = "2026-06-24T12:02:00.000Z"
): Record<string, unknown> {
  return {
    provider_event_id: providerEventId,
    hookEventName: "PostToolUse",
    sessionId,
    timestamp,
    cwd: repoPath,
    repo_root: repoPath,
    project: "Masthead",
    exit_code: 0,
    toolName: "Bash",
    toolUseId: "call-noisy-tool-stat",
    toolInput: {
      command: "npm run noisy-tool-stat"
    },
    toolResponse: "exit code 0"
  };
}

function liveFailedToolPayload(providerEventId: string): Record<string, unknown> {
  return {
    provider_event_id: providerEventId,
    hookEventName: "PostToolUse",
    sessionId: "server-live",
    timestamp: "2026-06-24T12:02:00.000Z",
    cwd: "/workspace/masthead",
    repo_root: "/workspace/masthead",
    project: "Masthead",
    exit_code: 1,
    toolName: "Bash",
    toolUseId: "call-failing-tool",
    toolInput: {
      command: "npm run failing-tool"
    },
    toolResponse: "exit code 1"
  };
}

function liveToolStartPayload(providerEventId: string): Record<string, unknown> {
  return {
    provider_event_id: providerEventId,
    hookEventName: "PreToolUse",
    sessionId: "server-live",
    timestamp: "2026-06-24T12:01:30.000Z",
    cwd: "/workspace/masthead",
    repo_root: "/workspace/masthead",
    project: "Masthead",
    toolName: "Bash",
    toolUseId: "call-failing-tool",
    toolInput: {
      command: "npm run failing-tool"
    }
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

function liveSessionCompletedPayload(
  providerEventId: string,
  sessionId: string,
  repoPath: string,
  timestamp = "2026-06-23T03:36:00.000Z"
): Record<string, unknown> {
  return {
    provider_event_id: providerEventId,
    hookEventName: "Stop",
    sessionId,
    timestamp,
    cwd: repoPath,
    repo_root: repoPath,
    project: "Masthead",
    lastAssistantMessage: "Completed the live Git refresh session."
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

function gitSnapshotRawRows(databasePath: string): Array<{ source_kind: string; source_record_key: string; payload_json: string }> {
  return rawJournalRows(databasePath).filter((row) => {
    const record = JSON.parse(row.payload_json) as { recordType?: string };
    return record.recordType === "git_snapshot";
  });
}

function gitSnapshotIdFromRawRow(row: { payload_json: string }): string {
  const record = JSON.parse(row.payload_json) as { value?: { snapshotId?: string } };
  return record.value?.snapshotId ?? "";
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

function toolResultRows(databasePath: string): Array<{ exit_code: number | null; status: string }> {
  const db = new DatabaseSync(databasePath);
  try {
    return db.prepare("SELECT exit_code, status FROM tool_results ORDER BY completed_at").all() as Array<{ exit_code: number | null; status: string }>;
  } finally {
    db.close();
  }
}

function toolCallRows(databasePath: string): Array<{ arguments_redacted_json: string | null; started_at: string | null; tool_name: string }> {
  const db = new DatabaseSync(databasePath);
  try {
    return db
      .prepare("SELECT tool_name, arguments_redacted_json, started_at FROM tool_calls ORDER BY started_at")
      .all() as Array<{ arguments_redacted_json: string | null; started_at: string | null; tool_name: string }>;
  } finally {
    db.close();
  }
}

function sessionLifecycleRows(databasePath: string): Array<{
  ended_at: string | null;
  lifecycle: string;
  outcome_label: string | null;
  source_session_id: string;
}> {
  const db = new DatabaseSync(databasePath);
  try {
    return db
      .prepare("SELECT source_session_id, lifecycle, outcome_label, ended_at FROM sessions ORDER BY source_session_id")
      .all() as Array<{ ended_at: string | null; lifecycle: string; outcome_label: string | null; source_session_id: string }>;
  } finally {
    db.close();
  }
}

function sessionRuntimeRows(databasePath: string): Array<{ runtime_kind: string; source_session_id: string }> {
  const db = new DatabaseSync(databasePath);
  try {
    return db
      .prepare(
        `SELECT sessions.source_session_id, runtimes.runtime_kind
        FROM sessions
        JOIN runtimes ON runtimes.runtime_id = sessions.runtime_id
        ORDER BY sessions.source_session_id`
      )
      .all() as Array<{ runtime_kind: string; source_session_id: string }>;
  } finally {
    db.close();
  }
}

function canonicalSessionIdFromDatabase(databasePath: string, sourceSessionId: string): string | undefined {
  const db = new DatabaseSync(databasePath);
  try {
    const row = db
      .prepare("SELECT session_id AS sessionId FROM sessions WHERE source_session_id = ?")
      .get(sourceSessionId) as { sessionId: string } | undefined;
    return row?.sessionId;
  } finally {
    db.close();
  }
}

function transcriptMessageTexts(databasePath: string, sessionId: string): string[] {
  const db = new DatabaseSync(databasePath);
  try {
    const rows = db
      .prepare("SELECT text_redacted AS text FROM messages WHERE session_id = ? ORDER BY observed_at ASC")
      .all(sessionId) as Array<{ text: string }>;
    return rows.map((row) => row.text);
  } finally {
    db.close();
  }
}

async function readTranscriptFixture(path: string): Promise<string> {
  return readFile(path, "utf8");
}
