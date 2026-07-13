import { describe, expect, test } from "vitest";
import {
  durableArtifactMachineFailures,
  runDurableArtifactCorpus
} from "../durableArtifactCorpusAcceptance.ts";

describe("durable artifact acceptance corpus", () => {
  test("meets every mandatory machine gate", async () => {
    const report = await runDurableArtifactCorpus();

    expect(report.dossierFidelity).toBe(1);
    expect(report.claimSupportCoverage).toBe(1);
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
});
