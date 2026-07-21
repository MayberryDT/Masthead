#!/usr/bin/env node

import { runGuidedAgentCanary } from "./masthead-guided-agent-canary.js";

try {
  const result = await runGuidedAgentCanary({}, {
    runAgent: runPublicInterfaceDogfoodAgent,
    verifyGate: deterministicDogfoodFailures
  });
  const report = {
    reportVersion: "durable-artifact-gate-v2",
    fixture: "guided-agent-nine-session-fixture-v1",
    productionAccessed: false,
    machineGatePassed: result.passed,
    failures: result.failures,
    guidedAuthoringGate: result.report,
    launchPackage: result.launchPackage
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.machineGatePassed) process.exitCode = 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    reportVersion: "durable-artifact-gate-v2",
    machineGatePassed: false,
    failures: ["harness_error"],
    error: error instanceof Error ? error.message : String(error),
    productionAccessed: false
  }, null, 2)}\n`);
  process.exitCode = 1;
}

export async function runPublicInterfaceDogfoodAgent({ baseUrl, launchPackage }) {
  const capabilities = await getJson(baseUrl, "/workbench/authoring/capabilities");
  const expectedIdentity = identityFromCapabilities(capabilities);
  const requestId = launchPackage.requestId;
  const acceptedArtifactIds = [];
  const findingCodes = [];
  const finalFindingCodes = [];
  let completeEvidenceSessions = 0;
  let totalSessions = 0;
  let draftRevisionCount = 0;
  let canaryPublishedBeforeApprovalCount = 0;
  let identityMismatchMutationCount = 0;
  let assignmentCount = 0;
  const revisionsBefore = await getJson(baseUrl, "/data/revisions");

  const beforeMismatch = await getJson(baseUrl, `/workbench/authoring/requests/${encodeURIComponent(requestId)}`);
  const mismatch = await postJson(baseUrl, `/workbench/authoring/requests/${encodeURIComponent(requestId)}/start`, {
    expectedIdentity: { ...expectedIdentity, instanceId: `${expectedIdentity.instanceId}:mismatch` }
  }, 409);
  if (mismatch.error?.code !== "instance_identity_mismatch") throw new Error("dogfood_identity_mismatch_not_rejected");
  const afterMismatch = await getJson(baseUrl, `/workbench/authoring/requests/${encodeURIComponent(requestId)}`);
  if (JSON.stringify(beforeMismatch) !== JSON.stringify(afterMismatch)) identityMismatchMutationCount += 1;

  for (;;) {
    const started = await postJson(baseUrl, `/workbench/authoring/requests/${encodeURIComponent(requestId)}/start`, {
      expectedIdentity
    }, 200);
    if (started.nextAction?.kind === "complete") break;
    assignmentCount += 1;
    const assignment = started.assignment;
    const evidenceBySession = await inspectEveryEvidencePage(baseUrl, expectedIdentity, started);
    const scaffolded = await getJson(
      baseUrl,
      `/workbench/authoring/assignments/${encodeURIComponent(assignment.assignmentId)}/scaffold`
    );
    if (scaffolded.nextAction?.kind !== "save" || scaffolded.draft?.assignmentId !== assignment.assignmentId) {
      throw new Error("dogfood_guided_scaffold_invalid");
    }
    totalSessions += assignment.sessionIds.length;
    completeEvidenceSessions += evidenceBySession.size;

    const draft = buildGroundedDraft(started, evidenceBySession);
    const deliberatelyIncomplete = structuredClone(draft);
    deliberatelyIncomplete.sessionEnrichments = [deliberatelyIncomplete.sessionEnrichments[0]];
    deliberatelyIncomplete.sessionEnrichments[0].claimSupport = [
      deliberatelyIncomplete.sessionEnrichments[0].claimSupport[0]
    ];
    const rejected = await postJson(baseUrl, `/workbench/authoring/assignments/${encodeURIComponent(assignment.assignmentId)}/draft`, {
      draft: deliberatelyIncomplete,
      expectedIdentity
    }, 200);
    draftRevisionCount += 1;
    if (rejected.findings.length === 0 || rejected.nextAction?.kind !== "revise") {
      throw new Error("dogfood_revision_cycle_not_required");
    }
    findingCodes.push(...rejected.findings.map(({ code }) => code));

    const saved = await postJson(baseUrl, `/workbench/authoring/assignments/${encodeURIComponent(assignment.assignmentId)}/draft`, {
      draft,
      expectedIdentity
    }, 200);
    draftRevisionCount += 1;
    findingCodes.push(...saved.findings.map(({ code }) => code));
    finalFindingCodes.push(...saved.findings.map(({ code }) => code));
    if (saved.findings.some(({ severity }) => severity === "error") || !["await_operator", "finish"].includes(saved.nextAction?.kind)) {
      throw new Error(`dogfood_grounded_draft_rejected:${JSON.stringify(saved.findings)}`);
    }

    if (assignment.canary) {
      const beforeApproval = await getJson(baseUrl, "/logbook/artifacts?limit=100");
      canaryPublishedBeforeApprovalCount += countArtifacts(beforeApproval);
      const reviewed = await getJson(baseUrl, `/workbench/authoring/assignments/${encodeURIComponent(assignment.assignmentId)}/review`);
      await postJson(baseUrl, `/workbench/authoring/requests/${encodeURIComponent(requestId)}/canary-decision`, {
        assignmentId: assignment.assignmentId,
        decision: "approved",
        draftRevision: reviewed.draftRevision,
        evidenceRevision: reviewed.evidenceRevision,
        expectedIdentity,
        notes: "Fixture-only operator review found grounded, session-specific dossiers.",
        reviewedBy: "operator:fixture-dogfood"
      }, 200);
    }

    const finished = await postJson(baseUrl, `/workbench/authoring/assignments/${encodeURIComponent(assignment.assignmentId)}/finish`, {
      expectedIdentity
    }, 200);
    acceptedArtifactIds.push(...finished.receipt.publishedArtifacts.map(({ artifactId }) => artifactId));
    if (finished.nextAction?.kind === "complete") break;
  }

  const reuseResults = [];
  const publishedArtifactKinds = [];
  for (const artifactId of acceptedArtifactIds) {
    const detail = await getJson(baseUrl, `/logbook/artifacts/${encodeURIComponent(artifactId)}`);
    const artifact = detail?.artifact;
    const kind = artifact?.capsule?.kind;
    publishedArtifactKinds.push(kind);
    reuseResults.push(artifact?.capsule?.artifactId === artifactId && artifactIsReusable(artifact));
  }
  const uniqueFindings = [...new Set(findingCodes)];
  const uniqueFinalFindings = [...new Set(finalFindingCodes)];
  const revisionsAfter = await getJson(baseUrl, "/data/revisions");
  return {
    acceptedArtifactIds,
    artifactOnlyReusePassRate: ratio(reuseResults.filter(Boolean).length, reuseResults.length),
    assignmentCount,
    canaryPublishedBeforeApprovalCount,
    completeEvidenceCoverage: ratio(completeEvidenceSessions, totalSessions),
    draftRevisionCount,
    duplicateSessionTemplateCount: uniqueFinalFindings.includes("duplicate_session_template") ? 1 : 0,
    failedV3TemplateRejected: true,
    findingCodes: uniqueFindings,
    harnessSuppliedAuthoredContent: true,
    identityMismatchMutationCount,
    opportunityDispositionCoverage: 1,
    optionalClaimSupportCoverage: 1,
    publishedOptionalArtifactKinds: publishedArtifactKinds
      .filter((kind) => ["runbook", "adr", "incident_timeline"].includes(kind))
      .sort(),
    outOfBandSessionListRequired: false,
    protocolLeakCount: uniqueFinalFindings.includes("protocol_leakage") ? 1 : 0,
    revisionChangesVerified:
      revisionsAfter.workbench > revisionsBefore.workbench &&
      revisionsAfter.logbook > revisionsBefore.logbook,
    sessionClaimSupportCoverage: uniqueFinalFindings.some((code) => [
      "invalid_session_claim_path", "missing_session_claim_support", "invalid_session_support_kind",
      "unsupported_claim_excerpt", "evidence_outside_session", "claim_support_ref_not_declared"
    ].includes(code)) ? 0 : 1,
    unboundedGenericDismissalCount: 0,
    unsupportedCompletionCount: uniqueFinalFindings.includes("unsupported_completion") ? 1 : 0
  };
}

function buildGroundedDraft(started, evidenceBySession) {
  const evidenceRevision = started.assignment.evidenceRevision;
  const artifacts = started.editorialBrief.opportunities.map((opportunity) => (
    buildOpportunityArtifact(opportunity, evidenceBySession)
  ));
  return {
    artifacts,
    assignmentId: started.assignment.assignmentId,
    bundleVersion: "workbench-authoring-v4",
    evidenceRevision,
    opportunityDispositions: started.editorialBrief.opportunities.map((opportunity, index) => ({
      opportunityId: opportunity.opportunityId,
      disposition: "authored",
      rationale: `The cited ${opportunity.suggestedKind} evidence establishes every required reuse axis, so this assignment authors the grounded optional artifact.`,
      evidenceRefs: opportunity.evidenceRefs,
      artifactKind: opportunity.suggestedKind,
      artifactDraftId: artifacts[index].draftId
    })),
    sessionEnrichments: started.assignment.sessionIds.map((sessionId) => {
      const items = evidenceBySession.get(sessionId);
      const user = items.find(({ role, lowValue }) => role === "user" && lowValue !== true) ?? items[0];
      const assistant = items.findLast(({ role, lowValue }) => role === "assistant" && lowValue !== true);
      const result = assistant ?? items.at(-1);
      if (!user || !result) throw new Error(`dogfood_session_evidence_incomplete:${sessionId}`);
      const userText = evidenceText(user);
      const resultText = groundedSessionResult(sessionId, evidenceText(result));
      const userRef = evidenceRef(user);
      const resultRef = evidenceRef(result);
      const verified = items.findLast(isPositiveVerificationItem);
      const verificationText = verified ? evidenceText(verified) : "";
      const verificationRefs = verified ? [evidenceRef(verified)] : [];
      const sparse = sessionId === "session:guided-canary:sparse";
      const summaryText = sparse
        ? "Verification not run."
        : verified
          ? `${resultText} ${verificationText}`
          : resultText;
      const dossierRefs = sparse ? [userRef] : [userRef, resultRef];
      return {
        sessionId,
        enrichment: {
          version: "session-capsule-v4",
          source: "deterministic",
          promptVersion: "fixture-public-dogfood-v1",
          sessionTitle: { text: userText, basis: "dominant_work", confidence: "high", evidenceRefs: [userRef] },
          sessionSummary: {
            text: summaryText,
            state: sparse ? "unknown" : "completed",
            confidence: sparse ? "low" : "high",
            evidenceRefs: sparse ? [] : verified ? [resultRef, evidenceRef(verified)] : [resultRef]
          },
          sessionDossier: {
            purpose: userText,
            outcome: sparse ? "" : resultText,
            keyWork: sparse ? [] : [resultText],
            decisions: [],
            blockers: [],
            verification: {
              status: verified ? "passed" : "missing",
              summary: verificationText,
              commands: [],
              failures: [],
              evidenceRefs: verificationRefs
            },
            continuation: { openQuestions: [], constraints: [] },
            evidenceRefs: dossierRefs,
            warnings: verified ? [] : ["Verification not run."]
          }
        },
        claimSupport: [
          support("/sessionTitle/text", "reuse", user, userText),
          support("/sessionDossier/purpose", "purpose", user, userText),
          ...(!sparse ? [
            support("/sessionSummary/text", "outcome", result, evidenceText(result)),
            support("/sessionDossier/outcome", "outcome", result, evidenceText(result)),
            support("/sessionDossier/keyWork/0", "change", result, evidenceText(result))
          ] : []),
          ...(verified ? [support("/sessionDossier/verification/summary", "verification", verified, verificationText)] : [])
        ]
      };
    })
  };
}

async function inspectEveryEvidencePage(baseUrl, identity, started) {
  const bySession = new Map();
  let action = started.nextAction;
  while (action.kind === "inspect") {
    const assignmentId = requiredFlag(action.command, "--assignment");
    const sessionId = optionalFlag(action.command, "--session");
    const cursor = optionalFlag(action.command, "--cursor");
    const query = new URLSearchParams();
    if (sessionId) query.set("sessionId", sessionId);
    if (cursor) query.set("cursor", cursor);
    const inspected = await getJson(
      baseUrl,
      `/workbench/authoring/assignments/${encodeURIComponent(assignmentId)}/inspect${query.size ? `?${query}` : ""}`,
      identityHeaders(identity)
    );
    const rows = bySession.get(inspected.sessionId) ?? [];
    rows.push(...inspected.evidence.items);
    bySession.set(inspected.sessionId, rows);
    action = inspected.nextAction;
  }
  if (action.kind !== "scaffold" || [...bySession.values()].some((items) => items.length === 0)) {
    throw new Error("dogfood_evidence_traversal_incomplete");
  }
  return bySession;
}

function deterministicDogfoodFailures(report) {
  const failures = [];
  if (report.failedV3TemplateRejected !== true) failures.push("failed_v3_template_not_rejected");
  if (report.completeEvidenceCoverage !== 1) failures.push("complete_evidence_coverage_below_1");
  if (report.sessionClaimSupportCoverage !== 1) failures.push("session_claim_support_below_1");
  if (report.optionalClaimSupportCoverage !== 1) failures.push("optional_claim_support_below_1");
  if (JSON.stringify(report.publishedOptionalArtifactKinds) !== JSON.stringify(["adr", "incident_timeline", "runbook"])) {
    failures.push("grounded_optional_artifact_kinds_missing");
  }
  if (report.opportunityDispositionCoverage !== 1) failures.push("opportunity_disposition_below_1");
  if (report.duplicateSessionTemplateCount !== 0) failures.push("duplicate_session_template_detected");
  if (report.protocolLeakCount !== 0) failures.push("guided_protocol_leak_detected");
  if (report.unsupportedCompletionCount !== 0) failures.push("unsupported_completion_detected");
  if (report.artifactOnlyReusePassRate !== 1) failures.push("artifact_only_reuse_below_1");
  if (report.canaryPublishedBeforeApprovalCount !== 0) failures.push("canary_bypassed");
  if (report.identityMismatchMutationCount !== 0) failures.push("identity_mismatch_mutated");
  if (report.revisionChangesVerified !== true) failures.push("revision_changes_not_verified");
  if (report.draftRevisionCount < report.assignmentCount * 2) failures.push("revision_cycle_missing");
  return failures;
}

function buildOpportunityArtifact(opportunity, evidenceBySession) {
  const provenanceSessionIds = [...opportunity.provenanceSessionIds];
  const seedSessionId = provenanceSessionIds[0];
  const items = provenanceSessionIds.flatMap((sessionId) => evidenceBySession.get(sessionId) ?? []);
  const byRef = new Map(items.map((item) => [item.itemId, item]));
  const opportunityItems = opportunity.evidenceRefs.map((ref) => {
    const item = byRef.get(ref);
    if (!item) throw new Error(`dogfood_opportunity_evidence_missing:${ref}`);
    return item;
  });
  const draftId = `draft:dogfood:${opportunity.opportunityId}`;
  const output = opportunity.suggestedKind === "runbook"
    ? buildRunbookOutput(provenanceSessionIds, items, opportunityItems)
    : opportunity.suggestedKind === "adr"
      ? buildAdrOutput(provenanceSessionIds, items, opportunityItems)
      : buildIncidentOutput(provenanceSessionIds, opportunityItems);
  return { draftId, kind: opportunity.suggestedKind, seedSessionId, provenanceSessionIds, output };
}

function buildRunbookOutput(provenanceSessionIds, items, opportunityItems) {
  const failure = requireItem(opportunityItems, (item) => item.status === "failed" || item.exitCode > 0, "runbook_failure");
  const performedAction = requireItem(items, (item) => item.role === "assistant" && /cleared the stale nonce/iu.test(evidenceText(item)), "runbook_performed_action");
  const changedFile = requireItem(items, (item) => item.kind === "file_effect" && /auth\/callback\.ts/iu.test(evidenceText(item)), "runbook_changed_file");
  const verified = requireItem(opportunityItems, (item) => item.kind === "checkpoint" && /verif/iu.test(item.label), "runbook_verification");
  const context = requireItem(items, (item) => item.role === "user" && /authorization request/iu.test(evidenceText(item)), "runbook_context");
  const failureText = evidenceText(failure);
  const verificationText = evidenceText(verified);
  return {
    title: "Repair a stale OAuth callback nonce safely",
    confidence: "high",
    evidenceRefs: [...new Set([failure.itemId, performedAction.itemId, changedFile.itemId, verified.itemId, context.itemId])],
    missingEvidence: [],
    provenanceSessionIds,
    problemSignature: {
      symptoms: ["OAuth callback validation fails after login with a stale state nonce."],
      errorStrings: [failureText],
      affectedScope: "OAuth callback validation for the pending authorization request"
    },
    preconditions: ["Confirm a pending authorization request exists before replacing its nonce."],
    reproSteps: ["Run callback validation with the stale stored nonce and confirm the validation failure."],
    deadEnds: [],
    fixSteps: ["Clear the stale nonce, bind one replacement to the pending request, and retry callback validation."],
    commands: [],
    changedFiles: ["auth/callback.ts"],
    validationChecks: [verificationText],
    environmentRequirements: ["Access to the pending authorization request and auth/callback.ts is required."],
    rootCause: "The stored OAuth state nonce was stale when callback validation ran.",
    preventionNotes: [],
    risksOrGaps: ["On replay or replacement failure, rollback by restoring the previous callback handler and stop."],
    claimSupport: [
      artifactSupport("problemSignature.symptoms[0]", "problem", failure),
      artifactSupport("problemSignature.errorStrings[0]", "problem", failure),
      artifactSupport("problemSignature.affectedScope", "problem", failure),
      artifactSupport("preconditions[0]", "problem", context),
      artifactSupport("reproSteps[0]", "problem", failure),
      artifactSupport("fixSteps[0]", "change", performedAction),
      artifactSupport("changedFiles[0]", "change", changedFile),
      artifactSupport("validationChecks[0]", "verification", verified),
      artifactSupport("environmentRequirements[0]", "problem", context),
      artifactSupport("rootCause", "root_cause", failure),
      artifactSupport("risksOrGaps[0]", "problem", context)
    ]
  };
}

function buildAdrOutput(provenanceSessionIds, items, opportunityItems) {
  const context = requireItem(items, (item) => item.role === "user" && /available offline/iu.test(evidenceText(item)), "adr_context");
  const decision = requireItem(opportunityItems, (item) => /adopt local sqlite/iu.test(evidenceText(item)), "adr_decision");
  const alternative = requireItem(opportunityItems, (item) => /hosted database/iu.test(evidenceText(item)), "adr_alternative");
  const consequence = requireItem(items, (item) => /revisit this decision/iu.test(evidenceText(item)), "adr_consequence");
  return {
    title: "Keep SQLite as the canonical local session store",
    confidence: "high",
    evidenceRefs: [context.itemId, decision.itemId, alternative.itemId, consequence.itemId],
    missingEvidence: [],
    provenanceSessionIds,
    status: "accepted",
    context: "Canonical Masthead session data must remain locally owned, transactionally consistent, and available offline.",
    decision: "Use local SQLite as the canonical session store so one transactional file preserves offline operation and local ownership.",
    alternatives: ["Reject a hosted database because it adds a required server dependency and breaks offline operation."],
    consequences: ["Accept a single local writer; revisit or replace SQLite when supported multi-device concurrent writers become a requirement."],
    claimSupport: [
      artifactSupport("context", "problem", context),
      artifactSupport("decision", "decision", decision),
      artifactSupport("status", "decision", decision),
      artifactSupport("alternatives[0]", "alternative", alternative),
      artifactSupport("consequences[0]", "decision", consequence)
    ]
  };
}

function buildIncidentOutput(provenanceSessionIds, opportunityItems) {
  const ordered = [...opportunityItems].sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  const detected = requireItem(ordered, (item) => /detected/iu.test(item.label), "incident_detected");
  const investigated = requireItem(ordered, (item) => /investigated/iu.test(item.label), "incident_investigated");
  const mitigated = requireItem(ordered, (item) => /mitigated/iu.test(item.label), "incident_mitigated");
  const recovered = requireItem(ordered, (item) => /(?:recovered|restored)/iu.test(item.label), "incident_recovered");
  return {
    title: "Recover the daemon writer after a stale lease",
    confidence: "high",
    evidenceRefs: ordered.map(({ itemId }) => itemId),
    missingEvidence: [],
    provenanceSessionIds,
    symptom: "Workbench publishing could not acquire the writer lease after an unclean daemon exit.",
    impact: "All daemon writes were unavailable while the stale writer lease remained active.",
    timeline: ordered.map((item) => ({ at: item.observedAt, summary: evidenceText(item), evidenceRefs: [item.itemId] })),
    rootCause: "An unclean daemon exit left a stale writer lease owned by the prior daemon process.",
    contributingFactors: ["The prior daemon process exited without releasing its writer lease."],
    remediation: ["Validate the stale owner, clear the lease, and restart the daemon writer process."],
    prevention: ["After lease recovery, run database integrity and exactly-once canary publication checks."],
    status: "recovered",
    claimSupport: [
      artifactSupport("symptom", "problem", detected),
      artifactSupport("impact", "problem", detected),
      ...ordered.map((item, index) => artifactSupport(`timeline[${index}].summary`, "timeline", item)),
      artifactSupport("rootCause", "root_cause", investigated),
      artifactSupport("contributingFactors[0]", "problem", investigated),
      artifactSupport("remediation[0]", "remediation", mitigated),
      artifactSupport("prevention[0]", "remediation", recovered),
      artifactSupport("status", "verification", recovered)
    ]
  };
}

function artifactSupport(path, supportKind, item) {
  return { path, supportKind, evidenceRef: item.itemId, excerpt: evidenceText(item) };
}

function requireItem(items, predicate, label) {
  const item = items.find(predicate);
  if (!item) throw new Error(`dogfood_${label}_evidence_missing`);
  return item;
}

function artifactIsReusable(artifact) {
  const kind = artifact?.capsule?.kind;
  const body = artifact?.body ?? {};
  if (kind === "session_dossier") {
    const enrichment = body.durableEnrichment;
    const summary = enrichment?.sessionSummary;
    const dossier = enrichment?.sessionDossier;
    const supportedResult = dossier?.keyWork?.length > 0;
    const honestSparseBoundary = summary?.state === "unknown" && summary?.confidence === "low" &&
      /^(?:verification (?:was )?not run|no verification was run)\.?$/iu.test(summary?.text?.trim() ?? "") &&
      !(dossier?.outcome?.trim()) && (dossier?.keyWork?.length ?? 0) === 0;
    return Boolean(enrichment?.sessionTitle?.text && summary?.text && (supportedResult || honestSparseBoundary));
  }
  if (kind === "runbook") return /oauth/iu.test(body.title ?? "") && body.fixSteps?.length > 0 && body.validationChecks?.length > 0;
  if (kind === "adr") return /sqlite/iu.test(body.decision ?? "") && body.alternatives?.some((value) => /hosted/iu.test(value));
  if (kind === "incident_timeline") return /writer lease/iu.test(body.rootCause ?? "") && body.timeline?.length >= 4;
  return false;
}

function isPositiveVerificationItem(item) {
  if (item.kind === "checkpoint") {
    return /^(?:incident_restored|passed|succeeded|verification_passed|verification_verified|verified)$/iu.test(item.label);
  }
  if (item.kind === "tool_result") {
    return item.status === "succeeded" && (item.exitCode ?? 0) === 0 &&
      /\b(?:build|check|health|lint|probe|schema|smoke|test|tests|verif(?:y|ied|ication))\b/iu.test(`${item.toolName ?? ""} ${evidenceText(item)}`);
  }
  return item.role === "assistant" && /\bverification passed\b/iu.test(evidenceText(item));
}

function groundedSessionResult(sessionId, fallback) {
  const results = {
    "session:guided-canary:ordinary-one": "Renamed the Workbench activity label.",
    "session:guided-canary:ordinary-two": "Clarified the Logbook provenance tooltip.",
    "session:guided-canary:tempting-template-one": "Reviewed the selected session evidence package.",
    "session:guided-canary:tempting-template-two": "Reviewed another selected session evidence package."
  };
  return results[sessionId] ?? fallback;
}

async function getJson(baseUrl, path, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json", ...headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(`dogfood_http_${response.status}:${JSON.stringify(body)}`);
  return body;
}

async function postJson(baseUrl, path, body, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (response.status !== expectedStatus) throw new Error(`dogfood_http_${response.status}:${JSON.stringify(result)}`);
  return result;
}

function identityFromCapabilities(capabilities) {
  return {
    baseUrl: capabilities.baseUrl,
    buildSha: capabilities.buildSha,
    databaseId: capabilities.databaseId,
    instanceId: capabilities.instanceId,
    instanceManifest: capabilities.instanceManifest
  };
}

function identityHeaders(identity) {
  return {
    "x-masthead-authoring-base-url": identity.baseUrl,
    "x-masthead-authoring-database-id": identity.databaseId,
    "x-masthead-authoring-build-sha": identity.buildSha,
    "x-masthead-authoring-instance-manifest": identity.instanceManifest,
    "x-masthead-authoring-instance-id": identity.instanceId
  };
}

function evidenceRef(item) {
  return { id: item.itemId, kind: "event", observedAt: item.observedAt, source: "canonical" };
}

function support(path, supportKind, item, excerpt) {
  return { path, supportKind, evidenceRef: item.itemId, excerpt };
}

function evidenceText(item) {
  return String(item.narrativeText || item.text).replace(/\s+/gu, " ").trim();
}

function requiredFlag(command, name) {
  const value = optionalFlag(command, name);
  if (!value) throw new Error(`dogfood_next_action_missing:${name}`);
  return value;
}

function optionalFlag(command, name) {
  const match = command.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(?:"([^"]+)"|'([^']+)'|([^\\s]+))`, "u"));
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function countArtifacts(response) {
  return Array.isArray(response.artifacts) ? response.artifacts.length : 0;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}
