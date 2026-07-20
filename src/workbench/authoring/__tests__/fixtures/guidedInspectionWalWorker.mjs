import { constants, DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
import { inspectGuidedAssignment } from "../../guidedAuthoringService.ts";

const state = new Int32Array(workerData.shared);
const db = new DatabaseSync(workerData.databasePath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 3000;");

function send(kind, extra = {}) {
  const sequence = Atomics.add(state, 0, 1) + 1;
  parentPort.postMessage({ kind, sequence, ...extra });
}

let selected = false;
db.setAuthorizer((actionCode, tableName) => {
  if (!selected && actionCode === constants.SQLITE_INSERT && tableName === "guided_authoring_evidence_access") {
    selected = true;
    send("page_selected");
    if (workerData.pauseAfterSelection) {
      const result = Atomics.wait(state, workerData.releaseIndex, 0, 5_000);
      if (result === "timed-out") throw new Error("guided_inspection_worker_release_timeout");
    }
  }
  return constants.SQLITE_OK;
});

try {
  send("transaction_attempted");
  const result = inspectGuidedAssignment(db, {
    assignmentId: workerData.assignmentId,
    command: "masthead",
    limit: 1
  });
  send("committed", { result });
} catch (error) {
  send("failed", { message: error instanceof Error ? error.message : String(error) });
} finally {
  db.close();
}
