import { randomUUID } from "node:crypto";
import { stableRecordId } from "../../daemon/identity.ts";
import {
  createGuidedAuthoringRequestInTransaction,
  advanceGuidedAssignmentEvidenceRevisionInTransaction,
  getGuidedAssignment,
  getGuidedAssignments,
  getGuidedAuthoringRequest,
  listGuidedDraftReviews,
  listGuidedEvidenceAccess,
  listGuidedOperatorReviews,
  listGuidedOpportunities,
  recordGuidedEvidenceAccessInTransaction,
  type GuidedAuthoringOpportunityRecord
} from "../../daemon/db/guidedAuthoringRepository.ts";
import { getSessionDossier } from "../../daemon/db/sessionDossierRepository.ts";
import { type MastheadDatabase, withImmediateTransaction } from "../../daemon/db/sqlite.ts";
import {
  GUIDED_AUTHORING_POLICY_VERSION,
  type GuidedAuthoringAssignmentDto,
  type GuidedAuthoringBundleV4,
  type GuidedAuthoringExpectedIdentity,
  type GuidedAuthoringReviewDto,
  type GuidedEvidenceCoverageDto,
  type GuidedInspectionDto,
  type GuidedAuthoringNextAction,
  type GuidedAuthoringRequestDto
} from "../../shared/guidedAuthoring.ts";
import type { SessionTranscriptOrder } from "../../shared/sessionTranscript.ts";
import type { SessionTranscriptKindFilter } from "../../daemon/db/sessionTranscriptRepository.ts";
import { iterateSessionTranscriptItems } from "../../daemon/db/sessionTranscriptRepository.ts";
import type { SessionDossierDto } from "../../shared/sessionDossier.ts";
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

export type CreateGuidedRequestInput = {
  actorId: string;
  command: string;
  currentIdentity: GuidedAuthoringExpectedIdentity;
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
  nextAction: GuidedAuthoringNextAction & { kind: "inspect" };
};

export function startGuidedAssignment(
  db: MastheadDatabase,
  input: { requestId: string; command: string }
): StartGuidedAssignmentResult {
  const request = getGuidedAuthoringRequest(db, input.requestId);
  if (!request) throw new Error("guided_request_not_found");
  if (!request.currentAssignmentId) throw new Error("guided_request_complete");
  const assignment = getGuidedAssignment(db, request.currentAssignmentId);
  if (!assignment) throw new Error("guided_assignment_not_found");
  if (evidenceCatalog.guidedAuthoringEvidenceRevision(db, assignment.sessionIds) !== assignment.evidenceRevision) {
    throw new Error("guided_assignment_evidence_changed");
  }
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
    editorialBrief: {
      evidenceQuestions: GUIDED_EVIDENCE_QUESTIONS,
      objective: "Produce grounded knowledge reusable without reopening raw session evidence.",
      opportunities,
      rubrics: GUIDED_ARTIFACT_RUBRICS,
      sessions
    },
    nextAction: {
      command: `${input.command} workbench author inspect --assignment ${assignment.assignmentId} --json`,
      kind: "inspect",
      reason: "Every session still has unread canonical evidence."
    }
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

  const canonicalDossiersBySession = new Map<string, SessionDossierDto>();
  for (const sessionId of assignment.sessionIds) {
    const dossier = getSessionDossier(db, sessionId);
    if (!dossier) throw new Error(`session_not_found:${sessionId}`);
    canonicalDossiersBySession.set(sessionId, dossier);
  }

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
    coverage: guidedCoverageState(db, assignment, assignment.evidenceRevision).coverage,
    evidenceByRef: evidenceCatalog.getAuthoringValidationEvidenceByRef(db, assignment.sessionIds),
    opportunities,
    requestAcceptedDrafts
  };
}

export function inspectGuidedAssignment(
  db: MastheadDatabase,
  input: {
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
  const result = withImmediateTransaction(db, (): { changedRevision: true } | { changedRevision: false; value: GuidedInspectionDto } => {
    const assignment = getGuidedAssignment(db, input.assignmentId);
    if (!assignment) throw new Error("guided_assignment_not_found");
    const liveBefore = evidenceCatalog.guidedAuthoringEvidenceRevision(db, assignment.sessionIds);
    if (liveBefore !== assignment.evidenceRevision) {
      advanceGuidedAssignmentEvidenceRevisionInTransaction(db, {
        assignmentId: assignment.assignmentId,
        expectedEvidenceRevision: assignment.evidenceRevision,
        nextEvidenceRevision: liveBefore
      });
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
    return {
      changedRevision: false,
      value: {
        assignmentId: assignment.assignmentId,
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
  return {
    assignmentId: assignment.assignmentId,
    coverage: state.coverage,
    ...(visibleDraft ? { draft: visibleDraft.draft, draftRevision: visibleDraft.revision } : {}),
    editorialQuestions: [...GUIDED_EVIDENCE_QUESTIONS],
    evidenceRevision: effectiveRevision,
    findings: visibleDraft?.findings ?? [],
    nextAction: nextReviewAction(input.command, assignment, state),
    operatorReviews: listGuidedOperatorReviews(db, assignment.assignmentId),
    requestId: assignment.requestId,
    status: assignment.status
  };
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
      command: `${command} workbench author save --assignment ${assignment.assignmentId} --file <draft.json> --json`,
      kind: "save",
      reason: "Every assignment session has complete canonical evidence coverage."
    };
  }
  return {
    command: `${command} workbench author inspect --assignment ${assignment.assignmentId} --session ${sessionId} --cursor ${state.firstUnreadBySession.get(sessionId) ?? 0} --json`,
    kind: "inspect",
    reason: `Session ${sessionId} still has unread canonical evidence.`
  };
}

function nextReviewAction(
  command: string,
  assignment: GuidedAuthoringAssignmentDto,
  state: GuidedCoverageState
): GuidedAuthoringNextAction {
  if (assignment.status === "completed") {
    return { command: "", kind: "complete", reason: "The guided authoring request is complete." };
  }
  if (assignment.status === "staged_canary") {
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
  return nextInspectionAction(command, assignment, state);
}
