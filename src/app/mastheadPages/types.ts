import type { EgressFinding } from "../../mastheadPages/egressPreflight";
import type { MastheadPagesReleaseUiState, ReleaseMappingSnapshot } from "../../mastheadPages/releaseState";
import type {
  ObjectId,
  PageLicense,
  PublishPageBatchResultV1,
  PublishPageRequestV1,
  PublishPageResultV1,
  PublicLogbookSummaryV1,
  RemovePageResultV1,
  SourceLinkV1
} from "../../mastheadPages/types";
import type { MastheadPagesConnectionState } from "../desktopBridge";

export type MastheadPagesEvidenceCandidate = {
  ref: string;
  kind: string;
  role: string;
  text: string;
  observedAt: string;
  label?: string;
  lowValue: boolean;
  toolName?: string;
};

export type MastheadPagesEvidenceSelection = {
  ref: string;
  kind: "excerpt" | "verification";
  label: string;
  supports: string[];
};

export type ExistingReleaseSnapshot = ReleaseMappingSnapshot & {
  publicLogbookId?: string;
};

export type PreparedPageReviewItem = {
  artifactId: string;
  eligibility: "eligible" | "ineligible";
  ineligibilityReason?: string;
  evidenceCandidates: MastheadPagesEvidenceCandidate[];
  findings: EgressFinding[];
  title?: string;
  contentFingerprint?: string;
  lineageId?: string;
  baseObject?: unknown;
  existingRelease?: ExistingReleaseSnapshot;
};

export type FinalizedPageReviewItem = {
  artifactId: string;
  decision: "ready" | "needs_review" | "blocked";
  findings: EgressFinding[];
  request?: PublishPageRequestV1;
  requestDigest?: ObjectId;
  staged: boolean;
  existingRelease?: ExistingReleaseSnapshot;
};

export type MastheadPagesPublicationOutcome =
  | { kind: "idle" }
  | { kind: "publishing" }
  | { kind: "removing" }
  | {
      kind: "published";
      result: PublishPageResultV1;
      friendlyUrl?: string;
      exactUrl?: string;
      previousExactUrl?: string;
    }
  | {
      kind: "removed";
      result?: RemovePageResultV1;
      message?: string;
    }
  | {
      kind: "failed";
      message: string;
      retryable: boolean;
      code?: string;
      result?: PublishPageResultV1 | RemovePageResultV1;
      parentConflictObjectId?: string;
    };

export type MastheadPagesReviewPhase =
  | "closed"
  | "loading"
  | "editing"
  | "finalizing"
  | "finalized"
  | "publishing"
  | "removing"
  | "complete"
  | "error";

export type MastheadPagesReviewState = {
  phase: MastheadPagesReviewPhase;
  artifactId?: string;
  title?: string;
  connection?: MastheadPagesConnectionState;
  logbooks: PublicLogbookSummaryV1[];
  publicLogbookId: string;
  license: PageLicense;
  slug: string;
  selectedEvidenceRefs: string[];
  evidenceCandidates: MastheadPagesEvidenceCandidate[];
  sourceLinks: SourceLinkV1[];
  includeSourceDate: boolean;
  acknowledgeWarnings: boolean;
  prepareFindings: EgressFinding[];
  prepared?: PreparedPageReviewItem;
  finalized?: FinalizedPageReviewItem;
  releaseMapping?: ExistingReleaseSnapshot;
  releaseState: MastheadPagesReleaseUiState;
  confirmPublishLabel: string;
  removalConfirmOpen: boolean;
  outcome: MastheadPagesPublicationOutcome;
  error?: string;
  parentConflictObjectId?: string;
  gate?:
    | "desktop_unavailable"
    | "disconnected"
    | "secure_storage_unavailable"
    | "non_publisher"
    | "ineligible"
    | "blocked"
    | "needs_warning_ack"
    | "parent_conflict";
};

export type MastheadPagesBatchItemOutcome =
  | { kind: "idle" }
  | { kind: "published"; result: PublishPageResultV1; friendlyUrl?: string; exactUrl?: string }
  | { kind: "failed"; message: string; retryable: boolean; code?: string };

export type MastheadPagesBatchItem = {
  artifactId: string;
  title?: string;
  prepared?: PreparedPageReviewItem;
  finalized?: FinalizedPageReviewItem;
  selectedForPublish: boolean;
  contentFingerprint?: string;
  outcome: MastheadPagesBatchItemOutcome;
};

export type MastheadPagesBatchPhase =
  | "closed"
  | "loading"
  | "editing"
  | "finalizing"
  | "reviewing"
  | "publishing"
  | "complete"
  | "error";

export type MastheadPagesBatchState = {
  phase: MastheadPagesBatchPhase;
  artifactIds: string[];
  items: MastheadPagesBatchItem[];
  connection?: MastheadPagesConnectionState;
  logbooks: PublicLogbookSummaryV1[];
  publicLogbookId: string;
  license: PageLicense;
  acknowledgeWarnings: boolean;
  error?: string;
  gate?: MastheadPagesReviewState["gate"];
};

export type { PublishPageBatchResultV1, PublishPageRequestV1, PageLicense, SourceLinkV1, ObjectId };
