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

/** Exact production-shaped outputs that must be rejected at the V5 save seam. */
export const S7_FALSE_GREEN_FIXTURES = {
  agentsContext: {
    description: "Worked on the request to AGENTS.md instructions for /home/tyler ## Skills A skill is a set of local instructions.",
    keywords: ["home", "tyler", "skills"],
    purpose: "Worked on the request to AGENTS.md instructions for /home/tyler ## Skills A skill is a set of local instructions.",
    title: "AGENTS.md instructions for /home/tyler ## Skills A skill is a set of local instructions"
  },
  conversationalFiller: {
    description: "Worked on the request to This is pretty good, but I think we can make it better.",
    keywords: ["pretty", "good", "think"],
    purpose: "Worked on the request to This is pretty good, but I think we can make it better.",
    title: "This is pretty good, but I think we can make it better"
  },
  environmentContext: {
    description: "Worked on the request to /home/tyler bash 2026-04-17 Asia/Tokyo.",
    keywords: ["shell investigation", "update plan", "write stdin", "home", "tyler", "bash", "asia"],
    purpose: "Worked on the request to /home/tyler bash 2026-04-17 Asia/Tokyo.",
    title: "Home/tyler bash 2026-04-17 Asia/Tokyo"
  }
} as const;

/** Production-remediation escapes that must fail even when the surrounding draft is valid. */
export const PRODUCTION_REMEDIATION_ESCAPE_FIXTURES = {
  addressedRequestDescription: "Addressed the recorded request by repairing OAuth callback state validation.",
  conversationalTitle: "Okay, that sounds better",
  implementationTitles: ["Implement the requested changes", "Please implement this"],
  truncatedRecommendedPluginsTitle:
    "<recommended_plugins> Here is a list of plugins that are available but not installed. - Atlassian Rovo"
} as const;
