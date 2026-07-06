import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { liveProjectionTranscriptFacts } from "../liveTranscriptFactsRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";
import type { MastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("live transcript facts repository", () => {
  test("returns recent transcript messages scoped by source session id", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-live-transcript-facts-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, "session-a", "source-a");
    seedSession(db, "session-b", "source-b");
    seedMessage(db, "session-a", "user", "Older Board headline investigation detail.", "2026-06-24T12:01:00.000Z");
    seedMessage(db, "session-a", "system", "Codex hook event", "2026-06-24T12:02:00.000Z");
    seedMessage(db, "session-a", "assistant", "Board headlines stopped refreshing from transcript updates.", "2026-06-24T12:03:00.000Z");
    seedMessage(db, "session-b", "user", "Unrelated source session detail.", "2026-06-24T12:04:00.000Z");

    const facts = liveProjectionTranscriptFacts(db, new Set(["source-a"]));

    expect([...facts.keys()]).toEqual(["source-a"]);
    expect(facts.get("source-a")?.recentMessages).toEqual([
      {
        observedAt: "2026-06-24T12:03:00.000Z",
        role: "assistant",
        text: "Board headlines stopped refreshing from transcript updates."
      },
      {
        observedAt: "2026-06-24T12:01:00.000Z",
        role: "user",
        text: "Older Board headline investigation detail."
      }
    ]);
    db.close();
  });

  test("filters hook placeholders before applying the per-session message limit", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-live-transcript-facts-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, "session-a", "source-a");

    for (let index = 0; index < 30; index += 1) {
      seedMessage(db, "session-a", "assistant", "Codex hook event", `2026-06-24T12:30:${String(index).padStart(2, "0")}.000Z`);
    }
    seedMessage(db, "session-a", "user", "Use the latest transcript turns for Board headlines.", "2026-06-24T12:01:00.000Z");
    seedMessage(db, "session-a", "assistant", "Board headlines now refresh from transcript evidence.", "2026-06-24T12:02:00.000Z");

    const facts = liveProjectionTranscriptFacts(db, new Set(["source-a"]), { maxMessagesPerSession: 4 });

    expect(facts.get("source-a")?.recentMessages).toEqual([
      {
        observedAt: "2026-06-24T12:02:00.000Z",
        role: "assistant",
        text: "Board headlines now refresh from transcript evidence."
      },
      {
        observedAt: "2026-06-24T12:01:00.000Z",
        role: "user",
        text: "Use the latest transcript turns for Board headlines."
      }
    ]);
    db.close();
  });

  test("keeps substantive assistant progress messages for live headline facts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-live-transcript-facts-"));
    tempDirs.push(tempDir);
    const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
    migrateDatabase(db);
    seedSession(db, "session-a", "source-a");
    seedMessage(db, "session-a", "assistant", "I’m checking the local tests now.", "2026-06-24T12:03:00.000Z");
    seedMessage(db, "session-a", "user", "Headlines should refresh only when transcript messages change.", "2026-06-24T12:02:00.000Z");

    const facts = liveProjectionTranscriptFacts(db, new Set(["source-a"]));

    expect(facts.get("source-a")?.recentMessages).toEqual([
      {
        observedAt: "2026-06-24T12:03:00.000Z",
        role: "assistant",
        text: "I’m checking the local tests now."
      },
      {
        observedAt: "2026-06-24T12:02:00.000Z",
        role: "user",
        text: "Headlines should refresh only when transcript messages change."
      }
    ]);
    db.close();
  });
});

function seedSession(db: MastheadDatabase, sessionId: string, sourceSessionId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO hosts (host_id, first_seen_at, last_seen_at)
    VALUES (?, ?, ?)`
  ).run("host:test", "2026-06-24T12:00:00.000Z", "2026-06-24T12:00:00.000Z");
  db.prepare(
    `INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)`
  ).run("runtime:test", "opencode", "test", "2026-06-24T12:00:00.000Z", "2026-06-24T12:00:00.000Z");
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, lifecycle, last_activity_at, source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    "host:test",
    "runtime:test",
    sourceSessionId,
    "running",
    "2026-06-24T12:00:00.000Z",
    "authoritative",
    "2026-06-24T12:00:00.000Z",
    "2026-06-24T12:00:00.000Z"
  );
}

function seedMessage(db: MastheadDatabase, sessionId: string, role: string, text: string, observedAt: string): void {
  db.prepare("INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    `${sessionId}:${role}:${observedAt}`,
    sessionId,
    role,
    text,
    `${sessionId}:${role}:${observedAt}:hash`,
    observedAt,
    JSON.stringify({ source: "test" }),
    "authoritative"
  );
}
