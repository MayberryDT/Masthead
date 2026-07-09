import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { runCaptureQualityPrecheck } from "../qualityPrecheck.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Workbench capture quality precheck", () => {
  test("passes a session with a meaningful user message", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:good", title: "Good work" });

    expect(runCaptureQualityPrecheck(db, "session:good")).toMatchObject({
      ok: true,
      reason: "meaningful_message",
      sessionId: "session:good"
    });
  });

  test("fails metadata-only sessions", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:empty", title: "Empty" });
    removeTranscriptRows(db, "session:empty");

    expect(runCaptureQualityPrecheck(db, "session:empty")).toMatchObject({
      ok: false,
      reason: "metadata_only",
      sessionId: "session:empty"
    });
  });

  test("fails sessions with only hook/tool residue", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:hook", title: "Hook residue" });
    db.prepare("DELETE FROM messages WHERE session_id = ?").run("session:hook");
    db.prepare("DELETE FROM file_effects WHERE session_id = ?").run("session:hook");
    db.prepare("UPDATE tool_calls SET tool_name = ? WHERE session_id = ?").run("tool call", "session:hook");
    db.prepare("UPDATE tool_results SET status = ? WHERE session_id = ?").run("unknown", "session:hook");

    expect(runCaptureQualityPrecheck(db, "session:hook")).toMatchObject({
      ok: false,
      reason: "hook_only",
      sessionId: "session:hook"
    });
  });

  test("passes assistant-only transcript as usable transcript", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:assistant", title: "Assistant transcript" });
    db.prepare("UPDATE messages SET role = ?, text_redacted = ?, text_hash = ? WHERE session_id = ?").run(
      "assistant",
      "Implemented the authentication callback.",
      "session:assistant:assistant-hash",
      "session:assistant"
    );

    expect(runCaptureQualityPrecheck(db, "session:assistant")).toMatchObject({
      ok: true,
      reason: "usable_transcript",
      sessionId: "session:assistant"
    });
  });

  test("fails non-message evidence as no messages", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:no-messages", title: "File only" });
    db.prepare("DELETE FROM messages WHERE session_id = ?").run("session:no-messages");
    db.prepare("DELETE FROM tool_results WHERE session_id = ?").run("session:no-messages");
    db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run("session:no-messages");
    db.prepare("DELETE FROM runtime_signals WHERE session_id = ?").run("session:no-messages");
    db.prepare("DELETE FROM checkpoints WHERE session_id = ?").run("session:no-messages");

    expect(runCaptureQualityPrecheck(db, "session:no-messages")).toMatchObject({
      ok: false,
      reason: "no_messages",
      sessionId: "session:no-messages"
    });
  });

  test("fails low-value message-only sessions", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:noise", title: "Noise" });
    removeTranscriptRows(db, "session:noise");
    db.prepare("INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      "session:noise:message",
      "session:noise",
      "user",
      "codex hook event",
      "session:noise:hash",
      "2026-06-25T12:00:00.000Z",
      "{}",
      "authoritative"
    );

    expect(runCaptureQualityPrecheck(db, "session:noise")).toMatchObject({
      ok: false,
      reason: "duplicate_noise",
      sessionId: "session:noise"
    });
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const dir = await mkdtemp(join(tmpdir(), "masthead-workbench-quality-test-"));
  tempDirs.push(dir);
  const db = await openMastheadDatabase(join(dir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function removeTranscriptRows(db: MastheadDatabase, sessionId: string): void {
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM tool_results WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM file_effects WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM runtime_signals WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM checkpoints WHERE session_id = ?").run(sessionId);
}
