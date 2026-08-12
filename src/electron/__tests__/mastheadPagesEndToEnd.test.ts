import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";

import { getLogbookArtifact } from "../../app/daemonClient.ts";
import type { PublishedSessionDossierV1 } from "../../shared/sessionDossier.ts";
import type { DaemonConfig } from "../../daemon/config.ts";
import {
  getPendingMastheadPagesOperation,
  recordMastheadPagesFailure,
  type MastheadPagesPublicationReceipt,
} from "../../daemon/db/mastheadPagesRepository.ts";
import { applySessionArtifact, publishSessionArtifact } from "../../daemon/db/sessionArtifactRepository.ts";
import { seedSession } from "../../daemon/db/__tests__/sessionTestHelpers.ts";
import { migrateDatabase } from "../../daemon/db/schema.ts";
import { openMastheadDatabase } from "../../daemon/db/sqlite.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../../daemon/server.ts";
import { computePageObjectId } from "../../mastheadPages/objectIdentity.ts";
import type {
  PageRevisionV1,
  PublishPageBatchRequestV1,
  PublishPageRequestV1,
  PublisherAccountV1,
} from "../../mastheadPages/types.ts";
import { createMastheadPagesCredentialStore, type SafeStorageLike } from "../mastheadPagesCredentials.ts";
import { createMastheadPagesRemoteClient } from "../mastheadPagesRemoteClient.ts";
import { assertStagedRefsOnly } from "../mastheadPagesStagedOperations.ts";

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.splice(0).map((daemon) => daemon.close()));
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  vi.restoreAllMocks();
});

const account: PublisherAccountV1 = {
  protocolVersion: "masthead-pages-account-v1",
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  handle: "demo",
  publisherAccess: "publisher",
  defaultLogbookVisibility: "discoverable",
};

describe("mastheadPagesEndToEnd", () => {
  test("publishes through staged bytes, records mapping, revises, rejects stale parent, retries, and withdraws without harming local Logbook", async () => {
    const { baseUrl, artifactId, db } = await startWithEligibleArtifact("session:e2e");
    const localBefore = await getLogbookArtifact(artifactId, baseUrl);
    expect(localBefore.capsule.title).toBe("Ship portable public projection");

    const prepared = await postJson(baseUrl, "/masthead-pages/reviews/prepare", { artifactIds: [artifactId] });
    expect(prepared.items[0].eligibility).toBe("eligible");
    expect(JSON.stringify(prepared)).not.toContain("session:private");
    expect(JSON.stringify(prepared)).not.toContain("SECRET");

    const finalized = await postJson(baseUrl, "/masthead-pages/reviews/finalize", {
      items: [finalizeItem(artifactId, "e2e-page")],
    });
    expect(finalized.items[0]).toMatchObject({ decision: "ready", staged: true });
    const requestDigest = finalized.items[0].requestDigest as string;
    const publishRequest = finalized.items[0].request as PublishPageRequestV1;
    expect(publishRequest.objectId).toBe(computePageObjectId(publishRequest.object as PageRevisionV1));
    expect(JSON.stringify(publishRequest)).not.toContain("session:private");

    expect(() =>
      assertStagedRefsOnly(
        {
          refs: [{ artifactId, requestDigest }],
          object: publishRequest.object,
        },
        "publish",
      ),
    ).toThrow(/forbidden_field:object|raw_page_object/);

    const dir = await mkdtemp(join(tmpdir(), "masthead-pages-e2e-"));
    tempDirs.push(dir);
    const store = createMastheadPagesCredentialStore({ userDataPath: dir, platform: "linux" });
    await store.save("refresh-live", account, fakeSafeStorage());

    const hosted = createHostedMock();
    const client = createMastheadPagesRemoteClient({
      apiOrigin: "https://masthead.page",
      credentialStore: store,
      safeStorage: fakeSafeStorage(),
      fetchImpl: hosted.fetchImpl,
      daemonBaseUrl: () => baseUrl,
      openExternal: async () => undefined,
      sleep: async () => undefined,
      platform: "linux",
      env: {},
    });

    const publishResult = await client.publishStaged({
      refs: [{ artifactId, requestDigest }],
    });
    expect(publishResult.results).toHaveLength(1);
    expect(publishResult.results[0]).toMatchObject({
      status: "published",
      idempotencyKey: publishRequest.idempotencyKey,
      objectId: publishRequest.objectId,
    });
    expect(hosted.capturedBatches).toHaveLength(1);
    const outbound = hosted.capturedBatches[0]!.requests[0]!;
    expect(outbound.objectId).toBe(publishRequest.objectId);
    expect(JSON.stringify(outbound)).not.toContain("session:private");
    expect(JSON.stringify(outbound)).not.toContain("refresh-live");

    const receipt = successReceipt(artifactId, publishRequest, publishResult.results[0] as { pageId: string });
    await postJson(baseUrl, "/masthead-pages/publications/record", receipt);
    expect(getPendingMastheadPagesOperation(db, artifactId)).toBeUndefined();

    const revision = await postJson(baseUrl, "/masthead-pages/reviews/finalize", {
      items: [finalizeItem(artifactId, "e2e-page")],
    });
    expect(revision.items[0].request).toMatchObject({
      pageId: receipt.pageId,
      expectedParentObjectId: publishRequest.objectId,
    });
    const revisionDigest = revision.items[0].requestDigest as string;
    const revisionRequest = revision.items[0].request as PublishPageRequestV1;

    hosted.forceParentConflict = true;
    await expect(
      client.publishStaged({ refs: [{ artifactId, requestDigest: revisionDigest }] }),
    ).resolves.toMatchObject({
      results: [
        {
          status: "conflict",
          code: "parent-conflict",
          idempotencyKey: revisionRequest.idempotencyKey,
        },
      ],
    });
    hosted.forceParentConflict = false;

    await postJson(baseUrl, "/masthead-pages/failures/record", {
      artifactId,
      errorClass: "parent_conflict",
      message: "stale parent",
      retryable: true,
    });
    expect(getPendingMastheadPagesOperation(db, artifactId)?.operationKind).toBe("publish");

    // Simulated restart: new client instance, same staged digest and credentials.
    const restarted = createMastheadPagesRemoteClient({
      apiOrigin: "https://masthead.page",
      credentialStore: store,
      safeStorage: fakeSafeStorage(),
      fetchImpl: hosted.fetchImpl,
      daemonBaseUrl: () => baseUrl,
      openExternal: async () => undefined,
      sleep: async () => undefined,
      platform: "linux",
      env: {},
    });
    hosted.parentObjectId = publishRequest.objectId;
    const retry = await restarted.publishStaged({
      refs: [{ artifactId, requestDigest: revisionDigest }],
    });
    expect(retry.results[0]).toMatchObject({ status: "published", objectId: revisionRequest.objectId });
    await postJson(
      baseUrl,
      "/masthead-pages/publications/record",
      successReceipt(artifactId, revisionRequest, retry.results[0] as { pageId: string }),
    );

    const blockedId = seedEligibleArtifact(db, "session:e2e-blocked", {
      keyWork: ["Used sk-secret-value-1234567890."],
    });
    const mixed = await postJson(baseUrl, "/masthead-pages/reviews/finalize", {
      items: [finalizeItem(blockedId, "blocked-page"), finalizeItem(artifactId, "e2e-page-again")],
    });
    expect(mixed.items.map((item: { decision: string; staged: boolean }) => item.decision)).toEqual([
      "blocked",
      "ready",
    ]);
    expect(mixed.items[0].staged).toBe(false);
    expect(mixed.items[1].staged).toBe(true);

    const removal = await postJson(baseUrl, "/masthead-pages/operations/removal/stage", { artifactId });
    const removeDigest = removal.requestDigest as string;
    const withdrawn = await restarted.withdrawStaged({
      refs: [{ artifactId, requestDigest: removeDigest }],
    });
    expect(withdrawn).toMatchObject({
      protocolVersion: "masthead-pages-remove-result-v1",
      status: "removed",
      retryable: false,
    });
    await postJson(baseUrl, "/masthead-pages/failures/record", {
      artifactId,
      kind: "removed",
    });

    const localAfter = await getLogbookArtifact(artifactId, baseUrl);
    expect(localAfter.capsule.title).toBe(localBefore.capsule.title);
    expect(localAfter.capsule.artifactId).toBe(artifactId);
    expect(JSON.stringify(localAfter)).not.toContain("refresh-live");
  });

  test("keeps local Logbook usable while Masthead Pages is offline or failing closed", async () => {
    const { baseUrl, artifactId, db } = await startWithEligibleArtifact("session:offline");
    const before = await getLogbookArtifact(artifactId, baseUrl);

    const finalized = await postJson(baseUrl, "/masthead-pages/reviews/finalize", {
      items: [finalizeItem(artifactId, "offline-page")],
    });
    const requestDigest = finalized.items[0].requestDigest as string;

    const dir = await mkdtemp(join(tmpdir(), "masthead-pages-offline-"));
    tempDirs.push(dir);
    const store = createMastheadPagesCredentialStore({ userDataPath: dir, platform: "linux" });
    await store.save("refresh-offline", account, fakeSafeStorage());

    const offlineClient = createMastheadPagesRemoteClient({
      apiOrigin: "https://masthead.page",
      credentialStore: store,
      safeStorage: fakeSafeStorage(),
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
      daemonBaseUrl: () => baseUrl,
      openExternal: async () => undefined,
      sleep: async () => undefined,
      platform: "linux",
      env: {},
    });

    await expect(
      offlineClient.publishStaged({ refs: [{ artifactId, requestDigest }] }),
    ).rejects.toThrow();
    expect(getPendingMastheadPagesOperation(db, artifactId)?.operationKind).toBe("publish");
    await expect(getLogbookArtifact(artifactId, baseUrl)).resolves.toMatchObject({
      capsule: { artifactId, title: before.capsule.title },
    });

    recordMastheadPagesFailure(db, artifactId, {
      errorClass: "network",
      message: "offline",
      retryable: true,
    });
    expect(getPendingMastheadPagesOperation(db, artifactId)?.operationKind).toBe("publish");

    const basicTextStore = createMastheadPagesCredentialStore({ userDataPath: dir, platform: "linux" });
    await expect(
      basicTextStore.save("refresh", account, fakeSafeStorage({ backend: "basic_text" })),
    ).rejects.toThrow(/secure_storage_unavailable|SECURE_STORAGE|basic_text/i);

    const expiredClient = createMastheadPagesRemoteClient({
      apiOrigin: "https://masthead.page",
      credentialStore: store,
      safeStorage: fakeSafeStorage(),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/v1/device-authorizations")) {
          return jsonResponse(200, {
            protocolVersion: "masthead-pages-device-authorization-v1",
            deviceCode: "device-code-1",
            userCode: "ABCD-EFGH",
            verificationUri: "https://masthead.page/device-approve",
            expiresIn: 1,
            pollingInterval: 1,
          });
        }
        if (url.endsWith("/api/v1/device-token")) {
          return jsonResponse(200, {
            protocolVersion: "masthead-pages-device-token-v1",
            status: "expired",
          });
        }
        throw new Error(`unexpected ${url}`);
      },
      daemonBaseUrl: () => baseUrl,
      openExternal: async () => undefined,
      sleep: async () => undefined,
      platform: "linux",
      maxPollAttempts: 2,
      env: {},
    });
    await expect(expiredClient.connect()).rejects.toThrow(/device_authorization_expired/);

    const revokedClient = createMastheadPagesRemoteClient({
      apiOrigin: "https://masthead.page",
      credentialStore: store,
      safeStorage: fakeSafeStorage(),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/v1/device-token")) {
          return jsonResponse(401, { error: "revoked" });
        }
        throw new Error(`unexpected ${url}`);
      },
      daemonBaseUrl: () => baseUrl,
      openExternal: async () => undefined,
      sleep: async () => undefined,
      platform: "linux",
      env: {},
    });
    await expect(
      revokedClient.publishStaged({ refs: [{ artifactId, requestDigest }] }),
    ).rejects.toThrow(/token_refresh_failed:401/);

    const rateLimited = createMastheadPagesRemoteClient({
      apiOrigin: "https://masthead.page",
      credentialStore: store,
      safeStorage: fakeSafeStorage(),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/v1/device-token") && init?.method === "POST") {
          const body = JSON.parse(String(init.body ?? "{}")) as { grantType?: string };
          if (body.grantType === "refresh_token") {
            return jsonResponse(200, {
              protocolVersion: "masthead-pages-device-token-v1",
              status: "authorized",
              accessToken: "access-1",
              accessTokenExpiresIn: 600,
              refreshToken: "refresh-offline",
              scopes: ["pages:create"],
              account,
            });
          }
        }
        if (url.endsWith("/api/v1/publications/batch")) {
          return jsonResponse(429, { error: "rate_limited" });
        }
        throw new Error(`unexpected ${url}`);
      },
      daemonBaseUrl: () => baseUrl,
      openExternal: async () => undefined,
      sleep: async () => undefined,
      platform: "linux",
      env: {},
    });
    await expect(
      rateLimited.publishStaged({ refs: [{ artifactId, requestDigest }] }),
    ).rejects.toThrow(/publish_batch_failed:429/);

    await expect(getLogbookArtifact(artifactId, baseUrl)).resolves.toMatchObject({
      capsule: { artifactId, title: before.capsule.title },
    });
    expect(getPendingMastheadPagesOperation(db, artifactId)?.requestDigest).toBe(requestDigest);
  });

  test("browser-only mode has no desktop publication client and leaves daemon state alone", async () => {
    const { baseUrl, artifactId, db } = await startWithEligibleArtifact("session:browser");
    await postJson(baseUrl, "/masthead-pages/reviews/finalize", {
      items: [finalizeItem(artifactId, "browser-page")],
    });
    const pending = getPendingMastheadPagesOperation(db, artifactId);
    expect(pending?.operationKind).toBe("publish");

    // Renderer desktop client is Electron-only; without preload bridges publication cannot run.
    const g = globalThis as { window?: { mastheadDesktop?: unknown } };
    const previous = g.window;
    g.window = {};
    try {
      const { isMastheadPagesDesktopClientAvailable } = await import("../../app/mastheadPages/desktopClient.ts");
      expect(isMastheadPagesDesktopClientAvailable()).toBe(false);
    } finally {
      if (previous === undefined) delete g.window;
      else g.window = previous;
    }

    expect(getPendingMastheadPagesOperation(db, artifactId)?.requestDigest).toBe(pending?.requestDigest);
    await expect(getLogbookArtifact(artifactId, baseUrl)).resolves.toBeDefined();
  });
});

function createHostedMock() {
  const capturedBatches: PublishPageBatchRequestV1[] = [];
  let pageCounter = 0;
  const state = {
    forceParentConflict: false,
    parentObjectId: undefined as string | undefined,
    capturedBatches,
    fetchImpl: async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith("/api/v1/device-token")) {
        return jsonResponse(200, {
          protocolVersion: "masthead-pages-device-token-v1",
          status: "authorized",
          accessToken: "access-e2e",
          accessTokenExpiresIn: 600,
          refreshToken: "refresh-live",
          scopes: ["logbooks:read", "logbooks:write", "pages:create", "pages:revise", "pages:remove"],
          account,
        });
      }
      if (url.endsWith("/api/v1/publications/batch")) {
        const batch = JSON.parse(String(init?.body ?? "{}")) as PublishPageBatchRequestV1;
        capturedBatches.push(batch);
        if (state.forceParentConflict) {
          return jsonResponse(200, {
            protocolVersion: "masthead-pages-publish-batch-result-v1",
            results: batch.requests.map((request) => ({
              status: "conflict",
              code: "parent-conflict",
              message: "expected parent object id is stale",
              retryable: true,
              idempotencyKey: request.idempotencyKey,
            })),
          });
        }
        return jsonResponse(200, {
          protocolVersion: "masthead-pages-publish-batch-result-v1",
          results: batch.requests.map((request) => {
            pageCounter += 1;
            const pageId = `bbbbbbbb-bbbb-4bbb-8bbb-${String(pageCounter).padStart(12, "0")}`;
            if (
              request.expectedParentObjectId &&
              state.parentObjectId &&
              request.expectedParentObjectId !== state.parentObjectId
            ) {
              return {
                status: "conflict",
                code: "parent-conflict",
                message: "stale parent",
                retryable: true,
                idempotencyKey: request.idempotencyKey,
              };
            }
            state.parentObjectId = request.objectId;
            return {
              status: "published",
              pageId,
              objectId: request.objectId,
              idempotencyKey: request.idempotencyKey,
              currentUrl: `https://masthead.page/@demo/logbook/${request.slug}`,
              exactRevisionUrl: `https://masthead.page/@demo/logbook/${request.slug}/revisions/${request.objectId}`,
              publishedAt: "2026-08-11T20:00:00.000Z",
            };
          }),
        });
      }
      if (url.includes("/api/v1/pages/") && url.endsWith("/withdraw")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { pageId?: string; idempotencyKey?: string };
        return jsonResponse(200, {
          protocolVersion: "masthead-pages-remove-result-v1",
          status: "removed",
          pageId: body.pageId ?? url.split("/pages/")[1]?.split("/")[0],
          idempotencyKey: body.idempotencyKey ?? "remove-key-missing",
          removedAt: "2026-08-11T21:00:00.000Z",
          retryable: false,
        });
      }
      throw new Error(`unexpected hosted request ${init?.method ?? "GET"} ${url}`);
    },
  };
  return state;
}

function successReceipt(
  artifactId: string,
  request: PublishPageRequestV1,
  result: { pageId: string },
): MastheadPagesPublicationReceipt {
  return {
    artifactId,
    pageId: result.pageId,
    objectId: request.objectId,
    parentObjectId: request.expectedParentObjectId,
    pagesAccountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    publicLogbookId: request.publicLogbookId,
    localContentFingerprint: "fp-e2e",
    egressFingerprint: digest(JSON.stringify(request)),
    friendlyUrl: `https://masthead.page/@demo/logbook/${request.slug}`,
    exactUrl: `https://masthead.page/@demo/logbook/${request.slug}/revisions/${request.objectId}`,
    publishedAt: "2026-08-11T20:00:00.000Z",
  };
}

function finalizeItem(artifactId: string, slug: string) {
  return {
    artifactId,
    publicLogbookId: "6d54c5ab-b8f4-4f01-a3af-e71a5576c8d7",
    pagesAccountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    slug,
    license: "all-rights-reserved" as const,
    evidenceSelections: [],
  };
}

function eligibleDossier(overrides: { keyWork?: string[] } = {}): PublishedSessionDossierV1 {
  return {
    snapshotVersion: "canonical-session-dossier-v1",
    identity: {
      sessionId: "session:private",
      sourceSessionId: "source:private",
      title: "Private",
      runtime: "codex",
      project: "Masthead",
      branch: "main",
      lifecycle: "ended",
      startedAt: "2026-08-10T09:15:30.000Z",
      endedAt: "2026-08-11T18:45:00.000Z",
    },
    narrative: {
      objective: "Ship portable public projection",
      firstUserPrompt: "private",
      latestUserPrompt: "private",
      topics: ["pages"],
      technologies: ["typescript"],
      unresolved: [],
    },
    files: [],
    tools: [],
    verification: { status: "passed", summary: "ok", commands: [] },
    attention: [],
    excerpts: [],
    enrichment: { status: "current" },
    durableEnrichment: {
      version: "session-capsule-v4",
      keywords: ["pages"],
      sessionTitle: {
        text: "Ship portable public projection",
        basis: "dominant_work",
        confidence: "high",
        evidenceRefs: [],
      },
      sessionSummary: {
        text: "Built the narrow session-dossier public projection allowlist.",
        state: "completed",
        confidence: "high",
        evidenceRefs: [],
      },
      sessionDossier: {
        purpose: "Project only approved durable fields.",
        outcome: "PageRevisionV1 is constructed without private sections.",
        keyWork: overrides.keyWork ?? ["Allowlist durable enrichment"],
        decisions: ["No prompt fallback"],
        blockers: [],
        verification: {
          status: "passed",
          summary: "Projection unit tests passed.",
          commands: ["npm test -- --run src/mastheadPages"],
          failures: [],
          evidenceRefs: [],
        },
        continuation: {
          nextStep: "Resolve reviewed evidence",
          openQuestions: [],
          constraints: [],
        },
        evidenceRefs: [],
        warnings: [],
      },
    },
  } as unknown as PublishedSessionDossierV1;
}

function seedEligibleArtifact(
  db: ReturnType<typeof openMastheadDatabase> extends Promise<infer T> ? T : never,
  sessionId: string,
  overrides: { keyWork?: string[] } = {},
): string {
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId,
    title: "Pages session",
  });
  const applied = applySessionArtifact(db, {
    artifactKind: "session_dossier",
    content: eligibleDossier(overrides),
    contentFingerprint: `fp-${sessionId}`,
    createdBy: "test",
    evidenceRefs: [],
    schemaVersion: "canonical-session-dossier-v1",
    sessionId,
    title: "Ship portable public projection",
    validation: { ok: true },
  });
  publishSessionArtifact(db, applied.artifactId);
  return applied.artifactId;
}

async function startWithEligibleArtifact(sessionId: string) {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-pages-e2e-daemon-"));
  tempDirs.push(tempDir);
  const databasePath = join(tempDir, "masthead.sqlite");
  const storePath = join(tempDir, "events.ndjson");
  const config = {
    allowedOrigins: ["http://127.0.0.1:5173"],
    codexHomeDir: tempDir,
    databasePath,
    fixturePath: join(tempDir, "fixture.json"),
    gitRefreshMs: 0,
    host: "127.0.0.1",
    hookTranscriptCatchupEnabled: false,
    llmCopyEnabled: false,
    port: 0,
    storePath,
  } satisfies DaemonConfig;

  const bootstrap = await openMastheadDatabase(databasePath);
  migrateDatabase(bootstrap);
  const artifactId = seedEligibleArtifact(bootstrap, sessionId);
  bootstrap.close();

  const daemon = await createMastheadDaemon(config);
  daemons.push(daemon);
  const baseUrl = await listen(daemon);
  return { baseUrl, artifactId, db: daemon.database };
}

function listen(daemon: MastheadDaemon): Promise<string> {
  return new Promise((resolve) => {
    daemon.server.listen(0, "127.0.0.1", () => {
      const address = daemon.server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`POST ${path} failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
}

function fakeSafeStorage(options: { backend?: string } = {}): SafeStorageLike {
  return {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => (options.backend as never) ?? "gnome_libsecret",
    encryptStringAsync: async (plainText: string) => Buffer.from(plainText, "utf8"),
    decryptStringAsync: async (encrypted: Buffer) => ({
      result: encrypted.toString("utf8"),
      shouldReEncrypt: false,
    }),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function digest(text: string): string {
  return `sha256-${createHash("sha256").update(text, "utf8").digest("hex")}`;
}
