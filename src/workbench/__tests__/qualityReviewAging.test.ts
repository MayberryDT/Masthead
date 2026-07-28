import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import {
  markWorkbenchPublished,
  markWorkbenchQuality,
  markWorkbenchQualityForReview,
  readWorkbenchSessionState
} from "../../daemon/db/workbenchPipelineRepository.ts";
import { reconcileImportedTranscript } from "../transcriptQualityReconciler.ts";
import {
  ageStaleQualityReviews,
  QUALITY_REVIEW_STALE_AGE_MS,
  STALE_INSUFFICIENT_EVIDENCE_REASON
} from "../qualityReviewAging.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("quality review aging", () => {
  test("ages stale review_quality / insufficient_evidence to Not Added with automatic source", async () => {
    const db = await testDb();
    const sessionId = "session:stale-review";
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: "Stale" });
    stripToAmbiguousReview(db, sessionId);
    reconcileImportedTranscript(db, sessionId);
    expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
      nextAction: "review_quality",
      publicationStatus: "publish_path",
      qualityStatus: "unchecked",
      suppressionCategory: "insufficient_evidence"
    });
    const evidenceRevision = readWorkbenchSessionState(db, sessionId)?.qualityEvidenceRevision;
    backdateQualityReview(db, sessionId, daysAgo(10));

    const result = ageStaleQualityReviews(db, { now: "2026-07-28T12:00:00.000Z" });

    expect(result.aged).toBe(1);
    expect(result.agedSessionIds).toEqual([sessionId]);
    expect(result.eligible).toBe(1);
    expect(result.maxAgeMs).toBe(QUALITY_REVIEW_STALE_AGE_MS);
    expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
      nonPublicationReason: STALE_INSUFFICIENT_EVIDENCE_REASON,
      publicationStatus: "not_added_to_logbook",
      qualityDecisionSource: "automatic",
      qualityEvidenceRevision: evidenceRevision,
      qualityStatus: "failed",
      suppressionCategory: "insufficient_evidence",
      nextAction: "none"
    });
    db.close();
  });

  test("does not age a recent quality review", async () => {
    const db = await testDb();
    const sessionId = "session:recent-review";
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: "Recent" });
    stripToAmbiguousReview(db, sessionId);
    reconcileImportedTranscript(db, sessionId);
    backdateQualityReview(db, sessionId, daysAgo(2));

    const result = ageStaleQualityReviews(db, { now: "2026-07-28T12:00:00.000Z" });

    expect(result.aged).toBe(0);
    expect(result.eligible).toBe(0);
    expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
      nextAction: "review_quality",
      publicationStatus: "publish_path",
      qualityStatus: "unchecked"
    });
    db.close();
  });

  test("does not age user-failed / manual exclusion sessions", async () => {
    const db = await testDb();
    const sessionId = "session:user-failed";
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: "User failed" });
    stripToAmbiguousReview(db, sessionId);
    markWorkbenchQuality(db, {
      actor: { kind: "user", id: "workbench_ui" },
      qualityDecisionSource: "user",
      reason: "operator_rejected",
      sessionId,
      status: "failed",
      suppressionCategory: "manual_exclusion"
    });
    // Even if timestamps are ancient, user decisions stay put.
    db.prepare("UPDATE workbench_session_state SET updated_at = ?, last_activity_at = ? WHERE session_id = ?").run(
      daysAgo(30),
      daysAgo(30),
      sessionId
    );

    const result = ageStaleQualityReviews(db, { now: "2026-07-28T12:00:00.000Z" });

    expect(result.aged).toBe(0);
    expect(result.eligible).toBe(0);
    expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
      nonPublicationReason: "operator_rejected",
      publicationStatus: "not_added_to_logbook",
      qualityDecisionSource: "user",
      suppressionCategory: "manual_exclusion"
    });
    db.close();
  });

  test("does not age quality-passed or published sessions", async () => {
    const db = await testDb();
    const passedId = "session:passed";
    const publishedId = "session:published";
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: passedId, title: "Passed" });
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: publishedId, title: "Published" });
    markWorkbenchQuality(db, {
      actor: { kind: "system", id: "test" },
      evidenceRevision: "rev:passed",
      qualityDecisionSource: "automatic",
      sessionId: passedId,
      status: "passed"
    });
    markWorkbenchQuality(db, {
      actor: { kind: "system", id: "test" },
      evidenceRevision: "rev:published",
      qualityDecisionSource: "automatic",
      sessionId: publishedId,
      status: "passed"
    });
    markWorkbenchPublished(db, {
      actor: { kind: "system", id: "test" },
      publishedVia: "test",
      sessionId: publishedId
    });
    db.prepare("UPDATE workbench_session_state SET updated_at = ?, last_activity_at = ? WHERE session_id = ?").run(
      daysAgo(30),
      daysAgo(30),
      passedId
    );
    db.prepare("UPDATE workbench_session_state SET updated_at = ?, last_activity_at = ? WHERE session_id = ?").run(
      daysAgo(30),
      daysAgo(30),
      publishedId
    );

    const result = ageStaleQualityReviews(db, { now: "2026-07-28T12:00:00.000Z" });

    expect(result.aged).toBe(0);
    expect(readWorkbenchSessionState(db, passedId)).toMatchObject({
      publicationStatus: "publish_path",
      qualityStatus: "passed"
    });
    expect(readWorkbenchSessionState(db, publishedId)).toMatchObject({
      publicationStatus: "published",
      qualityStatus: "passed"
    });
    db.close();
  });

  test("dry-run reports eligibility without mutating", async () => {
    const db = await testDb();
    const sessionId = "session:dry-run";
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: "Dry" });
    stripToAmbiguousReview(db, sessionId);
    reconcileImportedTranscript(db, sessionId);
    backdateQualityReview(db, sessionId, daysAgo(14));

    const result = ageStaleQualityReviews(db, { dryRun: true, now: "2026-07-28T12:00:00.000Z" });

    expect(result).toMatchObject({ aged: 0, agedSessionIds: [], dryRun: true, eligible: 1 });
    expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
      nextAction: "review_quality",
      publicationStatus: "publish_path"
    });
    db.close();
  });

  test("evidence-revision change reopens an aged automatic not-added session", async () => {
    const db = await testDb();
    const sessionId = "session:reopen-after-age";
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: "Reopen" });
    stripToAmbiguousReview(db, sessionId);
    reconcileImportedTranscript(db, sessionId);
    backdateQualityReview(db, sessionId, daysAgo(14));
    ageStaleQualityReviews(db, { now: "2026-07-28T12:00:00.000Z" });
    expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
      nonPublicationReason: STALE_INSUFFICIENT_EVIDENCE_REASON,
      publicationStatus: "not_added_to_logbook",
      qualityDecisionSource: "automatic"
    });

    insertMessage(db, sessionId, 10, "user", "Please inspect the import boundary carefully.");
    insertMessage(db, sessionId, 11, "assistant", "The boundary now preserves complete evidence.");
    const result = reconcileImportedTranscript(db, sessionId);

    expect(result.quality).toMatchObject({ disposition: "keep", reason: "meaningful_conversation" });
    expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
      nonPublicationReason: undefined,
      publicationStatus: "publish_path",
      qualityStatus: "passed"
    });
    db.close();
  });

  test("honors a custom maxAgeMs for testing and ops overrides", async () => {
    const db = await testDb();
    const sessionId = "session:custom-age";
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: "Custom" });
    markWorkbenchQualityForReview(db, {
      actor: { kind: "system", id: "test" },
      evidenceRevision: "rev:custom",
      sessionId
    });
    backdateQualityReview(db, sessionId, "2026-07-28T10:00:00.000Z");

    const tooFresh = ageStaleQualityReviews(db, {
      maxAgeMs: 3 * 60 * 60 * 1000,
      now: "2026-07-28T12:00:00.000Z"
    });
    expect(tooFresh.aged).toBe(0);

    const oldEnough = ageStaleQualityReviews(db, {
      maxAgeMs: 60 * 60 * 1000,
      now: "2026-07-28T12:00:00.000Z"
    });
    expect(oldEnough.aged).toBe(1);
    expect(readWorkbenchSessionState(db, sessionId)?.nonPublicationReason).toBe(STALE_INSUFFICIENT_EVIDENCE_REASON);
    db.close();
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const dir = await mkdtemp(join(tmpdir(), "masthead-quality-aging-"));
  tempDirs.push(dir);
  const db = await openMastheadDatabase(join(dir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function stripToAmbiguousReview(db: MastheadDatabase, sessionId: string): void {
  for (const table of ["messages", "tool_results", "tool_calls", "file_effects", "runtime_signals", "checkpoints"]) {
    db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId);
  }
  // One short user message keeps the session non-empty but insufficient for keep.
  insertMessage(db, sessionId, 0, "user", "hi");
}

function backdateQualityReview(db: MastheadDatabase, sessionId: string, iso: string): void {
  db.prepare(
    `UPDATE workbench_session_state
     SET updated_at = ?, last_activity_at = ?
     WHERE session_id = ?`
  ).run(iso, iso, sessionId);
  db.prepare(
    `UPDATE workbench_activity
     SET event_at = ?
     WHERE session_id = ?
       AND event_type IN ('quality_review_required', 'quality_reopened')`
  ).run(iso, sessionId);
}

function daysAgo(days: number): string {
  // Fixed reference so tests are deterministic relative to now override.
  const ms = Date.parse("2026-07-28T12:00:00.000Z") - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

function insertMessage(
  db: MastheadDatabase,
  sessionId: string,
  index: number,
  role: "assistant" | "user",
  text: string
): void {
  db.prepare(
    "INSERT INTO messages (message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    `${sessionId}:message:${index}`,
    sessionId,
    role,
    text,
    `${sessionId}:hash:${index}`,
    `2026-07-10T00:00:${String(index).padStart(2, "0")}.000Z`,
    "{}",
    "authoritative"
  );
}
