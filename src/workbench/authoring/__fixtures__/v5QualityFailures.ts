import { FAILED_V3_SUMMARY_PREFIX } from "./failedV3TemplateCampaign.ts";

/** Sanitized V3 output that repeatedly produced unsupported_completion revision loops in production. */
export const UNSUPPORTED_COMPLETION_THRASH_FIXTURE = {
  legacyFindingCode: "unsupported_completion",
  description: `${FAILED_V3_SUMMARY_PREFIX} canonical evidence was reviewed.`,
  purpose: "Canonical evidence records reviewed request.",
  keyWork: ["Canonical evidence records reviewed selected session."],
  keywords: [] as string[],
  verification: {
    status: "unknown" as const,
    summary: "Verification status was not available in the sampled evidence."
  }
};

export const COMPACTION_BANNER_FIXTURE =
  "<compaction_summary>Context was compacted before the agent resumed the current authoring pack.</compaction_summary>";

export const CRON_BOILERPLATE_FIXTURE =
  "The scheduled cron run completed and queued the next authoring batch.";
