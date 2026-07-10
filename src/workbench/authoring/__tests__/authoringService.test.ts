import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { WorkbenchAuthoringBundle } from "../../../shared/workbenchAuthoring.ts";
import { seedSession } from "../../../daemon/db/__tests__/sessionTestHelpers.ts";
import { getLogbookArtifactDetail } from "../../../daemon/db/logbookArtifactRepository.ts";
import {
  applySessionArtifact,
  listSessionArtifacts,
  publishSessionArtifact
} from "../../../daemon/db/sessionArtifactRepository.ts";
import {
  claimWorkbenchSessions,
  markWorkbenchNotAdded,
  readWorkbenchSessionState,
  setWorkbenchArtifactApplicability
} from "../../../daemon/db/workbenchPipelineRepository.ts";
import { completeWorkbenchAuthoringRun } from "../../../daemon/db/workbenchAuthoringRepository.ts";
import { getOrCreateDatabaseIdentity, migrateDatabase } from "../../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../../daemon/db/sqlite.ts";
import {
  finishAuthoringRun,
  getAuthoringRunEvidence,
  getAuthoringRunStatus,
  openAuthoringRun,
  submitAuthoringBundle
} from "../authoringService.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Workbench authoring service", () => {
  test("opens selected sessions without a privacy permission gate", async () => {
    const db = await testDb();
    seedSessionWithRedactedEvidence(db, "session:a");

    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });

    expect(opened.run.status).toBe("open");
    expect(opened.run.sessionIds).toEqual(["session:a"]);
    expect(opened.evidence.sessions[0]?.totalItems).toBeGreaterThan(0);
    expect(opened.contract.automaticKinds).toEqual(["runbook", "adr", "incident_timeline"]);
    expect(opened.contract).not.toHaveProperty("permissionRequired");
    expect(readWorkbenchSessionState(db, "session:a")).toMatchObject({
      qualityStatus: "passed",
      transcriptStatus: "available"
    });
    db.close();
  });

  test("refuses the wrong daemon database before claiming sessions", async () => {
    const db = await testDb();
    seedSessionWithRedactedEvidence(db, "session:a");

    expect(() =>
      openAuthoringRun(db, {
        actorId: "codex",
        databaseId: "different-database",
        sessionIds: ["session:a"]
      })
    ).toThrow("database_identity_mismatch");
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_claims").get()).toEqual({ count: 0 });
    db.close();
  });

  test("stores findings without applying artifacts", async () => {
    const db = await readyAuthoringDb();
    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    const enrichmentCount = db.prepare("SELECT COUNT(*) AS count FROM session_enrichments").get();

    const result = submitAuthoringBundle(db, {
      bundle: invalidBundle(opened.run.runId, opened.run.evidenceRevision),
      runId: opened.run.runId
    });

    expect(result.accepted).toBe(false);
    expect(result.run.status).toBe("needs_revision");
    expect(result.findings.length).toBeGreaterThan(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_artifacts").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_enrichments").get()).toEqual(enrichmentCount);
    db.close();
  });

  test("reuses the same run and claims when open is retried", async () => {
    const db = await readyAuthoringDb();
    const input = {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    };

    const first = openAuthoringRun(db, input);
    const second = openAuthoringRun(db, input);

    expect(second.run.runId).toBe(first.run.runId);
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_claims WHERE released_at IS NULL").get()).toEqual({
      count: 1
    });
    db.close();
  });

  test("submit reacquires an expired lease and refuses another actor's live claim", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    const db = await readyAuthoringDb();
    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    expireAuthoringClaims(db, opened.run.runId);

    const renewed = submitAuthoringBundle(db, {
      bundle: invalidBundle(opened.run.runId, opened.run.evidenceRevision),
      runId: opened.run.runId
    });
    expect(Date.parse(renewed.run.claimsExpireAt)).toBeGreaterThan(Date.now());

    const conflictedDb = await readyAuthoringDb();
    const conflictedRun = openAuthoringRun(conflictedDb, {
      actorId: "codex",
      databaseId: testDatabaseId(conflictedDb),
      sessionIds: ["session:a"]
    });
    expireAuthoringClaims(conflictedDb, conflictedRun.run.runId);
    claimWorkbenchSessions(conflictedDb, {
      claimedBy: "other-agent",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sessionIds: ["session:a"]
    });
    expect(() =>
      submitAuthoringBundle(conflictedDb, {
        bundle: invalidBundle(conflictedRun.run.runId, conflictedRun.run.evidenceRevision),
        runId: conflictedRun.run.runId
      })
    ).toThrow("authoring_claim_conflict:session:a");
    db.close();
    conflictedDb.close();
  });

  test("reports status and pages evidence without mutating Workbench state", async () => {
    const db = await readyAuthoringDb();
    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    const before = authoringRowCounts(db);

    expect(getAuthoringRunStatus(db, opened.run.runId)).toEqual({
      evidenceStatus: "current",
      ok: true,
      run: opened.run
    });
    const page = getAuthoringRunEvidence(db, {
      limit: 1,
      runId: opened.run.runId,
      sessionId: "session:a"
    });

    expect(page.evidenceRevision).toBe(opened.run.evidenceRevision);
    expect(page.items).toHaveLength(1);
    expect(authoringRowCounts(db)).toEqual(before);
    expect(() =>
      getAuthoringRunEvidence(db, {
        runId: opened.run.runId,
        sessionId: "session:outside"
      })
    ).toThrow("authoring_session_not_in_run:session:outside");
    db.close();
  });

  test("requires repeat-open recovery when canonical evidence changes", async () => {
    const db = await readyAuthoringDb();
    const input = {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    };
    const opened = openAuthoringRun(db, input);
    submitAuthoringBundle(db, {
      bundle: invalidBundle(opened.run.runId, opened.run.evidenceRevision),
      runId: opened.run.runId
    });
    insertMessage(db, "session:a", "changed", "New canonical evidence arrived.");

    expect(getAuthoringRunStatus(db, opened.run.runId).evidenceStatus).toBe("changed");
    expect(() =>
      getAuthoringRunEvidence(db, {
        runId: opened.run.runId,
        sessionId: "session:a"
      })
    ).toThrow("evidence_revision_changed");

    const reopened = openAuthoringRun(db, input);
    expect(reopened.run).toMatchObject({
      findings: [],
      runId: opened.run.runId,
      status: "open"
    });
    expect(reopened.run).not.toHaveProperty("bundle");
    expect(reopened.run.evidenceRevision).not.toBe(opened.run.evidenceRevision);
    expect(getAuthoringRunEvidence(db, { runId: reopened.run.runId, sessionId: "session:a" }).total).toBeGreaterThan(1);
    db.close();
  });

  test("keeps sparse non-empty canonical evidence on the automatic path with warnings", async () => {
    const db = await readyAuthoringDb();

    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });

    expect(opened.evidence.sessions[0]?.warnings).toContain("Fewer than two canonical messages are available.");
    expect(readWorkbenchSessionState(db, "session:a")).toMatchObject({
      publicationStatus: "publish_path",
      qualityStatus: "passed"
    });
    db.close();
  });

  test("does not weaken an imported transcript while opening authoring", async () => {
    const db = await readyAuthoringDb();
    db.prepare(
      `INSERT INTO workbench_session_state (
        session_id, publication_status, next_action, transcript_status, quality_status,
        session_enrichment_status, session_dossier_status, bug_fix_trace_status, created_at, updated_at
      ) VALUES (?, 'publish_path', 'review_quality', 'imported', 'unchecked', 'missing', 'missing', 'unknown', ?, ?)`
    ).run("session:a", "2026-07-10T11:00:00.000Z", "2026-07-10T11:00:00.000Z");

    openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });

    expect(readWorkbenchSessionState(db, "session:a")?.transcriptStatus).toBe("imported");
    db.close();
  });

  test("does not resurrect an explicitly suppressed session", async () => {
    const db = await readyAuthoringDb();
    markWorkbenchNotAdded(db, {
      actor: { id: "operator", kind: "user" },
      reason: "user_suppressed",
      sessionId: "session:a"
    });
    const stateBeforeOpen = readWorkbenchSessionState(db, "session:a");
    const activityCountBeforeOpen = db.prepare("SELECT COUNT(*) AS count FROM workbench_activity").get();

    expect(() =>
      openAuthoringRun(db, {
        actorId: "codex",
        databaseId: testDatabaseId(db),
        sessionIds: ["session:a"]
      })
    ).toThrow("authoring_session_not_on_publish_path:session:a");

    expect(readWorkbenchSessionState(db, "session:a")).toEqual(stateBeforeOpen);
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_activity").get()).toEqual(activityCountBeforeOpen);
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_claims").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_authoring_runs").get()).toEqual({ count: 0 });
    db.close();
  });

  test("rejects sessions with no usable canonical redacted evidence", async () => {
    const db = await readyAuthoringDb();
    clearCanonicalEvidence(db, "session:a");

    expect(() =>
      openAuthoringRun(db, {
        actorId: "codex",
        databaseId: testDatabaseId(db),
        sessionIds: ["session:a"]
      })
    ).toThrow("missing_canonical_evidence:session:a");
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_claims").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_session_state").get()).toEqual({ count: 0 });
    db.close();
  });

  test("rejects canonical evidence containing only redaction wrappers and placeholders", async () => {
    const db = await readyAuthoringDb();
    clearCanonicalEvidence(db, "session:a");
    [
      "password: [SECRET:api_key]",
      "email [SECRET:email]",
      "Authorization: Bearer [SECRET:bearer_token]",
      "X-Api-Key: [SECRET:api_key]",
      "  X-Custom-Header: [SECRET:api_key]",
      "  X-Trace-Id: [SECRET:api_key]",
      '{"headers":{"authorization":"Bearer [SECRET:bearer_token]"},"password":"[SECRET:api_key]"}',
      '{"metadata":"[SECRET:api_key]"}',
      '{"X-Trace-Id":"[SECRET:api_key]"}',
      '{"apiKey":"[SECRET:api_key]"}',
      '{"ApiKey":"[SECRET:api_key]"}',
      '{"privateKey":"[SECRET:private_key]"}',
      [
        "  password: [SECRET:api_key]",
        "  email [SECRET:email]",
        "  X-Custom-Header: [SECRET:api_key]",
        "  Cookie: [SECRET:cookie]"
      ].join("\n")
    ].forEach((text, index) => insertMessage(db, "session:a", `redaction-only-${index}`, text));

    expect(() =>
      openAuthoringRun(db, {
        actorId: "codex",
        databaseId: testDatabaseId(db),
        sessionIds: ["session:a"]
      })
    ).toThrow("missing_canonical_evidence:session:a");
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_claims").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_authoring_runs").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_session_state").get()).toEqual({ count: 0 });
    db.close();
  });

  test("accepts retained semantic prose around a redaction placeholder", async () => {
    const db = await readyAuthoringDb();
    clearCanonicalEvidence(db, "session:a");
    insertMessage(
      db,
      "session:a",
      "semantic-redaction",
      "Deployment failed: password rotation failed after [SECRET:api_key]"
    );

    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });

    expect(opened.run.status).toBe("open");
    expect(readWorkbenchSessionState(db, "session:a")).toMatchObject({
      qualityStatus: "passed",
      transcriptStatus: "available"
    });
    db.close();
  });

  test("accepts punctuation-delimited semantic labels around a redaction placeholder", async () => {
    const db = await readyAuthoringDb();
    clearCanonicalEvidence(db, "session:a");
    insertMessage(db, "session:a", "semantic-label", "password-rotation-failed: [SECRET:api_key]");

    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });

    expect(opened.run.status).toBe("open");
    expect(readWorkbenchSessionState(db, "session:a")?.qualityStatus).toBe("passed");
    db.close();
  });

  test("accepts semantic JSON property names around a redaction placeholder", async () => {
    const db = await readyAuthoringDb();
    clearCanonicalEvidence(db, "session:a");
    insertMessage(db, "session:a", "semantic-json", '{"deploymentFailed":"[SECRET:api_key]"}');

    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });

    expect(opened.run.status).toBe("open");
    expect(readWorkbenchSessionState(db, "session:a")?.qualityStatus).toBe("passed");
    db.close();
  });

  test("accepts a grounded bundle while deferring every artifact and enrichment write", async () => {
    const db = await readyAuthoringDb();
    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    const before = authoringOutputCounts(db);

    const result = submitAuthoringBundle(db, {
      bundle: validBundle(opened.run.runId, opened.run.evidenceRevision, "session:a"),
      runId: opened.run.runId
    });

    expect(result).toMatchObject({ accepted: true, findings: expect.any(Array), ok: true, run: { status: "ready_to_finish" } });
    expect(result.findings.every((finding) => finding.severity === "warning")).toBe(true);
    expect(authoringOutputCounts(db)).toEqual(before);
    db.close();
  });

  test("rejects conflicting explicit artifact signatures before finish", async () => {
    const db = await readyAuthoringDb();
    seedSessionWithRedactedEvidence(db, "session:b");
    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a", "session:b"]
    });
    const first = validBundle(opened.run.runId, opened.run.evidenceRevision, "session:a");
    const second = validBundle(opened.run.runId, opened.run.evidenceRevision, "session:b");
    const firstRunbook = validRunbookDraft("session:a");
    const secondRunbook = validRunbookDraft("session:b");
    firstRunbook.output.signatureKey = "signature:oauth-callback";
    secondRunbook.output.signatureKey = " signature:oauth-callback ";
    const bundle: WorkbenchAuthoringBundle = {
      ...first,
      artifacts: [firstRunbook, secondRunbook],
      notApplicable: [...first.notApplicable, ...second.notApplicable].filter(
        (decision) => decision.kind !== "runbook"
      ),
      sessionPackages: [...first.sessionPackages, ...second.sessionPackages]
    };
    const before = authoringOutputCounts(db);

    const result = submitAuthoringBundle(db, { bundle, runId: opened.run.runId });

    expect(result).toMatchObject({
      accepted: false,
      run: { status: "needs_revision" }
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "duplicate_artifact_signature",
        path: "artifacts[1].output.signatureKey",
        sessionId: "session:b"
      })
    );
    expect(authoringOutputCounts(db)).toEqual(before);
    db.close();
  });

  test("rejects a blank explicit artifact signature before finish", async () => {
    const db = await readyAuthoringDb();
    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    const bundle = validBundle(opened.run.runId, opened.run.evidenceRevision, "session:a");
    bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "runbook");
    const runbook = validRunbookDraft("session:a");
    runbook.output.signatureKey = " \n ";
    bundle.artifacts = [runbook];

    const result = submitAuthoringBundle(db, { bundle, runId: opened.run.runId });

    expect(result).toMatchObject({ accepted: false, run: { status: "needs_revision" } });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "blank_artifact_signature",
        path: "artifacts[0].output.signatureKey",
        sessionId: "session:a"
      })
    );
    expect(authoringOutputCounts(db)).toEqual({ session_artifacts: 0, session_enrichments: 1 });
    db.close();
  });

  test("persists the canonical trimmed artifact signature", async () => {
    const db = await readyAuthoringDb();
    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    const bundle = validBundle(opened.run.runId, opened.run.evidenceRevision, "session:a");
    bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "runbook");
    const runbook = validRunbookDraft("session:a");
    runbook.output.signatureKey = "  signature:atomic-finish  ";
    bundle.artifacts = [runbook];
    expect(submitAuthoringBundle(db, { bundle, runId: opened.run.runId }).accepted).toBe(true);

    finishAuthoringRun(db, { runId: opened.run.runId });

    expect(listSessionArtifacts(db, { artifactKind: "runbook", sessionId: "session:a" })[0]?.signatureKey).toBe(
      "signature:atomic-finish"
    );
    db.close();
  });

  test("finishes once and publishes the complete bundle atomically", async () => {
    const { db, runId } = await submittedAuthoringDb();

    const first = finishAuthoringRun(db, { runId });
    const second = finishAuthoringRun(db, { runId });

    expect(second).toEqual(first);
    expect(first.publishedArtifactIds).toHaveLength(2);
    expect(readWorkbenchSessionState(db, "session:a")).toMatchObject({
      adrStatus: "not_applicable",
      incidentTimelineStatus: "not_applicable",
      resolutionStatus: "automatic_resolved",
      runbookStatus: "published",
      sessionPackageStatus: "published"
    });
    expect(
      db.prepare(
        "SELECT COUNT(*) AS count FROM session_artifacts WHERE status = 'current' AND publication_status = 'published'"
      ).get()
    ).toEqual({ count: 2 });
    expect(listSessionArtifacts(db).map((artifact) => artifact.schemaVersion).sort()).toEqual([
      "runbook-v2",
      "session_dossier-v2"
    ]);
    expect(first.publishedArtifactIds.every((artifactId) => getLogbookArtifactDetail(db, artifactId))).toBe(true);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM workbench_claims WHERE released_at IS NULL").get()
    ).toEqual({ count: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM workbench_activity WHERE event_type = 'authoring_finished'").get()
    ).toEqual({ count: 1 });
    expect(
      db.prepare(
        `SELECT event_type AS eventType
         FROM workbench_activity
         WHERE session_id = 'session:a' AND event_type IN ('runbook_published', 'published')
         ORDER BY rowid`
      ).all()
    ).toEqual([{ eventType: "runbook_published" }, { eventType: "published" }]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 1 });
    db.close();
  });

  test("rolls back every write when visibility verification fails and can retry", async () => {
    const { db, runId } = await submittedAuthoringDb();
    const before = authoringOutputCounts(db);

    expect(() =>
      finishAuthoringRun(db, {
        runId,
        verifyPublished: () => false
      })
    ).toThrow("authoring_finish_visibility_failed");

    expect(authoringOutputCounts(db)).toEqual(before);
    expect(getAuthoringRunStatus(db, runId).run.status).toBe("ready_to_finish");

    const retried = finishAuthoringRun(db, { runId });
    expect(retried.publishedArtifactIds).toHaveLength(2);
    expect(getAuthoringRunStatus(db, runId).run.status).toBe("completed");
    db.close();
  });

  test("marks multi-session artifact seeds published and other provenance contributed", async () => {
    const { db, runId } = await submittedMultiSessionAuthoringDb();

    const receipt = finishAuthoringRun(db, { runId });
    const runbookId = receipt.publishedArtifactIds.find(
      (artifactId) => getLogbookArtifactDetail(db, artifactId)?.capsule.kind === "runbook"
    );

    expect(runbookId).toBeTruthy();
    expect(getLogbookArtifactDetail(db, runbookId!)?.provenanceSessionIds).toEqual(["session:a", "session:b"]);
    expect(readWorkbenchSessionState(db, "session:a")).toMatchObject({
      resolutionStatus: "automatic_resolved",
      runbookStatus: "published"
    });
    expect(readWorkbenchSessionState(db, "session:b")).toMatchObject({
      resolutionStatus: "automatic_resolved",
      runbookStatus: "contributed"
    });
    expect(receipt.contributions).toContainEqual({
      artifactId: runbookId,
      kind: "runbook",
      sessionId: "session:b"
    });
    db.close();
  });

  test("resolves an explicit existing published contribution without republishing it", async () => {
    const db = await readyAuthoringDb();
    const existing = applySessionArtifact(db, {
      artifactKind: "runbook",
      content: { title: "Reuse the published OAuth callback runbook" },
      contentFingerprint: "existing-runbook",
      createdBy: "test",
      evidenceRefs: ["message:session:a:message"],
      provenanceSessionIds: ["session:a"],
      schemaVersion: "runbook-v1",
      sessionId: "session:a",
      title: "Reuse the published OAuth callback runbook",
      validation: { ok: true }
    });
    publishSessionArtifact(db, existing.artifactId);
    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    const bundle = validBundle(opened.run.runId, opened.run.evidenceRevision, "session:a");
    bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "runbook");
    bundle.contributions = [
      { kind: "runbook", publishedArtifactId: existing.artifactId, sessionId: "session:a" }
    ];
    expect(submitAuthoringBundle(db, { bundle, runId: opened.run.runId }).accepted).toBe(true);

    const receipt = finishAuthoringRun(db, { runId: opened.run.runId });

    expect(receipt.publishedArtifactIds).toHaveLength(1);
    expect(receipt.contributions).toEqual([
      { artifactId: existing.artifactId, kind: "runbook", sessionId: "session:a" }
    ]);
    expect(readWorkbenchSessionState(db, "session:a")).toMatchObject({
      resolutionStatus: "automatic_resolved",
      runbookStatus: "contributed"
    });
    expect(getLogbookArtifactDetail(db, existing.artifactId)).toBeTruthy();
    db.close();
  });

  test("rejects changed evidence at finish without applying outputs", async () => {
    const { db, runId } = await submittedAuthoringDb();
    const before = authoringOutputCounts(db);
    insertMessage(db, "session:a", "changed-after-submit", "Canonical evidence changed after submission.");

    expect(() => finishAuthoringRun(db, { runId })).toThrow("evidence_revision_changed");

    expect(authoringOutputCounts(db)).toEqual(before);
    expect(getAuthoringRunStatus(db, runId).run.status).toBe("ready_to_finish");
    db.close();
  });

  test("rolls back finish claim reacquisition when another actor owns a selected session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    const { db, runId } = await submittedAuthoringDb();
    expireAuthoringClaims(db, runId);
    claimWorkbenchSessions(db, {
      claimedBy: "other-agent",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sessionIds: ["session:a"]
    });
    const beforeClaims = runClaimRows(db, runId);

    expect(() => finishAuthoringRun(db, { runId })).toThrow("authoring_claim_conflict:session:a");

    expect(runClaimRows(db, runId)).toEqual(beforeClaims);
    expect(authoringOutputCounts(db)).toEqual({ session_artifacts: 0, session_enrichments: 1 });
    expect(getAuthoringRunStatus(db, runId).run.status).toBe("ready_to_finish");
    db.close();
  });

  test("rolls back partial claim reacquisition when any run session conflicts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    const db = await readyAuthoringDb();
    seedSessionWithRedactedEvidence(db, "session:b");
    const opened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a", "session:b"]
    });
    expireAuthoringClaims(db, opened.run.runId);
    claimWorkbenchSessions(db, {
      claimedBy: "other-agent",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sessionIds: ["session:b"]
    });
    const claimsBeforeSubmit = runClaimRows(db, opened.run.runId);

    expect(() =>
      submitAuthoringBundle(db, {
        bundle: invalidBundle(opened.run.runId, opened.run.evidenceRevision),
        runId: opened.run.runId
      })
    ).toThrow("authoring_claim_conflict:session:b");
    expect(runClaimRows(db, opened.run.runId)).toEqual(claimsBeforeSubmit);
    db.close();
  });

  test("returns a completed exact-set run unchanged", async () => {
    const db = await readyAuthoringDb();
    const input = {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    };
    const opened = openAuthoringRun(db, input);
    completeWorkbenchAuthoringRun(db, {
      receipt: {
        completedAt: "2026-07-10T12:30:00.000Z",
        contributions: [],
        notApplicable: [],
        publishedArtifactIds: [],
        resolvedSessionIds: ["session:a"],
        runId: opened.run.runId
      },
      runId: opened.run.runId
    });

    const reopened = openAuthoringRun(db, input);

    expect(reopened.run).toMatchObject({
      completedAt: "2026-07-10T12:30:00.000Z",
      runId: opened.run.runId,
      status: "completed"
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_authoring_runs").get()).toEqual({ count: 1 });
    db.close();
  });

  test("returns a completed receipt without rewriting later suppression", async () => {
    const db = await readyAuthoringDb();
    const input = {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    };
    const opened = openAuthoringRun(db, input);
    completeWorkbenchAuthoringRun(db, {
      receipt: {
        completedAt: "2026-07-10T12:30:00.000Z",
        contributions: [],
        notApplicable: [],
        publishedArtifactIds: [],
        resolvedSessionIds: ["session:a"],
        runId: opened.run.runId
      },
      runId: opened.run.runId
    });
    markWorkbenchNotAdded(db, {
      actor: { id: "operator", kind: "user" },
      reason: "user_suppressed",
      sessionId: "session:a"
    });
    const stateBeforeOpen = readWorkbenchSessionState(db, "session:a");
    const rowsBeforeOpen = authoringRowCounts(db);

    const reopened = openAuthoringRun(db, input);

    expect(reopened.run).toMatchObject({
      receipt: { runId: opened.run.runId },
      runId: opened.run.runId,
      status: "completed"
    });
    expect(readWorkbenchSessionState(db, "session:a")).toEqual(stateBeforeOpen);
    expect(authoringRowCounts(db)).toEqual(rowsBeforeOpen);
    db.close();
  });

  test("returns a completed receipt without reopening changed placeholder-only evidence", async () => {
    const db = await readyAuthoringDb();
    const input = {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    };
    const opened = openAuthoringRun(db, input);
    completeWorkbenchAuthoringRun(db, {
      receipt: {
        completedAt: "2026-07-10T12:30:00.000Z",
        contributions: [],
        notApplicable: [],
        publishedArtifactIds: [],
        resolvedSessionIds: ["session:a"],
        runId: opened.run.runId
      },
      runId: opened.run.runId
    });
    clearCanonicalEvidence(db, "session:a");
    insertMessage(db, "session:a", "redaction-only", "[SECRET:private_key]");
    const rowsBeforeOpen = authoringRowCounts(db);

    const reopened = openAuthoringRun(db, input);

    expect(reopened.run).toMatchObject({
      receipt: { runId: opened.run.runId },
      runId: opened.run.runId,
      status: "completed"
    });
    expect(authoringRowCounts(db)).toEqual(rowsBeforeOpen);
    db.close();
  });
});

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-authoring-service-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

async function readyAuthoringDb(): Promise<MastheadDatabase> {
  const db = await testDb();
  seedSessionWithRedactedEvidence(db, "session:a");
  return db;
}

async function submittedAuthoringDb(): Promise<{ db: MastheadDatabase; runId: string }> {
  const db = await readyAuthoringDb();
  const opened = openAuthoringRun(db, {
    actorId: "codex",
    databaseId: testDatabaseId(db),
    sessionIds: ["session:a"]
  });
  const bundle = validBundle(opened.run.runId, opened.run.evidenceRevision, "session:a");
  bundle.notApplicable = bundle.notApplicable.filter((decision) => decision.kind !== "runbook");
  bundle.artifacts = [validRunbookDraft("session:a")];
  const submitted = submitAuthoringBundle(db, { bundle, runId: opened.run.runId });
  expect(submitted.accepted).toBe(true);
  return { db, runId: opened.run.runId };
}

async function submittedMultiSessionAuthoringDb(): Promise<{ db: MastheadDatabase; runId: string }> {
  const db = await readyAuthoringDb();
  seedSessionWithRedactedEvidence(db, "session:b");
  setWorkbenchArtifactApplicability(db, {
    actor: { kind: "agent", id: "earlier-run" },
    artifactKind: "runbook",
    reason: "Earlier evidence did not support a shared runbook.",
    sessionId: "session:b",
    status: "not_applicable"
  });
  const opened = openAuthoringRun(db, {
    actorId: "codex",
    databaseId: testDatabaseId(db),
    sessionIds: ["session:a", "session:b"]
  });
  const first = validBundle(opened.run.runId, opened.run.evidenceRevision, "session:a");
  const second = validBundle(opened.run.runId, opened.run.evidenceRevision, "session:b");
  const bundle: WorkbenchAuthoringBundle = {
    ...first,
    artifacts: [validRunbookDraft("session:a", ["session:a", "session:b"])],
    notApplicable: [...first.notApplicable, ...second.notApplicable].filter(
      (decision) => decision.kind !== "runbook"
    ),
    sessionPackages: [...first.sessionPackages, ...second.sessionPackages]
  };
  const submitted = submitAuthoringBundle(db, { bundle, runId: opened.run.runId });
  expect(submitted.accepted).toBe(true);
  return { db, runId: opened.run.runId };
}

function seedSessionWithRedactedEvidence(db: MastheadDatabase, sessionId: string): void {
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId,
    title: `Authoring ${sessionId}`
  });
}

function testDatabaseId(db: MastheadDatabase): string {
  return getOrCreateDatabaseIdentity(db);
}

function invalidBundle(runId: string, evidenceRevision: string): WorkbenchAuthoringBundle {
  return {
    artifacts: [],
    bundleVersion: "workbench-authoring-v1",
    contributions: [],
    evidenceRevision,
    notApplicable: [],
    runId,
    sessionPackages: []
  };
}

function validBundle(runId: string, evidenceRevision: string, sessionId: string): WorkbenchAuthoringBundle {
  const evidenceRef = `message:${sessionId}:message`;
  const missingEvidence = ["Only one user-authored message is available for this session."];
  return {
    artifacts: [],
    bundleVersion: "workbench-authoring-v1",
    contributions: [],
    evidenceRevision,
    notApplicable: (["runbook", "adr", "incident_timeline"] as const).map((kind) => ({
      evidenceRefs: [evidenceRef],
      kind,
      reason: "The reviewed session evidence does not support this optional artifact kind.",
      sessionId
    })),
    runId,
    sessionPackages: [
      {
        dossier: {
          approach: ["Inspect the canonical redacted evidence and preserve its grounded outcome."],
          claimEvidence: [
            { evidenceRefs: [evidenceRef], path: "keyDecisions[0]" },
            { evidenceRefs: [evidenceRef], path: "outcome" },
            { evidenceRefs: [evidenceRef], path: "verification[0]" }
          ],
          commandsAndTools: [],
          confidence: "low",
          context: "A daemon-owned authoring run selected this canonical session.",
          evidenceRefs: [evidenceRef],
          filesTouched: [],
          keyDecisions: ["Keep daemon-owned authoring grounded in canonical redacted evidence."],
          lessonsLearned: ["Sparse evidence must remain explicit in the authored output."],
          missingEvidence,
          outcome: "The authoring service accepted a complete grounded session package.",
          problemStatement: "Validate the daemon-owned authoring submission boundary.",
          risksOrGaps: ["Only sparse canonical message coverage is available."],
          title: "Validate daemon-owned authoring",
          verification: ["The focused authoring service contract test passed."]
        },
        enrichment: {
          claimEvidence: [{ evidenceRefs: [evidenceRef], path: "summary" }],
          confidence: "low",
          evidenceRefs: [evidenceRef],
          missingEvidence,
          searchPhrases: ["daemon-owned Workbench authoring"],
          summary: "The daemon validated and stored one grounded authoring bundle without applying outputs.",
          technologies: ["TypeScript", "SQLite"],
          title: "Validate daemon-owned authoring",
          topics: ["Workbench", "artifact authoring"]
        },
        sessionId
      }
    ]
  };
}

function validRunbookDraft(
  sessionId: string,
  provenanceSessionIds: string[] = [sessionId]
): WorkbenchAuthoringBundle["artifacts"][number] {
  const messageRef = `message:${sessionId}:message`;
  const toolResultRef = `tool_result:${sessionId}:tool-result`;
  return {
    kind: "runbook",
    output: {
      changedFiles: ["src/workbench/authoring/authoringService.ts"],
      claimEvidence: [
        { evidenceRefs: [messageRef], path: "fixSteps[0]" },
        { evidenceRefs: [messageRef], path: "rootCause" },
        { evidenceRefs: [toolResultRef], path: "validationChecks[0]" }
      ],
      commands: ["npm test"],
      confidence: "low",
      deadEnds: [],
      environmentRequirements: ["Node.js"],
      evidenceRefs: [messageRef, toolResultRef],
      fixSteps: ["Finish the accepted bundle inside one database transaction."],
      ...(provenanceSessionIds.length > 1
        ? { joinRationale: "Both sessions share the same OAuth callback failure and atomic finish revision." }
        : {}),
      missingEvidence: ["Only sparse canonical evidence is available for this session."],
      preconditions: ["A ready-to-finish authoring run exists."],
      preventionNotes: ["Keep atomic finish covered by a rollback regression test."],
      problemSignature: {
        affectedScope: "Workbench authoring finish",
        errorStrings: ["authoring_finish_visibility_failed"],
        symptoms: ["Partial authoring writes could survive a failed finish"]
      },
      provenanceSessionIds,
      reproSteps: ["Fail published-artifact visibility verification during finish."],
      risksOrGaps: [],
      rootCause: "Finish did not yet own every publication write in one transaction.",
      title: "Finish authoring bundles atomically",
      validationChecks: ["Focused authoring service tests pass."]
    },
    provenanceSessionIds,
    seedSessionId: sessionId
  };
}

function expireAuthoringClaims(db: MastheadDatabase, runId: string): void {
  db.prepare(
    `UPDATE workbench_claims
     SET expires_at = ?
     WHERE claim_id IN (
       SELECT claim_id FROM workbench_authoring_run_sessions WHERE run_id = ?
     )`
  ).run(new Date(Date.now() - 1_000).toISOString(), runId);
}

function insertMessage(db: MastheadDatabase, sessionId: string, suffix: string, text: string): void {
  db.prepare(
    `INSERT INTO messages (
      message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
    ) VALUES (?, ?, 'assistant', ?, ?, ?, '{}', 'authoritative')`
  ).run(`${sessionId}:message:${suffix}`, sessionId, text, `${sessionId}:hash:${suffix}`, "2026-07-10T12:15:00.000Z");
}

function clearCanonicalEvidence(db: MastheadDatabase, sessionId: string): void {
  for (const table of ["messages", "tool_results", "tool_calls", "file_effects", "checkpoints", "runtime_signals"]) {
    db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId);
  }
}

function authoringRowCounts(db: MastheadDatabase): Record<string, number> {
  return Object.fromEntries(
    ["workbench_claims", "workbench_activity", "workbench_session_state", "workbench_authoring_runs"].map((table) => [
      table,
      (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
    ])
  );
}

function authoringOutputCounts(db: MastheadDatabase): Record<string, number> {
  return Object.fromEntries(
    ["session_artifacts", "session_enrichments"].map((table) => [
      table,
      (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
    ])
  );
}

function runClaimRows(db: MastheadDatabase, runId: string): Array<{ claimId: string; expiresAt: string; releasedAt: string | null }> {
  return db
    .prepare(
      `SELECT claims.claim_id AS claimId, claims.expires_at AS expiresAt, claims.released_at AS releasedAt
       FROM workbench_authoring_run_sessions AS run_sessions
       JOIN workbench_claims AS claims ON claims.claim_id = run_sessions.claim_id
       WHERE run_sessions.run_id = ?
       ORDER BY run_sessions.ordinal`
    )
    .all(runId) as Array<{ claimId: string; expiresAt: string; releasedAt: string | null }>;
}
