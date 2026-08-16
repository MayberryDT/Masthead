import { describe, expect, test, vi } from "vitest";
import type { PublishPageRequestV1 } from "../../../mastheadPages/types";
import {
  createBrowserReviewDesktopClient,
  isBrowserReviewPublishingEnabled,
} from "../browserReviewClient";

const request: PublishPageRequestV1 = {
  protocolVersion: "masthead-pages-publish-v1",
  publicLogbookId: "22222222-2222-4222-8222-222222222222",
  slug: "browser-review",
  idempotencyKey: "publish:artifact-1:review",
  objectId:
    "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  object: {
    schemaVersion: "masthead-page-revision-v1",
    kind: "session_dossier",
    title: "Browser review",
    summary: "Review browser publishing.",
    body: {
      outcome: "Ready for review.",
      keyWork: [],
      decisions: [],
      blockers: [],
      continuation: {
        nextStep: "Verify the sandbox receipt.",
        openQuestions: [],
        constraints: [],
      },
      warnings: [],
    },
    labels: { topics: [], technologies: [] },
    verification: {
      status: "passed",
      summary: "Verified.",
      checks: [],
      failures: [],
    },
    evidence: [],
    provenance: {
      sourceKind: "session_dossier",
      sourceSchema: "canonical-session-dossier-v1",
      sourceLinks: [],
    },
    license: "all-rights-reserved",
    generator: {
      name: "Masthead",
      version: "test",
      projection: "session-dossier-public-v1",
    },
  },
};

describe("browser review publishing", () => {
  test("requires both development mode and the explicit query flag", () => {
    expect(
      isBrowserReviewPublishingEnabled({ dev: false, search: "?pagesTest=1" }),
    ).toBe(false);
    expect(
      isBrowserReviewPublishingEnabled({ dev: true, search: "?polish=2" }),
    ).toBe(false);
    expect(
      isBrowserReviewPublishingEnabled({
        dev: true,
        search: "?polish=2&pagesTest=1",
      }),
    ).toBe(true);
  });

  test("simulates a connected publisher and itemized hosted receipts", async () => {
    const getPendingOperation = vi.fn().mockResolvedValue({
      operation: {
        operationKind: "publish",
        requestDigest: "sha256-request",
        requestJson: JSON.stringify(request),
      },
    });
    const client = createBrowserReviewDesktopClient({
      baseUrl: "http://review.test",
      getPendingOperation,
      now: () => "2026-08-16T12:00:00.000Z",
    });

    expect(client.browserReviewOnly).toBe(true);
    await expect(client.getConnection()).resolves.toMatchObject({
      status: "connected",
      account: { publisherAccess: "publisher" },
    });
    await expect(client.listPublicLogbooks()).resolves.toEqual([
      expect.objectContaining({
        id: "22222222-2222-4222-8222-222222222222",
        title: "Review sandbox",
      }),
    ]);
    await expect(
      client.publishStaged([
        { artifactId: "artifact-1", requestDigest: "sha256-request" },
      ]),
    ).resolves.toEqual({
      protocolVersion: "masthead-pages-publish-batch-result-v1",
      results: [
        expect.objectContaining({
          status: "published",
          idempotencyKey: request.idempotencyKey,
          objectId: request.objectId,
          publishedAt: "2026-08-16T12:00:00.000Z",
        }),
      ],
    });
    expect(getPendingOperation).toHaveBeenCalledWith(
      "artifact-1",
      "http://review.test",
    );
  });

  test("rejects staged references that do not match the daemon operation", async () => {
    const client = createBrowserReviewDesktopClient({
      baseUrl: "http://review.test",
      getPendingOperation: async () => ({
        operation: {
          operationKind: "publish",
          requestDigest: "sha256-other",
          requestJson: JSON.stringify(request),
        },
      }),
    });

    await expect(
      client.publishStaged([
        { artifactId: "artifact-1", requestDigest: "sha256-request" },
      ]),
    ).rejects.toThrow("browser_review_staged_digest_mismatch");
  });
});
