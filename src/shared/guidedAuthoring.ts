import type { DurableSessionEnrichment } from "./sessionEnrichment.ts";
import type {
  WorkbenchArtifactDraft,
  WorkbenchAuthoringEvidencePage,
  WorkbenchAuthoringFinding,
  WorkbenchClaimSupport
} from "./workbenchAuthoring.ts";
export type { GuidedAuthoringExpectedIdentity } from "./instanceIdentity.ts";

export const GUIDED_AUTHORING_POLICY_VERSION = "guided-authoring-v1" as const;

export type GuidedAuthoringRequestStatus =
  | "open"
  | "awaiting_canary_approval"
  | "active"
  | "completed"
  | "cancelled";

export type GuidedAuthoringAssignmentStatus =
  | "investigating"
  | "drafting"
  | "needs_revision"
  | "ready_to_finish"
  | "staged_canary"
  | "completed";

export type GuidedAuthoringNextActionKind =
  | "inspect"
  | "save"
  | "revise"
  | "await_operator"
  | "finish"
  | "claim_next"
  | "complete";

export type GuidedAuthoringNextAction = {
  kind: GuidedAuthoringNextActionKind;
  command: string;
  reason: string;
};

export type GuidedOpportunityDisposition = {
  opportunityId: string;
  disposition: "authored" | "dismissed" | "merged" | "changed_kind";
  rationale: string;
  evidenceRefs: string[];
  artifactKind?: "runbook" | "adr" | "incident_timeline";
  artifactDraftId?: string;
  mergedIntoOpportunityId?: string;
};

export type GuidedArtifactDraft = WorkbenchArtifactDraft & {
  draftId: string;
};

export type GuidedSessionEnrichmentDraft = {
  sessionId: string;
  enrichment: DurableSessionEnrichment;
  claimSupport: WorkbenchClaimSupport[];
};

export type GuidedAuthoringBundleV4 = {
  bundleVersion: "workbench-authoring-v4";
  assignmentId: string;
  evidenceRevision: string;
  sessionEnrichments: GuidedSessionEnrichmentDraft[];
  opportunityDispositions: GuidedOpportunityDisposition[];
  artifacts: GuidedArtifactDraft[];
};

export type GuidedAuthoringCapabilitiesDto = {
  capability: "artifact_authoring";
  protocol: "masthead.workbench.authoring/v1";
  bundleVersion: "workbench-authoring-v4";
  policyVersion: "guided-authoring-v1";
  command: string;
  baseUrl: string;
  databaseId: string;
  buildSha: string;
  instanceManifest: string;
  instanceId: string;
  maxSessionsPerAssignment: 12;
  canarySessions: 3;
  operations: ["start", "inspect", "save", "review", "finish"];
};

export type GuidedAuthoringRequestDto = {
  requestId: string;
  actorId: string;
  policyVersion: "guided-authoring-v1";
  status: GuidedAuthoringRequestStatus;
  baseUrl: string;
  databaseId: string;
  buildSha: string;
  instanceManifest: string;
  creationInstanceId: string;
  sessionCount: number;
  completedSessionCount: number;
  assignmentCount: number;
  currentAssignmentId?: string;
  canaryAssignmentId: string;
  canaryApprovedAt?: string;
  canaryApprovedBy?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type GuidedAuthoringAssignmentDto = {
  assignmentId: string;
  requestId: string;
  ordinal: number;
  status: GuidedAuthoringAssignmentStatus;
  canary: boolean;
  evidenceRevision: string;
  sessionIds: string[];
  opportunityIds: string[];
  currentDraftRevision: number;
  acceptedDraftRevision?: number;
  findings: WorkbenchAuthoringFinding[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type GuidedEvidenceCoverageDto = {
  sessionId: string;
  evidenceRevision: string;
  accessedItems: number;
  totalItems: number;
  complete: boolean;
};

export type GuidedAuthoringOperatorReviewDto = {
  reviewId: string;
  draftRevision: number;
  decision: "approved" | "rejected";
  notes: string;
  reviewedBy: string;
  reviewedAt: string;
};

export type GuidedAuthoringReviewDto = {
  requestId: string;
  assignmentId: string;
  status: GuidedAuthoringAssignmentStatus;
  evidenceRevision: string;
  draftRevision?: number;
  draft?: GuidedAuthoringBundleV4;
  findings: WorkbenchAuthoringFinding[];
  editorialQuestions: string[];
  coverage: GuidedEvidenceCoverageDto[];
  operatorReviews: GuidedAuthoringOperatorReviewDto[];
  nextAction: GuidedAuthoringNextAction;
};

export type GuidedInspectionDto = {
  assignmentId: string;
  evidenceRevision: string;
  sessionId: string;
  evidence: WorkbenchAuthoringEvidencePage;
  progressRecorded: boolean;
  editorialQuestions: string[];
  coverage: GuidedEvidenceCoverageDto[];
  nextAction: GuidedAuthoringNextAction;
};

export type GuidedPublishedArtifactDto = {
  draftId?: string;
  artifactId: string;
  kind: "session_dossier" | "runbook" | "adr" | "incident_timeline";
  sessionIds: string[];
};

export type GuidedAuthoringReceiptDto = {
  receiptVersion: "guided-authoring-receipt-v1";
  requestId: string;
  assignmentId: string;
  evidenceRevision: string;
  draftRevision: number;
  sessionIds: string[];
  opportunityIds: string[];
  publishedArtifacts: GuidedPublishedArtifactDto[];
  baseUrl: string;
  databaseId: string;
  buildSha: string;
  instanceManifest: string;
  publicationInstanceId: string;
  completedAt: string;
};
