import { writeFile, mkdir, mkdtemp, rm, symlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import type { DaemonConfig } from "../../config.ts";
import { createImportJob, getImportJob, listImportJobs, updateImportJob, type ImportJobDto } from "../../db/importJobRepository.ts";
import { setSourcePolicy } from "../../db/sourcePolicyRepository.ts";
import { readImportWorkUnitHealth } from "../../db/sessionImportHealthRepository.ts";
import { markWorkbenchPublished } from "../../db/workbenchPipelineRepository.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../../server.ts";
import { createManifestForJob } from "../importManifestService.ts";

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
    await writeOpenCodeDatabase(opencodeRoot, [
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
    await writeOpenCodeDatabase(opencodeRoot, [
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

    const first = await queueTranscriptImport(baseUrl, daemon, opencodeRoot);

    expect(first).toMatchObject({ ok: true, job: { importKind: "transcript" } });
    await waitFor(() => getImportJob(daemon.database, first.jobs[0].importJobId)?.status === "succeeded");
    expect(getImportJob(daemon.database, first.jobs[0].importJobId)).toMatchObject({
      discoveredCount: 2,
      importedCount: 2,
      processedCount: 2,
      status: "succeeded"
    });
    expect(countRows(daemon.database, "sessions")).toBe(1);
    expect(countRows(daemon.database, "messages")).toBe(1);

    const second = await queueTranscriptImport(baseUrl, daemon, opencodeRoot);
    await waitFor(() => getImportJob(daemon.database, second.jobs[0].importJobId)?.status === "succeeded");

    expect(countRows(daemon.database, "sessions")).toBe(1);
    expect(countRows(daemon.database, "messages")).toBe(1);
  });

  test("resumes durable transcript work after daemon restart without duplicating the job", async () => {
    const { daemon, opencodeRoot, tempDir } = await createTestHarness();
    const transcriptPath = await writeOpenCodeDatabase(opencodeRoot, [
      {
        type: "session_meta",
        timestamp: "2026-06-25T12:00:00.000Z",
        payload: { session_id: "restart-session", cwd: "/tmp/restart", model: "gpt-5" }
      },
      {
        type: "response_item",
        timestamp: "2026-06-25T12:01:00.000Z",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Resume me" }] }
      }
    ]);
    const baseUrl = await listen(daemon);
    const sourceId = await approveTranscriptSource(baseUrl, daemon, opencodeRoot);
    const job = createImportJob(daemon.database, {
      importKind: "transcript",
      sourceId,
      updatedAt: "2026-06-25T12:02:00.000Z"
    });
    updateImportJob(daemon.database, job.importJobId, {
      scope: { includeChangedSinceCursor: true, mode: "transcript_full" },
      status: "running",
      updatedAt: "2026-06-25T12:03:00.000Z"
    });
    const manifest = await createManifestForJob(daemon.database, {
      generatedAt: "2026-06-25T12:03:00.000Z",
      importJobId: job.importJobId,
      importKind: "transcript",
      runtime: "opencode",
      scope: { includeChangedSinceCursor: true, mode: "transcript_full" },
      sourceId,
      sources: [{
        confidence: "authoritative",
        path: transcriptPath,
        runtime: "opencode",
        sourceId,
        sourceKind: "sqlite"
      }]
    });
    daemon.database.prepare("UPDATE import_work_units SET status = 'running' WHERE work_unit_id = ?").run(manifest.units[0].workUnitId);

    await closeTrackedDaemon(daemon);
    const restarted = await createTestHarness({ tempDir });
    await waitFor(() => getImportJob(restarted.daemon.database, job.importJobId)?.status === "succeeded");

    expect(listImportJobs(restarted.daemon.database)).toHaveLength(1);
    expect(countRows(restarted.daemon.database, "sessions")).toBe(1);
    expect(countRows(restarted.daemon.database, "messages")).toBe(1);
  });

  test("imports transcript token counts onto existing hook sessions", async () => {
    const { daemon, opencodeRoot } = await createTestHarness();
    await writeOpenCodeDatabase(opencodeRoot, [
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

    const imported = await queueTranscriptImport(baseUrl, daemon, opencodeRoot);

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
    const transcriptPath = await writeOpenCodeDatabase(opencodeRoot, [
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
    await getJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/transcript?limit=20`, 404);
    await yieldToEventLoop();
    expect(tokenTotals(daemon.database)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  });

  test("does not import hook transcriptPath on session open when hook transcript catch-up is disabled", async () => {
    const { daemon, opencodeRoot } = await createTestHarness({ hookTranscriptCatchupEnabled: false });
    const transcriptPath = await writeOpenCodeDatabase(opencodeRoot, [
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

    await getJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/transcript?limit=20`, 404);
    await yieldToEventLoop();
    expect(tokenTotals(daemon.database)).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    expect(countWhere(daemon.database, "model_usage", "session_id = ?", sessionId)).toBe(0);
  });

  test("keeps hook ingestion accepted when approved transcriptPath is missing", async () => {
    const { daemon, opencodeRoot } = await createTestHarness();
    const transcriptPath = join(opencodeRoot, "opencode.db");
    const baseUrl = await listen(daemon);

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
    const outsideTranscriptRoot = join(tempDir, "outside-opencode");
    const outsideTranscriptPath = await writeOpenCodeDatabase(outsideTranscriptRoot, [
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
    const transcriptPath = join(opencodeRoot, "opencode.db");
    await mkdir(opencodeRoot, { recursive: true });
    await symlink(outsideTranscriptPath, transcriptPath);
    const baseUrl = await listen(daemon);

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
    await writeOpenCodeDatabase(opencodeRoot, [
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

    const imported = await queueTranscriptImport(baseUrl, daemon, opencodeRoot);

    await waitFor(() => getImportJob(daemon.database, imported.jobs[0].importJobId)?.status === "succeeded");
    const sessionId = sessionIdFor(daemon.database, "useful-session");
    markWorkbenchPublished(daemon.database, {
      actor: { kind: "agent", id: "test" },
      publishedVia: "legacy_backfill",
      sessionId
    });
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

  test("uses semantic transcript activity for real preview and queued import admission", async () => {
    const { daemon, tempDir } = await createTestHarness();
    const hermesRoot = join(tempDir, ".hermes", "sessions");
    const now = new Date();
    const currentActivityAt = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString();
    const oldActivityAt = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000).toISOString();
    const recentMtime = new Date(now.getTime() - 60 * 1_000);
    const oldPath = join(hermesRoot, "session_20260401_120000_old.jsonl");
    const currentPath = join(hermesRoot, "session_20260714_120000_current.jsonl");
    await writeRawJsonl(oldPath, [
      { content: "This semantic transcript is old.", last_updated: oldActivityAt, role: "user", session_id: "old-semantic" }
    ]);
    await writeRawJsonl(currentPath, [
      { content: "This semantic transcript is current.", last_updated: currentActivityAt, role: "user", session_id: "current-semantic" }
    ]);
    await utimes(oldPath, recentMtime, recentMtime);
    await utimes(currentPath, recentMtime, recentMtime);
    const baseUrl = await listen(daemon);
    const sourceIds = await approveRuntimeTranscriptSources(baseUrl, daemon, "hermes", hermesRoot, 2);

    const previewResponse = await fetch(`${baseUrl}/sources/import/preview`, {
      body: JSON.stringify({
        importScope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
        runtimes: ["hermes"],
        sourceIds
      }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST"
    });
    expect(previewResponse.status).toBe(200);
    await expect(previewResponse.json()).resolves.toMatchObject({
      ok: true,
      previews: [{ runtime: "hermes", summary: { excludedUnits: 1, includedUnits: 1, totalUnits: 2 } }]
    });

    const sourceRows = daemon.database
      .prepare("SELECT source_id AS sourceId, source_path AS sourcePath FROM ingest_sources WHERE source_id IN (?, ?)")
      .all(...sourceIds) as Array<{ sourceId: string; sourcePath: string }>;
    const queuedJobs = await Promise.all(
      sourceRows.map(async (source) => {
        const response = await postJson(baseUrl, "/imports", { kind: "transcript", sourceId: source.sourceId });
        return response.job ?? response.jobs[0]!;
      })
    );
    expect(queuedJobs.every(Boolean)).toBe(true);
    await waitFor(() => queuedJobs.every((job) => ["failed", "succeeded", "succeeded_with_issues"].includes(getImportJob(daemon.database, job.importJobId)?.status ?? "")));

    expect(countWhere(daemon.database, "sessions", "source_session_id = ?", "current-semantic")).toBe(1);
    expect(countWhere(daemon.database, "sessions", "source_session_id = ?", "old-semantic")).toBe(0);
    const oldSourceId = sourceRows.find((source) => source.sourcePath === oldPath)?.sourceId;
    const oldJobId = queuedJobs.find((job) => job.sourceId === oldSourceId)?.importJobId;
    const currentSourceId = sourceRows.find((source) => source.sourcePath === currentPath)?.sourceId;
    const currentJobId = queuedJobs.find((job) => job.sourceId === currentSourceId)?.importJobId;
    expect(oldJobId).toBeDefined();
    expect(currentJobId).toBeDefined();
    expect(["succeeded", "succeeded_with_issues"]).toContain(getImportJob(daemon.database, oldJobId ?? "")?.status);
    expect(["succeeded", "succeeded_with_issues"]).toContain(getImportJob(daemon.database, currentJobId ?? "")?.status);
    expect(
      daemon.database
        .prepare(
          `SELECT scope_reason AS scopeReason, status, timestamp_basis AS timestampBasis
          FROM import_work_units
          WHERE import_job_id = ? AND source_path = ?`
        )
        .get(oldJobId ?? "", oldPath)
    ).toMatchObject({ scopeReason: "outside_recent_range", status: "skipped", timestampBasis: "semantic" });
  });

  test("imports one canonical Grok conversation while ignoring auxiliary files", async () => {
    const { daemon, tempDir } = await createTestHarness();
    const conversationId = "019f42f6-8ada-7001-afff-c722e75faf45";
    const grokRoot = join(tempDir, ".grok", "sessions");
    const conversationDir = join(grokRoot, conversationId);
    const chatPath = join(conversationDir, "chat_history.jsonl");
    const observedAt = new Date().toISOString();
    await writeRawJsonl(chatPath, [
      { content: "Canonical Grok question", timestamp: observedAt, type: "user" },
      { content: "Canonical Grok answer", timestamp: observedAt, type: "assistant" }
    ]);
    await writeRawJsonl(join(conversationDir, "updates.jsonl"), [{ status: "complete" }]);
    await writeRawJsonl(join(conversationDir, "feedback.jsonl"), [{ score: 1 }]);
    const baseUrl = await listen(daemon);
    const sourceIds = await approveRuntimeTranscriptSources(baseUrl, daemon, "grok", grokRoot, 1);

    const previewResponse = await fetch(`${baseUrl}/sources/import/preview`, {
      body: JSON.stringify({ runtimes: ["grok"], sourceIds }),
      headers: { accept: "application/json", "content-type": "application/json" },
      method: "POST"
    });
    expect(previewResponse.status).toBe(200);
    await expect(previewResponse.json()).resolves.toMatchObject({
      ok: true,
      previews: [{ runtime: "grok", summary: { excludedUnits: 0, includedUnits: 1, totalUnits: 1 } }]
    });

    const queued = await postJson(baseUrl, "/sources/setup/run", {
      importMetadata: false,
      importScope: { days: 30, includeChangedSinceCursor: true, mode: "transcript_recent", unitLimit: 500 },
      queueEnrichment: false,
      runtimes: ["grok"],
      sourceIds
    });
    expect(queued.jobs).toHaveLength(1);
    const job = queued.jobs[0]!;
    await waitFor(() => ["failed", "succeeded", "succeeded_with_issues"].includes(getImportJob(daemon.database, job.importJobId)?.status ?? ""));

    expect(getImportJob(daemon.database, job.importJobId)?.status).toBe("succeeded");
    expect(countWhere(daemon.database, "import_work_units", "import_job_id = ?", job.importJobId)).toBe(1);
    expect(countWhere(daemon.database, "sessions", "source_session_id = ?", conversationId)).toBe(1);
    expect(countWhere(daemon.database, "messages", "session_id = ?", sessionIdFor(daemon.database, conversationId))).toBe(2);
    const workUnit = daemon.database
      .prepare(
        `SELECT source_id AS sourceId, source_path AS sourcePath, work_unit_id AS workUnitId
        FROM import_work_units
        WHERE import_job_id = ?`
      )
      .get(job.importJobId) as { sourceId: string; sourcePath: string; workUnitId: string };
    const canonicalChatSource = daemon.database
      .prepare("SELECT source_id AS sourceId FROM ingest_sources WHERE adapter = 'grok' AND source_path = ?")
      .get(chatPath) as { sourceId: string };
    expect(workUnit).toMatchObject({ sourcePath: chatPath });
    expect(workUnit.sourceId).toBe(canonicalChatSource.sourceId);
    expect(
      JSON.parse(
        (daemon.database.prepare("SELECT source_ref_json AS sourceRef FROM messages WHERE session_id = ? LIMIT 1").get(
          sessionIdFor(daemon.database, conversationId)
        ) as { sourceRef: string }).sourceRef
      )
    ).toContainEqual(expect.objectContaining({ sourcePath: chatPath }));
    expect(readImportWorkUnitHealth(daemon.database, workUnit.workUnitId)?.diagnostics).toEqual([
      expect.objectContaining({ code: "grok_auxiliary_file_ignored", severity: "info" }),
      expect.objectContaining({ code: "grok_auxiliary_file_ignored", severity: "info" })
    ]);
  });
});

async function createTestHarness(
  options: { hookTranscriptCatchupEnabled?: boolean; tempDir?: string } = {}
): Promise<{ daemon: MastheadDaemon; tempDir: string; opencodeRoot: string }> {
  const tempDir = options.tempDir ?? (await mkdtemp(join(tmpdir(), "masthead-progressive-import-")));
  if (!options.tempDir) tempDirs.push(tempDir);
  const opencodeRoot = join(tempDir, ".local", "share", "opencode");
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

async function writeOpenCodeDatabase(root: string, rows: unknown[]): Promise<string> {
  await mkdir(root, { recursive: true });
  const path = join(root, "opencode.db");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_created INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`);
  let sessionId: string | undefined;
  let index = 0;
  const sessions = db.prepare("INSERT OR IGNORE INTO session (id, directory, title, time_created) VALUES (?, ?, ?, ?)");
  const messages = db.prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)");
  const parts = db.prepare("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)");
  const fixtureEpoch = Date.parse("2026-06-25T12:00:00.000Z");
  const recentEpoch = Date.now() - 24 * 60 * 60 * 1_000;
  for (const row of rows as Array<Record<string, any>>) {
    const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
    const fixtureAt = Date.parse(row.timestamp ?? "2026-06-25T12:00:00.000Z");
    const at = recentEpoch + (fixtureAt - fixtureEpoch);
    if (row.type === "session_meta" || row.session_id || row.sessionId) {
      const discoveredSessionId = payload.session_id ?? payload.sessionId ?? row.session_id ?? row.sessionId;
      if (typeof discoveredSessionId !== "string") continue;
      sessionId = discoveredSessionId;
      sessions.run(discoveredSessionId, payload.cwd ?? null, payload.title ?? row.title ?? row.project ?? null, at);
      if (row.type !== "session_meta") continue;
    }
    if (!sessionId) continue;
    const messageId = `message-${++index}`;
    if (row.type === "response_item" && payload.type === "message") {
      messages.run(messageId, sessionId, at, JSON.stringify({
        ...(payload.role === "assistant" ? { modelID: "gpt-5", providerID: "openai" } : {}),
        role: payload.role
      }));
      const text = (payload.content ?? []).map((item: Record<string, unknown>) => item.text).filter(Boolean).join("\n");
      parts.run(`part-${index}`, messageId, sessionId, at, JSON.stringify({ text, type: "text" }));
    } else if (row.type === "response_item" && payload.type === "function_call") {
      messages.run(messageId, sessionId, at, JSON.stringify({ role: "assistant" }));
      parts.run(`part-${index}`, messageId, sessionId, at, JSON.stringify({ callID: payload.call_id ?? `call-${index}`, state: { input: JSON.parse(payload.arguments ?? "{}"), status: "completed", time: { start: at, end: at }, output: "Tests passed." }, tool: payload.name, type: "tool" }));
    } else if (row.type === "event_msg" && payload.type === "token_count") {
      const usage = payload.info?.last_token_usage ?? {};
      messages.run(messageId, sessionId, at, JSON.stringify({ modelID: "gpt-5", providerID: "openai", role: "assistant", tokens: { input: usage.input_tokens, output: usage.output_tokens } }));
    }
  }
  db.close();
  return path;
}

async function writeJsonl(path: string, rows: unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const supportedRows = supportedTranscriptRows(rows);
  await writeFile(path, `${supportedRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

async function writeRawJsonl(path: string, rows: unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
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

async function postJson(baseUrl: string, path: string, body?: Record<string, unknown>): Promise<ImportActionResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(202);
  const responseBody = (await response.json()) as Record<string, unknown>;
  return { ...responseBody, jobs: Array.isArray(responseBody.jobs) ? (responseBody.jobs as ImportJobDto[]) : [] };
}

async function queueTranscriptImport(baseUrl: string, daemon: MastheadDaemon, opencodeRoot: string): Promise<ImportActionResponse> {
  const sourceId = await approveTranscriptSource(baseUrl, daemon, opencodeRoot);
  const response = await postJson(baseUrl, "/imports", { kind: "transcript", sourceId });
  return { ...response, jobs: response.job ? [response.job] : response.jobs };
}

async function approveTranscriptSource(baseUrl: string, daemon: MastheadDaemon, opencodeRoot: string): Promise<string> {
  const now = "2026-06-25T12:00:00.000Z";
  const scan = await fetch(`${baseUrl}/sources/scan`, { headers: { accept: "application/json" }, method: "POST" });
  expect(scan.status).toBe(202);
  const databasePath = join(opencodeRoot, "opencode.db");
  const row = daemon.database
    .prepare(
      `SELECT source_id AS sourceId
      FROM ingest_sources
      WHERE adapter = 'opencode'
        AND source_path = ?
      ORDER BY length(source_path) ASC, source_id ASC
      LIMIT 1`
    )
    .get(databasePath) as { sourceId: string } | undefined;
  expect(row).toBeDefined();
  const sourceId = row?.sourceId ?? "";
  setSourcePolicy(daemon.database, {
    decidedAt: now,
    enabled: true,
    policyKind: "transcript_import",
    reason: "Workbench transcript import requested for this source.",
    sourceId
  });
  return sourceId;
}

async function approveRuntimeTranscriptSources(
  baseUrl: string,
  daemon: MastheadDaemon,
  runtime: string,
  sourceRoot: string,
  expectedCount: number
): Promise<string[]> {
  const scan = await fetch(`${baseUrl}/sources/scan`, { headers: { accept: "application/json" }, method: "POST" });
  expect(scan.status).toBe(202);
  const rows = daemon.database
    .prepare(
      `SELECT source_id AS sourceId
      FROM ingest_sources
      WHERE adapter = ?
        AND source_path LIKE ?
      ORDER BY source_path ASC, source_id ASC`
    )
    .all(runtime, `${sourceRoot}%`) as Array<{ sourceId: string }>;
  expect(rows).toHaveLength(expectedCount);
  for (const { sourceId } of rows) {
    setSourcePolicy(daemon.database, {
      decidedAt: new Date().toISOString(),
      enabled: true,
      policyKind: "transcript_import",
      reason: "Production-path semantic admission regression.",
      sourceId
    });
  }
  return rows.map(({ sourceId }) => sourceId);
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

async function getJson(baseUrl: string, path: string, expectedStatus = 200): Promise<{ ok?: boolean; coverage?: Record<string, unknown>; items: Array<{ text: string }> }> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  expect(response.status).toBe(expectedStatus);
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
