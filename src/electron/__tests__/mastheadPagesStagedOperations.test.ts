import { createHash } from "node:crypto";
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

function digest(json: string): string {
  return `sha256-${createHash("sha256").update(json, "utf8").digest("hex")}`;
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

  test("rejects digest mismatch and wrong operation kind", async () => {
    const requestJson = JSON.stringify(publishRequest);
    const pending: DaemonPendingOperation = {
      sourceArtifactId: "a1",
      operationKind: "publish",
      requestJson,
      requestDigest: digest(requestJson),
      idempotencyKey: "idem-key-0001"
    };
    await expect(
      loadStagedPublishBatch([{ artifactId: "a1", requestDigest: "sha256-deadbeef" }], async () => pending)
    ).rejects.toThrow("staged_digest_mismatch");

    await expect(
      loadStagedRemoval({ artifactId: "a1", requestDigest: pending.requestDigest }, async () => pending)
    ).rejects.toThrow("staged_wrong_operation_kind");
  });

  test("loads validated publish and removal staged operations", async () => {
    const publishJson = JSON.stringify(publishRequest);
    const publishDigest = digest(publishJson);
    const batch = await loadStagedPublishBatch([{ artifactId: "a1", requestDigest: publishDigest }], async () => ({
      sourceArtifactId: "a1",
      operationKind: "publish",
      requestJson: publishJson,
      requestDigest: publishDigest,
      idempotencyKey: "idem-key-0001"
    }));
    expect(batch.requests).toHaveLength(1);
    expect(batch.requests[0]?.idempotencyKey).toBe("idem-key-0001");

    const removeJson = JSON.stringify(removeRequest);
    const removeDigest = digest(removeJson);
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
