// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { MastheadPagesDesktopClient } from "../desktopClient";
import {
  useMastheadPagesController,
  type UseMastheadPagesControllerResult,
} from "../useMastheadPagesController";
import type { PublishPageRequestV1 } from "../../../mastheadPages/types";
import { sha256CanonicalRequest } from "../requestDigest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const baseUrl = "http://127.0.0.1:17373/projection";
const artifactId = "artifact-1";

let container: HTMLDivElement | undefined;
let root: Root | undefined;
let latest: UseMastheadPagesControllerResult | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  latest = undefined;
  vi.clearAllMocks();
});

describe("useMastheadPagesController", () => {
  test("does not call the hosted client while preparing and editing a review", async () => {
    const desktopClient = mockDesktopClient();
    const prepareReviews = vi.fn().mockResolvedValue({
      ok: true,
      items: [eligiblePrepared()],
    });
    const request = await sampleRequest();
    const digest = await sha256CanonicalRequest(request);
    const finalizeReviews = vi.fn().mockResolvedValue({
      ok: true,
      items: [readyFinalized(request, digest)],
    });
    await renderController({ desktopClient, prepareReviews, finalizeReviews });

    await act(async () => {
      await latest?.openSingleReview(artifactId);
    });
    await act(async () => {
      latest?.setLicense("cc-by-4.0");
      latest?.selectEvidence(["message:1"]);
      await latest?.finalizeReview();
    });

    expect(prepareReviews).toHaveBeenCalled();
    expect(finalizeReviews).toHaveBeenCalled();
    expect(desktopClient.publishStaged).not.toHaveBeenCalled();
  });

  test("uses a valid public section for default batch evidence", async () => {
    const desktopClient = mockDesktopClient();
    const prepareReviews = vi
      .fn()
      .mockResolvedValue({ ok: true, items: [eligiblePrepared()] });
    const request = await sampleRequest();
    const digest = await sha256CanonicalRequest(request);
    const finalizeReviews = vi.fn().mockResolvedValue({
      ok: true,
      items: [readyFinalized(request, digest)],
    });
    await renderController({ desktopClient, prepareReviews, finalizeReviews });

    await act(async () => {
      await latest?.openBatchReview([artifactId]);
    });
    await act(async () => {
      await latest?.finalizeBatchReview();
    });

    expect(finalizeReviews).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            evidenceSelections: [
              expect.objectContaining({ supports: ["outcome"] }),
            ],
          }),
        ],
      }),
      baseUrl,
    );
  });

  test("records batch parent conflicts as non-retryable and clears the staged operation", async () => {
    const request = await sampleRequest();
    const digest = await sha256CanonicalRequest(request);
    const hostedCurrent =
      "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const desktopClient = mockDesktopClient({
      publishStaged: vi.fn().mockResolvedValue({
        protocolVersion: "masthead-pages-publish-batch-result-v1",
        results: [{
          status: "conflict",
          idempotencyKey: request.idempotencyKey,
          code: "parent-conflict",
          retryable: true,
          message: "stale parent",
          currentObjectId: hostedCurrent,
        }],
      }),
    });
    const recordResults = vi.fn().mockResolvedValue({ ok: true });
    await renderController({
      desktopClient,
      prepareReviews: vi.fn().mockResolvedValue({ ok: true, items: [eligiblePrepared()] }),
      finalizeReviews: vi.fn().mockResolvedValue({ ok: true, items: [readyFinalized(request, digest)] }),
      recordResults,
    });

    await act(async () => {
      await latest?.openBatchReview([artifactId]);
    });
    await flushController();
    await act(async () => {
      await latest?.finalizeBatchReview();
    });
    await flushController();
    await act(async () => {
      await latest?.confirmBatchPublish();
    });
    await flushController();

    expect(recordResults).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "failure",
        failure: expect.objectContaining({
          errorClass: "parent-conflict",
          retryable: false,
          currentObjectId: hostedCurrent,
        }),
      }),
      baseUrl,
    );
    expect(latest?.batchState.items[0]?.outcome).toEqual(
      expect.objectContaining({ kind: "failed", retryable: false }),
    );
  });

  test("falls back when a prior release references an unavailable Public Logbook", async () => {
    const desktopClient = mockDesktopClient();
    const prepared = {
      ...eligiblePrepared(),
      existingRelease: { publicLogbookId: "deleted-logbook" },
    };
    const prepareReviews = vi
      .fn()
      .mockResolvedValue({ ok: true, items: [prepared] });
    await renderController({ desktopClient, prepareReviews });

    await act(async () => {
      await latest?.openBatchReview([artifactId]);
    });
    expect(latest?.batchState.publicLogbookId).toBe("logbook-1");

    await act(async () => {
      latest?.closeBatchReview();
      await latest?.openSingleReview(artifactId);
    });
    expect(latest?.state.publicLogbookId).toBe("logbook-1");
  });

  test("blocks when desktop bridge is unavailable", async () => {
    const desktopClient = mockDesktopClient();
    await renderController({
      desktopClient,
      desktopAvailable: () => false,
    });

    await act(async () => {
      await latest?.openSingleReview(artifactId);
    });

    expect(latest?.state.gate).toBe("desktop_unavailable");
    expect(desktopClient.publishStaged).not.toHaveBeenCalled();
  });

  test("blocks disconnected accounts before hosted transfer", async () => {
    const desktopClient = mockDesktopClient({
      getConnection: vi.fn(async () => ({ status: "disconnected" as const })),
    });
    await renderController({ desktopClient });

    await act(async () => {
      await latest?.openSingleReview(artifactId);
    });

    expect(latest?.state.gate).toBe("disconnected");
    expect(desktopClient.publishStaged).not.toHaveBeenCalled();
  });

  test("blocks non-publisher accounts", async () => {
    const desktopClient = mockDesktopClient({
      getConnection: vi.fn(async () => connectedAccount("request_required")),
    });
    await renderController({ desktopClient });

    await act(async () => {
      await latest?.openSingleReview(artifactId);
    });

    expect(latest?.state.gate).toBe("non_publisher");
    expect(desktopClient.publishStaged).not.toHaveBeenCalled();
  });

  test("surfaces ineligible artifacts without publish", async () => {
    const desktopClient = mockDesktopClient();
    const prepareReviews = vi.fn().mockResolvedValue({
      ok: true,
      items: [
        {
          artifactId,
          eligibility: "ineligible",
          ineligibilityReason: "current_enrichment_required",
          evidenceCandidates: [],
          findings: [],
        },
      ],
    });
    await renderController({ desktopClient, prepareReviews });

    await act(async () => {
      await latest?.openSingleReview(artifactId);
    });

    expect(latest?.state.gate).toBe("ineligible");
    expect(desktopClient.publishStaged).not.toHaveBeenCalled();
  });

  test("keeps blocked reviews offline", async () => {
    const desktopClient = mockDesktopClient();
    const request = await sampleRequest();
    const prepareReviews = vi
      .fn()
      .mockResolvedValue({ ok: true, items: [eligiblePrepared()] });
    const finalizeReviews = vi.fn().mockResolvedValue({
      ok: true,
      items: [
        {
          artifactId,
          decision: "blocked",
          findings: [
            {
              severity: "block",
              code: "secret",
              path: "/object",
              message: "blocked",
            },
          ],
          request,
          requestDigest: await sha256CanonicalRequest(request),
          staged: false,
        },
      ],
    });
    await renderController({ desktopClient, prepareReviews, finalizeReviews });

    await act(async () => {
      await latest?.openSingleReview(artifactId);
    });
    await flushController();
    await act(async () => {
      await latest?.finalizeReview();
    });
    await flushController();

    expect(finalizeReviews).toHaveBeenCalled();
    expect(latest?.state.gate).toBe("blocked");
    expect(latest?.canConfirmPublish).toBe(false);
    expect(desktopClient.publishStaged).not.toHaveBeenCalled();
  });

  test("requires warning acknowledgement before confirmation", async () => {
    const desktopClient = mockDesktopClient();
    const request = await sampleRequest();
    const prepareReviews = vi
      .fn()
      .mockResolvedValue({ ok: true, items: [eligiblePrepared()] });
    const finalizeReviews = vi.fn().mockResolvedValue({
      ok: true,
      items: [
        {
          artifactId,
          decision: "needs_review",
          findings: [
            {
              severity: "warn",
              code: "review_language",
              path: "/object",
              message: "check",
            },
          ],
          request,
          requestDigest: await sha256CanonicalRequest(request),
          staged: false,
        },
      ],
    });
    await renderController({ desktopClient, prepareReviews, finalizeReviews });

    await act(async () => {
      await latest?.openSingleReview(artifactId);
    });
    await flushController();
    await act(async () => {
      await latest?.finalizeReview();
    });
    await flushController();

    expect(latest?.state.gate).toBe("needs_warning_ack");
    expect(latest?.canConfirmPublish).toBe(false);
    expect(desktopClient.publishStaged).not.toHaveBeenCalled();
  });

  test("publishes only staged refs after confirmation and records success", async () => {
    const desktopClient = mockDesktopClient();
    const request = await sampleRequest();
    const digest = await sha256CanonicalRequest(request);
    const prepareReviews = vi
      .fn()
      .mockResolvedValue({ ok: true, items: [eligiblePrepared()] });
    const finalizeReviews = vi.fn().mockResolvedValue({
      ok: true,
      items: [readyFinalized(request, digest)],
    });
    const recordResults = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(desktopClient.publishStaged).mockResolvedValue({
      protocolVersion: "masthead-pages-publish-batch-result-v1",
      results: [
        {
          status: "published",
          idempotencyKey: request.idempotencyKey,
          pageId: "page_1",
          objectId: request.objectId,
          currentUrl: "https://masthead.page/u/demo/notes/page",
          exactRevisionUrl: "https://masthead.page/r/obj",
          publishedAt: "2026-08-11T00:00:00.000Z",
        },
      ],
    });

    await renderController({
      desktopClient,
      prepareReviews,
      finalizeReviews,
      recordResults,
    });

    await act(async () => {
      await latest?.openSingleReview(artifactId);
    });
    await flushController();
    await act(async () => {
      latest?.setLicense("cc-by-4.0");
      latest?.selectEvidence(["message:1"]);
      await latest?.finalizeReview();
    });
    await flushController();
    await act(async () => {
      await latest?.confirmPublish();
    });
    await flushController();

    expect(desktopClient.publishStaged).toHaveBeenCalledTimes(1);
    expect(desktopClient.publishStaged).toHaveBeenCalledWith([
      { artifactId, requestDigest: digest },
    ]);
    expect(recordResults).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "publication",
        receipt: expect.objectContaining({
          artifactId,
          pageId: "page_1",
          friendlyUrl: "https://masthead.page/u/demo/notes/page",
        }),
      }),
      baseUrl,
    );
    expect(latest?.state.phase).toBe("complete");
    expect(latest?.state.outcome.kind).toBe("published");
  });

  test("labels and stages a revision when an existing live mapping is present", async () => {
    const desktopClient = mockDesktopClient();
    const request = await sampleRequest();
    request.pageId = "page-live";
    request.expectedParentObjectId =
      "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const digest = await sha256CanonicalRequest(request);
    const prepareReviews = vi.fn().mockResolvedValue({
      ok: true,
      items: [
        {
          ...eligiblePrepared(),
          contentFingerprint: "fp-new",
          existingRelease: {
            status: "live",
            pageId: "page-live",
            objectId:
              "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            publicLogbookId: "logbook-1",
            localContentFingerprint: "fp-old",
            friendlyUrl: "https://masthead.page/u/demo/notes/page",
            exactUrl: "https://masthead.page/r/old",
          },
        },
      ],
    });
    const finalizeReviews = vi.fn().mockResolvedValue({
      ok: true,
      items: [readyFinalized(request, digest)],
    });
    vi.mocked(desktopClient.publishStaged).mockResolvedValue({
      protocolVersion: "masthead-pages-publish-batch-result-v1",
      results: [
        {
          status: "published",
          idempotencyKey: request.idempotencyKey,
          pageId: "page-live",
          objectId:
            "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          parentObjectId: request.expectedParentObjectId,
          currentUrl: "https://masthead.page/u/demo/notes/page",
          exactRevisionUrl: "https://masthead.page/r/new",
          publishedAt: "2026-08-11T00:00:00.000Z",
        },
      ],
    });
    const recordResults = vi.fn().mockResolvedValue({ ok: true });
    await renderController({
      desktopClient,
      prepareReviews,
      finalizeReviews,
      recordResults,
    });

    await act(async () => {
      await latest?.openSingleReview(artifactId);
    });
    await flushController();
    expect(latest?.state.releaseState).toBe("changed_locally");
    expect(latest?.state.confirmPublishLabel).toBe("Publish new revision");

    await act(async () => {
      await latest?.finalizeReview();
    });
    await flushController();
    await act(async () => {
      await latest?.confirmPublish();
    });
    await flushController();

    expect(latest?.state.outcome.kind).toBe("published");
    if (latest?.state.outcome.kind === "published") {
      expect(latest.state.outcome.previousExactUrl).toBe(
        "https://masthead.page/r/old",
      );
      expect(latest.state.outcome.exactUrl).toBe("https://masthead.page/r/new");
      expect(latest.state.outcome.friendlyUrl).toBe(
        "https://masthead.page/u/demo/notes/page",
      );
    }
  });

  test("replays staged publication after timeout with the same digest", async () => {
    const desktopClient = mockDesktopClient();
    const request = await sampleRequest();
    const digest = await sha256CanonicalRequest(request);
    const getPendingOperation = vi.fn().mockResolvedValue({
      operation: {
        operationKind: "publish",
        requestDigest: digest,
        idempotencyKey: request.idempotencyKey,
        requestJson: JSON.stringify(request),
      },
    });
    vi.mocked(desktopClient.publishStaged).mockResolvedValue({
      protocolVersion: "masthead-pages-publish-batch-result-v1",
      results: [
        {
          status: "idempotent-replay",
          idempotencyKey: request.idempotencyKey,
          pageId: "page_1",
          objectId: request.objectId,
          currentUrl: "https://masthead.page/u/demo/notes/page",
          exactRevisionUrl: "https://masthead.page/r/obj",
          publishedAt: "2026-08-11T00:00:00.000Z",
        },
      ],
    });
    const recordResults = vi.fn().mockResolvedValue({ ok: true });
    await renderController({
      desktopClient,
      prepareReviews: vi
        .fn()
        .mockResolvedValue({ ok: true, items: [eligiblePrepared()] }),
      getPendingOperation,
      recordResults,
    });

    await act(async () => {
      await latest?.openSingleReview(artifactId);
    });
    await flushController();
    await act(async () => {
      await latest?.retryPendingPublication(artifactId);
    });
    await flushController();

    expect(getPendingOperation).toHaveBeenCalledWith(artifactId, baseUrl);
    expect(desktopClient.publishStaged).toHaveBeenCalledWith([
      { artifactId, requestDigest: digest },
    ]);
    expect(latest?.state.phase).toBe("complete");
    expect(latest?.state.outcome.kind).toBe("published");
  });

  test("parent conflict records hosted object id and requires refresh rather than overwrite", async () => {
    const desktopClient = mockDesktopClient();
    const request = await sampleRequest();
    request.pageId = "page-live";
    request.expectedParentObjectId =
      "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const digest = await sha256CanonicalRequest(request);
    const hostedCurrent =
      "sha256-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const prepareReviews = vi.fn().mockResolvedValue({
      ok: true,
      items: [
        {
          ...eligiblePrepared(),
          existingRelease: {
            status: "live",
            pageId: "page-live",
            objectId: request.expectedParentObjectId,
            localContentFingerprint: "fp-1",
            publicLogbookId: "logbook-1",
          },
        },
      ],
    });
    const finalizeReviews = vi.fn().mockResolvedValue({
      ok: true,
      items: [readyFinalized(request, digest)],
    });
    const recordResults = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(desktopClient.publishStaged).mockResolvedValue({
      protocolVersion: "masthead-pages-publish-batch-result-v1",
      results: [
        {
          status: "conflict",
          idempotencyKey: request.idempotencyKey,
          code: "parent-conflict",
          retryable: false,
          message: "stale parent",
          currentObjectId: hostedCurrent,
        },
      ],
    });
    await renderController({
      desktopClient,
      prepareReviews,
      finalizeReviews,
      recordResults,
    });

    await act(async () => {
      await latest?.openSingleReview(artifactId);
    });
    await flushController();
    await act(async () => {
      await latest?.finalizeReview();
    });
    await flushController();
    await act(async () => {
      await latest?.confirmPublish();
    });
    await flushController();

    expect(recordResults).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "failure",
        failure: expect.objectContaining({
          errorClass: "parent-conflict",
          currentObjectId: hostedCurrent,
          retryable: false,
        }),
      }),
      baseUrl,
    );
    expect(latest?.state.gate).toBe("parent_conflict");
    expect(latest?.state.parentConflictObjectId).toBe(hostedCurrent);
    expect(latest?.state.finalized).toBeUndefined();
    expect(latest?.canConfirmPublish).toBe(false);
  });

  test("stages removal and records success without claiming local erasure", async () => {
    const desktopClient = mockDesktopClient();
    const stageRemoval = vi.fn().mockResolvedValue({
      ok: true,
      requestDigest: "sha256-remove-digest",
      mapping: {
        status: "live",
        pageId: "page-live",
        pendingOperationKind: "remove",
        pendingRequestDigest: "sha256-remove-digest",
        pendingIdempotencyKey: "idem-remove",
      },
    });
    vi.mocked(desktopClient.withdrawStaged).mockResolvedValue({
      protocolVersion: "masthead-pages-remove-result-v1",
      pageId: "page-live",
      idempotencyKey: "idem-remove",
      status: "removed",
      removedAt: "2026-08-11T12:00:00.000Z",
      retryable: false,
    });
    const recordResults = vi.fn().mockResolvedValue({ ok: true });
    await renderController({
      desktopClient,
      prepareReviews: vi.fn().mockResolvedValue({
        ok: true,
        items: [
          {
            ...eligiblePrepared(),
            existingRelease: {
              status: "live",
              pageId: "page-live",
              objectId:
                "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              localContentFingerprint: "fp-1",
              friendlyUrl: "https://masthead.page/u/demo/notes/page",
            },
          },
        ],
      }),
      stageRemoval,
      recordResults,
    });

    await act(async () => {
      await latest?.openSingleReview(artifactId, {
        openRemovalConfirmation: true,
      });
    });
    await flushController();
    expect(latest?.state.removalConfirmOpen).toBe(true);
    await act(async () => {
      await latest?.confirmRemoval();
    });
    await flushController();

    expect(stageRemoval).toHaveBeenCalledWith({ artifactId }, baseUrl);
    expect(desktopClient.withdrawStaged).toHaveBeenCalledWith({
      artifactId,
      requestDigest: "sha256-remove-digest",
    });
    expect(recordResults).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "removed", artifactId }),
      baseUrl,
    );
    expect(latest?.state.outcome.kind).toBe("removed");
    expect(latest?.state.releaseState).toBe("removed");
  });

  test("replays staged removal after timeout with the same digest", async () => {
    const desktopClient = mockDesktopClient();
    const getPendingOperation = vi.fn().mockResolvedValue({
      operation: {
        operationKind: "remove",
        requestDigest: "sha256-remove-retry",
        idempotencyKey: "idem-remove-retry",
      },
    });
    vi.mocked(desktopClient.withdrawStaged).mockResolvedValue({
      protocolVersion: "masthead-pages-remove-result-v1",
      pageId: "page-live",
      idempotencyKey: "idem-remove-retry",
      status: "idempotent-replay",
      removedAt: "2026-08-11T12:00:00.000Z",
      retryable: false,
    });
    const recordResults = vi.fn().mockResolvedValue({ ok: true });
    const stageRemoval = vi.fn();
    await renderController({
      desktopClient,
      prepareReviews: vi.fn().mockResolvedValue({
        ok: true,
        items: [
          {
            ...eligiblePrepared(),
            existingRelease: {
              status: "live",
              pageId: "page-live",
              objectId:
                "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              pendingOperationKind: "remove",
              pendingRequestDigest: "sha256-remove-retry",
              pendingIdempotencyKey: "idem-remove-retry",
            },
          },
        ],
      }),
      getPendingOperation,
      stageRemoval,
      recordResults,
    });

    await act(async () => {
      await latest?.openSingleReview(artifactId);
    });
    await flushController();
    await act(async () => {
      await latest?.retryPendingRemoval(artifactId);
    });
    await flushController();

    expect(getPendingOperation).toHaveBeenCalled();
    expect(stageRemoval).not.toHaveBeenCalled();
    expect(desktopClient.withdrawStaged).toHaveBeenCalledWith({
      artifactId,
      requestDigest: "sha256-remove-retry",
    });
    expect(latest?.state.outcome.kind).toBe("removed");
  });

  test("records hosted failure without claiming local Logbook mutation", async () => {
    const desktopClient = mockDesktopClient();
    const request = await sampleRequest();
    const digest = await sha256CanonicalRequest(request);
    const prepareReviews = vi
      .fn()
      .mockResolvedValue({ ok: true, items: [eligiblePrepared()] });
    const finalizeReviews = vi.fn().mockResolvedValue({
      ok: true,
      items: [readyFinalized(request, digest)],
    });
    const recordResults = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(desktopClient.publishStaged).mockResolvedValue({
      protocolVersion: "masthead-pages-publish-batch-result-v1",
      results: [
        {
          status: "retryable-failure",
          idempotencyKey: request.idempotencyKey,
          code: "temporarily-unavailable",
          retryable: true,
          message: "hosted down",
        },
      ],
    });

    await renderController({
      desktopClient,
      prepareReviews,
      finalizeReviews,
      recordResults,
    });

    await act(async () => {
      await latest?.openSingleReview(artifactId);
    });
    await flushController();
    await act(async () => {
      await latest?.finalizeReview();
    });
    await flushController();
    await act(async () => {
      await latest?.confirmPublish();
    });
    await flushController();

    expect(recordResults).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "failure",
        failure: expect.objectContaining({
          artifactId,
          retryable: true,
          message: "hosted down",
        }),
      }),
      baseUrl,
    );
    expect(latest?.state.phase).toBe("finalized");
    expect(latest?.state.outcome.kind).toBe("failed");
  });
});

async function renderController(deps: {
  desktopClient: MastheadPagesDesktopClient;
  desktopAvailable?: () => boolean;
  prepareReviews?: ReturnType<typeof vi.fn>;
  finalizeReviews?: ReturnType<typeof vi.fn>;
  recordResults?: ReturnType<typeof vi.fn>;
  stageRemoval?: ReturnType<typeof vi.fn>;
  getPendingOperation?: ReturnType<typeof vi.fn>;
}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  function Harness() {
    const controller = useMastheadPagesController({
      baseUrl,
      desktopClient: deps.desktopClient,
      desktopAvailable: deps.desktopAvailable ?? (() => true),
      prepareReviews: deps.prepareReviews as never,
      finalizeReviews: deps.finalizeReviews as never,
      recordResults: deps.recordResults as never,
      stageRemoval: deps.stageRemoval as never,
      getPendingOperation: deps.getPendingOperation as never,
    });
    latest = controller;
    useEffect(() => {
      latest = controller;
    });
    return null;
  }

  await act(async () => {
    root?.render(<Harness />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function flushController() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mockDesktopClient(
  overrides: Partial<MastheadPagesDesktopClient> = {},
): MastheadPagesDesktopClient {
  return {
    getConnection: vi.fn(async () => connectedAccount("publisher")),
    connect: vi.fn(async () => connectedAccount("publisher")),
    disconnect: vi.fn(async () => undefined),
    listPublicLogbooks: vi.fn(async () => [
      {
        id: "logbook-1",
        ownerAccountId: "account-1",
        title: "Notes",
        slug: "notes",
        description: "",
        visibility: "discoverable" as const,
        defaultLicense: "all-rights-reserved" as const,
      },
    ]),
    createPublicLogbook: vi.fn(),
    chooseCover: vi.fn(async () => ({ canceled: true as const })),
    clearCover: vi.fn(async () => undefined),
    uploadCover: vi.fn(async () => ({
      protocolVersion: "masthead-pages-cover-result-v1" as const,
      coverVersion: "cover-1",
    })),
    publishStaged: vi.fn(async () => ({
      protocolVersion: "masthead-pages-publish-batch-result-v1" as const,
      results: [],
    })),
    withdrawStaged: vi.fn(),
    ...overrides,
  };
}

function connectedAccount(
  publisherAccess: "publisher" | "request_required" | "requested" | "suspended",
) {
  return {
    status: "connected" as const,
    account: {
      protocolVersion: "masthead-pages-account-v1" as const,
      accountId: "account-1",
      handle: "demo",
      publisherAccess,
      defaultLogbookVisibility: "discoverable" as const,
    },
  };
}

function eligiblePrepared() {
  return {
    artifactId,
    eligibility: "eligible",
    title: "Repair OAuth callback",
    contentFingerprint: "fp-1",
    evidenceCandidates: [
      {
        ref: "message:1",
        kind: "excerpt",
        role: "excerpt",
        text: "fixed the callback",
        observedAt: "2026-08-11T00:00:00.000Z",
        label: "Callback fix",
        lowValue: false,
      },
    ],
    findings: [],
  };
}

async function sampleRequest(): Promise<PublishPageRequestV1> {
  return {
    protocolVersion: "masthead-pages-publish-v1",
    publicLogbookId: "logbook-1",
    slug: "repair-oauth-callback",
    idempotencyKey: "idem-1",
    objectId:
      "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    object: {
      schemaVersion: "masthead-page-revision-v1",
      kind: "session_dossier",
      title: "Repair OAuth callback",
      summary: "Fixed callback handling",
      body: {
        keyWork: ["Fixed callback"],
        decisions: [],
        blockers: [],
        continuation: { openQuestions: [], constraints: [] },
        warnings: [],
      },
      labels: { topics: [], technologies: [] },
      verification: {
        status: "passed",
        summary: "ok",
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
        version: "0.1.15",
        projection: "session-dossier-public-v1",
      },
    },
  };
}

function readyFinalized(request: PublishPageRequestV1, digest: string) {
  return {
    artifactId,
    decision: "ready" as const,
    findings: [],
    request,
    requestDigest: digest,
    staged: true,
  };
}
