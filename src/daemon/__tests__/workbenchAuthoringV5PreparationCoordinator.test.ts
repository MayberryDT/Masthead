import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  createWorkbenchAuthoringV5Request,
  prepareWorkbenchAuthoringV5RequestStep,
  retryFailedWorkbenchAuthoringV5Preparation,
  startWorkbenchAuthoringV5Pack
} from "../../workbench/authoring/workbenchAuthoringV5Service.ts";
import { markSessionCompileReady, seedSession } from "../db/__tests__/sessionTestHelpers.ts";
import {
  getWorkbenchAuthoringV5Preparation,
  getWorkbenchAuthoringV5Request
} from "../db/workbenchAuthoringV5Repository.ts";
import { migrateDatabase } from "../db/schema.ts";
import { openMastheadDatabase } from "../db/sqlite.ts";
import { createWorkbenchAuthoringV5PreparationCoordinator } from "../workbenchAuthoringV5PreparationCoordinator.ts";

const tempDirs: string[] = [];
const identity = {
  baseUrl: "http://127.0.0.1:17373",
  buildSha: "build:test",
  databaseId: "database:test",
  instanceId: "instance:test",
  instanceManifest: "/tmp/masthead-instance.json"
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

test("resumes a crashed preparation idempotently and exposes packs only after every snapshot is durable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "masthead-v5-preparation-resume-"));
  tempDirs.push(directory);
  const db = await openMastheadDatabase(join(directory, "masthead.sqlite"));
  migrateDatabase(db);
  const sessionIds = Array.from({ length: 25 }, (_, index) => `session:v5-resume:${index}`);
  for (const sessionId of sessionIds) {
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: sessionId });
    markSessionCompileReady(db, sessionId);
  }
  const insertMessage = db.prepare(
    `INSERT INTO messages (
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES (?, ?, 'assistant', ?, ?, ?, '{}', 'authoritative')`
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < 60; index += 1) {
      insertMessage.run(
        `message:v5-resume:paged:${index}`,
        sessionIds[0]!,
        `Paged frozen evidence ${index}`,
        `hash:paged:${index}`,
        `2026-07-24T20:00:${String(index).padStart(2, "0")}.000Z`
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const creationToken = "resume-token";
  const accepted = createWorkbenchAuthoringV5Request(db, {
    actorId: "agent:test",
    command: "/opt/masthead/bin/mastheadctl",
    creationToken,
    currentIdentity: identity,
    expectedIdentity: identity,
    sessionIds
  });
  expect(accepted.preparation).toMatchObject({ preparedSessionCount: 0, status: "preparing" });
  expect(getWorkbenchAuthoringV5Request(db, accepted.preparation.requestId)).toBeUndefined();

  while (!getWorkbenchAuthoringV5Request(db, accepted.preparation.requestId)) {
    prepareWorkbenchAuthoringV5RequestStep(db, accepted.preparation.requestId);
  }
  expect(getWorkbenchAuthoringV5Preparation(db, accepted.preparation.requestId)?.status).toBe("preparing");
  expect(db.prepare(
    "SELECT COUNT(*) AS count FROM workbench_authoring_v5_packs WHERE request_id = ? AND status = 'available'"
  ).get(accepted.preparation.requestId)).toEqual({ count: 0 });
  expect(() => startWorkbenchAuthoringV5Pack(db, {
    command: "/opt/masthead/bin/mastheadctl",
    currentIdentity: identity,
    expectedIdentity: identity,
    requestId: accepted.preparation.requestId
  })).toThrow("authoring_v5_request_preparing");

  const resumed = createWorkbenchAuthoringV5PreparationCoordinator(db);
  resumed.resume();
  await waitUntil(() => getWorkbenchAuthoringV5Preparation(db, accepted.preparation.requestId)?.status === "ready");
  const request = getWorkbenchAuthoringV5Request(db, accepted.preparation.requestId);
  expect(request).toMatchObject({ packSizes: [9, 8, 8], sessionCount: 25, status: "open" });
  expect(db.prepare(
    "SELECT COUNT(*) AS count FROM workbench_authoring_v5_evidence_snapshots WHERE request_id = ?"
  ).get(accepted.preparation.requestId)).toEqual({ count: 25 });
  expect(db.prepare(
    `SELECT COUNT(*) AS pageCount, MAX(item_count) AS maximumItemCount
     FROM workbench_authoring_v5_preparation_evidence_pages WHERE request_id = ?`
  ).get(accepted.preparation.requestId)).toEqual({ maximumItemCount: 25, pageCount: 27 });
  // All packs become available once preparation is durable (packSizes [9, 8, 8]).
  expect(db.prepare(
    "SELECT COUNT(*) AS count FROM workbench_authoring_v5_packs WHERE request_id = ? AND status = 'available'"
  ).get(accepted.preparation.requestId)).toEqual({ count: 3 });

  const retried = createWorkbenchAuthoringV5Request(db, {
    actorId: "agent:test",
    command: "/opt/masthead/bin/mastheadctl",
    creationToken,
    currentIdentity: identity,
    expectedIdentity: identity,
    sessionIds
  });
  expect(retried.preparation.requestId).toBe(accepted.preparation.requestId);
  expect(retried.preparation.status).toBe("ready");
  expect(() => createWorkbenchAuthoringV5Request(db, {
    actorId: "agent:test",
    command: "/opt/masthead/bin/mastheadctl",
    creationToken,
    currentIdentity: identity,
    expectedIdentity: identity,
    sessionIds: sessionIds.slice(0, 24)
  })).toThrow("authoring_v5_creation_token_conflict");
  await resumed.close();
  db.close();
});

test("keeps accepted evidence frozen across a retryable failure and resumes only through explicit retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "masthead-v5-preparation-retry-"));
  tempDirs.push(directory);
  const db = await openMastheadDatabase(join(directory, "masthead.sqlite"));
  migrateDatabase(db);
  const sessionId = "session:v5-retry-frozen";
  seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: sessionId });
  markSessionCompileReady(db, sessionId);
  const insertMessage = db.prepare(
    `INSERT INTO messages (
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES (?, ?, 'assistant', ?, ?, ?, '{}', 'authoritative')`
  );
  for (let index = 0; index < 30; index += 1) {
    insertMessage.run(
      `message:v5-retry:${index}`,
      sessionId,
      `Accepted evidence ${index}`,
      `hash:retry:${index}`,
      `2026-07-24T21:00:${String(index).padStart(2, "0")}.000Z`
    );
  }
  db.exec(`CREATE TEMP TRIGGER fail_second_v5_evidence_page
    BEFORE INSERT ON workbench_authoring_v5_preparation_evidence_pages
    WHEN NEW.item_offset >= 25
    BEGIN
      SELECT RAISE(ABORT, 'transient_evidence_page_failure');
    END`);
  const creationToken = "retry-frozen-token";
  const accepted = createWorkbenchAuthoringV5Request(db, {
    actorId: "agent:test",
    command: "/opt/masthead/bin/mastheadctl",
    creationToken,
    currentIdentity: identity,
    expectedIdentity: identity,
    sessionIds: [sessionId]
  });
  const requestId = accepted.preparation.requestId;
  const coordinator = createWorkbenchAuthoringV5PreparationCoordinator(db);
  coordinator.schedule(requestId);
  await waitUntil(() => getWorkbenchAuthoringV5Preparation(db, requestId)?.status === "failed");
  expect(db.prepare(
    "SELECT COUNT(*) AS count FROM workbench_authoring_v5_preparation_evidence_pages WHERE request_id = ?"
  ).get(requestId)).toEqual({ count: 1 });
  expect(() => db.prepare(
    "UPDATE messages SET text_redacted = ? WHERE message_id = ?"
  ).run("Mutation between failure and retry", "message:v5-retry:0")).toThrow("authoring_v5_evidence_frozen");

  const repeatedCreation = createWorkbenchAuthoringV5Request(db, {
    actorId: "agent:test",
    command: "/opt/masthead/bin/mastheadctl",
    creationToken,
    currentIdentity: identity,
    expectedIdentity: identity,
    sessionIds: [sessionId]
  });
  expect(repeatedCreation.preparation).toMatchObject({ requestId, status: "failed" });

  db.exec("DROP TRIGGER fail_second_v5_evidence_page");
  expect(retryFailedWorkbenchAuthoringV5Preparation(db, {
    currentIdentity: identity,
    expectedIdentity: identity,
    requestId
  })).toMatchObject({ requestId, status: "preparing" });
  coordinator.schedule(requestId);
  await waitUntil(() => getWorkbenchAuthoringV5Preparation(db, requestId)?.status === "ready");
  expect(getWorkbenchAuthoringV5Request(db, requestId)).toMatchObject({ sessionCount: 1, status: "open" });
  expect(db.prepare(
    "UPDATE messages SET text_redacted = ? WHERE message_id = ?"
  ).run("Mutation after durable readiness", "message:v5-retry:0")).toMatchObject({ changes: 1 });
  await coordinator.close();
  db.close();
});

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed_out_waiting_for_preparation");
}
