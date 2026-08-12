import type { EgressFinding } from "../../mastheadPages/egressPreflight";
import type {
  ObjectId,
  PageLicense,
  PublishPageBatchResultV1,
  PublishPageRequestV1,
  PublishPageResultV1,
  PublicLogbookSummaryV1,
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
  existingRelease?: {
    pageId?: string;
    objectId?: string;
    publicLogbookId?: string;
    status?: string;
    friendlyUrl?: string;
    exactUrl?: string;
  };
};

export type FinalizedPageReviewItem = {
  artifactId: string;
  decision: "ready" | "needs_review" | "blocked";
  findings: EgressFinding[];
  request?: PublishPageRequestV1;
  requestDigest?: ObjectId;
  staged: boolean;
  existingRelease?: PreparedPageReviewItem["existingRelease"];
};

export type MastheadPagesPublicationOutcome =
  | { kind: "idle" }
  | { kind: "publishing" }
  | {
      kind: "published";
      result: PublishPageResultV1;
      friendlyUrl?: string;
      exactUrl?: string;
    }
  | {
      kind: "failed";
      message: string;
      retryable: boolean;
      code?: string;
      result?: PublishPageResultV1;
    };

export type MastheadPagesReviewPhase =
  | "closed"
  | "loading"
  | "editing"
  | "finalizing"
  | "finalized"
  | "publishing"
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
  outcome: MastheadPagesPublicationOutcome;
  error?: string;
  gate?:
    | "desktop_unavailable"
    | "disconnected"
    | "secure_storage_unavailable"
    | "non_publisher"
    | "ineligible"
    | "blocked"
    | "needs_warning_ack";
};

export type { PublishPageBatchResultV1, PublishPageRequestV1, PageLicense, SourceLinkV1, ObjectId };
