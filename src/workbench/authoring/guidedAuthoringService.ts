import { randomUUID } from "node:crypto";
import { stableRecordId } from "../../daemon/identity.ts";
import {
  createGuidedAuthoringRequestInTransaction,
  getGuidedAssignment,
  getGuidedAuthoringRequest,
  listGuidedOpportunities,
  type GuidedAuthoringOpportunityRecord
} from "../../daemon/db/guidedAuthoringRepository.ts";
import { getSessionDossier } from "../../daemon/db/sessionDossierRepository.ts";
import { type MastheadDatabase, withImmediateTransaction } from "../../daemon/db/sqlite.ts";
import {
  GUIDED_AUTHORING_POLICY_VERSION,
  type GuidedAuthoringAssignmentDto,
  type GuidedAuthoringExpectedIdentity,
  type GuidedAuthoringNextAction,
  type GuidedAuthoringRequestDto
} from "../../shared/guidedAuthoring.ts";
import type { SessionDossierDto } from "../../shared/sessionDossier.ts";
import * as advisorySuggestions from "./advisorySuggestions.ts";
import * as evidenceCatalog from "./evidenceCatalog.ts";
import {
  GUIDED_ARTIFACT_RUBRICS,
  GUIDED_EVIDENCE_QUESTIONS,
  planGuidedAssignments
} from "./guidedAuthoringPolicy.ts";
import { assertGuidedSelectionCompileReady } from "./guidedAuthoringPreflight.ts";

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
