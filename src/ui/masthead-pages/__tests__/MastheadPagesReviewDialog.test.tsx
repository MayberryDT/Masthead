// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { MastheadPagesReviewDialog } from "../MastheadPagesReviewDialog";

describe("MastheadPagesReviewDialog", () => {
  test("orders destination, evidence, findings, preview, JSON, then confirmation", () => {
    const html = renderToStaticMarkup(
      <MastheadPagesReviewDialog
        open
        phase="finalized"
        title="Repair OAuth callback"
        artifactId="artifact-1"
        connection={{
          status: "connected",
          account: {
            protocolVersion: "masthead-pages-account-v1",
            accountId: "account-1",
            publisherAccess: "publisher",
            defaultLogbookVisibility: "discoverable"
          }
        }}
        logbooks={[
          {
            id: "logbook-1",
            ownerAccountId: "account-1",
            title: "Notes",
            slug: "notes",
            description: "",
            visibility: "discoverable",
            defaultLicense: "all-rights-reserved"
          }
        ]}
        publicLogbookId="logbook-1"
        license="cc-by-4.0"
        slug="repair-oauth-callback"
        evidenceCandidates={[
          {
            ref: "message:1",
            kind: "excerpt",
            role: "excerpt",
            text: "fixed callback",
            observedAt: "2026-08-11T00:00:00.000Z",
            label: "Callback",
            lowValue: false
          }
        ]}
        selectedEvidenceRefs={["message:1"]}
        sourceLinks={[]}
        includeSourceDate={false}
        acknowledgeWarnings={false}
        findings={[{ severity: "warn", code: "review_language", path: "/object", message: "check wording" }]}
        previewObject={{ title: "Repair OAuth callback" }}
        previewRequest={{ protocolVersion: "masthead-pages-publish-v1" }}
        decision="needs_review"
        canConfirmPublish={false}
        outcome={{ kind: "idle" }}
        onClose={() => undefined}
        onPublicLogbookIdChange={() => undefined}
        onLicenseChange={() => undefined}
        onSlugChange={() => undefined}
        onEvidenceChange={() => undefined}
        onIncludeSourceDateChange={() => undefined}
        onAcknowledgeWarningsChange={() => undefined}
        onFinalize={() => undefined}
        onConfirmPublish={() => undefined}
      />
    );

    const destination = html.indexOf("1. Destination");
    const evidence = html.indexOf("2. Content and evidence");
    const findings = html.indexOf("3. Findings");
    const preview = html.indexOf("4. Human preview");
    const json = html.indexOf("5. Complete JSON / request envelope");
    const confirm = html.indexOf("6. Confirmation");
    expect(destination).toBeGreaterThan(-1);
    expect(evidence).toBeGreaterThan(destination);
    expect(findings).toBeGreaterThan(evidence);
    expect(preview).toBeGreaterThan(findings);
    expect(json).toBeGreaterThan(preview);
    expect(confirm).toBeGreaterThan(json);
    expect(html).toContain("Publish to Masthead Pages");
    expect(html).toContain('disabled=""');
  });

  test("disables confirm for blocked decisions", () => {
    const onConfirm = vi.fn();
    const html = renderToStaticMarkup(
      <MastheadPagesReviewDialog
        open
        phase="finalized"
        logbooks={[]}
        publicLogbookId=""
        license="all-rights-reserved"
        slug="x"
        evidenceCandidates={[]}
        selectedEvidenceRefs={[]}
        sourceLinks={[]}
        includeSourceDate={false}
        acknowledgeWarnings={false}
        findings={[{ severity: "block", code: "secret", path: "/", message: "no" }]}
        decision="blocked"
        canConfirmPublish={false}
        outcome={{ kind: "idle" }}
        gate="blocked"
        onClose={() => undefined}
        onPublicLogbookIdChange={() => undefined}
        onLicenseChange={() => undefined}
        onSlugChange={() => undefined}
        onEvidenceChange={() => undefined}
        onIncludeSourceDateChange={() => undefined}
        onAcknowledgeWarningsChange={() => undefined}
        onFinalize={() => undefined}
        onConfirmPublish={onConfirm}
      />
    );

    expect(html).toContain("Publish to Masthead Pages");
    expect(html).toMatch(/disabled[^>]*>Publish to Masthead Pages/);
  });
});
