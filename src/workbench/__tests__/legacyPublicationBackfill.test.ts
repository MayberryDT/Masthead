import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { legacyDataMigrationCompleted } from "../../daemon/legacyDataMigration.ts";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { listWorkbenchActivity, markWorkbenchNotAdded, readWorkbenchSessionState } from "../../daemon/db/workbenchPipelineRepository.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { runLegacyWorkbenchPublicationBackfill, WORKBENCH_PUBLICATION_BACKFILL_KEY } from "../legacyPublicationBackfill.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("legacy Workbench publication backfill", () => {
  test("publishes meaningful legacy sessions and sends low-quality sessions to Not Added", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:good", title: "Good work" });
    insertMessage(db, "session:good", 1, "assistant", "I will inspect the legacy candidate.");
    insertMessage(db, "session:good", 2, "user", "Please preserve meaningful historical work.");
    insertMessage(db, "session:good", 3, "assistant", "This session has grounded multi-turn evidence.");
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:hook", title: "Hook residue" });
    db.prepare("DELETE FROM messages WHERE session_id = ?").run("session:hook");
    db.prepare("DELETE FROM file_effects WHERE session_id = ?").run("session:hook");
    db.prepare("UPDATE tool_calls SET tool_name = ? WHERE session_id = ?").run("tool call", "session:hook");
    db.prepare("UPDATE tool_results SET status = ? WHERE session_id = ?").run("unknown", "session:hook");
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:existing", title: "Existing state" });
    markWorkbenchNotAdded(db, {
      actor: { kind: "system", id: "test" },
      reason: "metadata_only",
      sessionId: "session:existing"
    });

    const result = runLegacyWorkbenchPublicationBackfill(db);

    expect(result).toMatchObject({
      ok: true,
      published: ["session:good"],
      skippedExistingState: 1,
      totalCandidates: 3
    });
    expect(result.notAdded).toEqual([{ reason: "hook_only", sessionId: "session:hook" }]);
    expect(result.published.length + result.notAdded.length + result.skippedExistingState).toBe(result.totalCandidates);
    expect(readWorkbenchSessionState(db, "session:good")?.publicationStatus).toBe("published");
    expect(readWorkbenchSessionState(db, "session:hook")).toMatchObject({
      nonPublicationReason: "hook_only",
      publicationStatus: "not_added_to_logbook"
    });
    expect(listWorkbenchActivity(db, { sessionId: "session:good", limit: 10 }).map((activity) => activity.eventType)).toContain("published");
    expect(listWorkbenchActivity(db, { sessionId: "session:hook", limit: 10 }).map((activity) => activity.eventType)).toContain(
      "not_added_to_logbook"
    );
    expect(legacyDataMigrationCompleted(db, WORKBENCH_PUBLICATION_BACKFILL_KEY)).toBe(true);
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const dir = await mkdtemp(join(tmpdir(), "masthead-workbench-backfill-test-"));
  tempDirs.push(dir);
  const db = await openMastheadDatabase(join(dir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
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
    `2026-06-25T12:00:0${index}.000Z`,
    "{}",
    "authoritative"
  );
}
