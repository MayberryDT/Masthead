import type { GuidedAuthoringExpectedIdentity } from "./instanceIdentity.ts";
import type { SessionTranscriptItem } from "./sessionTranscript.ts";
import type { WorkbenchAutomaticArtifactKind } from "./workbenchAuthoring.ts";

export const WORKBENCH_AUTHORING_V5_VERSION = "workbench-authoring-v5" as const;
// The save endpoint carries authored data for at most 12 sessions. Canonical evidence
// remains in the request snapshot and is deliberately excluded from this byte budget.
export const WORKBENCH_AUTHORING_V5_SAVE_BODY_LIMIT_BYTES = 1024 * 1024;
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
export const WORKBENCH_AUTHORING_V5_HARD_REJECT_CODES = [
  "empty_or_generic_title",
  "context_or_metadata_title",
  "conversational_filler_title",
  "empty_or_generic_description",
  "templated_request_echo",
  "protocol_or_compaction_boilerplate",
  "empty_keywords",
  "insufficient_keywords",
  "metadata_or_tool_keywords",
  "purpose_not_user_ask",
  "missing_core_field_grounding",
  "unknown_canonical_evidence_ref"
] as const;
export const WORKBENCH_AUTHORING_V5_SOFT_FLAG_CODES = ["weak_verification", "thin_key_work"] as const;
export type WorkbenchAuthoringV5FindingCode =
  | typeof WORKBENCH_AUTHORING_V5_HARD_REJECT_CODES[number]
  | typeof WORKBENCH_AUTHORING_V5_SOFT_FLAG_CODES[number];
export type WorkbenchAuthoringV5NextActionKind =
  | "wait" | "start" | "inspect" | "scaffold" | "save" | "finish" | "claim_next" | "complete";

export type WorkbenchAuthoringV5PreparationDto = {
  requestId: string;
  status: "preparing" | "ready" | "failed";
  requestedSessionCount: number;
  preparedSessionCount: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type WorkbenchAuthoringV5NextAction = {
  kind: WorkbenchAuthoringV5NextActionKind;
  command: string;
  reason: string;
};

export function toWorkbenchAuthoringV5PreparationDto(
  preparation: WorkbenchAuthoringV5PreparationDto
): WorkbenchAuthoringV5PreparationDto {
  return {
    createdAt: preparation.createdAt,
    preparedSessionCount: preparation.preparedSessionCount,
    requestId: preparation.requestId,
    requestedSessionCount: preparation.requestedSessionCount,
    status: preparation.status,
    updatedAt: preparation.updatedAt,
    ...(preparation.completedAt ? { completedAt: preparation.completedAt } : {}),
    ...(preparation.errorCode ? { errorCode: preparation.errorCode } : {}),
    ...(preparation.errorMessage ? { errorMessage: preparation.errorMessage } : {})
  };
}

export function workbenchAuthoringV5PreparationWaitAction(
  command: string,
  requestId: string
): WorkbenchAuthoringV5NextAction {
  return {
    command: `${command} workbench author bootstrap --request ${quoteWorkbenchAuthoringV5Argument(requestId)} --json`,
    kind: "wait",
    reason: "The daemon is durably preparing the frozen request evidence. Retry bootstrap until preparation is ready."
  };
}

export function workbenchAuthoringV5PreparationRetryAction(
  command: string,
  requestId: string
): WorkbenchAuthoringV5NextAction {
  return {
    command: `${command} workbench author start --request ${quoteWorkbenchAuthoringV5Argument(requestId)} --json`,
    kind: "start",
    reason: "Retry the durable preparation from its last committed evidence page."
  };
}

export function workbenchAuthoringV5PreparationTerminalAction(
  reason: string
): WorkbenchAuthoringV5NextAction {
  return { command: "", kind: "complete", reason };
}

function quoteWorkbenchAuthoringV5Argument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export type WorkbenchAuthoringV5SelectionExclusionReason =
  | "session_not_found"
  | "not_on_publish_path"
  | "not_compile_ready"
  | "missing_canonical_evidence";

export type WorkbenchAuthoringV5SelectionDto = {
  requestedSessionCount: number;
  eligibleSessionCount: number;
  excludedSessionCount: number;
  excludedSessions: Array<{
    sessionId: string;
    reason: WorkbenchAuthoringV5SelectionExclusionReason;
  }>;
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

export type WorkbenchAuthoringV5OptionalConsideration = {
  kind: WorkbenchAutomaticArtifactKind;
  decision: "yes" | "no";
  reason: string;
  evidenceRef?: string;
};

export type WorkbenchAuthoringV5OptionalArtifactDraft = {
  draftId: string;
  kind: WorkbenchAutomaticArtifactKind;
  seedSessionId: string;
  provenanceSessionIds: string[];
  output: Record<string, unknown>;
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
  optionalConsiderations: WorkbenchAuthoringV5OptionalConsideration[];
  optionalArtifacts: WorkbenchAuthoringV5OptionalArtifactDraft[];
};

export type WorkbenchAuthoringV5AuthoredDraft = Omit<WorkbenchAuthoringV5Draft, "sessions"> & {
  sessions: Array<Pick<WorkbenchAuthoringV5Draft["sessions"][number], "sessionId" | "fields">>;
};

export function toWorkbenchAuthoringV5AuthoredDraft(
  draft: WorkbenchAuthoringV5Draft
): WorkbenchAuthoringV5AuthoredDraft {
  if (
    !draft || draft.bundleVersion !== WORKBENCH_AUTHORING_V5_VERSION ||
    typeof draft.packId !== "string" || !draft.packId.trim() ||
    typeof draft.evidenceRevision !== "string" || !draft.evidenceRevision.trim() ||
    !Array.isArray(draft.sessions) ||
    !Array.isArray(draft.optionalConsiderations) ||
    !Array.isArray(draft.optionalArtifacts) ||
    draft.sessions.some((session) => (
      !session || typeof session !== "object" || Array.isArray(session) ||
      typeof session.sessionId !== "string" || !session.sessionId.trim() ||
      !session.fields || typeof session.fields !== "object" || Array.isArray(session.fields)
    ))
  ) {
    throw new Error("invalid_workbench_authoring_v5_bundle");
  }
  return {
    bundleVersion: draft.bundleVersion,
    evidenceRevision: draft.evidenceRevision,
    optionalArtifacts: draft.optionalArtifacts,
    optionalConsiderations: draft.optionalConsiderations,
    packId: draft.packId,
    sessions: draft.sessions.map(({ fields, sessionId }) => ({ fields, sessionId }))
  };
}

export type WorkbenchAuthoringV5SessionOutcome = {
  sessionId: string;
  disposition: WorkbenchAuthoringV5Disposition;
  findings: Array<{ code: WorkbenchAuthoringV5FindingCode; message: string }>;
};

export type WorkbenchAuthoringV5PackReceipt = {
  receiptVersion: "workbench-authoring-v5-pack-receipt-v1";
  requestId: string;
  packId: string;
  draftRevision: number;
  evidenceRevision: string;
  outcomes: WorkbenchAuthoringV5SessionOutcome[];
  publishedArtifacts: Array<{ artifactId: string; kind: "session_dossier"; sessionIds: string[] }>;
  optionalArtifacts: Array<{
    artifactId: string;
    draftId: string;
    kind: WorkbenchAutomaticArtifactKind;
    sessionIds: string[];
  }>;
  optionalConsiderations: WorkbenchAuthoringV5OptionalConsideration[];
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

/** Runnable next-step payload embedded on non-final pack finish (does not auto-claim). */
export type WorkbenchAuthoringV5FollowUp = {
  kind: "start";
  command: string;
  reason: string;
};

export type WorkbenchAuthoringV5FinishResult = {
  receipt: WorkbenchAuthoringV5PackReceipt;
  nextAction: WorkbenchAuthoringV5NextAction;
  /** Present only when the full request completed on this finish. */
  requestReceipt?: WorkbenchAuthoringV5RequestReceipt;
  /**
   * Present when packs remain after finish. Mirrors nextAction.command as an explicit
   * start payload so agents can chain without inventing a new turn. Does not claim.
   */
  followUp?: WorkbenchAuthoringV5FollowUp;
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
