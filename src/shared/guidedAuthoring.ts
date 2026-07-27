import type { DurableSessionEnrichment } from "./sessionEnrichment.ts";
import type {
  WorkbenchArtifactDraft,
  WorkbenchAuthoringEvidencePage,
  WorkbenchAuthoringFinding,
  WorkbenchClaimSupport
} from "./workbenchAuthoring.ts";
import { isAbsoluteAuthoringCommand } from "./workbenchAuthoring.ts";
import {
  isWorkbenchAuthoringV5CapabilitiesDto,
  type WorkbenchAuthoringV5CapabilitiesDto
} from "./workbenchAuthoringV5.ts";
export type { GuidedAuthoringExpectedIdentity } from "./instanceIdentity.ts";

export const GUIDED_AUTHORING_POLICY_VERSION = "guided-authoring-v1" as const;
export type GuidedAuthoringContractVersion = "workbench-authoring-v4" | "workbench-authoring-v5";
export const GUIDED_AUTHORING_OPERATIONS = ["start", "inspect", "scaffold", "save", "review", "finish"] as const;
export const GUIDED_AUTHORING_IDENTITY_HEADERS = {
  baseUrl: "x-masthead-authoring-base-url",
  databaseId: "x-masthead-authoring-database-id",
  buildSha: "x-masthead-authoring-build-sha",
  instanceManifest: "x-masthead-authoring-instance-manifest",
  instanceId: "x-masthead-authoring-instance-id"
} as const;

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
  | "scaffold"
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

export type GuidedEnrichmentProvenance = {
  enrichmentId: string;
  requestId: string;
  assignmentId: string;
  sessionId: string;
  draftRevision: number;
  evidenceRevision: string;
  policyVersion: "guided-authoring-v1";
  source: "guided_authoring";
  appliedAt: string;
};

export type GuidedAuthoringBundleV4 = {
  bundleVersion: "workbench-authoring-v4";
  assignmentId: string;
  evidenceRevision: string;
  sessionEnrichments: GuidedSessionEnrichmentDraft[];
  opportunityDispositions: GuidedOpportunityDisposition[];
  artifacts: GuidedArtifactDraft[];
};

export type GuidedAuthoringCapabilitiesV4Dto = {
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
  operations: ["start", "inspect", "scaffold", "save", "review", "finish"];
};

export type GuidedAuthoringCapabilitiesDto = GuidedAuthoringCapabilitiesV4Dto | WorkbenchAuthoringV5CapabilitiesDto;

export function isGuidedAuthoringCapabilitiesDto(
  value: unknown,
  options: { expectedCommand?: string } = {}
): value is GuidedAuthoringCapabilitiesDto {
  if (isWorkbenchAuthoringV5CapabilitiesDto(value)) {
    return isAbsoluteAuthoringCommand(value.command) &&
      (!options.expectedCommand || value.command === options.expectedCommand);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const capabilities = value as Record<string, unknown>;
  const command = typeof capabilities.command === "string" ? capabilities.command.trim() : "";
  return (
    capabilities.capability === "artifact_authoring" &&
    capabilities.protocol === "masthead.workbench.authoring/v1" &&
    capabilities.bundleVersion === "workbench-authoring-v4" &&
    capabilities.policyVersion === GUIDED_AUTHORING_POLICY_VERSION &&
    capabilities.maxSessionsPerAssignment === 12 &&
    isRequiredTrimmedString(capabilities.databaseId) &&
    isRequiredTrimmedString(capabilities.buildSha) &&
    isRequiredTrimmedString(capabilities.instanceId) &&
    typeof capabilities.baseUrl === "string" &&
    isCanonicalGuidedAuthoringBaseUrl(capabilities.baseUrl) &&
    typeof capabilities.instanceManifest === "string" &&
    isCanonicalAbsoluteAuthoringPath(capabilities.instanceManifest) &&
    capabilities.command === command &&
    isAbsoluteAuthoringCommand(command) &&
    (!options.expectedCommand || command === options.expectedCommand) &&
    hasExactGuidedAuthoringOperations(capabilities.operations)
  );
}

/** Browser-safe identity extraction for a capabilities DTO that already crossed validation. */
export function guidedAuthoringIdentityFromCapabilities(
  capabilities: GuidedAuthoringCapabilitiesDto
): import("./instanceIdentity.ts").GuidedAuthoringExpectedIdentity {
  if (!isGuidedAuthoringCapabilitiesDto(capabilities)) throw new Error("authoring_identity_unavailable");
  return {
    baseUrl: new URL(capabilities.baseUrl).toString().replace(/\/$/, ""),
    buildSha: capabilities.buildSha,
    databaseId: capabilities.databaseId,
    instanceId: capabilities.instanceId,
    instanceManifest: capabilities.instanceManifest
  };
}

function hasExactGuidedAuthoringOperations(operations: unknown): boolean {
  return Array.isArray(operations) &&
    operations.length === GUIDED_AUTHORING_OPERATIONS.length &&
    GUIDED_AUTHORING_OPERATIONS.every((operation, index) => operations[index] === operation);
}

function isRequiredTrimmedString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim()) && value === value.trim();
}

function isCanonicalGuidedAuthoringBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash && !value.endsWith("/");
  } catch {
    return false;
  }
}

function isCanonicalAbsoluteAuthoringPath(value: string): boolean {
  if (!isRequiredTrimmedString(value) || !isAbsoluteAuthoringCommand(value)) return false;
  if (value.startsWith("/")) {
    return (value === "/" || !value.endsWith("/")) &&
      !value.includes("//") &&
      value.slice(1).split("/").every((segment) => segment !== "." && segment !== "..");
  }
  if (value.includes("/")) return false;
  const rootLength = value.startsWith("\\\\") ? 2 : 3;
  const remainder = value.slice(rootLength);
  return Boolean(remainder) &&
    !value.endsWith("\\") &&
    !remainder.includes("\\\\") &&
    remainder.split("\\").every((segment) => Boolean(segment) && segment !== "." && segment !== "..");
}

export type GuidedAuthoringRequestDto = {
  requestId: string;
  actorId: string;
  contractVersion: GuidedAuthoringContractVersion;
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
  canaryAssignmentId?: string;
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
  authoringContract: {
    bundleSchema: unknown;
    scaffoldCommand: string;
    rule: string;
  };
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
