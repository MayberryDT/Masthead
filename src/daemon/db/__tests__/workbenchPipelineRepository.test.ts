import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { seedSession } from "./sessionTestHelpers.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import {
  claimWorkbenchSessions,
  enrollMissingWorkbenchSessions,
  enrollWorkbenchSession,
  ensureWorkbenchSessionState,
  listWorkbenchActivity,
  listWorkbenchQueue,
  markWorkbenchArtifactSatisfied,
  markWorkbenchNotAdded,
  markWorkbenchPublished,
  markWorkbenchQuality,
  markWorkbenchSessionEnrichmentSatisfied,
  publishWorkbenchSession,
  readWorkbenchSessionState,
  releaseWorkbenchClaim
} from "../workbenchPipelineRepository.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("workbench pipeline repository", () => {
  test("creates default publish-path state for a captured session", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:1", title: "Meaningful work" });

    const state = ensureWorkbenchSessionState(db, "session:1");

    expect(state).toMatchObject({
      sessionId: "session:1",
      publicationStatus: "publish_path",
      nextAction: "check_transcript",
      transcriptStatus: "unchecked",
      qualityStatus: "unchecked",
      sessionEnrichmentStatus: "missing",
      sessionDossierStatus: "missing",
      bugFixTraceStatus: "unknown"
    });
    expect(state.createdAt).toEqual(expect.any(String));
    expect(state.updatedAt).toEqual(expect.any(String));
  });

  test("published state is an explicit transition with activity", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:1", title: "Meaningful work" });

    const result = markWorkbenchPublished(db, {
      actor: { kind: "agent", id: "codex" },
      publishedVia: "workbench_publish",
      sessionId: "session:1"
    });

    expect(result.state.publicationStatus).toBe("published");
    // Package published; automatic kinds still open → continue compile (enrich), not terminal none.
    expect(result.state.nextAction).toBe("enrich");
    expect(result.state.publishedAt).toEqual(expect.any(String));
    expect(result.activity.eventType).toBe("published");
    expect(listWorkbenchActivity(db, { sessionId: "session:1", limit: 10 })[0]).toMatchObject({
      eventType: "published",
      details: expect.objectContaining({ publishedVia: "workbench_publish" })
    });
  });

  test("repeated publish preserves the original publication receipt", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:1", title: "Meaningful work" });

    const first = markWorkbenchPublished(db, {
      actor: { kind: "agent", id: "codex" },
      publishedVia: "workbench_publish",
      sessionId: "session:1"
    });
    await waitForClockTick();
    const second = markWorkbenchPublished(db, {
      actor: { kind: "agent", id: "codex" },
      publishedVia: "workbench_publish",
      sessionId: "session:1"
    });

    expect(second.activity.activityId).toBe(first.activity.activityId);
    expect(second.activity.eventAt).toBe(first.activity.eventAt);
    expect(second.state.publishedAt).toBe(first.state.publishedAt);
    expect(second.state.lastActivityAt).toBe(first.state.lastActivityAt);
  });

  test("not added state records a non-publication reason and activity", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:1", title: "Meaningful work" });

    const result = markWorkbenchNotAdded(db, {
      actor: { kind: "system", id: "legacy_backfill" },
      reason: "no_messages",
      sessionId: "session:1"
    });

    expect(result.state.publicationStatus).toBe("not_added_to_logbook");
    expect(result.state.nonPublicationReason).toBe("no_messages");
    expect(result.state.nextAction).toBe("none");
    expect(result.activity).toMatchObject({
      eventType: "not_added_to_logbook",
      details: expect.objectContaining({ reason: "no_messages" })
    });
  });

  test("repeated not-added transition preserves the original non-publication receipt", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:1", title: "Meaningful work" });

    const first = markWorkbenchNotAdded(db, {
      actor: { kind: "system", id: "legacy_backfill" },
      reason: "no_messages",
      sessionId: "session:1"
    });
    await waitForClockTick();
    const second = markWorkbenchNotAdded(db, {
      actor: { kind: "system", id: "legacy_backfill" },
      reason: "no_messages",
      sessionId: "session:1"
    });

    expect(second.activity.activityId).toBe(first.activity.activityId);
    expect(second.activity.eventAt).toBe(first.activity.eventAt);
    expect(second.state.lastActivityAt).toBe(first.state.lastActivityAt);
    expect(second.state.updatedAt).toBe(first.state.updatedAt);
  });

  test("repeated not-added transition ignores later reason changes", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:1", title: "Meaningful work" });

    const first = markWorkbenchNotAdded(db, {
      actor: { kind: "system", id: "legacy_backfill" },
      reason: "no_messages",
      sessionId: "session:1"
    });
    await waitForClockTick();
    const second = markWorkbenchNotAdded(db, {
      actor: { kind: "system", id: "legacy_backfill" },
      reason: "metadata_only",
      sessionId: "session:1"
    });

    expect(second.activity.activityId).toBe(first.activity.activityId);
    expect(second.activity.details).toEqual(first.activity.details);
    expect(second.state.nonPublicationReason).toBe("no_messages");
    expect(second.state.lastActivityAt).toBe(first.state.lastActivityAt);
    expect(second.state.updatedAt).toBe(first.state.updatedAt);
  });

  test("lists only publish-path sessions in the default queue", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:publish", title: "Publish path" });
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:published", title: "Published" });
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:not-added", title: "Not added" });
    ensureWorkbenchSessionState(db, "session:publish");
    markWorkbenchPublished(db, {
      actor: { kind: "system", id: "test" },
      publishedVia: "test",
      sessionId: "session:published"
    });
    markWorkbenchNotAdded(db, {
      actor: { kind: "system", id: "test" },
      reason: "no_messages",
      sessionId: "session:not-added"
    });

    expect(listWorkbenchQueue(db, { limit: 10 }).map((state) => state.sessionId)).toEqual(["session:publish"]);
  });

  test("claims are short-lived and do not change publication state", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:1",
      title: "Meaningful work"
    });
    const before = ensureWorkbenchSessionState(db, "session:1");
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

    const claim = claimWorkbenchSessions(db, {
      claimedBy: "codex",
      expiresAt,
      sessionIds: ["session:1"]
    });

    const after = ensureWorkbenchSessionState(db, "session:1");
    expect(claim.claims).toHaveLength(1);
    expect(after.publicationStatus).toBe(before.publicationStatus);
    expect(after.activeClaim?.claimedBy).toBe("codex");
    expect(after.activeClaim?.expiresAt).toBe(expiresAt);
    expect(after.activeClaim?.claimId).toBe(claim.claims[0].claimId);

    releaseWorkbenchClaim(db, {
      claimId: claim.claims[0].claimId,
      reason: "complete"
    });
    expect(ensureWorkbenchSessionState(db, "session:1").activeClaim).toBeUndefined();
  });

  test("expired claims are not active", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:expired",
      title: "Expired claim"
    });
    claimWorkbenchSessions(db, {
      claimedBy: "codex",
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      sessionIds: ["session:expired"]
    });
    expect(ensureWorkbenchSessionState(db, "session:expired").activeClaim).toBeUndefined();
  });

  test("publish gate reports missing readiness requirements", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:1", title: "Missing readiness" });

    const result = publishWorkbenchSession(db, {
      actor: { kind: "agent", id: "codex" },
      sessionId: "session:1"
    });

    expect(result).toEqual({
      ok: false,
      code: "publication_gate_failed",
      missing: ["transcript", "quality", "session_enrichment", "session_dossier"],
      state: expect.objectContaining({ publicationStatus: "publish_path", sessionId: "session:1" })
    });
  });

  test("publish gate explicitly publishes ready sessions", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:1", title: "Ready session" });
    ensureWorkbenchSessionState(db, "session:1");
    db.prepare(
      `UPDATE workbench_session_state
      SET transcript_status = 'imported',
        quality_status = 'passed'
      WHERE session_id = ?`
    ).run("session:1");
    markWorkbenchSessionEnrichmentSatisfied(db, { actor: { kind: "agent", id: "codex" }, sessionId: "session:1" });
    markWorkbenchArtifactSatisfied(db, { actor: { kind: "agent", id: "codex" }, artifactKind: "session_dossier", sessionId: "session:1" });
    markWorkbenchArtifactSatisfied(db, { actor: { kind: "agent", id: "codex" }, artifactKind: "runbook", sessionId: "session:1" });

    const result = publishWorkbenchSession(db, {
      actor: { kind: "agent", id: "codex" },
      sessionId: "session:1"
    });

    expect(result).toMatchObject({
      ok: true,
      activity: { eventType: "published" },
      state: { publicationStatus: "published", sessionId: "session:1" }
    });
  });

  test("quality pass advances next action toward enrichment", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:q",
      title: "Quality pass"
    });
    ensureWorkbenchSessionState(db, "session:q");
    db.prepare(
      `UPDATE workbench_session_state
       SET transcript_status = 'imported', quality_status = 'unchecked', next_action = 'review_quality'
       WHERE session_id = ?`
    ).run("session:q");

    const result = markWorkbenchQuality(db, {
      actor: { kind: "user", id: "tyler" },
      sessionId: "session:q",
      status: "passed"
    });

    expect(result.state.qualityStatus).toBe("passed");
    expect(result.state.nextAction).toBe("enrich");
    expect(result.activity.eventType).toBe("quality_passed");
  });

  test("quality fail moves session to not_added_to_logbook", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:fail",
      title: "Quality fail"
    });
    ensureWorkbenchSessionState(db, "session:fail");

    const result = markWorkbenchQuality(db, {
      actor: { kind: "user", id: "tyler" },
      sessionId: "session:fail",
      status: "failed",
      reason: "hook_only_noise"
    });

    expect(result.state.qualityStatus).toBe("failed");
    expect(result.state.publicationStatus).toBe("not_added_to_logbook");
    expect(result.state.nonPublicationReason).toBe("hook_only_noise");
    expect(result.activity.eventType).toBe("quality_failed");
  });

  test("quality pass after fail restores publish_path and advances next action", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:recover",
      title: "Quality recover"
    });
    ensureWorkbenchSessionState(db, "session:recover");
    db.prepare(
      `UPDATE workbench_session_state
       SET transcript_status = 'imported', next_action = 'review_quality'
       WHERE session_id = ?`
    ).run("session:recover");

    markWorkbenchQuality(db, {
      actor: { kind: "user", id: "tyler" },
      sessionId: "session:recover",
      status: "failed",
      reason: "hook_only_noise"
    });

    const recovered = markWorkbenchQuality(db, {
      actor: { kind: "user", id: "tyler" },
      sessionId: "session:recover",
      status: "passed"
    });

    expect(recovered.state.qualityStatus).toBe("passed");
    expect(recovered.state.publicationStatus).toBe("publish_path");
    expect(recovered.state.nonPublicationReason).toBeUndefined();
    expect(recovered.state.nextAction).toBe("enrich");
    expect(recovered.activity.eventType).toBe("quality_passed");
  });

  test("quality fail on published session throws and leaves publication unchanged", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:published",
      title: "Already published"
    });
    ensureWorkbenchSessionState(db, "session:published");
    db.prepare(
      `UPDATE workbench_session_state
       SET transcript_status = 'imported',
           quality_status = 'passed',
           session_enrichment_status = 'satisfied',
           session_dossier_status = 'satisfied',
           runbook_status = 'satisfied'
       WHERE session_id = ?`
    ).run("session:published");
    markWorkbenchPublished(db, {
      actor: { kind: "agent", id: "codex" },
      publishedVia: "workbench_publish",
      sessionId: "session:published"
    });

    const before = readWorkbenchSessionState(db, "session:published")!;
    expect(before.publicationStatus).toBe("published");

    expect(() =>
      markWorkbenchQuality(db, {
        actor: { kind: "user", id: "tyler" },
        sessionId: "session:published",
        status: "failed",
        reason: "late_reject"
      })
    ).toThrow("cannot_fail_quality_on_published_session");

    const after = readWorkbenchSessionState(db, "session:published")!;
    expect(after.publicationStatus).toBe("published");
    expect(after.qualityStatus).toBe("passed");
    expect(after.nonPublicationReason).toBeUndefined();
    expect(after.publishedActivityId).toBe(before.publishedActivityId);
  });

  test("enrollWorkbenchSession creates publish_path only when missing", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "running",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:enroll-1",
      title: "Live capture"
    });

    const first = enrollWorkbenchSession(db, {
      actor: { kind: "system", id: "live_ingest" },
      sessionId: "session:enroll-1"
    });
    expect(first.enrolled).toBe(true);
    expect(first.state?.publicationStatus).toBe("publish_path");
    expect(first.state?.nextAction).toBe("check_transcript");

    const second = enrollWorkbenchSession(db, {
      actor: { kind: "system", id: "live_ingest" },
      sessionId: "session:enroll-1"
    });
    expect(second.enrolled).toBe(false);
    expect(second.state?.publicationStatus).toBe("publish_path");
  });

  test("enrollWorkbenchSession does not demote published or not_added", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:pub",
      title: "Published"
    });
    markWorkbenchPublished(db, {
      actor: { kind: "system", id: "test" },
      publishedVia: "test",
      sessionId: "session:pub"
    });
    expect(
      enrollWorkbenchSession(db, { actor: { kind: "user", id: "workbench_ui" }, sessionId: "session:pub" }).enrolled
    ).toBe(false);
    expect(readWorkbenchSessionState(db, "session:pub")?.publicationStatus).toBe("published");

    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:not-added",
      title: "Not added"
    });
    markWorkbenchNotAdded(db, {
      actor: { kind: "system", id: "test" },
      reason: "metadata_only",
      sessionId: "session:not-added"
    });
    expect(
      enrollWorkbenchSession(db, {
        actor: { kind: "user", id: "workbench_ui" },
        sessionId: "session:not-added"
      }).enrolled
    ).toBe(false);
    expect(readWorkbenchSessionState(db, "session:not-added")?.publicationStatus).toBe("not_added_to_logbook");
  });

  test("enrollMissingWorkbenchSessions only touches sessions without state", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "running", model: "gpt-5", project: "Masthead", sessionId: "session:a", title: "A" });
    seedSession(db, { lifecycle: "running", model: "gpt-5", project: "Masthead", sessionId: "session:b", title: "B" });
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:c", title: "C" });
    ensureWorkbenchSessionState(db, "session:b"); // already on path
    markWorkbenchNotAdded(db, {
      actor: { kind: "system", id: "test" },
      reason: "metadata_only",
      sessionId: "session:c"
    });

    const result = enrollMissingWorkbenchSessions(db, {
      actor: { kind: "user", id: "workbench_ui" },
      limit: 100
    });

    expect(result.enrolled).toBe(1);
    expect(result.enrolledSessionIds).toEqual(["session:a"]);
    expect(result.skippedExisting).toBeGreaterThanOrEqual(2);
    expect(readWorkbenchSessionState(db, "session:a")?.publicationStatus).toBe("publish_path");
    expect(readWorkbenchSessionState(db, "session:c")?.publicationStatus).toBe("not_added_to_logbook");
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-workbench-pipeline-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

async function waitForClockTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
