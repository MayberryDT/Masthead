import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { seedSession } from "./sessionTestHelpers.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import {
  claimWorkbenchSessions,
  ensureWorkbenchSessionState,
  listWorkbenchActivity,
  listWorkbenchQueue,
  markWorkbenchArtifactSatisfied,
  markWorkbenchNotAdded,
  markWorkbenchPublished,
  markWorkbenchQuality,
  markWorkbenchSessionEnrichmentSatisfied,
  publishWorkbenchSession,
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
    expect(result.state.nextAction).toBe("none");
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
      missing: ["transcript", "quality", "session_enrichment", "session_dossier", "bug_fix_trace"],
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
    markWorkbenchArtifactSatisfied(db, { actor: { kind: "agent", id: "codex" }, artifactKind: "bug_fix_trace", sessionId: "session:1" });

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
