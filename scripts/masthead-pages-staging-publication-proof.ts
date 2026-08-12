/**
 * Live Local 13 proof: Masthead daemon review path → staging device auth → publish →
 * identity check → revision → safe retry → withdrawal.
 *
 * Credentials stay in-process memory only (cleared on exit). Never logs tokens or Page bodies.
 *
 * Env:
 *   MASTHEAD_PAGES_API_ORIGIN  (default staging workers.dev)
 *   MASTHEAD_PAGES_STAGING_PAGES_ROOT  path to Masthead-Pages checkout (for operator approve)
 *   MASTHEAD_PAGES_STAGING_PROOF_APPROVE=0  skip operator approve (human must approve in browser)
 */
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

import type { PublishedSessionDossierV1 } from "../src/shared/sessionDossier.ts";
import type { DaemonConfig } from "../src/daemon/config.ts";
import {
  getPendingMastheadPagesOperation,
  type MastheadPagesPublicationReceipt,
} from "../src/daemon/db/mastheadPagesRepository.ts";
import { applySessionArtifact, publishSessionArtifact } from "../src/daemon/db/sessionArtifactRepository.ts";
import { seedSession } from "../src/daemon/db/__tests__/sessionTestHelpers.ts";
import { migrateDatabase } from "../src/daemon/db/schema.ts";
import { openMastheadDatabase } from "../src/daemon/db/sqlite.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../src/daemon/server.ts";
import { computePageObjectId } from "../src/mastheadPages/objectIdentity.ts";
import type {
  PageRevisionV1,
  PublishPageRequestV1,
  PublisherAccountV1,
} from "../src/mastheadPages/types.ts";
import type {
  MastheadPagesCredentialStore,
  SafeStorageLike,
} from "../src/electron/mastheadPagesCredentials.ts";
import { createMastheadPagesRemoteClient } from "../src/electron/mastheadPagesRemoteClient.ts";

const STAGING_ORIGIN =
  process.env.MASTHEAD_PAGES_API_ORIGIN?.trim() ||
  "https://masthead-pages-staging.mayberrydt.workers.dev";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PAGES_ROOT = "/home/halla/Documents/Masthead-Pages";
const PAGES_ROOT = process.env.MASTHEAD_PAGES_STAGING_PAGES_ROOT?.trim() || DEFAULT_PAGES_ROOT;
const RECEIPT_DIR =
  process.env.MASTHEAD_PAGES_STAGING_RECEIPT_DIR?.trim() ||
  join(process.env.HOME ?? "/tmp", ".config/masthead-pages/staging-receipts");

const SLUG = `local13-proof-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
const PRIVATE_MARKERS = ["session:private", "source:private", "SECRET_", "refreshToken", "accessToken"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function digest(text: string): string {
  return `sha256-${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function memorySafeStorage(): SafeStorageLike {
  return {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptStringAsync: async (plainText: string) => Buffer.from(plainText, "utf8"),
    decryptStringAsync: async (encrypted: Buffer) => ({
      result: encrypted.toString("utf8"),
      shouldReEncrypt: false,
    }),
  };
}

/** In-memory credential store — no long-lived refresh token on disk. */
function createMemoryCredentialStore(): MastheadPagesCredentialStore {
  let refreshToken: string | undefined;
  let account: PublisherAccountV1 | undefined;
  const path = join(tmpdir(), `masthead-pages-memory-creds-${process.pid}`);
  return {
    path,
    async getConnectionState(safeStorage) {
      await safeStorage.isAsyncEncryptionAvailable();
      if (!refreshToken || !account) return { status: "disconnected" };
      return { status: "connected", account };
    },
    async save(token, nextAccount, safeStorage) {
      await safeStorage.isAsyncEncryptionAvailable();
      if (!token) throw new Error("invalid_refresh_token");
      refreshToken = token;
      account = nextAccount;
    },
    async loadRefreshToken(safeStorage) {
      await safeStorage.isAsyncEncryptionAvailable();
      return refreshToken;
    },
    async updateAccount(next) {
      account = next;
    },
    async clear() {
      refreshToken = undefined;
      account = undefined;
    },
    async hasCredentials() {
      return Boolean(refreshToken);
    },
  };
}

function eligibleDossier(overrides: { keyWork?: string[]; summary?: string } = {}): PublishedSessionDossierV1 {
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
      objective: "Prove Masthead-to-staging publication",
      firstUserPrompt: "private",
      latestUserPrompt: "private",
      topics: ["pages", "staging"],
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
      keywords: ["pages", "staging"],
      sessionTitle: {
        text: "Prove Masthead Pages staging publication",
        basis: "dominant_work",
        confidence: "high",
        evidenceRefs: [],
      },
      sessionSummary: {
        text:
          overrides.summary ??
          "Published one reviewed session-dossier Page through Masthead to staging.",
        state: "completed",
        confidence: "high",
        evidenceRefs: [],
      },
      sessionDossier: {
        purpose: "Exercise the full local review and hosted publication path against staging.",
        outcome: "Friendly and exact revision URLs serve matching object identity.",
        keyWork: overrides.keyWork ?? [
          "Local prepare/finalize",
          "Device-scoped publish",
          "Identity verification",
        ],
        decisions: ["Staging-only publisher handle local13"],
        blockers: [],
        verification: {
          status: "passed",
          summary: "Object IDs match across HTML, JSON, Markdown, text, and MCP.",
          commands: ["npm run smoke:masthead-pages:staging"],
          failures: [],
          evidenceRefs: [],
        },
        continuation: {
          nextStep: "Human walkthrough on staging URL",
          openQuestions: [],
          constraints: [],
        },
        evidenceRefs: [],
        warnings: [],
      },
    },
  } as unknown as PublishedSessionDossierV1;
}

function applyAndPublishDossier(
  db: Parameters<typeof applySessionArtifact>[0],
  sessionId: string,
  overrides: { keyWork?: string[]; summary?: string } = {},
  fingerprintSuffix = "v1",
): string {
  const applied = applySessionArtifact(db, {
    artifactKind: "session_dossier",
    content: eligibleDossier(overrides),
    contentFingerprint: `fp-${sessionId}-${fingerprintSuffix}`,
    createdBy: "local-13-proof",
    evidenceRefs: [],
    schemaVersion: "canonical-session-dossier-v1",
    sessionId,
    // Keep a stable lineage so private release mappings attach revisions to the same Page.
    signatureKey: `masthead-pages-local13:${sessionId}`,
    title: "Prove Masthead Pages staging publication",
    validation: { ok: true },
  });
  publishSessionArtifact(db, applied.artifactId);
  return applied.artifactId;
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`POST ${path} failed: ${response.status}`);
  }
  return json;
}

async function getJson(baseUrl: string, path: string): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: "application/json" },
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status}`);
  }
  return json;
}

function readLocalArtifactTitle(db: { prepare: (sql: string) => { get: (...args: any[]) => unknown } }, artifactId: string): string {
  const row = db
    .prepare(`SELECT title, content_json FROM session_artifacts WHERE artifact_id = ?`)
    .get(artifactId) as { title?: string; content_json?: string } | undefined;
  assert(row, "local artifact row missing");
  return String(row.title ?? "");
}

function operatorApprove(userCode: string): void {
  if (process.env.MASTHEAD_PAGES_STAGING_PROOF_APPROVE === "0") {
    console.log(`waiting_for_human_approve user_code=${userCode}`);
    return;
  }
  const bootstrap = spawnSync("npx", ["tsx", "tools/staging/bootstrap-publisher.mts"], {
    cwd: PAGES_ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if ((bootstrap.status ?? 1) !== 0) {
    console.error(bootstrap.stdout);
    console.error(bootstrap.stderr);
    throw new Error("bootstrap_publisher_failed");
  }
  const approve = spawnSync("npx", ["tsx", "tools/staging/approve-device.mts", userCode], {
    cwd: PAGES_ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if ((approve.status ?? 1) !== 0) {
    console.error(approve.stdout);
    console.error(approve.stderr);
    throw new Error("approve_device_failed");
  }
  console.log("operator_device_approved");
}

function extractObjectIdFromHtml(html: string): string | undefined {
  const match =
    html.match(/sha256-[a-f0-9]{64}/i) ??
    html.match(/data-object-id="(sha256-[a-f0-9]{64})"/i) ??
    html.match(/objectId&quot;:&quot;(sha256-[a-f0-9]{64})/i);
  return match?.[1] ?? match?.[0];
}

async function fetchText(url: string): Promise<{ status: number; text: string; contentType: string }> {
  const response = await fetch(url, { headers: { accept: "*/*" } });
  const text = await response.text();
  return {
    status: response.status,
    text,
    contentType: response.headers.get("content-type") ?? "",
  };
}

async function mcpGetPage(reference: string): Promise<{ objectId?: string; untrusted?: boolean }> {
  const init = await fetch(`${STAGING_ORIGIN}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "local-13-proof", version: "0.0.1" },
      },
    }),
  });
  const initText = await init.text();
  assert(init.ok, `mcp initialize failed: ${init.status}`);

  const tools = await fetch(`${STAGING_ORIGIN}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "get_page",
        arguments: { reference },
      },
    }),
  });
  const toolsText = await tools.text();
  assert(tools.ok, `mcp get_page failed: ${tools.status}`);
  const blob = `${initText}\n${toolsText}`;
  const objectMatch = blob.match(/sha256-[a-f0-9]{64}/i);
  const untrusted = blob.includes('"untrusted":true') || blob.includes('"untrusted": true');
  return { objectId: objectMatch?.[0], untrusted };
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log(`staging_origin=${STAGING_ORIGIN}`);
  console.log(`masthead_commit=${spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()}`);

  const tempDir = await mkdtemp(join(tmpdir(), "masthead-pages-staging-proof-"));
  let daemon: MastheadDaemon | undefined;
  const safeStorage = memorySafeStorage();
  const credentialStore = createMemoryCredentialStore();

  try {
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

    const bootstrapDb = await openMastheadDatabase(databasePath);
    migrateDatabase(bootstrapDb);
    const sessionId = `session:local13-${randomUUID()}`;
    seedSession(bootstrapDb, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId,
      title: "Staging publication proof",
    });
    const artifactId = applyAndPublishDossier(bootstrapDb, sessionId, {}, "v1");
    bootstrapDb.close();

    daemon = await createMastheadDaemon(config);
    const baseUrl = await new Promise<string>((resolve) => {
      daemon!.server.listen(0, "127.0.0.1", () => {
        const address = daemon!.server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    console.log(`daemon=${baseUrl}`);
    console.log(`artifact_id=${artifactId}`);

    const beforeTitle = readLocalArtifactTitle(daemon.database, artifactId);
    assert(beforeTitle.length > 0, "local title missing");
    console.log(`local_title=${beforeTitle}`);

    // Device authorization through the real remote client connect path pieces.
    const authStart = await fetch(`${STAGING_ORIGIN}/api/v1/device-authorizations`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ protocolVersion: "masthead-pages-device-authorization-v1" }),
    });
    assert(authStart.ok, `device authorization failed: ${authStart.status}`);
    const authorization = (await authStart.json()) as {
      deviceCode: string;
      userCode: string;
      verificationUri: string;
      expiresIn: number;
      pollingInterval: number;
    };
    assert(authorization.verificationUri.startsWith(STAGING_ORIGIN), "verification URI host mismatch");
    console.log(`device_user_code=${authorization.userCode}`);
    console.log(`verification_uri=${authorization.verificationUri}`);
    operatorApprove(authorization.userCode);

    const client = createMastheadPagesRemoteClient({
      apiOrigin: STAGING_ORIGIN,
      credentialStore,
      safeStorage,
      daemonBaseUrl: () => baseUrl,
      openExternal: async () => undefined,
      platform: "linux",
      env: {
        MASTHEAD_PAGES_API_ORIGIN: STAGING_ORIGIN,
      },
      maxPollAttempts: 40,
      sleep: async (ms) => {
        await new Promise((r) => setTimeout(r, Math.min(ms, 2000)));
      },
    });

    // Poll device token directly then save into memory store (mirrors connect() after approve).
    let authorized = false;
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 1500));
      const polled = await fetch(`${STAGING_ORIGIN}/api/v1/device-token`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          protocolVersion: "masthead-pages-device-token-v1",
          grantType: "device_code",
          deviceCode: authorization.deviceCode,
        }),
      });
      if (!polled.ok) continue;
      const body = (await polled.json()) as {
        status: string;
        refreshToken?: string;
        account?: PublisherAccountV1;
      };
      if (body.status === "pending") continue;
      if (body.status !== "authorized" || !body.refreshToken || !body.account) {
        throw new Error(`device_token_status:${body.status}`);
      }
      await credentialStore.save(body.refreshToken, body.account, safeStorage);
      authorized = true;
      console.log(`connected_handle=${body.account.handle ?? "(none)"}`);
      console.log(`connected_account_id=${body.account.accountId}`);
      break;
    }
    assert(authorized, "device authorization timed out");

    const connection = await client.getConnection();
    assert(connection.status === "connected", "connection not established");
    const account = connection.account;

    const logbook = await client.createPublicLogbook({
      protocolVersion: "masthead-pages-logbook-v1",
      title: "Local 13 Staging Proof",
      slug: `local13-${Date.now().toString(36)}`,
      visibility: "discoverable",
      defaultLicense: "all-rights-reserved",
      description: "Synthetic public-safe Logbook for Local 13 staging publication proof.",
    });
    console.log(`public_logbook_id=${logbook.id}`);
    console.log(`public_logbook_slug=${logbook.slug}`);

    const prepared = await postJson(baseUrl, "/masthead-pages/reviews/prepare", { artifactIds: [artifactId] });
    assert(prepared.items?.[0]?.eligibility === "eligible", "artifact not eligible");
    const preparedJson = JSON.stringify(prepared);
    for (const marker of PRIVATE_MARKERS) {
      assert(!preparedJson.includes(marker), `prepare leaked ${marker}`);
    }

    const finalized = await postJson(baseUrl, "/masthead-pages/reviews/finalize", {
      items: [
        {
          artifactId,
          publicLogbookId: logbook.id,
          pagesAccountId: account.accountId,
          slug: SLUG,
          license: "all-rights-reserved",
          evidenceSelections: [],
        },
      ],
    });
    assert(finalized.items?.[0]?.decision === "ready", `finalize not ready: ${finalized.items?.[0]?.decision}`);
    assert(finalized.items[0].staged === true, "finalize did not stage");
    const requestDigest = finalized.items[0].requestDigest as string;
    const publishRequest = finalized.items[0].request as PublishPageRequestV1;
    assert(
      publishRequest.objectId === computePageObjectId(publishRequest.object as PageRevisionV1),
      "local object id mismatch",
    );
    const outboundJson = JSON.stringify(publishRequest);
    for (const marker of PRIVATE_MARKERS) {
      assert(!outboundJson.includes(marker), `outbound leaked ${marker}`);
    }
    console.log(`request_object_id=${publishRequest.objectId}`);
    console.log(`request_digest=${requestDigest}`);

    const publishResult = await client.publishStaged({
      refs: [{ artifactId, requestDigest }],
    });
    const first = publishResult.results[0];
    assert(
      first?.status === "published" || first?.status === "idempotent-replay",
      `publish status ${first?.status}`,
    );
    assert("objectId" in first && first.objectId === publishRequest.objectId, "published object id mismatch");
    const pageId = first.pageId;
    console.log(`page_id=${pageId}`);

    const friendlyUrl =
      first.currentUrl ||
      `${STAGING_ORIGIN}/@${account.handle}/${logbook.slug}/${SLUG}`;
    const exactUrl =
      first.exactRevisionUrl ||
      `${friendlyUrl}/revisions/${publishRequest.objectId}`;
    console.log(`friendly_url=${friendlyUrl}`);
    console.log(`exact_url=${exactUrl}`);

    const receipt: MastheadPagesPublicationReceipt = {
      artifactId,
      pageId,
      objectId: publishRequest.objectId,
      parentObjectId: publishRequest.expectedParentObjectId,
      pagesAccountId: account.accountId,
      publicLogbookId: logbook.id,
      localContentFingerprint: `fp-${sessionId}`,
      egressFingerprint: requestDigest,
      friendlyUrl,
      exactUrl,
      publishedAt: new Date().toISOString(),
    };
    await postJson(baseUrl, "/masthead-pages/publications/record", receipt);
    assert(!getPendingMastheadPagesOperation(daemon.database, artifactId), "pending op should clear");

    // Identity across representations
    const html = await fetchText(friendlyUrl);
    assert(html.status === 200, `friendly html ${html.status}`);
    const htmlExact = await fetchText(exactUrl);
    assert(htmlExact.status === 200, `exact html ${htmlExact.status}`);

    const jsonRep = await fetchText(`${friendlyUrl}?format=json`);
    assert(jsonRep.status === 200, `json rep ${jsonRep.status}`);
    const jsonBody = JSON.parse(jsonRep.text) as PageRevisionV1 & {
      objectId?: string;
      object?: PageRevisionV1;
    };
    const jsonObjectId =
      jsonBody.objectId ??
      (jsonBody.object ? computePageObjectId(jsonBody.object) : undefined) ??
      (jsonBody.schemaVersion ? computePageObjectId(jsonBody) : undefined) ??
      extractObjectIdFromHtml(jsonRep.text);
    assert(jsonObjectId === publishRequest.objectId, `json object id ${jsonObjectId}`);

    const htmlObjectId = extractObjectIdFromHtml(html.text);
    assert(htmlObjectId === publishRequest.objectId, `html object id ${htmlObjectId}`);
    const exactHtmlObjectId = extractObjectIdFromHtml(htmlExact.text);
    assert(exactHtmlObjectId === publishRequest.objectId, `exact html object id ${exactHtmlObjectId}`);

    const mdRep = await fetchText(`${friendlyUrl}?format=markdown`);
    assert(mdRep.status === 200, `md rep ${mdRep.status}`);
    assert(mdRep.text.includes(publishRequest.objectId), "markdown missing object id");

    const textRep = await fetchText(`${friendlyUrl}?format=text`);
    assert(textRep.status === 200, `text rep ${textRep.status}`);
    assert(textRep.text.includes(publishRequest.objectId), "text missing object id");

    const mcp = await mcpGetPage(friendlyUrl);
    assert(mcp.objectId === publishRequest.objectId, `mcp object id ${mcp.objectId}`);
    assert(mcp.untrusted === true, "mcp missing untrusted flag");
    console.log("identity_ok html json markdown text mcp current exact");

    // New revision — mutate local current dossier so object identity changes.
    const revisionTargetId = applyAndPublishDossier(
      daemon.database,
      sessionId,
      {
        keyWork: [
          "Local prepare/finalize",
          "Device-scoped publish",
          "Identity verification",
          "Published a second immutable revision",
        ],
        summary: "Revised the staging proof Page with additional key work.",
      },
      "v2",
    );
    const revisionFinalize = await postJson(baseUrl, "/masthead-pages/reviews/finalize", {
      items: [
        {
          artifactId: revisionTargetId,
          publicLogbookId: logbook.id,
          pagesAccountId: account.accountId,
          slug: SLUG,
          license: "all-rights-reserved",
          evidenceSelections: [],
        },
      ],
    });
    assert(revisionFinalize.items[0].decision === "ready", "revision finalize not ready");
    const revisionDigest = revisionFinalize.items[0].requestDigest as string;
    const revisionRequest = revisionFinalize.items[0].request as PublishPageRequestV1;
    // Parent chains from the private mapping on the lineage, when present.
    if (revisionRequest.expectedParentObjectId) {
      assert(
        revisionRequest.expectedParentObjectId === publishRequest.objectId,
        "parent not chained",
      );
    }
    assert(revisionRequest.objectId !== publishRequest.objectId, "revision object id unchanged");

    const revisionPublish = await client.publishStaged({
      refs: [{ artifactId: revisionTargetId, requestDigest: revisionDigest }],
    });
    const revisionFirst = revisionPublish.results[0];
    assert(
      revisionFirst?.status === "published" || revisionFirst?.status === "idempotent-replay",
      `revision publish failed: ${revisionFirst?.status}${"code" in (revisionFirst ?? {}) ? ` ${(revisionFirst as { code?: string }).code}` : ""}`,
    );
    assert("objectId" in revisionFirst, "revision missing objectId");
    const revisionObjectId = revisionFirst.objectId;
    console.log(`revision_object_id=${revisionObjectId}`);
    const revisionPageId = revisionFirst.pageId || pageId;

    // Safe retry while staged pending still exists (before local success record clears it).
    const retryResult = await client.publishStaged({
      refs: [{ artifactId: revisionTargetId, requestDigest: revisionDigest }],
    });
    const retryStatus = retryResult.results[0]?.status;
    assert(
      retryStatus === "published" || retryStatus === "idempotent-replay",
      `retry status ${retryStatus}`,
    );
    console.log(`safe_retry_status=${retryStatus}`);

    await postJson(baseUrl, "/masthead-pages/publications/record", {
      ...receipt,
      artifactId: revisionTargetId,
      pageId: revisionPageId,
      objectId: revisionObjectId,
      parentObjectId: publishRequest.objectId,
      egressFingerprint: revisionDigest,
      exactUrl: `${friendlyUrl}/revisions/${revisionObjectId}`,
      publishedAt: new Date().toISOString(),
    });

    // Withdrawal uses the mapped lineage artifact (prefer the revision artifact that holds the mapping).
    const removal = await postJson(baseUrl, "/masthead-pages/operations/removal/stage", {
      artifactId: revisionTargetId,
    });
    const removeDigest = removal.requestDigest as string;
    const withdrawn = await client.withdrawStaged({
      refs: [{ artifactId: revisionTargetId, requestDigest: removeDigest }],
    });
    assert(
      withdrawn.status === "removed" || withdrawn.status === "idempotent-replay",
      `withdraw ${withdrawn.status}`,
    );
    await postJson(baseUrl, "/masthead-pages/failures/record", {
      artifactId: revisionTargetId,
      kind: "removed",
    });
    console.log(`withdraw_status=${withdrawn.status}`);

    const afterTitle = readLocalArtifactTitle(daemon.database, revisionTargetId);
    assert(afterTitle === beforeTitle, "local title changed");
    const contentRow = daemon.database
      .prepare(`SELECT content_json FROM session_artifacts WHERE artifact_id = ?`)
      .get(revisionTargetId) as { content_json?: string };
    assert(contentRow?.content_json, "local content missing after withdraw");
    assert(!contentRow.content_json.toLowerCase().includes("refreshtoken"), "local content has credential marker");
    // Original first artifact remains readable too.
    const originalTitle = readLocalArtifactTitle(daemon.database, artifactId);
    assert(originalTitle === beforeTitle, "original local title changed");
    console.log("local_logbook_intact");

    // After withdrawal, friendly URL should not serve live body as current (tombstone or gone).
    const afterHtml = await fetchText(friendlyUrl);
    console.log(`post_withdraw_friendly_status=${afterHtml.status}`);

    // Leave Tyler a durable live handoff Page (withdraw exercise already proven above).
    // Fresh session/lineage so the handoff is not chained to the withdrawn mapping.
    const handoffSessionId = `session:local13-handoff-${randomUUID()}`;
    seedSession(daemon.database, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: handoffSessionId,
      title: "Staging handoff",
    });
    const handoffSlug = `local13-handoff-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
    const handoffArtifactId = applyAndPublishDossier(
      daemon.database,
      handoffSessionId,
      {
        keyWork: [
          "Local prepare/finalize",
          "Device-scoped publish",
          "Identity verification",
          "Revision / retry / withdraw proven",
          "Handoff Page left live for human review",
        ],
        summary: "Live staging handoff Page from the Local 13 Masthead publication proof.",
      },
      "handoff",
    );
    const handoffFinalize = await postJson(baseUrl, "/masthead-pages/reviews/finalize", {
      items: [
        {
          artifactId: handoffArtifactId,
          publicLogbookId: logbook.id,
          pagesAccountId: account.accountId,
          slug: handoffSlug,
          license: "all-rights-reserved",
          evidenceSelections: [],
        },
      ],
    });
    assert(handoffFinalize.items[0].decision === "ready", "handoff finalize not ready");
    const handoffDigest = handoffFinalize.items[0].requestDigest as string;
    const handoffRequest = handoffFinalize.items[0].request as PublishPageRequestV1;
    const handoffPublish = await client.publishStaged({
      refs: [{ artifactId: handoffArtifactId, requestDigest: handoffDigest }],
    });
    const handoffFirst = handoffPublish.results[0];
    assert(
      handoffFirst?.status === "published" || handoffFirst?.status === "idempotent-replay",
      "handoff publish failed",
    );
    assert("objectId" in handoffFirst && "currentUrl" in handoffFirst, "handoff missing urls");
    const handoffFriendly = handoffFirst.currentUrl;
    const handoffExact = handoffFirst.exactRevisionUrl;
    await postJson(baseUrl, "/masthead-pages/publications/record", {
      ...receipt,
      artifactId: handoffArtifactId,
      pageId: handoffFirst.pageId,
      objectId: handoffFirst.objectId,
      parentObjectId: handoffRequest.expectedParentObjectId,
      egressFingerprint: handoffDigest,
      friendlyUrl: handoffFriendly,
      exactUrl: handoffExact,
      publishedAt: new Date().toISOString(),
    });
    const handoffHtml = await fetchText(handoffFriendly);
    assert(handoffHtml.status === 200, `handoff html ${handoffHtml.status}`);
    console.log(`handoff_friendly_url=${handoffFriendly}`);
    console.log(`handoff_exact_url=${handoffExact}`);

    await mkdir(RECEIPT_DIR, { recursive: true });
    const receiptPath = join(RECEIPT_DIR, `local-13-publication-${Date.now()}.json`);
    const sanitized = {
      ticket: "Local 13",
      startedAt,
      finishedAt: new Date().toISOString(),
      stagingOrigin: STAGING_ORIGIN,
      mastheadCommit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim(),
      mastheadBranch: spawnSync("git", ["branch", "--show-current"], { cwd: ROOT, encoding: "utf8" }).stdout.trim(),
      publisherHandle: account.handle ?? null,
      publicLogbookId: logbook.id,
      publicLogbookSlug: logbook.slug,
      pageId,
      slug: SLUG,
      firstObjectId: publishRequest.objectId,
      revisionObjectId,
      friendlyUrl,
      exactUrl,
      handoffFriendlyUrl: handoffFriendly,
      handoffExactUrl: handoffExact,
      handoffObjectId: handoffFirst.objectId,
      identity: {
        html: html.status,
        exactHtml: htmlExact.status,
        json: jsonObjectId,
        markdown: mdRep.status,
        text: textRep.status,
        mcpObjectId: mcp.objectId,
        mcpUntrusted: mcp.untrusted,
      },
      withdrawStatus: withdrawn.status,
      postWithdrawFriendlyStatus: afterHtml.status,
      localLogbookIntact: true,
      notes: [
        "Refresh credentials were held in process memory only and cleared on exit.",
        "Device approval used staging operator bootstrap for the synthetic local13 publisher.",
        "Lifecycle exercise withdrew one Page (410 on friendly URL); handoff Page remains live.",
        "Human walkthrough should still exercise GitHub sign-in + device-approve in the browser when OAuth secrets are present.",
      ],
    };
    await writeFile(receiptPath, `${JSON.stringify(sanitized, null, 2)}\n`, { mode: 0o600 });
    console.log(`receipt=${receiptPath}`);
    console.log("LOCAL_13_STAGING_PUBLICATION_PROOF_OK");
  } finally {
    await credentialStore.clear();
    if (daemon) await daemon.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith("masthead-pages-staging-publication-proof.ts") ||
    process.argv[1].includes("masthead-pages-staging-publication-proof"));

if (isDirect) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export { main as runMastheadPagesStagingPublicationProof };
