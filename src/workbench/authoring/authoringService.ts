import { randomUUID } from "node:crypto";
import type { SessionTranscriptKind, SessionTranscriptOrder } from "../../shared/sessionTranscript.ts";
import type {
  WorkbenchAuthoringBundle,
  WorkbenchAuthoringBundleV2,
  WorkbenchAuthoringBundleV3,
  WorkbenchArtifactSuggestionDto,
  WorkbenchAuthoringEvidenceManifest,
  WorkbenchAuthoringEvidencePage,
  WorkbenchAuthoringFinding,
  WorkbenchAuthoringReceipt,
  WorkbenchAuthoringReceiptV1,
  WorkbenchAuthoringReceiptV2,
  WorkbenchAuthoringReceiptV3,
  WorkbenchAuthoringRunDto
} from "../../shared/workbenchAuthoring.ts";
import type { PublishedSessionDossierV1, SessionDossierDto } from "../../shared/sessionDossier.ts";
import type { DurableSessionEnrichment } from "../../shared/sessionEnrichment.ts";
import type {
  GuidedArtifactDraft,
  GuidedPublishedArtifactDto
} from "../../shared/guidedAuthoring.ts";
import type { WorkbenchAuthoringV5OptionalArtifactDraft } from "../../shared/workbenchAuthoringV5.ts";
import type { EvidenceKind, EvidenceRef } from "../../core/types.ts";
import { hasSemanticRedactedText } from "../../core/redaction.ts";
import type { SessionArtifactRecord } from "../../daemon/db/sessionArtifactRepository.ts";
import {
  getWorkbenchArtifactCandidate,
  publishClaimedWorkbenchArtifactCandidateInTransaction,
  setWorkbenchArtifactCandidateStatus,
  type StoredWorkbenchArtifactCandidate,
} from "../../daemon/db/workbenchArtifactCandidateRepository.ts";
import {
  applySessionArtifactInTransaction,
  getSessionArtifact,
  indexSessionArtifactSearch,
  listSessionArtifacts,
  normalizeSessionArtifactSignatureKey,
  publishSessionArtifactInTransaction
} from "../../daemon/db/sessionArtifactRepository.ts";
import { getLogbookArtifactDetail } from "../../daemon/db/logbookArtifactRepository.ts";
import { getSessionDossier } from "../../daemon/db/sessionDossierRepository.ts";
import { markStaleCurrentSessionEnrichments, upsertSessionEnrichment } from "../../daemon/db/enrichmentRepository.ts";
import { indexCanonicalSessionSearch } from "../../daemon/db/searchRepository.ts";
import { SESSION_CAPSULE_PROMPT_VERSION } from "../../enrichment/sessionCompiler.ts";
import type { SessionCapsule } from "../../enrichment/types.ts";
import { iterateSessionTranscriptItems, type SessionTranscriptKindFilter } from "../../daemon/db/sessionTranscriptRepository.ts";
import { getOrCreateDatabaseIdentity } from "../../daemon/db/schema.ts";
import { type MastheadDatabase, withImmediateTransaction } from "../../daemon/db/sqlite.ts";
import { withDataRevisionOperation } from "../../daemon/db/dataRevisionRepository.ts";
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
  markWorkbenchSessionEnrichmentSatisfiedInTransaction,
  markContributionSatisfactionForProvenanceInTransaction,
  markWorkbenchArtifactAppliedInTransaction,
  markWorkbenchArtifactPublishedInTransaction,
  markWorkbenchPublishedInTransaction,
  markWorkbenchTranscriptAvailableInTransaction,
  publishWorkbenchCandidateSessionInTransaction,
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
import type { WorkbenchValidationEvidence } from "../types.ts";
import { getAuthoringBundleSchema, getAuthoringBundleV2Schema, getAuthoringBundleV3Schema, parseAuthoringBundleV2 } from "./authoringSchemas.ts";
import {
  authoringEvidenceRevision,
  getAuthoringEvidenceManifest,
  getAuthoringEvidencePage
} from "./evidenceCatalog.ts";
import { findArtifactSignatureFindings, validateAuthoringBundle, validateAuthoringBundleV2, validateAuthoringBundleV3 } from "./authoringValidation.ts";
import type { ArtifactQualityOutput } from "./artifactQuality.ts";
import { isArtifactCandidateEvidenceCurrent } from "./artifactCandidates.ts";
import { getArtifactSuggestions } from "./advisorySuggestions.ts";
import {
  buildPublishedEnrichedDossierSnapshot,
  dossierEvidenceRefs,
  dossierSnapshotFingerprint
} from "./dossierSnapshot.ts";

const AUTHORING_LEASE_MS = 60 * 60_000;

function withAuthoringMutation<T>(db: MastheadDatabase, callback: () => T): T {
  return withDataRevisionOperation(db, () => withImmediateTransaction(db, callback));
}

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

export type OpenCandidateAuthoringRunResult = {
  ok: true;
  run: WorkbenchAuthoringRunDto;
  evidence: WorkbenchAuthoringEvidenceManifest;
  bundleSchema: Record<string, unknown>;
  contract: {
    contractVersion: "workbench-authoring-v2";
    candidateId: string;
    candidateKind: StoredWorkbenchArtifactCandidate["kind"];
    completion: "publish_candidate_and_canonical_dossiers";
    evidencePolicy: "candidate_scoped_canonical_evidence";
    evidenceRequirements: {
      runbook: ["problem", "change", "verification"];
      adr: ["context", "decision", "alternatives"];
      incident_timeline: ["symptom", "ordered_events", "remediation"];
    };
  };
  currentArtifacts: SessionArtifactRecord[];
};

export type WorkbenchAuthoringRunStatusResult = {
  ok: true;
  run: WorkbenchAuthoringRunDto;
  evidenceStatus: "current" | "changed";
};

export type WorkbenchAuthoringRunContextResult = {
  ok: true;
  runId: string;
  evidenceRevision: string;
  sessions: Array<{ sessionId: string; dossier: SessionDossierDto }>;
  suggestions: WorkbenchArtifactSuggestionDto[];
};

export type OpenAgentLedAuthoringRunResult = {
  ok: true;
  run: WorkbenchAuthoringRunDto;
  evidence: WorkbenchAuthoringEvidenceManifest;
  bundleSchema: Record<string, unknown>;
  contract: {
    contractVersion: "workbench-authoring-v3";
    completion: "publish_enriched_dossiers_and_optional_artifacts";
    evidencePolicy: "selected_session_canonical_evidence";
    maxSessionsPerRun: 12;
    suggestionsAreBinding: false;
  };
  currentArtifacts: SessionArtifactRecord[];
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

export type CandidateFinishMutationBoundary =
  | "canonical_dossiers_published"
  | "optional_artifact_applied"
  | "optional_artifact_published"
  | "pipeline_updated"
  | "search_indexed"
  | "candidate_published"
  | "claims_released"
  | "activities_recorded"
  | "receipt_persisted";

export type AgentLedFinishMutationBoundary =
  | "enrichment_applied"
  | "dossiers_created"
  | "optional_artifacts_created"
  | "artifacts_published"
  | "pipeline_updated"
  | "claims_released"
  | "activities_recorded"
  | "receipt_persisted";

export type AppliedGuidedSessionEnrichment = {
  enrichmentIds: string[];
  sessionId: string;
};

export type StagedGuidedOptionalArtifact = {
  artifact: SessionArtifactRecord;
  draftId: string;
  kind: GuidedArtifactDraft["kind"];
};

export type PublishedGuidedAuthoringArtifacts = {
  publishedArtifacts: GuidedPublishedArtifactDto[];
};

/**
 * Applies one guided session enrichment inside the caller's transaction and
 * returns every stable enrichment row used by the canonical projections.
 */
export function applyGuidedSessionEnrichmentInTransaction(
  db: MastheadDatabase,
  input: {
    actorId: string;
    enrichment: DurableSessionEnrichment;
    sessionId: string;
  }
): AppliedGuidedSessionEnrichment {
  return {
    enrichmentIds: applyDurableSessionEnrichmentInTransaction(
      db,
      input.sessionId,
      input.enrichment,
      input.actorId,
      "guided_authoring"
    ),
    sessionId: input.sessionId
  };
}

/**
 * Establishes the final Workbench reuse fields and stages canonical dossier
 * snapshots for one persisted assignment. The caller owns the transaction.
 */
export function stageGuidedCanonicalDossiersInTransaction(
  db: MastheadDatabase,
  input: {
    assignmentId: string;
    actorId: string;
    evidenceRevision: string;
    sessionIds: string[];
  }
): SessionArtifactRecord[] {
  assertPersistedGuidedAssignmentMembership(db, input.assignmentId, input.actorId, input.sessionIds);
  const actor = { id: input.actorId, kind: "agent" } as const;
  for (const sessionId of input.sessionIds) {
    markWorkbenchArtifactAppliedInTransaction(db, { actor, artifactKind: "session_dossier", sessionId });
    // Publication changes canonical reuse fields. Establish those fields before
    // snapshotting; the final reset helper enforces the complete package gate.
    markWorkbenchPublishedInTransaction(db, {
      actor,
      publishedVia: "guided_authoring_dossier_staging",
      sessionId
    });
  }
  return input.sessionIds.map((sessionId) =>
    applyCanonicalDossierSnapshotInTransaction(db, sessionId, input.actorId, {
      contract: "workbench-authoring-v4",
      evidenceRevision: input.evidenceRevision
    })
  );
}

/** Stages canonical dossiers for a V5 pack after its service has verified durable membership. */
export function stageWorkbenchAuthoringV5CanonicalDossiersInTransaction(
  db: MastheadDatabase,
  input: {
    actorId: string;
    evidenceRevision: string;
    sessionIds: string[];
  }
): SessionArtifactRecord[] {
  const actor = { id: input.actorId, kind: "agent" } as const;
  for (const sessionId of input.sessionIds) {
    markWorkbenchArtifactAppliedInTransaction(db, { actor, artifactKind: "session_dossier", sessionId });
    markWorkbenchPublishedInTransaction(db, {
      actor,
      publishedVia: "workbench_authoring_v5_dossier_staging",
      sessionId
    });
  }
  return input.sessionIds.map((sessionId) =>
    applyCanonicalDossierSnapshotInTransaction(db, sessionId, input.actorId, {
      contract: "workbench-authoring-v5",
      evidenceRevision: input.evidenceRevision
    })
  );
}

/** Stages validated optional artifacts and their Workbench satisfaction state. */
export function stageGuidedOptionalArtifactsInTransaction(
  db: MastheadDatabase,
  input: {
    actorId: string;
    artifacts: GuidedArtifactDraft[];
    assignmentId: string;
    sessionIds: string[];
  }
): StagedGuidedOptionalArtifact[] {
  assertPersistedGuidedAssignmentMembership(db, input.assignmentId, input.actorId, input.sessionIds);
  assertGuidedArtifactMembership(input.artifacts, input.sessionIds);
  return input.artifacts.map((draft) => stageOptionalArtifactInTransaction(
    db, input.actorId, draft, "workbench-authoring-v4"
  ));
}

/** Stages optional artifacts selected by the V5 pack-level consider decision. */
export function stageWorkbenchAuthoringV5OptionalArtifactsInTransaction(
  db: MastheadDatabase,
  input: {
    actorId: string;
    artifacts: WorkbenchAuthoringV5OptionalArtifactDraft[];
    sessionIds: string[];
  }
): StagedGuidedOptionalArtifact[] {
  assertGuidedArtifactMembership(input.artifacts, input.sessionIds);
  return input.artifacts.map((draft) => stageOptionalArtifactInTransaction(
    db, input.actorId, draft, "workbench-authoring-v5"
  ));
}

function stageOptionalArtifactInTransaction(
  db: MastheadDatabase,
  actorId: string,
  draft: GuidedArtifactDraft,
  contractVersion: "workbench-authoring-v4" | "workbench-authoring-v5"
): StagedGuidedOptionalArtifact {
  const actor = { id: actorId, kind: "agent" } as const;
  const artifact = applyGuidedArtifactInTransaction(db, actorId, draft, contractVersion);
  markWorkbenchArtifactAppliedInTransaction(db, { actor, artifactKind: draft.kind, sessionId: draft.seedSessionId });
  markWorkbenchArtifactPublishedInTransaction(db, {
    actor,
    artifactId: artifact.artifactId,
    artifactKind: draft.kind,
    sessionId: draft.seedSessionId
  });
  markContributionSatisfactionForProvenanceInTransaction(db, {
    actor,
    artifactKind: draft.kind,
    provenanceSessionIds: draft.provenanceSessionIds,
    publishedArtifactId: artifact.artifactId,
    seedSessionId: draft.seedSessionId
  });
  return { artifact, draftId: draft.draftId, kind: draft.kind };
}

/** Publishes and indexes artifacts already staged by the caller's transaction. */
export function publishStagedGuidedArtifactsInTransaction(
  db: MastheadDatabase,
  input: {
    dossierArtifacts: SessionArtifactRecord[];
    optionalArtifacts: StagedGuidedOptionalArtifact[];
    verifyPublished?: (artifactId: string) => boolean;
  }
): PublishedGuidedAuthoringArtifacts {
  const publishedDossiers = input.dossierArtifacts.map((artifact) =>
    requirePublishedAuthoringArtifact(db, artifact.artifactId)
  );
  const publishedOptional = input.optionalArtifacts.map(({ artifact }) =>
    requirePublishedAuthoringArtifact(db, artifact.artifactId)
  );
  const published = [...publishedDossiers, ...publishedOptional];
  for (const artifact of published) {
    indexSessionArtifactSearch(db, artifact.artifactId);
    assertPublishedArtifactVisible(db, artifact.artifactId, artifact.provenanceSessionIds);
    if (input.verifyPublished && !input.verifyPublished(artifact.artifactId)) {
      throw new Error(`authoring_finish_visibility_failed:${artifact.artifactId}`);
    }
  }

  return {
    publishedArtifacts: [
      ...publishedDossiers.map((artifact): GuidedPublishedArtifactDto => ({
        artifactId: artifact.artifactId,
        kind: "session_dossier",
        sessionIds: [...artifact.provenanceSessionIds]
      })),
      ...publishedOptional.map((artifact, index): GuidedPublishedArtifactDto => ({
        artifactId: artifact.artifactId,
        draftId: input.optionalArtifacts[index]!.draftId,
        kind: input.optionalArtifacts[index]!.kind,
        sessionIds: [...artifact.provenanceSessionIds]
      }))
    ]
  };
}

export function openAgentLedAuthoringRun(
  db: MastheadDatabase,
  input: { actorId: string; databaseId: string; sessionIds: string[] }
): OpenAgentLedAuthoringRunResult {
  return withAuthoringMutation(db, () => {
    const sessionIds = normalizeSessionIds(input.sessionIds);
    if (sessionIds.length < 1 || sessionIds.length > 12) throw new Error("authoring_session_count_invalid");
    for (const sessionId of sessionIds) assertSessionExists(db, sessionId);
    const databaseId = getOrCreateDatabaseIdentity(db);
    if (input.databaseId !== databaseId) throw new Error("database_identity_mismatch");
    const evidence = authoringEvidenceManifestWithWarnings(db, sessionIds);
    assertCanonicalEvidence(db, evidence);
    const reusable = findReusableWorkbenchAuthoringRun(db, {
      actorId: input.actorId,
      contractVersion: "workbench-authoring-v3",
      databaseId,
      sessionIds
    });
    if (reusable?.status === "completed" && reusable.evidenceRevision === evidence.evidenceRevision) {
      return openAgentLedResult(db, reusable, evidence);
    }
    assertSessionsCompileReady(db, sessionIds);
    if (reusable?.evidenceRevision === evidence.evidenceRevision) {
      const run = renewOrReacquireAuthoringClaimsInTransaction(db, {
        actorId: input.actorId,
        expiresAt: authoringLeaseExpiry(),
        runId: reusable.runId
      });
      return openAgentLedResult(db, run, evidence);
    }
    if (reusable && reusable.status !== "completed") {
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
      return openAgentLedResult(db, run, evidence);
    }
    assertSessionsUnclaimed(db, sessionIds);
    const actor = { id: input.actorId, kind: "agent" } as const;
    const claims = claimWorkbenchSessionsInTransaction(db, {
      claimedBy: input.actorId,
      expiresAt: authoringLeaseExpiry(),
      sessionIds
    }).claims;
    const runId = `authoring:${randomUUID()}`;
    const run = createWorkbenchAuthoringRunInTransaction(db, {
      actorId: input.actorId,
      contractVersion: "workbench-authoring-v3",
      databaseId,
      evidenceRevision: evidence.evidenceRevision,
      runId,
      sessions: claims.map((claim, ordinal) => ({ claimId: claim.claimId, ordinal, sessionId: claim.sessionId }))
    });
    claims.forEach((claim) => recordWorkbenchActivity(db, {
      actor,
      details: { evidenceRevision: evidence.evidenceRevision },
      eventType: "authoring_opened",
      relatedClaimId: claim.claimId,
      relatedRunId: runId,
      sessionId: claim.sessionId,
      summary: "Workbench agent-led authoring opened"
    }));
    return openAgentLedResult(db, run, evidence);
  });
}

export function openAuthoringRun(
  db: MastheadDatabase,
  input: { actorId: string; databaseId: string; sessionIds: string[] }
): OpenAuthoringRunResult {
  return withAuthoringMutation(db, () => {
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

export function openCandidateAuthoringRun(
  db: MastheadDatabase,
  input: { actorId: string; candidateId: string; databaseId: string }
): OpenCandidateAuthoringRunResult {
  return withAuthoringMutation(db, () => {
    const databaseId = getOrCreateDatabaseIdentity(db);
    if (input.databaseId !== databaseId) throw new Error("database_identity_mismatch");
    const candidate = getWorkbenchArtifactCandidate(db, input.candidateId);
    if (!candidate) throw new Error(`artifact_candidate_not_found:${input.candidateId}`);
    const sessionIds = normalizeSessionIds(candidate.provenanceSessionIds);
    if (sessionIds.length < 1 || sessionIds.length > 12) throw new Error("candidate_provenance_count_invalid");
    if (candidate.status === "dismissed" || candidate.status === "superseded" || candidate.status === "published") {
      throw new Error(`artifact_candidate_not_openable:${candidate.status}`);
    }
    for (const sessionId of sessionIds) assertSessionExists(db, sessionId);
    const evidence = authoringEvidenceManifestWithWarnings(db, sessionIds);
    if (!isArtifactCandidateEvidenceCurrent(db, candidate)) {
      throw new Error("candidate_evidence_revision_changed");
    }
    const reusable = findReusableWorkbenchAuthoringRun(db, {
      actorId: input.actorId,
      candidateId: candidate.candidateId,
      contractVersion: "workbench-authoring-v2",
      databaseId,
      sessionIds
    });
    if (reusable) {
      const run = renewOrReacquireAuthoringClaimsInTransaction(db, {
        actorId: input.actorId,
        expiresAt: authoringLeaseExpiry(),
        runId: reusable.runId
      });
      return openCandidateResult(db, candidate, run, evidence);
    }
    if (candidate.status !== "pending") throw new Error("artifact_candidate_claim_conflict");
    assertSessionsCandidateAuthorable(db, sessionIds);
    assertCanonicalEvidence(db, evidence);
    assertSessionsUnclaimed(db, sessionIds);
    const actor = { id: input.actorId, kind: "agent" } as const;
    for (const sessionId of sessionIds) {
      ensureWorkbenchSessionState(db, sessionId);
      markWorkbenchTranscriptAvailableInTransaction(db, { actor, sessionId });
      markWorkbenchQualityPassedInTransaction(db, { actor, sessionId });
    }

    setWorkbenchArtifactCandidateStatus(db, { candidateId: candidate.candidateId, status: "claimed" });
    const claims = claimWorkbenchSessionsInTransaction(db, {
      claimedBy: input.actorId,
      expiresAt: authoringLeaseExpiry(),
      sessionIds
    }).claims;
    const runId = `authoring:${randomUUID()}`;
    const run = createWorkbenchAuthoringRunInTransaction(db, {
      actorId: input.actorId,
      candidateId: candidate.candidateId,
      contractVersion: "workbench-authoring-v2",
      databaseId,
      evidenceRevision: evidence.evidenceRevision,
      runId,
      sessions: claims.map((claim, ordinal) => ({ claimId: claim.claimId, ordinal, sessionId: claim.sessionId }))
    });
    for (const claim of claims) {
      recordWorkbenchActivity(db, {
        actor,
        details: { candidateId: candidate.candidateId, evidenceRevision: evidence.evidenceRevision },
        eventType: "authoring_opened",
        relatedClaimId: claim.claimId,
        relatedRunId: runId,
        sessionId: claim.sessionId,
        summary: `Workbench ${candidate.kind} candidate authoring opened`
      });
    }
    return openCandidateResult(db, candidate, run, evidence);
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

export function getAuthoringRunContext(
  db: MastheadDatabase,
  runId: string
): WorkbenchAuthoringRunContextResult {
  const run = requireAuthoringRun(db, runId);
  const sessions = run.sessionIds.map((sessionId) => {
    const dossier = getSessionDossier(db, sessionId);
    if (!dossier) throw new Error(`canonical_dossier_missing:${sessionId}`);
    return { dossier, sessionId };
  });
  return {
    evidenceRevision: run.evidenceRevision,
    ok: true,
    runId: run.runId,
    sessions,
    suggestions: getArtifactSuggestions(db, run.sessionIds)
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
  input: { bundle: WorkbenchAuthoringBundle | WorkbenchAuthoringBundleV2 | WorkbenchAuthoringBundleV3; runId: string }
): SubmitAuthoringBundleResult {
  return withAuthoringMutation(db, () => {
    const existing = requireAuthoringRun(db, input.runId);
    if (existing.contractVersion !== "workbench-authoring-v3") throw new Error("authoring_contract_audit_only");
    if (existing.status === "completed") throw new Error(`authoring_run_completed:${input.runId}`);
    if (input.bundle.runId !== input.runId) throw new Error("authoring_run_mismatch");
    if (input.bundle.bundleVersion !== existing.contractVersion) {
      throw new Error("unsupported_authoring_bundle_version");
    }
    const renewed = renewOrReacquireAuthoringClaimsInTransaction(db, {
      actorId: existing.actorId,
      expiresAt: authoringLeaseExpiry(),
      runId: input.runId
    });
    const currentEvidenceRevision = authoringEvidenceRevision(db, renewed.sessionIds);
    if (currentEvidenceRevision !== renewed.evidenceRevision) throw new Error("evidence_revision_changed");
    if (input.bundle.evidenceRevision !== renewed.evidenceRevision) throw new Error("evidence_revision_mismatch");

    if (input.bundle.bundleVersion !== "workbench-authoring-v3") {
      throw new Error("unsupported_authoring_bundle_version");
    }
    const validationInput = {
      coverageWarningsBySession: coverageWarningsBySession(db, renewed.sessionIds),
      evidenceByRef: evidenceByRef(db, renewed.sessionIds),
      publishedArtifacts: allCurrentOptionalArtifacts(db),
      selectedSessionIds: renewed.sessionIds
    };
    const validation = validateAuthoringBundleV3({ ...validationInput, bundle: input.bundle });
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

function requireClaimedAuthoringCandidate(
  db: MastheadDatabase,
  run: WorkbenchAuthoringRunDto
): StoredWorkbenchArtifactCandidate {
  if (!run.candidateId) throw new Error("authoring_v2_candidate_required");
  const candidate = getWorkbenchArtifactCandidate(db, run.candidateId);
  if (!candidate) throw new Error(`artifact_candidate_not_found:${run.candidateId}`);
  if (candidate.status !== "claimed") {
    throw new Error(`artifact_candidate_transition_invalid:${candidate.status}:submit`);
  }
  return candidate;
}

function assertCandidateArtifactMatches(
  candidate: StoredWorkbenchArtifactCandidate,
  bundle: WorkbenchAuthoringBundleV2
): void {
  if (bundle.candidateId !== candidate.candidateId) throw new Error("authoring_candidate_mismatch");
  if (
    bundle.artifact.kind !== candidate.kind ||
    bundle.artifact.seedSessionId !== candidate.seedSessionId ||
    !sameOrderedStrings(bundle.artifact.provenanceSessionIds, candidate.provenanceSessionIds)
  ) {
    throw new Error("authoring_candidate_artifact_mismatch");
  }
  const authoredSignatureKey = normalizeSessionArtifactSignatureKey(bundle.artifact.output.signatureKey);
  const candidateSignatureKey = normalizeSessionArtifactSignatureKey(candidate.signatureKey);
  if (authoredSignatureKey !== candidateSignatureKey) {
    throw new Error("authoring_candidate_signature_mismatch");
  }
}

export function finishAuthoringRun(
  db: MastheadDatabase,
  input: {
    runId: string;
    verifyPublished?: (artifactId: string) => boolean;
    onMutationBoundary?: (boundary: CandidateFinishMutationBoundary | AgentLedFinishMutationBoundary) => void;
  }
): WorkbenchAuthoringReceipt {
  return withAuthoringMutation(db, () => {
    const existing = requireAuthoringRun(db, input.runId);
    if (existing.contractVersion !== "workbench-authoring-v3") throw new Error("authoring_contract_audit_only");
    if (existing.receipt) return existing.receipt;
    const existingBundle = requireAgentLedAuthoringBundle(existing);
    const enrichedSessionIds = new Set(existingBundle.sessionEnrichments.map(({ sessionId }) => sessionId));
    if (existing.sessionIds.some((sessionId) => !enrichedSessionIds.has(sessionId))) {
      throw new Error("session_enrichment_required");
    }
    if (existing.status !== "ready_to_finish") {
      throw new Error(`authoring_run_not_ready:${existing.status}`);
    }

    const signatureCollisions = findArtifactSignatureFindings(existingBundle.artifacts).filter(
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
    const runBundle = requireAgentLedAuthoringBundle(run);
    const receipt = finishAgentLedInsideTransaction(
      db,
      { ...run, bundle: runBundle },
      input.verifyPublished,
      input.onMutationBoundary
    );
    completeWorkbenchAuthoringRun(db, { receipt, runId: run.runId });
    input.onMutationBoundary?.("receipt_persisted");
    return receipt;
  });
}

export function canonicalDossierCapsule(snapshot: PublishedSessionDossierV1): {
  confidence: "high" | "medium" | "low";
  highlight: string;
  project?: string;
  summary: string;
  title: string;
} {
  const durable = snapshot.durableEnrichment;
  const durableVerification = durable?.sessionDossier.verification;
  const capturedVerification = durableVerification && (
    durableVerification.status === "passed" ||
    durableVerification.status === "failed" ||
    durableVerification.status === "mixed"
  );
  return {
    confidence:
      durable?.sessionSummary.confidence ??
      ({ authoritative: "high", inferred: "medium", heuristic: "low" } as const)[
        snapshot.identity.sourceConfidence
      ],
    highlight:
      (capturedVerification ? durableVerification.summary : undefined) ??
      durable?.sessionDossier.outcome ??
      durable?.sessionDossier.keyWork[0] ??
      durable?.sessionDossier.decisions[0] ??
      snapshot.attention[0]?.title ??
      snapshot.verification.summary,
    project: snapshot.identity.project,
    summary:
      durable?.sessionSummary.text ??
      snapshot.narrative.finalAssistantMessage ??
      snapshot.narrative.outcome ??
      snapshot.narrative.objective ??
      snapshot.identity.title,
    title: durable?.sessionTitle.text ?? snapshot.identity.title
  };
}

function publishCanonicalDossierForRecoveryInTransaction(
  db: MastheadDatabase,
  sessionId: string,
  actorId: string
): SessionArtifactRecord {
  const canonicalBeforePublication = getSessionDossier(db, sessionId);
  if (!canonicalBeforePublication) throw new Error(`canonical_dossier_missing:${sessionId}`);
  const actor = { id: actorId, kind: "agent" } as const;
  const finishPipeline = (): void => {
    let state = readWorkbenchSessionState(db, sessionId);
    if (
      canonicalBeforePublication.enrichment.status === "current" &&
      state?.sessionEnrichmentStatus !== "satisfied"
    ) {
      markWorkbenchSessionEnrichmentSatisfiedInTransaction(db, { actor, sessionId });
      state = readWorkbenchSessionState(db, sessionId);
    }
    if (state?.sessionDossierStatus !== "satisfied") {
      markWorkbenchArtifactAppliedInTransaction(db, {
        actor,
        artifactKind: "session_dossier",
        sessionId
      });
    }
    markWorkbenchPublishedInTransaction(db, {
      actor,
      publishedVia: "canonical_dossier_publish",
      sessionId
    });
  };

  // Publication changes canonical reuse fields such as MCP eligibility. Capture
  // the durable dossier only after those state changes, within this transaction,
  // so recovery reproduces the canonical dossier users originally published.
  finishPipeline();
  const canonical = getSessionDossier(db, sessionId);
  if (!canonical) throw new Error(`canonical_dossier_missing:${sessionId}`);
  const snapshot = buildPublishedEnrichedDossierSnapshot(canonical);
  const snapshotFingerprint = dossierSnapshotFingerprint(snapshot);
  const evidenceRevision = authoringEvidenceRevision(db, [sessionId]);
  const capsule = canonicalDossierCapsule(snapshot);
  const applied = applySessionArtifactInTransaction(db, {
    artifactKind: "session_dossier",
    confidence: capsule.confidence,
    content: snapshot,
    contentFingerprint: snapshotFingerprint,
    createdBy: `workbench_authoring_v2:${actorId}`,
    evidenceRefs: dossierEvidenceRefs(snapshot),
    highlight: capsule.highlight,
    projectLabel: capsule.project,
    provenanceSessionIds: [sessionId],
    schemaVersion: snapshot.snapshotVersion,
    sessionId,
    summary: capsule.summary,
    title: capsule.title,
    validation: {
      canonicalSnapshot: true,
      contract: "canonical-session-dossier-v1",
      evidenceRevision,
      ok: true
    }
  });
  const published = publishSessionArtifactInTransaction(db, applied.artifactId)!;
  return published;
}

function requireLegacyAuthoringBundle(run: WorkbenchAuthoringRunDto): WorkbenchAuthoringBundle {
  if (!run.bundle) throw new Error(`authoring_run_bundle_missing:${run.runId}`);
  if (run.contractVersion !== "workbench-authoring-v1" || run.bundle.bundleVersion !== "workbench-authoring-v1") {
    throw new Error("unsupported_authoring_service_contract:workbench-authoring-v2");
  }
  return run.bundle;
}

function requireAgentLedAuthoringBundle(run: WorkbenchAuthoringRunDto): WorkbenchAuthoringBundleV3 {
  if (!run.bundle) throw new Error(`authoring_run_bundle_missing:${run.runId}`);
  if (run.contractVersion !== "workbench-authoring-v3" || run.bundle.bundleVersion !== "workbench-authoring-v3") {
    throw new Error("unsupported_authoring_service_contract:workbench-authoring-v3");
  }
  return run.bundle;
}

function finishAgentLedInsideTransaction(
  db: MastheadDatabase,
  run: WorkbenchAuthoringRunDto & { bundle: WorkbenchAuthoringBundleV3 },
  verifyPublished: ((artifactId: string) => boolean) | undefined,
  onMutationBoundary: ((boundary: CandidateFinishMutationBoundary | AgentLedFinishMutationBoundary) => void) | undefined
): WorkbenchAuthoringReceiptV3 {
  const actor = { id: run.actorId, kind: "agent" } as const;
  for (const draft of run.bundle.sessionEnrichments) {
    applyDurableSessionEnrichmentInTransaction(db, draft.sessionId, draft.enrichment, run.actorId);
  }
  onMutationBoundary?.("enrichment_applied");

  const optionalArtifacts = run.bundle.artifacts.map((draft) => applyAgentLedArtifactInTransaction(db, {
    actorId: run.actorId,
    kind: draft.kind,
    output: draft.output,
    provenanceSessionIds: draft.provenanceSessionIds,
    seedSessionId: draft.seedSessionId
  }));
  onMutationBoundary?.("optional_artifacts_created");

  const publishedOptionalArtifacts = optionalArtifacts.map((artifact) => {
    const published = publishSessionArtifactInTransaction(db, artifact.artifactId);
    if (!published) throw new Error(`authoring_finish_artifact_missing:${artifact.artifactId}`);
    return published;
  });

  for (const sessionId of run.sessionIds) {
    markWorkbenchArtifactAppliedInTransaction(db, { actor, artifactKind: "session_dossier", sessionId });
  }
  const contributions: WorkbenchAuthoringReceiptV3["contributions"] = [];
  optionalArtifacts.forEach((artifact, index) => {
    const draft = run.bundle.artifacts[index]!;
    markWorkbenchArtifactAppliedInTransaction(db, { actor, artifactKind: draft.kind, sessionId: draft.seedSessionId });
    markWorkbenchArtifactPublishedInTransaction(db, {
      actor,
      artifactId: artifact.artifactId,
      artifactKind: draft.kind,
      sessionId: draft.seedSessionId
    });
    markContributionSatisfactionForProvenanceInTransaction(db, {
      actor,
      artifactKind: draft.kind,
      provenanceSessionIds: draft.provenanceSessionIds,
      publishedArtifactId: artifact.artifactId,
      seedSessionId: draft.seedSessionId
    });
    draft.provenanceSessionIds.filter((id) => id !== draft.seedSessionId).forEach((sessionId) => {
      contributions.push({ artifactId: artifact.artifactId, kind: draft.kind, sessionId });
    });
  });
  for (const sessionId of run.sessionIds) {
    const result = publishWorkbenchSessionInTransaction(db, { actor, sessionId });
    if (!result.ok) throw new Error(`authoring_finish_package_gate_failed:${sessionId}:${result.missing.join(",")}`);
  }
  onMutationBoundary?.("pipeline_updated");

  // Session publication determines canonical reuse fields such as MCP
  // inclusion. Render the immutable dossier only after that state is final,
  // while remaining inside the same atomic finish transaction.
  const dossierArtifacts = run.sessionIds.map((sessionId) =>
    applyCanonicalDossierSnapshotInTransaction(db, sessionId, run.actorId)
  );
  onMutationBoundary?.("dossiers_created");
  const publishedDossierArtifacts = dossierArtifacts.map((artifact) => {
    const published = publishSessionArtifactInTransaction(db, artifact.artifactId);
    if (!published) throw new Error(`authoring_finish_artifact_missing:${artifact.artifactId}`);
    return published;
  });
  const publishedArtifacts = [...publishedDossierArtifacts, ...publishedOptionalArtifacts];
  onMutationBoundary?.("artifacts_published");

  for (const published of publishedArtifacts) {
    indexSessionArtifactSearch(db, published.artifactId);
    assertPublishedArtifactVisible(db, published.artifactId, published.provenanceSessionIds);
    if (verifyPublished && !verifyPublished(published.artifactId)) {
      throw new Error(`authoring_finish_visibility_failed:${published.artifactId}`);
    }
  }

  run.claimIds.forEach((claimId) => releaseWorkbenchClaimInTransaction(db, { claimId, reason: "authoring_finished" }));
  onMutationBoundary?.("claims_released");

  const receipt: WorkbenchAuthoringReceiptV3 = {
    completedAt: new Date().toISOString(),
    contractVersion: "workbench-authoring-v3",
    contributions: contributions.sort(compareReceiptResolution),
    dossierArtifactIds: dossierArtifacts.map(({ artifactId }) => artifactId),
    optionalArtifacts: optionalArtifacts.map((artifact, index) => ({
      artifactId: artifact.artifactId,
      kind: run.bundle.artifacts[index]!.kind,
      provenanceSessionIds: [...run.bundle.artifacts[index]!.provenanceSessionIds]
    })),
    publishedArtifactIds: publishedArtifacts.map(({ artifactId }) => artifactId),
    resolvedSessionIds: [...run.sessionIds],
    runId: run.runId
  };
  run.sessionIds.forEach((sessionId, index) => recordWorkbenchActivity(db, {
    actor,
    details: { dossierArtifactIds: receipt.dossierArtifactIds, optionalArtifacts: receipt.optionalArtifacts },
    eventType: "authoring_finished",
    relatedClaimId: run.claimIds[index],
    relatedRunId: run.runId,
    sessionId,
    summary: "Workbench agent-led authoring finished"
  }));
  onMutationBoundary?.("activities_recorded");
  return receipt;
}

function requireCandidateAuthoringBundle(run: WorkbenchAuthoringRunDto): WorkbenchAuthoringBundleV2 {
  if (!run.bundle) throw new Error(`authoring_run_bundle_missing:${run.runId}`);
  if (run.contractVersion !== "workbench-authoring-v2" || run.bundle.bundleVersion !== "workbench-authoring-v2") {
    throw new Error("unsupported_authoring_service_contract:workbench-authoring-v1");
  }
  const artifact = "artifact" in run.bundle ? run.bundle.artifact : undefined;
  if (
    !artifact ||
    typeof artifact !== "object" ||
    typeof artifact.kind !== "string" ||
    typeof artifact.seedSessionId !== "string" ||
    !Array.isArray(artifact.provenanceSessionIds) ||
    !artifact.output ||
    typeof artifact.output !== "object" ||
    Array.isArray(artifact.output)
  ) {
    throw new Error("candidate_artifact_required");
  }
  return run.bundle;
}

function finishCandidateInsideTransaction(
  db: MastheadDatabase,
  run: WorkbenchAuthoringRunDto & { bundle: WorkbenchAuthoringBundleV2 },
  candidate: StoredWorkbenchArtifactCandidate,
  verifyPublished: ((artifactId: string) => boolean) | undefined,
  onMutationBoundary: ((boundary: CandidateFinishMutationBoundary) => void) | undefined
): WorkbenchAuthoringReceiptV2 {
  const actor = { id: run.actorId, kind: "agent" } as const;
  const dossierArtifacts = candidate.provenanceSessionIds.map((sessionId) =>
    publishCanonicalDossierForRecoveryInTransaction(db, sessionId, run.actorId)
  );
  onMutationBoundary?.("canonical_dossiers_published");

  const signatureKey = normalizeSessionArtifactSignatureKey(candidate.signatureKey);
  const supersededProvenanceSessionIds = currentPublishedSignatureProvenanceSessionIds(
    db,
    candidate.kind,
    signatureKey
  );
  const optionalArtifact = applyCandidateAuthoringArtifactInTransaction(db, {
    actorId: run.actorId,
    candidate,
    output: run.bundle.artifact.output,
    signatureKey
  });
  onMutationBoundary?.("optional_artifact_applied");

  const publishedOptionalArtifact = publishSessionArtifactInTransaction(db, optionalArtifact.artifactId);
  if (!publishedOptionalArtifact) {
    throw new Error(`authoring_finish_artifact_missing:${optionalArtifact.artifactId}`);
  }
  onMutationBoundary?.("optional_artifact_published");

  markWorkbenchArtifactAppliedInTransaction(db, {
    actor,
    artifactKind: candidate.kind,
    sessionId: candidate.seedSessionId
  });
  markWorkbenchArtifactPublishedInTransaction(db, {
    actor,
    artifactId: publishedOptionalArtifact.artifactId,
    artifactKind: candidate.kind,
    sessionId: candidate.seedSessionId
  });
  markContributionSatisfactionForProvenanceInTransaction(db, {
    actor,
    artifactKind: candidate.kind,
    provenanceSessionIds: candidate.provenanceSessionIds,
    publishedArtifactId: publishedOptionalArtifact.artifactId,
    seedSessionId: candidate.seedSessionId
  });
  if (supersededProvenanceSessionIds.length > 0) {
    reconcileWorkbenchArtifactSatisfactionInTransaction(db, {
      artifactKind: candidate.kind,
      sessionIds: supersededProvenanceSessionIds
    });
  }
  for (const sessionId of candidate.provenanceSessionIds) {
    publishWorkbenchCandidateSessionInTransaction(db, { actor, sessionId });
  }
  onMutationBoundary?.("pipeline_updated");

  const expectedArtifacts = [...dossierArtifacts, publishedOptionalArtifact];
  for (const artifact of expectedArtifacts) {
    indexSessionArtifactSearch(db, artifact.artifactId);
    assertPublishedArtifactVisible(db, artifact.artifactId, artifact.provenanceSessionIds);
    if (verifyPublished && !verifyPublished(artifact.artifactId)) {
      throw new Error(`authoring_finish_visibility_failed:${artifact.artifactId}`);
    }
  }
  onMutationBoundary?.("search_indexed");

  publishClaimedWorkbenchArtifactCandidateInTransaction(db, candidate.candidateId);
  onMutationBoundary?.("candidate_published");

  for (const claimId of run.claimIds) {
    releaseWorkbenchClaimInTransaction(db, { claimId, reason: "authoring_finished" });
  }
  onMutationBoundary?.("claims_released");

  const contributions = candidate.provenanceSessionIds
    .filter((sessionId) => sessionId !== candidate.seedSessionId)
    .map((sessionId) => ({ artifactId: publishedOptionalArtifact.artifactId, kind: candidate.kind, sessionId }))
    .sort(compareReceiptResolution);
  const receipt: WorkbenchAuthoringReceiptV2 = {
    candidateId: candidate.candidateId,
    completedAt: new Date().toISOString(),
    contractVersion: "workbench-authoring-v2",
    contributions,
    dossierArtifactIds: dossierArtifacts.map(({ artifactId }) => artifactId),
    optionalArtifact: { artifactId: publishedOptionalArtifact.artifactId, kind: candidate.kind },
    provenanceSessionIds: [...candidate.provenanceSessionIds],
    publishedArtifactIds: [
      ...dossierArtifacts.map(({ artifactId }) => artifactId),
      publishedOptionalArtifact.artifactId
    ],
    resolvedSessionIds: [...candidate.provenanceSessionIds],
    runId: run.runId
  };
  run.sessionIds.forEach((sessionId, index) => {
    recordWorkbenchActivity(db, {
      actor,
      details: {
        candidateId: candidate.candidateId,
        dossierArtifactIds: receipt.dossierArtifactIds,
        optionalArtifact: receipt.optionalArtifact
      },
      eventType: "authoring_finished",
      relatedClaimId: run.claimIds[index],
      relatedRunId: run.runId,
      sessionId,
      summary: `Workbench ${candidate.kind} candidate authoring finished`
    });
  });
  onMutationBoundary?.("activities_recorded");
  return receipt;
}

function finishInsideTransaction(
  db: MastheadDatabase,
  run: WorkbenchAuthoringRunDto & { bundle: WorkbenchAuthoringBundle },
  verifyPublished: ((artifactId: string) => boolean) | undefined
): WorkbenchAuthoringReceiptV1 {
  const actor = { id: run.actorId, kind: "agent" } as const;
  const expectedArtifacts: Array<{ artifactId: string; provenanceSessionIds: string[] }> = [];
  const contributions: WorkbenchAuthoringReceiptV1["contributions"] = [];
  const appliedArtifacts: Array<{
    artifact: SessionArtifactRecord;
    kind: SessionArtifactRecord["artifactKind"];
    provenanceSessionIds: string[];
    seedSessionId: string;
    supersededProvenanceSessionIds: string[];
  }> = [];

  for (const sessionPackage of run.bundle.sessionPackages) {
    const dossier = publishCanonicalDossierForRecoveryInTransaction(db, sessionPackage.sessionId, run.actorId);
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

  const receipt: WorkbenchAuthoringReceiptV1 = {
    completedAt: new Date().toISOString(),
    contractVersion: "workbench-authoring-v1",
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

function openAgentLedResult(
  db: MastheadDatabase,
  run: WorkbenchAuthoringRunDto,
  evidence: WorkbenchAuthoringEvidenceManifest
): OpenAgentLedAuthoringRunResult {
  return {
    bundleSchema: getAuthoringBundleV3Schema(),
    contract: {
      completion: "publish_enriched_dossiers_and_optional_artifacts",
      contractVersion: "workbench-authoring-v3",
      evidencePolicy: "selected_session_canonical_evidence",
      maxSessionsPerRun: 12,
      suggestionsAreBinding: false
    },
    currentArtifacts: currentArtifacts(db, run.sessionIds),
    evidence,
    ok: true,
    run
  };
}

function openCandidateResult(
  db: MastheadDatabase,
  candidate: StoredWorkbenchArtifactCandidate,
  run: WorkbenchAuthoringRunDto,
  evidence: WorkbenchAuthoringEvidenceManifest
): OpenCandidateAuthoringRunResult {
  return {
    bundleSchema: getAuthoringBundleV2Schema(),
    contract: {
      candidateId: candidate.candidateId,
      candidateKind: candidate.kind,
      completion: "publish_candidate_and_canonical_dossiers",
      contractVersion: "workbench-authoring-v2",
      evidencePolicy: "candidate_scoped_canonical_evidence",
      evidenceRequirements: {
        adr: ["context", "decision", "alternatives"],
        incident_timeline: ["symptom", "ordered_events", "remediation"],
        runbook: ["problem", "change", "verification"]
      }
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

function sameOrderedStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

function assertSessionsCompileReady(db: MastheadDatabase, sessionIds: string[]): void {
  for (const sessionId of sessionIds) {
    const state = readWorkbenchSessionState(db, sessionId);
    const transcriptReady = state?.transcriptStatus === "available" || state?.transcriptStatus === "imported";
    if (state?.publicationStatus !== "publish_path" || !transcriptReady || state.qualityStatus !== "passed") {
      throw new Error(`authoring_session_not_compile_ready:${sessionId}`);
    }
  }
}

function assertSessionsCandidateAuthorable(db: MastheadDatabase, sessionIds: string[]): void {
  for (const sessionId of sessionIds) {
    const state = readWorkbenchSessionState(db, sessionId);
    if (state?.publicationStatus === "not_added_to_logbook") {
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
      if (precheck.disposition !== "keep") {
        warnings.push(`Capture quality precheck reported ${precheck.reason}.`);
      }
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
        label: item.label,
        lowValue: item.lowValue ?? false,
        observedAt: item.observedAt,
        role: item.role,
        sessionId,
        status: item.status,
        text: item.kind === "file_effect"
          ? `${item.label} ${item.text}`
          : item.kind === "message"
            ? (item.narrativeText ?? item.text)
            : item.text,
        toolName: item.toolName
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

function allCurrentOptionalArtifacts(db: MastheadDatabase): SessionArtifactRecord[] {
  const rows = db.prepare(
    `SELECT artifact_id AS artifactId
     FROM session_artifacts
     WHERE status = 'current'
       AND publication_status = 'published'
       AND artifact_kind IN ('runbook', 'adr', 'incident_timeline')
     ORDER BY artifact_id`
  ).all() as Array<{ artifactId: string }>;
  return rows.flatMap(({ artifactId }) => {
    const artifact = getSessionArtifact(db, artifactId);
    return artifact ? [artifact] : [];
  });
}

function recentAcceptedCandidateOutputs(
  db: MastheadDatabase,
  candidateId: string,
  limit = 100
): ArtifactQualityOutput[] {
  const rows = db.prepare(
    `SELECT bundle_json AS bundleJson
     FROM workbench_authoring_runs
     WHERE contract_version = 'workbench-authoring-v2'
       AND candidate_id <> ?
       AND status = 'ready_to_finish'
       AND bundle_json IS NOT NULL
     ORDER BY updated_at DESC, run_id DESC
     LIMIT ?`
  ).all(candidateId, limit) as Array<{ bundleJson: string }>;
  return rows.flatMap(({ bundleJson }) => {
    try {
      const bundle = parseAuthoringBundleV2(JSON.parse(bundleJson));
      return [{
        candidateId: bundle.candidateId,
        kind: bundle.artifact.kind,
        output: bundle.artifact.output,
        provenanceSessionIds: bundle.artifact.provenanceSessionIds
      }];
    } catch {
      return [];
    }
  });
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

function applyCanonicalDossierSnapshotInTransaction(
  db: MastheadDatabase,
  sessionId: string,
  actorId: string,
  options: {
    contract: "workbench-authoring-v3" | "workbench-authoring-v4" | "workbench-authoring-v5";
    evidenceRevision?: string;
  } = { contract: "workbench-authoring-v3" }
): SessionArtifactRecord {
  const canonical = getSessionDossier(db, sessionId);
  if (!canonical) throw new Error(`canonical_dossier_missing:${sessionId}`);
  const snapshot = buildPublishedEnrichedDossierSnapshot(canonical);
  const capsule = canonicalDossierCapsule(snapshot);
  const snapshotFingerprint = dossierSnapshotFingerprint(snapshot);
  const contentFingerprint = options.contract === "workbench-authoring-v4" || options.contract === "workbench-authoring-v5"
    ? fingerprintWorkbenchOutput({
        contract: options.contract,
        evidenceRevision: options.evidenceRevision,
        snapshotFingerprint
      })
    : snapshotFingerprint;
  return applySessionArtifactInTransaction(db, {
    artifactKind: "session_dossier",
    confidence: capsule.confidence,
    content: snapshot,
    contentFingerprint,
    createdBy: options.contract === "workbench-authoring-v4"
      ? `guided_authoring:${actorId}`
      : options.contract === "workbench-authoring-v5"
        ? `workbench_authoring_v5:${actorId}`
      : `workbench_authoring_v3:${actorId}`,
    evidenceRefs: dossierEvidenceRefs(snapshot),
    highlight: capsule.highlight,
    projectLabel: capsule.project,
    provenanceSessionIds: [sessionId],
    schemaVersion: snapshot.snapshotVersion,
    sessionId,
    summary: capsule.summary,
    title: capsule.title,
    validation: {
      canonicalSnapshot: true,
      contract: options.contract,
      evidenceRevision: options.evidenceRevision ?? authoringEvidenceRevision(db, [sessionId]),
      ok: true
    }
  });
}

function applyDurableSessionEnrichmentInTransaction(
  db: MastheadDatabase,
  sessionId: string,
  enrichment: DurableSessionEnrichment,
  actorId: string,
  provider: "guided_authoring" | "workbench_authoring_v3" = "workbench_authoring_v3"
): string[] {
  const canonicalEnrichment = canonicalizeDurableEnrichmentEvidence(db, sessionId, enrichment);
  const generatedAt = canonicalEnrichment.generatedAt ?? new Date().toISOString();
  const contentFingerprint = fingerprintWorkbenchOutput(canonicalEnrichment);
  const sourceRefs = [
    ...canonicalEnrichment.sessionTitle.evidenceRefs,
    ...canonicalEnrichment.sessionSummary.evidenceRefs,
    ...canonicalEnrichment.sessionDossier.evidenceRefs,
    ...canonicalEnrichment.sessionDossier.verification.evidenceRefs
  ].filter((ref, index, refs) => refs.findIndex((candidate) => candidate.id === ref.id) === index);
  const capsule: SessionCapsule = {
    candidateDecisions: [],
    confidence: canonicalEnrichment.sessionSummary.confidence,
    durableEnrichment: { ...canonicalEnrichment, generatedAt },
    liveSummary: canonicalEnrichment.sessionSummary.text,
    outcome: canonicalEnrichment.sessionDossier.outcome,
    searchPhrases: [],
    searchSummary: canonicalEnrichment.sessionSummary.text,
    sessionDossier: canonicalEnrichment.sessionDossier,
    sessionSummary: canonicalEnrichment.sessionSummary,
    sessionTitle: canonicalEnrichment.sessionTitle,
    technologies: [],
    title: canonicalEnrichment.sessionTitle.text,
    titleSource: "llm",
    topics: [],
    unresolved: [],
    validationWarnings: canonicalEnrichment.sessionDossier.warnings
  };
  const contents = {
    live_summary: { text: canonicalEnrichment.sessionSummary.text },
    search_projection: {
      keywords: canonicalEnrichment.keywords,
      searchText: [
        canonicalEnrichment.sessionTitle.text,
        canonicalEnrichment.sessionSummary.text,
        ...canonicalEnrichment.keywords
      ].join("\n"),
      title: canonicalEnrichment.sessionTitle.text
    },
    session_capsule: capsule
  } as const;
  const enrichmentIds: string[] = [];
  for (const enrichmentKind of ["session_capsule", "live_summary", "search_projection"] as const) {
    markStaleCurrentSessionEnrichments(db, {
      enrichmentKind,
      exceptContentFingerprint: contentFingerprint,
      promptVersion: SESSION_CAPSULE_PROMPT_VERSION,
      sessionId
    });
    enrichmentIds.push(upsertSessionEnrichment(db, {
      content: contents[enrichmentKind],
      contentFingerprint,
      enrichmentKind,
      generatedAt,
      model: enrichment.model ?? "external_agent",
      promptVersion: SESSION_CAPSULE_PROMPT_VERSION,
      provider,
      sessionId,
      sourceRefs,
      status: "current"
    }));
  }
  indexCanonicalSessionSearch(db, sessionId);
  markWorkbenchSessionEnrichmentSatisfiedInTransaction(db, {
    actor: { id: actorId, kind: "agent" },
    sessionId
  });
  return enrichmentIds;
}

function canonicalizeDurableEnrichmentEvidence(
  db: MastheadDatabase,
  sessionId: string,
  enrichment: DurableSessionEnrichment
): DurableSessionEnrichment {
  const canonicalById = new Map<string, EvidenceRef>();
  for (const item of iterateSessionTranscriptItems(db, { order: "asc", sessionId })) {
    canonicalById.set(item.itemId, {
      id: item.itemId,
      kind: canonicalEvidenceKind(item.kind),
      observedAt: item.observedAt,
      source: "canonical"
    });
  }
  const resolve = (refs: EvidenceRef[]): EvidenceRef[] => refs.map(({ id }) => {
    const canonical = canonicalById.get(id);
    if (!canonical) throw new Error(`unknown_canonical_evidence_ref:${sessionId}:${id}`);
    return canonical;
  });
  const canonical = structuredClone(enrichment);
  canonical.sessionTitle.evidenceRefs = resolve(canonical.sessionTitle.evidenceRefs);
  canonical.sessionSummary.evidenceRefs = resolve(canonical.sessionSummary.evidenceRefs);
  canonical.sessionDossier.evidenceRefs = resolve(canonical.sessionDossier.evidenceRefs);
  canonical.sessionDossier.verification.evidenceRefs = resolve(
    canonical.sessionDossier.verification.evidenceRefs
  );
  return canonical;
}

function canonicalEvidenceKind(kind: SessionTranscriptKind): EvidenceKind {
  if (kind === "tool_call" || kind === "tool_result") return "command";
  if (kind === "file_effect") return "file_change";
  return "event";
}

function applyAgentLedArtifactInTransaction(
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
    createdBy: `workbench_authoring_v3:${input.actorId}`,
    evidenceRefs: stringArrayFromOutput(input.output.evidenceRefs),
    joinRationale: stringFromOutput(input.output.joinRationale),
    projectLabel: projectLabelForSession(db, input.seedSessionId),
    provenanceSessionIds: input.provenanceSessionIds,
    schemaVersion: `${input.kind}-v2`,
    sessionId: input.seedSessionId,
    signatureKey: normalizeSessionArtifactSignatureKey(input.output.signatureKey),
    title: stringFromOutput(input.output.title),
    validation: { contract: "workbench-authoring-v3", ok: true, schemaVersion: `${input.kind}-v2` }
  });
}

function applyGuidedArtifactInTransaction(
  db: MastheadDatabase,
  actorId: string,
  draft: GuidedArtifactDraft,
  contractVersion: "workbench-authoring-v4" | "workbench-authoring-v5" = "workbench-authoring-v4"
): SessionArtifactRecord {
  return applySessionArtifactInTransaction(db, {
    artifactKind: draft.kind,
    confidence: confidenceFromOutput(draft.output),
    content: draft.output,
    contentFingerprint: fingerprintWorkbenchOutput({
      artifactKind: draft.kind,
      output: draft.output,
      provenanceSessionIds: [...new Set(draft.provenanceSessionIds)].sort(),
      seedSessionId: draft.seedSessionId,
      signatureKey: normalizeSessionArtifactSignatureKey(draft.output.signatureKey)
    }),
    createdBy: contractVersion === "workbench-authoring-v5"
      ? `workbench_authoring_v5:${actorId}`
      : `guided_authoring:${actorId}`,
    evidenceRefs: stringArrayFromOutput(draft.output.evidenceRefs),
    joinRationale: stringFromOutput(draft.output.joinRationale),
    projectLabel: projectLabelForSession(db, draft.seedSessionId),
    provenanceSessionIds: draft.provenanceSessionIds,
    schemaVersion: `${draft.kind}-v2`,
    sessionId: draft.seedSessionId,
    signatureKey: normalizeSessionArtifactSignatureKey(draft.output.signatureKey),
    title: stringFromOutput(draft.output.title),
    validation: { contract: contractVersion, ok: true, schemaVersion: `${draft.kind}-v2` }
  });
}

function assertPersistedGuidedAssignmentMembership(
  db: MastheadDatabase,
  assignmentId: string,
  actorId: string,
  sessionIds: string[]
): void {
  const persisted = db.prepare(
    `SELECT membership.session_id AS sessionId, requests.actor_id AS actorId
     FROM guided_authoring_assignment_sessions AS membership
     JOIN guided_authoring_requests AS requests ON requests.request_id = membership.request_id
     WHERE membership.assignment_id = ?
     ORDER BY membership.ordinal`
  ).all(assignmentId) as Array<{ actorId: string; sessionId: string }>;
  if (persisted.length === 0) throw new Error("guided_assignment_not_found");
  if (persisted.some((row) => row.actorId !== actorId)) {
    throw new Error("guided_authoring_actor_mismatch");
  }
  if (!sameOrderedStrings(persisted.map(({ sessionId }) => sessionId), sessionIds)) {
    throw new Error("guided_assignment_session_membership_mismatch");
  }
}

function assertGuidedArtifactMembership(artifacts: GuidedArtifactDraft[], sessionIds: string[]): void {
  const membership = new Set(sessionIds);
  for (const artifact of artifacts) {
    if (!membership.has(artifact.seedSessionId) || artifact.provenanceSessionIds.some((id) => !membership.has(id))) {
      throw new Error("guided_artifact_provenance_membership_mismatch");
    }
  }
}

function requirePublishedAuthoringArtifact(db: MastheadDatabase, artifactId: string): SessionArtifactRecord {
  const published = publishSessionArtifactInTransaction(db, artifactId);
  if (!published) throw new Error(`authoring_finish_artifact_missing:${artifactId}`);
  return published;
}

function applyCandidateAuthoringArtifactInTransaction(
  db: MastheadDatabase,
  input: {
    actorId: string;
    candidate: StoredWorkbenchArtifactCandidate;
    output: Record<string, unknown>;
    signatureKey?: string;
  }
): SessionArtifactRecord {
  return applySessionArtifactInTransaction(db, {
    artifactKind: input.candidate.kind,
    confidence: confidenceFromOutput(input.output),
    content: input.output,
    contentFingerprint: fingerprintWorkbenchOutput({
      candidateId: input.candidate.candidateId,
      evidenceRevision: input.candidate.evidenceRevision,
      output: input.output
    }),
    createdBy: `workbench_authoring_v2:${input.actorId}`,
    evidenceRefs: stringArrayFromOutput(input.output.evidenceRefs),
    joinRationale: stringFromOutput(input.output.joinRationale),
    projectLabel: projectLabelForSession(db, input.candidate.seedSessionId),
    provenanceSessionIds: input.candidate.provenanceSessionIds,
    schemaVersion: `${input.candidate.kind}-v2`,
    sessionId: input.candidate.seedSessionId,
    signatureKey: input.signatureKey,
    title: stringFromOutput(input.output.title),
    validation: {
      candidateId: input.candidate.candidateId,
      contract: "workbench-authoring-v2",
      evidenceRevision: input.candidate.evidenceRevision,
      ok: true,
      schemaVersion: `${input.candidate.kind}-v2`
    }
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
