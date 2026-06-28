import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  legacyDataMigrationCompleted,
  markLegacyDataMigrationCompleted,
  maybeCopyLegacySqliteBeforeOpen
} from "../legacyDataMigration.ts";
import { migrateDatabase } from "../db/schema.ts";
import { openMastheadDatabase } from "../db/sqlite.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";
import type { DaemonConfig } from "../config.ts";
import type { StoreRecord } from "../../core/store.ts";

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];


afterEach(async () => {
  await Promise.all(daemons.splice(0).map((daemon) => daemon.close().catch(() => undefined)));
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("legacy data migration", () => {
  test("copies old checkout sqlite only when target database does not exist", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-legacy-"));
    tempDirs.push(tempDir);
    const legacyDatabasePath = join(tempDir, "legacy", "masthead.sqlite");
    const targetDatabasePath = join(tempDir, "stable", "masthead.sqlite");
    await mkdir(join(tempDir, "legacy"), { recursive: true });
    await writeFile(legacyDatabasePath, "legacy sqlite", "utf8");

    const result = await maybeCopyLegacySqliteBeforeOpen({ legacyDatabasePath, targetDatabasePath });

    expect(result).toMatchObject({ copied: true, reason: "copied", legacyPath: legacyDatabasePath });
    await expect(readFile(targetDatabasePath, "utf8")).resolves.toBe("legacy sqlite");
  });

  test("does not overwrite an existing target database", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-legacy-"));
    tempDirs.push(tempDir);
    const legacyDatabasePath = join(tempDir, "legacy.sqlite");
    const targetDatabasePath = join(tempDir, "target.sqlite");
    await writeFile(legacyDatabasePath, "legacy", "utf8");
    await writeFile(targetDatabasePath, "target", "utf8");

    const result = await maybeCopyLegacySqliteBeforeOpen({ legacyDatabasePath, targetDatabasePath });

    expect(result).toMatchObject({ copied: false, reason: "target_exists", legacyPath: legacyDatabasePath });
    await expect(readFile(targetDatabasePath, "utf8")).resolves.toBe("target");
  });

  test("records legacy migration marker once", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-legacy-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);

    markLegacyDataMigrationCompleted(db, "legacy-events-ndjson-v1", { importedRecords: 3 });
    markLegacyDataMigrationCompleted(db, "legacy-events-ndjson-v1", { importedRecords: 9 });

    expect(legacyDataMigrationCompleted(db, "legacy-events-ndjson-v1")).toBe(true);
    const rows = db.prepare("SELECT migration_key, details_json FROM legacy_migrations").all() as Array<{
      migration_key: string;
      details_json: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].details_json)).toEqual({ importedRecords: 3 });
    db.close();
  });

  test("marks empty legacy migration so startup does not repeat it", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-legacy-"));
    tempDirs.push(tempDir);
    const daemon = await createMastheadDaemon({
      allowedOrigins: ["http://127.0.0.1:5173"],
      codexHomeDir: tempDir,
      databasePath: join(tempDir, "stable", "masthead.sqlite"),
      fixturePath: join(tempDir, "fixture.json"),
      gitRefreshMs: 0,
      host: "127.0.0.1",
      llmCopyEnabled: false,
      port: 0,
      storePath: join(tempDir, "legacy", "events.ndjson")
    } satisfies DaemonConfig);
    daemons.push(daemon);

    daemon.startBackgroundHydration();
    await daemon.waitForBackgroundHydration();
    expect(
      Boolean(
        daemon.database
          .prepare("SELECT 1 FROM legacy_migrations WHERE migration_key = ?")
          .get("legacy-events-ndjson-v1")
      )
    ).toBe(true);

    const marker = daemon.database
      .prepare("SELECT details_json FROM legacy_migrations WHERE migration_key = ?")
      .get("legacy-events-ndjson-v1") as { details_json: string };
    expect(JSON.parse(marker.details_json)).toMatchObject({
      importedRecords: 0,
      migrationKey: "legacy-events-ndjson-v1",
      reason: "empty",
      totalRecords: 0
    });
  });

  test("hydrates only missing records from distinct legacy ndjson and marks migration", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-legacy-"));
    tempDirs.push(tempDir);
    const currentStorePath = join(tempDir, "current", "events.ndjson");
    const legacyDataDirectory = join(tempDir, "legacy");
    const legacyStorePath = join(legacyDataDirectory, "events.ndjson");
    const databasePath = join(tempDir, "stable", "masthead.sqlite");
    await mkdir(join(tempDir, "current"), { recursive: true });
    await mkdir(legacyDataDirectory, { recursive: true });
    await writeStoreRecords(currentStorePath, [eventRecord("shared")]);
    await writeStoreRecords(legacyStorePath, [eventRecord("shared"), eventRecord("legacy")]);
    const daemon = await createMastheadDaemon({
      allowedOrigins: ["http://127.0.0.1:5173"],
      codexHomeDir: tempDir,
      databasePath,
      fixturePath: join(tempDir, "fixture.json"),
      gitRefreshMs: 0,
      host: "127.0.0.1",
      legacyDataDirectory,
      llmCopyEnabled: false,
      port: 0,
      storePath: currentStorePath
    } satisfies DaemonConfig);
    daemons.push(daemon);

    daemon.startBackgroundHydration();
    await daemon.waitForBackgroundHydration();
    expect(countRows(daemon.database, "raw_events")).toBe(2);
    expect(
      Boolean(
        daemon.database
          .prepare("SELECT 1 FROM legacy_migrations WHERE migration_key = ?")
          .get("legacy-events-ndjson-v1")
      )
    ).toBe(true);

    const marker = daemon.database
      .prepare("SELECT details_json FROM legacy_migrations WHERE migration_key = ?")
      .get("legacy-events-ndjson-v1") as { details_json: string };
    expect(JSON.parse(marker.details_json)).toMatchObject({
      importedRecords: 2,
      migrationKey: "legacy-events-ndjson-v1",
      reason: "completed",
      skippedRecords: 1,
      source: legacyStorePath,
      targetDatabaseId: expect.any(String),
      totalRecords: 2
    });
  });
});

async function writeStoreRecords(path: string, records: StoreRecord[]): Promise<void> {
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function eventRecord(id: string): StoreRecord {
  const observedAt = "2026-06-25T12:00:00.000Z";
  return {
    observedAt,
    recordId: `event:${id}`,
    recordType: "event",
    value: {
      schemaVersion: 1,
      eventId: id,
      sessionId: `session:${id}`,
      source: {
        adapter: "codex",
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

function countRows(db: { prepare: (sql: string) => { get: () => unknown } }, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}
