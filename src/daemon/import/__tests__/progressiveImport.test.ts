import { writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
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

describe("progressive Codex imports", () => {
  test("queues adapter metadata import jobs and persists imported progress", async () => {
    const { daemon, codexRoot } = await createTestHarness();
    await writeJsonl(join(codexRoot, "session_index.jsonl"), [
      {
        session_id: "metadata-session",
        timestamp: "2026-06-25T12:00:00.000Z",
        project: "Masthead",
        title: "Metadata import smoke"
      }
    ]);
    const baseUrl = await listen(daemon);

    const queued = await postJson(baseUrl, "/adapters/codex/import-metadata");

    expect(queued).toMatchObject({ ok: true, queued: 1, sources: 1 });
    const job = queued.jobs[0];
    expect(job).toMatchObject({ importKind: "metadata", sourceId: "codex-session-index", status: "queued" });

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
    const { daemon, codexRoot } = await createTestHarness();
    await writeJsonl(join(codexRoot, "sessions", "2026", "06", "25", "session.jsonl"), [
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

    await postJson(baseUrl, "/adapters/codex/approve-transcripts");
    const first = await postJson(baseUrl, "/adapters/codex/import-transcripts");

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

    const second = await postJson(baseUrl, "/adapters/codex/import-transcripts");
    await waitFor(() => getImportJob(daemon.database, second.jobs[0].importJobId)?.status === "succeeded");

    expect(countRows(daemon.database, "sessions")).toBe(1);
    expect(countRows(daemon.database, "messages")).toBe(1);
  });

  test("cancels import jobs through the backend status endpoint", async () => {
    const { daemon } = await createTestHarness();
    seedSource(daemon, "codex-session-index");
    const job = createImportJob(daemon.database, {
      importKind: "metadata",
      sourceId: "codex-session-index",
      updatedAt: "2026-06-25T12:00:00.000Z"
    });
    const baseUrl = await listen(daemon);

    const cancelled = await postJson(baseUrl, `/imports/${job.importJobId}/cancel`);

    expect(cancelled.job).toMatchObject({ importJobId: job.importJobId, status: "cancelling" });
    expect(getImportJob(daemon.database, job.importJobId)?.status).toBe("cancelling");
  });
});

async function createTestHarness(): Promise<{ daemon: MastheadDaemon; tempDir: string; codexRoot: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-progressive-import-"));
  tempDirs.push(tempDir);
  const codexRoot = join(tempDir, ".codex");
  await mkdir(codexRoot, { recursive: true });
  const config: DaemonConfig = {
    allowedOrigins: ["http://127.0.0.1:5173"],
    codexHomeDir: tempDir,
    databasePath: join(tempDir, "masthead.sqlite"),
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    llmCopyEnabled: false,
    port: 0,
    storePath: join(tempDir, "events.ndjson")
  };
  const daemon = await createMastheadDaemon(config);
  daemons.push(daemon);
  return { codexRoot, daemon, tempDir };
}

async function writeJsonl(path: string, rows: unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
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

function seedSource(daemon: MastheadDaemon, sourceId: string): void {
  daemon.database
    .prepare(
      `INSERT INTO ingest_sources (
        source_id, adapter, source_kind, source_path, confidence, discovered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(sourceId, "codex", "jsonl", "/tmp/.codex/session_index.jsonl", "authoritative", "2026-06-25T12:00:00.000Z", "2026-06-25T12:00:00.000Z");
}
