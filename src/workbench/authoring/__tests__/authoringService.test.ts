import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  WorkbenchAuthoringBundle,
  WorkbenchAuthoringBundleV2,
  WorkbenchAuthoringReceipt,
  WorkbenchAuthoringReceiptV2,
  WorkbenchClaimSupport
} from "../../../shared/workbenchAuthoring.ts";
import { seedSession } from "../../../daemon/db/__tests__/sessionTestHelpers.ts";
import { getLogbookArtifactDetail } from "../../../daemon/db/logbookArtifactRepository.ts";
import { getSessionDossier } from "../../../daemon/db/sessionDossierRepository.ts";
import {
  applySessionArtifact,
  getSessionArtifact,
  listSessionArtifacts,
  publishSessionArtifact,
  searchPublishedArtifactCapsules
} from "../../../daemon/db/sessionArtifactRepository.ts";
import {
  getWorkbenchArtifactCandidate,
  type StoredWorkbenchArtifactCandidate
} from "../../../daemon/db/workbenchArtifactCandidateRepository.ts";
import {
  claimWorkbenchSessions,
  markContributionSatisfactionForProvenance,
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
  openCandidateAuthoringRun,
  openAuthoringRun,
  publishCanonicalDossiers,
  submitAuthoringBundle
} from "../authoringService.ts";
import { discoverArtifactCandidates } from "../artifactCandidates.ts";
import { buildPublishedDossierSnapshot } from "../dossierSnapshot.ts";
import { seedDurableArtifactCorpus } from "../__fixtures__/durableArtifactCorpus.ts";

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

  test("repeat open reacquires an expired current-revision claim before returning the reusable run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    const db = await readyAuthoringDb();
    const input = {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    };
    const opened = openAuthoringRun(db, input);
    const expiredClaimId = opened.run.claimIds[0];
    expireAuthoringClaims(db, opened.run.runId);

    const reopened = openAuthoringRun(db, input);

    expect(reopened.run.runId).toBe(opened.run.runId);
    expect(reopened.run.claimIds[0]).not.toBe(expiredClaimId);
    expect(Date.parse(reopened.run.claimsExpireAt)).toBeGreaterThan(Date.now());
    db.close();
  });

  test("repeat open reports a stable conflict when another actor owns the expired run session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    const db = await readyAuthoringDb();
    const input = {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    };
    const opened = openAuthoringRun(db, input);
    expireAuthoringClaims(db, opened.run.runId);
    claimWorkbenchSessions(db, {
      claimedBy: "other-agent",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sessionIds: ["session:a"]
    });

    expect(() => openAuthoringRun(db, input)).toThrow("authoring_claim_conflict:session:a");
    expect(getAuthoringRunStatus(db, opened.run.runId).run.claimIds).toEqual(opened.run.claimIds);
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

  test("rolls back a historical duplicate-signature finish without changing the durable run", async () => {
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
    firstRunbook.output.signatureKey = "signature:historical-ready";
    secondRunbook.output.signatureKey = "  signature:historical-ready  ";
    const historicalBundle: WorkbenchAuthoringBundle = {
      ...first,
      artifacts: [firstRunbook, secondRunbook],
      notApplicable: [...first.notApplicable, ...second.notApplicable].filter(
        (decision) => decision.kind !== "runbook"
      ),
      sessionPackages: [...first.sessionPackages, ...second.sessionPackages]
    };
    db.prepare(
      `UPDATE workbench_authoring_runs
       SET status = 'ready_to_finish', bundle_json = ?, findings_json = '[]'
       WHERE run_id = ?`
    ).run(JSON.stringify(historicalBundle), opened.run.runId);
    expireAuthoringClaims(db, opened.run.runId);
    const runBeforeFinish = getAuthoringRunStatus(db, opened.run.runId).run;
    const claimsBeforeFinish = runClaimRows(db, opened.run.runId);
    const outputsBeforeFinish = authoringOutputCounts(db);

    expect(() => finishAuthoringRun(db, { runId: opened.run.runId })).toThrow(
      "authoring_run_needs_revision:duplicate_artifact_signature"
    );

    expect(getAuthoringRunStatus(db, opened.run.runId).run).toEqual(runBeforeFinish);
    expect(runClaimRows(db, opened.run.runId)).toEqual(claimsBeforeFinish);
    expect(authoringOutputCounts(db)).toEqual(outputsBeforeFinish);

    secondRunbook.output.signatureKey = "signature:historical-ready-b";
    expect(
      submitAuthoringBundle(db, {
        bundle: { ...historicalBundle, artifacts: [firstRunbook, secondRunbook] },
        runId: opened.run.runId
      }).accepted
    ).toBe(true);
    db.close();
  });

  test("finishes once and publishes the complete bundle atomically", async () => {
    const { db, runId } = await submittedAuthoringDb();
    const canonicalBeforeFinish = getSessionDossier(db, "session:a")!;

    const first = finishAuthoringRun(db, { runId });
    const second = finishAuthoringRun(db, { runId });

    expect(second).toEqual(first);
    expect(first.contractVersion).toBe("workbench-authoring-v1");
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
      "canonical-session-dossier-v1",
      "runbook-v2",
    ]);
    const dossier = listSessionArtifacts(db, {
      artifactKind: "session_dossier",
      sessionId: "session:a"
    })[0]!;
    expect(omitCapturedAt(dossier.content)).toEqual(
      omitCapturedAt(buildPublishedDossierSnapshot(canonicalBeforeFinish))
    );
    expect(dossier.createdBy).toBe("workbench_authoring_v2:codex");
    expect(first.publishedArtifactIds.every((artifactId) => getLogbookArtifactDetail(db, artifactId))).toBe(true);
    expect(
      db
        .prepare(
          `SELECT artifact_id AS artifactId
           FROM session_artifact_search
           ORDER BY artifact_id`
        )
        .all()
    ).toEqual(first.publishedArtifactIds.slice().sort().map((artifactId) => ({ artifactId })));
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
    ).toEqual([{ eventType: "published" }, { eventType: "runbook_published" }]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 1 });
    db.close();
  });

  test("finishes one accepted candidate with one optional artifact and canonical dossiers", async () => {
    const { candidate, db, runId } = await submittedCandidateAuthoringDb();

    const first = requireV2Receipt(finishAuthoringRun(db, { runId }));
    const second = requireV2Receipt(finishAuthoringRun(db, { runId }));

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      candidateId: candidate.candidateId,
      contractVersion: "workbench-authoring-v2",
      contributions: [],
      dossierArtifactIds: expect.any(Array),
      optionalArtifact: { kind: candidate.kind },
      provenanceSessionIds: candidate.provenanceSessionIds,
      resolvedSessionIds: candidate.provenanceSessionIds,
      runId
    });
    expect(first).not.toHaveProperty("notApplicable");
    expect(first.dossierArtifactIds).toHaveLength(candidate.provenanceSessionIds.length);
    expect(first.publishedArtifactIds).toEqual([
      ...first.dossierArtifactIds!,
      first.optionalArtifact!.artifactId
    ]);
    expect(getWorkbenchArtifactCandidate(db, candidate.candidateId)?.status).toBe("published");
    expect(getLogbookArtifactDetail(db, first.optionalArtifact!.artifactId)).toMatchObject({
      capsule: { kind: candidate.kind },
      provenanceSessionIds: candidate.provenanceSessionIds,
      publicationStatus: "published",
      status: "current"
    });
    for (const sessionId of candidate.provenanceSessionIds) {
      expect(listSessionArtifacts(db, { artifactKind: "session_dossier", sessionId })).toEqual([
        expect.objectContaining({ publicationStatus: "published", status: "current" })
      ]);
      expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
        adrStatus: "unknown",
        incidentTimelineStatus: "unknown",
        publicationStatus: "published",
        runbookStatus: sessionId === candidate.seedSessionId ? "published" : "contributed",
        sessionDossierStatus: "satisfied",
        sessionPackageStatus: "published"
      });
    }
    expect(
      db.prepare(
        `SELECT COUNT(*) AS count
         FROM workbench_activity
         WHERE event_type LIKE '%_not_applicable'`
      ).get()
    ).toEqual({ count: 0 });
    db.close();
  });

  test("refuses to finish a positive candidate without its accepted artifact", async () => {
    const { db, runId } = await submittedCandidateAuthoringDb();
    const stored = getAuthoringRunStatus(db, runId).run.bundle as WorkbenchAuthoringBundleV2;
    const { artifact: _artifact, ...withoutArtifact } = stored;
    db.prepare("UPDATE workbench_authoring_runs SET bundle_json = ? WHERE run_id = ?").run(
      JSON.stringify(withoutArtifact),
      runId
    );

    expect(() => finishAuthoringRun(db, { runId })).toThrow("candidate_artifact_required");
    expect(getAuthoringRunStatus(db, runId).run.status).toBe("ready_to_finish");
    expect(listSessionArtifacts(db)).toEqual([]);
    db.close();
  });

  test("does not let an unsigned candidate invent lineage or supersede a signed artifact", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const unrelated = applySessionArtifact(db, {
      artifactKind: "runbook",
      content: { title: "Unrelated signed runbook" },
      contentFingerprint: "unrelated-signed-runbook",
      createdBy: "test",
      evidenceRefs: ["message:dossier-question:1"],
      provenanceSessionIds: ["session:dossier-question"],
      schemaVersion: "runbook-v2",
      sessionId: "session:dossier-question",
      signatureKey: "signature:unrelated",
      title: "Unrelated signed runbook",
      validation: { ok: true }
    });
    publishSessionArtifact(db, unrelated.artifactId);
    const candidate = discoverArtifactCandidates(db, ["session:oauth-fixed"]).find(
      (entry) => entry.kind === "runbook"
    )!;
    expect(candidate.signatureKey).toBeUndefined();
    const opened = openCandidateAuthoringRun(db, {
      actorId: "codex",
      candidateId: candidate.candidateId,
      databaseId: testDatabaseId(db)
    });
    const bundle = validCandidateBundle(opened.run, candidate);
    bundle.artifact.output.signatureKey = "signature:unrelated";

    expect(() => submitAuthoringBundle(db, { bundle, runId: opened.run.runId })).toThrow(
      "authoring_candidate_signature_mismatch"
    );
    expect(getWorkbenchArtifactCandidate(db, candidate.candidateId)?.status).toBe("claimed");
    expect(listSessionArtifacts(db).find(({ artifactId }) => artifactId === unrelated.artifactId)).toMatchObject({
      publicationStatus: "published",
      status: "current"
    });
    db.close();
  });

  test("reauthoring a changed candidate revision supersedes the old signature and search hit", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const candidate = discoverArtifactCandidates(db, ["session:repeated-error:1", "session:repeated-error:2"]).find(
      (entry) => entry.kind === "runbook" && entry.provenanceSessionIds.length === 2
    )!;
    expect(candidate.signatureKey).toBeTruthy();
    const opened = openCandidateAuthoringRun(db, {
      actorId: "codex",
      candidateId: candidate.candidateId,
      databaseId: testDatabaseId(db)
    });
    const firstSubmitted = submitAuthoringBundle(db, {
      bundle: validCandidateBundle(opened.run, candidate),
      runId: opened.run.runId
    });
    expect(firstSubmitted.accepted, JSON.stringify(firstSubmitted.findings, null, 2)).toBe(true);
    const firstOutput = (firstSubmitted.run.bundle as WorkbenchAuthoringBundleV2).artifact.output;
    const first = requireV2Receipt(finishAuthoringRun(db, { runId: opened.run.runId }));
    const firstOptionalId = first.optionalArtifact!.artifactId;

    insertMessage(
      db,
      candidate.seedSessionId,
      "candidate-revision",
      "Additional canonical context was captured after the first artifact publication."
    );
    const revisedCandidate = discoverArtifactCandidates(db, candidate.provenanceSessionIds).find(
      (entry) => entry.kind === candidate.kind && entry.status === "pending"
    )!;
    expect(revisedCandidate).toBeDefined();
    expect(revisedCandidate.candidateId).not.toBe(candidate.candidateId);
    const revised = openCandidateAuthoringRun(db, {
      actorId: "codex",
      candidateId: revisedCandidate.candidateId,
      databaseId: testDatabaseId(db)
    });
    const revisedBundle = validCandidateBundle(revised.run, revisedCandidate);
    expect(revisedBundle.artifact.output).toEqual(firstOutput);
    const revisedSubmitted = submitAuthoringBundle(db, { bundle: revisedBundle, runId: revised.run.runId });
    expect(revisedSubmitted.accepted, JSON.stringify(revisedSubmitted.findings, null, 2)).toBe(true);

    const second = requireV2Receipt(finishAuthoringRun(db, { runId: revised.run.runId }));

    expect(listSessionArtifacts(db).find(({ artifactId }) => artifactId === firstOptionalId)?.status).toBe(
      "superseded"
    );
    expect(second.optionalArtifact!.artifactId).not.toBe(firstOptionalId);
    expect(getSessionArtifact(db, second.optionalArtifact.artifactId)?.validation).toMatchObject({
      candidateId: revisedCandidate.candidateId,
      evidenceRevision: revisedCandidate.evidenceRevision
    });
    expect(
      searchPublishedArtifactCapsules(db, { q: "command not found", kind: "runbook" }).artifacts.map(
        ({ artifactId }) => artifactId
      )
    ).toEqual([second.optionalArtifact!.artifactId]);
    expect(
      db.prepare("SELECT artifact_id AS artifactId FROM session_artifact_search WHERE artifact_id = ?").all(firstOptionalId)
    ).toEqual([]);
    db.close();
  });

  test("rolls back candidate finish after every mutation boundary", async () => {
    const boundaries = [
      "canonical_dossiers_published",
      "optional_artifact_applied",
      "optional_artifact_published",
      "pipeline_updated",
      "search_indexed",
      "candidate_published",
      "claims_released",
      "activities_recorded",
      "receipt_persisted"
    ];

    for (const target of boundaries) {
      const { db, runId } = await submittedCandidateAuthoringDb();
      const before = candidateFinishRows(db);

      expect(() =>
        finishAuthoringRun(db, {
          onMutationBoundary: (boundary: string) => {
            if (boundary === target) throw new Error(`injected_finish_failure:${target}`);
          },
          runId
        })
      ).toThrow(`injected_finish_failure:${target}`);

      expect(candidateFinishRows(db)).toEqual(before);
      expect(getAuthoringRunStatus(db, runId).run.status).toBe("ready_to_finish");
      db.close();
    }
  });

  test("publishes canonical dossiers in one bounded atomic idempotent batch", async () => {
    const db = await testDb();
    seedSessionWithRedactedEvidence(db, "session:a");
    seedSessionWithRedactedEvidence(db, "session:b");
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-12T18:00:00.000Z");

    const first = publishCanonicalDossiers(db, {
      actorId: "recovery",
      sessionIds: ["session:a", "session:b"]
    });
    const artifactsAfterFirst = listSessionArtifacts(db);
    const activitiesAfterFirst = db
      .prepare("SELECT * FROM workbench_activity ORDER BY activity_id")
      .all();
    vi.setSystemTime("2026-07-12T19:00:00.000Z");
    const second = publishCanonicalDossiers(db, {
      actorId: "recovery",
      sessionIds: ["session:a", "session:b"]
    });

    expect(second).toEqual(first);
    expect(first.sessionIds).toEqual(["session:a", "session:b"]);
    expect(first.artifactIds).toHaveLength(2);
    expect(listSessionArtifacts(db, { publicationStatus: "published" })).toHaveLength(2);
    for (const sessionId of first.sessionIds) {
      expect(readWorkbenchSessionState(db, sessionId)).toMatchObject({
        nextAction: "none",
        publicationStatus: "published",
        resolutionStatus: "automatic_resolved",
        sessionPackageStatus: "published"
      });
    }
    expect(listSessionArtifacts(db)).toEqual(artifactsAfterFirst);
    expect(db.prepare("SELECT * FROM workbench_activity ORDER BY activity_id").all()).toEqual(
      activitiesAfterFirst
    );

    const beforeFailure = listSessionArtifacts(db);
    const stateBeforeFailure = [
      readWorkbenchSessionState(db, "session:a"),
      readWorkbenchSessionState(db, "session:b")
    ];
    const activityBeforeFailure = db
      .prepare("SELECT * FROM workbench_activity ORDER BY activity_id")
      .all();
    expect(() =>
      publishCanonicalDossiers(db, {
        actorId: "recovery",
        sessionIds: ["session:a", "session:missing"]
      })
    ).toThrow("session_not_found:session:missing");
    expect(listSessionArtifacts(db)).toEqual(beforeFailure);
    expect([
      readWorkbenchSessionState(db, "session:a"),
      readWorkbenchSessionState(db, "session:b")
    ]).toEqual(stateBeforeFailure);
    expect(db.prepare("SELECT * FROM workbench_activity ORDER BY activity_id").all()).toEqual(
      activityBeforeFailure
    );
    expect(() =>
      publishCanonicalDossiers(db, {
        actorId: "recovery",
        sessionIds: Array.from({ length: 101 }, (_, index) => `session:${index}`)
      })
    ).toThrow("canonical_dossier_batch_too_large");
    db.close();
  });

  test("rolls back every write when visibility verification fails and can retry", async () => {
    const { db, runId } = await submittedAuthoringDb();
    const before = authoringOutputCounts(db);

    let indexedBeforeFailure = 0;
    expect(() =>
      finishAuthoringRun(db, {
        runId,
        verifyPublished: () => {
          indexedBeforeFailure = (
            db.prepare("SELECT COUNT(*) AS count FROM session_artifact_search").get() as { count: number }
          ).count;
          return false;
        }
      })
    ).toThrow("authoring_finish_visibility_failed");

    expect(indexedBeforeFailure).toBe(2);
    expect(authoringOutputCounts(db)).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_artifact_search").get()).toEqual({ count: 0 });
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

  test("reopens an old session when a later session supersedes its only published signature", async () => {
    const db = await readyAuthoringDb();
    const firstOpened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    const firstBundle = validBundle(firstOpened.run.runId, firstOpened.run.evidenceRevision, "session:a");
    firstBundle.notApplicable = firstBundle.notApplicable.filter((decision) => decision.kind !== "runbook");
    const firstRunbook = validRunbookDraft("session:a");
    firstRunbook.output.signatureKey = "signature:shared-runtime-failure";
    firstBundle.artifacts = [firstRunbook];
    expect(submitAuthoringBundle(db, { bundle: firstBundle, runId: firstOpened.run.runId }).accepted).toBe(true);
    const firstReceipt = finishAuthoringRun(db, { runId: firstOpened.run.runId });
    const oldRunbookId = firstReceipt.publishedArtifactIds.find(
      (artifactId) => getLogbookArtifactDetail(db, artifactId)?.capsule.kind === "runbook"
    )!;

    seedSessionWithRedactedEvidence(db, "session:b");
    const secondOpened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:b"]
    });
    const secondBundle = validBundle(secondOpened.run.runId, secondOpened.run.evidenceRevision, "session:b");
    secondBundle.notApplicable = secondBundle.notApplicable.filter((decision) => decision.kind !== "runbook");
    const replacementRunbook = validRunbookDraft("session:b");
    replacementRunbook.output.signatureKey = "signature:shared-runtime-failure";
    secondBundle.artifacts = [replacementRunbook];
    expect(submitAuthoringBundle(db, { bundle: secondBundle, runId: secondOpened.run.runId }).accepted).toBe(true);

    finishAuthoringRun(db, { runId: secondOpened.run.runId });

    expect(listSessionArtifacts(db).find((artifact) => artifact.artifactId === oldRunbookId)?.status).toBe("superseded");
    expect(readWorkbenchSessionState(db, "session:a")).toMatchObject({
      adrStatus: "not_applicable",
      incidentTimelineStatus: "not_applicable",
      nextAction: "none",
      publicationStatus: "published",
      resolutionStatus: "automatic_resolved",
      runbookStatus: "applied",
      sessionPackageStatus: "published"
    });
    expect(readWorkbenchSessionState(db, "session:b")).toMatchObject({
      resolutionStatus: "automatic_resolved",
      runbookStatus: "published"
    });
    db.close();
  });

  test("preserves an old session's legitimate contribution when another current artifact still satisfies the kind", async () => {
    const db = await readyAuthoringDb();
    const firstOpened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    const firstBundle = validBundle(firstOpened.run.runId, firstOpened.run.evidenceRevision, "session:a");
    firstBundle.notApplicable = firstBundle.notApplicable.filter((decision) => decision.kind !== "runbook");
    const firstRunbook = validRunbookDraft("session:a");
    firstRunbook.output.signatureKey = "signature:shared-runtime-failure";
    firstBundle.artifacts = [firstRunbook];
    expect(submitAuthoringBundle(db, { bundle: firstBundle, runId: firstOpened.run.runId }).accepted).toBe(true);
    const firstReceipt = finishAuthoringRun(db, { runId: firstOpened.run.runId });
    const supersededRunbookId = firstReceipt.publishedArtifactIds.find(
      (artifactId) => getLogbookArtifactDetail(db, artifactId)?.capsule.kind === "runbook"
    )!;

    seedSessionWithRedactedEvidence(db, "session:b");
    const supportingRunbook = applySessionArtifact(db, {
      artifactKind: "runbook",
      content: { title: "A separate current runbook still includes session A" },
      contentFingerprint: "supporting-current-runbook",
      createdBy: "test",
      evidenceRefs: ["message:session:a:message"],
      joinRationale: "Both sessions exhibit the same separately retained setup requirement.",
      provenanceSessionIds: ["session:b", "session:a"],
      schemaVersion: "runbook-v2",
      sessionId: "session:b",
      signatureKey: "signature:separate-current-satisfaction",
      title: "A separate current runbook still includes session A",
      validation: { ok: true }
    });
    publishSessionArtifact(db, supportingRunbook.artifactId);
    markContributionSatisfactionForProvenance(db, {
      actor: { id: "test", kind: "agent" },
      artifactKind: "runbook",
      provenanceSessionIds: ["session:b", "session:a"],
      publishedArtifactId: supportingRunbook.artifactId,
      seedSessionId: "session:b"
    });

    const secondOpened = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:b"]
    });
    const secondBundle = validBundle(secondOpened.run.runId, secondOpened.run.evidenceRevision, "session:b");
    secondBundle.notApplicable = secondBundle.notApplicable.filter((decision) => decision.kind !== "runbook");
    const replacementRunbook = validRunbookDraft("session:b");
    replacementRunbook.output.signatureKey = "signature:shared-runtime-failure";
    secondBundle.artifacts = [replacementRunbook];
    expect(submitAuthoringBundle(db, { bundle: secondBundle, runId: secondOpened.run.runId }).accepted).toBe(true);

    finishAuthoringRun(db, { runId: secondOpened.run.runId });

    expect(listSessionArtifacts(db).find((artifact) => artifact.artifactId === supersededRunbookId)?.status).toBe(
      "superseded"
    );
    expect(readWorkbenchSessionState(db, "session:a")).toMatchObject({
      adrStatus: "not_applicable",
      incidentTimelineStatus: "not_applicable",
      nextAction: "none",
      resolutionStatus: "automatic_resolved",
      runbookStatus: "contributed"
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
        contractVersion: "workbench-authoring-v1",
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
        contractVersion: "workbench-authoring-v1",
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
        contractVersion: "workbench-authoring-v1",
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

async function submittedCandidateAuthoringDb(): Promise<{
  candidate: StoredWorkbenchArtifactCandidate;
  db: MastheadDatabase;
  runId: string;
}> {
  const db = await testDb();
  seedDurableArtifactCorpus(db);
  const candidate = discoverArtifactCandidates(db, ["session:oauth-fixed"]).find(
    (entry) => entry.kind === "runbook"
  )!;
  const opened = openCandidateAuthoringRun(db, {
    actorId: "codex",
    candidateId: candidate.candidateId,
    databaseId: testDatabaseId(db)
  });
  const bundle = validCandidateBundle(opened.run, candidate);
  const submitted = submitAuthoringBundle(db, { bundle, runId: opened.run.runId });
  expect(submitted.accepted, JSON.stringify(submitted.findings, null, 2)).toBe(true);
  return { candidate, db, runId: opened.run.runId };
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

function omitCapturedAt(value: unknown): unknown {
  const { capturedAt: _capturedAt, ...rest } = value as Record<string, unknown>;
  return rest;
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

function validCandidateBundle(
  run: { evidenceRevision: string; runId: string },
  candidate: StoredWorkbenchArtifactCandidate,
  overrides: { changeRef?: string; title?: string } = {}
): WorkbenchAuthoringBundleV2 {
  const failureRef = candidate.signalEvidenceRefs.find((ref) => ref.startsWith("tool_result:"))!;
  const changeRef = overrides.changeRef ?? candidate.signalEvidenceRefs.find((ref) => ref.startsWith("file:"))!;
  const verificationRef = candidate.signalEvidenceRefs.find(
    (ref) => ref.startsWith("checkpoint:") || ref.includes(":verified")
  )!;
  const failureExcerpt = canonicalCandidateExcerpt(failureRef);
  const changeExcerpt = canonicalCandidateExcerpt(changeRef);
  const verificationExcerpt = canonicalCandidateExcerpt(verificationRef);
  const joinSupports: WorkbenchClaimSupport[] = candidate.provenanceSessionIds.length > 1
    ? candidate.provenanceSessionIds.map((sessionId) => {
        const sessionToken = sessionId.replace(/^session:/, "");
        const evidenceRef = candidate.signalEvidenceRefs.find((ref) => ref.includes(sessionToken));
        if (!evidenceRef) throw new Error(`candidate_join_fixture_evidence_missing:${sessionId}`);
        return {
          evidenceRef,
          excerpt: canonicalCandidateExcerpt(evidenceRef),
          path: "joinRationale",
          supportKind: "problem"
        };
      })
    : [];
  return {
    artifact: {
      kind: candidate.kind,
      output: {
        changedFiles: ["auth/callback.ts"],
        claimSupport: [
          {
            evidenceRef: failureRef,
            excerpt: failureExcerpt,
            path: "problemSignature.symptoms[0]",
            supportKind: "problem"
          },
          {
            evidenceRef: failureRef,
            excerpt: failureExcerpt,
            path: "problemSignature.errorStrings[0]",
            supportKind: "problem"
          },
          {
            evidenceRef: failureRef,
            excerpt: failureExcerpt,
            path: "problemSignature.affectedScope",
            supportKind: "problem"
          },
          {
            evidenceRef: failureRef,
            excerpt: failureExcerpt,
            path: "preconditions[0]",
            supportKind: "problem"
          },
          {
            evidenceRef: failureRef,
            excerpt: failureExcerpt,
            path: "reproSteps[0]",
            supportKind: "problem"
          },
          {
            evidenceRef: changeRef,
            excerpt: changeExcerpt,
            path: "fixSteps[0]",
            supportKind: "change"
          },
          {
            evidenceRef: changeRef,
            excerpt: changeExcerpt,
            path: "commands[0]",
            supportKind: "change"
          },
          {
            evidenceRef: changeRef,
            excerpt: changeExcerpt,
            path: "changedFiles[0]",
            supportKind: "change"
          },
          {
            evidenceRef: failureRef,
            excerpt: failureExcerpt,
            path: "environmentRequirements[0]",
            supportKind: "problem"
          },
          {
            evidenceRef: failureRef,
            excerpt: failureExcerpt,
            path: "rootCause",
            supportKind: "root_cause"
          },
          {
            evidenceRef: verificationRef,
            excerpt: verificationExcerpt,
            path: "preventionNotes[0]",
            supportKind: "remediation"
          },
          {
            evidenceRef: verificationRef,
            excerpt: verificationExcerpt,
            path: "validationChecks[0]",
            supportKind: "verification"
          },
          ...joinSupports
        ],
        commands: ["npm test"],
        confidence: "low",
        deadEnds: [],
        environmentRequirements: ["Node.js"],
        evidenceRefs: [...new Set([...candidate.signalEvidenceRefs, changeRef])],
        fixSteps: [`Apply the recorded change: ${changeExcerpt}.`],
        ...(candidate.provenanceSessionIds.length > 1
          ? { joinRationale: "The candidate groups the same normalized failure signature across both sessions." }
          : {}),
        missingEvidence: [],
        preconditions: [`The recorded failure is present: ${failureExcerpt}`],
        preventionNotes: [`Retain the recorded verification: ${verificationExcerpt}`],
        problemSignature: {
          affectedScope: "The candidate's recorded failure scope",
          errorStrings: [failureExcerpt],
          symptoms: [failureExcerpt]
        },
        provenanceSessionIds: candidate.provenanceSessionIds,
        reproSteps: ["Run the OAuth callback regression test."],
        risksOrGaps: [],
        rootCause: failureExcerpt,
        ...(candidate.signatureKey ? { signatureKey: candidate.signatureKey } : {}),
        title: overrides.title ?? "Repair the verified candidate failure",
        validationChecks: [verificationExcerpt]
      },
      provenanceSessionIds: candidate.provenanceSessionIds,
      seedSessionId: candidate.seedSessionId
    },
    bundleVersion: "workbench-authoring-v2",
    candidateId: candidate.candidateId,
    evidenceRevision: run.evidenceRevision,
    runId: run.runId
  };
}

function canonicalCandidateExcerpt(ref: string): string {
  const excerpts: Record<string, string> = {
    "checkpoint:oauth:verified": "Callback regression test passed after the nonce repair.",
    "checkpoint:repeated-error:1:verified": "Remote codex --version check passed.",
    "checkpoint:repeated-error:2:verified": "Remote launcher smoke test passed.",
    "file:oauth:change": "modified auth/callback.ts",
    "file:repeated-error:1:change": "modified shell environment launcher",
    "file:repeated-error:2:change": "modified the remote PATH bootstrap",
    "file:repeated-error:revision-change": "modified remote shell bootstrap retry guard",
    "tool_result:oauth:failure": "OAuth callback test failed with an invalid state nonce.",
    "tool_result:repeated-error:1:failure": "ssh: codex: command not found. ERROR_SIGNATURE: ssh codex command not found",
    "tool_result:repeated-error:2:failure": "ssh: codex: command not found. ERROR_SIGNATURE: SSH / Codex command not found"
  };
  return excerpts[ref] ?? `Canonical evidence excerpt for ${ref}`;
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

function candidateFinishRows(db: MastheadDatabase): Record<string, unknown[]> {
  const tables = [
    "session_artifacts",
    "session_artifact_provenance",
    "session_artifact_search",
    "workbench_artifact_candidates",
    "workbench_session_state",
    "workbench_claims",
    "workbench_activity",
    "workbench_authoring_runs"
  ];
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

function requireV2Receipt(receipt: WorkbenchAuthoringReceipt): WorkbenchAuthoringReceiptV2 {
  if (receipt.contractVersion !== "workbench-authoring-v2") {
    throw new Error(`expected_v2_receipt:${receipt.contractVersion}`);
  }
  return receipt;
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
