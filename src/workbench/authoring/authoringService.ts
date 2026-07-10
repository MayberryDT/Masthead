import { randomUUID } from "node:crypto";
import type { SessionTranscriptOrder } from "../../shared/sessionTranscript.ts";
import type {
  WorkbenchAuthoringBundle,
  WorkbenchAuthoringEvidenceManifest,
  WorkbenchAuthoringEvidencePage,
  WorkbenchAuthoringFinding,
  WorkbenchAuthoringReceipt,
  WorkbenchAuthoringRunDto
} from "../../shared/workbenchAuthoring.ts";
import { hasSemanticRedactedText } from "../../core/redaction.ts";
import type { SessionArtifactRecord } from "../../daemon/db/sessionArtifactRepository.ts";
import {
  applySessionArtifactInTransaction,
  indexSessionArtifactSearch,
  listSessionArtifacts,
  normalizeSessionArtifactSignatureKey,
  publishSessionArtifactInTransaction
} from "../../daemon/db/sessionArtifactRepository.ts";
import { getLogbookArtifactDetail } from "../../daemon/db/logbookArtifactRepository.ts";
import { iterateSessionTranscriptItems, type SessionTranscriptKindFilter } from "../../daemon/db/sessionTranscriptRepository.ts";
import { getOrCreateDatabaseIdentity } from "../../daemon/db/schema.ts";
import { type MastheadDatabase, withImmediateTransaction } from "../../daemon/db/sqlite.ts";
import {
  createWorkbenchAuthoringRunInTransaction,
  completeWorkbenchAuthoringRun,
  findReusableWorkbenchAuthoringRun,
  getWorkbenchAuthoringRun,
  resetWorkbenchAuthoringRunEvidence,
  saveWorkbenchAuthoringSubmission
} from "../../daemon/db/workbenchAuthoringRepository.ts";
import {
  claimWorkbenchSessionsInTransaction,
  ensureWorkbenchSessionState,
  markWorkbenchQualityPassedInTransaction,
  markContributionSatisfactionForProvenanceInTransaction,
  markWorkbenchArtifactAppliedInTransaction,
  markWorkbenchArtifactPublishedInTransaction,
  markWorkbenchTranscriptAvailableInTransaction,
  publishWorkbenchSessionInTransaction,
  readWorkbenchSessionState,
  reconcileWorkbenchArtifactSatisfactionInTransaction,
  recordWorkbenchActivity,
  releaseWorkbenchClaimInTransaction,
  renewOrReacquireAuthoringClaimsInTransaction,
  setWorkbenchArtifactApplicabilityInTransaction
} from "../../daemon/db/workbenchPipelineRepository.ts";
import { runCaptureQualityPrecheck } from "../qualityPrecheck.ts";
import { fingerprintWorkbenchOutput } from "../applyArtifact.ts";
import { applySessionEnrichmentInTransaction } from "../applySessionEnrichment.ts";
import type { SessionEnrichmentOutput, WorkbenchValidationEvidence } from "../types.ts";
import { getAuthoringBundleSchema } from "./authoringSchemas.ts";
import {
  authoringEvidenceRevision,
  getAuthoringEvidenceManifest,
  getAuthoringEvidencePage
} from "./evidenceCatalog.ts";
import { findArtifactSignatureFindings, validateAuthoringBundle } from "./authoringValidation.ts";

const AUTHORING_LEASE_MS = 60 * 60_000;

export type OpenAuthoringRunResult = {
  ok: true;
  run: WorkbenchAuthoringRunDto;
  evidence: WorkbenchAuthoringEvidenceManifest;
  bundleSchema: Record<string, unknown>;
  contract: {
    contractVersion: "workbench-authoring-v1";
    sessionPackageRequired: true;
    automaticKinds: ["runbook", "adr", "incident_timeline"];
    completion: "publish_and_resolve";
    evidencePolicy: "all_canonical_redacted_evidence";
  };
  currentArtifacts: SessionArtifactRecord[];
};

export type WorkbenchAuthoringRunStatusResult = {
  ok: true;
  run: WorkbenchAuthoringRunDto;
  evidenceStatus: "current" | "changed";
};

export type GetAuthoringRunEvidenceInput = {
  runId: string;
  sessionId: string;
  cursor?: string;
  limit?: number;
  kind?: SessionTranscriptKindFilter;
  query?: string;
  order?: SessionTranscriptOrder;
};

export type SubmitAuthoringBundleResult = {
  ok: true;
  accepted: boolean;
  findings: WorkbenchAuthoringFinding[];
  run: WorkbenchAuthoringRunDto;
};

export function openAuthoringRun(
  db: MastheadDatabase,
  input: { actorId: string; databaseId: string; sessionIds: string[] }
): OpenAuthoringRunResult {
  return withImmediateTransaction(db, () => {
    const sessionIds = normalizeSessionIds(input.sessionIds);
    if (sessionIds.length === 0) throw new Error("authoring_run_requires_sessions");
    for (const sessionId of sessionIds) assertSessionExists(db, sessionId);

    const databaseId = getOrCreateDatabaseIdentity(db);
    if (input.databaseId !== databaseId) throw new Error("database_identity_mismatch");

    const evidence = authoringEvidenceManifestWithWarnings(db, sessionIds);
    const reusable = findReusableWorkbenchAuthoringRun(db, {
      actorId: input.actorId,
      databaseId,
      sessionIds
    });
    if (reusable?.status === "completed") {
      return openResult(db, reusable, evidence);
    }
    assertSessionsOnPublishPath(db, sessionIds);
    assertCanonicalEvidence(db, evidence);
    if (reusable?.evidenceRevision === evidence.evidenceRevision) {
      const run = renewOrReacquireAuthoringClaimsInTransaction(db, {
        actorId: input.actorId,
        expiresAt: authoringLeaseExpiry(),
        runId: reusable.runId
      });
      return openResult(db, run, evidence);
    }
    if (reusable) {
      resetWorkbenchAuthoringRunEvidence(db, {
        evidenceRevision: evidence.evidenceRevision,
        runId: reusable.runId,
        updatedAt: new Date().toISOString()
      });
      const run = renewOrReacquireAuthoringClaimsInTransaction(db, {
        actorId: input.actorId,
        expiresAt: authoringLeaseExpiry(),
        runId: reusable.runId
      });
      return openResult(db, run, evidence);
    }

    assertSessionsUnclaimed(db, sessionIds);
    const actor = { id: input.actorId, kind: "agent" } as const;
    for (const sessionId of sessionIds) {
      ensureWorkbenchSessionState(db, sessionId);
      markWorkbenchTranscriptAvailableInTransaction(db, { actor, sessionId });
      markWorkbenchQualityPassedInTransaction(db, { actor, sessionId });
    }

    const claims = claimWorkbenchSessionsInTransaction(db, {
      claimedBy: input.actorId,
      expiresAt: authoringLeaseExpiry(),
      sessionIds
    }).claims;
    const runId = `authoring:${randomUUID()}`;
    const run = createWorkbenchAuthoringRunInTransaction(db, {
      actorId: input.actorId,
      databaseId,
      evidenceRevision: evidence.evidenceRevision,
      runId,
      sessions: claims.map((claim, ordinal) => ({
        claimId: claim.claimId,
        ordinal,
        sessionId: claim.sessionId
      }))
    });
    for (const claim of claims) {
      recordWorkbenchActivity(db, {
        actor,
        details: { evidenceRevision: evidence.evidenceRevision },
        eventType: "authoring_opened",
        relatedClaimId: claim.claimId,
        relatedRunId: runId,
        sessionId: claim.sessionId,
        summary: "Workbench authoring opened"
      });
    }
    return openResult(db, run, evidence);
  });
}

export function getAuthoringRunStatus(db: MastheadDatabase, runId: string): WorkbenchAuthoringRunStatusResult {
  const run = requireAuthoringRun(db, runId);
  return {
    evidenceStatus: authoringEvidenceRevision(db, run.sessionIds) === run.evidenceRevision ? "current" : "changed",
    ok: true,
    run
  };
}

export function getAuthoringRunEvidence(
  db: MastheadDatabase,
  input: GetAuthoringRunEvidenceInput
): WorkbenchAuthoringEvidencePage {
  const run = requireAuthoringRun(db, input.runId);
  if (!run.sessionIds.includes(input.sessionId)) {
    throw new Error(`authoring_session_not_in_run:${input.sessionId}`);
  }
  const currentRevision = authoringEvidenceRevision(db, run.sessionIds);
  if (currentRevision !== run.evidenceRevision) throw new Error("evidence_revision_changed");
  return {
    ...getAuthoringEvidencePage(db, input),
    evidenceRevision: currentRevision
  };
}

export function submitAuthoringBundle(
  db: MastheadDatabase,
  input: { bundle: WorkbenchAuthoringBundle; runId: string }
): SubmitAuthoringBundleResult {
  return withImmediateTransaction(db, () => {
    const existing = requireAuthoringRun(db, input.runId);
    if (existing.status === "completed") throw new Error(`authoring_run_completed:${input.runId}`);
    if (input.bundle.runId !== input.runId) throw new Error("authoring_run_mismatch");

    const renewed = renewOrReacquireAuthoringClaimsInTransaction(db, {
      actorId: existing.actorId,
      expiresAt: authoringLeaseExpiry(),
      runId: input.runId
    });
    const currentEvidenceRevision = authoringEvidenceRevision(db, renewed.sessionIds);
    if (currentEvidenceRevision !== renewed.evidenceRevision) throw new Error("evidence_revision_changed");
    if (input.bundle.evidenceRevision !== renewed.evidenceRevision) throw new Error("evidence_revision_mismatch");

    const validation = validateAuthoringBundle({
      bundle: input.bundle,
      coverageWarningsBySession: coverageWarningsBySession(db, renewed.sessionIds),
      evidenceByRef: evidenceByRef(db, renewed.sessionIds),
      publishedArtifacts: currentArtifacts(db, renewed.sessionIds),
      selectedSessionIds: renewed.sessionIds
    });
    const run = saveWorkbenchAuthoringSubmission(db, {
      bundle: input.bundle,
      evidenceRevision: currentEvidenceRevision,
      findings: validation.findings,
      runId: input.runId,
      status: validation.ok ? "ready_to_finish" : "needs_revision"
    });
    return {
      accepted: validation.ok,
      findings: validation.findings,
      ok: true,
      run
    };
  });
}

export function finishAuthoringRun(
  db: MastheadDatabase,
  input: { runId: string; verifyPublished?: (artifactId: string) => boolean }
): WorkbenchAuthoringReceipt {
  return withImmediateTransaction(db, () => {
    const existing = requireAuthoringRun(db, input.runId);
    if (existing.receipt) return existing.receipt;
    if (existing.status !== "ready_to_finish") {
      throw new Error(`authoring_run_not_ready:${existing.status}`);
    }
    if (!existing.bundle) throw new Error(`authoring_run_bundle_missing:${existing.runId}`);

    const signatureCollisions = findArtifactSignatureFindings(existing.bundle.artifacts).filter(
      (finding) => finding.code === "duplicate_artifact_signature"
    );
    if (signatureCollisions.length > 0) {
      throw new Error("authoring_run_needs_revision:duplicate_artifact_signature");
    }

    const run = renewOrReacquireAuthoringClaimsInTransaction(db, {
      actorId: existing.actorId,
      expiresAt: authoringLeaseExpiry(),
      runId: existing.runId
    });
    if (authoringEvidenceRevision(db, run.sessionIds) !== run.evidenceRevision) {
      throw new Error("evidence_revision_changed");
    }
    if (!run.bundle) throw new Error(`authoring_run_bundle_missing:${run.runId}`);

    const receipt = finishInsideTransaction(db, { ...run, bundle: run.bundle }, input.verifyPublished);
    completeWorkbenchAuthoringRun(db, { receipt, runId: run.runId });
    return receipt;
  });
}

function finishInsideTransaction(
  db: MastheadDatabase,
  run: WorkbenchAuthoringRunDto & { bundle: WorkbenchAuthoringBundle },
  verifyPublished: ((artifactId: string) => boolean) | undefined
): WorkbenchAuthoringReceipt {
  const actor = { id: run.actorId, kind: "agent" } as const;
  const expectedArtifacts: Array<{ artifactId: string; provenanceSessionIds: string[] }> = [];
  const contributions: WorkbenchAuthoringReceipt["contributions"] = [];
  const appliedArtifacts: Array<{
    artifact: SessionArtifactRecord;
    kind: SessionArtifactRecord["artifactKind"];
    provenanceSessionIds: string[];
    seedSessionId: string;
    supersededProvenanceSessionIds: string[];
  }> = [];

  for (const sessionPackage of run.bundle.sessionPackages) {
    applySessionEnrichmentInTransaction(db, {
      output: sessionPackage.enrichment as SessionEnrichmentOutput,
      sessionId: sessionPackage.sessionId
    });
    const dossier = applyAuthoringArtifactInTransaction(db, {
      actorId: run.actorId,
      kind: "session_dossier",
      output: sessionPackage.dossier,
      provenanceSessionIds: [sessionPackage.sessionId],
      seedSessionId: sessionPackage.sessionId
    });
    markWorkbenchArtifactAppliedInTransaction(db, {
      actor,
      artifactKind: "session_dossier",
      sessionId: sessionPackage.sessionId
    });
    appliedArtifacts.push({
      artifact: dossier,
      kind: "session_dossier",
      provenanceSessionIds: [sessionPackage.sessionId],
      seedSessionId: sessionPackage.sessionId,
      supersededProvenanceSessionIds: []
    });
  }

  for (const artifactDraft of run.bundle.artifacts) {
    const supersededProvenanceSessionIds = currentPublishedSignatureProvenanceSessionIds(
      db,
      artifactDraft.kind,
      normalizeSessionArtifactSignatureKey(artifactDraft.output.signatureKey)
    );
    const artifact = applyAuthoringArtifactInTransaction(db, {
      actorId: run.actorId,
      kind: artifactDraft.kind,
      output: artifactDraft.output,
      provenanceSessionIds: artifactDraft.provenanceSessionIds,
      seedSessionId: artifactDraft.seedSessionId
    });
    markWorkbenchArtifactAppliedInTransaction(db, {
      actor,
      artifactKind: artifactDraft.kind,
      sessionId: artifactDraft.seedSessionId
    });
    appliedArtifacts.push({
      artifact,
      kind: artifactDraft.kind,
      provenanceSessionIds: artifactDraft.provenanceSessionIds,
      seedSessionId: artifactDraft.seedSessionId,
      supersededProvenanceSessionIds
    });
  }

  for (const applied of appliedArtifacts) {
    const published = publishSessionArtifactInTransaction(db, applied.artifact.artifactId);
    if (!published) throw new Error(`authoring_finish_artifact_missing:${applied.artifact.artifactId}`);
    expectedArtifacts.push({
      artifactId: published.artifactId,
      provenanceSessionIds: applied.provenanceSessionIds
    });
  }

  for (const applied of appliedArtifacts) {
    if (applied.kind === "session_dossier") continue;
    markWorkbenchArtifactPublishedInTransaction(db, {
      actor,
      artifactId: applied.artifact.artifactId,
      artifactKind: applied.kind,
      sessionId: applied.seedSessionId
    });
    markContributionSatisfactionForProvenanceInTransaction(db, {
      actor,
      artifactKind: applied.kind,
      provenanceSessionIds: applied.provenanceSessionIds,
      publishedArtifactId: applied.artifact.artifactId,
      seedSessionId: applied.seedSessionId
    });
    for (const sessionId of applied.provenanceSessionIds) {
      if (sessionId === applied.seedSessionId) continue;
      contributions.push({ artifactId: applied.artifact.artifactId, kind: applied.kind, sessionId });
    }
  }

  for (const decision of run.bundle.notApplicable) {
    setWorkbenchArtifactApplicabilityInTransaction(db, {
      actor,
      artifactKind: decision.kind,
      reason: decision.reason,
      sessionId: decision.sessionId,
      status: "not_applicable"
    });
  }

  for (const decision of run.bundle.contributions) {
    assertExistingContribution(db, decision);
    setWorkbenchArtifactApplicabilityInTransaction(db, {
      actor,
      artifactKind: decision.kind,
      reason: `contributed_to:${decision.publishedArtifactId}`,
      sessionId: decision.sessionId,
      status: "contributed"
    });
    contributions.push({
      artifactId: decision.publishedArtifactId,
      kind: decision.kind,
      sessionId: decision.sessionId
    });
  }

  for (const applied of appliedArtifacts) {
    if (applied.kind === "session_dossier" || applied.supersededProvenanceSessionIds.length === 0) continue;
    reconcileWorkbenchArtifactSatisfactionInTransaction(db, {
      artifactKind: applied.kind,
      sessionIds: applied.supersededProvenanceSessionIds
    });
  }

  for (const sessionId of run.sessionIds) {
    const result = publishWorkbenchSessionInTransaction(db, { actor, sessionId });
    if (!result.ok) {
      throw new Error(`authoring_finish_package_gate_failed:${sessionId}:${result.missing.join(",")}`);
    }
  }

  for (const expected of expectedArtifacts) {
    indexSessionArtifactSearch(db, expected.artifactId);
    assertPublishedArtifactVisible(db, expected.artifactId, expected.provenanceSessionIds);
    if (verifyPublished && !verifyPublished(expected.artifactId)) {
      throw new Error(`authoring_finish_visibility_failed:${expected.artifactId}`);
    }
  }
  for (const sessionId of run.sessionIds) {
    if (readWorkbenchSessionState(db, sessionId)?.resolutionStatus !== "automatic_resolved") {
      throw new Error(`authoring_finish_unresolved:${sessionId}`);
    }
  }

  const receipt: WorkbenchAuthoringReceipt = {
    completedAt: new Date().toISOString(),
    contributions: contributions.sort(compareReceiptResolution),
    notApplicable: run.bundle.notApplicable
      .map(({ kind, sessionId }) => ({ kind, sessionId }))
      .sort(compareReceiptResolution),
    publishedArtifactIds: expectedArtifacts.map(({ artifactId }) => artifactId),
    resolvedSessionIds: [...run.sessionIds],
    runId: run.runId
  };
  for (const claimId of run.claimIds) {
    releaseWorkbenchClaimInTransaction(db, { claimId, reason: "authoring_finished" });
  }
  run.sessionIds.forEach((sessionId, index) => {
    recordWorkbenchActivity(db, {
      actor,
      details: { publishedArtifactIds: receipt.publishedArtifactIds },
      eventType: "authoring_finished",
      relatedClaimId: run.claimIds[index],
      relatedRunId: run.runId,
      sessionId,
      summary: "Workbench authoring finished"
    });
  });
  return receipt;
}

function openResult(
  db: MastheadDatabase,
  run: WorkbenchAuthoringRunDto,
  evidence: WorkbenchAuthoringEvidenceManifest
): OpenAuthoringRunResult {
  return {
    bundleSchema: getAuthoringBundleSchema(),
    contract: {
      automaticKinds: ["runbook", "adr", "incident_timeline"],
      completion: "publish_and_resolve",
      contractVersion: "workbench-authoring-v1",
      evidencePolicy: "all_canonical_redacted_evidence",
      sessionPackageRequired: true
    },
    currentArtifacts: currentArtifacts(db, run.sessionIds),
    evidence,
    ok: true,
    run
  };
}

function requireAuthoringRun(db: MastheadDatabase, runId: string): WorkbenchAuthoringRunDto {
  const run = getWorkbenchAuthoringRun(db, runId);
  if (!run) throw new Error(`authoring_run_not_found:${runId}`);
  return run;
}

function normalizeSessionIds(sessionIds: string[]): string[] {
  return [...new Set(sessionIds.map((sessionId) => sessionId.trim()).filter(Boolean))].sort();
}

function assertSessionExists(db: MastheadDatabase, sessionId: string): void {
  const row = db
    .prepare("SELECT 1 AS found FROM sessions WHERE session_id = ? AND deleted_at IS NULL")
    .get(sessionId) as { found: number } | undefined;
  if (!row) throw new Error(`session_not_found:${sessionId}`);
}

function assertCanonicalEvidence(db: MastheadDatabase, evidence: WorkbenchAuthoringEvidenceManifest): void {
  for (const session of evidence.sessions) {
    const hasUsableText = [...iterateSessionTranscriptItems(db, { order: "asc", sessionId: session.sessionId })].some(
      (item) => !item.lowValue && hasSemanticRedactedText(item.text)
    );
    if (session.totalItems === 0 || !hasUsableText) {
      throw new Error(`missing_canonical_evidence:${session.sessionId}`);
    }
  }
}

function assertSessionsOnPublishPath(db: MastheadDatabase, sessionIds: string[]): void {
  for (const sessionId of sessionIds) {
    const state = readWorkbenchSessionState(db, sessionId);
    if (state && state.publicationStatus !== "publish_path") {
      throw new Error(`authoring_session_not_on_publish_path:${sessionId}`);
    }
  }
}

function assertSessionsUnclaimed(db: MastheadDatabase, sessionIds: string[]): void {
  const now = new Date().toISOString();
  for (const sessionId of sessionIds) {
    const active = db
      .prepare(
        `SELECT 1 AS active
         FROM workbench_claims
         WHERE session_id = ? AND released_at IS NULL AND expires_at > ?
         LIMIT 1`
      )
      .get(sessionId, now) as { active: number } | undefined;
    if (active) throw new Error(`authoring_claim_conflict:${sessionId}`);
  }
}

function authoringLeaseExpiry(): string {
  return new Date(Date.now() + AUTHORING_LEASE_MS).toISOString();
}

function authoringEvidenceManifestWithWarnings(
  db: MastheadDatabase,
  sessionIds: string[]
): WorkbenchAuthoringEvidenceManifest {
  const manifest = getAuthoringEvidenceManifest(db, sessionIds);
  const warnings = coverageWarningsBySession(db, sessionIds);
  return {
    ...manifest,
    sessions: manifest.sessions.map((session) => ({
      ...session,
      warnings: warnings.get(session.sessionId) ?? []
    }))
  };
}

function coverageWarningsBySession(db: MastheadDatabase, sessionIds: string[]): Map<string, string[]> {
  return new Map(
    sessionIds.map((sessionId) => {
      const summary = getAuthoringEvidenceManifest(db, [sessionId]).sessions[0]!;
      const warnings: string[] = [];
      const precheck = runCaptureQualityPrecheck(db, sessionId);
      if (!precheck.ok) warnings.push(`Capture quality precheck reported ${precheck.reason}.`);
      if (summary.coverage.messages < 2) warnings.push("Fewer than two canonical messages are available.");
      if (summary.coverage.userMessages === 0) warnings.push("No user-authored message is available.");
      if (summary.coverage.assistantMessages === 0) warnings.push("No assistant-authored message is available.");
      return [sessionId, warnings] as const;
    })
  );
}

function evidenceByRef(db: MastheadDatabase, sessionIds: string[]): Map<string, WorkbenchValidationEvidence> {
  const evidence = new Map<string, WorkbenchValidationEvidence>();
  for (const sessionId of sessionIds) {
    for (const item of iterateSessionTranscriptItems(db, { order: "asc", sessionId })) {
      evidence.set(item.itemId, {
        exitCode: item.exitCode,
        kind: item.kind,
        sessionId,
        status: item.status
      });
    }
  }
  return evidence;
}

function currentArtifacts(db: MastheadDatabase, sessionIds: string[]): SessionArtifactRecord[] {
  const artifacts = new Map<string, SessionArtifactRecord>();
  for (const sessionId of sessionIds) {
    for (const artifact of listSessionArtifacts(db, { sessionId })) {
      if (artifact.status === "current") artifacts.set(artifact.artifactId, artifact);
    }
  }
  return [...artifacts.values()].sort((left, right) => left.artifactId.localeCompare(right.artifactId));
}

function currentPublishedSignatureProvenanceSessionIds(
  db: MastheadDatabase,
  artifactKind: SessionArtifactRecord["artifactKind"],
  signatureKey: string | undefined
): string[] {
  if (!signatureKey || artifactKind === "session_dossier") return [];
  const rows = db
    .prepare(
      `SELECT DISTINCT sessionId
       FROM (
         SELECT provenance.session_id AS sessionId
         FROM session_artifacts AS artifacts
         JOIN session_artifact_provenance AS provenance ON provenance.artifact_id = artifacts.artifact_id
         WHERE artifacts.artifact_kind = ?
           AND artifacts.signature_key = ?
           AND artifacts.status = 'current'
           AND artifacts.publication_status = 'published'
         UNION
         SELECT artifacts.session_id AS sessionId
         FROM session_artifacts AS artifacts
         WHERE artifacts.artifact_kind = ?
           AND artifacts.signature_key = ?
           AND artifacts.status = 'current'
           AND artifacts.publication_status = 'published'
       )
       ORDER BY sessionId`
    )
    .all(artifactKind, signatureKey, artifactKind, signatureKey) as Array<{ sessionId: string }>;
  return rows.map((row) => row.sessionId);
}

function applyAuthoringArtifactInTransaction(
  db: MastheadDatabase,
  input: {
    actorId: string;
    kind: SessionArtifactRecord["artifactKind"];
    output: Record<string, unknown>;
    provenanceSessionIds: string[];
    seedSessionId: string;
  }
): SessionArtifactRecord {
  return applySessionArtifactInTransaction(db, {
    artifactKind: input.kind,
    confidence: confidenceFromOutput(input.output),
    content: input.output,
    contentFingerprint: fingerprintWorkbenchOutput(input.output),
    createdBy: `workbench_authoring:${input.actorId}`,
    evidenceRefs: stringArrayFromOutput(input.output.evidenceRefs),
    joinRationale: stringFromOutput(input.output.joinRationale),
    projectLabel: projectLabelForSession(db, input.seedSessionId),
    provenanceSessionIds: input.provenanceSessionIds,
    schemaVersion: `${input.kind}-v2`,
    sessionId: input.seedSessionId,
    signatureKey: normalizeSessionArtifactSignatureKey(input.output.signatureKey),
    title: stringFromOutput(input.output.title),
    validation: { contract: "workbench-authoring-v1", ok: true, schemaVersion: `${input.kind}-v2` }
  });
}

function assertPublishedArtifactVisible(
  db: MastheadDatabase,
  artifactId: string,
  expectedProvenanceSessionIds: string[]
): void {
  const detail = getLogbookArtifactDetail(db, artifactId);
  if (
    !detail ||
    detail.status !== "current" ||
    detail.publicationStatus !== "published" ||
    !sameStringSet(detail.provenanceSessionIds, expectedProvenanceSessionIds)
  ) {
    throw new Error(`authoring_finish_visibility_failed:${artifactId}`);
  }
}

function assertExistingContribution(
  db: MastheadDatabase,
  decision: WorkbenchAuthoringBundle["contributions"][number]
): void {
  const detail = getLogbookArtifactDetail(db, decision.publishedArtifactId);
  if (
    !detail ||
    detail.capsule.kind !== decision.kind ||
    !detail.provenanceSessionIds.includes(decision.sessionId)
  ) {
    throw new Error(`authoring_finish_invalid_contribution:${decision.sessionId}:${decision.kind}`);
  }
}

function projectLabelForSession(db: MastheadDatabase, sessionId: string): string | undefined {
  const row = db
    .prepare("SELECT project_label AS projectLabel FROM sessions WHERE session_id = ?")
    .get(sessionId) as { projectLabel: string | null } | undefined;
  return row?.projectLabel ?? undefined;
}

function confidenceFromOutput(output: Record<string, unknown>): "high" | "medium" | "low" | undefined {
  return output.confidence === "high" || output.confidence === "medium" || output.confidence === "low"
    ? output.confidence
    : undefined;
}

function stringFromOutput(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArrayFromOutput(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : [];
}

function sameStringSet(left: string[], right: string[]): boolean {
  const normalizedLeft = [...new Set(left)].sort();
  const normalizedRight = [...new Set(right)].sort();
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function compareReceiptResolution(
  left: { sessionId: string; kind: string },
  right: { sessionId: string; kind: string }
): number {
  return left.sessionId.localeCompare(right.sessionId) || left.kind.localeCompare(right.kind);
}
