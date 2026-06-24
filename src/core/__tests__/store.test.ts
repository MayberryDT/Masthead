import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import fixture from "../../../fixtures/v0/replay-three-sessions-board.json";
import { projectFixture } from "../replay";
import {
  createFileBackedStore,
  createInMemoryStore,
  type ReviewDisposition,
  type StoreRecord
} from "../store";
import type { FixtureReplay } from "../types";

const replay = fixture as FixtureReplay;

describe("append-only Masthead store", () => {
  test("persists replay inputs and reloads projected alerts after restart", async () => {
    const board = projectFixture(replay);
    const dir = await mkdtemp(join(tmpdir(), "masthead-store-"));
    const storePath = join(dir, "masthead.ndjson");
    const store = await createFileBackedStore(storePath);

    await store.appendMany([
      ...replay.events.map((value) => record("event", value.eventId, value)),
      ...replay.gitSnapshots.map((value) => record("git_snapshot", value.snapshotId, value)),
      ...board.attentionQueue.map((value) => record("attention_item", value.itemId, value)),
      ...board.conflicts.map((value) => record("conflict_card", value.conflictId, value))
    ]);

    const restarted = await createFileBackedStore(storePath);
    expect(restarted.readEvents()).toEqual(replay.events);
    expect(restarted.readGitSnapshots()).toEqual(replay.gitSnapshots);
    expect(restarted.readAttentionItems().map((item) => item.itemId)).toEqual(
      board.attentionQueue.map((item) => item.itemId)
    );
    expect(restarted.readConflicts()).toEqual(board.conflicts);

    const rawLines = (await readFile(storePath, "utf8")).trim().split("\n");
    expect(rawLines).toHaveLength(replay.events.length + replay.gitSnapshots.length + board.attentionQueue.length + 1);
  });

  test("preserves unresolved alerts and review dispositions in snapshots", async () => {
    const board = projectFixture(replay);
    const store = createInMemoryStore();
    const disposition: ReviewDisposition = {
      dispositionId: "review:attention:1",
      subjectId: board.attentionQueue[0]!.itemId,
      subjectType: "attention_item",
      status: "reviewed",
      recordedAt: "2026-06-23T03:00:00.000Z",
      reviewer: "tyler"
    };

    await store.appendMany([
      ...board.attentionQueue.map((value) => record("attention_item", value.itemId, value)),
      record("review_disposition", disposition.dispositionId, disposition)
    ]);

    const snapshot = store.snapshot();
    expect(snapshot.unresolvedAttentionItems.map((item) => item.itemId)).toEqual(
      board.attentionQueue.filter((item) => !item.resolvedAt && !item.dismissedAt).map((item) => item.itemId)
    );
    expect(snapshot.reviewDispositions).toEqual([disposition]);
  });

  test("exports and clears Masthead-local data without touching source subjects", async () => {
    const board = projectFixture(replay);
    const store = createInMemoryStore();

    await store.appendMany([
      ...replay.events.map((value) => record("event", value.eventId, value)),
      ...board.attentionQueue.map((value) => record("attention_item", value.itemId, value))
    ]);

    const exported = store.exportRecords();
    const clearResult = await store.clearLocalData();

    expect(exported.records).toHaveLength(replay.events.length + board.attentionQueue.length);
    expect(clearResult.removedRecords).toBe(replay.events.length + board.attentionQueue.length);
    expect(clearResult.touchedExternalState).toBe(false);
    expect(store.readAll()).toEqual([]);
  });

  test("prunes expired file-backed records while preserving pinned and unresolved attention", async () => {
    const board = projectFixture(replay);
    const dir = await mkdtemp(join(tmpdir(), "masthead-retention-"));
    const storePath = join(dir, "masthead.ndjson");
    const store = await createFileBackedStore(storePath);
    const oldEvent = record("event", "old", replay.events[0]!, "2026-05-01T00:00:00.000Z");
    const pinnedEvent = record("event", "pinned", replay.events[1]!, "2026-05-02T00:00:00.000Z");
    const oldAttention = record(
      "attention_item",
      "active",
      board.attentionQueue[0]!,
      "2026-05-03T00:00:00.000Z"
    );
    const recentSnapshot = record(
      "git_snapshot",
      "recent",
      replay.gitSnapshots[0]!,
      "2026-06-20T00:00:00.000Z"
    );

    await store.appendMany([oldEvent, pinnedEvent, oldAttention, recentSnapshot]);

    const result = await store.pruneLocalData({
      cutoffAt: "2026-06-01T00:00:00.000Z",
      recordTypes: ["event", "attention_item", "git_snapshot"],
      pinnedRecordIds: [pinnedEvent.recordId],
      keepUnresolvedAttention: true
    });

    expect(result).toMatchObject({
      removedRecords: 1,
      removedRecordIds: [oldEvent.recordId],
      retainedRecords: 3,
      touchedExternalState: false
    });
    expect(result.removedByType.event).toBe(1);
    expect(store.readAll()).toEqual([pinnedEvent, oldAttention, recentSnapshot]);

    const restarted = await createFileBackedStore(storePath);
    expect(restarted.readAll()).toEqual([pinnedEvent, oldAttention, recentSnapshot]);
    expect((await readFile(storePath, "utf8")).trim().split("\n")).toHaveLength(3);
  });
});

describe("JSON contract schemas", () => {
  test.each([
    ["schemas/masthead-event.schema.json", "NormalizedEvent"],
    ["schemas/git-snapshot.schema.json", "GitSnapshot"],
    ["schemas/attention-item.schema.json", "AttentionItem"],
    ["schemas/conflict-card.schema.json", "ConflictCard"],
    ["schemas/ui-projection.schema.json", "LiveBoardProjection"]
  ])("%s names the current TypeScript contract", async (schemaPath, title) => {
    const schema = JSON.parse(await readFile(schemaPath, "utf8")) as {
      $schema?: string;
      title?: string;
      type?: string;
      required?: string[];
    };

    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.title).toBe(title);
    expect(schema.type).toBe("object");
    expect(schema.required?.some((field) => typeof field === "string")).toBe(true);
  });

  test("ui projection schema keeps modal detail extensions valid", async () => {
    const schema = JSON.parse(await readFile("schemas/ui-projection.schema.json", "utf8")) as {
      $defs?: Record<string, { additionalProperties?: boolean; allOf?: Array<{ $ref?: string }>; unevaluatedProperties?: boolean }>;
    };

    expect(schema.$defs?.sessionCardBase?.additionalProperties).toBeUndefined();
    expect(schema.$defs?.sessionCardView?.unevaluatedProperties).toBe(false);
    expect(schema.$defs?.sessionDetailView?.allOf?.[0]?.$ref).toBe("#/$defs/sessionCardBase");
    expect(schema.$defs?.expandedSessionView?.allOf?.[0]?.$ref).toBe("#/$defs/sessionCardBase");
  });
});

function record<T extends StoreRecord["recordType"]>(
  recordType: T,
  subjectId: string,
  value: Extract<StoreRecord, { recordType: T }>["value"],
  observedAt = "2026-06-23T02:30:00.000Z"
): Extract<StoreRecord, { recordType: T }> {
  return {
    recordId: `record:${recordType}:${subjectId}`,
    recordType,
    observedAt,
    value
  } as Extract<StoreRecord, { recordType: T }>;
}
