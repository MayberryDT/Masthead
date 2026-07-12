import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { markWorkbenchNotAdded, readWorkbenchSessionState } from "../../daemon/db/workbenchPipelineRepository.ts";
import { reconcileImportedTranscript } from "../transcriptQualityReconciler.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("transcript quality reconciliation", () => {
  test("new transcript evidence automatically re-admits a provisional metadata-only session", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:hydrate", title: "Hydrate" });
    removeEvidence(db, "session:hydrate");
    markWorkbenchNotAdded(db, {
      actor: { kind: "system", id: "legacy_backfill" },
      reason: "metadata_only",
      sessionId: "session:hydrate"
    });
    insertSubstantialDiscussion(db, "session:hydrate");

    const result = reconcileImportedTranscript(db, "session:hydrate");

    expect(result.quality).toMatchObject({ ok: true });
    expect(readWorkbenchSessionState(db, "session:hydrate")).toMatchObject({
      nonPublicationReason: undefined,
      publicationStatus: "publish_path",
      qualityStatus: "passed",
      transcriptStatus: "imported"
    });
    db.close();
  });

  test("adds a metadata shell to Not Added when its hydration unit produced no evidence", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:pending", title: "Pending" });
    removeEvidence(db, "session:pending");

    const result = reconcileImportedTranscript(db, "session:pending");

    expect(result.quality).toMatchObject({ ok: false, reason: "metadata_only" });
    expect(readWorkbenchSessionState(db, "session:pending")).toMatchObject({
      nonPublicationReason: "metadata_only",
      publicationStatus: "not_added_to_logbook",
      qualityStatus: "failed",
      transcriptStatus: "missing"
    });
    db.close();
  });

  test("adds hook-only evidence to Not Added when its hydration unit completes", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:hook", title: "Hook" });
    db.prepare("DELETE FROM messages WHERE session_id = ?").run("session:hook");
    db.prepare("DELETE FROM file_effects WHERE session_id = ?").run("session:hook");
    db.prepare("DELETE FROM runtime_signals WHERE session_id = ?").run("session:hook");
    db.prepare("DELETE FROM checkpoints WHERE session_id = ?").run("session:hook");
    db.prepare("UPDATE tool_calls SET tool_name = ? WHERE session_id = ?").run("tool call", "session:hook");
    db.prepare("UPDATE tool_results SET status = ? WHERE session_id = ?").run("unknown", "session:hook");

    const result = reconcileImportedTranscript(db, "session:hook");
    expect(result.quality).toMatchObject({ ok: false, reason: "hook_only" });
    expect(readWorkbenchSessionState(db, "session:hook")).toMatchObject({
      nonPublicationReason: "hook_only",
      publicationStatus: "not_added_to_logbook",
      qualityStatus: "failed"
    });
    db.close();
  });

  test("records a low-evidence exclusion when the session hydration unit completes", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:shallow", title: "Shallow" });

    const result = reconcileImportedTranscript(db, "session:shallow");
    expect(result.quality).toMatchObject({ ok: false, reason: "low_evidence" });
    expect(readWorkbenchSessionState(db, "session:shallow")).toMatchObject({
      nonPublicationReason: "low_evidence",
      publicationStatus: "not_added_to_logbook",
      qualityStatus: "failed"
    });
    db.close();
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const dir = await mkdtemp(join(tmpdir(), "masthead-transcript-reconcile-"));
  tempDirs.push(dir);
  const db = await openMastheadDatabase(join(dir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function removeEvidence(db: MastheadDatabase, sessionId: string): void {
  for (const table of ["messages", "tool_results", "tool_calls", "file_effects", "runtime_signals", "checkpoints"]) {
    db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId);
  }
}

function insertSubstantialDiscussion(db: MastheadDatabase, sessionId: string): void {
  for (let index = 0; index < 20; index += 1) {
    db.prepare(
      "INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      `${sessionId}:message:${index}`,
      sessionId,
      index % 2 === 0 ? "user" : "assistant",
      `Detailed import recovery discussion ${index}`,
      `${sessionId}:hash:${index}`,
      `2026-07-10T00:00:${String(index).padStart(2, "0")}.000Z`,
      "{}",
      "authoritative"
    );
  }
}
