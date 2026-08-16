export type MastheadPagesSelectionIncompleteReason =
  | "eligibility_backfill_incomplete"
  | "eligibility_evaluation_failed";

export type ResolveMastheadPagesSelectionResult =
  | {
      status: "complete";
      artifactIds: string[];
    }
  | {
      status: "incomplete";
      artifactIds: [];
      reason: MastheadPagesSelectionIncompleteReason;
      retryable: boolean;
    };
