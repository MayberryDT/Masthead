import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { StoreRecord } from "../../../core/store.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";
import { createRawEventRepository } from "../rawEventRepository.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("raw event repository", () => {
  test("stores StoreRecord journal entries idempotently with source provenance", async () => {
    const db = await openMigratedDatabase();
    const repository = createRawEventRepository(db, {
      adapter: "masthead",
      confidence: "authoritative",
      sourceId: "source:test-live-journal",
      sourceKind: "jsonl",
      sourcePath: "/tmp/events.ndjson"
    });
    const record = eventRecord("event-1", "2026-06-24T15:00:00.000Z");

    repository.appendStoreRecord(record);
    repository.appendStoreRecord(record);

    expect(repository.pageStoreRecords({ limit: 10 })).toMatchObject({
      records: [record],
      nextCursor: undefined
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM raw_events").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT source_path FROM ingest_sources WHERE source_id = ?").get("source:test-live-journal")).toEqual({
      source_path: "/tmp/events.ndjson"
    });
    db.close();
  });

  test("pages, prunes, and clears raw StoreRecord journal entries", async () => {
    const db = await openMigratedDatabase();
    const repository = createRawEventRepository(db, {
      adapter: "masthead",
      confidence: "authoritative",
      sourceId: "source:test-live-journal",
      sourceKind: "jsonl"
    });

    repository.appendStoreRecord(eventRecord("old", "2026-06-01T00:00:00.000Z"));
    repository.appendStoreRecord(eventRecord("new", "2026-06-24T15:00:00.000Z"));

    const firstPage = repository.pageStoreRecords({ limit: 1 });
    expect(firstPage.records.map((record) => record.recordId)).toEqual(["event:old"]);
    expect(firstPage.nextCursor).toBeDefined();
    expect(repository.pageStoreRecords({ cursor: firstPage.nextCursor, limit: 10 }).records.map((record) => record.recordId)).toEqual([
      "event:new"
    ]);

    const pruned = repository.pruneStoreRecords({
      cutoffAt: "2026-06-10T00:00:00.000Z",
      recordTypes: ["event"]
    });
    expect(pruned).toMatchObject({
      removedRecords: 1,
      removedRecordIds: ["event:old"],
      retainedRecords: 1
    });
    expect(repository.pageStoreRecords({ limit: 10 }).records.map((record) => record.recordId)).toEqual(["event:new"]);

    expect(repository.clearStoreRecords()).toEqual({ removedRecords: 1, touchedExternalState: false });
    expect(repository.pageStoreRecords({ limit: 10 }).records).toEqual([]);
    db.close();
  });
});

async function openMigratedDatabase() {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-raw-events-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function eventRecord(id: string, observedAt: string): StoreRecord {
  return {
    observedAt,
    recordId: `event:${id}`,
    recordType: "event",
    value: {
      schemaVersion: 1,
      eventId: id,
      sessionId: "session-1",
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
