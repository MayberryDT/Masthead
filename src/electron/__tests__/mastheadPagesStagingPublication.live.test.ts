import { describe, expect, test } from "vitest";

import { runMastheadPagesStagingPublicationProof } from "../../../scripts/masthead-pages-staging-publication-proof.ts";

const enabled =
  process.env.MASTHEAD_PAGES_STAGING_PROOF === "1" ||
  process.env.npm_lifecycle_event === "smoke:masthead-pages:staging";

describe.runIf(enabled)("mastheadPagesStagingPublication live", () => {
  test(
    "publishes, verifies identity, revises, retries, and withdraws against staging",
    async () => {
      await runMastheadPagesStagingPublicationProof();
      expect(true).toBe(true);
    },
    300_000,
  );
});

describe.runIf(!enabled)("mastheadPagesStagingPublication live (skipped)", () => {
  test("set MASTHEAD_PAGES_STAGING_PROOF=1 or run npm run smoke:masthead-pages:staging", () => {
    expect(enabled).toBe(false);
  });
});
