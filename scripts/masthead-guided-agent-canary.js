#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const RESERVED_PORTS = new Set([5173, 17_373, 17_383]);
const HEALTH_TIMEOUT_MS = 15_000;
// Nine fully inspected sessions plus bounded revision loops regularly exceed ten minutes on a fresh agent.
const AGENT_TIMEOUT_MS = 20 * 60_000;
const FRESH_AGENT_ENV_ALLOWLIST = new Set([
  "HTTPS_PROXY", "HTTP_PROXY", "LANG", "LC_ALL", "NO_PROXY", "OPENAI_API_KEY", "PATH",
  "SSL_CERT_DIR", "SSL_CERT_FILE", "TERM", "TMPDIR", "TZ"
]);

export const GUIDED_AGENT_FIXTURE = [
  { key: "artifact-signal-runbook", profile: "artifact_signal", title: "Repair a stale OAuth nonce after callback validation fails" },
  { key: "artifact-signal-adr", profile: "artifact_signal", title: "Choose local SQLite as the canonical session store" },
  { key: "artifact-signal-incident", profile: "artifact_signal", title: "Recover a writer lease after an unclean daemon exit" },
  { key: "tool-heavy", profile: "tool_heavy", title: "Trace a migration failure through repeated schema probes" },
  { key: "ordinary-one", profile: "ordinary", title: "Rename a Workbench activity label" },
  { key: "ordinary-two", profile: "ordinary", title: "Clarify a Logbook provenance tooltip" },
  { key: "sparse", profile: "sparse", title: "Answer a narrow repository question" },
  { key: "tempting-template-one", profile: "tempting_template", title: "Review a selected session evidence package" },
  { key: "tempting-template-two", profile: "tempting_template", title: "Review another selected session evidence package" }
];

export async function allocateGuidedCanaryPort(options = {}) {
  const createLoopbackServer = options.createServer ?? createServer;
  for (;;) {
    const server = createLoopbackServer();
    const port = await new Promise((resolvePort, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") return reject(new Error("canary_port_allocation_failed"));
        resolvePort(address.port);
      });
    });
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    if (!RESERVED_PORTS.has(port)) return port;
  }
}

export function assertIsolatedGuidedCanaryRuntime(input) {
  const home = resolve(input.homeDir ?? homedir());
  const forbiddenRoots = [
    join(home, ".local", "share", "masthead-production"),
    join(home, ".config", "masthead-production")
  ];
  for (const [label, candidate] of [["database", input.databasePath], ["manifest", input.manifestPath]]) {
    const requested = resolve(candidate);
    if (forbiddenRoots.some((root) => isWithin(requested, root))) {
      throw new Error(`guided_canary_refuses_live_production_${label}`);
    }
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535 || RESERVED_PORTS.has(input.port)) {
    throw new Error("guided_canary_requires_non_production_port");
  }
  const url = new URL(input.baseUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || Number(url.port) !== input.port) {
    throw new Error("guided_canary_requires_loopback_instance_bound_url");
  }
}

export function buildGuidedAgentLaunchPackage(input) {
  const requestId = requiredOpaque(input.requestId, "requestId");
  const startCommand = requiredOpaque(input.startCommand, "startCommand");
  if (!startCommand.includes(requestId)) throw new Error("guided_canary_start_command_not_request_bound");
  if (!resolveCommand(startCommand).startsWith(resolve(input.instanceDirectory) + "/")) {
    throw new Error("guided_canary_start_command_not_instance_bound");
  }
  const serialized = `${requestId}\n${startCommand}`;
  for (const forbidden of input.forbiddenValues ?? []) {
    if (forbidden && serialized.includes(forbidden)) throw new Error("guided_canary_launch_package_leaked_fixture_context");
  }
  return {
    schemaVersion: "masthead-guided-agent-launch-v1",
    requestId,
    startCommand
  };
}

export function guidedAgentCanaryFailures(report, _untrustedAgentReport) {
  const failures = [];
  if (report.fixtureSessionCount !== 9) failures.push("representative_fixture_not_nine_sessions");
  if (report.completeEvidenceCoverage !== 1) failures.push("complete_evidence_coverage_below_1");
  if (report.failedV3TemplateRejected !== true) failures.push("failed_v3_template_not_rejected");
  if (report.sessionClaimSupportCoverage !== 1) failures.push("session_claim_support_below_1");
  if (report.optionalClaimSupportCoverage !== 1) failures.push("optional_claim_support_below_1");
  if (report.opportunityDispositionCoverage !== 1) failures.push("opportunity_disposition_below_1");
  if (report.draftRevisionCount < 2) failures.push("agent_revision_cycle_not_exercised");
  if (!Array.isArray(report.findingCodes) || report.findingCodes.length === 0) failures.push("structured_revision_findings_missing");
  if (!Array.isArray(report.acceptedArtifactIds) || report.acceptedArtifactIds.length === 0) failures.push("accepted_artifacts_missing");
  for (const kind of ["runbook", "adr", "incident_timeline"]) {
    if ((report.acceptedArtifactKindCounts?.[kind] ?? 0) < 1) failures.push(`required_${kind}_missing`);
    if ((report.opportunityKindCounts?.[kind] ?? 0) < 1) failures.push(`required_${kind}_opportunity_missing`);
  }
  if (report.artifactOnlyReusePassRate !== 1) failures.push("artifact_only_reuse_below_1");
  if (report.optionalArtifactOnlyReusePassRate !== 1) failures.push("optional_artifact_reuse_below_1");
  if (report.duplicateSessionTemplateCount !== 0) failures.push("duplicate_session_template_detected");
  if (report.protocolLeakCount !== 0) failures.push("guided_protocol_leak_detected");
  if (report.unsupportedCompletionCount !== 0) failures.push("unsupported_completion_detected");
  if (report.canaryPublishedBeforeApprovalCount !== 0) failures.push("canary_bypassed");
  if (report.identityMismatchMutationCount !== 0) failures.push("identity_mismatch_mutated");
  if (report.harnessSuppliedAuthoredContent !== false) failures.push("harness_supplied_authored_content");
  if (report.outOfBandSessionListRequired !== false) failures.push("out_of_band_session_list_required");
  if (report.unboundedGenericDismissalCount !== 0) failures.push("unbounded_generic_dismissal_findings");
  if (report.humanReview?.signed !== true || report.humanReview?.specificityPassed !== true ||
      report.humanReview?.independentReusePassed !== true) failures.push("human_review_not_signed");
  return failures;
}

export function buildGuidedHumanReviewChallenge(requestId, trustedReport, reviewRequestedAt = new Date().toISOString()) {
  const acceptedArtifactIds = [...new Set(trustedReport.acceptedArtifactIds ?? [])].sort();
  const reportForHash = { ...trustedReport };
  delete reportForHash.humanReview;
  delete reportForHash.humanReviewChallenge;
  const trustedReportHash = hashCanonical(reportForHash);
  const binding = {
    schemaVersion: "masthead-guided-human-review-v1",
    requestId,
    acceptedArtifactIds,
    trustedReportHash,
    reviewRequestedAt
  };
  return { ...binding, reviewBindingHash: hashCanonical(binding) };
}

export function trustedHumanReview(review, challenge) {
  const valid = review && challenge && review.signed === true && review.specificityPassed === true &&
    review.independentReusePassed === true && typeof review.signedBy === "string" && review.signedBy.trim() &&
    Number.isFinite(Date.parse(review.signedAt)) && review.schemaVersion === challenge.schemaVersion &&
    review.requestId === challenge.requestId && review.trustedReportHash === challenge.trustedReportHash &&
    review.reviewBindingHash === challenge.reviewBindingHash &&
    JSON.stringify(review.acceptedArtifactIds) === JSON.stringify(challenge.acceptedArtifactIds) &&
    Date.parse(review.signedAt) >= Date.parse(challenge.reviewRequestedAt);
  if (!valid) return { signed: false, specificityPassed: false, independentReusePassed: false };
  return {
    signed: true,
    specificityPassed: true,
    independentReusePassed: true,
    signedAt: review.signedAt,
    signedBy: review.signedBy,
    schemaVersion: challenge.schemaVersion,
    requestId: challenge.requestId,
    acceptedArtifactIds: challenge.acceptedArtifactIds,
    trustedReportHash: challenge.trustedReportHash,
    reviewBindingHash: challenge.reviewBindingHash
  };
}

export function verifyPersistedGuidedAgentReview(persisted, review) {
  if (persisted?.reportVersion !== "guided-agent-canary-v1" || persisted?.productionAccessed !== false ||
      !persisted?.report?.humanReviewChallenge || !persisted?.launchPackage?.requestId) {
    throw new Error("guided_canary_persisted_report_invalid");
  }
  const storedChallenge = persisted.report.humanReviewChallenge;
  const expectedChallenge = buildGuidedHumanReviewChallenge(
    persisted.launchPackage.requestId,
    persisted.report,
    storedChallenge.reviewRequestedAt
  );
  if (canonicalJson(storedChallenge) !== canonicalJson(expectedChallenge)) {
    throw new Error("guided_canary_persisted_report_hash_mismatch");
  }
  const report = { ...persisted.report, humanReview: trustedHumanReview(review, storedChallenge) };
  const failures = guidedAgentCanaryFailures(report, persisted.untrustedAgentReport);
  return { ...persisted, report, failures, passed: failures.length === 0 };
}

export async function persistGuidedAgentReport(path, result) {
  await writeFile(resolve(path), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

export function buildFreshAgentEnvironment(environment, input) {
  const allowed = Object.fromEntries(Object.entries(environment).filter(([key, value]) =>
    value !== undefined && FRESH_AGENT_ENV_ALLOWLIST.has(key)
  ));
  return {
    ...allowed,
    CODEX_HOME: input.codexHome,
    HOME: input.agentHome,
    MASTHEAD_GUIDED_LAUNCH_PACKAGE: JSON.stringify(input.launchPackage)
  };
}

export async function runGuidedAgentCanary(options = {}, dependencyOverrides = {}) {
  const createWorkspace = dependencyOverrides.createWorkspace ?? (() => mkdtemp(join(tmpdir(), "masthead-guided-agent-canary-")));
  const allocatePort = dependencyOverrides.allocatePort ?? allocateGuidedCanaryPort;
  const prepareFixture = dependencyOverrides.prepareFixture ?? prepareGuidedCanaryFixture;
  const spawnDaemon = dependencyOverrides.spawnDaemon ?? spawnGuidedCanaryDaemon;
  const waitForHealth = dependencyOverrides.waitForHealth ?? waitForGuidedCanaryHealth;
  const createRequest = dependencyOverrides.createRequest ?? createGuidedCanaryRequest;
  const runAgent = dependencyOverrides.runAgent ?? runFreshAgentProcess;
  const verifyGate = dependencyOverrides.verifyGate ?? verifyGuidedAgentCanaryState;
  const readRevisions = dependencyOverrides.readRevisions ?? ((baseUrl) => getJson(`${baseUrl}/data/revisions`));
  const probeIdentityMismatch = dependencyOverrides.probeIdentityMismatch ?? probeIdentityMismatchWithoutMutation;
  const terminate = dependencyOverrides.terminateChild ?? terminateGuidedCanaryChild;
  const removeWorkspace = dependencyOverrides.removeWorkspace ?? ((path) => rm(path, { recursive: true, force: true }));
  const workspace = await createWorkspace();
  let child;
  let primaryError;
  try {
    const dataDirectory = join(workspace, "data");
    const databasePath = join(dataDirectory, "masthead.sqlite");
    const instanceDirectory = join(workspace, "instance");
    const manifestPath = join(instanceDirectory, "masthead-instance.json");
    const cliAuditPath = join(workspace, "fresh-agent-cli-audit.ndjson");
    const port = await allocatePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    assertIsolatedGuidedCanaryRuntime({ baseUrl, databasePath, manifestPath, port, homeDir: options.homeDir });
    await Promise.all([
      mkdir(dataDirectory, { recursive: true }),
      mkdir(instanceDirectory, { recursive: true }),
      mkdir(join(workspace, "agent"), { recursive: true }),
      mkdir(join(workspace, "agent-home"), { recursive: true }),
      mkdir(join(workspace, "codex-home"), { recursive: true })
    ]);
    const fixture = await prepareFixture({ baseUrl, cliAuditPath, databasePath, instanceDirectory, manifestPath, workspace });
    if (!fixture || !Array.isArray(fixture.sessionIds) || fixture.sessionIds.length !== 9) {
      throw new Error("guided_canary_fixture_contract_invalid");
    }
    child = spawnDaemon({ baseUrl, databasePath, dataDirectory, instanceDirectory, manifestPath, port, workspace });
    await waitForHealth(baseUrl, child, HEALTH_TIMEOUT_MS);
    const request = await createRequest({ baseUrl, manifestPath, sessionIds: fixture.sessionIds });
    const launchPackage = buildGuidedAgentLaunchPackage({
      requestId: request.requestId,
      startCommand: request.startCommand,
      instanceDirectory,
      forbiddenValues: [...fixture.sessionIds, ...(fixture.fixtureAnswers ?? [])]
    });
    options.onLaunchPackage?.(structuredClone(launchPackage));
    const revisionsBefore = await readRevisions(baseUrl);
    const identityMismatchMutationCount = await probeIdentityMismatch({
      baseUrl,
      databasePath,
      requestId: request.requestId
    });
    const agentReport = await runAgent({
      agentCommand: options.agentCommand,
      agentHome: join(workspace, "agent-home"),
      agentTimeoutMs: options.agentTimeoutMs ?? AGENT_TIMEOUT_MS,
      agentWorkspace: join(workspace, "agent"),
      codexHome: join(workspace, "codex-home"),
      launchPackage,
      baseUrl
    });
    let report;
    let failures;
    if (dependencyOverrides.verifyGate) {
      report = { fixtureSessionCount: 9, ...agentReport };
      failures = await verifyGate(report, { baseUrl, databasePath, manifestPath, requestId: request.requestId });
    } else {
      report = await verifyGate({
        agentReport,
        baseUrl,
        cliAuditEntries: await readCliAudit(cliAuditPath),
        databasePath,
        fixtureSessionIds: fixture.sessionIds,
        harnessSuppliedAuthoredContent: Boolean(dependencyOverrides.runAgent),
        identityMismatchMutationCount,
        requestId: request.requestId,
        revisionsBefore
      });
      const reviewChallenge = buildGuidedHumanReviewChallenge(request.requestId, report);
      const suppliedReview = options.collectHumanReview
        ? await options.collectHumanReview(structuredClone(reviewChallenge), structuredClone(report))
        : options.humanReviewFile
          ? JSON.parse(await readFile(resolve(options.humanReviewFile), "utf8"))
          : undefined;
      report.humanReviewChallenge = reviewChallenge;
      report.humanReview = trustedHumanReview(suppliedReview, reviewChallenge);
      failures = guidedAgentCanaryFailures(report, agentReport);
    }
    return {
      reportVersion: "guided-agent-canary-v1",
      productionAccessed: false,
      launchPackage,
      report,
      untrustedAgentReport: agentReport,
      failures,
      passed: failures.length === 0
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const teardownErrors = [];
    try { await terminate(child); } catch (error) { teardownErrors.push(error); }
    try { await removeWorkspace(workspace); } catch (error) { teardownErrors.push(error); }
    if (teardownErrors.length > 0) {
      throw new AggregateError(
        primaryError === undefined ? teardownErrors : [primaryError, ...teardownErrors],
        "guided_canary_teardown_failed"
      );
    }
  }
}

export async function verifyGuidedAgentCanaryState(input) {
  const db = new DatabaseSync(input.databasePath, { readOnly: true });
  let state;
  try {
    state = readTrustedGuidedCanaryState(db, input.requestId, input.fixtureSessionIds);
  } finally {
    db.close();
  }
  const artifacts = await Promise.all(state.acceptedArtifactIds.map(async (artifactId) => {
    const response = await getJson(`${input.baseUrl}/logbook/artifacts/${encodeURIComponent(artifactId)}`);
    if (response?.artifact?.capsule?.artifactId !== artifactId) throw new Error("trusted_canary_artifact_identity_mismatch");
    return response.artifact;
  }));
  const reuseTasks = artifacts
    .filter((artifact) => artifact?.capsule?.kind === "session_dossier")
    .map(buildArtifactOnlyReuseTask);
  const optionalReuseTasks = artifacts
    .filter((artifact) => ["runbook", "adr", "incident_timeline"].includes(artifact?.capsule?.kind))
    .map(buildOptionalArtifactOnlyReuseTask);
  const operationAudit = auditFreshAgentOperations(input.cliAuditEntries ?? [], {
    assignmentCount: state.assignmentCount,
    assignmentIds: state.assignmentIds,
    draftRevisionCount: state.draftRevisionCount,
    evidenceInspectionCount: state.evidenceInspectionCount,
    evidenceSessionCount: state.evidenceSessionCount,
    requestId: input.requestId,
    sessionIds: input.fixtureSessionIds
  });
  const revisionsAfter = await getJson(`${input.baseUrl}/data/revisions`);
  const acceptance = await importBuiltModule("src/workbench/authoring/durableArtifactCorpusAcceptance.js");
  const deterministicGate = acceptance.guidedAuthoringGateReport(acceptance.runGuidedAuthoringQualityCorpus());
  return {
    fixtureSessionCount: input.fixtureSessionIds.length,
    completeEvidenceCoverage: state.completeEvidenceCoverage,
    failedV3TemplateRejected: deterministicGate.failedV3TemplateRejected,
    sessionClaimSupportCoverage: state.sessionClaimSupportCoverage,
    optionalClaimSupportCoverage: state.optionalClaimSupportCoverage,
    opportunityDispositionCoverage: state.opportunityDispositionCoverage,
    draftRevisionCount: state.draftRevisionCount,
    findingCodes: state.findingCodes,
    acceptedArtifactIds: state.acceptedArtifactIds,
    acceptedArtifactKindCounts: state.acceptedArtifactKindCounts,
    artifactOnlyReusePassRate: ratio(reuseTasks.filter(({ passed }) => passed).length, input.fixtureSessionIds.length),
    artifactOnlyReuseTasks: reuseTasks,
    opportunityKindCounts: state.opportunityKindCounts,
    optionalArtifactOnlyReusePassRate: ratio(
      ["runbook", "adr", "incident_timeline"].filter((kind) =>
        optionalReuseTasks.some((task) => task.kind === kind && task.passed)
      ).length,
      3
    ),
    optionalArtifactOnlyReuseTasks: optionalReuseTasks,
    duplicateSessionTemplateCount: countCode(state.acceptedFindingCodes, "duplicate_session_template"),
    protocolLeakCount: countCode(state.acceptedFindingCodes, "protocol_leakage"),
    unsupportedCompletionCount: countCode(state.acceptedFindingCodes, "unsupported_completion"),
    canaryPublishedBeforeApprovalCount: state.canaryPublishedBeforeApprovalCount,
    identityMismatchMutationCount: input.identityMismatchMutationCount,
    harnessSuppliedAuthoredContent: input.harnessSuppliedAuthoredContent,
    outOfBandSessionListRequired: operationAudit.outOfBandSessionListRequired,
    agentOperationAudit: operationAudit,
    unboundedGenericDismissalCount: countCode(state.acceptedFindingCodes, "unsupported_opportunity_dismissal"),
    revisionChangesVerified:
      revisionsAfter.workbench > input.revisionsBefore.workbench &&
      revisionsAfter.logbook > input.revisionsBefore.logbook,
    reviewableArtifacts: artifacts.map(({ capsule, body, provenanceSessionIds }) => ({ capsule, body, provenanceSessionIds }))
  };
}

function readTrustedGuidedCanaryState(db, requestId, fixtureSessionIds) {
  const request = db.prepare(
    "SELECT status, canary_approved_at AS canaryApprovedAt, canary_approved_by AS canaryApprovedBy FROM guided_authoring_requests WHERE request_id = ?"
  ).get(requestId);
  if (!request || request.status !== "completed") throw new Error("trusted_canary_request_not_completed");
  const membership = db.prepare(
    "SELECT session_id AS sessionId FROM guided_authoring_request_sessions WHERE request_id = ? ORDER BY ordinal"
  ).all(requestId).map(({ sessionId }) => sessionId);
  if (membership.length !== fixtureSessionIds.length || membership.some((id, index) => id !== fixtureSessionIds[index])) {
    throw new Error("trusted_canary_fixture_membership_mismatch");
  }
  const assignments = db.prepare(
    `SELECT assignment_id AS assignmentId, canary, current_draft_revision AS currentDraftRevision,
            accepted_draft_revision AS acceptedDraftRevision, receipt_json AS receiptJson
     FROM guided_authoring_assignments WHERE request_id = ? ORDER BY ordinal`
  ).all(requestId);
  if (assignments.length === 0 || assignments.some(({ receiptJson }) => !receiptJson)) {
    throw new Error("trusted_canary_receipt_missing");
  }
  const findingCodes = [];
  const acceptedFindingCodes = [];
  const acceptedArtifactIds = [];
  const acceptedArtifactKindCounts = artifactKindCounts();
  const opportunityKindCounts = artifactKindCounts(false);
  let canaryPublishedBeforeApprovalCount = 0;
  let completeSessions = 0;
  let totalSessions = 0;
  let supportedSessionDrafts = 0;
  let totalSessionDrafts = 0;
  let supportedOptionalDrafts = 0;
  let totalOptionalDrafts = 0;
  let disposedOpportunities = 0;
  let totalOpportunities = 0;
  let evidenceInspectionCount = 0;
  for (const assignment of assignments) {
    const reviews = db.prepare(
      "SELECT revision, findings_json AS findingsJson, accepted FROM guided_authoring_draft_reviews WHERE assignment_id = ? ORDER BY revision"
    ).all(assignment.assignmentId);
    if (reviews.length !== assignment.currentDraftRevision || assignment.acceptedDraftRevision === null) {
      throw new Error("trusted_canary_revision_history_incomplete");
    }
    for (const review of reviews) {
      const codes = JSON.parse(review.findingsJson).map(({ code }) => code);
      findingCodes.push(...codes);
      if (review.accepted === 1) acceptedFindingCodes.push(...codes);
    }
    const assignmentSessions = db.prepare(
      "SELECT session_id AS sessionId FROM guided_authoring_assignment_sessions WHERE assignment_id = ? ORDER BY ordinal"
    ).all(assignment.assignmentId);
    const assignmentOpportunities = db.prepare(
      `SELECT membership.opportunity_id AS opportunityId, opportunity.suggested_kind AS suggestedKind
       FROM guided_authoring_assignment_opportunities membership
       JOIN guided_authoring_opportunities opportunity
         ON opportunity.request_id = membership.request_id
        AND opportunity.opportunity_id = membership.opportunity_id
       WHERE membership.assignment_id = ? ORDER BY membership.ordinal`
    ).all(assignment.assignmentId);
    for (const { suggestedKind } of assignmentOpportunities) opportunityKindCounts[suggestedKind] += 1;
    const acceptedReview = reviews.find(({ accepted }) => accepted === 1);
    if (!acceptedReview) throw new Error("trusted_canary_accepted_draft_missing");
    const acceptedDraft = JSON.parse(db.prepare(
      "SELECT draft_json AS draftJson FROM guided_authoring_draft_reviews WHERE assignment_id = ? AND revision = ?"
    ).get(assignment.assignmentId, assignment.acceptedDraftRevision).draftJson);
    const enrichments = new Map(acceptedDraft.sessionEnrichments.map((entry) => [entry.sessionId, entry]));
    totalSessionDrafts += assignmentSessions.length;
    supportedSessionDrafts += assignmentSessions.filter(({ sessionId }) =>
      Array.isArray(enrichments.get(sessionId)?.claimSupport) && enrichments.get(sessionId).claimSupport.length > 0
    ).length;
    totalOptionalDrafts += acceptedDraft.artifacts.length;
    supportedOptionalDrafts += acceptedDraft.artifacts.filter(({ output }) =>
      Array.isArray(output?.claimSupport) && output.claimSupport.length > 0
    ).length;
    const dispositions = new Set(acceptedDraft.opportunityDispositions.map(({ opportunityId }) => opportunityId));
    totalOpportunities += assignmentOpportunities.length;
    disposedOpportunities += assignmentOpportunities.filter(({ opportunityId }) => dispositions.has(opportunityId)).length;
    for (const { sessionId } of assignmentSessions) {
      totalSessions += 1;
      const total = canonicalEvidenceCount(db, sessionId);
      evidenceInspectionCount += Math.ceil(total / 100);
      const accessed = db.prepare(
        "SELECT COUNT(DISTINCT evidence_ref) AS count FROM guided_authoring_evidence_access WHERE assignment_id = ? AND session_id = ?"
      ).get(assignment.assignmentId, sessionId).count;
      if (total > 0 && accessed === total) completeSessions += 1;
    }
    const receipt = JSON.parse(assignment.receiptJson);
    const assignmentPublishedAt = [];
    for (const artifact of receipt.publishedArtifacts ?? []) {
      const persisted = db.prepare(
        `SELECT artifact_kind AS artifactKind, publication_status AS publicationStatus,
                published_at AS publishedAt FROM session_artifacts WHERE artifact_id = ?`
      ).get(artifact.artifactId);
      if (!persisted || persisted.publicationStatus !== "published") throw new Error("trusted_canary_artifact_not_published");
      acceptedArtifactIds.push(artifact.artifactId);
      acceptedArtifactKindCounts[persisted.artifactKind] += 1;
      assignmentPublishedAt.push(persisted.publishedAt);
    }
    if (assignment.canary === 1) {
      const approval = db.prepare(
        `SELECT decision, reviewed_at AS reviewedAt, reviewed_by AS reviewedBy
         FROM guided_authoring_operator_reviews
         WHERE request_id = ? AND assignment_id = ? AND draft_revision = ?`
      ).get(requestId, assignment.assignmentId, assignment.acceptedDraftRevision);
      if (approval?.reviewedAt !== request.canaryApprovedAt || approval?.reviewedBy !== request.canaryApprovedBy) {
        throw new Error("trusted_canary_approval_binding_mismatch");
      }
      canaryPublishedBeforeApprovalCount += countCanaryPublicationsBeforeApproval(assignmentPublishedAt, approval);
    }
  }
  return {
    acceptedArtifactIds,
    acceptedArtifactKindCounts,
    acceptedFindingCodes,
    assignmentCount: assignments.length,
    assignmentIds: assignments.map(({ assignmentId }) => assignmentId),
    canaryPublishedBeforeApprovalCount,
    completeEvidenceCoverage: ratio(completeSessions, totalSessions),
    draftRevisionCount: assignments.reduce((total, assignment) => total + assignment.currentDraftRevision, 0),
    evidenceInspectionCount,
    evidenceSessionCount: totalSessions,
    findingCodes: [...new Set(findingCodes)],
    sessionClaimSupportCoverage: ratio(supportedSessionDrafts, totalSessionDrafts),
    optionalClaimSupportCoverage: ratio(supportedOptionalDrafts, totalOptionalDrafts),
    opportunityKindCounts,
    opportunityDispositionCoverage: ratio(disposedOpportunities, totalOpportunities)
  };
}

function artifactKindCounts(includeDossiers = true) {
  return {
    ...(includeDossiers ? { session_dossier: 0 } : {}),
    runbook: 0,
    adr: 0,
    incident_timeline: 0
  };
}

function canonicalEvidenceCount(db, sessionId) {
  return ["messages", "tool_calls", "tool_results", "file_effects", "runtime_signals", "checkpoints"]
    .reduce((total, table) => total + db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id = ?`).get(sessionId).count, 0);
}

async function probeIdentityMismatchWithoutMutation({ baseUrl, databasePath, requestId }) {
  const capabilities = await getJson(`${baseUrl}/workbench/authoring/capabilities`);
  const identity = {
    baseUrl: capabilities.baseUrl,
    buildSha: capabilities.buildSha,
    databaseId: capabilities.databaseId,
    instanceId: capabilities.instanceId,
    instanceManifest: capabilities.instanceManifest
  };
  const before = snapshotGuidedAuthoringDatabase(databasePath);
  const response = await fetch(`${baseUrl}/workbench/authoring/requests/${encodeURIComponent(requestId)}/start`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ expectedIdentity: { ...identity, instanceId: `${identity.instanceId}:mismatch` } })
  });
  const body = await response.json();
  if (response.status !== 409 || body?.error?.code !== "instance_identity_mismatch") {
    throw new Error("trusted_canary_identity_mismatch_not_rejected");
  }
  const after = snapshotGuidedAuthoringDatabase(databasePath);
  return before.hash === after.hash ? 0 : 1;
}

export function snapshotGuidedAuthoringState(db) {
  const tableNames = db.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND (name LIKE 'guided_authoring_%' OR name = 'data_revisions')
     ORDER BY name`
  ).all().map(({ name }) => name);
  const tables = {};
  for (const tableName of tableNames) {
    const rows = db.prepare(`SELECT * FROM "${tableName.replaceAll('"', '""')}"`).all();
    tables[tableName] = rows.map((row) => canonicalJson(row)).sort();
  }
  return { hash: hashCanonical(tables), tables };
}

function snapshotGuidedAuthoringDatabase(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try { return snapshotGuidedAuthoringState(db); } finally { db.close(); }
}

export function countCanaryPublicationsBeforeApproval(publishedAtValues, approval) {
  if (!approval || approval.decision !== "approved" || !Number.isFinite(Date.parse(approval.reviewedAt))) {
    throw new Error("trusted_canary_approval_missing");
  }
  return publishedAtValues.filter((publishedAt) =>
    Number.isFinite(Date.parse(publishedAt)) && publishedAt < approval.reviewedAt
  ).length;
}

function countCode(codes, code) {
  return codes.filter((candidate) => candidate === code).length;
}

export function buildArtifactOnlyReuseTask(artifact) {
  const sessionId = artifact?.provenanceSessionIds?.length === 1 ? artifact.provenanceSessionIds[0] : undefined;
  const fixture = GUIDED_AGENT_FIXTURE.find(({ key }) => sessionId === `session:guided-canary:${key}`);
  const enrichment = artifact.body.durableEnrichment;
  const capsuleSummary = typeof enrichment?.sessionSummary?.text === "string"
    ? enrichment.sessionSummary.text.replace(/\s+/gu, " ").trim()
    : "";
  const dossierResult = [
    enrichment?.sessionDossier?.outcome,
    ...(enrichment?.sessionDossier?.keyWork ?? [])
  ].filter((value) => typeof value === "string" && value.trim()).join(" ");
  const hasDossierResult = dossierResult.length > 0;
  const verificationStatus = typeof enrichment?.sessionDossier?.verification?.status === "string"
    ? enrichment.sessionDossier.verification.status.trim().toLowerCase()
    : "";
  const verificationSummary = typeof enrichment?.sessionDossier?.verification?.summary === "string"
    ? enrichment.sessionDossier.verification.summary
    : "";
  const derivedAnswer = [
    enrichment?.sessionTitle?.text,
    capsuleSummary,
    ...(enrichment?.sessionDossier?.keyWork ?? []),
    verificationStatus ? `Verification: ${verificationStatus}.` : undefined,
    verificationSummary
  ].filter((value) => typeof value === "string").join(" ").replace(/\s+/gu, " ").trim();
  const expectedKeywords = fixture ? significantWords(fixture.title) : [];
  const normalized = derivedAnswer.toLowerCase();
  const matchingKeywords = expectedKeywords.filter((keyword) => normalized.includes(keyword));
  const normalizedSummary = capsuleSummary.toLowerCase();
  const summaryMatchingKeywords = expectedKeywords.filter((keyword) => normalizedSummary.includes(keyword));
  const requiredKeywordCount = Math.min(2, expectedKeywords.length);
  const verificationBoundary = /^(?:passed|failed|mixed|missing|unknown)$/u.test(verificationStatus) ||
    /\b(?:passed|verified|confirmed|failed|verification (?:was )?(?:not run|not captured|missing|unknown)|no verification|unverified)\b/iu.test(verificationSummary);
  const expectedAssertions = [
    { code: "fixture_specific_terms", expected: expectedKeywords, matched: matchingKeywords },
    {
      code: "capsule_summary_fixture_specific_result",
      expected: expectedKeywords,
      matched: summaryMatchingKeywords,
      required: hasDossierResult
    },
    {
      code: "verification_boundary",
      expected: ["passed", "verified", "confirmed", "failed", "verification not run", "verification not captured", "verification missing", "verification unknown", "no verification", "unverified"],
      matched: verificationBoundary
    }
  ];
  return {
    taskId: `reuse:${artifact?.capsule?.artifactId ?? "unknown"}`,
    artifactId: artifact?.capsule?.artifactId,
    sourceSessionId: sessionId,
    question: "What specific work was completed, and what verification boundary did the artifact record?",
    expectedAssertions,
    derivedAnswer,
    passed: Boolean(fixture) && matchingKeywords.length >= requiredKeywordCount &&
      (!hasDossierResult || summaryMatchingKeywords.length >= requiredKeywordCount) &&
      verificationBoundary
  };
}

export function buildOptionalArtifactOnlyReuseTask(artifact) {
  const kind = artifact?.capsule?.kind;
  const body = artifact?.body && typeof artifact.body === "object" ? artifact.body : {};
  let derivedAnswer;
  let expectedAssertions;
  if (kind === "runbook") {
    derivedAnswer = stringValues(body.fixSteps).join(" ");
    const normalized = derivedAnswer.toLowerCase();
    expectedAssertions = [
      { code: "oauth_nonce_repair_action", matched: normalized.includes("nonce") && /\b(?:clear|cleared|rotate|rotated|replace|replaced)\b/u.test(normalized) },
      { code: "oauth_callback_target", matched: normalized.includes("auth/callback.ts") && /\b(?:retry|callback|validation)\b/u.test(normalized) },
      { code: "oauth_pending_request_binding", matched: /\b(?:bind|binding|bound)\b/u.test(normalized) && normalized.includes("pending") && /\b(?:authorization|request)\b/u.test(normalized) }
    ];
  } else if (kind === "adr") {
    derivedAnswer = [...stringValues(body.alternatives), ...stringValues(body.consequences), ...stringValues(body.context)].join(" ");
    const normalized = derivedAnswer.toLowerCase();
    expectedAssertions = [
      { code: "hosted_database_rejected", matched: normalized.includes("hosted") && normalized.includes("database") },
      { code: "offline_rationale", matched: normalized.includes("offline") && /\b(?:break|dependency|operation|local)\b/u.test(normalized) }
    ];
  } else if (kind === "incident_timeline") {
    const timeline = Array.isArray(body.timeline)
      ? body.timeline.map((entry) => typeof entry?.summary === "string" ? entry.summary : "")
      : [];
    derivedAnswer = timeline;
    const normalized = timeline.map((entry) => entry.toLowerCase());
    const impact = normalized.findIndex((entry) => entry.includes("writer lease") && /\b(?:could not|blocked|failed|unavailable)\b/u.test(entry));
    const remediation = normalized.findIndex((entry, index) => index > impact && entry.includes("lease") && /\b(?:clear|cleared|remove|removed|restart|restarted)\b/u.test(entry));
    const recovery = normalized.findIndex((entry, index) => index > remediation && /\b(?:integrity|probe|canary)\b/u.test(entry) && /\b(?:passed|succeeded|published|healthy|recovered)\b/u.test(entry));
    expectedAssertions = [
      { code: "writer_lease_incident", matched: impact >= 0 },
      { code: "ordered_lease_remediation", matched: remediation > impact },
      { code: "ordered_recovery_verification", matched: recovery > remediation },
      {
        code: "unclean_exit_root_cause",
        matched: typeof body.rootCause === "string" &&
          /\bunclean\b/iu.test(body.rootCause) && /\bdaemon\b/iu.test(body.rootCause) && /\bexit\b/iu.test(body.rootCause)
      }
    ];
  } else {
    derivedAnswer = "";
    expectedAssertions = [{ code: "supported_optional_kind", matched: false }];
  }
  return {
    artifactId: artifact?.capsule?.artifactId,
    derivedAnswer,
    expectedAssertions,
    kind,
    passed: expectedAssertions.every(({ matched }) => matched === true),
    question: kind === "runbook"
      ? "What concrete OAuth nonce repair should another engineer perform?"
      : kind === "adr"
        ? "Which hosted alternative was rejected, and why?"
        : "What ordered writer-lease incident and recovery sequence occurred?",
    taskId: `optional-reuse:${artifact?.capsule?.artifactId ?? "unknown"}`
  };
}

function stringValues(value) {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

export function auditFreshAgentOperations(entries, expected) {
  const failedSaveRepairLimit = 8;
  const allowed = new Set(["start", "inspect", "scaffold", "save", "review", "finish"]);
  const records = entries.map((entry) => Array.isArray(entry) ? { argv: entry, status: 0 } : entry);
  const assignmentIds = new Set(expected.assignmentIds ?? []);
  const sessionIds = new Set(expected.sessionIds ?? []);
  const subcommands = records.map(({ argv }) => Array.isArray(argv) && argv[0] === "workbench" && argv[1] === "author" ? argv[2] : undefined);
  const successfulSaveCount = records.filter(({ status }, index) => subcommands[index] === "save" && status === 0).length;
  const failedSaveCount = records.filter(({ status }, index) => subcommands[index] === "save" && status === 1).length;
  const attemptedSaveCount = records.filter((_record, index) => subcommands[index] === "save").length;
  const invalid = records.some(({ argv, status }, index) => {
    const subcommand = subcommands[index];
    if (!allowed.has(subcommand)) return true;
    const assignmentId = flagValue(argv, "--assignment");
    if (status !== 0) {
      if (subcommand !== "save" || status !== 1 || !assignmentId || !assignmentIds.has(assignmentId)) return true;
      const file = flagValue(argv, "--file");
      if (!file) return true;
      const repairedInPlace = records.some(({ argv: laterArgv, status: laterStatus }, laterIndex) => (
        laterIndex > index &&
        laterStatus === 0 &&
        subcommands[laterIndex] === "save" &&
        flagValue(laterArgv, "--assignment") === assignmentId &&
        flagValue(laterArgv, "--file") === file
      ));
      if (!repairedInPlace) return true;
    }
    if (subcommand === "start" && flagValue(argv, "--request") !== expected.requestId) return true;
    if (subcommand !== "start" && (!assignmentId || !assignmentIds.has(assignmentId))) return true;
    const sessionId = flagValue(argv, "--session");
    return Boolean(sessionId && !sessionIds.has(sessionId));
  }) || failedSaveCount > failedSaveRepairLimit;
  const counts = Object.fromEntries([...allowed].map((kind) => [kind, subcommands.filter((value) => value === kind).length]));
  const missing = counts.start < expected.assignmentCount ||
    counts.inspect !== (expected.evidenceInspectionCount ?? expected.evidenceSessionCount) ||
    counts.scaffold !== expected.assignmentCount ||
    successfulSaveCount !== expected.draftRevisionCount || counts.finish !== expected.assignmentCount;
  return {
    entries: records.length,
    counts,
    invalidOperationCount: invalid ? 1 : 0,
    outOfBandSessionListRequired: invalid || missing,
    saveAttempts: {
      attempted: attemptedSaveCount,
      failed: failedSaveCount,
      repairLimit: failedSaveRepairLimit,
      successful: successfulSaveCount
    }
  };
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

async function readCliAudit(path) {
  try {
    return (await readFile(path, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function significantWords(text) {
  const ignored = new Set(["after", "another", "before", "choose", "review", "selected", "session", "through"]);
  return [...new Set(text.toLowerCase().match(/[a-z0-9]+/gu) ?? [])]
    .filter((word) => word.length >= 4 && !ignored.has(word));
}

function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashCanonical(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

async function prepareGuidedCanaryFixture({ baseUrl, cliAuditPath, databasePath, instanceDirectory, manifestPath }) {
  const { openMastheadDatabase } = await importBuiltModule("src/daemon/db/sqlite.js");
  const { migrateDatabase } = await importBuiltModule("src/daemon/db/schema.js");
  const db = await openMastheadDatabase(databasePath);
  const sessionIds = GUIDED_AGENT_FIXTURE.map(({ key }) => `session:guided-canary:${key}`);
  try {
    migrateDatabase(db);
    seedGuidedCanaryFixtureRows(db, sessionIds);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA optimize;");
  } finally {
    db.close();
  }
  await writeInstanceLauncher({ baseUrl, cliAuditPath, instanceDirectory, manifestPath });
  return { sessionIds, fixtureAnswers: GUIDED_AGENT_FIXTURE.map(({ title }) => title) };
}

export function seedGuidedCanaryFixtureRows(db, sessionIds) {
  const now = "2026-07-20T12:00:00.000Z";
  db.prepare("INSERT INTO hosts(host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)")
    .run("host:guided-canary", "guided-canary", now, now);
  db.prepare("INSERT INTO runtimes(runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)")
    .run("runtime:guided-canary", "codex", "fixture-only", now, now);
  const session = db.prepare(`INSERT INTO sessions(
    session_id, host_id, runtime_id, source_session_id, project_label, title, objective, lifecycle,
    started_at, last_activity_at, ended_at, source_confidence, created_at, updated_at
  ) VALUES (?, 'host:guided-canary', 'runtime:guided-canary', ?, 'Masthead canary', ?, ?, 'ended', ?, ?, ?, 'authoritative', ?, ?)`);
  const state = db.prepare(`INSERT INTO workbench_session_state(
    session_id, publication_status, next_action, transcript_status, quality_status,
    session_enrichment_status, session_dossier_status, bug_fix_trace_status, created_at, updated_at
  ) VALUES (?, 'publish_path', 'enrich', 'imported', 'passed', 'missing', 'missing', 'unknown', ?, ?)`);
  sessionIds.forEach((sessionId, index) => {
    const fixture = GUIDED_AGENT_FIXTURE[index];
    session.run(sessionId, `source:${fixture.key}`, fixture.title, `Determine reusable knowledge for ${fixture.profile}.`, now, now, now, now, now);
    seedGuidedCanarySessionEvidence(db, sessionId, fixture, index);
    state.run(sessionId, now, now);
  });
}

function seedGuidedCanarySessionEvidence(db, sessionId, fixture, index) {
  const minute = index * 20;
  const at = (offsetSeconds) => new Date(Date.parse("2026-07-20T12:00:00.000Z") + (minute * 60 + offsetSeconds) * 1_000).toISOString();
  if (fixture.key === "artifact-signal-runbook") {
    insertCanaryMessage(db, sessionId, "runbook-context", "user", [
      "The OAuth callback regression failed with an invalid state nonce after login.",
      "A pending authorization request and access to auth/callback.ts are required before retrying.",
      "If the replacement nonce can be replayed, restore the previous callback handler and stop."
    ].join(" "), at(0));
    insertCanaryToolResult(db, sessionId, "oauth-failure", "oauth_callback_regression", "failed", 1,
      "OAuth callback validation failed because the stored state nonce was stale.", at(1));
    insertCanaryMessage(db, sessionId, "runbook-action", "assistant",
      "Cleared the stale nonce in auth/callback.ts, bound a replacement to the pending authorization request, and retried callback validation.", at(2));
    insertCanaryFileEffect(db, sessionId, "oauth-callback-change", "auth/callback.ts", "modified", at(3));
    insertCanaryCheckpoint(db, sessionId, "oauth-verified", "verification_passed",
      "OAuth callback verification passed: the replacement nonce was accepted once and replay was rejected.", at(4));
    return;
  }
  if (fixture.key === "artifact-signal-adr") {
    insertCanaryMessage(db, sessionId, "adr-context", "user",
      "Masthead must keep canonical session data available offline, locally owned, and transactionally consistent without a network service.", at(0));
    insertCanaryMessage(db, sessionId, "adr-decision", "assistant",
      "Decision: adopt local SQLite as the canonical session store because one transactional file preserves offline operation and local ownership.", at(1));
    insertCanaryMessage(db, sessionId, "adr-alternative", "assistant",
      "Rejected alternative: a hosted database would break offline operation and add a required server dependency.", at(2));
    insertCanaryMessage(db, sessionId, "adr-consequence", "assistant",
      "The consequence is a single local writer; revisit this decision when multi-device concurrent writers become a supported requirement.", at(3));
    return;
  }
  if (fixture.key === "artifact-signal-incident") {
    insertCanaryCheckpoint(db, sessionId, "writer-lease:detected", "incident_detected",
      "Workbench publishing could not acquire the writer lease, so all daemon writes were unavailable after an unclean exit.", at(0));
    insertCanaryCheckpoint(db, sessionId, "writer-lease:investigated", "incident_investigated",
      "Investigation identified a stale writer lease owned by the prior daemon process after its unclean exit.", at(1));
    insertCanaryCheckpoint(db, sessionId, "writer-lease:mitigated", "incident_mitigated",
      "Validated the stale owner, cleared the writer lease, and restarted the daemon writer process.", at(2));
    insertCanaryCheckpoint(db, sessionId, "writer-lease:recovered", "incident_restored",
      "Database integrity passed, writer health recovered, and a canary draft published exactly once.", at(3));
    return;
  }
  if (fixture.key === "tool-heavy") {
    insertCanaryMessage(db, sessionId, "tool-heavy-objective", "user",
      "Trace why migration 34 cannot find the existing summary index, then verify the reconciled schema.", at(0));
    for (let ordinal = 0; ordinal < 50; ordinal += 1) {
      const probe = String(ordinal).padStart(2, "0");
      const status = ordinal === 48 ? "failed" : "succeeded";
      const output = ordinal === 48
        ? "Schema probe 48 failed: the summary index was missing before reconciliation."
        : ordinal === 49
          ? "Schema probe 49 passed: the summary index was present after reconciliation."
          : `Schema probe ${probe} read the migration catalog successfully.`;
      insertCanaryToolResult(db, sessionId, `schema-probe-${probe}`, "sqlite_schema_probe", status,
        status === "failed" ? 1 : 0, output, at(ordinal + 1), { probe: ordinal });
    }
    insertCanaryMessage(db, sessionId, "tool-heavy-outcome", "assistant",
      "Reconciled the summary index definition and confirmed migration 34 against the final schema probe.", at(52));
    return;
  }
  const text = fixture.profile === "sparse"
    ? fixture.title
    : `Completed ${fixture.title} and recorded the narrow verification boundary without creating reusable optional-artifact claims.`;
  insertCanaryMessage(db, sessionId, "objective", "user", fixture.title, at(0));
  if (fixture.profile !== "sparse") insertCanaryMessage(db, sessionId, "outcome", "assistant", text, at(1));
}

function canarySourceRef(sessionId, evidenceId) {
  return JSON.stringify({ evidenceId, fixture: "guided-agent-canary", sessionId });
}

function insertCanaryMessage(db, sessionId, evidenceId, role, text, observedAt) {
  db.prepare(`INSERT INTO messages(
    message_id, session_id, role, text_redacted, text_hash, observed_at, source_ref_json, confidence
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'authoritative')`).run(
    `${sessionId}:${evidenceId}`, sessionId, role, text, `${sessionId}:${evidenceId}:hash`, observedAt,
    canarySourceRef(sessionId, evidenceId)
  );
}

function insertCanaryToolResult(db, sessionId, evidenceId, toolName, status, exitCode, output, observedAt, args = {}) {
  const toolCallId = `${sessionId}:${evidenceId}:call`;
  const sourceRef = canarySourceRef(sessionId, evidenceId);
  db.prepare(`INSERT INTO tool_calls(
    tool_call_id, session_id, tool_name, arguments_redacted_json, started_at, source_ref_json
  ) VALUES (?, ?, ?, ?, ?, ?)`).run(toolCallId, sessionId, toolName, JSON.stringify(args), observedAt, sourceRef);
  db.prepare(`INSERT INTO tool_results(
    tool_result_id, tool_call_id, session_id, status, output_redacted, output_hash, exit_code, completed_at, source_ref_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    `${sessionId}:${evidenceId}:result`, toolCallId, sessionId, status, output,
    `${sessionId}:${evidenceId}:output-hash`, exitCode, observedAt, sourceRef
  );
}

function insertCanaryFileEffect(db, sessionId, evidenceId, path, effectKind, observedAt) {
  db.prepare(`INSERT INTO file_effects(
    file_effect_id, session_id, path, effect_kind, observed_at, source_ref_json
  ) VALUES (?, ?, ?, ?, ?, ?)`).run(
    `${sessionId}:${evidenceId}`, sessionId, path, effectKind, observedAt, canarySourceRef(sessionId, evidenceId)
  );
}

function insertCanaryCheckpoint(db, sessionId, evidenceId, checkpointKind, summary, observedAt) {
  db.prepare(`INSERT INTO checkpoints(
    checkpoint_id, session_id, checkpoint_kind, summary, observed_at, source_ref_json
  ) VALUES (?, ?, ?, ?, ?, ?)`).run(
    evidenceId, sessionId, checkpointKind, summary, observedAt, canarySourceRef(sessionId, evidenceId)
  );
}

async function writeInstanceLauncher({ baseUrl, cliAuditPath, instanceDirectory, manifestPath }) {
  const launcher = join(instanceDirectory, "bin", "mastheadctl");
  await mkdir(dirname(launcher), { recursive: true });
  const cliEntry = resolve("dist/daemon/src/cli/mastheadctl.js");
  await access(cliEntry);
  const source = `#!${process.execPath}
const { appendFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const argv = process.argv.slice(2);
const result = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(cliEntry)}, ...argv], {
  env: { ...process.env, MASTHEAD_DAEMON_URL: ${JSON.stringify(baseUrl)}, MASTHEAD_INSTANCE_MANIFEST: ${JSON.stringify(manifestPath)} },
  stdio: "inherit"
});
appendFileSync(${JSON.stringify(cliAuditPath)}, JSON.stringify({ argv, observedAt: new Date().toISOString(), status: result.status }) + "\\n", { mode: 0o600 });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
`;
  await writeFile(launcher, source, { mode: 0o700 });
  await chmod(launcher, 0o700);
}

function spawnGuidedCanaryDaemon(input) {
  return spawn(process.execPath, [resolve("dist/daemon/src/daemon/main.js")], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MASTHEAD_ALLOWED_ORIGINS: "masthead://app",
      MASTHEAD_BACKGROUND_HYDRATION: "0",
      MASTHEAD_CLI_COMMAND: join(input.instanceDirectory, "bin", "mastheadctl"),
      MASTHEAD_CODEX_HOME: join(input.workspace, "codex-home"),
      MASTHEAD_DATA_DIR: input.dataDirectory,
      MASTHEAD_DB_PATH: input.databasePath,
      MASTHEAD_GIT_REFRESH_MS: "0",
      MASTHEAD_HOOK_TRANSCRIPT_CATCHUP: "0",
      MASTHEAD_HOST: "127.0.0.1",
      MASTHEAD_INSTANCE_DIR: input.instanceDirectory,
      MASTHEAD_INSTANCE_MANIFEST: input.manifestPath,
      MASTHEAD_LIVE_COPY: "0",
      MASTHEAD_PORT: String(input.port),
      MASTHEAD_REMOTE_ENRICHMENT: "0",
      MASTHEAD_SKIP_BACKGROUND_HYDRATION: "1",
      MASTHEAD_STORE_PATH: join(input.dataDirectory, "legacy", "events.ndjson")
    },
    stdio: ["ignore", "inherit", "inherit"]
  });
}

async function createGuidedCanaryRequest({ baseUrl, sessionIds }) {
  const capabilities = await getJson(`${baseUrl}/workbench/authoring/capabilities`);
  const expectedIdentity = {
    baseUrl: capabilities.baseUrl,
    buildSha: capabilities.buildSha,
    databaseId: capabilities.databaseId,
    instanceId: capabilities.instanceId,
    instanceManifest: capabilities.instanceManifest
  };
  const created = await postJson(`${baseUrl}/workbench/authoring/requests`, {
    actorId: "guided-agent-canary",
    expectedIdentity,
    sessionIds
  }, 201);
  return { requestId: created.request.requestId, startCommand: created.nextAction.command };
}

export async function runFreshAgentProcess(input, dependencyOverrides = {}) {
  const { agentCommand, agentWorkspace, agentHome, codexHome, launchPackage } = input;
  if (!agentCommand || !resolve(agentCommand).startsWith("/")) throw new Error("fresh_agent_command_required");
  const spawnProcess = dependencyOverrides.spawnProcess ?? spawn;
  const approveCanary = dependencyOverrides.approveCanary ?? approveFreshAgentCanaryWhenStaged;
  return new Promise((resolveResult, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutKill;
    let forcedError;
    const child = spawnProcess(agentCommand, [], {
      cwd: agentWorkspace,
      env: buildFreshAgentEnvironment(process.env, { agentHome, codexHome, launchPackage }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(timeoutKill);
      callback();
    };
    const approval = approveCanary(
      input.baseUrl,
      launchPackage.requestId,
      child,
      (input.agentTimeoutMs ?? AGENT_TIMEOUT_MS) + 5_000
    ).then(
      () => ({ ok: true }),
      (error) => ({ error, ok: false })
    );
    const timeout = setTimeout(() => {
      forcedError = new Error("fresh_agent_timeout");
      child.kill("SIGTERM");
      timeoutKill = setTimeout(() => child.kill("SIGKILL"), 1_000);
    }, input.agentTimeoutMs ?? AGENT_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", async (code) => {
      if (forcedError) return finish(() => reject(forcedError));
      if (code !== 0) return finish(() => reject(new Error(`fresh_agent_failed:${code}:${stderr.trim()}`)));
      try {
        const approvalResult = await approval;
        if (!approvalResult.ok) throw approvalResult.error;
        finish(() => resolveResult(JSON.parse(stdout)));
      } catch (error) {
        finish(() => reject(error instanceof SyntaxError ? new Error("fresh_agent_report_invalid_json") : error));
      }
    });
  });
}

async function approveFreshAgentCanaryWhenStaged(baseUrl, requestId, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const capabilities = await getJson(`${baseUrl}/workbench/authoring/capabilities`);
  const expectedIdentity = {
    baseUrl: capabilities.baseUrl,
    buildSha: capabilities.buildSha,
    databaseId: capabilities.databaseId,
    instanceId: capabilities.instanceId,
    instanceManifest: capabilities.instanceManifest
  };
  while (Date.now() < deadline) {
    const pending = await getJson(`${baseUrl}/workbench/authoring/canaries/pending`);
    const canary = Array.isArray(pending) ? pending.find((entry) => entry.requestId === requestId) : undefined;
    if (canary) {
      return postJson(`${baseUrl}/workbench/authoring/requests/${encodeURIComponent(requestId)}/canary-decision`, {
        assignmentId: canary.assignmentId,
        decision: "approved",
        draftRevision: canary.draftRevision,
        evidenceRevision: canary.evidenceRevision,
        expectedIdentity,
        notes: "Isolated fresh-agent canary staged with complete evidence coverage; signed usefulness review remains a separate hard gate.",
        reviewedBy: "operator:isolated-guided-agent-canary"
      }, 200);
    }
    if (child.exitCode !== null || child.signalCode) throw new Error("fresh_agent_exited_before_canary_approval");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("fresh_agent_canary_approval_timeout");
}

export async function waitForGuidedCanaryHealth(baseUrl, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error("guided_canary_daemon_exited_before_health");
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error("guided_canary_health_timeout");
}

export async function terminateGuidedCanaryChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  await new Promise((resolveExit) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); }, 2_000);
    child.once("exit", () => { clearTimeout(timeout); resolveExit(); });
    child.kill("SIGTERM");
  });
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const body = await response.json();
  if (!response.ok) throw new Error(`guided_canary_http_${response.status}:${JSON.stringify(body)}`);
  return body;
}

async function postJson(url, body, expectedStatus) {
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (response.status !== expectedStatus) throw new Error(`guided_canary_http_${response.status}:${JSON.stringify(result)}`);
  return result;
}

async function importBuiltModule(path) {
  return import(pathToFileURL(resolve("dist/daemon", path)).href);
}

function resolveCommand(command) {
  const first = command.match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))/u);
  return resolve(first?.[1] ?? first?.[2] ?? first?.[3] ?? "");
}

function requiredOpaque(value, name) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw new Error(`guided_canary_${name}_required`);
  return value;
}

function isWithin(candidate, directory) {
  const fromRoot = relative(resolve(directory), resolve(candidate));
  return fromRoot === "" || (!fromRoot.startsWith("..") && !fromRoot.startsWith("/"));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const reportIndex = process.argv.indexOf("--report");
  const reportPath = reportIndex >= 0 ? resolve(process.argv[reportIndex + 1]) : undefined;
  const commandIndex = process.argv.indexOf("--agent-command");
  const agentCommand = commandIndex >= 0 ? process.argv[commandIndex + 1] : process.env.MASTHEAD_GUIDED_AGENT_COMMAND;
  const humanReviewIndex = process.argv.indexOf("--human-review-file");
  try {
    let result;
    if (process.argv.includes("--verify-review")) {
      if (!reportPath || humanReviewIndex < 0) throw new Error("guided_canary_verify_requires_report_and_human_review");
      const [persisted, review] = await Promise.all([
        readFile(reportPath, "utf8").then(JSON.parse),
        readFile(resolve(process.argv[humanReviewIndex + 1]), "utf8").then(JSON.parse)
      ]);
      result = verifyPersistedGuidedAgentReview(persisted, review);
    } else {
      result = await runGuidedAgentCanary({
        agentCommand,
        onLaunchPackage: (launchPackage) => process.stdout.write(`${JSON.stringify({ launchPackage })}\n`)
      });
      if (reportPath) {
        await persistGuidedAgentReport(reportPath, result);
      }
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
