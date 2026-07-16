import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { initializeSessionTranscriptFingerprintIndex } from "../../daemon/db/sessionTranscriptFingerprintIndex.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { runCaptureQualityPrecheck } from "../qualityPrecheck.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Workbench capture quality precheck", () => {
  test("keeps one-request sessions with substantial tool work", async () => {
    const db = await testDb();
    const sessionId = "session:one-request-many-tools";
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: "Tool work" });
    db.prepare("DELETE FROM file_effects WHERE session_id = ?").run(sessionId);
    db.prepare(
      "INSERT INTO tool_calls (tool_call_id, session_id, tool_name, started_at, source_ref_json) VALUES (?, ?, ?, ?, ?)"
    ).run(`${sessionId}:tool:2`, sessionId, "exec_command", "2026-06-25T12:00:01.000Z", "{}");
    db.prepare(
      "INSERT INTO tool_results (tool_result_id, tool_call_id, session_id, status, completed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(`${sessionId}:tool-result:2`, `${sessionId}:tool:2`, sessionId, "succeeded", "2026-06-25T12:00:02.000Z", "{}");

    expect(runCaptureQualityPrecheck(db, sessionId)).toMatchObject({
      disposition: "keep",
      reason: "substantial_tool_work"
    });
  });

  test("keeps an ambiguous short session on the review path", async () => {
    const db = await testDb();
    const sessionId = "session:ambiguous-short";
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: "Ambiguous" });
    db.prepare("DELETE FROM file_effects WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM tool_results WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);

    expect(runCaptureQualityPrecheck(db, sessionId)).toMatchObject({
      disposition: "review",
      reason: "insufficient_evidence"
    });
  });

  test("suppresses confirmed hook-only evidence", async () => {
    const db = await testDb();
    const sessionId = "session:hook-only";
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: "Hook residue" });
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM file_effects WHERE session_id = ?").run(sessionId);
    db.prepare("UPDATE tool_calls SET tool_name = ? WHERE session_id = ?").run("tool call", sessionId);
    db.prepare("UPDATE tool_results SET status = ? WHERE session_id = ?").run("unknown", sessionId);

    expect(runCaptureQualityPrecheck(db, sessionId)).toMatchObject({
      disposition: "suppress",
      reason: "hook_only"
    });
  });

  test("suppresses diagnostic-only evidence", async () => {
    const db = await testDb();
    const sessionId = "session:diagnostic-only";
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: "Diagnostics" });
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM file_effects WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM tool_results WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run(sessionId);
    db.prepare(
      "INSERT INTO runtime_signals (signal_id, session_id, signal_kind, severity, title, details_json, observed_at, source_ref_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      `${sessionId}:diagnostic`,
      sessionId,
      "diagnostic",
      "info",
      "TypeScript diagnostics",
      JSON.stringify({ errors: 0 }),
      "2026-06-25T12:00:03.000Z",
      "{}"
    );

    expect(runCaptureQualityPrecheck(db, sessionId)).toMatchObject({
      disposition: "suppress",
      reason: "diagnostic_only"
    });
  });

  test("suppresses an exact canonical duplicate", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:duplicate-a",
      title: "Original"
    });
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:duplicate-b",
      title: "Duplicate"
    });
    runCaptureQualityPrecheck(db, "session:duplicate-a");

    expect(runCaptureQualityPrecheck(db, "session:duplicate-b")).toMatchObject({
      disposition: "suppress",
      reason: "exact_duplicate"
    });
  });

  test("keeps exact-duplicate candidate lookup indexed across a medium corpus", async () => {
    const db = await testDb();
    const sessionIds = Array.from({ length: 60 }, (_, index) => `session:duplicate-corpus-${String(index).padStart(2, "0")}`);
    for (const sessionId of sessionIds) {
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: sessionId });
    }
    initializeSessionTranscriptFingerprintIndex(db);

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
    expect(runCaptureQualityPrecheck(countedDb, sessionIds.at(-1)!)).toMatchObject({
      disposition: "suppress",
      reason: "exact_duplicate"
    });
    expect(queryCount).toBeLessThanOrEqual(20);
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_transcript_fingerprints").get()).toEqual({ count: 60 });
    expect(db.prepare(
      "EXPLAIN QUERY PLAN SELECT session_id FROM session_transcript_fingerprints WHERE fingerprint = ?"
    ).all("missing")).toContainEqual(expect.objectContaining({ detail: expect.stringContaining("idx_session_transcript_fingerprints_lookup") }));
  });

  test("invalidates a persisted duplicate fingerprint when canonical transcript evidence changes", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:a-original", title: "Original" });
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:z-later", title: "Later" });
    runCaptureQualityPrecheck(db, "session:a-original");
    expect(runCaptureQualityPrecheck(db, "session:z-later")).toMatchObject({ reason: "exact_duplicate" });

    db.prepare("UPDATE messages SET text_redacted = ?, text_hash = ? WHERE session_id = ?")
      .run("Changed canonical evidence", "changed-hash", "session:a-original");
    expect(db.prepare("SELECT session_id FROM session_transcript_fingerprints WHERE session_id = ?").get("session:a-original")).toBeUndefined();
    runCaptureQualityPrecheck(db, "session:a-original");
    expect(db.prepare("SELECT session_id FROM session_transcript_fingerprints WHERE session_id = ?").get("session:a-original"))
      .toEqual({ session_id: "session:a-original" });

    expect(runCaptureQualityPrecheck(db, "session:z-later")).toMatchObject({
      disposition: "keep",
      reason: "durable_file_effect"
    });
  });

  test("keeps a grounded multi-turn session with a durable file effect", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:good", title: "Good work" });
    insertMessage(db, "session:good", 1, "assistant", "I will inspect the import pipeline.");
    insertMessage(db, "session:good", 2, "user", "Please fix the candidate admission boundary.");
    insertMessage(db, "session:good", 3, "assistant", "The gate now runs after canonical evidence is stored.");

    expect(runCaptureQualityPrecheck(db, "session:good")).toMatchObject({
      disposition: "keep",
      reason: "durable_file_effect",
      sessionId: "session:good"
    });
  });

  test("keeps a short session with a durable file effect", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:shallow", title: "Shallow" });

    expect(runCaptureQualityPrecheck(db, "session:shallow")).toMatchObject({
      disposition: "keep",
      reason: "durable_file_effect",
      sessionId: "session:shallow"
    });
  });

  test("suppresses empty sessions", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:empty", title: "Empty" });
    removeTranscriptRows(db, "session:empty");

    expect(runCaptureQualityPrecheck(db, "session:empty")).toMatchObject({
      disposition: "suppress",
      reason: "empty",
      sessionId: "session:empty"
    });
  });

  test("suppresses sessions with only hook/tool residue", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:hook", title: "Hook residue" });
    db.prepare("DELETE FROM messages WHERE session_id = ?").run("session:hook");
    db.prepare("DELETE FROM file_effects WHERE session_id = ?").run("session:hook");
    db.prepare("UPDATE tool_calls SET tool_name = ? WHERE session_id = ?").run("tool call", "session:hook");
    db.prepare("UPDATE tool_results SET status = ? WHERE session_id = ?").run("unknown", "session:hook");

    expect(runCaptureQualityPrecheck(db, "session:hook")).toMatchObject({
      disposition: "suppress",
      reason: "hook_only",
      sessionId: "session:hook"
    });
  });

  test("keeps an assistant-only transcript with a durable file effect", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:assistant", title: "Assistant transcript" });
    db.prepare("UPDATE messages SET role = ?, text_redacted = ?, text_hash = ? WHERE session_id = ?").run(
      "assistant",
      "Implemented the authentication callback.",
      "session:assistant:assistant-hash",
      "session:assistant"
    );

    expect(runCaptureQualityPrecheck(db, "session:assistant")).toMatchObject({
      disposition: "keep",
      reason: "durable_file_effect",
      sessionId: "session:assistant"
    });
  });

  test("passes a substantial discussion without tool or file evidence", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:discussion", title: "Design discussion" });
    removeTranscriptRows(db, "session:discussion");
    for (let index = 0; index < 20; index += 1) {
      insertMessage(
        db,
        "session:discussion",
        index,
        index % 2 === 0 ? "user" : "assistant",
        `Detailed architecture discussion turn ${index}`
      );
    }

    expect(runCaptureQualityPrecheck(db, "session:discussion")).toMatchObject({
      disposition: "keep",
      reason: "meaningful_conversation",
      sessionId: "session:discussion"
    });
  });

  test("passes meaningful tool-only or file-only evidence without requiring chat messages", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:no-messages", title: "File only" });
    db.prepare("DELETE FROM messages WHERE session_id = ?").run("session:no-messages");
    db.prepare("DELETE FROM tool_results WHERE session_id = ?").run("session:no-messages");
    db.prepare("DELETE FROM tool_calls WHERE session_id = ?").run("session:no-messages");
    db.prepare("DELETE FROM runtime_signals WHERE session_id = ?").run("session:no-messages");
    db.prepare("DELETE FROM checkpoints WHERE session_id = ?").run("session:no-messages");

    expect(runCaptureQualityPrecheck(db, "session:no-messages")).toMatchObject({
      disposition: "keep",
      reason: "durable_file_effect",
      sessionId: "session:no-messages"
    });
  });

  test("keeps ambiguous low-value message-only sessions reviewable", async () => {
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
      disposition: "review",
      reason: "insufficient_evidence",
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

function insertMessage(db: MastheadDatabase, sessionId: string, index: number, role: "assistant" | "user", text: string): void {
  db.prepare(
    "INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    `${sessionId}:message:${index}`,
    sessionId,
    role,
    text,
    `${sessionId}:hash:${index}`,
    `2026-06-25T12:00:${String(index).padStart(2, "0")}.000Z`,
    "{}",
    "authoritative"
  );
}
