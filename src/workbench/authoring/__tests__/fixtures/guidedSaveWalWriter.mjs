import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";

const state = new Int32Array(workerData.shared);
const db = new DatabaseSync(workerData.databasePath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 3000;");

try {
  waitFor(0);
  Atomics.store(state, 1, 1);
  Atomics.notify(state, 1);
  db.exec("BEGIN IMMEDIATE;");
  Atomics.store(state, 2, 1);
  Atomics.notify(state, 2);
  mutate(workerData.kind);
  db.exec("COMMIT;");
  Atomics.store(state, 3, 1);
  Atomics.notify(state, 3);
  parentPort.postMessage({ kind: "mutation_committed" });
} catch (error) {
  if (db.isTransaction) db.exec("ROLLBACK;");
  Atomics.store(state, 4, 1);
  Atomics.notify(state, 4);
  parentPort.postMessage({
    kind: "failed",
    message: error instanceof Error ? error.message : String(error)
  });
} finally {
  db.close();
}

function waitFor(index) {
  while (Atomics.load(state, index) === 0) Atomics.wait(state, index, 0);
}

function mutate(kind) {
  switch (kind) {
    case "assignment":
      db.prepare("UPDATE guided_authoring_assignments SET updated_at = updated_at || ':writer' WHERE assignment_id = ?")
        .run(workerData.assignmentId);
      return;
    case "coverage":
      db.prepare("UPDATE guided_authoring_evidence_access SET accessed_at = accessed_at || ':writer' WHERE assignment_id = ?")
        .run(workerData.assignmentId);
      return;
    case "canonical_dossier":
      db.prepare("UPDATE sessions SET objective = objective || ' writer' WHERE session_id = ?")
        .run(workerData.sessionId);
      return;
    case "canonical_evidence":
      db.prepare("UPDATE messages SET text_redacted = text_redacted || ' writer' WHERE session_id = ?")
        .run(workerData.sessionId);
      return;
    case "opportunity":
      db.prepare("UPDATE guided_authoring_opportunities SET summary = summary || ' writer' WHERE request_id = ?")
        .run(workerData.requestId);
      return;
    case "accepted_revision":
      db.prepare(
        `UPDATE guided_authoring_draft_reviews
         SET draft_json = json_set(
           draft_json,
           '$.sessionEnrichments[0].enrichment.sessionSummary.text',
           'Writer changed the accepted summary after the saver snapshot.'
         )
         WHERE assignment_id = ? AND revision = 1`
      ).run(workerData.acceptedAssignmentId);
      return;
    default:
      throw new Error(`unknown_guided_save_writer:${kind}`);
  }
}
