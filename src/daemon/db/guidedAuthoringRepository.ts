import { randomUUID } from "node:crypto";
import type {
  GuidedAuthoringAssignmentDto,
  GuidedAuthoringBundleV4,
  GuidedAuthoringContractVersion,
  GuidedAuthoringOperatorReviewDto,
  GuidedAuthoringReceiptDto,
  GuidedAuthoringRequestDto
} from "../../shared/guidedAuthoring.ts";
import type { WorkbenchAuthoringFinding, WorkbenchAutomaticArtifactKind } from "../../shared/workbenchAuthoring.ts";
import { type MastheadDatabase, withImmediateTransaction } from "./sqlite.ts";

export type GuidedAuthoringOpportunityRecord = {
  requestId: string;
  opportunityId: string;
  suggestedKind: WorkbenchAutomaticArtifactKind;
  signalStrength: "high" | "medium";
  summary: string;
  signatureKey?: string;
  evidenceRefs: string[];
  provenanceSessionIds: string[];
  createdAt: string;
};

export type GuidedEvidenceAccessRecord = {
  assignmentId: string;
  requestId: string;
  sessionId: string;
  evidenceRevision: string;
  evidenceRef: string;
  accessedAt: string;
};

export type GuidedDraftReviewRecord = {
  assignmentId: string;
  revision: number;
  evidenceRevision: string;
  draft: GuidedAuthoringBundleV4;
  findings: WorkbenchAuthoringFinding[];
  accepted: boolean;
  createdAt: string;
};

export type GuidedAuthoringStableRequestBinding = Pick<
  GuidedAuthoringRequestDto,
  "baseUrl" | "databaseId" | "buildSha" | "instanceManifest" | "creationInstanceId" | "contractVersion"
>;

export type CreateGuidedAuthoringRequestInput = {
  requestId: string;
  actorId: string;
  contractVersion: GuidedAuthoringContractVersion;
  policyVersion: "guided-authoring-v1";
  identity: {
    creationInstanceId: string;
    instanceManifest: string;
    baseUrl: string;
    databaseId: string;
    buildSha: string;
  };
  sessions: Array<{ sessionId: string; ordinal: number; groupKey?: string }>;
  opportunities: Array<{
    opportunityId: string;
    suggestedKind: WorkbenchAutomaticArtifactKind;
    signalStrength: "high" | "medium";
    summary: string;
    signatureKey?: string;
    evidenceRefs: string[];
    provenanceSessionIds: string[];
  }>;
  assignments: Array<{
    assignmentId: string;
    ordinal: number;
    canary: boolean;
    evidenceRevision: string;
    sessionIds: string[];
    opportunityIds: string[];
  }>;
};

type RequestRow = {
  requestId: string;
  actorId: string;
  contractVersion: GuidedAuthoringContractVersion;
  creationInstanceId: string;
  instanceManifest: string;
  baseUrl: string;
  databaseId: string;
  buildSha: string;
  policyVersion: "guided-authoring-v1";
  status: GuidedAuthoringRequestDto["status"];
  canaryApprovedAt: string | null;
  canaryApprovedBy: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type AssignmentRow = {
  assignmentId: string;
  requestId: string;
  ordinal: number;
  status: GuidedAuthoringAssignmentDto["status"];
  canary: number;
  evidenceRevision: string;
  currentDraftRevision: number;
  acceptedDraftRevision: number | null;
  receiptJson: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export function createGuidedAuthoringRequest(
  db: MastheadDatabase,
  input: CreateGuidedAuthoringRequestInput
): GuidedAuthoringRequestDto {
  assertLegacyGuidedContract(input.contractVersion);
  validateRequestPlan(db, input);
  return withImmediateTransaction(db, () => createGuidedAuthoringRequestInTransaction(db, input));
}

export function createGuidedAuthoringRequestInTransaction(
  db: MastheadDatabase,
  input: CreateGuidedAuthoringRequestInput
): GuidedAuthoringRequestDto {
  assertLegacyGuidedContract(input.contractVersion);
  validateRequestPlan(db, input);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO guided_authoring_requests (
      request_id, actor_id, creation_instance_id, instance_manifest, base_url, database_id,
      build_sha, policy_version, contract_version, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.requestId,
    input.actorId,
    input.identity.creationInstanceId,
    input.identity.instanceManifest,
    input.identity.baseUrl,
    input.identity.databaseId,
    input.identity.buildSha,
    input.policyVersion,
    input.contractVersion,
    input.contractVersion === "workbench-authoring-v5" ? "active" : "open",
    now,
    now
  );

  const firstAssignmentSessionIds = new Set(input.assignments.find(({ ordinal }) => ordinal === 0)!.sessionIds);
  const insertSession = db.prepare(
    `INSERT INTO guided_authoring_request_sessions
     (request_id, session_id, ordinal, group_key, state) VALUES (?, ?, ?, ?, ?)`
  );
  for (const session of input.sessions) {
    insertSession.run(
      input.requestId,
      session.sessionId,
      session.ordinal,
      session.groupKey ?? null,
      firstAssignmentSessionIds.has(session.sessionId) ? "assigned" : "pending"
    );
  }

  const insertOpportunity = db.prepare(
    `INSERT INTO guided_authoring_opportunities (
      opportunity_id, request_id, suggested_kind, signal_strength, summary, signature_key,
      evidence_refs_json, provenance_session_ids_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const opportunity of input.opportunities) {
    insertOpportunity.run(
      opportunity.opportunityId,
      input.requestId,
      opportunity.suggestedKind,
      opportunity.signalStrength,
      opportunity.summary,
      opportunity.signatureKey ?? null,
      JSON.stringify(opportunity.evidenceRefs),
      JSON.stringify(opportunity.provenanceSessionIds),
      now
    );
  }

  const insertAssignment = db.prepare(
    `INSERT INTO guided_authoring_assignments (
      assignment_id, request_id, ordinal, status, canary, evidence_revision, created_at, updated_at
    ) VALUES (?, ?, ?, 'investigating', ?, ?, ?, ?)`
  );
  const insertAssignmentSession = db.prepare(
    `INSERT INTO guided_authoring_assignment_sessions
     (assignment_id, request_id, session_id, ordinal) VALUES (?, ?, ?, ?)`
  );
  const insertAssignmentOpportunity = db.prepare(
    `INSERT INTO guided_authoring_assignment_opportunities
     (assignment_id, request_id, opportunity_id, ordinal) VALUES (?, ?, ?, ?)`
  );
  for (const assignment of input.assignments) {
    insertAssignment.run(
      assignment.assignmentId,
      input.requestId,
      assignment.ordinal,
      assignment.canary ? 1 : 0,
      assignment.evidenceRevision,
      now,
      now
    );
    assignment.sessionIds.forEach((sessionId, ordinal) => {
      insertAssignmentSession.run(assignment.assignmentId, input.requestId, sessionId, ordinal);
    });
    assignment.opportunityIds.forEach((opportunityId, ordinal) => {
      insertAssignmentOpportunity.run(assignment.assignmentId, input.requestId, opportunityId, ordinal);
    });
  }
  return requireGuidedRequest(db, input.requestId);
}

function assertLegacyGuidedContract(contractVersion: GuidedAuthoringContractVersion): void {
  if (contractVersion !== "workbench-authoring-v4") throw new Error("authoring_contract_retired");
}

export function getGuidedAuthoringRequest(
  db: MastheadDatabase,
  requestId: string
): GuidedAuthoringRequestDto | undefined {
  const row = db.prepare(
    `SELECT request_id AS requestId, actor_id AS actorId, creation_instance_id AS creationInstanceId,
            instance_manifest AS instanceManifest, base_url AS baseUrl, database_id AS databaseId,
            build_sha AS buildSha, policy_version AS policyVersion, contract_version AS contractVersion, status,
            canary_approved_at AS canaryApprovedAt, canary_approved_by AS canaryApprovedBy,
            created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt
     FROM guided_authoring_requests WHERE request_id = ?`
  ).get(requestId) as RequestRow | undefined;
  if (!row) return undefined;
  const counts = db.prepare(
    `SELECT COUNT(*) AS sessionCount,
            SUM(CASE WHEN state = 'completed' THEN 1 ELSE 0 END) AS completedSessionCount
     FROM guided_authoring_request_sessions WHERE request_id = ?`
  ).get(requestId) as { sessionCount: number; completedSessionCount: number };
  const assignments = db.prepare(
    `SELECT assignment_id AS assignmentId, canary, status
     FROM guided_authoring_assignments WHERE request_id = ? ORDER BY ordinal`
  ).all(requestId) as Array<{ assignmentId: string; canary: number; status: string }>;
  const current = assignments.find(({ status }) => status !== "completed");
  const canary = assignments.find(({ canary: isCanary }) => isCanary === 1);
  if (row.contractVersion === "workbench-authoring-v4" && !canary) throw new Error("guided_request_missing_canary");
  if (row.contractVersion === "workbench-authoring-v5" && canary) throw new Error("guided_v5_request_has_canary");
  return {
    requestId: row.requestId,
    actorId: row.actorId,
    contractVersion: row.contractVersion,
    policyVersion: row.policyVersion,
    status: row.status,
    baseUrl: row.baseUrl,
    databaseId: row.databaseId,
    buildSha: row.buildSha,
    instanceManifest: row.instanceManifest,
    creationInstanceId: row.creationInstanceId,
    sessionCount: Number(counts.sessionCount),
    completedSessionCount: Number(counts.completedSessionCount ?? 0),
    assignmentCount: assignments.length,
    ...(current ? { currentAssignmentId: current.assignmentId } : {}),
    ...(canary ? { canaryAssignmentId: canary.assignmentId } : {}),
    ...(row.canaryApprovedAt ? { canaryApprovedAt: row.canaryApprovedAt } : {}),
    ...(row.canaryApprovedBy ? { canaryApprovedBy: row.canaryApprovedBy } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.completedAt ? { completedAt: row.completedAt } : {})
  };
}

export function getGuidedAuthoringRequestForAssignment(
  db: MastheadDatabase,
  assignmentId: string
): GuidedAuthoringStableRequestBinding | undefined {
  return db.prepare(
    `SELECT request.base_url AS baseUrl,
            request.database_id AS databaseId,
            request.build_sha AS buildSha,
            request.instance_manifest AS instanceManifest,
            request.creation_instance_id AS creationInstanceId,
            request.contract_version AS contractVersion
     FROM guided_authoring_assignments AS assignment
     JOIN guided_authoring_requests AS request
       ON request.request_id = assignment.request_id
     WHERE assignment.assignment_id = ?`
  ).get(assignmentId) as GuidedAuthoringStableRequestBinding | undefined;
}

export function getGuidedAssignment(
  db: MastheadDatabase,
  assignmentId: string
): GuidedAuthoringAssignmentDto | undefined {
  const row = getAssignmentRow(db, assignmentId);
  return row ? mapAssignment(db, row) : undefined;
}

export function getGuidedAssignmentReceipt(
  db: MastheadDatabase,
  assignmentId: string
): GuidedAuthoringReceiptDto | undefined {
  const row = db.prepare(
    `SELECT receipt_json AS receiptJson
     FROM guided_authoring_assignments
     WHERE assignment_id = ?`
  ).get(assignmentId) as { receiptJson: string | null } | undefined;
  return row?.receiptJson ? parseJson(row.receiptJson) : undefined;
}

export function getGuidedAssignments(db: MastheadDatabase, requestId: string): GuidedAuthoringAssignmentDto[] {
  const rows = db.prepare(`${assignmentSelect} WHERE request_id = ? ORDER BY ordinal`).all(requestId) as AssignmentRow[];
  return rows.map((row) => mapAssignment(db, row));
}

export function listPendingGuidedCanaryAssignments(
  db: MastheadDatabase
): GuidedAuthoringAssignmentDto[] {
  const rows = db.prepare(
    `SELECT assignment.assignment_id AS assignmentId, assignment.request_id AS requestId,
            assignment.ordinal, assignment.status, assignment.canary,
            assignment.evidence_revision AS evidenceRevision,
            assignment.current_draft_revision AS currentDraftRevision,
            assignment.accepted_draft_revision AS acceptedDraftRevision,
            assignment.receipt_json AS receiptJson, assignment.created_at AS createdAt,
            assignment.updated_at AS updatedAt, assignment.completed_at AS completedAt
     FROM guided_authoring_assignments AS assignment
     JOIN guided_authoring_requests AS request
       ON request.request_id = assignment.request_id
     WHERE assignment.canary = 1
       AND assignment.status = 'staged_canary'
       AND assignment.accepted_draft_revision IS NOT NULL
       AND assignment.receipt_json IS NULL
       AND request.status = 'awaiting_canary_approval'
       AND request.contract_version = 'workbench-authoring-v4'
       AND NOT EXISTS (
         SELECT 1 FROM guided_authoring_operator_reviews AS operator_review
         WHERE operator_review.assignment_id = assignment.assignment_id
           AND operator_review.draft_revision = assignment.accepted_draft_revision
       )
     ORDER BY request.updated_at, request.request_id,
              assignment.ordinal, assignment.assignment_id`
  ).all() as AssignmentRow[];
  return rows.map((row) => mapAssignment(db, row));
}

export function listGuidedOpportunities(
  db: MastheadDatabase,
  requestId: string
): GuidedAuthoringOpportunityRecord[] {
  const rows = db.prepare(
    `SELECT request_id AS requestId, opportunity_id AS opportunityId, suggested_kind AS suggestedKind,
            signal_strength AS signalStrength, summary, signature_key AS signatureKey,
            evidence_refs_json AS evidenceRefsJson, provenance_session_ids_json AS provenanceSessionIdsJson,
            created_at AS createdAt
     FROM guided_authoring_opportunities WHERE request_id = ? ORDER BY rowid`
  ).all(requestId) as Array<{
    requestId: string;
    opportunityId: string;
    suggestedKind: WorkbenchAutomaticArtifactKind;
    signalStrength: "high" | "medium";
    summary: string;
    signatureKey: string | null;
    evidenceRefsJson: string;
    provenanceSessionIdsJson: string;
    createdAt: string;
  }>;
  return rows.map((row) => ({
    requestId: row.requestId,
    opportunityId: row.opportunityId,
    suggestedKind: row.suggestedKind,
    signalStrength: row.signalStrength,
    summary: row.summary,
    ...(row.signatureKey ? { signatureKey: row.signatureKey } : {}),
    evidenceRefs: parseJson(row.evidenceRefsJson),
    provenanceSessionIds: parseJson(row.provenanceSessionIdsJson),
    createdAt: row.createdAt
  }));
}

export function recordGuidedEvidenceAccess(
  db: MastheadDatabase,
  input: { assignmentId: string; requestId: string; sessionId: string; evidenceRevision: string; evidenceRefs: string[] }
): void {
  withImmediateTransaction(db, () => recordGuidedEvidenceAccessInTransaction(db, input));
}

export function recordGuidedEvidenceAccessInTransaction(
  db: MastheadDatabase,
  input: { assignmentId: string; requestId: string; sessionId: string; evidenceRevision: string; evidenceRefs: string[] }
): void {
  requireNonblank([input.assignmentId, input.requestId, input.sessionId, input.evidenceRevision], "invalid_guided_evidence_access");
  if (input.evidenceRefs.length === 0 || input.evidenceRefs.some((ref) => !isNonblank(ref))) {
    throw new Error("invalid_guided_evidence_access");
  }
  const membership = db.prepare(
    `SELECT rs.state, a.status, a.evidence_revision AS evidenceRevision
     FROM guided_authoring_assignment_sessions AS membership
     JOIN guided_authoring_request_sessions AS rs
       ON rs.request_id = membership.request_id AND rs.session_id = membership.session_id
     JOIN guided_authoring_assignments AS a ON a.assignment_id = membership.assignment_id
     WHERE membership.assignment_id = ? AND membership.request_id = ? AND membership.session_id = ?`
  ).get(input.assignmentId, input.requestId, input.sessionId) as {
    evidenceRevision: string;
    state: string;
    status: string;
  } | undefined;
  if (!membership) throw new Error("guided_evidence_session_not_assigned");
  if (membership.state !== "assigned" || membership.status === "completed") {
    throw new Error("guided_assignment_not_active");
  }
  if (membership.evidenceRevision !== input.evidenceRevision) {
    throw new Error("guided_evidence_revision_mismatch");
  }
  const insert = db.prepare(
    `INSERT OR IGNORE INTO guided_authoring_evidence_access
     (assignment_id, request_id, session_id, evidence_revision, evidence_ref, accessed_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const now = new Date().toISOString();
  for (const evidenceRef of new Set(input.evidenceRefs)) {
    insert.run(input.assignmentId, input.requestId, input.sessionId, input.evidenceRevision, evidenceRef, now);
  }
}

export function advanceGuidedAssignmentEvidenceRevision(
  db: MastheadDatabase,
  input: {
    assignmentId: string;
    expectedEvidenceRevision: string;
    nextEvidenceRevision: string;
  }
): GuidedAuthoringAssignmentDto {
  return withImmediateTransaction(db, () => advanceGuidedAssignmentEvidenceRevisionInTransaction(db, input));
}

export function advanceGuidedAssignmentEvidenceRevisionInTransaction(
  db: MastheadDatabase,
  input: {
    assignmentId: string;
    expectedEvidenceRevision: string;
    nextEvidenceRevision: string;
  }
): GuidedAuthoringAssignmentDto {
  requireNonblank(
    [input.assignmentId, input.expectedEvidenceRevision, input.nextEvidenceRevision],
    "invalid_guided_evidence_revision_advance"
  );
  const assignment = getAssignmentRow(db, input.assignmentId);
  if (!assignment) throw new Error("guided_assignment_not_found");
  if (["staged_canary", "ready_to_finish", "completed"].includes(assignment.status)) {
    throw new Error("guided_assignment_evidence_locked");
  }
  if (assignment.evidenceRevision !== input.expectedEvidenceRevision) {
    throw new Error("guided_evidence_revision_conflict");
  }
  const now = new Date().toISOString();
  const changed = db.prepare(
    `UPDATE guided_authoring_assignments
     SET evidence_revision = ?, status = 'investigating', accepted_draft_revision = NULL, updated_at = ?
     WHERE assignment_id = ? AND evidence_revision = ?
       AND status IN ('investigating', 'drafting', 'needs_revision')`
  ).run(input.nextEvidenceRevision, now, input.assignmentId, input.expectedEvidenceRevision);
  if (changed.changes !== 1) {
    const current = getAssignmentRow(db, input.assignmentId);
    if (current && ["staged_canary", "ready_to_finish", "completed"].includes(current.status)) {
      throw new Error("guided_assignment_evidence_locked");
    }
    throw new Error("guided_evidence_revision_conflict");
  }
  return requireGuidedAssignment(db, input.assignmentId);
}

export function invalidateLockedGuidedAssignmentEvidenceInTransaction(
  db: MastheadDatabase,
  input: {
    assignmentId: string;
    expectedStatus: "staged_canary" | "ready_to_finish";
    expectedEvidenceRevision: string;
    nextEvidenceRevision: string;
  }
): { assignment: GuidedAuthoringAssignmentDto; request: GuidedAuthoringRequestDto } {
  requireNonblank(
    [input.assignmentId, input.expectedEvidenceRevision, input.nextEvidenceRevision],
    "invalid_guided_evidence_revision_advance"
  );
  const assignment = getAssignmentRow(db, input.assignmentId);
  if (!assignment) throw new Error("guided_assignment_not_found");
  const now = new Date().toISOString();
  const changed = db.prepare(
    `UPDATE guided_authoring_assignments
     SET evidence_revision = ?, status = 'investigating', accepted_draft_revision = NULL, updated_at = ?
     WHERE assignment_id = ? AND status = ? AND evidence_revision = ?
       AND accepted_draft_revision IS NOT NULL`
  ).run(
    input.nextEvidenceRevision,
    now,
    input.assignmentId,
    input.expectedStatus,
    input.expectedEvidenceRevision
  );
  if (changed.changes !== 1) throw new Error("guided_evidence_revision_conflict");
  if (assignment.canary === 1) {
    db.prepare(
      `UPDATE guided_authoring_requests
       SET status = 'open', canary_approved_at = NULL, canary_approved_by = NULL, updated_at = ?
       WHERE request_id = ?`
    ).run(now, assignment.requestId);
  }
  return {
    assignment: requireGuidedAssignment(db, input.assignmentId),
    request: requireGuidedRequest(db, assignment.requestId)
  };
}

export function listGuidedEvidenceAccess(
  db: MastheadDatabase,
  assignmentId: string,
  evidenceRevision?: string
): GuidedEvidenceAccessRecord[] {
  const args: string[] = [assignmentId];
  let where = "assignment_id = ?";
  if (evidenceRevision) {
    where += " AND evidence_revision = ?";
    args.push(evidenceRevision);
  }
  return db.prepare(
    `SELECT assignment_id AS assignmentId, request_id AS requestId, session_id AS sessionId,
            evidence_revision AS evidenceRevision, evidence_ref AS evidenceRef, accessed_at AS accessedAt
     FROM guided_authoring_evidence_access WHERE ${where}
     ORDER BY session_id, evidence_revision, evidence_ref`
  ).all(...args) as GuidedEvidenceAccessRecord[];
}

export function storeGuidedDraftReview(
  db: MastheadDatabase,
  input: { assignmentId: string; draft: GuidedAuthoringBundleV4; findings: WorkbenchAuthoringFinding[] }
): GuidedAuthoringAssignmentDto {
  return withImmediateTransaction(db, () => storeGuidedDraftReviewInTransaction(db, input));
}

export function storeGuidedDraftReviewInTransaction(
  db: MastheadDatabase,
  input: { assignmentId: string; draft: GuidedAuthoringBundleV4; findings: WorkbenchAuthoringFinding[] }
): GuidedAuthoringAssignmentDto {
  const assignment = getAssignmentRow(db, input.assignmentId);
  if (!assignment) throw new Error("guided_assignment_not_found");
  const approvedCanaryReview = currentAcceptedCanaryApproval(db, assignment);
  if (approvedCanaryReview) throw new Error("guided_canary_review_locked");
  if (!["investigating", "drafting", "needs_revision"].includes(assignment.status)) {
    throw new Error("guided_assignment_not_draftable");
  }
  if (
    assignment.status === "completed" ||
    input.draft.assignmentId !== assignment.assignmentId ||
    input.draft.evidenceRevision !== assignment.evidenceRevision
  ) {
    throw new Error("invalid_guided_draft_review");
  }
  const inactiveMembership = db.prepare(
    `SELECT 1 AS found
     FROM guided_authoring_assignment_sessions AS membership
     JOIN guided_authoring_request_sessions AS rs
       ON rs.request_id = membership.request_id AND rs.session_id = membership.session_id
     WHERE membership.assignment_id = ? AND rs.state != 'assigned' LIMIT 1`
  ).get(assignment.assignmentId);
  if (inactiveMembership) throw new Error("guided_assignment_not_active");
  const revision = assignment.currentDraftRevision + 1;
  const accepted = !input.findings.some(({ severity }) => severity === "error");
  const status: GuidedAuthoringAssignmentDto["status"] = accepted
    ? assignment.canary === 1 ? "staged_canary" : "ready_to_finish"
    : "needs_revision";
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO guided_authoring_draft_reviews
     (assignment_id, revision, evidence_revision, draft_json, findings_json, accepted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    assignment.assignmentId,
    revision,
    assignment.evidenceRevision,
    JSON.stringify(input.draft),
    JSON.stringify(input.findings),
    accepted ? 1 : 0,
    now
  );
  db.prepare(
    `UPDATE guided_authoring_assignments
     SET status = ?, current_draft_revision = ?, accepted_draft_revision = ?, updated_at = ?
     WHERE assignment_id = ? AND status = ? AND evidence_revision = ? AND current_draft_revision = ?`
  ).run(
    status,
    revision,
    accepted ? revision : null,
    now,
    assignment.assignmentId,
    assignment.status,
    assignment.evidenceRevision,
    assignment.currentDraftRevision
  );
  if (accepted && assignment.canary === 1) {
    db.prepare(
      `UPDATE guided_authoring_requests SET status = 'awaiting_canary_approval', updated_at = ? WHERE request_id = ?`
    ).run(now, assignment.requestId);
  }
  return requireGuidedAssignment(db, assignment.assignmentId);
}

export function listGuidedDraftReviews(db: MastheadDatabase, assignmentId: string): GuidedDraftReviewRecord[] {
  const rows = db.prepare(
    `SELECT assignment_id AS assignmentId, revision, evidence_revision AS evidenceRevision,
            draft_json AS draftJson, findings_json AS findingsJson, accepted, created_at AS createdAt
     FROM guided_authoring_draft_reviews WHERE assignment_id = ? ORDER BY revision`
  ).all(assignmentId) as Array<{
    assignmentId: string;
    revision: number;
    evidenceRevision: string;
    draftJson: string;
    findingsJson: string;
    accepted: number;
    createdAt: string;
  }>;
  return rows.map((row) => ({
    assignmentId: row.assignmentId,
    revision: row.revision,
    evidenceRevision: row.evidenceRevision,
    draft: parseJson(row.draftJson),
    findings: parseJson(row.findingsJson),
    accepted: row.accepted === 1,
    createdAt: row.createdAt
  }));
}

export function recordCanaryDecision(
  db: MastheadDatabase,
  input: {
    requestId: string;
    assignmentId: string;
    draftRevision: number;
    decision: "approved" | "rejected";
    notes: string;
    reviewedBy: string;
  }
): GuidedAuthoringRequestDto {
  return withImmediateTransaction(db, () => recordCanaryDecisionInTransaction(db, input));
}

export function recordCanaryDecisionInTransaction(
  db: MastheadDatabase,
  input: {
    requestId: string;
    assignmentId: string;
    draftRevision: number;
    decision: "approved" | "rejected";
    notes: string;
    reviewedBy: string;
  }
): GuidedAuthoringRequestDto {
  requireNonblank([input.requestId, input.assignmentId, input.notes, input.reviewedBy], "invalid_canary_decision");
  if (!Number.isSafeInteger(input.draftRevision) || input.draftRevision < 1) {
    throw new Error("invalid_canary_decision");
  }
  const assignment = getAssignmentRow(db, input.assignmentId);
  const request = getGuidedAuthoringRequest(db, input.requestId);
  const acceptedDraft = assignment
    ? db.prepare(
      `SELECT accepted, evidence_revision AS evidenceRevision
       FROM guided_authoring_draft_reviews
       WHERE assignment_id = ? AND revision = ?`
    ).get(input.assignmentId, input.draftRevision) as { accepted: number; evidenceRevision: string } | undefined
    : undefined;
  if (
    !assignment ||
    request?.status !== "awaiting_canary_approval" ||
    assignment.requestId !== input.requestId ||
    assignment.canary !== 1 ||
    assignment.status !== "staged_canary" ||
    assignment.acceptedDraftRevision !== input.draftRevision ||
    acceptedDraft?.accepted !== 1 ||
    acceptedDraft.evidenceRevision !== assignment.evidenceRevision
  ) {
    throw new Error("guided_canary_not_ready");
  }
  const existingDecision = db.prepare(
    `SELECT request_id AS requestId, decision, notes, reviewed_by AS reviewedBy
     FROM guided_authoring_operator_reviews
     WHERE assignment_id = ? AND draft_revision = ?`
  ).get(input.assignmentId, input.draftRevision) as {
    requestId: string;
    decision: "approved" | "rejected";
    notes: string;
    reviewedBy: string;
  } | undefined;
  if (existingDecision) {
    if (
      existingDecision.requestId === input.requestId &&
      existingDecision.decision === input.decision &&
      existingDecision.notes === input.notes &&
      existingDecision.reviewedBy === input.reviewedBy
    ) {
      return requireGuidedRequest(db, input.requestId);
    }
    throw new Error("guided_canary_decision_conflict");
  }
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO guided_authoring_operator_reviews
     (review_id, request_id, assignment_id, draft_revision, decision, notes, reviewed_by, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), input.requestId, input.assignmentId, input.draftRevision, input.decision, input.notes, input.reviewedBy, now);
  if (input.decision === "approved") {
    db.prepare(
      `UPDATE guided_authoring_requests
       SET status = 'awaiting_canary_approval', canary_approved_at = ?, canary_approved_by = ?, updated_at = ?
       WHERE request_id = ?`
    ).run(now, input.reviewedBy, now, input.requestId);
  } else {
    db.prepare(
      `UPDATE guided_authoring_assignments
       SET status = 'needs_revision', accepted_draft_revision = NULL, updated_at = ?
       WHERE assignment_id = ? AND status = 'staged_canary'
         AND accepted_draft_revision = ? AND evidence_revision = ?`
    ).run(now, input.assignmentId, input.draftRevision, assignment.evidenceRevision);
    db.prepare(
      `UPDATE guided_authoring_requests
       SET status = 'open', canary_approved_at = NULL, canary_approved_by = NULL, updated_at = ?
       WHERE request_id = ?`
    ).run(now, input.requestId);
  }
  return requireGuidedRequest(db, input.requestId);
}

export function listGuidedOperatorReviews(
  db: MastheadDatabase,
  assignmentId: string
): GuidedAuthoringOperatorReviewDto[] {
  return db.prepare(
    `SELECT review_id AS reviewId, draft_revision AS draftRevision, decision, notes,
            reviewed_by AS reviewedBy, reviewed_at AS reviewedAt
     FROM guided_authoring_operator_reviews WHERE assignment_id = ?
     ORDER BY reviewed_at, rowid`
  ).all(assignmentId) as GuidedAuthoringOperatorReviewDto[];
}

export function completeGuidedAssignment(
  db: MastheadDatabase,
  assignmentId: string,
  receipt: GuidedAuthoringReceiptDto
): GuidedAuthoringReceiptDto {
  return withImmediateTransaction(db, () => completeGuidedAssignmentInTransaction(db, assignmentId, receipt));
}

export function completeGuidedAssignmentInTransaction(
  db: MastheadDatabase,
  assignmentId: string,
  receipt: GuidedAuthoringReceiptDto
): GuidedAuthoringReceiptDto {
  const assignment = getAssignmentRow(db, assignmentId);
  if (!assignment) throw new Error("guided_assignment_not_found");
  if (assignment.status === "completed" && assignment.receiptJson) return parseJson(assignment.receiptJson);
  persistGuidedAssignmentReceiptInTransaction(db, assignmentId, receipt);
  return transitionGuidedAssignmentAfterReceiptInTransaction(db, assignmentId, receipt).receipt;
}

export function persistGuidedAssignmentReceiptInTransaction(
  db: MastheadDatabase,
  assignmentId: string,
  receipt: GuidedAuthoringReceiptDto
): GuidedAuthoringReceiptDto {
  const assignment = getAssignmentRow(db, assignmentId);
  if (!assignment) throw new Error("guided_assignment_not_found");
  if (assignment.status === "completed" && assignment.receiptJson) return parseJson(assignment.receiptJson);
  const request = getGuidedAuthoringRequest(db, assignment.requestId);
  assertGuidedAssignmentReadyForCompletion(db, assignment, request);
  validateGuidedAssignmentReceipt(db, assignment, request, receipt);
  if (assignment.receiptJson) {
    if (assignment.receiptJson !== JSON.stringify(receipt)) {
      throw new Error("guided_assignment_receipt_mismatch");
    }
    return parseJson(assignment.receiptJson);
  }
  const persisted = db.prepare(
    `UPDATE guided_authoring_assignments
     SET receipt_json = ?, updated_at = ?
     WHERE assignment_id = ? AND status = ? AND evidence_revision = ?
       AND accepted_draft_revision = ? AND receipt_json IS NULL`
  ).run(
    JSON.stringify(receipt),
    receipt.completedAt,
    assignment.assignmentId,
    assignment.status,
    assignment.evidenceRevision,
    assignment.acceptedDraftRevision
  );
  if (persisted.changes !== 1) throw new Error("guided_assignment_receipt_conflict");
  return receipt;
}

export function transitionGuidedAssignmentAfterReceiptInTransaction(
  db: MastheadDatabase,
  assignmentId: string,
  receipt: GuidedAuthoringReceiptDto
): { receipt: GuidedAuthoringReceiptDto; request: GuidedAuthoringRequestDto } {
  const assignment = getAssignmentRow(db, assignmentId);
  if (!assignment) throw new Error("guided_assignment_not_found");
  if (!assignment.receiptJson) throw new Error("guided_assignment_receipt_not_persisted");
  if (assignment.receiptJson !== JSON.stringify(receipt)) {
    throw new Error("guided_assignment_receipt_mismatch");
  }
  const storedReceipt = parseJson<GuidedAuthoringReceiptDto>(assignment.receiptJson);
  if (assignment.status === "completed") {
    return { receipt: storedReceipt, request: requireGuidedRequest(db, assignment.requestId) };
  }
  const request = getGuidedAuthoringRequest(db, assignment.requestId);
  assertGuidedAssignmentReadyForCompletion(db, assignment, request);
  validateGuidedAssignmentReceipt(db, assignment, request, storedReceipt);
  const expectedRequestStatus = assignment.canary === 1 ? "awaiting_canary_approval" : "active";
  const now = storedReceipt.completedAt;
  const completed = db.prepare(
    `UPDATE guided_authoring_assignments
     SET status = 'completed', completed_at = ?, updated_at = ?
     WHERE assignment_id = ? AND status = ? AND evidence_revision = ?
       AND accepted_draft_revision = ? AND receipt_json = ?`
  ).run(
    now,
    now,
    assignment.assignmentId,
    assignment.status,
    assignment.evidenceRevision,
    assignment.acceptedDraftRevision,
    assignment.receiptJson
  );
  if (completed.changes !== 1) throw new Error("guided_assignment_transition_conflict");
  const sessionIds = assignmentMembership(
    db,
    assignmentId,
    "guided_authoring_assignment_sessions",
    "session_id"
  );
  const completedSessions = db.prepare(
    `UPDATE guided_authoring_request_sessions SET state = 'completed'
     WHERE request_id = ? AND state = 'assigned' AND session_id IN (
       SELECT session_id FROM guided_authoring_assignment_sessions WHERE assignment_id = ?
     )`
  ).run(assignment.requestId, assignmentId);
  if (completedSessions.changes !== sessionIds.length) {
    throw new Error("guided_assignment_transition_conflict");
  }
  const next = db.prepare(
    `SELECT assignment_id AS assignmentId FROM guided_authoring_assignments
     WHERE request_id = ? AND status != 'completed' ORDER BY ordinal LIMIT 1`
  ).get(assignment.requestId) as { assignmentId: string } | undefined;
  if (next) {
    const nextSessionIds = assignmentMembership(
      db,
      next.assignmentId,
      "guided_authoring_assignment_sessions",
      "session_id"
    );
    const released = db.prepare(
      `UPDATE guided_authoring_request_sessions SET state = 'assigned'
       WHERE request_id = ? AND state = 'pending' AND session_id IN (
         SELECT session_id FROM guided_authoring_assignment_sessions WHERE assignment_id = ?
       )`
    ).run(assignment.requestId, next.assignmentId);
    if (released.changes !== nextSessionIds.length) {
      throw new Error("guided_assignment_transition_conflict");
    }
    const requestChanged = db.prepare(
      `UPDATE guided_authoring_requests SET status = 'active', updated_at = ?
       WHERE request_id = ? AND status = ?`
    ).run(now, assignment.requestId, expectedRequestStatus);
    if (requestChanged.changes !== 1) throw new Error("guided_assignment_transition_conflict");
  } else {
    const requestChanged = db.prepare(
      `UPDATE guided_authoring_requests SET status = 'completed', completed_at = ?, updated_at = ?
       WHERE request_id = ? AND status = ?`
    ).run(now, now, assignment.requestId, expectedRequestStatus);
    if (requestChanged.changes !== 1) throw new Error("guided_assignment_transition_conflict");
  }
  return { receipt: storedReceipt, request: requireGuidedRequest(db, assignment.requestId) };
}

function assertGuidedAssignmentReadyForCompletion(
  db: MastheadDatabase,
  assignment: AssignmentRow,
  request: GuidedAuthoringRequestDto | undefined
): void {
  const acceptedDraft = assignment.acceptedDraftRevision === null
    ? undefined
    : db.prepare(
      `SELECT accepted, evidence_revision AS evidenceRevision
       FROM guided_authoring_draft_reviews
       WHERE assignment_id = ? AND revision = ?`
    ).get(assignment.assignmentId, assignment.acceptedDraftRevision) as {
      accepted: number;
      evidenceRevision: string;
    } | undefined;
  const acceptedDraftIsCurrent = acceptedDraft?.accepted === 1 &&
    acceptedDraft.evidenceRevision === assignment.evidenceRevision;
  const approvedCanaryReview = currentAcceptedCanaryApproval(db, assignment);
  const ready = (assignment.canary === 0 && assignment.status === "ready_to_finish" && acceptedDraftIsCurrent) || (
    assignment.canary === 1 &&
    assignment.status === "staged_canary" &&
    request?.status === "awaiting_canary_approval" &&
    acceptedDraftIsCurrent &&
    Boolean(approvedCanaryReview)
  );
  if (!ready) throw new Error("guided_assignment_not_ready");
}

function validateGuidedAssignmentReceipt(
  db: MastheadDatabase,
  assignment: AssignmentRow,
  request: GuidedAuthoringRequestDto | undefined,
  receipt: GuidedAuthoringReceiptDto
): void {
  const sessionIds = assignmentMembership(
    db,
    assignment.assignmentId,
    "guided_authoring_assignment_sessions",
    "session_id"
  );
  const opportunityIds = assignmentMembership(
    db,
    assignment.assignmentId,
    "guided_authoring_assignment_opportunities",
    "opportunity_id"
  );
  if (
    receipt.assignmentId !== assignment.assignmentId ||
    receipt.requestId !== assignment.requestId ||
    receipt.evidenceRevision !== assignment.evidenceRevision ||
    receipt.draftRevision !== assignment.acceptedDraftRevision ||
    request?.baseUrl !== receipt.baseUrl ||
    request.databaseId !== receipt.databaseId ||
    request.buildSha !== receipt.buildSha ||
    request.instanceManifest !== receipt.instanceManifest ||
    !sameOrderedValues(receipt.sessionIds, sessionIds) ||
    !sameOrderedValues(receipt.opportunityIds, opportunityIds) ||
    !isNonblank(receipt.publicationInstanceId) ||
    !isNonblank(receipt.completedAt)
  ) {
    throw new Error("invalid_guided_assignment_receipt");
  }
}

const assignmentSelect = `SELECT assignment_id AS assignmentId, request_id AS requestId, ordinal, status,
  canary, evidence_revision AS evidenceRevision, current_draft_revision AS currentDraftRevision,
  accepted_draft_revision AS acceptedDraftRevision, receipt_json AS receiptJson,
  created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt
  FROM guided_authoring_assignments`;

function getAssignmentRow(db: MastheadDatabase, assignmentId: string): AssignmentRow | undefined {
  return db.prepare(`${assignmentSelect} WHERE assignment_id = ?`).get(assignmentId) as AssignmentRow | undefined;
}

function currentAcceptedCanaryApproval(
  db: MastheadDatabase,
  assignment: AssignmentRow
): { found: number } | undefined {
  if (assignment.canary !== 1 || assignment.acceptedDraftRevision === null) return undefined;
  return db.prepare(
    `SELECT 1 AS found
     FROM guided_authoring_operator_reviews AS operator_review
     JOIN guided_authoring_draft_reviews AS draft_review
       ON draft_review.assignment_id = operator_review.assignment_id
      AND draft_review.revision = operator_review.draft_revision
     WHERE operator_review.assignment_id = ?
       AND operator_review.decision = 'approved'
       AND operator_review.draft_revision = ?
       AND draft_review.evidence_revision = ?
       AND draft_review.accepted = 1
     LIMIT 1`
  ).get(
    assignment.assignmentId,
    assignment.acceptedDraftRevision,
    assignment.evidenceRevision
  ) as { found: number } | undefined;
}

function mapAssignment(db: MastheadDatabase, row: AssignmentRow): GuidedAuthoringAssignmentDto {
  const draft = row.currentDraftRevision > 0
    ? db.prepare(
      `SELECT findings_json AS findingsJson FROM guided_authoring_draft_reviews
       WHERE assignment_id = ? AND revision = ? AND evidence_revision = ?`
    ).get(row.assignmentId, row.currentDraftRevision, row.evidenceRevision) as { findingsJson: string } | undefined
    : undefined;
  return {
    assignmentId: row.assignmentId,
    requestId: row.requestId,
    ordinal: row.ordinal,
    status: row.status,
    canary: row.canary === 1,
    evidenceRevision: row.evidenceRevision,
    sessionIds: assignmentMembership(db, row.assignmentId, "guided_authoring_assignment_sessions", "session_id"),
    opportunityIds: assignmentMembership(db, row.assignmentId, "guided_authoring_assignment_opportunities", "opportunity_id"),
    currentDraftRevision: row.currentDraftRevision,
    ...(row.acceptedDraftRevision === null ? {} : { acceptedDraftRevision: row.acceptedDraftRevision }),
    findings: draft ? parseJson(draft.findingsJson) : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.completedAt ? { completedAt: row.completedAt } : {})
  };
}

function assignmentMembership(
  db: MastheadDatabase,
  assignmentId: string,
  table: "guided_authoring_assignment_sessions" | "guided_authoring_assignment_opportunities",
  column: "session_id" | "opportunity_id"
): string[] {
  return (db.prepare(`SELECT ${column} AS value FROM ${table} WHERE assignment_id = ? ORDER BY ordinal`).all(assignmentId) as Array<{ value: string }>).map(
    ({ value }) => value
  );
}

function validateRequestPlan(db: MastheadDatabase, input: CreateGuidedAuthoringRequestInput): void {
  const fail = () => { throw new Error("invalid_guided_authoring_plan"); };
  try {
    requireNonblank([
      input.requestId,
      input.actorId,
      input.policyVersion,
      input.identity.creationInstanceId,
      input.identity.instanceManifest,
      input.identity.baseUrl,
      input.identity.databaseId,
      input.identity.buildSha
    ], "invalid_guided_authoring_plan");
    if (input.policyVersion !== "guided-authoring-v1" || input.sessions.length === 0 || input.assignments.length === 0) fail();
    assertUniqueContiguous(input.sessions.map(({ sessionId, ordinal }) => ({ id: sessionId, ordinal })));
    assertUniqueContiguous(input.assignments.map(({ assignmentId, ordinal }) => ({ id: assignmentId, ordinal })));
    const sessionIds = new Set(input.sessions.map(({ sessionId }) => sessionId));
    const opportunityIds = new Set(input.opportunities.map(({ opportunityId }) => opportunityId));
    if (opportunityIds.size !== input.opportunities.length) fail();
    const canaries = input.assignments.filter(({ canary }) => canary);
    if (input.contractVersion === "workbench-authoring-v4") {
      if (canaries.length !== 1 || canaries[0]?.ordinal !== 0 || canaries[0].sessionIds.length > 3) fail();
    } else if (input.contractVersion === "workbench-authoring-v5") {
      if (canaries.length !== 0) fail();
    } else fail();
    const assignedSessions: string[] = [];
    const assignedOpportunities: string[] = [];
    for (const assignment of input.assignments) {
      requireNonblank([assignment.assignmentId, assignment.evidenceRevision], "invalid_guided_authoring_plan");
      if (assignment.sessionIds.length === 0 || assignment.sessionIds.length > 12) fail();
      if (new Set(assignment.sessionIds).size !== assignment.sessionIds.length) fail();
      if (new Set(assignment.opportunityIds).size !== assignment.opportunityIds.length) fail();
      if (assignment.sessionIds.some((id) => !sessionIds.has(id))) fail();
      if (assignment.opportunityIds.some((id) => !opportunityIds.has(id))) fail();
      const assignmentSessionIds = new Set(assignment.sessionIds);
      for (const opportunityId of assignment.opportunityIds) {
        const opportunity = input.opportunities.find((candidate) => candidate.opportunityId === opportunityId);
        if (!opportunity || opportunity.provenanceSessionIds.some((id) => !assignmentSessionIds.has(id))) fail();
      }
      assignedSessions.push(...assignment.sessionIds);
      assignedOpportunities.push(...assignment.opportunityIds);
    }
    if (!sameSetsExactly(assignedSessions, [...sessionIds]) || !sameSetsExactly(assignedOpportunities, [...opportunityIds])) fail();
    for (const opportunity of input.opportunities) {
      requireNonblank([opportunity.opportunityId, opportunity.summary, ...opportunity.evidenceRefs, ...opportunity.provenanceSessionIds], "invalid_guided_authoring_plan");
      if (opportunity.evidenceRefs.length === 0 || opportunity.provenanceSessionIds.length === 0) fail();
      if (opportunity.provenanceSessionIds.some((id) => !sessionIds.has(id))) fail();
    }
    const placeholders = input.sessions.map(() => "?").join(",");
    const existing = db.prepare(`SELECT session_id AS sessionId FROM sessions WHERE session_id IN (${placeholders})`)
      .all(...input.sessions.map(({ sessionId }) => sessionId)) as Array<{ sessionId: string }>;
    if (existing.length !== input.sessions.length) fail();
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_guided_authoring_plan") throw error;
    fail();
  }
}

function assertUniqueContiguous(items: Array<{ id: string; ordinal: number }>): void {
  if (new Set(items.map(({ id }) => id)).size !== items.length) throw new Error("invalid_guided_authoring_plan");
  const ordinals = [...items.map(({ ordinal }) => ordinal)].sort((left, right) => left - right);
  if (new Set(ordinals).size !== items.length || ordinals.some((ordinal, index) => ordinal !== index)) {
    throw new Error("invalid_guided_authoring_plan");
  }
  requireNonblank(items.map(({ id }) => id), "invalid_guided_authoring_plan");
}

function sameSetsExactly(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && new Set(actual).size === actual.length && expected.every((value) => actual.includes(value));
}

function sameOrderedValues(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requireGuidedRequest(db: MastheadDatabase, requestId: string): GuidedAuthoringRequestDto {
  const request = getGuidedAuthoringRequest(db, requestId);
  if (!request) throw new Error("guided_request_not_found");
  return request;
}

function requireGuidedAssignment(db: MastheadDatabase, assignmentId: string): GuidedAuthoringAssignmentDto {
  const assignment = getGuidedAssignment(db, assignmentId);
  if (!assignment) throw new Error("guided_assignment_not_found");
  return assignment;
}

function isNonblank(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && value === value.trim();
}

function requireNonblank(values: string[], errorCode: string): void {
  if (values.some((value) => !isNonblank(value))) throw new Error(errorCode);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
