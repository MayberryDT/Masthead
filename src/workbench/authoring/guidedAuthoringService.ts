import { randomUUID } from "node:crypto";
import { stableRecordId } from "../../daemon/identity.ts";
import {
  createGuidedAuthoringRequestInTransaction,
  advanceGuidedAssignmentEvidenceRevisionInTransaction,
  getGuidedAssignment,
  getGuidedAssignmentReceipt,
  getGuidedAssignments,
  getGuidedAuthoringRequest,
  getGuidedAuthoringRequestForAssignment,
  invalidateLockedGuidedAssignmentEvidenceInTransaction,
  listGuidedDraftReviews,
  listGuidedEvidenceAccess,
  listGuidedOperatorReviews,
  listGuidedOpportunities,
  listPendingGuidedCanaryAssignments,
  recordCanaryDecisionInTransaction,
  recordGuidedEvidenceAccessInTransaction,
  persistGuidedAssignmentReceiptInTransaction,
  storeGuidedDraftReviewInTransaction,
  transitionGuidedAssignmentAfterReceiptInTransaction,
  type GuidedAuthoringOpportunityRecord,
  type GuidedAuthoringStableRequestBinding
} from "../../daemon/db/guidedAuthoringRepository.ts";
import { recordGuidedEnrichmentProvenanceInTransaction } from "../../daemon/db/enrichmentRepository.ts";
import { resetGuidedAssignmentWorkbenchInTransaction } from "../../daemon/db/workbenchPipelineRepository.ts";
import { getSessionDossier } from "../../daemon/db/sessionDossierRepository.ts";
import { type MastheadDatabase, withImmediateTransaction } from "../../daemon/db/sqlite.ts";
import {
  bumpDataRevisionInTransaction,
  withDataRevisionOperation
} from "../../daemon/db/dataRevisionRepository.ts";
import {
  GUIDED_AUTHORING_POLICY_VERSION,
  type GuidedAuthoringAssignmentDto,
  type GuidedAuthoringBundleV4,
  type GuidedAuthoringExpectedIdentity,
  type GuidedAuthoringReceiptDto,
  type GuidedAuthoringReviewDto,
  type GuidedEvidenceCoverageDto,
  type GuidedInspectionDto,
  type GuidedAuthoringNextAction,
  type GuidedAuthoringRequestDto
} from "../../shared/guidedAuthoring.ts";
import {
  assertGuidedAuthoringExpectedIdentity,
  assertStableGuidedRequestBinding
} from "../../shared/instanceIdentity.ts";
import type { SessionTranscriptOrder } from "../../shared/sessionTranscript.ts";
import type { SessionTranscriptKindFilter } from "../../daemon/db/sessionTranscriptRepository.ts";
import { iterateSessionTranscriptItems } from "../../daemon/db/sessionTranscriptRepository.ts";
import type { SessionDossierDto } from "../../shared/sessionDossier.ts";
import type { WorkbenchValidationEvidence } from "../types.ts";
import * as advisorySuggestions from "./advisorySuggestions.ts";
import * as evidenceCatalog from "./evidenceCatalog.ts";
import {
  GUIDED_ARTIFACT_RUBRICS,
  GUIDED_EVIDENCE_QUESTIONS,
  planGuidedAssignments
} from "./guidedAuthoringPolicy.ts";
import { assertGuidedSelectionCompileReady } from "./guidedAuthoringPreflight.ts";
import type {
  GuidedAcceptedDraftForQuality,
  GuidedAuthoringValidationInput,
  GuidedQualityOpportunity
} from "./guidedAuthoringQuality.ts";
import * as guidedQuality from "./guidedAuthoringQuality.ts";
import {
  applyGuidedSessionEnrichmentInTransaction,
  publishStagedGuidedArtifactsInTransaction,
  stageGuidedCanonicalDossiersInTransaction,
  stageGuidedOptionalArtifactsInTransaction
} from "./authoringService.ts";
import { getGuidedAuthoringBundleV4Schema } from "./authoringSchemas.ts";

export type GuidedMutationIdentityInput = {
  expectedIdentity: GuidedAuthoringExpectedIdentity;
  currentIdentity: GuidedAuthoringExpectedIdentity;
};

export type SaveGuidedDraftInput = GuidedMutationIdentityInput & {
  assignmentId: string;
  command: string;
  draft: GuidedAuthoringBundleV4;
};

export type GuidedCanaryDecisionInput = GuidedMutationIdentityInput & {
  requestId: string;
  assignmentId: string;
  draftRevision: number;
  evidenceRevision: string;
  command: string;
  notes: string;
  reviewedBy: string;
};

export type FinishGuidedAssignmentInput = GuidedMutationIdentityInput & {
  assignmentId: string;
  command: string;
};

export type FinishGuidedAssignmentResult = {
  receipt: GuidedAuthoringReceiptDto;
  nextAction: GuidedAuthoringNextAction & { kind: "claim_next" | "complete" };
};

export const GUIDED_VALIDATION_STATE_FAMILIES = [
  "assignment",
  "coverage",
  "canonical_dossier",
  "canonical_evidence",
  "opportunity",
  "accepted_revision"
] as const;

export type GuidedValidationStateFamily = typeof GUIDED_VALIDATION_STATE_FAMILIES[number];

export const GUIDED_PUBLICATION_FAILURE_POINTS = [
  "after_enrichment",
  "after_dossier_staging",
  "after_optional_staging",
  "after_artifact_publish",
  "after_session_claim_reset",
  "after_receipt_insert",
  "after_request_or_next_assignment_transition"
] as const;

export type GuidedPublicationFailurePoint = typeof GUIDED_PUBLICATION_FAILURE_POINTS[number];

export type GuidedAuthoringServiceTestHooks = {
  afterOwnedSaveBegin?: () => void;
  beforeValidationStateRead?: (family: GuidedValidationStateFamily) => void;
  afterPublicationBoundary?: (point: GuidedPublicationFailurePoint) => void;
};

const guidedServiceTestHooks = new WeakMap<MastheadDatabase, GuidedAuthoringServiceTestHooks>();

/** Connection-scoped deterministic seams for transaction-order and rollback tests. */
export function installGuidedAuthoringServiceTestHooks(
  db: MastheadDatabase,
  hooks: GuidedAuthoringServiceTestHooks
): () => void {
  guidedServiceTestHooks.set(db, hooks);
  return () => { guidedServiceTestHooks.delete(db); };
}

export type CreateGuidedRequestInput = {
  actorId: string;
  command: string;
  currentIdentity: GuidedAuthoringExpectedIdentity;
  expectedIdentity: GuidedAuthoringExpectedIdentity;
  sessionIds: string[];
};

export type CreateGuidedRequestResult = {
  request: GuidedAuthoringRequestDto;
  nextAction: GuidedAuthoringNextAction & { kind: "claim_next" };
};

export function createGuidedRequest(
  db: MastheadDatabase,
  input: CreateGuidedRequestInput
): CreateGuidedRequestResult {
  assertRequestMembershipShape(input.sessionIds);
  assertGuidedAuthoringExpectedIdentity(input.currentIdentity, input.expectedIdentity);
  return withImmediateTransaction(db, () => {
    const preflight = assertGuidedSelectionCompileReady(db, input.sessionIds);
    const plan = planGuidedAssignments(
      preflight.sessions.map(({ evidence, ordinal, sessionId }) => ({
        ordinal,
        sessionId,
        toolCallCount: evidence.coverage.toolCalls
      })),
      advisorySuggestions.getArtifactSuggestions(db, input.sessionIds)
    );
    const requestId = `guided-request:${randomUUID()}`;
    const groupBySessionId = new Map(plan.groups.flatMap((group) => (
      group.sessionIds.map((sessionId) => [sessionId, group.groupKey] as const)
    )));
    const revisionInputById = new Map(preflight.revisionInputs.map((revisionInput) => [revisionInput.sessionId, revisionInput]));
    const request = createGuidedAuthoringRequestInTransaction(db, {
      actorId: input.actorId,
      assignments: plan.groups.map((group, ordinal) => ({
        assignmentId: stableRecordId("guided-assignment", [requestId, group.groupKey]),
        canary: ordinal === 0,
        evidenceRevision: evidenceCatalog.guidedAuthoringEvidenceRevisionFromInputs(
          group.sessionIds.map((sessionId) => revisionInputById.get(sessionId)!)
        ),
        opportunityIds: group.opportunityIds,
        ordinal,
        sessionIds: group.sessionIds
      })),
      identity: {
        baseUrl: input.currentIdentity.baseUrl,
        buildSha: input.currentIdentity.buildSha,
        creationInstanceId: input.currentIdentity.instanceId,
        databaseId: input.currentIdentity.databaseId,
        instanceManifest: input.currentIdentity.instanceManifest
      },
      opportunities: plan.opportunities,
      policyVersion: GUIDED_AUTHORING_POLICY_VERSION,
      requestId,
      sessions: preflight.sessions.map(({ ordinal, sessionId }) => ({
        groupKey: groupBySessionId.get(sessionId),
        ordinal,
        sessionId
      }))
    });
    bumpDataRevisionInTransaction(db, "workbench");
    return {
      nextAction: {
        command: `${input.command} workbench author start --request ${request.requestId} --json`,
        kind: "claim_next",
        reason: "The canary assignment is ready to start."
      },
      request
    };
  });
}

function assertRequestMembershipShape(sessionIds: string[]): void {
  if (sessionIds.length === 0) throw new Error("guided_selection_empty");
  if (sessionIds.some((sessionId) => sessionId.trim().length === 0 || sessionId !== sessionId.trim())) {
    throw new Error("authoring_session_id_blank");
  }
  const seen = new Set<string>();
  for (const sessionId of sessionIds) {
    if (seen.has(sessionId)) throw new Error(`authoring_session_id_duplicate:${sessionId}`);
    seen.add(sessionId);
  }
}

export type StartGuidedAssignmentResult = {
  assignment: GuidedAuthoringAssignmentDto;
  editorialBrief: {
    objective: "Produce grounded knowledge reusable without reopening raw session evidence.";
    sessions: SessionDossierDto[];
    opportunities: GuidedAuthoringOpportunityRecord[];
    rubrics: typeof GUIDED_ARTIFACT_RUBRICS;
    evidenceQuestions: typeof GUIDED_EVIDENCE_QUESTIONS;
  };
  authoringContract: ReturnType<typeof guidedDraftContract>;
  nextAction: GuidedAuthoringNextAction;
};

export function startGuidedAssignment(
  db: MastheadDatabase,
  input: { requestId: string; command: string } & GuidedMutationIdentityInput
): StartGuidedAssignmentResult {
  const request = getGuidedAuthoringRequest(db, input.requestId);
  if (!request) throw new Error("guided_request_not_found");
  assertMutationIdentity(request, input);
  const assignmentId = request.currentAssignmentId ?? (
    request.status === "completed"
      ? getGuidedAssignments(db, request.requestId).at(-1)?.assignmentId
      : undefined
  );
  if (!assignmentId) throw new Error("guided_request_complete");
  const assignment = getGuidedAssignment(db, assignmentId);
  if (!assignment) throw new Error("guided_assignment_not_found");
  if (
    isGuidedAssignmentDraftable(assignment) &&
    evidenceCatalog.guidedAuthoringEvidenceRevision(db, assignment.sessionIds) !== assignment.evidenceRevision
  ) {
    throw new Error("guided_assignment_evidence_changed");
  }
  const authoritativeReview = reviewGuidedAssignment(db, {
    assignmentId: assignment.assignmentId,
    command: input.command
  });
  const sessions = assignment.sessionIds.map((sessionId) => {
    const dossier = getSessionDossier(db, sessionId);
    if (!dossier) throw new Error(`session_not_found:${sessionId}`);
    return dossier;
  });
  const opportunitiesById = new Map(
    listGuidedOpportunities(db, request.requestId).map((opportunity) => [opportunity.opportunityId, opportunity])
  );
  const opportunities = assignment.opportunityIds.map((opportunityId) => opportunitiesById.get(opportunityId)!).filter(Boolean);
  return {
    assignment,
    authoringContract: guidedDraftContract(input.command, assignment.assignmentId),
    editorialBrief: {
      evidenceQuestions: GUIDED_EVIDENCE_QUESTIONS,
      objective: "Produce grounded knowledge reusable without reopening raw session evidence.",
      opportunities,
      rubrics: GUIDED_ARTIFACT_RUBRICS,
      sessions
    },
    nextAction: assignment.status === "investigating"
      ? {
          command: `${input.command} workbench author inspect --assignment ${assignment.assignmentId} --json`,
          kind: "inspect",
          reason: "Every session still has unread canonical evidence."
        }
      : authoritativeReview.nextAction
  };
}

export function buildGuidedDraftScaffold(
  db: MastheadDatabase,
  input: { assignmentId: string; command: string }
): { assignmentId: string; bundleSchema: ReturnType<typeof getGuidedAuthoringBundleV4Schema>; draft: GuidedAuthoringBundleV4; nextAction: GuidedAuthoringNextAction } {
  const assignment = requireAssignment(db, input.assignmentId);
  const opportunitiesById = new Map(
    listGuidedOpportunities(db, assignment.requestId).map((opportunity) => [opportunity.opportunityId, opportunity])
  );
  const evidenceByRef = evidenceCatalog.getAuthoringValidationEvidenceByRef(db, assignment.sessionIds);
  const placeholderSupport = (
    owner: "TITLE" | "SUMMARY" | "PURPOSE" | "OUTCOME" | "KEY_WORK" | "VERIFICATION",
    path: string,
    supportKind: "reuse" | "outcome" | "purpose" | "change" | "verification"
  ) => ({
    path,
    supportKind,
    evidenceRef: `REPLACE_WITH_${owner}_EVIDENCE_ITEM_ID`,
    excerpt: "REPLACE_WITH_EXACT_CANONICAL_EVIDENCE_EXCERPT"
  });
  const placeholderEvidenceRef = (id: string) => ({
    id,
    kind: "event" as const,
    observedAt: "1970-01-01T00:00:00.000Z",
    source: "REPLACE_WITH_CANONICAL_EVIDENCE_SOURCE"
  });
  const opportunityScaffolds = assignment.opportunityIds.map((opportunityId) => {
    const opportunity = opportunitiesById.get(opportunityId);
    if (!opportunity) throw new Error(`guided_opportunity_not_found:${opportunityId}`);
    const draftId = stableRecordId("guided-artifact-draft", [
      assignment.assignmentId,
      opportunity.opportunityId,
      opportunity.suggestedKind
    ]);
    return {
      artifact: buildGuidedArtifactScaffold(opportunity, draftId, evidenceByRef),
      disposition: {
        artifactDraftId: draftId,
        artifactKind: opportunity.suggestedKind,
        disposition: "authored" as const,
        evidenceRefs: opportunity.evidenceRefs,
        opportunityId: opportunity.opportunityId,
        rationale: "REPLACE_WITH_EVIDENCE_BACKED_DISPOSITION_RATIONALE"
      }
    };
  });
  const draft: GuidedAuthoringBundleV4 = {
    artifacts: opportunityScaffolds.map(({ artifact }) => artifact),
    assignmentId: assignment.assignmentId,
    bundleVersion: "workbench-authoring-v4",
    evidenceRevision: assignment.evidenceRevision,
    opportunityDispositions: opportunityScaffolds.map(({ disposition }) => disposition),
    sessionEnrichments: assignment.sessionIds.map((sessionId) => {
      const titleSupport = placeholderSupport("TITLE", "/sessionTitle/text", "reuse");
      const summarySupport = placeholderSupport("SUMMARY", "/sessionSummary/text", "outcome");
      const purposeSupport = placeholderSupport("PURPOSE", "/sessionDossier/purpose", "purpose");
      const outcomeSupport = placeholderSupport("OUTCOME", "/sessionDossier/outcome", "outcome");
      const keyWorkSupport = placeholderSupport("KEY_WORK", "/sessionDossier/keyWork/0", "change");
      const verificationSupport = placeholderSupport("VERIFICATION", "/sessionDossier/verification/summary", "verification");
      return {
        sessionId,
        enrichment: {
          keywords: [],
          version: "session-capsule-v4" as const,
          source: "remote_model" as const,
          promptVersion: GUIDED_AUTHORING_POLICY_VERSION,
          sessionTitle: {
            text: "REPLACE_WITH_SPECIFIC_SESSION_TITLE",
            basis: "dominant_work" as const,
            confidence: "low" as const,
            evidenceRefs: [placeholderEvidenceRef(titleSupport.evidenceRef)]
          },
          sessionSummary: {
            text: "REPLACE_WITH_SPECIFIC_SESSION_SUMMARY",
            state: "unknown" as const,
            confidence: "low" as const,
            evidenceRefs: [placeholderEvidenceRef(summarySupport.evidenceRef)]
          },
          sessionDossier: {
            purpose: "REPLACE_WITH_SESSION_PURPOSE",
            outcome: "REPLACE_WITH_SESSION_OUTCOME",
            keyWork: ["REPLACE_WITH_KEY_WORK"],
            decisions: [],
            blockers: [],
            warnings: [],
            evidenceRefs: [purposeSupport, outcomeSupport, keyWorkSupport]
              .map((support) => placeholderEvidenceRef(support.evidenceRef)),
            verification: {
              status: "unknown" as const,
              summary: "REPLACE_WITH_SUPPORTED_VERIFICATION_RESULT_OR_VERIFICATION_NOT_RUN",
              commands: [],
              failures: [],
              evidenceRefs: [placeholderEvidenceRef(verificationSupport.evidenceRef)]
            },
            continuation: { openQuestions: [], constraints: [] }
          }
        },
        claimSupport: [
          titleSupport,
          summarySupport,
          purposeSupport,
          outcomeSupport,
          keyWorkSupport,
          verificationSupport
        ]
      };
    })
  };
  return {
    assignmentId: assignment.assignmentId,
    bundleSchema: getGuidedAuthoringBundleV4Schema(),
    draft,
    nextAction: {
      command: `${input.command} workbench author save --assignment ${assignment.assignmentId} --file ${guidedDraftFilePath(assignment.assignmentId)} --json`,
      kind: "save",
      reason: "Edit the scaffold into session-work prose: preserve each prefilled claimSupport path and supportKind, replace its placeholder evidenceRef ID and excerpt from inspected evidence, and replace the matching owner placeholder with that evidence item's full {id, kind, observedAt, source} object; preserve daemon-prefilled artifact IDs and artifact-support IDs; put each supported result in its capsule summary, never leave a result-bearing sessionSummary.state unknown even when verification was not run, and keep work completion separate from verification. Every sessionSummary.text must be nonblank. When no outcome or key work is supported and verification is missing or unknown, use the pure summary 'Verification not run.' with low confidence instead of relying on a warning. Write summaries as natural grammatical past-tense or result prose; never form them by prefixing an imperative or title fragment with 'Completed'. Do not narrate that evidence records, shows, contains, or fails to establish a verification result. Preserve direct causal evidence with the prefilled root_cause support; fix its supportKind instead of deleting rootCause or replacing it with unknown. Keep conditional rollback rules in risksOrGaps; use deadEnds only for an approach canonical evidence says was actually attempted and failed or abandoned. Keep compound performed actions in one supported runbook step, remove guided-authoring, evidence-review, verification-boundary, optional-artifact, and pipeline narration, then save."
    }
  };
}

function buildGuidedArtifactScaffold(
  opportunity: GuidedAuthoringOpportunityRecord,
  draftId: string,
  evidenceByRef: ReadonlyMap<string, WorkbenchValidationEvidence>
): GuidedAuthoringBundleV4["artifacts"][number] {
  const selected = selectGuidedArtifactEvidence(opportunity.evidenceRefs, evidenceByRef);
  const support = (
    path: string,
    supportKind: GuidedAuthoringBundleV4["sessionEnrichments"][number]["claimSupport"][number]["supportKind"],
    evidenceRef: string
  ) => ({
    evidenceRef,
    excerpt: "REPLACE_WITH_EXACT_CANONICAL_EVIDENCE_EXCERPT",
    path,
    supportKind
  });
  const common = {
    claimSupport: [] as ReturnType<typeof support>[],
    confidence: "low",
    evidenceRefs: opportunity.evidenceRefs,
    missingEvidence: ["REPLACE_WITH_ANY_MISSING_EVIDENCE_BOUNDARY"],
    provenanceSessionIds: opportunity.provenanceSessionIds,
    title: "REPLACE_WITH_SPECIFIC_ARTIFACT_TITLE"
  };
  const output = opportunity.suggestedKind === "runbook"
    ? {
        ...common,
        changedFiles: ["REPLACE_WITH_CHANGED_FILE"],
        commands: [],
        deadEnds: [],
        environmentRequirements: [],
        fixSteps: ["REPLACE_WITH_PERFORMED_STEP"],
        preconditions: ["REPLACE_WITH_PRECONDITION"],
        preventionNotes: [],
        problemSignature: {
          affectedScope: "REPLACE_WITH_AFFECTED_SCOPE",
          errorStrings: [],
          symptoms: ["REPLACE_WITH_TRIGGER_OR_SYMPTOM"]
        },
        reproSteps: [],
        risksOrGaps: ["REPLACE_WITH_FAILURE_OR_ROLLBACK_HANDLING"],
        rootCause: selected.rootCause
          ? "REPLACE_WITH_DIRECT_EVIDENCE_GROUNDED_ROOT_CAUSE"
          : "REPLACE_WITH_EXPLICIT_UNKNOWN_ROOT_CAUSE",
        validationChecks: ["REPLACE_WITH_EXPECTED_RESULT_AND_VERIFICATION"],
        claimSupport: [
          support("problemSignature.affectedScope", "problem", selected.problem.ref),
          support("preconditions[0]", "problem", selected.problem.ref),
          support("fixSteps[0]", "change", selected.change.ref),
          support("changedFiles[0]", "change", selected.fileChange.ref),
          support("validationChecks[0]", "verification", selected.verification.ref),
          support("risksOrGaps[0]", "problem", selected.problem.ref),
          ...(selected.rootCause ? [support("rootCause", "root_cause", selected.rootCause.ref)] : [])
        ]
      }
    : opportunity.suggestedKind === "adr"
      ? {
          ...common,
          affectedPaths: [],
          alternatives: ["REPLACE_WITH_ALTERNATIVE_ACTUALLY_CONSIDERED"],
          consequences: ["REPLACE_WITH_CONSEQUENCE_AND_REVERSAL_CONDITION"],
          context: "REPLACE_WITH_DECISION_CONTEXT",
          decision: "REPLACE_WITH_DURABLE_DECISION",
          status: "REPLACE_WITH_DECISION_STATUS",
          supersedes: [],
          claimSupport: [
            support("context", "problem", selected.problem.ref),
            support("decision", "decision", selected.decision.ref),
            support("status", "decision", selected.decision.ref),
            support("alternatives[0]", "alternative", selected.alternative.ref),
            support("consequences[0]", "decision", selected.decision.ref)
          ]
        }
      : {
          ...common,
          contributingFactors: ["REPLACE_WITH_CONTRIBUTING_FACTOR"],
          impact: "REPLACE_WITH_INCIDENT_IMPACT",
          prevention: ["REPLACE_WITH_PREVENTION_ACTION"],
          remediation: ["REPLACE_WITH_REMEDIATION_ACTION"],
          rootCause: selected.rootCause
            ? "REPLACE_WITH_DIRECT_EVIDENCE_GROUNDED_ROOT_CAUSE"
            : "REPLACE_WITH_EXPLICIT_UNKNOWN_ROOT_CAUSE",
          status: "REPLACE_WITH_RECOVERY_STATUS_AND_VERIFICATION",
          symptom: "REPLACE_WITH_INCIDENT_SYMPTOM",
          timeline: [
            {
              at: selected.problem.evidence?.observedAt || "REPLACE_WITH_DETECTION_EVENT_TIME",
              evidenceRefs: [selected.problem.ref],
              summary: "REPLACE_WITH_DETECTION_OR_IMPACT_EVENT"
            },
            {
              at: selected.change.evidence?.observedAt || "REPLACE_WITH_REMEDIATION_EVENT_TIME",
              evidenceRefs: [selected.change.ref],
              summary: "REPLACE_WITH_REMEDIATION_EVENT"
            },
            {
              at: selected.verification.evidence?.observedAt || "REPLACE_WITH_RECOVERY_EVENT_TIME",
              evidenceRefs: [selected.verification.ref],
              summary: "REPLACE_WITH_RECOVERY_VERIFICATION_EVENT"
            }
          ],
          claimSupport: [
            support("symptom", "problem", selected.problem.ref),
            support("impact", "problem", selected.problem.ref),
            support("timeline[0].summary", "timeline", selected.problem.ref),
            support("timeline[1].summary", "timeline", selected.change.ref),
            support("timeline[2].summary", "timeline", selected.verification.ref),
            ...(selected.rootCause ? [support("rootCause", "root_cause", selected.rootCause.ref)] : []),
            support("contributingFactors[0]", "problem", selected.problem.ref),
            support("remediation[0]", "remediation", selected.change.ref),
            support("status", "verification", selected.verification.ref)
          ]
        };
  return {
    draftId,
    kind: opportunity.suggestedKind,
    output,
    provenanceSessionIds: opportunity.provenanceSessionIds,
    seedSessionId: opportunity.provenanceSessionIds[0]!
  };
}

type ScaffoldEvidenceCandidate = {
  evidence?: WorkbenchValidationEvidence;
  ref: string;
};

function selectGuidedArtifactEvidence(
  refs: string[],
  evidenceByRef: ReadonlyMap<string, WorkbenchValidationEvidence>
): Record<"problem" | "change" | "fileChange" | "verification" | "decision" | "alternative", ScaffoldEvidenceCandidate> & {
  rootCause?: ScaffoldEvidenceCandidate;
} {
  const placeholder = "REPLACE_WITH_EVIDENCE_ITEM_ID";
  const candidates: ScaffoldEvidenceCandidate[] = refs
    .map((ref) => ({ evidence: evidenceByRef.get(ref), ref }))
    .sort(compareScaffoldEvidence);
  if (candidates.length === 0) candidates.push({ ref: placeholder });
  const pick = (
    role: "problem" | "change" | "fileChange" | "verification" | "decision" | "alternative",
    fallback: "first" | "middle" | "last",
    excluded: Set<string> = new Set()
  ): ScaffoldEvidenceCandidate => {
    const ranked = candidates.map((candidate) => ({
      candidate,
      distinct: excluded.has(candidate.ref) ? 0 : 1,
      score: scaffoldEvidenceScore(role, candidate.evidence)
    })).sort((left, right) => (
      right.score - left.score ||
      right.distinct - left.distinct ||
      compareScaffoldEvidence(left.candidate, right.candidate)
    ));
    if ((ranked[0]?.score ?? 0) > 0) return ranked[0]!.candidate;
    const available = candidates.filter(({ ref }) => !excluded.has(ref));
    const pool = available.length ? available : candidates;
    if (fallback === "last") return pool.at(-1)!;
    if (fallback === "middle") return pool[Math.floor(pool.length / 2)]!;
    return pool[0]!;
  };
  const problem = pick("problem", "first");
  const change = pick("change", "middle", new Set([problem.ref]));
  const fileChange = pick("fileChange", "middle", new Set([problem.ref, change.ref]));
  const verification = pick("verification", "last", new Set([problem.ref, change.ref]));
  const decision = pick("decision", "middle", new Set([problem.ref]));
  const alternative = pick("alternative", "last", new Set([problem.ref, decision.ref]));
  const rootCause = candidates.find(({ evidence }) => guidedQuality.isDirectRootCauseEvidence(evidence));
  return { alternative, change, decision, fileChange, problem, rootCause, verification };
}

function scaffoldEvidenceScore(
  role: "problem" | "change" | "fileChange" | "verification" | "decision" | "alternative",
  evidence: WorkbenchValidationEvidence | undefined
): number {
  if (!evidence || evidence.lowValue) return 0;
  const text = `${evidence.label ?? ""} ${evidence.toolName ?? ""} ${evidence.text}`;
  if (role === "problem") {
    return (evidence.kind === "runtime_signal" && /error|fail|incident|warning/i.test(`${evidence.status ?? ""} ${text}`) ? 160 : 0) +
      (evidence.kind === "tool_result" && (evidence.exitCode !== undefined && evidence.exitCode !== 0 || /fail|error/i.test(evidence.status ?? "")) ? 140 : 0) +
      (evidence.kind === "message" && evidence.role === "user" ? 80 : 0) +
      (/\b(?:block(?:ed|ing)?|broken|error|fail(?:ed|ure|s)?|impact|incident|issue|problem|symptom|unable)\b/i.test(text) ? 100 : 0);
  }
  if (role === "change") {
    return (evidence.kind === "file_effect" ? 60 : 0) +
      (evidence.kind === "tool_call" ? 80 : 0) +
      (evidence.role === "assistant" && /\b(?:added|bound|changed|cleared|corrected|created|edited|fixed|implemented|migrated|modified|patched|recovered|remediated|repaired|replaced|restored|retried|updated|wrote)\b/i.test(text) ? 240 : 0);
  }
  if (role === "fileChange") {
    return evidence.kind === "file_effect" ? 260 : 0;
  }
  if (role === "verification") {
    const succeeded = evidence.kind === "tool_result" &&
      evidence.exitCode !== undefined ? evidence.exitCode === 0 : /^(?:ok|pass(?:ed)?|success|succeeded)$/i.test(evidence.status ?? "");
    return (succeeded && /\b(?:build|check|health|lint|smoke|test|tests|verif(?:y|ied|ication))\b/i.test(text) ? 220 : 0) +
      (evidence.kind === "checkpoint" && /pass|success|verified/i.test(`${evidence.label ?? ""} ${text}`) ? 180 : 0) +
      (/\b(?:passed|recovered|succeeded|verified)\b/i.test(text) ? 80 : 0);
  }
  if (role === "decision") {
    return (/\b(?:adopt(?:ed)?|chose|choose|decision|decided|selected)\b/i.test(text) ? 220 : 0) +
      (evidence.kind === "message" && evidence.role === "assistant" ? 20 : 0);
  }
  return (/\b(?:alternative|considered|instead|option|trade-?off)\b/i.test(text) ? 240 : 0);
}

function compareScaffoldEvidence(left: ScaffoldEvidenceCandidate, right: ScaffoldEvidenceCandidate): number {
  const leftAt = Date.parse(left.evidence?.observedAt ?? "");
  const rightAt = Date.parse(right.evidence?.observedAt ?? "");
  const chronological = (Number.isFinite(leftAt) ? leftAt : Number.MAX_SAFE_INTEGER) -
    (Number.isFinite(rightAt) ? rightAt : Number.MAX_SAFE_INTEGER);
  return chronological || (left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0);
}

function guidedDraftContract(command: string, assignmentId: string) {
  return {
    bundleSchema: getGuidedAuthoringBundleV4Schema(),
    scaffoldCommand: `${command} workbench author scaffold --assignment ${assignmentId} --file ${guidedDraftFilePath(assignmentId)} --json`,
    rule: "Use the daemon scaffold for deterministic fields. Every session summary must be nonblank and use natural grammatical past-tense or result prose, never 'Completed' plus an imperative or title fragment. When outcome or key work is supported, the capsule summary must state that specific result; when neither is supported and verification is missing or unknown, use the pure low-confidence summary 'Verification not run.' instead of relying on a warning; keep work completion separate from explicit verification status and warnings. Preserve supported passed verification, explicit decisions, and direct causal evidence; fix root_cause support instead of deleting a supported rootCause or replacing it with unknown. Keep conditional rollback rules in risksOrGaps and reserve deadEnds for an approach canonical evidence says was attempted and failed or abandoned. Keep human-facing fields free of authoring-process narration, and carry every essential performed-action clause into runbook steps with exact evidence support."
  };
}

export function buildGuidedAuthoringValidationInput(
  db: MastheadDatabase,
  input: {
    trustedAssignmentId: string;
    loadedAssignment: GuidedAuthoringAssignmentDto;
    bundle: GuidedAuthoringBundleV4;
  }
): GuidedAuthoringValidationInput {
  const assignment = input.loadedAssignment;
  if (input.trustedAssignmentId !== assignment.assignmentId) {
    throw new Error("guided_assignment_identity_invariant");
  }

  observeGuidedValidationRead(db, "canonical_dossier");
  const canonicalDossiersBySession = new Map<string, SessionDossierDto>();
  for (const sessionId of assignment.sessionIds) {
    const dossier = getSessionDossier(db, sessionId);
    if (!dossier) throw new Error(`session_not_found:${sessionId}`);
    canonicalDossiersBySession.set(sessionId, dossier);
  }

  observeGuidedValidationRead(db, "opportunity");
  const persistedOpportunities = new Map(
    listGuidedOpportunities(db, assignment.requestId).map((opportunity) => [opportunity.opportunityId, opportunity])
  );
  const opportunities: GuidedQualityOpportunity[] = assignment.opportunityIds.map((opportunityId) => {
    const opportunity = persistedOpportunities.get(opportunityId);
    if (!opportunity) throw new Error(`guided_opportunity_invariant:${opportunityId}`);
    return {
      evidenceRefs: opportunity.evidenceRefs,
      opportunityId: opportunity.opportunityId,
      provenanceSessionIds: opportunity.provenanceSessionIds,
      signalStrength: opportunity.signalStrength,
      suggestedKind: opportunity.suggestedKind,
      summary: opportunity.summary
    };
  });

  observeGuidedValidationRead(db, "accepted_revision");
  const requestAcceptedDrafts: GuidedAcceptedDraftForQuality[] = [];
  for (const otherAssignment of getGuidedAssignments(db, assignment.requestId)) {
    if (
      otherAssignment.assignmentId === assignment.assignmentId ||
      otherAssignment.acceptedDraftRevision === undefined
    ) continue;
    const acceptedReview = listGuidedDraftReviews(db, otherAssignment.assignmentId)
      .find(({ revision }) => revision === otherAssignment.acceptedDraftRevision);
    if (!acceptedReview || !acceptedReview.accepted) {
      throw new Error(`guided_accepted_draft_revision_invariant:${otherAssignment.assignmentId}`);
    }
    requestAcceptedDrafts.push({
      assignmentId: otherAssignment.assignmentId,
      draft: acceptedReview.draft,
      draftRevision: acceptedReview.revision,
      evidenceRevision: acceptedReview.evidenceRevision
    });
  }

  observeGuidedValidationRead(db, "coverage");
  const coverage = guidedCoverageState(db, assignment, assignment.evidenceRevision).coverage;
  observeGuidedValidationRead(db, "canonical_evidence");
  const evidenceByRef = evidenceCatalog.getAuthoringValidationEvidenceByRef(db, assignment.sessionIds);

  return {
    assignment: {
      assignmentId: assignment.assignmentId,
      evidenceRevision: assignment.evidenceRevision,
      opportunityIds: assignment.opportunityIds,
      requestId: assignment.requestId,
      sessionIds: assignment.sessionIds
    },
    bundle: input.bundle,
    canonicalDossiersBySession,
    coverage,
    evidenceByRef,
    opportunities,
    requestAcceptedDrafts
  };
}

function observeGuidedValidationRead(db: MastheadDatabase, family: GuidedValidationStateFamily): void {
  guidedServiceTestHooks.get(db)?.beforeValidationStateRead?.(family);
}

export function saveGuidedDraft(
  db: MastheadDatabase,
  input: SaveGuidedDraftInput
): GuidedAuthoringReviewDto {
  assertPublicGuidedMutationIsTopLevel(db);
  const request = requireStableRequestForAssignment(db, input.assignmentId);
  assertMutationIdentity(request, input);

  const result = withImmediateTransaction(db, (): GuidedMutationResult<GuidedAuthoringReviewDto> => {
    guidedServiceTestHooks.get(db)?.afterOwnedSaveBegin?.();
    observeGuidedValidationRead(db, "assignment");
    const assignment = requireAssignment(db, input.assignmentId);
    assertAssignmentMutationIdentityStillBound(db, assignment, input);
    const revisionChange = synchronizeMutableAssignmentRevision(db, assignment);
    if (revisionChange) {
      bumpDataRevisionInTransaction(db, "workbench");
      return revisionChange;
    }
    if (!["investigating", "drafting", "needs_revision"].includes(assignment.status)) {
      throw new Error("guided_assignment_not_draftable");
    }
    const validation = guidedQuality.validateGuidedAuthoringDraft(buildGuidedAuthoringValidationInput(db, {
      bundle: input.draft,
      loadedAssignment: assignment,
      trustedAssignmentId: input.assignmentId
    }));
    storeGuidedDraftReviewInTransaction(db, {
      assignmentId: assignment.assignmentId,
      draft: input.draft,
      findings: validation.findings
    });
    bumpDataRevisionInTransaction(db, "workbench");
    return {
      changedRevision: false,
      value: reviewGuidedAssignment(db, { assignmentId: assignment.assignmentId, command: input.command })
    };
  });
  return unwrapGuidedMutationResult(result);
}

export function approveGuidedCanary(
  db: MastheadDatabase,
  input: GuidedCanaryDecisionInput
): GuidedAuthoringReviewDto {
  return decideGuidedCanary(db, input, "approved");
}

export function rejectGuidedCanary(
  db: MastheadDatabase,
  input: GuidedCanaryDecisionInput
): GuidedAuthoringReviewDto {
  return decideGuidedCanary(db, input, "rejected");
}

function decideGuidedCanary(
  db: MastheadDatabase,
  input: GuidedCanaryDecisionInput,
  decision: "approved" | "rejected"
): GuidedAuthoringReviewDto {
  assertPublicGuidedMutationIsTopLevel(db);
  const request = getGuidedAuthoringRequest(db, input.requestId);
  if (!request) throw new Error("guided_request_not_found");
  assertMutationIdentity(request, input);
  if (
    !Number.isSafeInteger(input.draftRevision) || input.draftRevision < 1 ||
    input.evidenceRevision.trim().length === 0 || input.evidenceRevision !== input.evidenceRevision.trim() ||
    input.notes.trim().length === 0 || input.reviewedBy.trim().length === 0
  ) throw new Error("invalid_canary_decision");

  const result = withImmediateTransaction(db, (): GuidedMutationResult<GuidedAuthoringReviewDto> => {
    const assignment = requireAssignment(db, input.assignmentId);
    if (assignment.requestId !== input.requestId) throw new Error("guided_canary_not_ready");
    assertAssignmentMutationIdentityStillBound(db, assignment, input);
    const revisionChange = synchronizeMutableAssignmentRevision(db, assignment);
    if (revisionChange) {
      bumpDataRevisionInTransaction(db, "workbench");
      return revisionChange;
    }
    if (
      assignment.status !== "staged_canary" ||
      assignment.evidenceRevision !== input.evidenceRevision ||
      assignment.acceptedDraftRevision !== input.draftRevision
    ) throw new Error("guided_canary_not_ready");
    recordCanaryDecisionInTransaction(db, {
      assignmentId: input.assignmentId,
      decision,
      draftRevision: input.draftRevision,
      notes: input.notes,
      requestId: input.requestId,
      reviewedBy: input.reviewedBy
    });
    bumpDataRevisionInTransaction(db, "workbench");
    return {
      changedRevision: false,
      value: reviewGuidedAssignment(db, { assignmentId: input.assignmentId, command: input.command })
    };
  });
  return unwrapGuidedMutationResult(result);
}

export function finishGuidedAssignment(
  db: MastheadDatabase,
  input: FinishGuidedAssignmentInput
): FinishGuidedAssignmentResult {
  assertPublicGuidedMutationIsTopLevel(db);
  const boundRequest = requireStableRequestForAssignment(db, input.assignmentId);
  assertMutationIdentity(boundRequest, input);

  const result = withDataRevisionOperation(db, () => withImmediateTransaction(db, (): GuidedMutationResult<FinishGuidedAssignmentResult> => {
    const assignment = requireAssignment(db, input.assignmentId);
    assertAssignmentMutationIdentityStillBound(db, assignment, input);
    if (assignment.status === "completed") {
      const receipt = getGuidedAssignmentReceipt(db, assignment.assignmentId);
      if (!receipt) throw new Error("guided_assignment_receipt_missing");
      return { changedRevision: false, value: { receipt, nextAction: completeNextAction() } };
    }
    const revisionChange = synchronizeMutableAssignmentRevision(db, assignment);
    if (revisionChange) {
      bumpDataRevisionInTransaction(db, "workbench");
      return revisionChange;
    }
    if (assignment.acceptedDraftRevision === undefined) throw new Error("guided_assignment_not_ready");
    const request = getGuidedAuthoringRequest(db, assignment.requestId);
    if (!request) throw new Error("guided_request_not_found");
    const hasCurrentCanaryApproval = assignment.canary && listGuidedOperatorReviews(db, assignment.assignmentId)
      .some((review) => review.decision === "approved" && review.draftRevision === assignment.acceptedDraftRevision);
    const ready = (!assignment.canary && assignment.status === "ready_to_finish") || (
      assignment.canary &&
      assignment.status === "staged_canary" &&
      request.status === "awaiting_canary_approval" &&
      hasCurrentCanaryApproval
    );
    if (!ready) throw new Error("guided_assignment_not_ready");
    const accepted = listGuidedDraftReviews(db, assignment.assignmentId).find(({ revision }) => (
      revision === assignment.acceptedDraftRevision
    ));
    if (
      !accepted?.accepted || accepted.evidenceRevision !== assignment.evidenceRevision ||
      accepted.findings.some(({ severity }) => severity === "error")
    ) throw new Error("guided_assignment_not_ready");
    const coverage = guidedCoverageState(db, assignment, assignment.evidenceRevision).coverage;
    if (coverage.some(({ complete }) => !complete)) throw new Error("guided_assignment_evidence_incomplete");

    const appliedAt = new Date().toISOString();
    for (const sessionDraft of accepted.draft.sessionEnrichments) {
      const applied = applyGuidedSessionEnrichmentInTransaction(db, {
        actorId: request.actorId,
        enrichment: sessionDraft.enrichment,
        sessionId: sessionDraft.sessionId
      });
      for (const enrichmentId of applied.enrichmentIds) {
        recordGuidedEnrichmentProvenanceInTransaction(db, {
          appliedAt,
          assignmentId: assignment.assignmentId,
          draftRevision: accepted.revision,
          enrichmentId,
          evidenceRevision: assignment.evidenceRevision,
          policyVersion: GUIDED_AUTHORING_POLICY_VERSION,
          requestId: assignment.requestId,
          sessionId: sessionDraft.sessionId,
          source: "guided_authoring"
        });
      }
    }
    publicationBoundary(db, "after_enrichment");

    const dossierArtifacts = stageGuidedCanonicalDossiersInTransaction(db, {
      actorId: request.actorId,
      assignmentId: assignment.assignmentId,
      evidenceRevision: assignment.evidenceRevision,
      sessionIds: assignment.sessionIds
    });
    publicationBoundary(db, "after_dossier_staging");
    const optionalArtifacts = stageGuidedOptionalArtifactsInTransaction(db, {
      actorId: request.actorId,
      artifacts: accepted.draft.artifacts,
      assignmentId: assignment.assignmentId,
      sessionIds: assignment.sessionIds
    });
    publicationBoundary(db, "after_optional_staging");
    const published = publishStagedGuidedArtifactsInTransaction(db, { dossierArtifacts, optionalArtifacts });
    publicationBoundary(db, "after_artifact_publish");
    resetGuidedAssignmentWorkbenchInTransaction(db, {
      actorId: request.actorId,
      assignmentId: assignment.assignmentId
    });
    publicationBoundary(db, "after_session_claim_reset");

    const receipt: GuidedAuthoringReceiptDto = {
      assignmentId: assignment.assignmentId,
      baseUrl: request.baseUrl,
      buildSha: request.buildSha,
      completedAt: appliedAt,
      databaseId: request.databaseId,
      draftRevision: accepted.revision,
      evidenceRevision: assignment.evidenceRevision,
      instanceManifest: request.instanceManifest,
      opportunityIds: assignment.opportunityIds,
      publicationInstanceId: input.currentIdentity.instanceId,
      publishedArtifacts: published.publishedArtifacts,
      receiptVersion: "guided-authoring-receipt-v1",
      requestId: assignment.requestId,
      sessionIds: assignment.sessionIds
    };
    const stored = persistGuidedAssignmentReceiptInTransaction(db, assignment.assignmentId, receipt);
    publicationBoundary(db, "after_receipt_insert");
    const transition = transitionGuidedAssignmentAfterReceiptInTransaction(db, assignment.assignmentId, stored);
    publicationBoundary(db, "after_request_or_next_assignment_transition");
    bumpDataRevisionInTransaction(db, "logbook");
    bumpDataRevisionInTransaction(db, "workbench");
    return {
      changedRevision: false,
      value: {
        receipt: transition.receipt,
        nextAction: transition.request.status === "completed"
          ? completeNextAction()
          : claimNextAction(input.command, transition.request.requestId)
      }
    };
  }));
  return unwrapGuidedMutationResult(result);
}

type GuidedMutationResult<T> =
  | { changedRevision: true }
  | { changedRevision: false; value: T };

function synchronizeMutableAssignmentRevision(
  db: MastheadDatabase,
  assignment: GuidedAuthoringAssignmentDto
): { changedRevision: true } | undefined {
  if (assignment.status === "completed") return undefined;
  const liveRevision = evidenceCatalog.guidedAuthoringEvidenceRevision(db, assignment.sessionIds);
  if (liveRevision === assignment.evidenceRevision) return undefined;
  if (assignment.status === "staged_canary" || assignment.status === "ready_to_finish") {
    invalidateLockedGuidedAssignmentEvidenceInTransaction(db, {
      assignmentId: assignment.assignmentId,
      expectedEvidenceRevision: assignment.evidenceRevision,
      expectedStatus: assignment.status,
      nextEvidenceRevision: liveRevision
    });
  } else {
    advanceGuidedAssignmentEvidenceRevisionInTransaction(db, {
      assignmentId: assignment.assignmentId,
      expectedEvidenceRevision: assignment.evidenceRevision,
      nextEvidenceRevision: liveRevision
    });
  }
  return { changedRevision: true };
}

function unwrapGuidedMutationResult<T>(result: GuidedMutationResult<T>): T {
  if (result.changedRevision) throw new Error("evidence_revision_changed");
  return result.value;
}

function assertPublicGuidedMutationIsTopLevel(db: MastheadDatabase): void {
  if (db.isTransaction) throw new Error("guided_authoring_public_mutation_requires_top_level_transaction");
}

function requireAssignment(db: MastheadDatabase, assignmentId: string): GuidedAuthoringAssignmentDto {
  const assignment = getGuidedAssignment(db, assignmentId);
  if (!assignment) throw new Error("guided_assignment_not_found");
  return assignment;
}

function requireStableRequestForAssignment(
  db: MastheadDatabase,
  assignmentId: string
): GuidedAuthoringStableRequestBinding {
  const request = getGuidedAuthoringRequestForAssignment(db, assignmentId);
  if (!request) throw new Error("guided_assignment_not_found");
  return request;
}

function assertMutationIdentity(
  request: GuidedAuthoringStableRequestBinding,
  input: GuidedMutationIdentityInput
): void {
  assertStableGuidedRequestBinding(request, input.currentIdentity);
  assertGuidedAuthoringExpectedIdentity(input.currentIdentity, input.expectedIdentity);
}

function assertAssignmentRequestStillBound(
  db: MastheadDatabase,
  assignment: GuidedAuthoringAssignmentDto,
  currentIdentity: GuidedAuthoringExpectedIdentity
): GuidedAuthoringRequestDto {
  const request = getGuidedAuthoringRequest(db, assignment.requestId);
  if (!request) throw new Error("guided_request_not_found");
  assertStableGuidedRequestBinding(request, currentIdentity);
  return request;
}

function assertAssignmentMutationIdentityStillBound(
  db: MastheadDatabase,
  assignment: GuidedAuthoringAssignmentDto,
  input: GuidedMutationIdentityInput
): GuidedAuthoringRequestDto {
  const request = assertAssignmentRequestStillBound(db, assignment, input.currentIdentity);
  assertGuidedAuthoringExpectedIdentity(input.currentIdentity, input.expectedIdentity);
  return request;
}

function publicationBoundary(db: MastheadDatabase, point: GuidedPublicationFailurePoint): void {
  guidedServiceTestHooks.get(db)?.afterPublicationBoundary?.(point);
}

function claimNextAction(
  command: string,
  requestId: string
): GuidedAuthoringNextAction & { kind: "claim_next" } {
  return {
    command: `${command} workbench author start --request ${requestId} --json`,
    kind: "claim_next",
    reason: "The next guided assignment is ready to start."
  };
}

function completeNextAction(): GuidedAuthoringNextAction & { kind: "complete" } {
  return { command: "", kind: "complete", reason: "The guided authoring request is complete." };
}

export function inspectGuidedAssignment(
  db: MastheadDatabase,
  input: GuidedMutationIdentityInput & {
    assignmentId: string;
    command: string;
    sessionId?: string;
    cursor?: string;
    limit?: number;
    kind?: SessionTranscriptKindFilter;
    query?: string;
    order?: SessionTranscriptOrder;
  }
): GuidedInspectionDto {
  if (db.isTransaction) throw new Error("guided_inspection_requires_top_level_transaction");
  const boundRequest = requireStableRequestForAssignment(db, input.assignmentId);
  assertMutationIdentity(boundRequest, input);
  const result = withImmediateTransaction(db, (): { changedRevision: true } | { changedRevision: false; value: GuidedInspectionDto } => {
    const changesBefore = (db.prepare("SELECT total_changes() AS changes").get() as { changes: number }).changes;
    const assignment = getGuidedAssignment(db, input.assignmentId);
    if (!assignment) throw new Error("guided_assignment_not_found");
    assertAssignmentMutationIdentityStillBound(db, assignment, input);
    if (!isGuidedAssignmentDraftable(assignment)) {
      throw new Error("guided_assignment_not_inspectable");
    }
    const liveBefore = evidenceCatalog.guidedAuthoringEvidenceRevision(db, assignment.sessionIds);
    if (liveBefore !== assignment.evidenceRevision) {
      advanceGuidedAssignmentEvidenceRevisionInTransaction(db, {
        assignmentId: assignment.assignmentId,
        expectedEvidenceRevision: assignment.evidenceRevision,
        nextEvidenceRevision: liveBefore
      });
      bumpDataRevisionInTransaction(db, "workbench");
      return { changedRevision: true };
    }

    const beforeState = guidedCoverageState(db, assignment, assignment.evidenceRevision);
    const sessionId = input.sessionId ?? beforeState.firstIncompleteSessionId ?? assignment.sessionIds[0]!;
    if (!assignment.sessionIds.includes(sessionId)) throw new Error("guided_evidence_session_not_assigned");
    const canonicalItems = [...iterateSessionTranscriptItems(db, { order: "asc", sessionId })];
    const explicitOffset = input.cursor === undefined ? undefined : parseInspectionCursor(input.cursor, canonicalItems.length);
    const cursor = String(explicitOffset ?? firstUnreadOffset(canonicalItems, beforeState.accessedBySession.get(sessionId) ?? new Set()));
    const completionBearing = (input.order === undefined || input.order === "asc") &&
      (input.kind === undefined || input.kind === "all") &&
      (input.query === undefined || input.query.trim().length === 0);
    const evidence = evidenceCatalog.getAuthoringEvidencePage(db, {
      cursor,
      kind: input.kind,
      limit: input.limit ?? 100,
      order: input.order,
      query: input.query?.trim() ? input.query : undefined,
      sessionId
    });
    const liveAfter = evidenceCatalog.guidedAuthoringEvidenceRevision(db, assignment.sessionIds);
    if (liveAfter !== assignment.evidenceRevision) {
      advanceGuidedAssignmentEvidenceRevisionInTransaction(db, {
        assignmentId: assignment.assignmentId,
        expectedEvidenceRevision: assignment.evidenceRevision,
        nextEvidenceRevision: liveAfter
      });
      bumpDataRevisionInTransaction(db, "workbench");
      return { changedRevision: true };
    }
    if (completionBearing && evidence.items.length > 0) {
      recordGuidedEvidenceAccessInTransaction(db, {
        assignmentId: assignment.assignmentId,
        evidenceRefs: evidence.items.map(({ itemId }) => itemId),
        evidenceRevision: assignment.evidenceRevision,
        requestId: assignment.requestId,
        sessionId
      });
    }
    const state = guidedCoverageState(db, assignment, assignment.evidenceRevision);
    const changesAfter = (db.prepare("SELECT total_changes() AS changes").get() as { changes: number }).changes;
    if (changesAfter > changesBefore) bumpDataRevisionInTransaction(db, "workbench");
    return {
      changedRevision: false,
      value: {
        assignmentId: assignment.assignmentId,
        authoringContract: guidedDraftContract(input.command, assignment.assignmentId),
        coverage: state.coverage,
        editorialQuestions: [...GUIDED_EVIDENCE_QUESTIONS],
        evidence,
        evidenceRevision: assignment.evidenceRevision,
        nextAction: nextInspectionAction(input.command, assignment, state),
        progressRecorded: completionBearing && evidence.items.length > 0,
        sessionId
      }
    };
  });
  if (result.changedRevision) throw new Error("evidence_revision_changed");
  return result.value;
}

function isGuidedAssignmentDraftable(assignment: GuidedAuthoringAssignmentDto): boolean {
  return ["investigating", "drafting", "needs_revision"].includes(assignment.status);
}

export function reviewGuidedAssignment(
  db: MastheadDatabase,
  input: { assignmentId: string; command: string }
): GuidedAuthoringReviewDto {
  const assignment = getGuidedAssignment(db, input.assignmentId);
  if (!assignment) throw new Error("guided_assignment_not_found");
  const locked = ["staged_canary", "ready_to_finish", "completed"].includes(assignment.status);
  const liveRevision = evidenceCatalog.guidedAuthoringEvidenceRevision(db, assignment.sessionIds);
  const effectiveRevision = locked ? assignment.evidenceRevision : liveRevision;
  const historicalCoverage = assignment.status === "completed" || (locked && liveRevision !== assignment.evidenceRevision);
  const state = guidedCoverageState(db, assignment, effectiveRevision, historicalCoverage);
  const currentDraft = listGuidedDraftReviews(db, assignment.assignmentId)
    .find(({ revision }) => revision === assignment.currentDraftRevision);
  const visibleDraft = currentDraft?.evidenceRevision === effectiveRevision ? currentDraft : undefined;
  const operatorReviews = listGuidedOperatorReviews(db, assignment.assignmentId);
  const hasCurrentApproval = assignment.acceptedDraftRevision !== undefined && operatorReviews.some((review) => (
    review.decision === "approved" && review.draftRevision === assignment.acceptedDraftRevision
  ));
  return {
    assignmentId: assignment.assignmentId,
    coverage: state.coverage,
    ...(visibleDraft ? { draft: visibleDraft.draft, draftRevision: visibleDraft.revision } : {}),
    editorialQuestions: unresolvedEditorialQuestions(visibleDraft?.draft),
    evidenceRevision: effectiveRevision,
    findings: visibleDraft?.findings ?? [],
    nextAction: nextReviewAction(input.command, assignment, state, hasCurrentApproval, Boolean(visibleDraft)),
    operatorReviews,
    requestId: assignment.requestId,
    status: assignment.status
  };
}

export function listPendingGuidedCanaries(
  db: MastheadDatabase,
  input: { command: string }
): GuidedAuthoringReviewDto[] {
  return listPendingGuidedCanaryAssignments(db).map((assignment) => (
    reviewGuidedAssignment(db, { assignmentId: assignment.assignmentId, command: input.command })
  ));
}

type GuidedCoverageState = {
  accessedBySession: Map<string, Set<string>>;
  coverage: GuidedEvidenceCoverageDto[];
  firstIncompleteSessionId?: string;
  firstUnreadBySession: Map<string, number>;
};

function guidedCoverageState(
  db: MastheadDatabase,
  assignment: GuidedAuthoringAssignmentDto,
  evidenceRevision: string,
  completedHistorical = false
): GuidedCoverageState {
  const manifest = evidenceCatalog.getAuthoringEvidenceManifest(db, assignment.sessionIds);
  const totals = new Map(manifest.sessions.map(({ sessionId, totalItems }) => [sessionId, totalItems]));
  const accessedBySession = new Map(assignment.sessionIds.map((sessionId) => [sessionId, new Set<string>()]));
  for (const access of listGuidedEvidenceAccess(db, assignment.assignmentId, evidenceRevision)) {
    accessedBySession.get(access.sessionId)?.add(access.evidenceRef);
  }
  const coverage = assignment.sessionIds.map((sessionId) => {
    const accessedItems = accessedBySession.get(sessionId)?.size ?? 0;
    const liveTotalItems = totals.get(sessionId) ?? 0;
    const totalItems = completedHistorical ? accessedItems : liveTotalItems;
    return {
      accessedItems,
      complete: totalItems > 0 && accessedItems === totalItems,
      evidenceRevision,
      sessionId,
      totalItems
    };
  });
  const firstUnreadBySession = new Map(assignment.sessionIds.map((sessionId) => [
    sessionId,
    firstUnreadOffset(
      [...iterateSessionTranscriptItems(db, { order: "asc", sessionId })],
      accessedBySession.get(sessionId) ?? new Set<string>()
    )
  ]));
  return {
    accessedBySession,
    coverage,
    firstIncompleteSessionId: coverage.find(({ complete }) => !complete)?.sessionId,
    firstUnreadBySession
  };
}

function firstUnreadOffset(
  items: Array<{ itemId: string }>,
  accessed: Set<string>
): number {
  const offset = items.findIndex(({ itemId }) => !accessed.has(itemId));
  return offset < 0 ? 0 : offset;
}

function parseInspectionCursor(cursor: string, totalItems: number): number {
  if (!/^[0-9]+$/u.test(cursor)) throw new Error("guided_inspection_cursor_invalid");
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= totalItems) {
    throw new Error("guided_inspection_cursor_invalid");
  }
  return offset;
}

function nextInspectionAction(
  command: string,
  assignment: GuidedAuthoringAssignmentDto,
  state: GuidedCoverageState
): GuidedAuthoringNextAction {
  const sessionId = state.firstIncompleteSessionId;
  if (!sessionId) {
    return {
      command: `${command} workbench author scaffold --assignment ${assignment.assignmentId} --file ${guidedDraftFilePath(assignment.assignmentId)} --json`,
      kind: "scaffold" as GuidedAuthoringNextAction["kind"],
      reason: "Every assignment session has complete canonical evidence coverage; generate the daemon-owned V4 scaffold before authoring."
    };
  }
  return {
    command: `${command} workbench author inspect --assignment ${assignment.assignmentId} --session ${sessionId} --cursor ${state.firstUnreadBySession.get(sessionId) ?? 0} --json`,
    kind: "inspect",
    reason: `Session ${sessionId} still has unread canonical evidence.`
  };
}

export function guidedDraftFilePath(assignmentId: string): string {
  const assignmentSlug = assignmentId.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "assignment";
  return `./masthead-guided-${assignmentSlug}.json`;
}

function nextReviewAction(
  command: string,
  assignment: GuidedAuthoringAssignmentDto,
  state: GuidedCoverageState,
  hasCurrentApproval = false,
  hasCurrentDraft = false
): GuidedAuthoringNextAction {
  if (assignment.status === "completed") {
    return { command: "", kind: "complete", reason: "The guided authoring request is complete." };
  }
  if (assignment.status === "staged_canary") {
    if (hasCurrentApproval) {
      return {
        command: `${command} workbench author finish --assignment ${assignment.assignmentId} --json`,
        kind: "finish",
        reason: "The accepted assignment is ready for atomic publication."
      };
    }
    return {
      command: `${command} workbench author review --assignment ${assignment.assignmentId} --json`,
      kind: "await_operator",
      reason: "The canary draft is staged and awaiting operator approval."
    };
  }
  if (assignment.status === "ready_to_finish") {
    return {
      command: `${command} workbench author finish --assignment ${assignment.assignmentId} --json`,
      kind: "finish",
      reason: "The accepted assignment is ready for atomic publication."
    };
  }
  if (assignment.status === "needs_revision") {
    if (!hasCurrentDraft) return nextInspectionAction(command, assignment, state);
    return {
      command: `${command} workbench author save --assignment ${assignment.assignmentId} --file ${guidedDraftFilePath(assignment.assignmentId)} --json`,
      kind: "revise",
      reason: "The saved draft has blocking structured findings to resolve."
    };
  }
  return nextInspectionAction(command, assignment, state);
}

function unresolvedEditorialQuestions(draft: GuidedAuthoringBundleV4 | undefined): string[] {
  if (!draft) return [...GUIDED_EVIDENCE_QUESTIONS];
  const paths = draft.sessionEnrichments.flatMap(({ claimSupport }) => claimSupport.map(({ path }) => path));
  const resolved = [
    paths.some((path) => path === "/sessionDossier/purpose"),
    paths.some((path) => path.startsWith("/sessionDossier/keyWork/")),
    paths.some((path) => path === "/sessionDossier/outcome"),
    paths.some((path) => path.startsWith("/sessionDossier/decisions/")),
    paths.some((path) => path.startsWith("/sessionDossier/verification/")),
    paths.some((path) => (
      path.startsWith("/sessionDossier/blockers/") ||
      path.startsWith("/sessionDossier/continuation/") ||
      path.startsWith("/sessionDossier/warnings/")
    )),
    paths.some((path) => (
      path === "/sessionSummary/text" || path === "/sessionDossier/purpose" || path === "/sessionDossier/outcome"
    )) || draft.artifacts.length > 0 || draft.opportunityDispositions.length > 0
  ];
  return GUIDED_EVIDENCE_QUESTIONS.filter((_, index) => !resolved[index]);
}
