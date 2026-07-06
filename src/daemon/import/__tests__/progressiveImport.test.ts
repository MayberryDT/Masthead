import { writeFile, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import type { DaemonConfig } from "../../config.ts";
import { createImportJob, getImportJob, type ImportJobDto } from "../../db/importJobRepository.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../../server.ts";

const daemons: MastheadDaemon[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(daemons.splice(0).map((daemon) => daemon.close().catch(() => undefined)));
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

type ImportActionResponse = Record<string, unknown> & {
  job?: ImportJobDto;
  jobs: ImportJobDto[];
};

describe("progressive OpenCode imports", () => {
  test("queues adapter metadata import jobs and persists imported progress", async () => {
    const { daemon, opencodeRoot } = await createTestHarness();
    await writeJsonl(join(opencodeRoot, "session_index.jsonl"), [
      {
        session_id: "metadata-session",
        timestamp: "2026-06-25T12:00:00.000Z",
        project: "Masthead",
        title: "Metadata import smoke"
      }
    ]);
    const baseUrl = await listen(daemon);

    const queued = await postJson(baseUrl, "/adapters/opencode/import-metadata");

    expect(queued).toMatchObject({ ok: true, queued: 1, sources: 1 });
    const job = queued.jobs[0];
    expect(job).toMatchObject({ importKind: "metadata", status: "queued" });
    expect(job.sourceId).toContain("opencode");

    await waitFor(() => getImportJob(daemon.database, job.importJobId)?.status === "succeeded");
    expect(getImportJob(daemon.database, job.importJobId)).toMatchObject({
      discoveredCount: 1,
      importedCount: 1,
      processedCount: 1,
      progressCurrent: 1,
      progressPercent: 100,
      progressTotal: 1,
      status: "succeeded"
    });
    expect(countRows(daemon.database, "sessions")).toBe(1);
  });

  test("imports approved transcripts into sessions without duplicating a second import", async () => {
    const { daemon, opencodeRoot } = await createTestHarness();
    await writeJsonl(join(opencodeRoot, "sessions", "2026", "06", "25", "session.jsonl"), [
      {
        type: "session_meta",
        timestamp: "2026-06-25T12:00:00.000Z",
        payload: {
          session_id: "transcript-session",
          cwd: "/home/tyler/Documents/Masthead",
          model: "gpt-5"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-25T12:01:00.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Import this transcript" }]
        }
      }
    ]);
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/adapters/opencode/approve-transcripts");
    const first = await postJson(baseUrl, "/adapters/opencode/import-transcripts");

    expect(first).toMatchObject({ ok: true, queued: 1, sources: 1 });
    await waitFor(() => getImportJob(daemon.database, first.jobs[0].importJobId)?.status === "succeeded");
    expect(getImportJob(daemon.database, first.jobs[0].importJobId)).toMatchObject({
      discoveredCount: 2,
      importedCount: 2,
      processedCount: 2,
      status: "succeeded"
    });
    expect(countRows(daemon.database, "sessions")).toBe(1);
    expect(countRows(daemon.database, "messages")).toBe(1);

    const second = await postJson(baseUrl, "/adapters/opencode/import-transcripts");
    await waitFor(() => getImportJob(daemon.database, second.jobs[0].importJobId)?.status === "succeeded");

    expect(countRows(daemon.database, "sessions")).toBe(1);
    expect(countRows(daemon.database, "messages")).toBe(1);
  });

  test("imports transcript token counts onto existing hook sessions", async () => {
    const { daemon, opencodeRoot } = await createTestHarness();
    await writeJsonl(join(opencodeRoot, "sessions", "2026", "06", "25", "session.jsonl"), [
      {
        type: "session_meta",
        timestamp: "2026-06-25T12:00:00.000Z",
        payload: {
          session_id: "shared-session",
          cwd: "/home/tyler/Documents/Masthead",
          model: "gpt-5"
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-06-25T12:01:00.000Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 20,
              output_tokens: 5,
              total_tokens: 25
            }
          }
        }
      }
    ]);
    const baseUrl = await listen(daemon);
    await ingestHook(baseUrl, {
      event: "session_started",
      model: "gpt-5",
      session_id: "shared-session",
      timestamp: "2026-06-25T12:00:00.000Z"
    });

    await postJson(baseUrl, "/adapters/opencode/approve-transcripts");
    const imported = await postJson(baseUrl, "/adapters/opencode/import-transcripts");

    await waitFor(() => getImportJob(daemon.database, imported.jobs[0].importJobId)?.status === "succeeded");
    expect(countRows(daemon.database, "sessions")).toBe(1);
    expect(tokenTotals(daemon.database)).toMatchObject({
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 25
    });
  });


  test("does not import hook transcriptPath before transcript import approval", async () => {
    const { daemon, opencodeRoot } = await createTestHarness();
    const transcriptPath = join(opencodeRoot, "sessions", "2026", "06", "25", "unapproved-token-session.jsonl");
    await writeJsonl(transcriptPath, [
      {
        type: "session_meta",
        timestamp: "2026-06-25T12:00:00.000Z",
        payload: { session_id: "unapproved-token-session", model: "gpt-5" }
      },
      {
        type: "event_msg",
        timestamp: "2026-06-25T12:01:00.000Z",
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } }
        }
      }
    ]);
    const baseUrl = await listen(daemon);

    await ingestHook(baseUrl, {
      event: "session_started",
      model: "gpt-5",
      session_id: "unapproved-token-session",
      timestamp: "2026-06-25T12:00:00.000Z",
      transcriptPath
    });

    await yieldToEventLoop();
    expect(countRows(daemon.database, "sessions")).toBe(1);
    expect(tokenTotals(daemon.database)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

    const sessionId = sessionIdFor(daemon.database, "unapproved-token-session");
    await getJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/transcript?limit=20`);
    await yieldToEventLoop();
    expect(tokenTotals(daemon.database)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  test("does not import hook transcriptPath on session open when hook transcript catch-up is disabled", async () => {
    const { daemon, opencodeRoot } = await createTestHarness({ hookTranscriptCatchupEnabled: false });
    const transcriptPath = join(opencodeRoot, "sessions", "2026", "06", "25", "disabled-catchup-session.jsonl");
    await writeJsonl(transcriptPath, [
      {
        type: "session_meta",
        timestamp: "2026-06-25T12:00:00.000Z",
        payload: { session_id: "disabled-catchup-session", model: "gpt-5" }
      },
      {
        type: "event_msg",
        timestamp: "2026-06-25T12:01:00.000Z",
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } }
        }
      }
    ]);
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/adapters/opencode/approve-transcripts");
    await ingestHook(baseUrl, {
      event: "session_started",
      model: "gpt-5",
      session_id: "disabled-catchup-session",
      timestamp: "2026-06-25T12:00:00.000Z",
      transcriptPath
    });
    await yieldToEventLoop();

    expect(tokenTotals(daemon.database)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    const sessionId = sessionIdFor(daemon.database, "disabled-catchup-session");

    await getJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/transcript?limit=20`);
    await yieldToEventLoop();
    expect(tokenTotals(daemon.database)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    expect(countWhere(daemon.database, "model_usage", "session_id = ?", sessionId)).toBe(0);
  });

  test("keeps hook ingestion accepted when approved transcriptPath is missing", async () => {
    const { daemon, opencodeRoot } = await createTestHarness();
    const transcriptPath = join(opencodeRoot, "sessions", "2026", "06", "25", "missing-token-session.jsonl");
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/adapters/opencode/approve-transcripts");
    await ingestHook(baseUrl, {
      event: "session_started",
      model: "gpt-5",
      session_id: "missing-token-session",
      timestamp: "2026-06-25T12:00:00.000Z",
      transcriptPath
    });

    expect(countRows(daemon.database, "sessions")).toBe(1);
    expect(tokenTotals(daemon.database)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  test("keeps hook ingestion accepted when approved hook has no transcriptPath", async () => {
    const { daemon } = await createTestHarness();
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/adapters/opencode/approve-transcripts");
    await ingestHook(baseUrl, {
      event: "session_started",
      model: "gpt-5",
      session_id: "no-transcript-path-session",
      timestamp: "2026-06-25T12:00:00.000Z"
    });

    expect(countRows(daemon.database, "sessions")).toBe(1);
    expect(tokenTotals(daemon.database)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  test("does not import hook transcriptPath symlinks that escape the OpenCode sessions tree", async () => {
    const { daemon, opencodeRoot, tempDir } = await createTestHarness();
    const outsideTranscriptPath = join(tempDir, "outside-transcript.jsonl");
    await writeJsonl(outsideTranscriptPath, [
      {
        type: "session_meta",
        timestamp: "2026-06-25T12:00:00.000Z",
        payload: { session_id: "escaped-token-session", model: "gpt-5" }
      },
      {
        type: "event_msg",
        timestamp: "2026-06-25T12:01:00.000Z",
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: 8, output_tokens: 5, total_tokens: 13 } }
        }
      }
    ]);
    const transcriptPath = join(opencodeRoot, "sessions", "2026", "06", "25", "escaped-token-session.jsonl");
    await mkdir(dirname(transcriptPath), { recursive: true });
    await symlink(outsideTranscriptPath, transcriptPath);
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/adapters/opencode/approve-transcripts");
    await ingestHook(baseUrl, {
      event: "session_started",
      model: "gpt-5",
      session_id: "escaped-token-session",
      timestamp: "2026-06-25T12:00:00.000Z",
      transcriptPath
    });

    await yieldToEventLoop();
    expect(countRows(daemon.database, "sessions")).toBe(1);
    expect(tokenTotals(daemon.database)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  test("imports useful transcript rows and serves them through the transcript endpoint", async () => {
    const { daemon, opencodeRoot } = await createTestHarness();
    await writeJsonl(join(opencodeRoot, "sessions", "2026", "06", "25", "useful-session.jsonl"), [
      {
        type: "session_meta",
        timestamp: "2026-06-25T12:00:00.000Z",
        payload: {
          session_id: "useful-session",
          cwd: "/home/tyler/Documents/Masthead",
          model: "gpt-5"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-25T12:01:00.000Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Show me the real session conversation." }]
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-25T12:02:00.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "I added the transcript-first detail view." }]
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-25T12:03:00.000Z",
        payload: {
          type: "function_call",
          call_id: "call-1",
          name: "shell",
          arguments: "{\"cmd\":\"npm test\"}"
        }
      },
      {
        type: "response_item",
        timestamp: "2026-06-25T12:04:00.000Z",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: "Tests passed."
        }
      },
      {
        type: "event_msg",
        timestamp: "2026-06-25T12:05:00.000Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 100,
              output_tokens: 25,
              total_tokens: 125
            }
          }
        }
      },
      {
        type: "checkpoint",
        timestamp: "2026-06-25T12:06:00.000Z",
        payload: {
          checkpoint_id: "checkpoint-1",
          summary: "Transcript detail implementation checkpoint."
        }
      }
    ]);
    const baseUrl = await listen(daemon);

    await postJson(baseUrl, "/adapters/opencode/approve-transcripts");
    const imported = await postJson(baseUrl, "/adapters/opencode/import-transcripts");

    await waitFor(() => getImportJob(daemon.database, imported.jobs[0].importJobId)?.status === "succeeded");
    const sessionId = sessionIdFor(daemon.database, "useful-session");
    expect(countWhere(daemon.database, "messages", "session_id = ? AND role = 'user'", sessionId)).toBeGreaterThan(0);
    expect(countWhere(daemon.database, "messages", "session_id = ? AND role = 'assistant'", sessionId)).toBeGreaterThan(0);
    expect(countWhere(daemon.database, "tool_calls", "session_id = ?", sessionId)).toBeGreaterThan(0);
    expect(countWhere(daemon.database, "model_usage", "session_id = ?", sessionId)).toBeGreaterThan(0);

    const transcript = await getJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/transcript?limit=20`);

    expect(transcript).toMatchObject({
      ok: true,
      coverage: {
        assistantMessages: 1,
        hasUsableTranscript: true,
        userMessages: 1
      }
    });
    expect(transcript.items.map((item) => item.text)).toEqual(
      expect.arrayContaining(["Show me the real session conversation.", "I added the transcript-first detail view."])
    );
  });

  test("cancels import jobs through the backend status endpoint", async () => {
    const { daemon } = await createTestHarness();
    seedSource(daemon, "opencode-session-index");
    const job = createImportJob(daemon.database, {
      importKind: "metadata",
      sourceId: "opencode-session-index",
      updatedAt: "2026-06-25T12:00:00.000Z"
    });
    const baseUrl = await listen(daemon);

    const cancelled = await postJson(baseUrl, `/imports/${job.importJobId}/cancel`);

    expect(cancelled.job).toMatchObject({ importJobId: job.importJobId, status: "cancelled" });
    expect(getImportJob(daemon.database, job.importJobId)?.status).toBe("cancelled");
  });
});

async function createTestHarness(
  options: { hookTranscriptCatchupEnabled?: boolean; tempDir?: string } = {}
): Promise<{ daemon: MastheadDaemon; tempDir: string; opencodeRoot: string }> {
  const tempDir = options.tempDir ?? (await mkdtemp(join(tmpdir(), "masthead-progressive-import-")));
  if (!options.tempDir) tempDirs.push(tempDir);
  const opencodeRoot = join(tempDir, ".opencode");
  await mkdir(opencodeRoot, { recursive: true });
  const config: DaemonConfig = {
    allowedOrigins: ["http://127.0.0.1:5173"],
    codexHomeDir: tempDir,
    databasePath: join(tempDir, "masthead.sqlite"),
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    hookTranscriptCatchupEnabled: options.hookTranscriptCatchupEnabled ?? true,
    llmCopyEnabled: false,
    port: 0,
    storePath: join(tempDir, "events.ndjson")
  };
  const daemon = await createMastheadDaemon(config);
  daemons.push(daemon);
  return { opencodeRoot, daemon, tempDir };
}

async function closeTrackedDaemon(daemon: MastheadDaemon): Promise<void> {
  const index = daemons.indexOf(daemon);
  if (index >= 0) daemons.splice(index, 1);
  await daemon.close();
}

async function writeJsonl(path: string, rows: unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const supportedRows = supportedTranscriptRows(rows);
  await writeFile(path, `${supportedRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function supportedTranscriptRows(rows: unknown[]): unknown[] {
  let sessionId: string | undefined;
  return rows.flatMap((row): unknown[] => {
    const record = row as Record<string, any>;
    const payload = record.payload && typeof record.payload === "object" ? (record.payload as Record<string, any>) : {};
    const timestamp = record.timestamp;
    if (record.type === "session_meta") {
      sessionId = payload.session_id ?? payload.sessionId ?? payload.id ?? record.session_id ?? record.sessionId;
      return [
        {
          cwd: payload.cwd,
          model: payload.model,
          session_id: sessionId,
          timestamp
        }
      ];
    }
    if (record.session_id || record.sessionId) {
      return [
        {
          content: record.title ?? record.project ?? "OpenCode metadata import",
          role: "user",
          session_id: record.session_id ?? record.sessionId,
          timestamp
        }
      ];
    }
    const currentSessionId = record.session_id ?? record.sessionId ?? sessionId;
    if (!currentSessionId) return [];
    if (record.type === "response_item" && payload.type === "message") {
      return [
        {
          content: payload.content,
          role: payload.role,
          session_id: currentSessionId,
          timestamp
        }
      ];
    }
    if (record.type === "response_item" && payload.type === "function_call") {
      return [
        {
          session_id: currentSessionId,
          timestamp,
          toolName: payload.name
        }
      ];
    }
    const usage = payload.info?.last_token_usage;
    if (record.type === "event_msg" && payload.type === "token_count" && usage) {
      return [
        {
          session_id: currentSessionId,
          timestamp,
          usage: {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            total_tokens: usage.total_tokens
          }
        }
      ];
    }
    return [];
  });
}

function listen(daemon: MastheadDaemon): Promise<string> {
  return new Promise((resolve) => {
    daemon.server.listen(0, "127.0.0.1", () => {
      const address = daemon.server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function postJson(baseUrl: string, path: string): Promise<ImportActionResponse> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" }, method: "POST" });
  expect(response.status).toBe(202);
  const body = (await response.json()) as Record<string, unknown>;
  return { ...body, jobs: Array.isArray(body.jobs) ? (body.jobs as ImportJobDto[]) : [] };
}

async function ingestHook(baseUrl: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${baseUrl}/ingest?runtime=opencode`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(202);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => resolve());
  });
}


function countRows(database: MastheadDaemon["database"], table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function countWhere(database: MastheadDaemon["database"], table: string, where: string, ...values: Array<string | number | null>): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get(...values) as { count: number };
  return row.count;
}

function sessionIdFor(database: MastheadDaemon["database"], sourceSessionId: string): string {
  const row = database.prepare("SELECT session_id AS sessionId FROM sessions WHERE source_session_id = ?").get(sourceSessionId) as
    | { sessionId: string }
    | undefined;
  expect(row).toBeDefined();
  return row?.sessionId ?? "";
}

async function getJson(baseUrl: string, path: string): Promise<{ ok?: boolean; coverage?: Record<string, unknown>; items: Array<{ text: string }> }> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  expect(response.status).toBe(200);
  return (await response.json()) as { ok?: boolean; coverage?: Record<string, unknown>; items: Array<{ text: string }> };
}

function tokenTotals(database: MastheadDaemon["database"]): { inputTokens: number; outputTokens: number; totalTokens: number } {
  return database
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(input_tokens, 0)), 0) AS inputTokens,
        COALESCE(SUM(COALESCE(output_tokens, 0)), 0) AS outputTokens,
        COALESCE(SUM(COALESCE(total_tokens, 0)), 0) AS totalTokens
      FROM model_usage`
    )
    .get() as { inputTokens: number; outputTokens: number; totalTokens: number };
}

function seedSource(daemon: MastheadDaemon, sourceId: string): void {
  daemon.database
    .prepare(
      `INSERT INTO ingest_sources (
        source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(sourceId, "opencode", "jsonl", "/tmp/.opencode/session_index.jsonl", "authoritative", "2026-06-25T12:00:00.000Z", "2026-06-25T12:00:00.000Z");
}
