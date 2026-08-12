export type MastheadPagesReleaseUiState =
  | "not_on_pages"
  | "preparing"
  | "needs_review"
  | "publishing"
  | "live"
  | "changed_locally"
  | "failed"
  | "removed";

export type ReleaseMappingStatus = "none" | "live" | "failed" | "removed";
export type ReleasePendingOperationKind = "publish" | "remove";

export type ReleaseMappingSnapshot = {
  status: ReleaseMappingStatus;
  localContentFingerprint?: string;
  pageId?: string;
  objectId?: string;
  parentObjectId?: string;
  friendlyUrl?: string;
  exactUrl?: string;
  pendingOperationKind?: ReleasePendingOperationKind;
  pendingRequestDigest?: string;
  pendingIdempotencyKey?: string;
  lastErrorClass?: string;
  lastErrorMessage?: string;
};

export type DeriveReleaseStateInput = {
  mapping?: ReleaseMappingSnapshot | null;
  currentFingerprint?: string;
  phase?: string;
  decision?: "ready" | "needs_review" | "blocked";
  outcomeKind?: string;
};

export const REMOVAL_HONEST_COPY =
  "Removing a Page from Masthead Pages withdraws the hosted listing. Downloaded, cached, imported, screenshotted, or quoted copies cannot be recalled.";

export const PARENT_CONFLICT_COPY =
  "Hosted Page has a newer revision. Refresh the local mapping and run outbound review again before publishing a new revision.";

export function deriveReleaseState(input: DeriveReleaseStateInput): MastheadPagesReleaseUiState {
  const phase = input.phase ?? "closed";
  if (phase === "loading" || phase === "finalizing" || phase === "editing") {
    if (phase === "loading" || phase === "finalizing") return "preparing";
  }
  if (phase === "publishing" || input.outcomeKind === "publishing") return "publishing";
  if (phase === "finalized" && input.decision === "needs_review") return "needs_review";

  const mapping = input.mapping;
  if (!mapping) return "not_on_pages";

  if (mapping.pendingOperationKind === "publish" || mapping.pendingOperationKind === "remove") {
    if (mapping.lastErrorClass) return "failed";
    if (phase === "publishing") return "publishing";
  }

  if (mapping.status === "removed") return "removed";
  if (mapping.status === "failed") return "failed";

  if (mapping.status === "live") {
    const current = input.currentFingerprint;
    if (current && mapping.localContentFingerprint && current !== mapping.localContentFingerprint) {
      return "changed_locally";
    }
    return "live";
  }

  if (mapping.pendingOperationKind === "publish" && mapping.lastErrorClass) return "failed";
  if (mapping.status === "none" && mapping.pendingOperationKind === "publish") {
    return mapping.lastErrorClass ? "failed" : "publishing";
  }

  return "not_on_pages";
}

export function isRevisionPublish(mapping?: ReleaseMappingSnapshot | null): boolean {
  if (!mapping?.pageId || !mapping.objectId) return false;
  return mapping.status === "live" || mapping.status === "failed" || mapping.status === "none";
}

export function confirmPublishLabel(mapping?: ReleaseMappingSnapshot | null, releaseState?: MastheadPagesReleaseUiState): string {
  if (releaseState === "changed_locally" || (mapping?.pageId && mapping.objectId && mapping.status === "live")) {
    return "Publish new revision";
  }
  if (mapping?.pageId && mapping.objectId && releaseState !== "removed" && releaseState !== "not_on_pages") {
    return "Publish new revision";
  }
  return "Publish to Masthead Pages";
}

export function releaseStateLabel(state: MastheadPagesReleaseUiState): string {
  switch (state) {
    case "not_on_pages":
      return "Not on Masthead Pages";
    case "preparing":
      return "Preparing review";
    case "needs_review":
      return "Needs review";
    case "publishing":
      return "Publishing";
    case "live":
      return "Live on Masthead Pages";
    case "changed_locally":
      return "Changed locally";
    case "failed":
      return "Publication failed";
    case "removed":
      return "Removed from Masthead Pages";
    default:
      return state;
  }
}

export function canRetryPendingPublication(mapping?: ReleaseMappingSnapshot | null): boolean {
  return (
    mapping?.pendingOperationKind === "publish" &&
    typeof mapping.pendingRequestDigest === "string" &&
    mapping.pendingRequestDigest.length > 0 &&
    Boolean(mapping.pendingIdempotencyKey)
  );
}

export function canRetryPendingRemoval(mapping?: ReleaseMappingSnapshot | null): boolean {
  return (
    mapping?.pendingOperationKind === "remove" &&
    typeof mapping.pendingRequestDigest === "string" &&
    mapping.pendingRequestDigest.length > 0 &&
    Boolean(mapping.pendingIdempotencyKey)
  );
}

export function canRemoveFromPages(mapping?: ReleaseMappingSnapshot | null): boolean {
  if (!mapping?.pageId) return false;
  if (mapping.status === "removed" && !mapping.pendingOperationKind) return false;
  return mapping.status === "live" || mapping.status === "failed" || mapping.pendingOperationKind === "remove";
}

export function parentConflictDisplay(currentObjectId?: string): { message: string; currentObjectId?: string } {
  return {
    message: PARENT_CONFLICT_COPY,
    ...(currentObjectId ? { currentObjectId } : {})
  };
}
