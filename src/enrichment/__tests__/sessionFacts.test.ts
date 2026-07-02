import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { buildSessionFacts } from "../sessionFacts.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("session facts", () => {
  test("preserves all user and assistant transcript evidence by role", async () => {
    const db = await openTestDatabase();
    seedSession(db);
    appendMessage(db, "system", "Codex hook event", 0);
    appendMessage(db, "tool", "shell: succeeded", 1);
    for (let index = 0; index < 26; index += 1) {
      appendMessage(db, "user", `User request ${index + 1}`, index + 2);
    }
    appendMessage(db, "assistant", "Assistant implemented the first change.", 40);
    appendMessage(db, "assistant", "Assistant verified the Dossier summary stayed neutral.", 41);

    const facts = buildSessionFacts(db, "session-facts");

    expect(facts.userEvidence).toHaveLength(26);
    expect(facts.userEvidence?.at(0)).toBe("User request 1");
    expect(facts.userEvidence?.at(-1)).toBe("User request 26");
    expect(facts.assistantEvidence).toEqual([
      "Assistant implemented the first change.",
      "Assistant verified the Dossier summary stayed neutral."
    ]);
    expect(facts.messages).not.toContain("Codex hook event");
    expect(facts.messages).not.toContain("shell: succeeded");
    db.close();
  });
});

async function openTestDatabase(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-session-facts-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function seedSession(db: MastheadDatabase): void {
  const now = "2026-07-02T12:00:00.000Z";
  db.prepare("INSERT INTO hosts (host_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)").run("host:test", now, now);
  db.prepare("INSERT INTO runtimes (runtime_id, runtime_kind, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    "runtime:codex",
    "codex",
    now,
    now
  );
  db.prepare(
    `INSERT INTO sessions (
      session_id, host_id, runtime_id, source_session_id, project_label, title, objective,
      lifecycle, last_activity_at, source_confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "session-facts",
    "host:test",
    "runtime:codex",
    "source-session-facts",
    "Masthead",
    "Session facts test",
    "Build role-separated transcript facts.",
    "ended",
    now,
    "authoritative",
    now,
    now
  );
}

function appendMessage(db: MastheadDatabase, role: string, text: string, index: number): void {
  const observedAt = `2026-07-02T12:${String(index).padStart(2, "0")}:00.000Z`;
  db.prepare(
    `INSERT INTO messages (
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`message:${role}:${index}`, "session-facts", role, text, `${role}:${index}:${text}`, observedAt, "{}", "authoritative");
}
