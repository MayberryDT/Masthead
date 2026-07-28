import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { recordSessionImportHealth } from "../../daemon/db/sessionImportHealthRepository.ts";
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
  STALE_INSUFFICIENT_EVIDENCE_REASON,
  TERMINAL_INCOMPLETE_INACTIVITY_MS,
  TERMINAL_INCOMPLETE_REASON
} from "../qualityReviewAging.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("quality review aging", () => {
  test("ages terminal incomplete (ended, no assistant/tools/files) to Not Added immediately (D4)", async () => {
    const db = await testDb();
    const sessionId = "session:terminal-incomplete-ended";
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId,
      title: "Terminal incomplete"
    });
    stripToAmbiguousReview(db, sessionId);
    reconcileImportedTranscript(db, sessionId);
    expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
      nextAction: "review_quality",
      publicationStatus: "publish_path",
      qualityStatus: "unchecked",
      suppressionCategory: "insufficient_evidence"
    });
    const evidenceRevision = readWorkbenchSessionState(db, sessionId)?.qualityEvidenceRevision;
    // Recent review anchor — classic 7-day path would skip; D4 terminal path should not.
    backdateQualityReview(db, sessionId, daysAgo(0));

    const result = ageStaleQualityReviews(db, { now: "2026-07-28T12:00:00.000Z" });

    expect(result.terminalIncompleteEligible).toBe(1);
    expect(result.terminalIncompleteAged).toBe(1);
    expect(result.staleEligible).toBe(0);
    expect(result.aged).toBe(1);
    expect(result.agedSessionIds).toEqual([sessionId]);
    expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
      nonPublicationReason: TERMINAL_INCOMPLETE_REASON,
      publicationStatus: "not_added_to_logbook",
      qualityDecisionSource: "automatic",
      qualityEvidenceRevision: evidenceRevision,
      qualityStatus: "failed",
      suppressionCategory: "insufficient_evidence",
      nextAction: "none"
    });
    db.close();
  });

  test("ages terminal incomplete with import_health complete even when lifecycle is unknown (D4)", async () => {
    const db = await testDb();
    const sessionId = "session:terminal-incomplete-import";
    seedSession(db, {
      lifecycle: "unknown",
      model: "grok",
      project: "tyler",
      sessionId,
      title: "tyler session"
    });
    // Clear seed ended_at / set open-looking timestamps.
    db.prepare(
      `UPDATE sessions
       SET ended_at = NULL, last_activity_at = ?, lifecycle = 'unknown'
       WHERE session_id = ?`
    ).run("2026-07-28T11:55:00.000Z", sessionId);
    stripToAmbiguousReview(db, sessionId);
    reconcileImportedTranscript(db, sessionId);
    seedImportHealthComplete(db, sessionId);
    backdateQualityReview(db, sessionId, "2026-07-28T11:50:00.000Z");

    const result = ageStaleQualityReviews(db, { now: "2026-07-28T12:00:00.000Z" });

    expect(result.terminalIncompleteAged).toBe(1);
    expect(readWorkbenchSessionState(db, sessionId)?.nonPublicationReason).toBe(TERMINAL_INCOMPLETE_REASON);
    expect(readWorkbenchSessionState(db, sessionId)?.publicationStatus).toBe("not_added_to_logbook");
    db.close();
  });

  test("does not auto-dispose live/active incomplete shells with recent activity (D4)", async () => {
    const db = await testDb();
    const sessionId = "session:live-incomplete";
    seedSession(db, {
      lifecycle: "active",
      model: "grok",
      project: "Masthead",
      sessionId,
      title: "Live incomplete"
    });
    db.prepare(
      `UPDATE sessions
       SET ended_at = NULL, last_activity_at = ?, lifecycle = 'active'
       WHERE session_id = ?`
    ).run("2026-07-28T11:50:00.000Z", sessionId);
    stripToAmbiguousReview(db, sessionId);
    reconcileImportedTranscript(db, sessionId);
    backdateQualityReview(db, sessionId, "2026-07-28T11:50:00.000Z");

    const result = ageStaleQualityReviews(db, { now: "2026-07-28T12:00:00.000Z" });

    expect(result.aged).toBe(0);
    expect(result.terminalIncompleteEligible).toBe(0);
    expect(result.staleEligible).toBe(0);
    expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
      nextAction: "review_quality",
      publicationStatus: "publish_path",
      qualityStatus: "unchecked"
    });
    db.close();
  });

  test("does not treat incomplete shells that have real content path evidence as terminal (D4)", async () => {
    const db = await testDb();
    const sessionId = "session:thin-tools-review";
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId,
      title: "Thin tools"
    });
    // strip seed file_effects + leave a single tool_call so precheck stays review
    // (needs tools>=4 for keep) but shape is not terminal-incomplete.
    stripToAmbiguousReview(db, sessionId);
    insertToolCall(db, sessionId, 0, "read_file");
    reconcileImportedTranscript(db, sessionId);
    expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
      nextAction: "review_quality",
      suppressionCategory: "insufficient_evidence"
    });
    backdateQualityReview(db, sessionId, daysAgo(2));

    const result = ageStaleQualityReviews(db, { now: "2026-07-28T12:00:00.000Z" });

    expect(result.terminalIncompleteEligible).toBe(0);
    expect(result.aged).toBe(0);
    expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
      nextAction: "review_quality",
      publicationStatus: "publish_path"
    });
    db.close();
  });

  test("does not age a recent non-frozen quality review via classic stale path", async () => {
    const db = await testDb();
    const sessionId = "session:recent-review";
    seedSession(db, {
      lifecycle: "active",
      model: "gpt-5",
      project: "Masthead",
      sessionId,
      title: "Recent"
    });
    db.prepare(
      `UPDATE sessions
       SET ended_at = NULL, last_activity_at = ?, lifecycle = 'active'
       WHERE session_id = ?`
    ).run(daysAgo(2), sessionId);
    stripToAmbiguousReview(db, sessionId);
    // One tool call keeps this off the terminal-incomplete shape while remaining review.
    insertToolCall(db, sessionId, 0, "search");
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

  test("classic stale path still ages non-terminal review holds after maxAgeMs", async () => {
    const db = await testDb();
    const sessionId = "session:stale-review";
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId,
      title: "Stale thin tools"
    });
    stripToAmbiguousReview(db, sessionId);
    insertToolCall(db, sessionId, 0, "read_file");
    insertToolCall(db, sessionId, 1, "grep");
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

    expect(result.terminalIncompleteEligible).toBe(0);
    expect(result.staleEligible).toBe(1);
    expect(result.aged).toBe(1);
    expect(result.agedSessionIds).toEqual([sessionId]);
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

  test("does not age user-failed / manual exclusion sessions", async () => {
    const db = await testDb();
    const sessionId = "session:user-failed";
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId,
      title: "User failed"
    });
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

  test("manual exclusion remains sticky after terminal incomplete would have matched (D4)", async () => {
    const db = await testDb();
    const sessionId = "session:manual-sticky";
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId,
      title: "Manual sticky"
    });
    stripToAmbiguousReview(db, sessionId);
    reconcileImportedTranscript(db, sessionId);
    markWorkbenchQuality(db, {
      actor: { kind: "user", id: "workbench_ui" },
      qualityDecisionSource: "user",
      reason: "insufficient_evidence_confirmed",
      sessionId,
      status: "failed",
      suppressionCategory: "manual_exclusion"
    });

    const result = ageStaleQualityReviews(db, { now: "2026-07-28T12:00:00.000Z" });

    expect(result.aged).toBe(0);
    expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
      nonPublicationReason: "insufficient_evidence_confirmed",
      qualityDecisionSource: "user",
      suppressionCategory: "manual_exclusion",
      publicationStatus: "not_added_to_logbook"
    });
    db.close();
  });

  test("does not age quality-passed or published sessions", async () => {
    const db = await testDb();
    const passedId = "session:passed";
    const publishedId = "session:published";
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: passedId,
      title: "Passed"
    });
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: publishedId,
      title: "Published"
    });
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

  test("dry-run reports terminal incomplete eligibility without mutating", async () => {
    const db = await testDb();
    const sessionId = "session:dry-run";
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId,
      title: "Dry"
    });
    stripToAmbiguousReview(db, sessionId);
    reconcileImportedTranscript(db, sessionId);
    backdateQualityReview(db, sessionId, daysAgo(0));

    const result = ageStaleQualityReviews(db, { dryRun: true, now: "2026-07-28T12:00:00.000Z" });

    expect(result).toMatchObject({
      aged: 0,
      agedSessionIds: [],
      dryRun: true,
      eligible: 1,
      terminalIncompleteEligible: 1,
      terminalIncompleteAged: 0
    });
    expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
      nextAction: "review_quality",
      publicationStatus: "publish_path"
    });
    db.close();
  });

  test("evidence-revision change reopens an aged automatic not-added session", async () => {
    const db = await testDb();
    const sessionId = "session:reopen-after-age";
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId,
      title: "Reopen"
    });
    stripToAmbiguousReview(db, sessionId);
    reconcileImportedTranscript(db, sessionId);
    backdateQualityReview(db, sessionId, daysAgo(0));
    ageStaleQualityReviews(db, { now: "2026-07-28T12:00:00.000Z" });
    expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
      nonPublicationReason: TERMINAL_INCOMPLETE_REASON,
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

  test("honors a custom maxAgeMs for classic stale path", async () => {
    const db = await testDb();
    const sessionId = "session:custom-age";
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId,
      title: "Custom"
    });
    // Seed file_effects would keep; strip and add thin tools so only classic stale applies.
    stripToAmbiguousReview(db, sessionId);
    insertToolCall(db, sessionId, 0, "read_file");
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
    expect(oldEnough.staleAged).toBe(1);
    expect(readWorkbenchSessionState(db, sessionId)?.nonPublicationReason).toBe(STALE_INSUFFICIENT_EVIDENCE_REASON);
    db.close();
  });

  test("inactive unknown incomplete freezes after inactivity window without import health", async () => {
    const db = await testDb();
    const sessionId = "session:inactive-incomplete";
    seedSession(db, {
      lifecycle: "unknown",
      model: "grok",
      project: "Masthead",
      sessionId,
      title: "Inactive incomplete"
    });
    const staleActivity = new Date(
      Date.parse("2026-07-28T12:00:00.000Z") - TERMINAL_INCOMPLETE_INACTIVITY_MS - 60_000
    ).toISOString();
    db.prepare(
      `UPDATE sessions
       SET ended_at = NULL, last_activity_at = ?, lifecycle = 'unknown'
       WHERE session_id = ?`
    ).run(staleActivity, sessionId);
    stripToAmbiguousReview(db, sessionId);
    reconcileImportedTranscript(db, sessionId);
    backdateQualityReview(db, sessionId, staleActivity);

    const result = ageStaleQualityReviews(db, { now: "2026-07-28T12:00:00.000Z" });

    expect(result.terminalIncompleteAged).toBe(1);
    expect(readWorkbenchSessionState(db, sessionId)?.nonPublicationReason).toBe(TERMINAL_INCOMPLETE_REASON);
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

function insertToolCall(db: MastheadDatabase, sessionId: string, index: number, toolName: string): void {
  db.prepare(
    `INSERT INTO tool_calls (
      tool_call_id, session_id, tool_name, arguments_redacted_json, started_at, source_ref_json
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    `${sessionId}:tool:${index}`,
    sessionId,
    toolName,
    "{}",
    `2026-07-10T00:01:${String(index).padStart(2, "0")}.000Z`,
    "{}"
  );
}

function seedImportHealthComplete(db: MastheadDatabase, sessionId: string): void {
  const now = "2026-07-28T11:00:00.000Z";
  const sourceId = `source:${sessionId}`;
  const importJobId = `import-job:${sessionId}`;
  const manifestId = `manifest:${sessionId}`;
  const workUnitId = `work-unit:${sessionId}`;
  db.prepare(
    `INSERT OR IGNORE INTO ingest_sources (
      source_id, adapter, source_kind, confidence, discovered_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sourceId, "grok", "jsonl", "authoritative", now, now);
  db.prepare(
    `INSERT INTO import_jobs (import_job_id, source_id, import_kind, status, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(importJobId, sourceId, "transcript", "succeeded", now);
  db.prepare(
    `INSERT INTO import_manifests (
      manifest_id, import_job_id, source_id, runtime_kind, import_kind, scope_json,
      generated_at, total_units, included_units, capped_units, excluded_units, total_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(manifestId, importJobId, sourceId, "grok", "transcript", "{}", now, 1, 1, 0, 0, 1);
  db.prepare(
    `INSERT INTO import_work_units (
      work_unit_id, manifest_id, import_job_id, source_id, runtime_kind, source_kind,
      confidence, unit_kind, source_path, status, timestamp_basis
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    workUnitId,
    manifestId,
    importJobId,
    sourceId,
    "grok",
    "jsonl",
    "authoritative",
    "transcript_file",
    `/tmp/${sessionId}.jsonl`,
    "succeeded",
    "unknown"
  );
  recordSessionImportHealth(db, {
    evidenceRevision: "rev:import-complete",
    importJobId,
    sessionId,
    status: "complete",
    updatedAt: now,
    workUnitId
  });
}
