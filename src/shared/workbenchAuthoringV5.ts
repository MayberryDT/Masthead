import type { GuidedAuthoringExpectedIdentity } from "./instanceIdentity.ts";
import type { SessionTranscriptItem } from "./sessionTranscript.ts";

export const WORKBENCH_AUTHORING_V5_VERSION = "workbench-authoring-v5" as const;
export const WORKBENCH_AUTHORING_V5_OPERATIONS = [
  "bootstrap", "start", "claim", "inspect", "scaffold", "save", "finish", "status", "receipt"
] as const;

export type WorkbenchAuthoringV5CapabilitiesDto = GuidedAuthoringExpectedIdentity & {
  capability: "artifact_authoring";
  protocol: "masthead.workbench.authoring/v1";
  bundleVersion: typeof WORKBENCH_AUTHORING_V5_VERSION;
  policyVersion: "workbench-authoring-v5";
  command: string;
  minimumSessionsPerPack: 5;
  maximumSessionsPerPack: 12;
  operations: typeof WORKBENCH_AUTHORING_V5_OPERATIONS;
};

export type WorkbenchAuthoringV5RequestStatus = "open" | "active" | "completed" | "cancelled";
export type WorkbenchAuthoringV5PackStatus = "pending" | "available" | "active" | "saved" | "completed";
export type WorkbenchAuthoringV5Disposition = "publishable" | "soft_flag" | "hard_reject";
export type WorkbenchAuthoringV5NextActionKind =
  | "start" | "inspect" | "scaffold" | "save" | "finish" | "claim_next" | "complete";

export type WorkbenchAuthoringV5NextAction = {
  kind: WorkbenchAuthoringV5NextActionKind;
  command: string;
  reason: string;
};

export type WorkbenchAuthoringV5RequestDto = {
  requestId: string;
  actorId: string;
  contractVersion: typeof WORKBENCH_AUTHORING_V5_VERSION;
  status: WorkbenchAuthoringV5RequestStatus;
  baseUrl: string;
  databaseId: string;
  buildSha: string;
  instanceManifest: string;
  creationInstanceId: string;
  sessionCount: number;
  attemptedSessionCount: number;
  publishedSessionCount: number;
  softFlaggedSessionCount: number;
  rejectedSessionCount: number;
  packCount: number;
  packSizes: number[];
  currentPackId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type WorkbenchAuthoringV5PackDto = {
  packId: string;
  requestId: string;
  ordinal: number;
  status: WorkbenchAuthoringV5PackStatus;
  evidenceRevision: string;
  sessionIds: string[];
  currentDraftRevision: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type WorkbenchAuthoringV5EvidenceCatalogItem = Pick<
  SessionTranscriptItem,
  "itemId" | "kind" | "observedAt" | "role" | "text"
> & { id: string; source: "canonical" };

export type WorkbenchAuthoringV5Fields = {
  title: string;
  description: string;
  keywords: string[];
  purpose: string;
  outcome: string;
  keyWork: string[];
  decisions: string[];
  verification: { status: "passed" | "failed" | "mixed" | "missing" | "unknown"; summary: string };
  evidenceRefs: {
    title: string[];
    description: string[];
    purpose: string[];
    outcome: string[];
    keyWork: string[];
    verification: string[];
  };
};

export type WorkbenchAuthoringV5Draft = {
  bundleVersion: typeof WORKBENCH_AUTHORING_V5_VERSION;
  packId: string;
  evidenceRevision: string;
  sessions: Array<{
    sessionId: string;
    fields: WorkbenchAuthoringV5Fields;
    evidenceCatalog: WorkbenchAuthoringV5EvidenceCatalogItem[];
  }>;
  optionalConsiderations: [];
  optionalArtifacts: [];
};

export type WorkbenchAuthoringV5SessionOutcome = {
  sessionId: string;
  disposition: WorkbenchAuthoringV5Disposition;
  findings: Array<{ code: string; message: string }>;
};

export type WorkbenchAuthoringV5PackReceipt = {
  receiptVersion: "workbench-authoring-v5-pack-receipt-v1";
  requestId: string;
  packId: string;
  draftRevision: number;
  evidenceRevision: string;
  outcomes: WorkbenchAuthoringV5SessionOutcome[];
  publishedArtifacts: Array<{ artifactId: string; kind: "session_dossier"; sessionIds: string[] }>;
  counts: { attempted: number; published: number; softFlagged: number; rejected: number };
  completedAt: string;
};

export type WorkbenchAuthoringV5RequestReceipt = {
  receiptVersion: "workbench-authoring-v5-request-receipt-v1";
  requestId: string;
  packReceipts: WorkbenchAuthoringV5PackReceipt[];
  counts: {
    attempted: number;
    published: number;
    softFlagged: number;
    rejected: number;
    optionalPublished: number;
    consideredNo: number;
  };
  completedAt: string;
};

export function isWorkbenchAuthoringV5CapabilitiesDto(value: unknown): value is WorkbenchAuthoringV5CapabilitiesDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const dto = value as Record<string, unknown>;
  const operations = dto.operations;
  return dto.capability === "artifact_authoring" &&
    dto.protocol === "masthead.workbench.authoring/v1" &&
    dto.bundleVersion === WORKBENCH_AUTHORING_V5_VERSION &&
    dto.policyVersion === WORKBENCH_AUTHORING_V5_VERSION &&
    dto.minimumSessionsPerPack === 5 && dto.maximumSessionsPerPack === 12 &&
    typeof dto.command === "string" && Boolean(dto.command.trim()) &&
    typeof dto.baseUrl === "string" && typeof dto.databaseId === "string" &&
    typeof dto.buildSha === "string" && typeof dto.instanceManifest === "string" &&
    typeof dto.instanceId === "string" &&
    Array.isArray(operations) && operations.length === WORKBENCH_AUTHORING_V5_OPERATIONS.length &&
    WORKBENCH_AUTHORING_V5_OPERATIONS.every((operation, index) => operations[index] === operation);
}
