import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("doctor hook transcript capture", () => {
  test("finds distinct stuck transcript paths behind noisy duplicate hook rows", async () => {
    // @ts-expect-error The doctor helper is a Node.js script module covered through this Vitest regression.
    const { findHookTranscriptStuckSessions } = await import("../../../scripts/masthead-doctor-hook-capture.js");
    const db = await openTestDatabase();
    seedSession(db, "session:quiet", "quiet-source", "Quiet hook session");
    seedSession(db, "session:noisy", "noisy-source", "Noisy hook session");
    seedHookOnlyMessage(db, "session:quiet", "quiet");
    seedHookOnlyMessage(db, "session:noisy", "noisy");
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

    const result = findHookTranscriptStuckSessions(db, { candidateLimit: 10 });

    expect(result.stuckSessions.map((session: { sourceSessionId: string }) => session.sourceSessionId)).toEqual(
      expect.arrayContaining(["quiet-source", "noisy-source"])
    );
    expect(result.stuckSessions).toHaveLength(2);
    db.close();
  });
});

async function openTestDatabase(): Promise<DatabaseSync> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-doctor-hook-capture-"));
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
    CREATE TABLE runtimes (
      runtime_id TEXT PRIMARY KEY NOT NULL,
      runtime_kind TEXT NOT NULL
    );
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY NOT NULL,
      runtime_id TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      last_activity_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE messages (
      message_id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      text_redacted TEXT NOT NULL
    );
    CREATE TABLE model_usage (
      usage_id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      total_tokens INTEGER
    );
  `);
  db.prepare("INSERT INTO runtimes (runtime_id, runtime_kind) VALUES (?, ?)").run("runtime:codex", "codex");
  return db;
}

function seedSession(db: DatabaseSync, sessionId: string, sourceSessionId: string, title: string): void {
  db.prepare(
    `INSERT INTO sessions (session_id, runtime_id, source_session_id, title, last_activity_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, NULL)`
  ).run(sessionId, "runtime:codex", sourceSessionId, title, "2026-06-25T12:10:00.000Z");
}

function seedHookOnlyMessage(db: DatabaseSync, sessionId: string, suffix: string): void {
  db.prepare("INSERT INTO messages (message_id, session_id, text_redacted) VALUES (?, ?, ?)").run(
    `message:${suffix}`,
    sessionId,
    "Codex hook event"
  );
}

function seedHookRecord(
  db: DatabaseSync,
  input: { eventId: string; observedAt: string; sourceSessionId: string; transcriptPath: string }
): void {
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
