import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";

const state = new Int32Array(workerData.shared);
const db = new DatabaseSync(workerData.databasePath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 25;");
parentPort.postMessage({ kind: "ready" });

waitForRelease(0);
Atomics.store(state, 2, attemptMutation() === "busy" ? 1 : -1);
Atomics.store(state, 1, 1);
Atomics.notify(state, 1);

waitForRelease(3);
Atomics.store(state, 5, attemptMutation() === "committed" ? 2 : -1);
Atomics.store(state, 4, 1);
Atomics.notify(state, 4);
db.close();

function waitForRelease(index) {
  while (Atomics.load(state, index) === 0) Atomics.wait(state, index, 0);
}

function attemptMutation() {
  try {
    db.prepare("UPDATE messages SET text_redacted = text_redacted || ' worker mutation' WHERE session_id = 'session:0'").run();
    return "committed";
  } catch (error) {
    if (error?.code === "ERR_SQLITE_ERROR" && /database is locked/u.test(error.message)) return "busy";
    return `error:${error?.code || "unknown"}:${error?.message || String(error)}`;
  }
}
