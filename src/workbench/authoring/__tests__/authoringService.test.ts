import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  WorkbenchAuthoringBundle,
  WorkbenchAuthoringBundleV2,
  WorkbenchAuthoringBundleV3,
  WorkbenchClaimSupport
} from "../../../shared/workbenchAuthoring.ts";
import { seedSession } from "../../../daemon/db/__tests__/sessionTestHelpers.ts";
import {
  applySessionArtifact,
  getSessionArtifact,
  publishSessionArtifact
} from "../../../daemon/db/sessionArtifactRepository.ts";
import { readCurrentSessionEnrichment } from "../../../daemon/db/enrichmentRepository.ts";
import type { StoredWorkbenchArtifactCandidate } from "../../../daemon/db/workbenchArtifactCandidateRepository.ts";
import {
  claimWorkbenchSessions,
  ensureWorkbenchSessionState,
  markWorkbenchNotAdded,
  readWorkbenchSessionState
} from "../../../daemon/db/workbenchPipelineRepository.ts";
import { completeWorkbenchAuthoringRun } from "../../../daemon/db/workbenchAuthoringRepository.ts";
import { getOrCreateDatabaseIdentity, migrateDatabase } from "../../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../../daemon/db/sqlite.ts";
import {
  finishAuthoringRun,
  getAuthoringRunContext,
  getAuthoringRunEvidence,
  getAuthoringRunStatus,
  openCandidateAuthoringRun,
  openAgentLedAuthoringRun,
  openAuthoringRun,
  submitAuthoringBundle
} from "../authoringService.ts";
import { discoverArtifactCandidates } from "../artifactCandidates.ts";
import { seedDurableArtifactCorpus } from "../__fixtures__/durableArtifactCorpus.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Workbench authoring service", () => {
  test("publishes enrichment-derived canonical dossiers with zero optional artifacts", async () => {
    const db = await readyV3AuthoringDb();
    const opened = openAgentLedAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    const bundle = validV3Bundle(opened.run.runId, opened.run.evidenceRevision);
    expect(submitAuthoringBundle(db, { bundle, runId: opened.run.runId }).accepted).toBe(true);

    const receipt = finishAuthoringRun(db, { runId: opened.run.runId });
    expect(receipt.contractVersion).toBe("workbench-authoring-v3");
    if (receipt.contractVersion !== "workbench-authoring-v3") throw new Error("expected_v3_receipt");
    expect(receipt.optionalArtifacts).toEqual([]);
    const dossier = getSessionArtifact(db, receipt.dossierArtifactIds[0]!)!;
    expect(dossier.content).toMatchObject({
      durableEnrichment: { sessionSummary: { text: "Agent-enriched summary grounded in the selected canonical evidence." } },
      identity: { title: "Agent-enriched title" },
      snapshotVersion: "canonical-session-dossier-v1"
    });
    expect(finishAuthoringRun(db, { runId: opened.run.runId })).toEqual(receipt);
    const reopened = openAgentLedAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    expect(reopened.run).toMatchObject({
      receipt,
      runId: opened.run.runId,
      status: "completed"
    });
    db.close();
  });

  test("rebuilds submitted enrichment evidence refs from canonical daemon evidence", async () => {
    const db = await readyV3AuthoringDb();
    const opened = openAgentLedAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    const bundle = validV3Bundle(opened.run.runId, opened.run.evidenceRevision);
    const submittedRef = bundle.sessionEnrichments[0]!.enrichment.sessionTitle.evidenceRefs[0]!;
    submittedRef.kind = "conflict";
    submittedRef.observedAt = "2099-01-01T00:00:00.000Z";
    submittedRef.source = "forged-agent-metadata";

    expect(submitAuthoringBundle(db, { bundle, runId: opened.run.runId }).accepted).toBe(true);
    finishAuthoringRun(db, { runId: opened.run.runId });

    const enrichment = readCurrentSessionEnrichment(db, "session:a", "session_capsule")!;
    expect(enrichment.sourceRefs).toContainEqual({
      id: "message:session:a:message",
      kind: "event",
      observedAt: "2026-06-25T12:00:00.000Z",
      source: "canonical"
    });
    expect(enrichment.sourceRefs).not.toContainEqual(expect.objectContaining({ source: "forged-agent-metadata" }));
    expect(enrichment.content).toMatchObject({
      durableEnrichment: {
        sessionTitle: {
          evidenceRefs: [{
            id: "message:session:a:message",
            kind: "event",
            observedAt: "2026-06-25T12:00:00.000Z",
            source: "canonical"
          }]
        }
      }
    });
    db.close();
  });

  test("publishes an agent-selected optional artifact without a candidate run", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const candidate = discoverArtifactCandidates(db, ["session:oauth-fixed"]).find((entry) => entry.kind === "runbook")!;
    const opened = openAgentLedAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:oauth-fixed"]
    });
    const bundle = validV3Bundle(
      opened.run.runId,
      opened.run.evidenceRevision,
      "session:oauth-fixed",
      candidate.signalEvidenceRefs.find((ref) => ref.startsWith("tool_result:"))!
    );
    bundle.artifacts = [validCandidateBundle(opened.run, candidate).artifact];
    const submitted = submitAuthoringBundle(db, { bundle, runId: opened.run.runId });
    expect(submitted.accepted, JSON.stringify(submitted.findings, null, 2)).toBe(true);

    const receipt = finishAuthoringRun(db, { runId: opened.run.runId });
    if (receipt.contractVersion !== "workbench-authoring-v3") throw new Error("expected_v3_receipt");
    expect(receipt.optionalArtifacts.map(({ kind }) => kind)).toEqual(["runbook"]);
    expect(getAuthoringRunStatus(db, opened.run.runId).run).not.toHaveProperty("candidateId");
    db.close();
  });

  test("publishes agent-selected runbook and ADR artifacts in one V3 bundle", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const sessionIds = ["session:oauth-fixed", "session:decision-local-first"];
    const candidates = discoverArtifactCandidates(db, sessionIds);
    const runbook = candidates.find((entry) => entry.kind === "runbook")!;
    const adr = candidates.find((entry) => entry.kind === "adr")!;
    const opened = openAgentLedAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds
    });
    const bundle = validV3Bundle(
      opened.run.runId,
      opened.run.evidenceRevision,
      "session:oauth-fixed",
      runbook.signalEvidenceRefs.find((ref) => ref.startsWith("tool_result:"))!
    );
    bundle.sessionEnrichments.push(validV3Bundle(
      opened.run.runId,
      opened.run.evidenceRevision,
      "session:decision-local-first",
      adr.signalEvidenceRefs[0]!
    ).sessionEnrichments[0]!);
    bundle.artifacts = [
      validCandidateBundle(opened.run, runbook).artifact,
      validAdrArtifactDraft(adr)
    ];
    const submitted = submitAuthoringBundle(db, { bundle, runId: opened.run.runId });
    expect(submitted.accepted, JSON.stringify(submitted.findings, null, 2)).toBe(true);

    const receipt = finishAuthoringRun(db, { runId: opened.run.runId });
    if (receipt.contractVersion !== "workbench-authoring-v3") throw new Error("expected_v3_receipt");
    expect(receipt.optionalArtifacts.map(({ kind }) => kind)).toEqual(["runbook", "adr"]);
    expect(receipt.optionalArtifacts.map(({ artifactId }) => getSessionArtifact(db, artifactId)?.artifactKind))
      .toEqual(["runbook", "adr"]);
    db.close();
  });

  test("rejects a duplicate optional artifact even when the matching current artifact is older than 100", async () => {
    const db = await testDb();
    seedDurableArtifactCorpus(db);
    const candidate = discoverArtifactCandidates(db, ["session:oauth-fixed"]).find((entry) => entry.kind === "runbook")!;
    const opened = openAgentLedAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:oauth-fixed"]
    });
    const bundle = validV3Bundle(
      opened.run.runId,
      opened.run.evidenceRevision,
      "session:oauth-fixed",
      candidate.signalEvidenceRefs.find((ref) => ref.startsWith("tool_result:"))!
    );
    bundle.artifacts = [validCandidateBundle(opened.run, candidate).artifact];

    for (let index = 0; index <= 100; index += 1) {
      const sessionId = `session:historical:${index}`;
      seedSession(db, {
        lifecycle: "ended",
        model: "gpt-5",
        project: "Masthead",
        sessionId,
        title: `Historical artifact ${index}`
      });
      const content = index === 0
        ? bundle.artifacts[0]!.output
        : { summary: `Distinct historical summary ${index}`, title: `Distinct historical runbook ${index}` };
      const applied = applySessionArtifact(db, {
        artifactKind: "runbook",
        content,
        contentFingerprint: `historical:${index}`,
        createdBy: "test",
        evidenceRefs: [],
        provenanceSessionIds: [sessionId],
        schemaVersion: "runbook-v2",
        sessionId,
        title: `Historical artifact ${index}`,
        validation: { ok: true }
      });
      const published = publishSessionArtifact(db, applied.artifactId)!;
      db.prepare("UPDATE session_artifacts SET published_at = ?, updated_at = ? WHERE artifact_id = ?").run(
        `2026-07-${String(index === 0 ? 1 : 2 + Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
        `2026-07-${String(index === 0 ? 1 : 2 + Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
        published.artifactId
      );
    }

    const submitted = submitAuthoringBundle(db, { bundle, runId: opened.run.runId });

    expect(submitted.accepted).toBe(false);
    expect(submitted.findings).toContainEqual(expect.objectContaining({ code: "duplicate_human_content" }));
    db.close();
  });

  test("rolls back V3 finish after every mutation boundary", async () => {
    const boundaries = [
      "enrichment_applied",
      "dossiers_created",
      "optional_artifacts_created",
      "artifacts_published",
      "pipeline_updated",
      "claims_released",
      "activities_recorded",
      "receipt_persisted"
    ] as const;
    for (const boundary of boundaries) {
      const { db, runId } = await submittedV3AuthoringDb();
      const before = v3FinishRows(db);
      expect(() => finishAuthoringRun(db, {
        onMutationBoundary: (seen) => {
          if (seen === boundary) throw new Error(`fail_after:${boundary}`);
        },
        runId
      })).toThrow(`fail_after:${boundary}`);
      expect(v3FinishRows(db)).toEqual(before);
      db.close();
    }
  });

  test("keeps V1 and V2 runs readable but refuses mutation through audit-only contracts", async () => {
    const db = await readyAuthoringDb();
    const legacy = openAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    expect(getAuthoringRunStatus(db, legacy.run.runId).run.contractVersion).toBe("workbench-authoring-v1");
    expect(() => submitAuthoringBundle(db, {
      bundle: validBundle(legacy.run.runId, legacy.run.evidenceRevision, "session:a"),
      runId: legacy.run.runId
    })).toThrow("authoring_contract_audit_only");
    expect(() => finishAuthoringRun(db, { runId: legacy.run.runId })).toThrow("authoring_contract_audit_only");
    db.close();

    const v2Db = await testDb();
    seedDurableArtifactCorpus(v2Db);
    const candidate = discoverArtifactCandidates(v2Db, ["session:oauth-fixed"]).find((entry) => entry.kind === "runbook")!;
    const v2 = openCandidateAuthoringRun(v2Db, {
      actorId: "codex",
      candidateId: candidate.candidateId,
      databaseId: testDatabaseId(v2Db)
    });
    expect(getAuthoringRunStatus(v2Db, v2.run.runId).run.contractVersion).toBe("workbench-authoring-v2");
    expect(() => submitAuthoringBundle(v2Db, {
      bundle: validCandidateBundle(v2.run, candidate),
      runId: v2.run.runId
    })).toThrow("authoring_contract_audit_only");
    expect(() => finishAuthoringRun(v2Db, { runId: v2.run.runId })).toThrow("authoring_contract_audit_only");
    v2Db.close();
  });

  test("bounds V3 selections to 1-12 sessions and reuses only the exact current revision", async () => {
    const db = await readyV3AuthoringDb();
    const input = { actorId: "codex", databaseId: testDatabaseId(db), sessionIds: [" session:a ", "session:a"] };
    const first = openAgentLedAuthoringRun(db, input);
    const retry = openAgentLedAuthoringRun(db, input);
    expect(retry.run.runId).toBe(first.run.runId);
    expect(first.run.sessionIds).toEqual(["session:a"]);
    expect(() => openAgentLedAuthoringRun(db, { ...input, sessionIds: [] })).toThrow("authoring_session_count_invalid");
    const tooMany = Array.from({ length: 13 }, (_, index) => `session:${index}`);
    expect(() => openAgentLedAuthoringRun(db, { ...input, sessionIds: tooMany })).toThrow(
      "authoring_session_count_invalid"
    );
    db.close();
  });

  test("requires every selected session to already be compile-ready in Workbench", async () => {
    const db = await testDb();
    seedSessionWithRedactedEvidence(db, "session:no-state");
    seedSessionWithRedactedEvidence(db, "session:not-ready");
    const notReady = ensureWorkbenchSessionState(db, "session:not-ready");
    const rowsBefore = authoringRowCounts(db);

    expect(() => openAgentLedAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:no-state"]
    })).toThrow("authoring_session_not_compile_ready:session:no-state");
    expect(readWorkbenchSessionState(db, "session:no-state")).toBeUndefined();

    expect(() => openAgentLedAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:not-ready"]
    })).toThrow("authoring_session_not_compile_ready:session:not-ready");
    expect(readWorkbenchSessionState(db, "session:not-ready")).toEqual(notReady);
    expect(authoringRowCounts(db)).toEqual(rowsBefore);
    db.close();
  });

  test("resets an open V3 run onto changed evidence without conflicting with its own stale claim", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    const db = await readyV3AuthoringDb();
    const input = { actorId: "codex", databaseId: testDatabaseId(db), sessionIds: ["session:a"] };
    const opened = openAgentLedAuthoringRun(db, input);
    const staleClaimId = opened.run.claimIds[0]!;
    expireAuthoringClaims(db, opened.run.runId);
    insertMessage(db, "session:a", "changed", "New canonical evidence changes the pinned authoring revision.");

    const reset = openAgentLedAuthoringRun(db, input);

    expect(reset.run).toMatchObject({ runId: opened.run.runId, status: "open" });
    expect(reset.run.evidenceRevision).not.toBe(opened.run.evidenceRevision);
    expect(reset.run.claimIds[0]).not.toBe(staleClaimId);
    expect(reset.run.claimStatus).toBe("active");
    expect(db.prepare("SELECT COUNT(*) AS count FROM workbench_authoring_runs").get()).toEqual({ count: 1 });
    db.close();
  });

  test("returns original canonical dossiers and nonbinding suggestions without mutating the run", async () => {
    const db = await readyV3AuthoringDb();
    const opened = openAgentLedAuthoringRun(db, {
      actorId: "codex",
      databaseId: testDatabaseId(db),
      sessionIds: ["session:a"]
    });
    const rowsBefore = authoringRowCounts(db);
    const context = getAuthoringRunContext(db, opened.run.runId);

    expect(context).toMatchObject({
      evidenceRevision: opened.run.evidenceRevision,
      ok: true,
      runId: opened.run.runId,
      sessions: [{ dossier: { identity: { title: "Authoring session:a" } }, sessionId: "session:a" }]
    });
    expect(context.suggestions.every(({ advisory }) => advisory)).toBe(true);
    expect(authoringRowCounts(db)).toEqual(rowsBefore);
    expect(getAuthoringRunStatus(db, opened.run.runId).run).toEqual(opened.run);
    db.close();
  });

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

async function readyV3AuthoringDb(): Promise<MastheadDatabase> {
  const db = await readyAuthoringDb();
  markSessionCompileReady(db, "session:a");
  return db;
}


async function submittedV3AuthoringDb(): Promise<{ db: MastheadDatabase; runId: string }> {
  const db = await readyV3AuthoringDb();
  const opened = openAgentLedAuthoringRun(db, {
    actorId: "codex",
    databaseId: testDatabaseId(db),
    sessionIds: ["session:a"]
  });
  const submitted = submitAuthoringBundle(db, {
    bundle: validV3Bundle(opened.run.runId, opened.run.evidenceRevision),
    runId: opened.run.runId
  });
  expect(submitted.accepted, JSON.stringify(submitted.findings, null, 2)).toBe(true);
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

function markSessionCompileReady(db: MastheadDatabase, sessionId: string): void {
  db.prepare(
    `INSERT INTO workbench_session_state (
      session_id, publication_status, next_action, transcript_status, quality_status,
      session_enrichment_status, session_dossier_status, bug_fix_trace_status, created_at, updated_at
    ) VALUES (?, 'publish_path', 'enrich', 'imported', 'passed', 'missing', 'missing', 'unknown', ?, ?)`
  ).run(sessionId, "2026-07-10T11:00:00.000Z", "2026-07-10T11:00:00.000Z");
}

function testDatabaseId(db: MastheadDatabase): string {
  return getOrCreateDatabaseIdentity(db);
}



function validV3Bundle(
  runId: string,
  evidenceRevision: string,
  sessionId = "session:a",
  evidenceId = `message:${sessionId}:message`
): WorkbenchAuthoringBundleV3 {
  const evidenceRef = {
    id: evidenceId,
    kind: "event" as const,
    observedAt: "2026-07-10T12:00:00.000Z",
    source: "canonical"
  };
  return {
    artifacts: [],
    bundleVersion: "workbench-authoring-v3",
    evidenceRevision,
    runId,
    sessionEnrichments: [{
      enrichment: {
        sessionDossier: {
          blockers: [],
          continuation: { constraints: [], openQuestions: [] },
          decisions: ["Publish only after enrichment is current."],
          evidenceRefs: [evidenceRef],
          keyWork: ["Applied grounded durable enrichment before dossier rendering."],
          outcome: "Published an enriched canonical dossier atomically.",
          verification: {
            commands: [],
            evidenceRefs: [evidenceRef],
            failures: [],
            status: "unknown",
            summary: "Canonical message evidence supports the enrichment."
          },
          warnings: []
        },
        sessionSummary: {
          confidence: "low",
          evidenceRefs: [evidenceRef],
          state: "completed",
          text: "Agent-enriched summary grounded in the selected canonical evidence."
        },
        sessionTitle: {
          basis: "dominant_work",
          confidence: "low",
          evidenceRefs: [evidenceRef],
          text: "Agent-enriched title"
        },
        version: "session-capsule-v4"
      },
      sessionId
    }]
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

function validAdrArtifactDraft(
  candidate: StoredWorkbenchArtifactCandidate
): WorkbenchAuthoringBundleV3["artifacts"][number] {
  const decisionRef = candidate.signalEvidenceRefs.find((ref) => ref.includes("decision"))!;
  const alternativeRef = candidate.signalEvidenceRefs.find((ref) => ref.includes("alternative"))!;
  const decisionExcerpt = canonicalCandidateExcerpt(decisionRef);
  const alternativeExcerpt = canonicalCandidateExcerpt(alternativeRef);
  return {
    kind: "adr",
    output: {
      alternatives: [alternativeExcerpt],
      claimSupport: [
        { evidenceRef: decisionRef, excerpt: decisionExcerpt, path: "context", supportKind: "problem" },
        { evidenceRef: decisionRef, excerpt: decisionExcerpt, path: "decision", supportKind: "decision" },
        { evidenceRef: alternativeRef, excerpt: alternativeExcerpt, path: "alternatives[0]", supportKind: "alternative" },
        { evidenceRef: decisionRef, excerpt: decisionExcerpt, path: "consequences[0]", supportKind: "decision" },
        { evidenceRef: decisionRef, excerpt: decisionExcerpt, path: "status", supportKind: "decision" }
      ],
      confidence: "medium",
      consequences: ["Masthead remains available when hosted services are unavailable."],
      context: "The canonical session compared local and hosted persistence for offline operation.",
      decision: decisionExcerpt,
      evidenceRefs: [decisionRef, alternativeRef],
      missingEvidence: [],
      provenanceSessionIds: candidate.provenanceSessionIds,
      status: "accepted",
      title: "Choose local-first canonical session storage"
    },
    provenanceSessionIds: candidate.provenanceSessionIds,
    seedSessionId: candidate.seedSessionId
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
    "tool_result:repeated-error:2:failure": "ssh: codex: command not found. ERROR_SIGNATURE: SSH / Codex command not found",
    "message:decision-local-first:decision": "Decision: adopt SQLite as the canonical local-first session store.",
    "message:decision-local-first:alternative": "Rejected alternative: a hosted database would break offline operation."
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



function v3FinishRows(db: MastheadDatabase): Record<string, unknown[]> {
  return Object.fromEntries([
    "session_artifacts",
    "session_artifact_provenance",
    "session_artifact_search",
    "session_enrichments",
    "workbench_session_state",
    "workbench_claims",
    "workbench_activity",
    "workbench_authoring_runs"
  ].map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
