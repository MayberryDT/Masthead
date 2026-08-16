import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import {
  assertStagedRefsOnly,
  loadStagedPublishBatch,
  loadStagedRemoval,
  type DaemonPendingOperation
} from "../mastheadPagesStagedOperations";
import { computePageObjectId } from "../../mastheadPages/objectIdentity";
import { sha256CanonicalRequest } from "../../mastheadPages/review";
import type { PageRevisionV1, PublishPageRequestV1, RemovePageRequestV1 } from "../../mastheadPages/types";

const fixturePage = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../../schemas/masthead-pages/v1/fixtures/page-revision/complete.valid.json"),
    "utf8"
  )
) as PageRevisionV1;

const publishRequest: PublishPageRequestV1 = {
  protocolVersion: "masthead-pages-publish-v1",
  publicLogbookId: "11111111-1111-4111-8111-111111111111",
  slug: "demo-page",
  idempotencyKey: "idem-key-0001",
  objectId: computePageObjectId(fixturePage),
  object: fixturePage
};

const removeRequest: RemovePageRequestV1 = {
  protocolVersion: "masthead-pages-remove-v1",
  pageId: "22222222-2222-4222-8222-222222222222",
  idempotencyKey: "idem-remove-1"
};

function digest(request: PublishPageRequestV1 | RemovePageRequestV1): string {
  return sha256CanonicalRequest(request);
}

describe("mastheadPagesStagedOperations", () => {
  test("rejects raw Page objects over publication IPC", () => {
    expect(() =>
      assertStagedRefsOnly(
        {
          refs: [{ artifactId: "a1", requestDigest: "sha256-abc" }],
          object: publishRequest.object
        },
        "publish"
      )
    ).toThrow(/forbidden_field:object|raw_page_object/);
  });

  test("rejects hosted envelopes and remote page IDs over IPC", () => {
    expect(() =>
      assertStagedRefsOnly(
        {
          refs: [{ artifactId: "a1", requestDigest: "sha256-abc" }],
          pageId: "page_remote_1"
        },
        "publish"
      )
    ).toThrow(/forbidden_field:pageId/);

    expect(() =>
      assertStagedRefsOnly(
        {
          refs: [{ artifactId: "a1", requestDigest: "sha256-abc" }],
          request: publishRequest
        },
        "publish"
      )
    ).toThrow(/forbidden_field:request|hosted_envelope/);

    expect(() =>
      assertStagedRefsOnly(
        {
          refs: [{ artifactId: "a1", requestDigest: "sha256-abc" }],
          refreshToken: "secret"
        },
        "remove"
      )
    ).toThrow(/forbidden_field:refreshToken/);
  });

  test("rejects duplicate artifact refs", () => {
    expect(() =>
      assertStagedRefsOnly(
        {
          refs: [
            { artifactId: "a1", requestDigest: "sha256-abc" },
            { artifactId: "a1", requestDigest: "sha256-def" }
          ]
        },
        "publish"
      )
    ).toThrow(/duplicate_artifact/);
  });

  test("rejects missing stages before network", async () => {
    const fetchPending = vi.fn(async () => undefined);
    const refs = assertStagedRefsOnly({ refs: [{ artifactId: "a1", requestDigest: "sha256-abc" }] }, "publish");
    await expect(loadStagedPublishBatch(refs, fetchPending)).rejects.toThrow("staged_missing");
    expect(fetchPending).toHaveBeenCalledWith("a1");
  });

  test("rejects renderer and daemon digest mismatches independently", async () => {
    const requestJson = JSON.stringify(publishRequest);
    const canonicalDigest = digest(publishRequest);
    const pending: DaemonPendingOperation = {
      sourceArtifactId: "a1",
      operationKind: "publish",
      requestJson,
      requestDigest: canonicalDigest,
      idempotencyKey: "idem-key-0001"
    };
    await expect(
      loadStagedPublishBatch([{ artifactId: "a1", requestDigest: "sha256-deadbeef" }], async () => pending)
    ).rejects.toThrow("staged_digest_mismatch");

    await expect(
      loadStagedPublishBatch([{ artifactId: "a1", requestDigest: canonicalDigest }], async () => ({
        ...pending,
        requestDigest: "sha256-deadbeef"
      }))
    ).rejects.toThrow("staged_digest_mismatch");

    const canonicalRemovalDigest = digest(removeRequest);
    const pendingRemoval: DaemonPendingOperation = {
      sourceArtifactId: "a1",
      operationKind: "remove",
      requestJson: JSON.stringify(removeRequest),
      requestDigest: canonicalRemovalDigest,
      idempotencyKey: removeRequest.idempotencyKey
    };
    await expect(
      loadStagedRemoval({ artifactId: "a1", requestDigest: "sha256-deadbeef" }, async () => pendingRemoval)
    ).rejects.toThrow("staged_digest_mismatch");
    await expect(
      loadStagedRemoval({ artifactId: "a1", requestDigest: canonicalRemovalDigest }, async () => ({
        ...pendingRemoval,
        requestDigest: "sha256-deadbeef"
      }))
    ).rejects.toThrow("staged_digest_mismatch");
  });

  test("rejects parsed mutation, unsupported schema, idempotency inconsistency, and wrong operation kind", async () => {
    const canonicalDigest = digest(publishRequest);
    const basePending: DaemonPendingOperation = {
      sourceArtifactId: "a1",
      operationKind: "publish",
      requestJson: JSON.stringify(publishRequest),
      requestDigest: canonicalDigest,
      idempotencyKey: publishRequest.idempotencyKey
    };

    await expect(
      loadStagedPublishBatch([{ artifactId: "a1", requestDigest: canonicalDigest }], async () => ({
        ...basePending,
        requestJson: JSON.stringify({ ...publishRequest, slug: "mutated-page" })
      }))
    ).rejects.toThrow("staged_digest_mismatch");

    await expect(
      loadStagedPublishBatch([{ artifactId: "a1", requestDigest: canonicalDigest }], async () => ({
        ...basePending,
        requestJson: JSON.stringify({ ...publishRequest, protocolVersion: "masthead-pages-publish-v0" })
      }))
    ).rejects.toThrow("staged_invalid_publish_request");

    await expect(
      loadStagedPublishBatch([{ artifactId: "a1", requestDigest: canonicalDigest }], async () => ({
        ...basePending,
        idempotencyKey: "different-idempotency-key"
      }))
    ).rejects.toThrow("staged_idempotency_mismatch");

    await expect(
      loadStagedRemoval({ artifactId: "a1", requestDigest: canonicalDigest }, async () => basePending)
    ).rejects.toThrow("staged_wrong_operation_kind");
  });

  test("accepts canonical publication and removal digests regardless of JSON key order", async () => {
    const publishJson = JSON.stringify({
      object: publishRequest.object,
      objectId: publishRequest.objectId,
      idempotencyKey: publishRequest.idempotencyKey,
      slug: publishRequest.slug,
      publicLogbookId: publishRequest.publicLogbookId,
      protocolVersion: publishRequest.protocolVersion
    });
    const publishDigest = digest(publishRequest);
    const batch = await loadStagedPublishBatch([{ artifactId: "a1", requestDigest: publishDigest }], async () => ({
      sourceArtifactId: "a1",
      operationKind: "publish",
      requestJson: publishJson,
      requestDigest: publishDigest,
      idempotencyKey: "idem-key-0001"
    }));
    expect(batch.requests).toHaveLength(1);
    expect(batch.requests[0]?.idempotencyKey).toBe("idem-key-0001");

    const removeJson = JSON.stringify({
      idempotencyKey: removeRequest.idempotencyKey,
      pageId: removeRequest.pageId,
      protocolVersion: removeRequest.protocolVersion
    });
    const removeDigest = digest(removeRequest);
    const removal = await loadStagedRemoval({ artifactId: "a1", requestDigest: removeDigest }, async () => ({
      sourceArtifactId: "a1",
      operationKind: "remove",
      requestJson: removeJson,
      requestDigest: removeDigest,
      idempotencyKey: "idem-remove-1"
    }));
    expect(removal.pageId).toBe("22222222-2222-4222-8222-222222222222");
  });
});
