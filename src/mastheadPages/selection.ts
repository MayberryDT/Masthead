export type MastheadPagesSelectionResolverMode = "legacy" | "materialized";

export function parseMastheadPagesSelectionResolverMode(value: unknown): MastheadPagesSelectionResolverMode {
  return value === "materialized" ? "materialized" : "legacy";
}

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
