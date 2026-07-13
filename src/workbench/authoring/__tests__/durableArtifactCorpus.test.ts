import { describe, expect, test } from "vitest";
import type { SessionDossierDto } from "../../../shared/sessionDossier.ts";
import {
  CANONICAL_DOSSIER_REQUIRED_SECTIONS,
  comparePublishedDossierToCanonical,
  durableArtifactMachineFailures,
  evaluatePersistedClaimSupport,
  persistedArtifactEqualsSubmission,
  runDurableArtifactCorpus
} from "../durableArtifactCorpusAcceptance.ts";

describe("durable artifact acceptance corpus", () => {
  test("meets every mandatory machine gate", async () => {
    const report = await runDurableArtifactCorpus();

    expect(report.dossierFidelity).toBe(1);
    expect(report.claimSupportCoverage).toBe(1);
    expect(report.claimSupportIntegrityFailureCount).toBe(0);
    expect(report.persistedArtifactEquality).toBe(1);
    expect(report.candidateRecall).toBe(1);
    expect(report.candidatePrecision).toBe(1);
    expect(report.logbookRetrievalRecallAt5).toBe(1);
    expect(report.mcpRetrievalRecallAt5).toBe(1);
    expect(report.reuseTaskPassRate).toBe(1);
    expect(report.protocolLeakCount).toBe(0);
    expect(report.duplicateSubstantiveFingerprintCount).toBe(0);
    expect(report.unexpectedKindCount).toBe(0);
    expect(report.missingExpectedKindCount).toBe(0);
    expect(report.maxCandidateRunProvenanceSize).toBeLessThanOrEqual(12);
    expect(report.candidateDiscoveryPageDurationMs).toBeLessThanOrEqual(2_000);
    expect(report.performanceFixture).toEqual({
      evidenceItemsPerSession: 120,
      sessionCount: 100,
      toolsPerSession: 60,
      totalEvidenceItems: 12_000
    });
    expect(report.actualKinds).toEqual(report.expectedKinds);
    expect(report.reuseTasks).toHaveLength(5);
    expect(report.reuseTasks.every((task) => task.passed)).toBe(true);
    expect(report.machineGatePassed).toBe(true);
    expect(report.humanReview.completed).toBe(false);

    const { failures: _failures, machineGatePassed: _machineGatePassed, ...metrics } = report;
    const mandatoryFailures: Array<[Partial<typeof metrics>, string]> = [
      [{ dossierFidelity: 0.99 }, "dossier_fidelity_below_1"],
      [{ claimSupportCoverage: 0.99 }, "claim_support_coverage_below_1"],
      [{ claimSupportIntegrityFailureCount: 1 }, "claim_support_integrity_failed"],
      [{ persistedArtifactEquality: 0.99 }, "persisted_artifact_differs_from_submission"],
      [{ candidateRecall: 0.99 }, "candidate_recall_below_1"],
      [{ candidatePrecision: 0.99 }, "candidate_precision_below_1"],
      [{ logbookRetrievalRecallAt5: 0.99 }, "logbook_recall_at_5_below_1"],
      [{ mcpRetrievalRecallAt5: 0.99 }, "mcp_recall_at_5_below_1"],
      [{ reuseTaskPassRate: 0.99 }, "reuse_task_pass_rate_below_1"],
      [{ rawSessionToolsUsedByReuseTasks: ["get_session_transcript"] }, "reuse_task_used_raw_session_tool"],
      [{ protocolLeakCount: 1 }, "protocol_leak_detected"],
      [{ duplicateSubstantiveFingerprintCount: 1 }, "duplicate_substantive_fingerprint_detected"],
      [{ unexpectedKindCount: 1 }, "unexpected_kind_detected"],
      [{ missingExpectedKindCount: 1 }, "expected_kind_missing"],
      [{ maxCandidateRunProvenanceSize: 13 }, "candidate_run_provenance_exceeds_12"],
      [{ candidateDiscoveryPageSize: 99 }, "candidate_discovery_page_not_100"],
      [{ performanceFixture: { ...metrics.performanceFixture, toolsPerSession: 1 } }, "candidate_discovery_fixture_not_tool_heavy"],
      [{ candidateDiscoveryPageDurationMs: 2_000.01 }, "candidate_discovery_page_exceeds_2000ms"]
    ];
    for (const [override, expectedFailure] of mandatoryFailures) {
      expect(durableArtifactMachineFailures({ ...metrics, ...override })).toContain(expectedFailure);
    }
  });

  test("independently rejects a published dossier that drops an original section", () => {
    const canonical = canonicalDossierShape();
    const { artifacts: _artifacts, ...originalSections } = structuredClone(canonical);
    const published = {
      ...originalSections,
      capturedAt: "2026-07-13T00:00:00.000Z",
      snapshotVersion: "canonical-session-dossier-v1"
    } as Record<string, unknown>;

    expect(comparePublishedDossierToCanonical(published, canonical)).toMatchObject({
      matched: true,
      missingRequiredSections: []
    });
    delete published.narrative;
    expect(comparePublishedDossierToCanonical(published, canonical)).toMatchObject({
      matched: false,
      missingRequiredSections: ["narrative"]
    });
    expect(CANONICAL_DOSSIER_REQUIRED_SECTIONS).toEqual([
      "identity",
      "coverage",
      "narrative",
      "files",
      "tools",
      "verification",
      "attention",
      "timeline",
      "excerpts",
      "durableEnrichment",
      "enrichment",
      "reuse",
      "usage"
    ]);
  });

  test("rejects stripped persisted claim support and an unresolved required path", () => {
    const body = validPersistedRunbook();
    const evidence = new Map([
      ["problem", "OAuth callback test failed with an invalid state nonce."],
      ["change", "modified auth/callback.ts"],
      ["verification", "Callback regression test passed after the nonce repair."]
    ]);
    expect(evaluatePersistedClaimSupport("runbook", body, evidence)).toMatchObject({
      expectedCount: 3,
      passedCount: 3,
      integrityFailures: []
    });

    const stripped = structuredClone(body);
    stripped.claimSupport = [];
    const strippedResult = evaluatePersistedClaimSupport("runbook", stripped, evidence);
    expect(strippedResult.passedCount / strippedResult.expectedCount).toBeLessThan(1);
    expect(strippedResult.integrityFailures).not.toEqual([]);

    const missingPath = structuredClone(body);
    delete missingPath.fixSteps;
    const missingPathResult = evaluatePersistedClaimSupport("runbook", missingPath, evidence);
    expect(missingPathResult.passedCount / missingPathResult.expectedCount).toBeLessThan(1);
    expect(missingPathResult.checks.find((check) => check.path === "fixSteps[0]")?.pathResolved).toBe(false);

    expect(persistedArtifactEqualsSubmission(body, structuredClone(body))).toBe(true);
    expect(persistedArtifactEqualsSubmission({ ...body, title: "corrupted" }, body)).toBe(false);
  });
});

function canonicalDossierShape(): SessionDossierDto {
  return {
    artifacts: [{ artifactId: "old", artifactKind: "runbook", content: {}, createdAt: "now", evidenceRefs: [], status: "current", updatedAt: "now" }],
    attention: [],
    coverage: { level: "metadata_only", transcript: { assistantMessages: 0, checkpoints: 0, fileEffects: 0, hasUsableTranscript: false, lowValueItems: 0, messages: 0, runtimeSignals: 0, toolCalls: 0, toolResults: 0, userMessages: 0 }, warnings: [] },
    durableEnrichment: {
      sessionDossier: {
        blockers: [],
        continuation: { constraints: [], openQuestions: [] },
        decisions: [],
        evidenceRefs: [],
        keyWork: [],
        verification: { commands: [], evidenceRefs: [], failures: [], status: "unknown", summary: "Unknown." },
        warnings: []
      },
      sessionSummary: { confidence: "high", evidenceRefs: [], state: "completed", text: "Test dossier" },
      sessionTitle: { basis: "dominant_work", confidence: "high", evidenceRefs: [], text: "Test dossier" },
      version: "session-capsule-v4"
    },
    enrichment: { status: "not_enriched" },
    excerpts: [],
    files: [],
    identity: {
      hostId: "host:test",
      lastActivityAt: "2026-07-13T00:00:00.000Z",
      lifecycle: "ended",
      models: [],
      runtime: "codex",
      sessionId: "session:test",
      sourceConfidence: "authoritative",
      sourceSessionId: "source:test",
      title: "Test dossier"
    },
    narrative: { objective: "Test the independent contract.", technologies: [], topics: [], unresolved: [] },
    reuse: {
      canonicalSessionId: "session:test",
      copyableContext: "Test",
      mcpIncluded: true,
      sourceConfidence: "authoritative",
      sourceRuntime: "codex",
      sourceSessionId: "source:test"
    },
    timeline: [],
    tools: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, usageRows: 0 },
    verification: { commands: [], status: "unknown", summary: "No verification signal captured." }
  };
}

function validPersistedRunbook(): Record<string, unknown> {
  return {
    title: "Repair OAuth callback state nonce validation",
    problemSignature: { symptoms: ["OAuth callback test failed with an invalid state nonce."] },
    fixSteps: ["Apply the recorded callback change: modified auth/callback.ts."],
    validationChecks: ["Callback regression test passed after the nonce repair."],
    claimSupport: [
      { path: "problemSignature.symptoms[0]", evidenceRef: "problem", excerpt: "OAuth callback test failed with an invalid state nonce.", supportKind: "problem" },
      { path: "fixSteps[0]", evidenceRef: "change", excerpt: "modified auth/callback.ts", supportKind: "change" },
      { path: "validationChecks[0]", evidenceRef: "verification", excerpt: "Callback regression test passed after the nonce repair.", supportKind: "verification" }
    ]
  };
}
