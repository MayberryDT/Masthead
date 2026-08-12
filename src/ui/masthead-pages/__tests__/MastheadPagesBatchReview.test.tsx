// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { MastheadPagesBatchState } from "../../../app/mastheadPages/types";
import { MastheadPagesBatchReview } from "../MastheadPagesBatchReview";

describe("MastheadPagesBatchReview", () => {
  test("groups Ready, Needs review, and Blocked and labels publish action", () => {
    const batch: MastheadPagesBatchState = {
      phase: "reviewing",
      artifactIds: ["a1", "a2", "a3"],
      publicLogbookId: "logbook-1",
      license: "all-rights-reserved",
      acknowledgeWarnings: false,
      logbooks: [
        {
          id: "logbook-1",
          ownerAccountId: "account-1",
          title: "Notes",
          slug: "notes",
          description: "",
          visibility: "discoverable",
          defaultLicense: "all-rights-reserved"
        }
      ],
      connection: {
        status: "connected",
        account: {
          protocolVersion: "masthead-pages-account-v1",
          accountId: "account-1",
          handle: "demo",
          publisherAccess: "publisher",
          defaultLogbookVisibility: "discoverable"
        }
      },
      items: [
        {
          artifactId: "a1",
          title: "Ready Page",
          selectedForPublish: true,
          outcome: { kind: "idle" },
          prepared: {
            artifactId: "a1",
            eligibility: "eligible",
            evidenceCandidates: [],
            findings: []
          },
          finalized: {
            artifactId: "a1",
            decision: "ready",
            findings: [],
            staged: true,
            requestDigest: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          }
        },
        {
          artifactId: "a2",
          title: "Needs Review Page",
          selectedForPublish: false,
          outcome: { kind: "idle" },
          prepared: {
            artifactId: "a2",
            eligibility: "eligible",
            evidenceCandidates: [],
            findings: []
          },
          finalized: {
            artifactId: "a2",
            decision: "needs_review",
            findings: [{ severity: "warn", code: "warn", path: "body", message: "check wording" }],
            staged: false
          }
        },
        {
          artifactId: "a3",
          title: "Blocked Page",
          selectedForPublish: false,
          outcome: { kind: "idle" },
          prepared: {
            artifactId: "a3",
            eligibility: "eligible",
            evidenceCandidates: [],
            findings: []
          },
          finalized: {
            artifactId: "a3",
            decision: "blocked",
            findings: [{ severity: "block", code: "secret", path: "body", message: "secret" }],
            staged: false
          }
        }
      ]
    };

    const html = renderToStaticMarkup(
      <MastheadPagesBatchReview
        open
        batch={batch}
        readyCount={1}
        onClose={() => undefined}
        onPublicLogbookIdChange={() => undefined}
        onLicenseChange={() => undefined}
        onAcknowledgeWarningsChange={() => undefined}
        onItemSelectedChange={() => undefined}
        onFinalize={() => undefined}
        onConfirmPublish={() => undefined}
      />
    );

    expect(html).toContain("Review 3 Pages");
    expect(html).toContain("Ready (1)");
    expect(html).toContain("Needs review (1)");
    expect(html).toContain("Blocked (1)");
    expect(html).toContain("Publish 1 to Masthead Pages");
    expect(html).toContain("Ready Page");
    expect(html).toContain("Needs Review Page");
    expect(html).toContain("Blocked Page");
  });

  test("hides when closed", () => {
    const html = renderToStaticMarkup(
      <MastheadPagesBatchReview
        open={false}
        batch={{
          phase: "closed",
          artifactIds: [],
          items: [],
          logbooks: [],
          publicLogbookId: "",
          license: "all-rights-reserved",
          acknowledgeWarnings: false
        }}
        readyCount={0}
        onClose={() => undefined}
        onPublicLogbookIdChange={() => undefined}
        onLicenseChange={() => undefined}
        onAcknowledgeWarningsChange={() => undefined}
        onItemSelectedChange={() => undefined}
        onFinalize={() => undefined}
        onConfirmPublish={() => undefined}
      />
    );
    expect(html).toBe("");
  });
});
