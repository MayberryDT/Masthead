import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import {
  getLogbookArtifactDetail,
  searchLogbookArtifacts
} from "../../../daemon/db/logbookArtifactRepository.ts";
import { readSessionEnrichment } from "../../../daemon/db/enrichmentRepository.ts";
import { createGuidedAuthoringRequest } from "../../../daemon/db/guidedAuthoringRepository.ts";
import { getSessionArtifact } from "../../../daemon/db/sessionArtifactRepository.ts";
import { getSessionDossier } from "../../../daemon/db/sessionDossierRepository.ts";
import { getOrCreateDatabaseIdentity, migrateDatabase } from "../../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase, withImmediateTransaction } from "../../../daemon/db/sqlite.ts";
import {
  readWorkbenchSessionState,
  resetGuidedAssignmentWorkbenchInTransaction
} from "../../../daemon/db/workbenchPipelineRepository.ts";
import { handleMcpLine } from "../../../mcp/protocol.ts";
import type { GuidedAuthoringBundleV4 } from "../../../shared/guidedAuthoring.ts";
import type { PublishedSessionDossierV1 } from "../../../shared/sessionDossier.ts";
import type { WorkbenchAuthoringReceiptV3 } from "../../../shared/workbenchAuthoring.ts";
import {
  buildFocusedAgentLedBundle,
  focusedAgentLedCorpus,
  misleadingSuggestionSession,
  seedFocusedAgentLedCorpus
} from "../__fixtures__/durableArtifactCorpus.ts";
import { discoverArtifactCandidates } from "../artifactCandidates.ts";
import { authoringEvidenceRevision } from "../evidenceCatalog.ts";
import {
  applyGuidedSessionEnrichmentInTransaction,
  finishAuthoringRun,
  openAgentLedAuthoringRun,
  publishStagedGuidedArtifactsInTransaction,
  stageGuidedCanonicalDossiersInTransaction,
  stageGuidedOptionalArtifactsInTransaction,
  submitAuthoringBundle
} from "../authoringService.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("focused agent-led authoring acceptance", () => {
  test("enriches four sessions and publishes agent-chosen artifacts through Logbook and MCP", async () => {
    const db = await openFixtureDb();
    seedFocusedAgentLedCorpus(db, focusedAgentLedCorpus);
    const sessionIds = focusedAgentLedCorpus.map(({ id }) => id);
    const databaseId = getOrCreateDatabaseIdentity(db);
    const originals = new Map(sessionIds.map((sessionId) => [sessionId, getSessionDossier(db, sessionId)!]));
    const opened = openAgentLedAuthoringRun(db, {
      actorId: "acceptance-agent",
      databaseId,
      sessionIds
    });
    const bundle = buildFocusedAgentLedBundle(opened.run, focusedAgentLedCorpus);
    const submitted = submitAuthoringBundle(db, { bundle, runId: opened.run.runId });
    expect(submitted.accepted, JSON.stringify(submitted.findings, null, 2)).toBe(true);
    const receipt = finishAuthoringRun(db, { runId: opened.run.runId }) as WorkbenchAuthoringReceiptV3;

    expect(receipt.dossierArtifactIds).toHaveLength(4);
    expect(receipt.optionalArtifacts.map((item) => item.kind).sort()).toEqual([
      "adr",
      "incident_timeline",
      "runbook"
    ]);
    expect(logbookKinds(db, receipt)).toEqual([
      "session_dossier",
      "session_dossier",
      "session_dossier",
      "session_dossier",
      "runbook",
      "adr",
      "incident_timeline"
    ]);
    expect(allDossiersHaveCurrentEnrichment(db, receipt.dossierArtifactIds)).toBe(true);
    expect(allDossiersPreserveCanonicalShape(db, receipt, originals)).toBe(true);
    expect(allOptionalClaimsHaveVerbatimSupport(db, receipt.optionalArtifacts.map(({ artifactId }) => artifactId)))
      .toBe(true);

    const publishedArtifactIds = [
      ...receipt.dossierArtifactIds,
      ...receipt.optionalArtifacts.map(({ artifactId }) => artifactId)
    ];
    for (const artifactId of publishedArtifactIds) {
      const detail = getLogbookArtifactDetail(db, artifactId)!;
      const search = callMcp(db, "search_artifacts", { query: detail.capsule.title });
      expect(search.artifacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ artifactId })
      ]));
      const mcpDetail = callMcp(db, "get_artifact", { artifactId });
      expect(mcpDetail).toMatchObject({
        artifact: {
          capsule: { artifactId },
          provenanceSessionIds: detail.provenanceSessionIds
        }
      });
      const optional = receipt.optionalArtifacts.find((item) => item.artifactId === artifactId);
      if (optional) {
        const submittedDraft = bundle.artifacts.find((artifact) => artifact.kind === optional.kind);
        expect(submittedDraft).toBeDefined();
        expect(mcpDetail.artifact.body.claimSupport).toEqual(submittedDraft?.output.claimSupport);
      }
    }
    db.close();
  });

  test("publishes grounded agent judgment when detector suggestions are absent", async () => {
    const db = await openFixtureDb();
    seedFocusedAgentLedCorpus(db, [misleadingSuggestionSession]);
    expect(discoverArtifactCandidates(db, [misleadingSuggestionSession.id])).toEqual([]);
    const opened = openAgentLedAuthoringRun(db, {
      actorId: "acceptance-agent",
      databaseId: getOrCreateDatabaseIdentity(db),
      sessionIds: [misleadingSuggestionSession.id]
    });
    const bundle = buildFocusedAgentLedBundle(opened.run, [misleadingSuggestionSession], ["adr"]);
    const submitted = submitAuthoringBundle(db, { bundle, runId: opened.run.runId });
    expect(submitted.accepted, JSON.stringify(submitted.findings, null, 2)).toBe(true);

    const receipt = finishAuthoringRun(db, { runId: opened.run.runId });
    if (receipt.contractVersion !== "workbench-authoring-v3") throw new Error("expected_v3_receipt");
    expect(receipt.optionalArtifacts.map(({ kind }) => kind)).toEqual(["adr"]);
    expect(getLogbookArtifactDetail(db, receipt.optionalArtifacts[0]!.artifactId)).toMatchObject({
      capsule: { kind: "adr" },
      provenanceSessionIds: [misleadingSuggestionSession.id]
    });
    db.close();
  });

  test("returns every generated or reused enrichment id to a composing transaction", async () => {
    const db = await openFixtureDb();
    seedFocusedAgentLedCorpus(db, [misleadingSuggestionSession]);
    const bundle = buildFocusedAgentLedBundle(
      { evidenceRevision: authoringEvidenceRevision(db, [misleadingSuggestionSession.id]), runId: "run:guided" },
      [misleadingSuggestionSession],
      []
    );
    const input = {
      actorId: "guided-agent",
      enrichment: bundle.sessionEnrichments[0]!.enrichment,
      sessionId: misleadingSuggestionSession.id
    };

    const first = withImmediateTransaction(db, () => applyGuidedSessionEnrichmentInTransaction(db, input));
    const reused = withImmediateTransaction(db, () => applyGuidedSessionEnrichmentInTransaction(db, input));

    expect(first.enrichmentIds).toHaveLength(3);
    expect(new Set(first.enrichmentIds).size).toBe(3);
    expect(reused.enrichmentIds).toEqual(first.enrichmentIds);
    expect(first.enrichmentIds.map((id) => readSessionEnrichment(db, id)?.enrichmentKind).sort()).toEqual([
      "live_summary",
      "search_projection",
      "session_capsule"
    ]);
    expect(first.enrichmentIds.map((id) => readSessionEnrichment(db, id)?.provider))
      .toEqual(["guided_authoring", "guided_authoring", "guided_authoring"]);
    db.close();
  });

  test("composes guided publication and actor-scoped Workbench reset in one transaction", async () => {
    const db = await openFixtureDb();
    seedFocusedAgentLedCorpus(db, [misleadingSuggestionSession]);
    const sessionId = misleadingSuggestionSession.id;
    const evidenceRevision = authoringEvidenceRevision(db, [sessionId]);
    const bundle = guidedBundle(
      buildFocusedAgentLedBundle({ evidenceRevision, runId: "run:guided" }, [misleadingSuggestionSession], ["adr"]),
      "assignment:guided"
    );
    bundle.sessionEnrichments[0]!.enrichment.keywords = [
      "quartzharbor",
      "guided dossier publication",
      "MCP retrieval"
    ];
    seedGuidedAssignment(db, { assignmentId: bundle.assignmentId, evidenceRevision, sessionIds: [sessionId] });
    seedConcurrentClaims(db, sessionId);

    const result = withImmediateTransaction(db, () => {
      for (const draft of bundle.sessionEnrichments) {
        applyGuidedSessionEnrichmentInTransaction(db, {
          actorId: "guided-agent",
          enrichment: draft.enrichment,
          sessionId: draft.sessionId
        });
      }
      const dossierArtifacts = stageGuidedCanonicalDossiersInTransaction(db, {
        actorId: "guided-agent",
        assignmentId: bundle.assignmentId,
        evidenceRevision,
        sessionIds: [sessionId]
      });
      expect(dossierArtifacts.map(({ publicationStatus }) => publicationStatus)).toEqual(["applied"]);
      expect(searchLogbookArtifacts(db, {}).total).toBe(0);
      const optionalArtifacts = stageGuidedOptionalArtifactsInTransaction(db, {
        actorId: "guided-agent",
        artifacts: bundle.artifacts,
        assignmentId: bundle.assignmentId,
        sessionIds: [sessionId]
      });
      expect(optionalArtifacts.map(({ artifact }) => artifact.publicationStatus)).toEqual(["applied"]);
      expect(searchLogbookArtifacts(db, {}).total).toBe(0);
      const publication = publishStagedGuidedArtifactsInTransaction(db, {
        dossierArtifacts,
        optionalArtifacts
      });
      const reset = resetGuidedAssignmentWorkbenchInTransaction(db, {
        actorId: "guided-agent",
        assignmentId: bundle.assignmentId
      });
      return { publication, reset };
    });

    expect(result.publication.publishedArtifacts).toEqual([
      expect.objectContaining({ kind: "session_dossier", sessionIds: [sessionId] }),
      expect.objectContaining({ draftId: "draft:guided:0", kind: "adr", sessionIds: [sessionId] })
    ]);
    expect(result.publication.publishedArtifacts.every(({ artifactId }) =>
      getSessionArtifact(db, artifactId)?.publicationStatus === "published"
    )).toBe(true);
    const dossierArtifactId = result.publication.publishedArtifacts.find(({ kind }) => kind === "session_dossier")!.artifactId;
    expect(
      JSON.parse((db.prepare(
        `SELECT content_json AS contentJson
         FROM session_enrichments
         WHERE session_id = ? AND enrichment_kind = 'search_projection' AND status = 'current'`
      ).get(sessionId) as { contentJson: string }).contentJson)
    ).toMatchObject({ keywords: bundle.sessionEnrichments[0]!.enrichment.keywords });
    expect(getSessionArtifact(db, dossierArtifactId)?.content).toMatchObject({
      durableEnrichment: { keywords: bundle.sessionEnrichments[0]!.enrichment.keywords }
    });
    expect(searchLogbookArtifacts(db, { q: "quartzharbor" }).artifacts).toEqual([
      expect.objectContaining({ artifactId: dossierArtifactId })
    ]);
    expect(callMcp(db, "search_artifacts", { query: "quartzharbor" })).toMatchObject({
      artifacts: [expect.objectContaining({ artifactId: dossierArtifactId })],
      total: 1
    });
    expect(result.reset).toMatchObject({
      releasedClaimIds: ["claim:guided"],
      sessionIds: [sessionId],
      states: [expect.objectContaining({ publicationStatus: "published", nextAction: "none" })]
    });
    expect(claimReleaseState(db, "claim:foreign")).toBeNull();
    expect(claimReleaseState(db, "claim:guided")).toBe("guided_authoring_finished");
    db.close();
  });

  test("publishes one coherent model-derived dossier when raw tool heuristics report missing verification", async () => {
    const db = await openFixtureDb();
    const session = focusedAgentLedCorpus[0];
    seedFocusedAgentLedCorpus(db, [session]);
    const sessionId = session.id;
    expect(getSessionDossier(db, sessionId)?.verification.status).toBe("missing");
    const evidenceRevision = authoringEvidenceRevision(db, [sessionId]);
    const bundle = guidedBundle(
      buildFocusedAgentLedBundle({ evidenceRevision, runId: "run:coherent-dossier" }, [session], []),
      "assignment:coherent-dossier"
    );
    const enrichment = bundle.sessionEnrichments[0]!.enrichment;
    const verificationEvidence = {
      id: "checkpoint:implementation-complete:verified",
      kind: "event" as const,
      observedAt: "2026-07-01T12:02:00.000Z",
      source: "canonical"
    };
    enrichment.sessionDossier.purpose = "Complete stable pagination for artifact search results.";
    enrichment.sessionDossier.outcome = "Artifact search pagination is stable and verified.";
    enrichment.sessionDossier.keyWork = ["Implemented stable pagination for artifact search results."];
    enrichment.sessionDossier.decisions = ["Keep pagination ordering stable across repeated searches."];
    enrichment.sessionDossier.verification = {
      commands: [],
      evidenceRefs: [verificationEvidence],
      failures: [],
      status: "passed",
      summary: "Artifact search pagination tests passed."
    };
    enrichment.sessionDossier.evidenceRefs.push(verificationEvidence);
    enrichment.sessionSummary.text = "Implemented and verified stable artifact search pagination.";
    enrichment.sessionSummary.evidenceRefs.push(verificationEvidence);
    seedGuidedAssignment(db, { assignmentId: bundle.assignmentId, evidenceRevision, sessionIds: [sessionId] });

    const published = withImmediateTransaction(db, () => {
      applyGuidedSessionEnrichmentInTransaction(db, {
        actorId: "guided-agent",
        enrichment,
        sessionId
      });
      const dossierArtifacts = stageGuidedCanonicalDossiersInTransaction(db, {
        actorId: "guided-agent",
        assignmentId: bundle.assignmentId,
        evidenceRevision,
        sessionIds: [sessionId]
      });
      return publishStagedGuidedArtifactsInTransaction(db, { dossierArtifacts, optionalArtifacts: [] });
    });

    const artifactId = published.publishedArtifacts[0]!.artifactId;
    const detail = getLogbookArtifactDetail(db, artifactId)!;
    const body = detail.body as PublishedSessionDossierV1;
    expect(detail.capsule).toMatchObject({
      highlight: "Artifact search pagination tests passed.",
      summary: "Implemented and verified stable artifact search pagination."
    });
    expect(body.identity.outcome).toBe("Artifact search pagination is stable and verified.");
    expect(body.narrative).toMatchObject({
      objective: "Complete stable pagination for artifact search results.",
      outcome: "Artifact search pagination is stable and verified.",
      liveSummary: "Implemented and verified stable artifact search pagination."
    });
    expect(body.verification).toMatchObject({
      status: "passed",
      summary: "Artifact search pagination tests passed."
    });
    expect(body.attention.map((item: { kind: string }) => item.kind)).not.toContain("missing_verification");
    expect(body.coverage.warnings.map((item: { code: string }) => item.code)).not.toContain("verification_missing");
    expect(body.durableEnrichment!.sessionDossier).toMatchObject({
      decisions: ["Keep pagination ordering stable across repeated searches."],
      keyWork: ["Implemented stable pagination for artifact search results."]
    });
    expect(callMcp(db, "get_artifact", { artifactId })).toMatchObject({
      artifact: {
        body: {
          verification: { status: "passed", summary: "Artifact search pagination tests passed." },
          durableEnrichment: { sessionDossier: { decisions: enrichment.sessionDossier.decisions, keyWork: enrichment.sessionDossier.keyWork } }
        },
        capsule: { highlight: "Artifact search pagination tests passed." }
      }
    });
    db.close();
  });

  test("binds guided optional artifact identity to assignment-scoped provenance", async () => {
    const db = await openFixtureDb();
    const sessions = focusedAgentLedCorpus.slice(0, 3);
    seedFocusedAgentLedCorpus(db, sessions);
    const sessionIds = sessions.map(({ id }) => id);
    const evidenceRevision = authoringEvidenceRevision(db, sessionIds);
    const bundle = guidedBundle(
      buildFocusedAgentLedBundle({ evidenceRevision, runId: "run:provenance" }, sessions, ["adr"]),
      "assignment:provenance"
    );
    seedGuidedAssignment(db, { assignmentId: bundle.assignmentId, evidenceRevision, sessionIds });
    const draft = bundle.artifacts[0]!;
    const sharedOutput = {
      ...draft.output,
      joinRationale: "These sessions carry complementary evidence for the same durable decision."
    };
    const seedOnly = { ...draft, output: sharedOutput };
    const expandedProvenance = {
      ...draft,
      output: sharedOutput,
      provenanceSessionIds: [draft.seedSessionId, sessionIds.find((id) => id !== draft.seedSessionId)!]
    };

    const [first, second] = withImmediateTransaction(db, () => [
      stageGuidedOptionalArtifactsInTransaction(db, {
        actorId: "guided-agent",
        artifacts: [seedOnly],
        assignmentId: bundle.assignmentId,
        sessionIds
      })[0]!,
      stageGuidedOptionalArtifactsInTransaction(db, {
        actorId: "guided-agent",
        artifacts: [expandedProvenance],
        assignmentId: bundle.assignmentId,
        sessionIds
      })[0]!
    ]);

    expect(second.artifact.artifactId).not.toBe(first.artifact.artifactId);
    expect(getSessionArtifact(db, first.artifact.artifactId)?.provenanceSessionIds).toEqual([draft.seedSessionId]);
    expect(getSessionArtifact(db, second.artifact.artifactId)?.provenanceSessionIds)
      .toEqual(expandedProvenance.provenanceSessionIds);
    db.close();
  });

  test("does not reuse V3 dossier audit metadata for an identical V4 snapshot", async () => {
    const db = await openFixtureDb();
    seedFocusedAgentLedCorpus(db, [misleadingSuggestionSession]);
    const sessionId = misleadingSuggestionSession.id;
    const opened = openAgentLedAuthoringRun(db, {
      actorId: "legacy-agent",
      databaseId: getOrCreateDatabaseIdentity(db),
      sessionIds: [sessionId]
    });
    const legacyBundle = buildFocusedAgentLedBundle(opened.run, [misleadingSuggestionSession], []);
    expect(submitAuthoringBundle(db, { bundle: legacyBundle, runId: opened.run.runId }).accepted).toBe(true);
    const legacyReceipt = finishAuthoringRun(db, { runId: opened.run.runId });
    if (legacyReceipt.contractVersion !== "workbench-authoring-v3") throw new Error("expected_v3_receipt");

    const evidenceRevision = authoringEvidenceRevision(db, [sessionId]);
    const guided = guidedBundle(legacyBundle, "assignment:audit-metadata");
    seedGuidedAssignment(db, { assignmentId: guided.assignmentId, evidenceRevision, sessionIds: [sessionId] });
    const [guidedDossier] = withImmediateTransaction(db, () => {
      applyGuidedSessionEnrichmentInTransaction(db, {
        actorId: "guided-agent",
        enrichment: guided.sessionEnrichments[0]!.enrichment,
        sessionId
      });
      return stageGuidedCanonicalDossiersInTransaction(db, {
        actorId: "guided-agent",
        assignmentId: guided.assignmentId,
        evidenceRevision,
        sessionIds: [sessionId]
      });
    });

    expect(guidedDossier!.artifactId).not.toBe(legacyReceipt.dossierArtifactIds[0]);
    expect(guidedDossier).toMatchObject({
      createdBy: "guided_authoring:guided-agent",
      validation: {
        canonicalSnapshot: true,
        contract: "workbench-authoring-v4",
        evidenceRevision,
        ok: true
      }
    });
    db.close();
  });

  test("rolls back enrichment, artifact publication, Workbench state, and claim reset together", async () => {
    const db = await openFixtureDb();
    seedFocusedAgentLedCorpus(db, [misleadingSuggestionSession]);
    const sessionId = misleadingSuggestionSession.id;
    const evidenceRevision = authoringEvidenceRevision(db, [sessionId]);
    const bundle = guidedBundle(
      buildFocusedAgentLedBundle({ evidenceRevision, runId: "run:rollback" }, [misleadingSuggestionSession], []),
      "assignment:rollback"
    );
    seedGuidedAssignment(db, { assignmentId: bundle.assignmentId, evidenceRevision, sessionIds: [sessionId] });
    seedConcurrentClaims(db, sessionId);
    const before = publicationPrimitiveCounts(db);
    const beforeState = readWorkbenchSessionState(db, sessionId);

    expect(() => withImmediateTransaction(db, () => {
      applyGuidedSessionEnrichmentInTransaction(db, {
        actorId: "guided-agent",
        enrichment: bundle.sessionEnrichments[0]!.enrichment,
        sessionId
      });
      const dossierArtifacts = stageGuidedCanonicalDossiersInTransaction(db, {
        actorId: "guided-agent",
        assignmentId: bundle.assignmentId,
        evidenceRevision,
        sessionIds: [sessionId]
      });
      const optionalArtifacts = stageGuidedOptionalArtifactsInTransaction(db, {
        actorId: "guided-agent",
        artifacts: bundle.artifacts,
        assignmentId: bundle.assignmentId,
        sessionIds: [sessionId]
      });
      publishStagedGuidedArtifactsInTransaction(db, { dossierArtifacts, optionalArtifacts });
      resetGuidedAssignmentWorkbenchInTransaction(db, {
        actorId: "guided-agent",
        assignmentId: bundle.assignmentId
      });
      throw new Error("injected_guided_finish_failure");
    })).toThrow("injected_guided_finish_failure");

    expect(publicationPrimitiveCounts(db)).toEqual(before);
    expect(readWorkbenchSessionState(db, sessionId)).toEqual(beforeState);
    expect(claimReleaseState(db, "claim:guided")).toBeNull();
    expect(claimReleaseState(db, "claim:foreign")).toBeNull();
    db.close();
  });
});

function guidedBundle(
  bundle: ReturnType<typeof buildFocusedAgentLedBundle>,
  assignmentId: string
): GuidedAuthoringBundleV4 {
  return {
    artifacts: bundle.artifacts.map((artifact, index) => ({ ...artifact, draftId: `draft:guided:${index}` })),
    assignmentId,
    bundleVersion: "workbench-authoring-v4",
    evidenceRevision: bundle.evidenceRevision,
    opportunityDispositions: [],
    sessionEnrichments: bundle.sessionEnrichments.map((draft) => ({ ...draft, claimSupport: [] }))
  };
}

function seedGuidedAssignment(
  db: MastheadDatabase,
  input: { assignmentId: string; evidenceRevision: string; sessionIds: string[] }
): void {
  createGuidedAuthoringRequest(db, {
    actorId: "guided-agent",
    assignments: [{
      assignmentId: input.assignmentId,
      canary: true,
      evidenceRevision: input.evidenceRevision,
      opportunityIds: [],
      ordinal: 0,
      sessionIds: input.sessionIds
    }],
    identity: {
      baseUrl: "http://127.0.0.1:17373",
      buildSha: "build:test",
      creationInstanceId: "instance:test",
      databaseId: getOrCreateDatabaseIdentity(db),
      instanceManifest: "/tmp/masthead-test-manifest.json"
    },
    opportunities: [],
    policyVersion: "guided-authoring-v1",
    requestId: `request:${input.assignmentId}`,
    sessions: input.sessionIds.map((sessionId, ordinal) => ({ ordinal, sessionId }))
  });
}

function seedConcurrentClaims(db: MastheadDatabase, sessionId: string): void {
  const at = "2026-07-20T00:00:00.000Z";
  const insert = db.prepare(
    `INSERT INTO workbench_claims (
      claim_id, session_id, claim_kind, claimed_by, claimed_at, heartbeat_at, expires_at
    ) VALUES (?, ?, 'publish_path', ?, ?, ?, ?)`
  );
  insert.run("claim:guided", sessionId, "guided-agent", at, at, "2099-01-01T00:00:00.000Z");
  insert.run("claim:foreign", sessionId, "foreign-agent", at, at, "2099-01-01T00:00:00.000Z");
}

function claimReleaseState(db: MastheadDatabase, claimId: string): string | null {
  return (db.prepare(
    "SELECT release_reason AS releaseReason FROM workbench_claims WHERE claim_id = ?"
  ).get(claimId) as { releaseReason: string | null }).releaseReason;
}

function publicationPrimitiveCounts(db: MastheadDatabase): Record<string, number> {
  return Object.fromEntries([
    "session_enrichments",
    "session_artifacts",
    "session_artifact_search",
    "workbench_activity"
  ].map((table) => [table, (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count]));
}

async function openFixtureDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-agent-led-acceptance-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function logbookKinds(
  db: MastheadDatabase,
  receipt: WorkbenchAuthoringReceiptV3
): string[] {
  const expectedOrder = [
    ...receipt.dossierArtifactIds,
    ...receipt.optionalArtifacts.map(({ artifactId }) => artifactId)
  ];
  const indexed = searchLogbookArtifacts(db, { limit: 50 });
  if (indexed.total !== expectedOrder.length) return indexed.artifacts.map(({ kind }) => kind);
  const indexedById = new Map(indexed.artifacts.map((artifact) => [artifact.artifactId, artifact]));
  return expectedOrder.map((artifactId) => indexedById.get(artifactId)?.kind ?? "missing");
}

function allDossiersPreserveCanonicalShape(
  db: MastheadDatabase,
  receipt: WorkbenchAuthoringReceiptV3,
  originals: Map<string, NonNullable<ReturnType<typeof getSessionDossier>>>
): boolean {
  return receipt.dossierArtifactIds.every((artifactId) => {
    const detail = getLogbookArtifactDetail(db, artifactId);
    const sessionId = detail?.provenanceSessionIds[0];
    const original = sessionId ? originals.get(sessionId) : undefined;
    if (!detail || !sessionId || !original) return false;
    const current = getSessionDossier(db, sessionId);
    if (!current) return false;
    const { artifacts: _currentArtifacts, ...currentBody } = current;
    const { capturedAt: _capturedAt, snapshotVersion: _snapshotVersion, ...publishedBody } = detail.body as Record<string, unknown>;
    const originalSectionKeys = Object.keys(original).filter((key) => key !== "artifacts");
    const comparableCurrent = JSON.parse(JSON.stringify(currentBody)) as Record<string, unknown>;
    const comparablePublished = structuredClone(publishedBody);
    if (!isDeepStrictEqual(comparablePublished.reuse, comparableCurrent.reuse)) {
      throw new Error(`dossier_reuse_mismatch:${sessionId}`);
    }
    const mismatched = originalSectionKeys.filter((key) =>
      !Object.hasOwn(comparablePublished, key)
      || !isDeepStrictEqual(comparablePublished[key], comparableCurrent[key])
    );
    if (mismatched.length > 0) throw new Error(`dossier_shape_mismatch:${sessionId}:${mismatched.join(",")}`);
    return true;
  });
}

function allDossiersHaveCurrentEnrichment(db: MastheadDatabase, artifactIds: string[]): boolean {
  return artifactIds.every((artifactId) => {
    const body = getLogbookArtifactDetail(db, artifactId)?.body as Record<string, unknown> | undefined;
    const durableEnrichment = body?.durableEnrichment as Record<string, unknown> | undefined;
    const enrichment = body?.enrichment as Record<string, unknown> | undefined;
    return durableEnrichment?.version === "session-capsule-v4" && enrichment?.status === "current";
  });
}

function allOptionalClaimsHaveVerbatimSupport(db: MastheadDatabase, artifactIds: string[]): boolean {
  return artifactIds.every((artifactId) => {
    const detail = getLogbookArtifactDetail(db, artifactId);
    const body = detail?.body as { claimSupport?: Array<{ evidenceRef: string; excerpt: string }> } | undefined;
    if (!detail || !body?.claimSupport?.length) return false;
    return body.claimSupport.every(({ evidenceRef, excerpt }) =>
      detail.evidenceRefs.includes(evidenceRef)
      && focusedAgentLedCorpus.some(({ evidence }) =>
        evidence.some((item) => item.id === evidenceRef && item.text.includes(excerpt)))
    );
  });
}

function callMcp(db: MastheadDatabase, tool: string, args: Record<string, unknown>): Record<string, any> {
  const output = handleMcpLine(db, JSON.stringify({ arguments: args, id: 1, tool }));
  const response = JSON.parse(output ?? "{}") as { result?: Record<string, any> };
  if (!response.result) throw new Error(`mcp_call_failed:${tool}`);
  return response.result;
}
