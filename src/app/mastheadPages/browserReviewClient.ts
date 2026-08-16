import type {
  PublishPageRequestV1,
  PublicLogbookSummaryV1,
} from "../../mastheadPages/types";
import { getPendingMastheadPagesOperation } from "../daemonClient";
import type { MastheadPagesConnectionState } from "../desktopBridge";
import type { MastheadPagesDesktopClient } from "./desktopClient";

const reviewAccountId = "11111111-1111-4111-8111-111111111111";
const reviewLogbook: PublicLogbookSummaryV1 = {
  id: "22222222-2222-4222-8222-222222222222",
  ownerAccountId: reviewAccountId,
  title: "Review sandbox",
  slug: "review-sandbox",
  description: "Development-only browser publishing sandbox.",
  visibility: "unlisted",
  defaultLicense: "all-rights-reserved",
};
const reviewConnection: MastheadPagesConnectionState = {
  status: "connected",
  account: {
    protocolVersion: "masthead-pages-account-v1",
    accountId: reviewAccountId,
    handle: "browser-review",
    publisherAccess: "publisher",
    defaultLogbookVisibility: "unlisted",
  },
};

type BrowserReviewClientDeps = {
  baseUrl: string;
  getPendingOperation?: typeof getPendingMastheadPagesOperation;
  now?: () => string;
};

export function isBrowserReviewPublishingEnabled(input: {
  dev: boolean;
  search: string;
}): boolean {
  if (!input.dev) return false;
  return new URLSearchParams(input.search).get("pagesTest") === "1";
}

export function createBrowserReviewDesktopClient({
  baseUrl,
  getPendingOperation = getPendingMastheadPagesOperation,
  now = () => new Date().toISOString(),
}: BrowserReviewClientDeps): MastheadPagesDesktopClient {
  return {
    browserReviewOnly: true,
    getConnection: async () => reviewConnection,
    connect: async () => reviewConnection,
    disconnect: async () => undefined,
    listPublicLogbooks: async () => [reviewLogbook],
    createPublicLogbook: async (input) => ({
      ...reviewLogbook,
      title: input.title,
      slug: input.slug,
      description: input.description,
      visibility: input.visibility ?? reviewLogbook.visibility,
      defaultLicense: input.defaultLicense,
      companionUrl: input.companionUrl,
    }),
    chooseCover: async () => ({
      error: "Cover selection is unavailable in browser review mode.",
    }),
    clearCover: async () => undefined,
    uploadCover: async () => {
      throw new Error("browser_review_cover_upload_unavailable");
    },
    publishStaged: async (refs) => ({
      protocolVersion: "masthead-pages-publish-batch-result-v1",
      results: await Promise.all(
        refs.map(async (ref) => {
          const pending = asRecord(
            await getPendingOperation(ref.artifactId, baseUrl),
          );
          const operation = asRecord(pending.operation);
          if (operation.operationKind !== "publish") {
            throw new Error("browser_review_publish_operation_missing");
          }
          if (operation.requestDigest !== ref.requestDigest) {
            throw new Error("browser_review_staged_digest_mismatch");
          }
          const request = parsePublishRequest(operation.requestJson);
          const pageId = request.pageId ?? `review-${request.slug}`;
          return {
            status: "published" as const,
            idempotencyKey: request.idempotencyKey,
            pageId,
            objectId: request.objectId,
            parentObjectId: request.expectedParentObjectId,
            currentUrl: `https://review.masthead.invalid/pages/${encodeURIComponent(pageId)}`,
            exactRevisionUrl: `https://review.masthead.invalid/objects/${encodeURIComponent(request.objectId)}`,
            publishedAt: now(),
          };
        }),
      ),
    }),
    withdrawStaged: async () => {
      throw new Error("browser_review_withdrawal_unavailable");
    },
  };
}

function parsePublishRequest(value: unknown): PublishPageRequestV1 {
  if (typeof value !== "string")
    throw new Error("browser_review_publish_request_missing");
  const request = JSON.parse(value) as Partial<PublishPageRequestV1>;
  if (
    request.protocolVersion !== "masthead-pages-publish-v1" ||
    typeof request.idempotencyKey !== "string" ||
    typeof request.objectId !== "string" ||
    typeof request.slug !== "string"
  ) {
    throw new Error("browser_review_publish_request_invalid");
  }
  return request as PublishPageRequestV1;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
