import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runCaptureQualityPrecheck } from "../../../workbench/qualityPrecheck.ts";
import type { DaemonConfig } from "../../config.ts";
import { markLegacyDataMigrationCompleted } from "../../legacyDataMigration.ts";
import { createMastheadDaemon } from "../../server.ts";
import { WORKBENCH_PUBLICATION_BACKFILL_KEY } from "../../../workbench/legacyPublicationBackfill.ts";
import { initializeSessionTranscriptFingerprintIndex } from "../sessionTranscriptFingerprintIndex.ts";
import { migrateDatabase } from "../schema.ts";
import { migrateTestDatabaseThrough } from "./schemaTestHelpers.ts";
import { seedSession } from "./sessionTestHelpers.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("session transcript fingerprint index initialization", () => {
  test("backfills a cold upgraded database deterministically in batches before the first quality request", async () => {
    const db = await testDbThroughMigration27();
    const sessionIds = Array.from({ length: 45 }, (_, index) => `session:cold:${String(index).padStart(3, "0")}`);
    for (const sessionId of sessionIds.toReversed()) {
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: sessionId });
    }
    migrateDatabase(db);
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_transcript_fingerprints").get()).toEqual({ count: 0 });

    expect(initializeSessionTranscriptFingerprintIndex(db, { batchSize: 16, updatedAt: "2026-07-15T12:00:00.000Z" })).toEqual({
      batches: 3,
      fingerprintsPopulated: 45
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_transcript_fingerprints").get()).toEqual({ count: 45 });
    expect(initializeSessionTranscriptFingerprintIndex(db, { batchSize: 16, updatedAt: "2026-07-15T12:00:01.000Z" })).toEqual({
      batches: 0,
      fingerprintsPopulated: 0
    });

    let queryCount = 0;
    const countedDb = new Proxy(db, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            queryCount += 1;
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
    }) as MastheadDatabase;
    expect(runCaptureQualityPrecheck(countedDb, sessionIds.at(-1)!)).toMatchObject({ reason: "exact_duplicate" });
    expect(queryCount).toBeLessThanOrEqual(20);
    db.close();
  });

  test("daemon startup completes the upgraded index before exposing its server", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-fingerprint-daemon-test-"));
    tempDirs.push(dir);
    const databasePath = join(dir, "masthead.sqlite");
    const db = await openMastheadDatabase(databasePath);
    migrateTestDatabaseThrough(db, 27);
    for (let index = 0; index < 12; index += 1) {
      const sessionId = `session:daemon:${String(index).padStart(2, "0")}`;
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: sessionId });
    }
    markLegacyDataMigrationCompleted(db, WORKBENCH_PUBLICATION_BACKFILL_KEY, { test: true });
    db.close();

    const daemon = await createMastheadDaemon({
      allowedOrigins: ["http://127.0.0.1:5173"],
      backgroundHydrationEnabled: false,
      codexHomeDir: dir,
      databasePath,
      fixturePath: join(dir, "fixture.json"),
      gitRefreshMs: 0,
      hookTranscriptCatchupEnabled: false,
      host: "127.0.0.1",
      llmCopyEnabled: false,
      port: 0,
      storePath: join(dir, "events.ndjson")
    } satisfies DaemonConfig);
    expect(daemon.database.prepare("SELECT COUNT(*) AS count FROM session_transcript_fingerprints").get()).toEqual({ count: 12 });
    await daemon.close();
  });
});

async function testDbThroughMigration27(): Promise<MastheadDatabase> {
  const dir = await mkdtemp(join(tmpdir(), "masthead-fingerprint-index-test-"));
  tempDirs.push(dir);
  const db = await openMastheadDatabase(join(dir, "masthead.sqlite"));
  migrateTestDatabaseThrough(db, 27);
  return db;
}
