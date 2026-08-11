import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createMastheadPagesCredentialStore, type SafeStorageLike } from "../mastheadPagesCredentials";
import { createMastheadPagesRemoteClient } from "../mastheadPagesRemoteClient";
import { computePageObjectId } from "../../mastheadPages/objectIdentity";
import type { PageRevisionV1, PublisherAccountV1, PublishPageRequestV1 } from "../../mastheadPages/types";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

const account: PublisherAccountV1 = {
  protocolVersion: "masthead-pages-account-v1",
  accountId: "11111111-1111-4111-8111-111111111111",
  handle: "mayberry",
  publisherAccess: "publisher",
  defaultLogbookVisibility: "discoverable"
};

function fakeSafeStorage(): SafeStorageLike {
  return {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptStringAsync: async (plainText: string) => Buffer.from(plainText, "utf8"),
    decryptStringAsync: async (encrypted: Buffer) => ({ result: encrypted.toString("utf8"), shouldReEncrypt: false })
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

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

describe("mastheadPagesRemoteClient", () => {
  test("connects via device flow, opens only allowlisted URL, stores refresh token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-pages-remote-"));
    tempDirs.push(dir);
    const store = createMastheadPagesCredentialStore({ userDataPath: dir, platform: "linux" });
    const opened: string[] = [];
    let pollCount = 0;
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/device-authorizations")) {
        return jsonResponse(200, {
          protocolVersion: "masthead-pages-device-authorization-v1",
          deviceCode: "device-code-1",
          userCode: "ABCD-EFGH",
          verificationUri: "https://masthead.page/device-approve",
          expiresIn: 600,
          pollingInterval: 1
        });
      }
      if (url.endsWith("/api/v1/device-token")) {
        pollCount += 1;
        if (pollCount === 1) {
          return jsonResponse(200, {
            protocolVersion: "masthead-pages-device-token-v1",
            status: "pending"
          });
        }
        return jsonResponse(200, {
          protocolVersion: "masthead-pages-device-token-v1",
          status: "authorized",
          accessToken: "access-1",
          accessTokenExpiresIn: 600,
          refreshToken: "refresh-1",
          scopes: ["logbooks:read", "logbooks:write", "pages:create", "pages:revise", "pages:remove"],
          account
        });
      }
      throw new Error(`unexpected ${url} ${init?.method}`);
    });

    const client = createMastheadPagesRemoteClient({
      apiOrigin: "https://masthead.page",
      credentialStore: store,
      safeStorage: fakeSafeStorage(),
      fetchImpl: fetchImpl as never,
      openExternal: async (url) => {
        opened.push(url);
      },
      daemonBaseUrl: () => "http://127.0.0.1:17373",
      sleep: async () => undefined,
      platform: "linux",
      env: {}
    });

    await expect(client.connect()).resolves.toEqual({ status: "connected", account });
    expect(opened).toEqual(["https://masthead.page/device-approve"]);
    await expect(store.loadRefreshToken(fakeSafeStorage())).resolves.toBe("refresh-1");
  });

  test("rejects evil verification URLs before openExternal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-pages-remote-"));
    tempDirs.push(dir);
    const store = createMastheadPagesCredentialStore({ userDataPath: dir, platform: "linux" });
    const openExternal = vi.fn();
    const client = createMastheadPagesRemoteClient({
      apiOrigin: "https://masthead.page",
      credentialStore: store,
      safeStorage: fakeSafeStorage(),
      fetchImpl: async () =>
        jsonResponse(200, {
          protocolVersion: "masthead-pages-device-authorization-v1",
          deviceCode: "device-code-1",
          userCode: "ABCD-EFGH",
          verificationUri: "https://evil.example/connect",
          expiresIn: 600,
          pollingInterval: 1
        }),
      openExternal,
      daemonBaseUrl: () => "http://127.0.0.1:17373",
      sleep: async () => undefined,
      platform: "linux"
    });
    await expect(client.connect()).rejects.toThrow("device_authorization_url_rejected");
    expect(openExternal).not.toHaveBeenCalled();
  });

  test("fails closed on version-mismatched hosted token responses before saving credentials", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-pages-remote-"));
    tempDirs.push(dir);
    const store = createMastheadPagesCredentialStore({ userDataPath: dir, platform: "linux" });
    let calls = 0;
    const client = createMastheadPagesRemoteClient({
      apiOrigin: "https://masthead.page",
      credentialStore: store,
      safeStorage: fakeSafeStorage(),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/device-authorizations")) {
          return jsonResponse(200, {
            protocolVersion: "masthead-pages-device-authorization-v1",
            deviceCode: "device-code-1",
            userCode: "ABCD-EFGH",
            verificationUri: "https://masthead.page/device-approve",
            expiresIn: 600,
            pollingInterval: 1
          });
        }
        calls += 1;
        return jsonResponse(200, {
          protocolVersion: "masthead-pages-device-token-v0",
          status: "authorized",
          accessToken: "access-1",
          accessTokenExpiresIn: 600,
          refreshToken: "refresh-bad",
          scopes: ["logbooks:read"],
          account
        });
      },
      openExternal: async () => undefined,
      daemonBaseUrl: () => "http://127.0.0.1:17373",
      sleep: async () => undefined,
      platform: "linux"
    });
    await expect(client.connect()).rejects.toThrow(/device_token_invalid_response/);
    expect(calls).toBeGreaterThan(0);
    await expect(store.hasCredentials()).resolves.toBe(false);
  });

  test("publishStaged rejects raw envelopes before credential read or net.fetch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-pages-remote-"));
    tempDirs.push(dir);
    const store = createMastheadPagesCredentialStore({ userDataPath: dir, platform: "linux" });
    const safeStorage = fakeSafeStorage();
    await store.save("refresh-1", account, safeStorage);
    const fetchImpl = vi.fn();
    const loadRefresh = vi.spyOn(store, "loadRefreshToken");

    const client = createMastheadPagesRemoteClient({
      apiOrigin: "https://masthead.page",
      credentialStore: store,
      safeStorage,
      fetchImpl: fetchImpl as never,
      daemonBaseUrl: () => "http://127.0.0.1:17373",
      platform: "linux"
    });

    await expect(
      client.publishStaged({
        refs: [{ artifactId: "a1", requestDigest: "sha256-abc" }],
        object: publishRequest.object
      })
    ).rejects.toThrow(/forbidden_field|raw_page/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(loadRefresh).not.toHaveBeenCalled();
  });

  test("publishStaged loads daemon staged bytes then posts batch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "masthead-pages-remote-"));
    tempDirs.push(dir);
    const store = createMastheadPagesCredentialStore({ userDataPath: dir, platform: "linux" });
    const safeStorage = fakeSafeStorage();
    await store.save("refresh-1", account, safeStorage);
    const requestJson = JSON.stringify(publishRequest);
    const requestDigest = `sha256-${createHash("sha256").update(requestJson, "utf8").digest("hex")}`;

    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/masthead-pages/operations/pending/")) {
        return jsonResponse(200, {
          sourceArtifactId: "a1",
          operationKind: "publish",
          requestJson,
          requestDigest,
          idempotencyKey: "idem-key-0001"
        });
      }
      if (url.endsWith("/api/v1/device-token")) {
        return jsonResponse(200, {
          protocolVersion: "masthead-pages-device-token-v1",
          status: "authorized",
          accessToken: "access-live",
          accessTokenExpiresIn: 600,
          refreshToken: "refresh-2",
          scopes: ["logbooks:read", "logbooks:write", "pages:create", "pages:revise", "pages:remove"],
          account
        });
      }
      if (url.endsWith("/api/v1/publications/batch")) {
        return jsonResponse(200, {
          protocolVersion: "masthead-pages-publish-batch-result-v1",
          results: [
            {
              status: "published",
              idempotencyKey: "idem-key-0001",
              pageId: "33333333-3333-4333-8333-333333333333",
              objectId: publishRequest.objectId,
              currentUrl: "https://masthead.page/@mayberry/demo/demo-page",
              exactRevisionUrl: `https://masthead.page/revisions/${publishRequest.objectId}`,
              publishedAt: "2026-08-11T00:00:00.000Z"
            }
          ]
        });
      }
      throw new Error(`unexpected ${url}`);
    });

    const client = createMastheadPagesRemoteClient({
      apiOrigin: "https://masthead.page",
      credentialStore: store,
      safeStorage,
      fetchImpl: fetchImpl as never,
      daemonBaseUrl: () => "http://127.0.0.1:17373",
      daemonFetch: fetchImpl as never,
      platform: "linux"
    });

    const result = await client.publishStaged({ refs: [{ artifactId: "a1", requestDigest }] });
    expect(result.results[0]).toMatchObject({ status: "published", idempotencyKey: "idem-key-0001" });
    await expect(store.loadRefreshToken(safeStorage)).resolves.toBe("refresh-2");
  });
});
