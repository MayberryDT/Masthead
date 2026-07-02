import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { recentHookEventsWithTranscriptPaths, recentHookEventsWithTranscriptPathsForSessions } from "../hookTranscriptRecovery.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("hook transcript recovery", () => {
  test("selects distinct transcript paths before applying the recovery limit", async () => {
    const db = await openTestDatabase();
    seedHookRecord(db, {
      eventId: "quiet-start",
      observedAt: "2026-06-25T12:00:00.000Z",
      sourceSessionId: "quiet-source",
      transcriptPath: "/home/tyler/.codex/sessions/quiet.jsonl"
    });
    for (let index = 0; index < 30; index += 1) {
      seedHookRecord(db, {
        eventId: `noisy-${index}`,
        observedAt: `2026-06-25T12:05:${String(index).padStart(2, "0")}.000Z`,
        sourceSessionId: "noisy-source",
        transcriptPath: "/home/tyler/.codex/sessions/noisy.jsonl"
      });
    }

    const events = recentHookEventsWithTranscriptPaths(db, "codex-hook-local", 10);

    expect(events.map((event) => event.sessionId)).toEqual(["noisy-source", "quiet-source"]);
    expect(events).toHaveLength(2);
    db.close();
  });

  test("selects transcript paths for requested source sessions only", async () => {
    const db = await openTestDatabase();
    seedHookRecord(db, {
      eventId: "visible",
      observedAt: "2026-06-25T12:00:00.000Z",
      sourceSessionId: "visible-source",
      transcriptPath: "/home/tyler/.codex/sessions/visible.jsonl"
    });
    seedHookRecord(db, {
      eventId: "hidden",
      observedAt: "2026-06-25T12:01:00.000Z",
      sourceSessionId: "hidden-source",
      transcriptPath: "/home/tyler/.codex/sessions/hidden.jsonl"
    });

    const events = recentHookEventsWithTranscriptPathsForSessions(db, "codex-hook-local", new Set(["visible-source"]), 10);

    expect(events.map((event) => event.sessionId)).toEqual(["visible-source"]);
    db.close();
  });
});

async function openTestDatabase(): Promise<DatabaseSync> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-hook-transcript-recovery-"));
  tempDirs.push(tempDir);
  const db = new DatabaseSync(join(tempDir, "masthead.sqlite"));
  db.exec(`
    CREATE TABLE raw_events (
      raw_event_id TEXT PRIMARY KEY NOT NULL,
      source_id TEXT NOT NULL,
      source_record_key TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
  `);
  return db;
}

function seedHookRecord(db: DatabaseSync, input: { eventId: string; observedAt: string; sourceSessionId: string; transcriptPath: string }): void {
  const record = {
    observedAt: input.observedAt,
    recordId: `event:codex:${input.eventId}`,
    recordType: "event",
    value: {
      eventId: `codex:${input.eventId}`,
      occurredAt: input.observedAt,
      payload: { transcriptPath: input.transcriptPath },
      sessionId: input.sourceSessionId,
      source: { adapter: "codex", surface: "hook" }
    }
  };
  db.prepare(
    `INSERT INTO raw_events (
      raw_event_id, source_id, source_record_key, observed_at, received_at, source_kind, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `raw:${input.eventId}`,
    "codex-hook-local",
    record.recordId,
    input.observedAt,
    input.observedAt,
    "hook",
    JSON.stringify(record)
  );
}
