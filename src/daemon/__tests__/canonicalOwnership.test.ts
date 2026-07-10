import { access, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { StoreRecord } from "../../core/store.ts";
import type { DaemonConfig } from "../config.ts";
import { createRawEventRepository } from "../db/rawEventRepository.ts";
import { migrateDatabase } from "../db/schema.ts";
import { openMastheadDatabase } from "../db/sqlite.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";
import type { MastheadDatabase } from "../db/sqlite.ts";

const CLAUDE_CODE_HOOK_SOURCE = {
  adapter: "claude_code",
  confidence: "authoritative",
  endpoint: "http://127.0.0.1:17373/ingest",
  runtimeVersion: "hook-v1",
  schemaVersion: "masthead.normalized-event.v1",
  sourceId: "claude-code-hook-local",
  sourceKind: "hook"
} as const;
const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.splice(0).map((daemon) => daemon.close().catch(() => undefined)));
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("canonical store ownership", () => {
  test("rejects a second writable daemon for the same canonical database across data directories", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-canonical-writer-lock-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "database", "masthead.sqlite");
    const secondDataDirectory = join(tempDir, "second-data");
    const databaseDirectory = join(tempDir, "database");
    await mkdir(databaseDirectory, { recursive: true });

    const firstDaemon = await createTestDaemon(
      databaseDirectory,
      databasePath,
      join(databaseDirectory, "legacy", "events.ndjson")
    );
    daemons.push(firstDaemon);
    const aliasedDatabasePath = process.platform === "win32"
      ? join(tempDir, "database", "..", "database", "masthead.sqlite")
      : join(tempDir, "database-alias", "masthead.sqlite");
    if (process.platform !== "win32") await symlink(databaseDirectory, join(tempDir, "database-alias"), "dir");

    await expect(
      createTestDaemon(
        secondDataDirectory,
        aliasedDatabasePath,
        join(secondDataDirectory, "legacy", "events.ndjson"),
        secondDataDirectory
      )
    ).rejects.toThrow("must stay inside the canonical data directory");
  });

  test("rejects cross-directory database overrides before publishing ownership state", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-cross-directory-override-"));
    tempDirs.push(tempDir);
    const dataDirectory = join(tempDir, "data");
    const databasePath = join(tempDir, "elsewhere", "masthead.sqlite");

    await expect(
      createTestDaemon(tempDir, databasePath, join(dataDirectory, "events.ndjson"), dataDirectory)
    ).rejects.toThrow("Move the database into that data directory");
    await expect(access(`${databasePath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(dataDirectory, "runtime", "database.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("allows writable daemons for different databases in the same data directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-distinct-writer-locks-"));
    tempDirs.push(tempDir);
    const firstDaemon = await createTestDaemon(tempDir, join(tempDir, "first.sqlite"), join(tempDir, "first.ndjson"));
    const secondDaemon = await createTestDaemon(tempDir, join(tempDir, "second.sqlite"), join(tempDir, "second.ndjson"));
    daemons.push(firstDaemon, secondDaemon);

    expect(firstDaemon.database).toBeDefined();
    expect(secondDaemon.database).toBeDefined();
  });

  test("blocks an old data-directory writer before starting a canonical-path writer", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-legacy-writer-first-"));
    tempDirs.push(tempDir);
    const runtimeDirectory = join(tempDir, "runtime");
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(join(runtimeDirectory, "database.lock"), JSON.stringify({
      createdAt: new Date().toISOString(),
      pid: process.pid
    }), "utf8");

    await expect(
      createTestDaemon(tempDir, join(tempDir, "masthead.sqlite"), join(tempDir, "events.ndjson"))
    ).rejects.toThrow("legacy data-directory writer");
  });

  test("publishes an old-format guard while a canonical-path writer is active", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-canonical-writer-first-"));
    tempDirs.push(tempDir);
    const daemon = await createTestDaemon(tempDir, join(tempDir, "masthead.sqlite"), join(tempDir, "events.ndjson"));
    daemons.push(daemon);

    await expect(open(join(tempDir, "runtime", "database.lock"), "wx")).rejects.toMatchObject({ code: "EEXIST" });
  });

  test("keeps an old-readable live guardian while any shared-data-directory owner remains", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-shared-legacy-guardian-"));
    tempDirs.push(tempDir);
    const first = await createTestDaemon(tempDir, join(tempDir, "first.sqlite"), join(tempDir, "first.ndjson"));
    const second = await createTestDaemon(tempDir, join(tempDir, "second.sqlite"), join(tempDir, "second.ndjson"));
    daemons.push(first, second);
    const sentinelPath = join(tempDir, "runtime", "database.lock");
    const firstSentinel = JSON.parse(await readFile(sentinelPath, "utf8")) as { guardian: boolean; pid: number };
    expect(firstSentinel.guardian).toBe(true);
    expect(firstSentinel.pid).not.toBe(process.pid);

    process.kill(firstSentinel.pid, "SIGKILL");
    await waitForPidToStop(firstSentinel.pid);
    const replacement = await waitForReplacementGuardian(sentinelPath, firstSentinel.pid);
    expect(replacement.guardian).toBe(true);
    expect(replacement.pid).not.toBe(firstSentinel.pid);
    expect(processIsAlive(replacement.pid)).toBe(true);

    await first.close();
    await expect(open(sentinelPath, "wx")).rejects.toMatchObject({ code: "EEXIST" });
    await second.close();
    await waitForPidToStop(replacement.pid);
    await expect(access(sentinelPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("accepted live ingest writes canonical rows without appending new NDJSON product records", async () => {
    const { daemon, storePath } = await createTestHarness("masthead-canonical-live-");
    const baseUrl = await listen(daemon);

    const result = await postJson(baseUrl, "/ingest?runtime=claude_code", liveApprovalPayload("canonical-live"));

    expect(result).toMatchObject({ ok: true, status: "accepted" });
    expect(countRows(daemon.database, "sessions")).toBe(1);
    expect(countRows(daemon.database, "raw_events")).toBe(1);
    await expect(access(storePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("old ndjson migrates once into sqlite canonical ownership", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-canonical-legacy-"));
    tempDirs.push(tempDir);
    const storePath = join(tempDir, "legacy", "events.ndjson");
    const databasePath = join(tempDir, "stable", "masthead.sqlite");
    await mkdir(join(tempDir, "stable"), { recursive: true });
    await mkdir(join(tempDir, "legacy"), { recursive: true });
    await writeStoreRecords(storePath, [eventRecord("legacy-once")]);

    const firstDaemon = await createTestDaemon(tempDir, databasePath, storePath);
    firstDaemon.startBackgroundHydration();
    await firstDaemon.waitForBackgroundHydration();
    expect(countRows(firstDaemon.database, "raw_events")).toBe(1);
    expect(countRows(firstDaemon.database, "sessions")).toBe(1);
    expect(migrationMarkerCount(firstDaemon.database)).toBe(1);
    const firstMarker = migrationMarkerDetails(firstDaemon.database);
    expect(firstMarker).toMatchObject({ importedRecords: 1, source: storePath, totalRecords: 1 });
    await firstDaemon.close();

    const secondDaemon = await createTestDaemon(tempDir, databasePath, storePath);
    daemons.push(secondDaemon);
    secondDaemon.startBackgroundHydration();
    await secondDaemon.waitForBackgroundHydration();
    expect(countRows(secondDaemon.database, "raw_events")).toBe(1);
    expect(migrationMarkerCount(secondDaemon.database)).toBe(1);
    expect(migrationMarkerDetails(secondDaemon.database)).toEqual(firstMarker);
  });

  test("startup replays only the bounded recent live window from canonical raw events", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-canonical-replay-window-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "masthead.sqlite");
    const storePath = join(tempDir, "events.ndjson");
    await seedCanonicalRawEvents(databasePath, 1_005);

    const daemon = await createTestDaemon(tempDir, databasePath, storePath);
    daemons.push(daemon);
    const baseUrl = await listen(daemon);
    const events = await getJson(baseUrl, "/events");

    expect((events.events as unknown[]).length).toBe(1_000);
    expect(JSON.stringify(events.events)).not.toContain("session:seed-0");
    expect(JSON.stringify(events.events)).toContain("session:seed-1004");
  });
});

async function createTestHarness(prefix: string): Promise<{ daemon: MastheadDaemon; databasePath: string; storePath: string; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(tempDir);
  const databasePath = join(tempDir, "masthead.sqlite");
  const storePath = join(tempDir, "events.ndjson");
  const daemon = await createTestDaemon(tempDir, databasePath, storePath);
  daemons.push(daemon);
  return { daemon, databasePath, storePath, tempDir };
}

async function createTestDaemon(
  tempDir: string,
  databasePath: string,
  storePath: string,
  dataDirectory = dirname(databasePath)
): Promise<MastheadDaemon> {
  return createMastheadDaemon({
    allowedOrigins: ["http://127.0.0.1:5173"],
    codexHomeDir: tempDir,
    dataDirectory,
    databasePath,
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    hookTranscriptCatchupEnabled: false,
    llmCopyEnabled: false,
    port: 0,
    storePath
  } satisfies DaemonConfig);
}

async function listen(daemon: MastheadDaemon): Promise<string> {
  daemon.server.listen(0, "127.0.0.1");
  await once(daemon.server, "listening");
  const address = daemon.server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST"
  });
  expect(response.status).toBe(202);
  return response.json() as Promise<Record<string, unknown>>;
}

async function getJson(baseUrl: string, path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

async function seedCanonicalRawEvents(databasePath: string, count: number): Promise<void> {
  const db = await openMastheadDatabase(databasePath);
  try {
    migrateDatabase(db);
    const repository = createRawEventRepository(db, CLAUDE_CODE_HOOK_SOURCE);
    db.exec("BEGIN IMMEDIATE;");
    try {
      for (let index = 0; index < count; index += 1) {
        repository.appendStoreRecord(eventRecord(`seed-${index}`, new Date(Date.parse("2026-06-25T12:00:00.000Z") + index * 1_000).toISOString()));
      }
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  } finally {
    db.close();
  }
}

async function writeStoreRecords(path: string, records: StoreRecord[]): Promise<void> {
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function liveApprovalPayload(providerEventId: string): Record<string, unknown> {
  return {
    provider_event_id: providerEventId,
    event: "approval_requested",
    session_id: "canonical-live-session",
    timestamp: "2026-06-25T12:00:00.000Z",
    cwd: "/workspace/masthead",
    repo_root: "/workspace/masthead",
    git_common_dir: "/workspace/masthead/.git",
    branch: "agent/canonical-live-session",
    project: "Masthead",
    title: "Canonical live projection",
    command_id: "cmd-canonical-live",
    blast_radius: "production",
    summary: "Canonical live approval"
  };
}

function eventRecord(id: string, observedAt = "2026-06-25T12:00:00.000Z"): StoreRecord {
  return {
    observedAt,
    recordId: `event:${id}`,
    recordType: "event",
    value: {
      schemaVersion: 1,
      eventId: id,
      sessionId: `session:${id}`,
      source: {
        adapter: "claude_code",
        surface: "hook",
        sourceEventId: id
      },
      occurredAt: observedAt,
      receivedAt: observedAt,
      type: "session.started",
      summary: `Event ${id}`,
      payload: {},
      sensitivity: "metadata",
      payloadHash: id,
      evidence: []
    }
  };
}

type CountRow = {
  count: number;
};

function countRows(db: MastheadDatabase, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as CountRow;
  return row.count;
}

function migrationMarkerCount(db: MastheadDatabase): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM legacy_migrations WHERE migration_key = ?").get("legacy-events-ndjson-v1") as CountRow;
  return row.count;
}

type MigrationMarkerRow = {
  details_json: string;
};

function migrationMarkerDetails(db: MastheadDatabase): Record<string, unknown> {
  const row = db.prepare("SELECT details_json FROM legacy_migrations WHERE migration_key = ?").get("legacy-events-ndjson-v1") as MigrationMarkerRow;
  return JSON.parse(row.details_json) as Record<string, unknown>;
}

async function waitForPidToStop(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!processIsAlive(pid)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`PID ${pid} did not stop.`);
}

async function waitForReplacementGuardian(
  sentinelPath: string,
  previousPid: number
): Promise<{ guardian: boolean; pid: number }> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const sentinel = await readFile(sentinelPath, "utf8")
      .then((value) => JSON.parse(value) as { guardian: boolean; pid: number })
      .catch(() => undefined);
    if (sentinel?.guardian && sentinel.pid !== previousPid && processIsAlive(sentinel.pid)) return sentinel;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`Guardian PID ${previousPid} was not replaced.`);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
