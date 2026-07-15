import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { upsertSessionEnrichment } from "../../daemon/db/enrichmentRepository.ts";
import { getLogbookArtifactDetail, searchLogbookArtifacts } from "../../daemon/db/logbookArtifactRepository.ts";
import { getSessionDossier } from "../../daemon/db/sessionDossierRepository.ts";
import { getOrCreateDatabaseIdentity, migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../../daemon/db/sqlite.ts";
import { iterateSessionTranscriptItems } from "../../daemon/db/sessionTranscriptRepository.ts";
import { handleMcpLine } from "../../mcp/protocol.ts";
import type {
  WorkbenchAuthoringReceiptV3,
  WorkbenchAutomaticArtifactKind,
  WorkbenchClaimSupport
} from "../../shared/workbenchAuthoring.ts";
import type { SessionDossierDto } from "../../shared/sessionDossier.ts";
import { substantiveFingerprint } from "./artifactQuality.ts";
import {
  discoverArtifactCandidatePage,
  discoverArtifactCandidates,
  type WorkbenchArtifactCandidate
} from "./artifactCandidates.ts";
import {
  finishAuthoringRun,
  openAgentLedAuthoringRun,
  submitAuthoringBundle
} from "./authoringService.ts";
import {
  buildDurableArtifactFixtureBundleV3,
  corpusSessionIds,
  seedDurableArtifactCorpus,
  seedToolHeavyPerformanceSessions
} from "./__fixtures__/durableArtifactCorpus.ts";

type KindMix = Record<WorkbenchAutomaticArtifactKind, number>;

export const CANONICAL_DOSSIER_REQUIRED_SECTIONS = [
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
] as const;

type ClaimSupportCheck = {
  artifactId?: string;
  path: string;
  requiredSupportKind: WorkbenchClaimSupport["supportKind"];
  evidenceRef?: string;
  supportCount: number;
  excerptLength: number;
  exactExcerpt: boolean;
  pathResolved: boolean;
  passed: boolean;
};

export type DurableArtifactReuseTaskResult = {
  task: "oauth_repair" | "rejected_architecture_alternative" | "incident_sequence" | "dossier_changed_file" | "dossier_verification_failure";
  query: string;
  kind: "session_dossier" | WorkbenchAutomaticArtifactKind;
  expected: unknown;
  actual: unknown;
  artifactId?: string;
  toolCalls: string[];
  passed: boolean;
};

export type DurableArtifactCorpusReport = {
  reportVersion: "durable-artifact-gate-v1";
  fixture: "durable-artifact-corpus-v1";
  productionAccessed: false;
  machineGatePassed: boolean;
  failures: string[];
  dossierFidelity: number;
  dossierFidelityChecks: Array<{
    artifactId: string;
    sessionId: string;
    matched: boolean;
    missingRequiredSections: string[];
  }>;
  claimSupportCoverage: number;
  claimSupportChecks: ClaimSupportCheck[];
  claimSupportIntegrityFailureCount: number;
  claimSupportIntegrityFailures: Array<{ artifactId: string; failure: string }>;
  persistedArtifactEquality: number;
  persistedArtifactEqualityChecks: Array<{ artifactId: string; matched: boolean }>;
  candidateRecall: number;
  candidatePrecision: number;
  expectedCandidateLabels: string[];
  actualCandidateLabels: string[];
  expectedKinds: KindMix;
  actualKinds: KindMix;
  expectedPublishedKinds: KindMix;
  actualPublishedKinds: KindMix;
  unexpectedKindCount: number;
  missingExpectedKindCount: number;
  logbookRetrievalRecallAt5: number;
  logbookRetrieval: Array<{ query: string; artifactId: string; rank?: number; passed: boolean }>;
  mcpRetrievalRecallAt5: number;
  mcpRetrieval: Array<{ query: string; artifactId: string; rank?: number; passed: boolean }>;
  reuseTaskPassRate: number;
  reuseTasks: DurableArtifactReuseTaskResult[];
  rawSessionToolsUsedByReuseTasks: string[];
  protocolLeakCount: number;
  protocolLeaks: Array<{ artifactId: string; phrase: string }>;
  duplicateSubstantiveFingerprintCount: number;
  duplicateSubstantiveFingerprints: Array<{ fingerprint: string; artifactIds: string[] }>;
  maxCandidateRunProvenanceSize: number;
  candidateRunProvenanceSizes: Array<{ candidateId: string; size: number }>;
  candidateDiscoveryPageDurationMs: number;
  candidateDiscoveryPageSize: number;
  performanceFixture: {
    sessionCount: number;
    toolsPerSession: number;
    evidenceItemsPerSession: number;
    totalEvidenceItems: number;
  };
  humanReview: {
    completed: false;
    passed: false;
    requiredForProduction: true;
    criteria: { medianOverallAtLeast: 4; minimumArtifactOverall: 3; completionRate: 1 };
    worksheet: Array<{
      artifactId: string;
      kind: string;
      title: string;
      findability: null;
      grounding: null;
      reusability: null;
      specificity: null;
      readability: null;
      completed: false;
      notes: string;
    }>;
  };
};

const EXPECTED_CANDIDATE_LABELS = [
  "adr|session:decision-artifact-logbook|session:decision-artifact-logbook",
  "adr|session:decision-local-first|session:decision-local-first",
  "incident_timeline|session:incident-root-cause|session:incident-root-cause",
  "incident_timeline|session:incident-unproven-cause|session:incident-unproven-cause",
  "runbook|session:migration-fixed|session:migration-fixed",
  "runbook|session:oauth-fixed|session:oauth-fixed",
  "runbook|session:repeated-error:1|session:repeated-error:1,session:repeated-error:2"
].sort();

const EXPECTED_KINDS: KindMix = { adr: 2, incident_timeline: 2, runbook: 3 };
const EXPECTED_PUBLISHED_KINDS: KindMix = { adr: 1, incident_timeline: 1, runbook: 1 };
const REQUIRED_CLAIM_SUPPORT: Record<
  WorkbenchAutomaticArtifactKind,
  Array<{ path: string; supportKind: WorkbenchClaimSupport["supportKind"] }>
> = {
  runbook: [
    { path: "problemSignature.symptoms[0]", supportKind: "problem" },
    { path: "problemSignature.errorStrings[0]", supportKind: "problem" },
    { path: "problemSignature.affectedScope", supportKind: "problem" },
    { path: "preconditions[0]", supportKind: "problem" },
    { path: "reproSteps[0]", supportKind: "problem" },
    { path: "fixSteps[0]", supportKind: "change" },
    { path: "commands[0]", supportKind: "change" },
    { path: "changedFiles[0]", supportKind: "change" },
    { path: "validationChecks[0]", supportKind: "verification" },
    { path: "environmentRequirements[0]", supportKind: "problem" },
    { path: "preventionNotes[0]", supportKind: "remediation" }
  ],
  adr: [
    { path: "context", supportKind: "problem" },
    { path: "decision", supportKind: "decision" },
    { path: "status", supportKind: "decision" },
    { path: "alternatives[0]", supportKind: "alternative" },
    { path: "consequences[0]", supportKind: "decision" }
  ],
  incident_timeline: [
    { path: "symptom", supportKind: "problem" },
    { path: "impact", supportKind: "problem" },
    { path: "timeline[0].summary", supportKind: "timeline" },
    { path: "timeline[1].summary", supportKind: "timeline" },
    { path: "timeline[2].summary", supportKind: "timeline" },
    { path: "timeline[3].summary", supportKind: "timeline" },
    { path: "rootCause", supportKind: "root_cause" },
    { path: "contributingFactors[0]", supportKind: "problem" },
    { path: "remediation[0]", supportKind: "remediation" },
    { path: "prevention[0]", supportKind: "remediation" },
    { path: "status", supportKind: "verification" }
  ]
};
const PROTOCOL_PHRASES = [
  "cursor pagination",
  "canonical evidence",
  "evidence manifest",
  "authoring run",
  "single provenance",
  "weak multi-session join",
  "published artifact"
] as const;
const RAW_SESSION_TOOLS = new Set([
  "search_sessions",
  "get_session",
  "get_session_excerpt",
  "get_session_transcript",
  "list_project_sessions",
  "get_project_history"
]);

export async function runDurableArtifactCorpus(): Promise<DurableArtifactCorpusReport> {
  const fixtureDir = await mkdtemp(join(tmpdir(), "masthead-durable-artifact-corpus-"));
  const performanceDir = await mkdtemp(join(tmpdir(), "masthead-durable-artifact-performance-"));
  let db: MastheadDatabase | undefined;
  let performanceDb: MastheadDatabase | undefined;
  try {
    db = await openFixtureDatabase(join(fixtureDir, "masthead.sqlite"));
    seedDurableArtifactCorpus(db);
    seedAcceptanceEnrichments(db);
    const candidates = discoverArtifactCandidates(db, corpusSessionIds());
    const postPublicationCanonicalDossiers = new Map<string, SessionDossierDto>();
    const selected = [
      requireCandidate(candidates, "runbook", "session:oauth-fixed"),
      requireCandidate(candidates, "adr", "session:decision-local-first"),
      requireCandidate(candidates, "incident_timeline", "session:incident-root-cause")
    ];
    const receipts: WorkbenchAuthoringReceiptV3[] = [];
    const submittedOutputByArtifactId = new Map<string, Record<string, unknown>>();

    for (const candidate of selected) {
      const opened = openAgentLedAuthoringRun(db, {
        actorId: "durable-artifact-gate",
        databaseId: getOrCreateDatabaseIdentity(db),
        sessionIds: candidate.provenanceSessionIds
      });
      const bundle = buildDurableArtifactFixtureBundleV3(opened.run, candidate);
      const submitted = submitAuthoringBundle(db, { bundle, runId: opened.run.runId });
      if (!submitted.accepted) throw new Error(`fixture_bundle_rejected:${JSON.stringify(submitted.findings)}`);
      const receipt = finishAuthoringRun(db, { runId: opened.run.runId });
      if (receipt.contractVersion !== "workbench-authoring-v3") throw new Error("fixture_v3_receipt_required");
      receipts.push(receipt);
      for (const sessionId of candidate.provenanceSessionIds) {
        const canonical = getSessionDossier(db, sessionId);
        if (!canonical) throw new Error(`fixture_dossier_missing:${sessionId}`);
        postPublicationCanonicalDossiers.set(sessionId, structuredClone(canonical));
      }
      submittedOutputByArtifactId.set(receipt.optionalArtifacts[0]!.artifactId, structuredClone(bundle.artifacts[0]!.output));
    }

    const expectedLabels = EXPECTED_CANDIDATE_LABELS;
    const actualLabels = candidates.map(candidateLabel).sort();
    const expectedLabelSet = new Set(expectedLabels);
    const actualLabelSet = new Set(actualLabels);
    const matchingCandidateCount = actualLabels.filter((label) => expectedLabelSet.has(label)).length;
    const actualKinds = countCandidateKinds(candidates);
    const actualPublishedKinds = countPublishedKinds(receipts);
    const kindDifference = compareKindMix(EXPECTED_KINDS, actualKinds);
    const publishedKindDifference = compareKindMix(EXPECTED_PUBLISHED_KINDS, actualPublishedKinds);

    const dossierFidelityChecks = receipts.flatMap((receipt) => receipt.dossierArtifactIds.map((artifactId, index) => {
      const sessionId = selected[receipts.indexOf(receipt)]!.provenanceSessionIds[index]!;
      const detail = requireArtifact(db!, artifactId);
      const comparison = comparePublishedDossierToCanonical(
        detail.body,
        postPublicationCanonicalDossiers.get(sessionId)!
      );
      return {
        artifactId,
        matched: comparison.matched,
        missingRequiredSections: comparison.missingRequiredSections,
        sessionId
      };
    }));

    const optionalArtifacts = receipts.map((receipt) => requireArtifact(db!, receipt.optionalArtifacts[0]!.artifactId));
    const persistedArtifactEqualityChecks = optionalArtifacts.map((artifact) => ({
      artifactId: artifact.capsule.artifactId,
      matched: persistedArtifactEqualsSubmission(
        artifact.body,
        submittedOutputByArtifactId.get(artifact.capsule.artifactId)
      )
    }));
    const claimSupportEvaluations = receipts.map((receipt) => {
      const artifactId = receipt.optionalArtifacts[0]!.artifactId;
      const persisted = requireArtifact(db!, artifactId);
      return {
        artifactId,
        evaluation: evaluatePersistedClaimSupport(
          receipt.optionalArtifacts[0]!.kind,
          persisted.body,
          evidenceTextByRef(db!, receipt.optionalArtifacts[0]!.provenanceSessionIds)
        )
      };
    });
    const claimSupportChecks = claimSupportEvaluations.flatMap(({ artifactId, evaluation }) =>
      evaluation.checks.map((check) => ({ ...check, artifactId }))
    );
    const claimSupportIntegrityFailures = claimSupportEvaluations.flatMap(({ artifactId, evaluation }) =>
      evaluation.integrityFailures.map((failure) => ({ artifactId, failure }))
    );
    const protocolLeaks = optionalArtifacts.flatMap((artifact) => {
      const body = JSON.stringify(artifact.body).toLowerCase();
      return PROTOCOL_PHRASES.flatMap((phrase) => body.includes(phrase) ? [{ artifactId: artifact.capsule.artifactId, phrase }] : []);
    });
    const duplicateSubstantiveFingerprints = duplicateFingerprints(optionalArtifacts.map((artifact) => ({
      artifactId: artifact.capsule.artifactId,
      fingerprint: substantiveFingerprint(
        artifact.capsule.kind as WorkbenchAutomaticArtifactKind,
        artifact.body as Record<string, unknown>
      )
    })));

    const dossierBySession = new Map<string, string>();
    for (const receipt of receipts) {
      selected[receipts.indexOf(receipt)]!.provenanceSessionIds.forEach((sessionId, index) => dossierBySession.set(sessionId, receipt.dossierArtifactIds[index]!));
    }
    const optionalByKind = new Map(receipts.map((receipt) => [receipt.optionalArtifacts[0]!.kind, receipt.optionalArtifacts[0]!.artifactId]));
    const retrievalCases = [
      { artifactId: optionalByKind.get("runbook")!, kind: "runbook" as const, query: "invalid state nonce" },
      { artifactId: optionalByKind.get("adr")!, kind: "adr" as const, query: "hosted database" },
      { artifactId: optionalByKind.get("incident_timeline")!, kind: "incident_timeline" as const, query: "writer leases" },
      { artifactId: dossierBySession.get("session:oauth-fixed")!, kind: "session_dossier" as const, query: "auth/callback.ts" },
      { artifactId: dossierBySession.get("session:oauth-fixed")!, kind: "session_dossier" as const, query: "OAuth callback test failed" }
    ];
    const logbookRetrieval = retrievalCases.map((entry) => {
      const result = searchLogbookArtifacts(db!, { kind: entry.kind, limit: 5, q: entry.query });
      const rank = result.artifacts.findIndex((artifact) => artifact.artifactId === entry.artifactId);
      return { artifactId: entry.artifactId, passed: rank >= 0 && rank < 5, query: entry.query, rank: rank >= 0 ? rank + 1 : undefined };
    });
    const mcpRetrieval = retrievalCases.map((entry) => {
      const result = callMcpTool(db!, "search_artifacts", { kind: entry.kind, limit: 5, query: entry.query }) as {
        artifacts: Array<{ artifactId: string }>;
      };
      const rank = result.artifacts.findIndex((artifact) => artifact.artifactId === entry.artifactId);
      return { artifactId: entry.artifactId, passed: rank >= 0 && rank < 5, query: entry.query, rank: rank >= 0 ? rank + 1 : undefined };
    });
    const reuseTasks = runReuseTasks(db!);
    const rawSessionToolsUsedByReuseTasks = [...new Set(reuseTasks.flatMap((task) => task.toolCalls).filter((tool) => RAW_SESSION_TOOLS.has(tool)))];

    performanceDb = await openFixtureDatabase(join(performanceDir, "masthead.sqlite"));
    const performanceFixture = seedToolHeavyPerformanceSessions(performanceDb, 100, 60);
    const discoveryStarted = performance.now();
    const performancePage = discoverArtifactCandidatePage(performanceDb, { limit: 100 });
    const candidateDiscoveryPageDurationMs = Math.round((performance.now() - discoveryStarted) * 100) / 100;

    const canaryArtifacts = receipts.flatMap((receipt) => [
      ...receipt.dossierArtifactIds.map((artifactId) => requireArtifact(db!, artifactId)),
      requireArtifact(db!, receipt.optionalArtifacts[0]!.artifactId)
    ]);
    const reportWithoutFailures = {
      reportVersion: "durable-artifact-gate-v1" as const,
      fixture: "durable-artifact-corpus-v1" as const,
      productionAccessed: false as const,
      dossierFidelity: ratio(dossierFidelityChecks.filter((check) => check.matched).length, dossierFidelityChecks.length),
      dossierFidelityChecks,
      claimSupportCoverage: ratio(claimSupportChecks.filter((check) => check.passed).length, claimSupportChecks.length),
      claimSupportChecks,
      claimSupportIntegrityFailureCount: claimSupportIntegrityFailures.length,
      claimSupportIntegrityFailures,
      persistedArtifactEquality: ratio(
        persistedArtifactEqualityChecks.filter((check) => check.matched).length,
        persistedArtifactEqualityChecks.length
      ),
      persistedArtifactEqualityChecks,
      candidateRecall: ratio(matchingCandidateCount, expectedLabels.length),
      candidatePrecision: ratio(matchingCandidateCount, actualLabels.length),
      expectedCandidateLabels: expectedLabels,
      actualCandidateLabels: actualLabels,
      expectedKinds: EXPECTED_KINDS,
      actualKinds,
      expectedPublishedKinds: EXPECTED_PUBLISHED_KINDS,
      actualPublishedKinds,
      unexpectedKindCount: kindDifference.unexpected + publishedKindDifference.unexpected,
      missingExpectedKindCount: kindDifference.missing + publishedKindDifference.missing,
      logbookRetrievalRecallAt5: ratio(logbookRetrieval.filter((entry) => entry.passed).length, logbookRetrieval.length),
      logbookRetrieval,
      mcpRetrievalRecallAt5: ratio(mcpRetrieval.filter((entry) => entry.passed).length, mcpRetrieval.length),
      mcpRetrieval,
      reuseTaskPassRate: ratio(reuseTasks.filter((task) => task.passed).length, reuseTasks.length),
      reuseTasks,
      rawSessionToolsUsedByReuseTasks,
      protocolLeakCount: protocolLeaks.length,
      protocolLeaks,
      duplicateSubstantiveFingerprintCount: duplicateSubstantiveFingerprints.length,
      duplicateSubstantiveFingerprints,
      maxCandidateRunProvenanceSize: Math.max(...selected.map((candidate) => candidate.provenanceSessionIds.length)),
      candidateRunProvenanceSizes: selected.map((candidate) => ({ candidateId: candidate.candidateId, size: candidate.provenanceSessionIds.length })),
      candidateDiscoveryPageDurationMs,
      candidateDiscoveryPageSize: performancePage.scannedSessionIds.length,
      performanceFixture,
      humanReview: {
        completed: false as const,
        passed: false as const,
        requiredForProduction: true as const,
        criteria: { completionRate: 1 as const, medianOverallAtLeast: 4 as const, minimumArtifactOverall: 3 as const },
        worksheet: canaryArtifacts.map((artifact) => ({
          artifactId: artifact.capsule.artifactId,
          kind: artifact.capsule.kind,
          title: artifact.capsule.title,
          findability: null,
          grounding: null,
          reusability: null,
          specificity: null,
          readability: null,
          completed: false as const,
          notes: ""
        }))
      }
    };
    const failures = durableArtifactMachineFailures(reportWithoutFailures);
    return { ...reportWithoutFailures, failures, machineGatePassed: failures.length === 0 };
  } finally {
    db?.close();
    performanceDb?.close();
    await Promise.all([
      rm(fixtureDir, { force: true, recursive: true }),
      rm(performanceDir, { force: true, recursive: true })
    ]);
  }
}

export function durableArtifactMachineFailures(report: Omit<DurableArtifactCorpusReport, "failures" | "machineGatePassed">): string[] {
  const failures: string[] = [];
  if (report.dossierFidelity < 1) failures.push("dossier_fidelity_below_1");
  if (report.claimSupportCoverage < 1) failures.push("claim_support_coverage_below_1");
  if (report.claimSupportIntegrityFailureCount > 0) failures.push("claim_support_integrity_failed");
  if (report.persistedArtifactEquality < 1) failures.push("persisted_artifact_differs_from_submission");
  if (report.candidateRecall < 1) failures.push("candidate_recall_below_1");
  if (report.candidatePrecision < 1) failures.push("candidate_precision_below_1");
  if (report.logbookRetrievalRecallAt5 < 1) failures.push("logbook_recall_at_5_below_1");
  if (report.mcpRetrievalRecallAt5 < 1) failures.push("mcp_recall_at_5_below_1");
  if (report.reuseTaskPassRate < 1) failures.push("reuse_task_pass_rate_below_1");
  if (report.rawSessionToolsUsedByReuseTasks.length > 0) failures.push("reuse_task_used_raw_session_tool");
  if (report.protocolLeakCount > 0) failures.push("protocol_leak_detected");
  if (report.duplicateSubstantiveFingerprintCount > 0) failures.push("duplicate_substantive_fingerprint_detected");
  if (report.unexpectedKindCount > 0) failures.push("unexpected_kind_detected");
  if (report.missingExpectedKindCount > 0) failures.push("expected_kind_missing");
  if (report.maxCandidateRunProvenanceSize > 12) failures.push("candidate_run_provenance_exceeds_12");
  if (report.candidateDiscoveryPageSize !== 100) failures.push("candidate_discovery_page_not_100");
  if (
    report.performanceFixture.sessionCount !== 100 ||
    report.performanceFixture.toolsPerSession < 50 ||
    report.performanceFixture.evidenceItemsPerSession < 100 ||
    report.performanceFixture.totalEvidenceItems !==
      report.performanceFixture.sessionCount * report.performanceFixture.evidenceItemsPerSession
  ) failures.push("candidate_discovery_fixture_not_tool_heavy");
  if (report.candidateDiscoveryPageDurationMs > 2_000) failures.push("candidate_discovery_page_exceeds_2000ms");
  return failures;
}

export function comparePublishedDossierToCanonical(
  published: unknown,
  canonical: SessionDossierDto
): { matched: boolean; missingRequiredSections: string[] } {
  const canonicalClone = jsonClone(canonical) as Record<string, unknown>;
  delete canonicalClone.artifacts;
  const expected = neutralizeDossierPublicationState({
    ...canonicalClone,
    capturedAt: "normalized-captured-at",
    snapshotVersion: "canonical-session-dossier-v1"
  });
  const actual = neutralizeDossierPublicationState(isRecord(published) ? jsonClone(published) : {});
  const capturedAtPresent = typeof actual.capturedAt === "string" && actual.capturedAt.length > 0;
  if (capturedAtPresent) actual.capturedAt = "normalized-captured-at";
  const missingRequiredSections = CANONICAL_DOSSIER_REQUIRED_SECTIONS.filter(
    (section) => !Object.prototype.hasOwnProperty.call(actual, section)
  );
  return {
    matched: capturedAtPresent && missingRequiredSections.length === 0 && isDeepStrictEqual(actual, expected),
    missingRequiredSections: [...missingRequiredSections]
  };
}

function neutralizeDossierPublicationState(body: Record<string, unknown>): Record<string, unknown> {
  const reuse = isRecord(body.reuse) ? body.reuse : undefined;
  if (!reuse) return body;
  delete reuse.mcpIncluded;
  if (typeof reuse.copyableContext === "string") {
    reuse.copyableContext = reuse.copyableContext.replace(
      /\nAgent retrieval: (?:included|excluded)$/u,
      "\nAgent retrieval: publication-state"
    );
  }
  return body;
}

export function evaluatePersistedClaimSupport(
  kind: WorkbenchAutomaticArtifactKind,
  persisted: unknown,
  evidenceByRef: Map<string, string>
): { checks: ClaimSupportCheck[]; expectedCount: number; passedCount: number; integrityFailures: string[] } {
  const body = isRecord(persisted) ? persisted : {};
  const rawSupports = Array.isArray(body.claimSupport) ? body.claimSupport : [];
  const supports = claimSupports(body);
  const required = REQUIRED_CLAIM_SUPPORT[kind];
  const checks = required.map(({ path, supportKind }) => {
    const pathSupports = supports.filter((support) => support.path === path);
    const support = pathSupports.length === 1 && pathSupports[0]!.supportKind === supportKind
      ? pathSupports[0]
      : undefined;
    const excerpt = normalize(support?.excerpt ?? "");
    const exactExcerpt = Boolean(
      support &&
      excerpt.length >= 20 &&
      normalize(evidenceByRef.get(support.evidenceRef) ?? "").includes(excerpt)
    );
    const pathResolved = resolvePath(body, path);
    return {
      evidenceRef: support?.evidenceRef,
      exactExcerpt,
      excerptLength: excerpt.length,
      passed: pathSupports.length === 1 && Boolean(support) && pathResolved && exactExcerpt,
      path,
      pathResolved,
      requiredSupportKind: supportKind,
      supportCount: pathSupports.length
    };
  });
  const expectedPairs = new Set(required.map(({ path, supportKind }) => `${path}|${supportKind}`));
  const integrityFailures = [
    ...(Array.isArray(body.claimSupport) ? [] : ["claim_support_not_array"]),
    ...Array.from({ length: Math.max(0, rawSupports.length - supports.length) }, (_, index) => `malformed_claim_support:${index}`),
    ...checks.flatMap((check) => check.passed ? [] : [`required_claim_support_failed:${check.path}:${check.requiredSupportKind}`]),
    ...supports.flatMap((support) => expectedPairs.has(`${support.path}|${support.supportKind}`)
      ? []
      : [`unexpected_claim_support:${support.path}:${support.supportKind}`])
  ];
  return {
    checks,
    expectedCount: required.length,
    integrityFailures,
    passedCount: checks.filter((check) => check.passed).length
  };
}

export function persistedArtifactEqualsSubmission(persisted: unknown, submitted: unknown): boolean {
  return submitted !== undefined && isDeepStrictEqual(persisted, submitted);
}

function runReuseTasks(db: MastheadDatabase): DurableArtifactReuseTaskResult[] {
  return [
    artifactOnlyReuseTask(db, {
      task: "oauth_repair",
      kind: "runbook",
      query: "invalid state nonce",
      expected: "Apply the recorded callback change: modified auth/callback.ts.",
      derive: (body) => stringArray(body.fixSteps)[0]
    }),
    artifactOnlyReuseTask(db, {
      task: "rejected_architecture_alternative",
      kind: "adr",
      query: "hosted database",
      expected: "Rejected alternative: a hosted database would break offline operation.",
      derive: (body) => stringArray(body.alternatives)[0]
    }),
    artifactOnlyReuseTask(db, {
      task: "incident_sequence",
      kind: "incident_timeline",
      query: "writer leases",
      expected: [
        "Ingestion requests failed across production.",
        "Triage isolated exhausted SQLite writer leases.",
        "The stuck writer was recycled and backlog processing resumed.",
        "Service health and backlog drain were verified."
      ],
      derive: (body) => Array.isArray(body.timeline)
        ? body.timeline.map((entry) => isRecord(entry) && typeof entry.summary === "string" ? entry.summary : undefined)
        : []
    }),
    artifactOnlyReuseTask(db, {
      task: "dossier_changed_file",
      kind: "session_dossier",
      query: "auth/callback.ts",
      expected: "auth/callback.ts",
      derive: (body) => Array.isArray(body.files)
        ? body.files.map((entry) => isRecord(entry) && typeof entry.path === "string" ? entry.path : undefined)
          .find((path) => path === "auth/callback.ts")
        : undefined
    }),
    artifactOnlyReuseTask(db, {
      task: "dossier_verification_failure",
      kind: "session_dossier",
      query: "OAuth callback test failed",
      expected: "OAuth callback test failed with an invalid state nonce.",
      derive: (body) => Array.isArray(body.attention)
        ? body.attention.map((entry) => isRecord(entry) && typeof entry.detail === "string" ? entry.detail : undefined)
          .find((detail) => detail?.includes("OAuth callback test failed"))
        : undefined
    })
  ];
}

function artifactOnlyReuseTask(
  db: MastheadDatabase,
  input: {
    task: DurableArtifactReuseTaskResult["task"];
    kind: DurableArtifactReuseTaskResult["kind"];
    query: string;
    expected: unknown;
    derive: (body: Record<string, unknown>) => unknown;
  }
): DurableArtifactReuseTaskResult {
  const toolCalls: string[] = [];
  const call = (tool: "search_artifacts" | "get_artifact", args: Record<string, unknown>): unknown => {
    toolCalls.push(tool);
    return callMcpTool(db, tool, args);
  };
  const search = call("search_artifacts", { kind: input.kind, limit: 5, query: input.query }) as {
    artifacts: Array<{ artifactId: string }>;
  };
  const artifactId = search.artifacts[0]?.artifactId;
  const detail = artifactId
    ? call("get_artifact", { artifactId }) as { artifact?: { body?: unknown } }
    : undefined;
  const body = isRecord(detail?.artifact?.body) ? detail.artifact.body : {};
  const actual = input.derive(body);
  return {
    actual,
    artifactId,
    expected: input.expected,
    kind: input.kind,
    passed: JSON.stringify(actual) === JSON.stringify(input.expected) &&
      toolCalls.join(",") === "search_artifacts,get_artifact",
    query: input.query,
    task: input.task,
    toolCalls
  };
}

function callMcpTool(db: MastheadDatabase, name: string, args: Record<string, unknown>): unknown {
  const line = handleMcpLine(db, JSON.stringify({
    id: `durable-gate:${name}`,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: args, name }
  }));
  if (!line) throw new Error(`mcp_no_response:${name}`);
  const response = JSON.parse(line) as {
    error?: unknown;
    result?: { content?: Array<{ text?: string }> };
  };
  if (response.error) throw new Error(`mcp_error:${name}:${JSON.stringify(response.error)}`);
  const text = response.result?.content?.[0]?.text;
  if (!text) throw new Error(`mcp_empty_result:${name}`);
  return JSON.parse(text);
}

async function openFixtureDatabase(path: string): Promise<MastheadDatabase> {
  const db = await openMastheadDatabase(path);
  migrateDatabase(db);
  return db;
}

function seedAcceptanceEnrichments(db: MastheadDatabase): void {
  const sessions = [
    ["session:oauth-fixed", "Repair OAuth callback failure"],
    ["session:decision-local-first", "Choose local-first storage"],
    ["session:incident-root-cause", "Production ingestion outage"]
  ] as const;
  for (const [sessionId, title] of sessions) {
    const durableEnrichment = {
      generatedAt: "2026-07-01T12:10:00.000Z",
      sessionDossier: {
        blockers: [],
        continuation: { constraints: [], openQuestions: [] },
        decisions: [],
        evidenceRefs: [],
        keyWork: [`Captured ${title}.`],
        verification: {
          commands: [],
          evidenceRefs: [],
          failures: [],
          status: "unknown" as const,
          summary: "Canonical fixture evidence determines verification state."
        },
        warnings: []
      },
      sessionSummary: {
        confidence: "high" as const,
        evidenceRefs: [],
        state: "completed" as const,
        text: title
      },
      sessionTitle: {
        basis: "dominant_work" as const,
        confidence: "high" as const,
        evidenceRefs: [],
        text: title
      },
      source: "deterministic" as const,
      version: "session-capsule-v4" as const
    };
    upsertSessionEnrichment(db, {
      content: {
        candidateDecisions: [],
        durableEnrichment,
        searchPhrases: [title],
        technologies: [],
        title,
        topics: ["durable-artifact-acceptance"],
        unresolved: []
      },
      contentFingerprint: `durable-artifact-acceptance:${sessionId}`,
      enrichmentKind: "session_capsule",
      generatedAt: "2026-07-01T12:10:00.000Z",
      promptVersion: "session-capsule-v4",
      provider: "deterministic",
      sessionId,
      sourceRefs: [],
      status: "current"
    });
  }
}

function requireCandidate(
  candidates: WorkbenchArtifactCandidate[],
  kind: WorkbenchAutomaticArtifactKind,
  seedSessionId: string
): WorkbenchArtifactCandidate {
  const candidate = candidates.find((entry) => entry.kind === kind && entry.seedSessionId === seedSessionId);
  if (!candidate) throw new Error(`fixture_candidate_missing:${kind}:${seedSessionId}`);
  return candidate;
}

function requireArtifact(db: MastheadDatabase, artifactId: string) {
  const artifact = getLogbookArtifactDetail(db, artifactId);
  if (!artifact) throw new Error(`fixture_artifact_missing:${artifactId}`);
  return artifact;
}

function candidateLabel(candidate: WorkbenchArtifactCandidate): string {
  return `${candidate.kind}|${candidate.seedSessionId}|${candidate.provenanceSessionIds.join(",")}`;
}

function emptyKindMix(): KindMix {
  return { adr: 0, incident_timeline: 0, runbook: 0 };
}

function countCandidateKinds(candidates: WorkbenchArtifactCandidate[]): KindMix {
  return candidates.reduce((mix, candidate) => {
    mix[candidate.kind] += 1;
    return mix;
  }, emptyKindMix());
}

function countPublishedKinds(receipts: WorkbenchAuthoringReceiptV3[]): KindMix {
  return receipts.reduce((mix, receipt) => {
    for (const artifact of receipt.optionalArtifacts) mix[artifact.kind] += 1;
    return mix;
  }, emptyKindMix());
}

function compareKindMix(expected: KindMix, actual: KindMix): { missing: number; unexpected: number } {
  return (Object.keys(expected) as WorkbenchAutomaticArtifactKind[]).reduce((result, kind) => ({
    missing: result.missing + Math.max(0, expected[kind] - actual[kind]),
    unexpected: result.unexpected + Math.max(0, actual[kind] - expected[kind])
  }), { missing: 0, unexpected: 0 });
}

function evidenceTextByRef(db: MastheadDatabase, sessionIds: string[]): Map<string, string> {
  const evidence = new Map<string, string>();
  for (const sessionId of sessionIds) {
    for (const item of iterateSessionTranscriptItems(db, { order: "asc", sessionId })) {
      evidence.set(item.itemId, item.kind === "file_effect" ? `${item.label} ${item.text}` : item.text);
    }
  }
  return evidence;
}

function claimSupports(output: Record<string, unknown>): WorkbenchClaimSupport[] {
  if (!Array.isArray(output.claimSupport)) return [];
  return output.claimSupport.filter((value): value is WorkbenchClaimSupport =>
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.evidenceRef === "string" &&
    typeof value.excerpt === "string" &&
    typeof value.supportKind === "string"
  );
}

function resolvePath(output: Record<string, unknown>, path: string): boolean {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let current: unknown = output;
  for (const part of parts) {
    if (!isRecord(current) && !Array.isArray(current)) return false;
    if (!(part in current)) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return current !== undefined;
}

function duplicateFingerprints(entries: Array<{ artifactId: string; fingerprint: string }>) {
  const groups = new Map<string, string[]>();
  for (const entry of entries) groups.set(entry.fingerprint, [...(groups.get(entry.fingerprint) ?? []), entry.artifactId]);
  return [...groups.entries()].flatMap(([fingerprint, artifactIds]) => artifactIds.length > 1 ? [{ artifactIds, fingerprint }] : []);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
