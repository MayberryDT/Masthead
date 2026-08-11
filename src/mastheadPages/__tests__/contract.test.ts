import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  validateCreatePublicLogbookRequestV1,
  validateDeviceAuthorizationRequestV1,
  validateDeviceAuthorizationV1,
  validateDeviceRefreshRequestV1,
  validateDeviceRevokeRequestV1,
  validateDeviceRevokeResultV1,
  validateDeviceTokenRequestV1,
  validateDeviceTokenResultV1,
  validatePageRevisionV1,
  validatePublishPageBatchRequestV1,
  validatePublishPageBatchResultV1,
  validatePublishPageRequestV1,
  validatePublishPageResultV1,
  validatePublisherAccountResultV1,
  validatePublisherAccountV1,
  validatePublicLogbookListResultV1,
  validatePublicLogbookResultV1,
  validateRemovePageRequestV1,
  validateRemovePageResultV1,
  validateUpdatePublicLogbookRequestV1,
} from "../contract.ts";
import { computePageObjectId } from "../objectIdentity.ts";
import type { ObjectId, PageRevisionV1 } from "../types.ts";

const bundleRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../schemas/masthead-pages/v1",
);

const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOGBOOK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAGE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function readFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(bundleRoot, "fixtures/page-revision", name), "utf8"),
  ) as unknown;
}

const vectors = JSON.parse(
  readFileSync(join(bundleRoot, "vectors/page-object-ids.json"), "utf8"),
) as Array<{ name: string; objectId: ObjectId; object: PageRevisionV1 }>;

const invalidUnknownField = readFixture("invalid/unknown-field.json");

describe("page revision contract", () => {
  test("accepts minimal and complete fixtures", () => {
    expect(validatePageRevisionV1(readFixture("minimal.valid.json"))).toMatchObject({
      ok: true,
    });
    expect(validatePageRevisionV1(readFixture("complete.valid.json"))).toMatchObject({
      ok: true,
    });
    expect(
      validatePageRevisionV1(readFixture("markdown-adversarial.valid.json")),
    ).toMatchObject({ ok: true });
  });

  test("rejects a fixture with an unknown portable field", () => {
    expect(validatePageRevisionV1(invalidUnknownField)).toMatchObject({ ok: false });
  });

  test("rejects unsupported schema versions", () => {
    const page = {
      ...(readFixture("minimal.valid.json") as object),
      schemaVersion: "masthead-page-revision-v0",
    };
    expect(validatePageRevisionV1(page)).toMatchObject({ ok: false });
  });

  test("rejects oversized evidence text", () => {
    expect(
      validatePageRevisionV1(readFixture("invalid/oversized-evidence.json")),
    ).toMatchObject({ ok: false });
  });
});

describe("publish envelopes", () => {
  function minimalRequest() {
    const object = readFixture("minimal.valid.json") as PageRevisionV1;
    return {
      protocolVersion: "masthead-pages-publish-v1" as const,
      publicLogbookId: LOGBOOK_ID,
      slug: "minimal-public-page",
      idempotencyKey: "idem-key-0001",
      objectId: computePageObjectId(object),
      object,
    };
  }

  test("accepts a create publish request", () => {
    expect(validatePublishPageRequestV1(minimalRequest())).toMatchObject({ ok: true });
  });

  test("requires pageId and expectedParentObjectId together", () => {
    const request = minimalRequest();
    expect(
      validatePublishPageRequestV1({
        ...request,
        pageId: PAGE_ID,
      }),
    ).toMatchObject({ ok: false });

    expect(
      validatePublishPageRequestV1({
        ...request,
        pageId: PAGE_ID,
        expectedParentObjectId: vectors[0]!.objectId,
      }),
    ).toMatchObject({ ok: true });
  });

  test("rejects unsupported publish protocol version", () => {
    expect(
      validatePublishPageRequestV1({
        ...minimalRequest(),
        protocolVersion: "masthead-pages-publish-v0",
      }),
    ).toMatchObject({ ok: false });
  });

  test("rejects unknown fields on publish results", () => {
    const objectId = vectors[0]!.objectId;
    expect(
      validatePublishPageResultV1({
        status: "published",
        idempotencyKey: "idem-key-0001",
        pageId: PAGE_ID,
        objectId,
        currentUrl: "https://masthead.page/x",
        exactRevisionUrl: "https://masthead.page/x/r",
        publishedAt: "2026-08-11T12:00:00Z",
        artifactId: "local-secret",
      }),
    ).toMatchObject({ ok: false });
  });

  test("accepts batch request and result envelopes", () => {
    const a = minimalRequest();
    const b = {
      ...minimalRequest(),
      slug: "second-page",
      idempotencyKey: "idem-key-0002",
    };
    expect(
      validatePublishPageBatchRequestV1({
        protocolVersion: "masthead-pages-publish-batch-v1",
        requests: [a, b],
      }),
    ).toMatchObject({ ok: true });

    expect(
      validatePublishPageBatchResultV1({
        protocolVersion: "masthead-pages-publish-batch-result-v1",
        results: [
          {
            status: "published",
            idempotencyKey: "idem-key-0001",
            pageId: PAGE_ID,
            objectId: vectors[0]!.objectId,
            currentUrl: "https://masthead.page/x",
            exactRevisionUrl: "https://masthead.page/x/r",
            publishedAt: "2026-08-11T12:00:00Z",
          },
        ],
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("management and device contracts", () => {
  test("publisher account DTOs", () => {
    const account = {
      protocolVersion: "masthead-pages-account-v1",
      accountId: ACCOUNT_ID,
      handle: "alice",
      publisherAccess: "publisher",
      defaultLogbookVisibility: "discoverable",
    };
    expect(validatePublisherAccountV1(account)).toMatchObject({ ok: true });
    expect(
      validatePublisherAccountResultV1({
        protocolVersion: "masthead-pages-account-result-v1",
        account,
      }),
    ).toMatchObject({ ok: true });
    expect(
      validatePublisherAccountV1({
        ...account,
        protocolVersion: "masthead-pages-account-v0",
      }),
    ).toMatchObject({ ok: false });
    expect(
      validatePublisherAccountV1({
        ...account,
        secret: "nope",
      }),
    ).toMatchObject({ ok: false });
  });

  test("public logbook create/list/update DTOs", () => {
    expect(
      validateCreatePublicLogbookRequestV1({
        protocolVersion: "masthead-pages-logbook-v1",
        title: "Research",
        slug: "research",
        description: "Notes",
        defaultLicense: "all-rights-reserved",
      }),
    ).toMatchObject({ ok: true });

    expect(
      validateUpdatePublicLogbookRequestV1({
        protocolVersion: "masthead-pages-logbook-v1",
        title: "Research log",
      }),
    ).toMatchObject({ ok: true });

    const summary = {
      id: LOGBOOK_ID,
      ownerAccountId: ACCOUNT_ID,
      title: "Research",
      slug: "research",
      description: "Notes",
      visibility: "unlisted",
      defaultLicense: "cc-by-4.0",
    };
    expect(
      validatePublicLogbookResultV1({
        protocolVersion: "masthead-pages-logbook-result-v1",
        publicLogbook: summary,
      }),
    ).toMatchObject({ ok: true });
    expect(
      validatePublicLogbookListResultV1({
        protocolVersion: "masthead-pages-logbook-list-v1",
        items: [summary],
      }),
    ).toMatchObject({ ok: true });
  });

  test("device authorization and token exchange DTOs", () => {
    expect(
      validateDeviceAuthorizationRequestV1({
        protocolVersion: "masthead-pages-device-authorization-v1",
      }),
    ).toMatchObject({ ok: true });

    expect(
      validateDeviceAuthorizationV1({
        protocolVersion: "masthead-pages-device-authorization-v1",
        deviceCode: "device-code-value",
        userCode: "ABCD-EFGH",
        verificationUri: "https://masthead.page/device",
        expiresIn: 600,
        pollingInterval: 5,
      }),
    ).toMatchObject({ ok: true });

    expect(
      validateDeviceTokenRequestV1({
        protocolVersion: "masthead-pages-device-token-v1",
        grantType: "device_code",
        deviceCode: "device-code-value",
      }),
    ).toMatchObject({ ok: true });

    expect(
      validateDeviceRefreshRequestV1({
        protocolVersion: "masthead-pages-device-token-v1",
        grantType: "refresh_token",
        refreshToken: "refresh-token-value",
      }),
    ).toMatchObject({ ok: true });

    expect(
      validateDeviceTokenResultV1({
        protocolVersion: "masthead-pages-device-token-v1",
        status: "pending",
      }),
    ).toMatchObject({ ok: true });

    expect(
      validateDeviceTokenResultV1({
        protocolVersion: "masthead-pages-device-token-v1",
        status: "authorized",
        accessToken: "access",
        accessTokenExpiresIn: 3600,
        refreshToken: "refresh",
        scopes: ["logbooks:read", "pages:create"],
        account: {
          protocolVersion: "masthead-pages-account-v1",
          accountId: ACCOUNT_ID,
          publisherAccess: "publisher",
          defaultLogbookVisibility: "discoverable",
        },
      }),
    ).toMatchObject({ ok: true });

    expect(
      validateDeviceRevokeRequestV1({
        protocolVersion: "masthead-pages-device-revoke-v1",
        refreshToken: "refresh",
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateDeviceRevokeResultV1({
        protocolVersion: "masthead-pages-device-revoke-result-v1",
        status: "revoked",
      }),
    ).toMatchObject({ ok: true });
  });

  test("remove page DTOs", () => {
    expect(
      validateRemovePageRequestV1({
        protocolVersion: "masthead-pages-remove-v1",
        pageId: PAGE_ID,
        idempotencyKey: "remove-key-1",
      }),
    ).toMatchObject({ ok: true });

    expect(
      validateRemovePageResultV1({
        protocolVersion: "masthead-pages-remove-result-v1",
        pageId: PAGE_ID,
        idempotencyKey: "remove-key-1",
        status: "removed",
        removedAt: "2026-08-11T12:00:00Z",
        retryable: false,
      }),
    ).toMatchObject({ ok: true });

    expect(
      validateRemovePageRequestV1({
        protocolVersion: "masthead-pages-remove-v0",
        pageId: PAGE_ID,
        idempotencyKey: "remove-key-1",
      }),
    ).toMatchObject({ ok: false });
  });
});
