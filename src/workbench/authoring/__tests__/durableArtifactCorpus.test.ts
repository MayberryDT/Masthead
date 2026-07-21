import { describe, expect, test } from "vitest";
import type { SessionDossierDto } from "../../../shared/sessionDossier.ts";
import {
  CANONICAL_DOSSIER_REQUIRED_SECTIONS,
  FAILED_V3_TEMPLATE_EXPECTED_FINDING_CODES,
  GUIDED_REUSE_CASES,
  GUIDED_REUSE_SOURCE_PATHS,
  comparePublishedDossierToCanonical,
  deriveGuidedReuseAnswer,
  durableArtifactMachineFailures,
  evaluatePersistedClaimSupport,
  guidedAuthoringGateFailures,
  guidedAuthoringGateReport,
  guidedAuthoringQualityCorpusFailures,
  guidedReuseResult,
  persistedArtifactEqualsSubmission,
  runGuidedAuthoringQualityCorpus,
  runDurableArtifactCorpus
} from "../durableArtifactCorpusAcceptance.ts";
import {
  buildGuidedQualityCorpusCases,
  guidedAcceptedArtifactOutput
} from "../__fixtures__/durableArtifactCorpus.ts";
import { parseGuidedAuthoringBundleV4 } from "../authoringSchemas.ts";

describe("durable artifact acceptance corpus", () => {
  const mutationCases = [
    ["runbook", "trigger", "/problemSignature/affectedScope", "Changed migration trigger."],
    ["runbook", "actions", "/fixSteps", ["Changed migration action."]],
    ["runbook", "verification", "/validationChecks", ["Changed migration verification."]],
    ["runbook", "failureHandling", "/risksOrGaps", ["Changed rollback handling."]],
    ["adr", "decision", "/decision", "Changed storage decision."],
    ["adr", "rejectedAlternative", "/alternatives/0", "Changed rejected alternative."],
    ["adr", "revisitWhen", "/consequences/0", "Changed revisit condition."],
    ["incident_timeline", "impact", "/impact", "Changed incident impact."],
    ["incident_timeline", "cause", "/rootCause", "Changed incident cause."],
    ["incident_timeline", "recovery", "/remediation/0", "Changed incident recovery."],
    ["incident_timeline", "verification", "/timeline/-1/summary", "Changed recovery verification."]
  ] as const;

  test("declares every guided reuse source path exactly", () => {
    expect(GUIDED_REUSE_SOURCE_PATHS).toEqual({
      runbook: {
        trigger: "/problemSignature/affectedScope",
        actions: "/fixSteps",
        verification: "/validationChecks",
        failureHandling: "/risksOrGaps"
      },
      adr: {
        decision: "/decision",
        rejectedAlternative: "/alternatives/0",
        revisitWhen: "/consequences/0"
      },
      incident_timeline: {
        impact: "/impact",
        cause: "/rootCause",
        recovery: "/remediation/0",
        verification: "/timeline/-1/summary"
      }
    });
  });

  test.each(buildGuidedQualityCorpusCases())("builds a schema-valid V4 $caseId corpus bundle", ({ input }) => {
    expect(parseGuidedAuthoringBundleV4(input.bundle)).toEqual(input.bundle);
  });

  test.each(mutationCases)(
    "derives %s.%s from %s",
    (kind, resultKey, sourcePath, sentinel) => {
      const fixture = GUIDED_REUSE_CASES.find((entry) => entry.kind === kind)!;
      const output = guidedAcceptedArtifactOutput(kind);
      const changed = structuredClone(output);
      setGuidedReuseSource(changed, sourcePath, sentinel);
      expect(deriveGuidedReuseAnswer(kind, changed, fixture.query)[resultKey]).toEqual(sentinel);
      expect(deriveGuidedReuseAnswer(kind, changed, fixture.query)).not.toEqual(
        deriveGuidedReuseAnswer(kind, output, fixture.query)
      );
    }
  );

  test.each(mutationCases)(
    "fails independent reuse when %s source %s is removed",
    (kind, resultKey, sourcePath) => {
      const fixture = GUIDED_REUSE_CASES.find((entry) => entry.kind === kind)!;
      const missing = structuredClone(guidedAcceptedArtifactOutput(kind));
      deleteGuidedReuseSource(missing, sourcePath);
      expect(deriveGuidedReuseAnswer(kind, missing, fixture.query)).not.toEqual(fixture.expected);
      expect(deriveGuidedReuseAnswer(kind, missing, fixture.query)).not.toHaveProperty(resultKey);
      expect(guidedReuseResult(kind, missing, fixture.query).passed).toBe(false);
    }
  );

  test.each(GUIDED_REUSE_CASES)("does not answer an undeclared $kind query from constants", ({ kind }) => {
    expect(deriveGuidedReuseAnswer(kind, guidedAcceptedArtifactOutput(kind), "different question")).toEqual({});
  });

  test.each([
    ["adr", "decision", "/decision", [], "scalar_as_array"],
    ["runbook", "actions", "/fixSteps", "wrong", "array_as_scalar"],
    ["incident_timeline", "impact", "/impact", "   ", "blank_scalar"],
    ["runbook", "verification", "/validationChecks", [], "empty_array"],
    ["runbook", "failureHandling", "/risksOrGaps", ["   "], "blank_array_member"],
    ["runbook", "actions", "/fixSteps", [42], "numeric_array_member"],
    ["runbook", "failureHandling", "/risksOrGaps", [{}], "object_array_member"]
  ] as const)("omits %s.%s for %s", (kind, resultKey, sourcePath, invalidValue, _invalidShape) => {
    const fixture = GUIDED_REUSE_CASES.find((entry) => entry.kind === kind)!;
    const invalid = structuredClone(guidedAcceptedArtifactOutput(kind));
    setGuidedReuseSource(invalid, sourcePath, invalidValue);
    expect(deriveGuidedReuseAnswer(kind, invalid, fixture.query)).not.toHaveProperty(resultKey);
    expect(guidedReuseResult(kind, invalid, fixture.query).passed).toBe(false);
  });

  test("passes the complete V4 quality and zero-tool reuse corpus", () => {
    const report = runGuidedAuthoringQualityCorpus();
    expect(report).toEqual({
      cases: [
        { caseId: "sparse", accepted: true, findingCodes: [] },
        { caseId: "supported_protocol", accepted: true, findingCodes: [] },
        { caseId: "runbook", accepted: true, findingCodes: [] },
        { caseId: "adr", accepted: true, findingCodes: [] },
        { caseId: "incident", accepted: true, findingCodes: [] },
        { caseId: "failed_v3_template", accepted: false, findingCodes: [...FAILED_V3_TEMPLATE_EXPECTED_FINDING_CODES] }
      ],
      reuseTasks: GUIDED_REUSE_CASES.map(({ kind, query, expected }) => ({
        kind, query, expected, derived: expected, toolCalls: [], passed: true
      })),
      failures: [],
      passed: true
    });
  });

  test("meets every hard V4 guided-authoring metric", () => {
    const gate = guidedAuthoringGateReport(runGuidedAuthoringQualityCorpus());
    expect(gate).toEqual({
      failedV3TemplateRejected: true,
      completeEvidenceCoverage: 1,
      sessionClaimSupportCoverage: 1,
      optionalClaimSupportCoverage: 1,
      opportunityDispositionCoverage: 1,
      duplicateSessionTemplateCount: 0,
      protocolLeakCount: 0,
      unsupportedCompletionCount: 0,
      artifactOnlyReusePassRate: 1,
      canaryPublishedBeforeApprovalCount: 0,
      identityMismatchMutationCount: 0
    });
    expect(guidedAuthoringGateFailures(gate)).toEqual([]);
  });

  test.each([
    ["failedV3TemplateRejected", false, "failed_v3_template_not_rejected"],
    ["completeEvidenceCoverage", 0.99, "complete_evidence_coverage_below_1"],
    ["sessionClaimSupportCoverage", 0.99, "session_claim_support_below_1"],
    ["optionalClaimSupportCoverage", 0.99, "optional_claim_support_below_1"],
    ["opportunityDispositionCoverage", 0.99, "opportunity_disposition_below_1"],
    ["duplicateSessionTemplateCount", 1, "duplicate_session_template_detected"],
    ["protocolLeakCount", 1, "guided_protocol_leak_detected"],
    ["unsupportedCompletionCount", 1, "unsupported_completion_detected"],
    ["artifactOnlyReusePassRate", 0.99, "artifact_only_reuse_below_1"],
    ["canaryPublishedBeforeApprovalCount", 1, "canary_bypassed"],
    ["identityMismatchMutationCount", 1, "identity_mismatch_mutated"]
  ] as const)("fails a single degraded %s with %s", (metric, value, expectedCode) => {
    const passing = guidedAuthoringGateReport(runGuidedAuthoringQualityCorpus());
    expect(guidedAuthoringGateFailures({ ...passing, [metric]: value })).toEqual([expectedCode]);
  });

  test.each(mutationCases)(
    "runner derives %s.%s from %s",
    (kind, resultKey, sourcePath, sentinel) => {
      const changed = structuredClone(guidedAcceptedArtifactOutput(kind));
      setGuidedReuseSource(changed, sourcePath, sentinel);
      const report = runGuidedAuthoringQualityCorpus({ reuseOutputsByKind: { [kind]: changed } });
      const task = report.reuseTasks.find((candidate) => candidate.kind === kind)!;
      expect(task.derived[resultKey]).toEqual(sentinel);
      expect(task.passed).toBe(false);
      expect(report.failures).toEqual([`guided_reuse_answer_mismatch:${kind}`]);
    }
  );

  test.each(mutationCases)(
    "runner fails %s reuse when %s is absent",
    (kind, resultKey, sourcePath) => {
      const missing = structuredClone(guidedAcceptedArtifactOutput(kind));
      deleteGuidedReuseSource(missing, sourcePath);
      const report = runGuidedAuthoringQualityCorpus({ reuseOutputsByKind: { [kind]: missing } });
      const task = report.reuseTasks.find((candidate) => candidate.kind === kind)!;
      expect(task.derived).not.toHaveProperty(resultKey);
      expect(task.passed).toBe(false);
      expect(report.failures).toEqual([`guided_reuse_answer_mismatch:${kind}`]);
    }
  );

  test.each([
    ["sparse", "guided_sparse_case_rejected"],
    ["supported_protocol", "guided_supported_protocol_case_rejected"],
    ["runbook", "guided_runbook_case_rejected"],
    ["adr", "guided_adr_case_rejected"],
    ["incident", "guided_incident_case_rejected"]
  ] as const)("reports the exact rejection for the %s case", (caseId, expectedFailure) => {
    const report = runGuidedAuthoringQualityCorpus();
    const changed = structuredClone({ cases: report.cases, reuseTasks: report.reuseTasks });
    changed.cases.find((entry) => entry.caseId === caseId)!.accepted = false;
    expect(guidedAuthoringQualityCorpusFailures(changed)).toEqual([expectedFailure]);
  });

  test.each([
    ["sparse", "guided_sparse_case_rejected"],
    ["supported_protocol", "guided_supported_protocol_case_rejected"],
    ["runbook", "guided_runbook_case_rejected"],
    ["adr", "guided_adr_case_rejected"],
    ["incident", "guided_incident_case_rejected"]
  ] as const)("rejects accepted %s cases that still have findings", (caseId, expectedFailure) => {
    const report = runGuidedAuthoringQualityCorpus();
    const changed = structuredClone({ cases: report.cases, reuseTasks: report.reuseTasks });
    changed.cases.find((entry) => entry.caseId === caseId)!.findingCodes = ["negligible_enrichment_delta"];
    expect(guidedAuthoringQualityCorpusFailures(changed)).toEqual([expectedFailure]);
  });

  test.each(["runbook", "adr", "incident_timeline"] as const)(
    "reports zero-tool violations for %s",
    (kind) => {
      const report = runGuidedAuthoringQualityCorpus();
      const changed = structuredClone({ cases: report.cases, reuseTasks: report.reuseTasks });
      (changed.reuseTasks.find((entry) => entry.kind === kind)!.toolCalls as unknown as string[])
        .push("get_session_transcript");
      expect(guidedAuthoringQualityCorpusFailures(changed)).toEqual([`guided_reuse_used_tool:${kind}`]);
    }
  );

  test("reports one isolated unexpected failed-template code in declared order", () => {
    const report = runGuidedAuthoringQualityCorpus();
    const changed = structuredClone({ cases: report.cases, reuseTasks: report.reuseTasks });
    changed.cases.find(({ caseId }) => caseId === "failed_v3_template")!.findingCodes.unshift(
      "missing_session_enrichment"
    );
    expect(guidedAuthoringQualityCorpusFailures(changed)).toEqual([
      "guided_failed_template_unexpected:missing_session_enrichment"
    ]);
  });

  test("deduplicates repeated failures without changing category order", () => {
    const report = runGuidedAuthoringQualityCorpus();
    const changed = structuredClone({ cases: report.cases, reuseTasks: report.reuseTasks });
    const sparse = changed.cases.find(({ caseId }) => caseId === "sparse")!;
    sparse.accepted = false;
    changed.cases.push(structuredClone(sparse), structuredClone(sparse));
    const runbook = changed.reuseTasks.find(({ kind }) => kind === "runbook")!;
    runbook.passed = false;
    (runbook.toolCalls as unknown as string[]).push("get_session_transcript");
    changed.reuseTasks.push(structuredClone(runbook), structuredClone(runbook));
    expect(guidedAuthoringQualityCorpusFailures(changed)).toEqual([
      "guided_sparse_case_rejected",
      "guided_reuse_answer_mismatch:runbook",
      "guided_reuse_used_tool:runbook",
      "guided_corpus_finding_order_unstable"
    ]);
  });

  test("emits deterministic V4 corpus failures without reordering", () => {
    const report = runGuidedAuthoringQualityCorpus();
    const changed = structuredClone({ cases: report.cases, reuseTasks: report.reuseTasks });
    changed.cases[0]!.accepted = false;
    changed.cases[5]!.accepted = true;
    changed.cases[5]!.findingCodes = ["protocol_leakage"];
    changed.reuseTasks[0]!.passed = false;
    (changed.reuseTasks[1]!.toolCalls as unknown as string[]).push("get_session_transcript");
    changed.cases.reverse();
    expect(guidedAuthoringQualityCorpusFailures(changed)).toEqual([
      "guided_sparse_case_rejected",
      "guided_failed_template_accepted",
      "guided_failed_template_missing:incomplete_evidence_inspection",
      "guided_failed_template_missing:invalid_session_support_evidence",
      "guided_failed_template_missing:negligible_enrichment_delta",
      "guided_failed_template_missing:missing_session_claim_support",
      "guided_failed_template_missing:unsupported_completion",
      "guided_failed_template_missing:duplicate_session_template",
      "guided_failed_template_missing:unsupported_opportunity_dismissal",
      "guided_reuse_answer_mismatch:runbook",
      "guided_reuse_used_tool:adr",
      "guided_corpus_finding_order_unstable"
    ]);
  });

  test("meets every mandatory machine gate", async () => {
    const firstReport = await runDurableArtifactCorpus();
    // This wall-clock gate shares a machine with the full Vitest worker pool.
    // Retry only an over-budget sample so scheduler contention cannot create a
    // false failure; a real regression still misses the same 2-second limit.
    const report = firstReport.candidateDiscoveryPageDurationMs <= 2_000
      ? firstReport
      : await runDurableArtifactCorpus();

    expect(report.dossierFidelity).toBe(1);
    expect(report.guidedAuthoringGate).toEqual(guidedAuthoringGateReport(runGuidedAuthoringQualityCorpus()));
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
    const staleReuse = structuredClone(published);
    const staleReuseFields = staleReuse.reuse as { copyableContext: string; mcpIncluded: boolean };
    staleReuseFields.mcpIncluded = false;
    staleReuseFields.copyableContext = staleReuseFields.copyableContext.replace(
      "Agent retrieval: included",
      "Agent retrieval: excluded"
    );
    expect(comparePublishedDossierToCanonical(staleReuse, canonical)).toMatchObject({
      matched: false,
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
      expectedCount: 11,
      passedCount: 11,
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

function decodePointer(pointer: string): string[] {
  return pointer.split("/").slice(1).map((part) => part.replace(/~1/gu, "/").replace(/~0/gu, "~"));
}

function parentAtPointer(output: Record<string, unknown>, pointer: string): { parent: Record<string, unknown> | unknown[]; key: string } {
  const parts = decodePointer(pointer);
  const key = parts.pop()!;
  let current: unknown = output;
  for (const part of parts) {
    if (Array.isArray(current)) current = current[part === "-1" ? current.length - 1 : Number(part)];
    else current = (current as Record<string, unknown>)[part];
  }
  return { parent: current as Record<string, unknown> | unknown[], key };
}

function setGuidedReuseSource(output: Record<string, unknown>, pointer: string, value: unknown): void {
  const { parent, key } = parentAtPointer(output, pointer);
  if (Array.isArray(parent)) parent[key === "-1" ? parent.length - 1 : Number(key)] = value;
  else parent[key] = value;
}

function deleteGuidedReuseSource(output: Record<string, unknown>, pointer: string): void {
  const { parent, key } = parentAtPointer(output, pointer);
  if (Array.isArray(parent)) parent.splice(key === "-1" ? parent.length - 1 : Number(key), 1);
  else delete parent[key];
}

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
    problemSignature: {
      affectedScope: "OAuth callback test failed with an invalid state nonce.",
      errorStrings: ["OAuth callback test failed with an invalid state nonce."],
      symptoms: ["OAuth callback test failed with an invalid state nonce."]
    },
    preconditions: ["OAuth callback test failed with an invalid state nonce."],
    reproSteps: ["OAuth callback test failed with an invalid state nonce."],
    fixSteps: ["Apply the recorded callback change: modified auth/callback.ts."],
    commands: ["Apply the recorded callback change: modified auth/callback.ts."],
    changedFiles: ["Apply the recorded callback change: modified auth/callback.ts."],
    validationChecks: ["Callback regression test passed after the nonce repair."],
    environmentRequirements: ["OAuth callback test failed with an invalid state nonce."],
    preventionNotes: ["Callback regression test passed after the nonce repair."],
    claimSupport: [
      { path: "problemSignature.symptoms[0]", evidenceRef: "problem", excerpt: "OAuth callback test failed with an invalid state nonce.", supportKind: "problem" },
      { path: "problemSignature.errorStrings[0]", evidenceRef: "problem", excerpt: "OAuth callback test failed with an invalid state nonce.", supportKind: "problem" },
      { path: "problemSignature.affectedScope", evidenceRef: "problem", excerpt: "OAuth callback test failed with an invalid state nonce.", supportKind: "problem" },
      { path: "preconditions[0]", evidenceRef: "problem", excerpt: "OAuth callback test failed with an invalid state nonce.", supportKind: "problem" },
      { path: "reproSteps[0]", evidenceRef: "problem", excerpt: "OAuth callback test failed with an invalid state nonce.", supportKind: "problem" },
      { path: "fixSteps[0]", evidenceRef: "change", excerpt: "modified auth/callback.ts", supportKind: "change" },
      { path: "commands[0]", evidenceRef: "change", excerpt: "modified auth/callback.ts", supportKind: "change" },
      { path: "changedFiles[0]", evidenceRef: "change", excerpt: "modified auth/callback.ts", supportKind: "change" },
      { path: "validationChecks[0]", evidenceRef: "verification", excerpt: "Callback regression test passed after the nonce repair.", supportKind: "verification" },
      { path: "environmentRequirements[0]", evidenceRef: "problem", excerpt: "OAuth callback test failed with an invalid state nonce.", supportKind: "problem" },
      { path: "preventionNotes[0]", evidenceRef: "verification", excerpt: "Callback regression test passed after the nonce repair.", supportKind: "remediation" }
    ]
  };
}
