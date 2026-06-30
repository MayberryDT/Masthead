import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { codexHookSource } from "../../adapters/codex/hookAdapter.ts";
import type { StoreRecord } from "../../core/store.ts";
import { createRawEventRepository } from "../db/rawEventRepository.ts";
import { migrateDatabase } from "../db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../db/sqlite.ts";
import { canonicalStoreRecords, LIVE_BOARD_RAW_RECORD_LIMIT } from "../server.ts";

describe("live Board raw records", () => {
  const tempDirs: string[] = [];
  const databases: MastheadDatabase[] = [];

  afterEach(async () => {
    for (const database of databases) database.close();
    databases.length = 0;
    await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
    tempDirs.length = 0;
  });

  test("loads the newest canonical raw records in chronological order for Now", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-live-board-records-"));
    tempDirs.push(tempDir);
    const database = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    databases.push(database);
    migrateDatabase(database);

    const rawEvents = createRawEventRepository(database, {
      adapter: codexHookSource.runtime,
      confidence: codexHookSource.confidence,
      endpoint: codexHookSource.endpoint,
      runtimeVersion: codexHookSource.runtimeVersion,
      schemaVersion: codexHookSource.schemaVersion,
      sourceId: codexHookSource.sourceId,
      sourceKind: codexHookSource.sourceKind
    });

    const totalRecords = LIVE_BOARD_RAW_RECORD_LIMIT + 5;
    for (let index = 0; index < totalRecords; index += 1) {
      rawEvents.appendStoreRecord(eventRecord(index));
    }

    const records = canonicalStoreRecords(database, [codexHookSource.sourceId]);

    expect(records).toHaveLength(LIVE_BOARD_RAW_RECORD_LIMIT);
    expect(records[0]?.recordId).toBe("event:5");
    expect(records.at(-1)?.recordId).toBe("event:504");
  });
});

function eventRecord(index: number): StoreRecord {
  const observedAt = new Date(Date.UTC(2026, 5, 29, 12, 0, index)).toISOString();
  return {
    observedAt,
    recordId: `event:${index}`,
    recordType: "event",
    value: {
      eventId: `event:${index}`,
      occurredAt: observedAt,
      payloadHash: `hash:${index}`,
      provider: "codex",
      providerEventId: `provider:${index}`,
      receivedAt: observedAt,
      schemaVersion: "masthead.normalized-event.v1",
      sessionId: `session:${index}`,
      type: "session.started"
    }
  } as unknown as StoreRecord;
}
