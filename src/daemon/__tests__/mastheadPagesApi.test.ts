import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import { sha256CanonicalRequest } from "../../mastheadPages/review.ts";
import type { RemovePageRequestV1 } from "../../mastheadPages/types.ts";
import type { PublishedSessionDossierV1 } from "../../shared/sessionDossier.ts";
import type { DaemonConfig } from "../config.ts";
import {
  getPendingMastheadPagesOperation,
  recordMastheadPagesPublication,
  type MastheadPagesPublicationReceipt
} from "../db/mastheadPagesRepository.ts";
import { applySessionArtifact, publishSessionArtifact } from "../db/sessionArtifactRepository.ts";
import { seedSession } from "../db/__tests__/sessionTestHelpers.ts";
import { migrateDatabase } from "../db/schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../db/sqlite.ts";
import {
  MASTHEAD_PAGES_MAX_ARTIFACT_IDS,
  migrateLegacyPendingRemovalDigests,
  routeMastheadPagesRequest,
  type MastheadPagesHttpContext
} from "../mastheadPagesApi.ts";
import { createMastheadDaemon, type MastheadDaemon } from "../server.ts";

const tempDirs: string[] = [];
const daemons: MastheadDaemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.map((daemon) => daemon.close()));
  daemons.length = 0;
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("masthead pages daemon API", () => {
  test("prepares a review without making a network request", async () => {
    const { baseUrl, artifactId, db } = await startWithEligibleArtifact();
    const originalFetch = globalThis.fetch.bind(globalThis);
    const fetchSpy = vi.fn(originalFetch);
    vi.stubGlobal("fetch", fetchSpy);

    const response = await postJson(baseUrl, "/masthead-pages/reviews/prepare", { artifactIds: [artifactId] });

    expect(response.items[0].eligibility).toBe("eligible");
    expect(response.items[0].baseObject?.title).toBe("Ship portable public projection");
    expect(Array.isArray(response.items[0].evidenceCandidates)).toBe(true);
    // Only the test client may call fetch; the daemon must not issue hosted/network requests.
    expect(fetchSpy.mock.calls).toHaveLength(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/masthead-pages/reviews/prepare");

    const direct = routeMastheadPagesRequest(
      { db },
      {
        method: "POST",
        url: new URL("http://127.0.0.1/masthead-pages/reviews/prepare"),
        body: { artifactIds: [artifactId] }
      }
    );
    expect(direct?.status).toBe(200);
    expect(fetchSpy.mock.calls).toHaveLength(1);
  });

  test("resolves the authoritative local matching path offline with an explicit complete result", async () => {
    const db = await testDb();
    const artifactId = seedEligibleArtifact(db, "session:offline-selection");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("network access is forbidden");
    });

    const direct = routeMastheadPagesRequest(
      { db },
      {
        method: "POST",
        url: new URL("http://127.0.0.1/masthead-pages/selection/resolve"),
        body: { limit: 500, q: "Ship portable" }
      }
    );

    expect(direct).toEqual({
      body: {
        artifactIds: [artifactId],
        ok: true
      },
      status: 200
    });

    const shadowComplete = routeMastheadPagesRequest(
      { db },
      {
        method: "POST",
        url: new URL("http://127.0.0.1/masthead-pages/selection/materialized/resolve"),
        body: { limit: 500, q: "Ship portable" }
      }
    );
    expect(shadowComplete?.body).toEqual({ ok: true, status: "complete", artifactIds: [artifactId] });

    db.prepare(
      `UPDATE masthead_pages_artifact_eligibility
       SET status = 'error', reason_code = 'eligibility_evaluation_error'
       WHERE artifact_id = ?`
    ).run(artifactId);
    const shadowIncomplete = routeMastheadPagesRequest(
      { db },
      {
        method: "POST",
        url: new URL("http://127.0.0.1/masthead-pages/selection/materialized/resolve"),
        body: { limit: 500, q: "Ship portable" }
      }
    );
    expect(shadowIncomplete?.body).toEqual({
      ok: true,
      status: "incomplete",
      artifactIds: [],
      reason: "eligibility_evaluation_failed",
      retryable: false
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("legacy and materialized selection both reject a dossier with missing provenance", async () => {
    const db = await testDb();
    const artifactId = seedEligibleArtifact(db, "session:missing-provenance");
    db.prepare("DELETE FROM session_artifact_provenance WHERE artifact_id = ?").run(artifactId);
    db.prepare("DELETE FROM masthead_pages_artifact_eligibility WHERE artifact_id = ?").run(artifactId);

    const legacy = routeMastheadPagesRequest(
      { db },
      {
        method: "POST",
        url: new URL("http://127.0.0.1/masthead-pages/selection/resolve"),
        body: { limit: 500 }
      }
    );
    const materialized = routeMastheadPagesRequest(
      { db },
      {
        method: "POST",
        url: new URL("http://127.0.0.1/masthead-pages/selection/materialized/resolve"),
        body: { limit: 500 }
      }
    );

    expect(legacy?.body).toEqual({ ok: true, artifactIds: [] });
    expect(materialized?.body).toEqual({ ok: true, status: "complete", artifactIds: [] });
  });

  test("keeps legacy selection by default and requires the exact materialized context opt-in", async () => {
    const db = await testDb();
    const artifactId = seedEligibleArtifact(db, "session:resolver-mode");
    const request = {
      method: "POST",
      url: new URL("http://127.0.0.1/masthead-pages/selection/resolve"),
      body: { limit: 500 }
    };

    expect(routeMastheadPagesRequest({ db }, request)?.body).toEqual({
      artifactIds: [artifactId],
      ok: true
    });
    expect(routeMastheadPagesRequest({ db, selectionResolverMode: "materialized" }, request)?.body).toEqual({
      artifactIds: [artifactId],
      ok: true,
      status: "complete"
    });
    const invalidContext = { db, selectionResolverMode: "future" } as unknown as MastheadPagesHttpContext;
    expect(routeMastheadPagesRequest(invalidContext, request)?.body).toEqual({
      artifactIds: [artifactId],
      ok: true
    });

    db.prepare(
      `UPDATE masthead_pages_artifact_eligibility
       SET status = 'error', reason_code = 'eligibility_evaluation_error'
       WHERE artifact_id = ?`
    ).run(artifactId);
    expect(routeMastheadPagesRequest({ db, selectionResolverMode: "materialized" }, request)?.body).toEqual({
      artifactIds: [],
      ok: true,
      reason: "eligibility_evaluation_failed",
      retryable: false,
      status: "incomplete"
    });
  });

  test("continues bounded eligibility backfill across event-loop turns and closes cleanly", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-pages-backfill-drain-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "masthead.sqlite");
    const config = {
      allowedOrigins: ["http://127.0.0.1:5173"],
      codexHomeDir: tempDir,
      databasePath,
      fixturePath: join(tempDir, "fixture.json"),
      gitRefreshMs: 0,
      host: "127.0.0.1",
      hookTranscriptCatchupEnabled: false,
      legacyWorkbenchBackfillEnabled: false,
      llmCopyEnabled: false,
      port: 0,
      storePath: join(tempDir, "events.ndjson")
    } satisfies DaemonConfig;
    const bootstrap = await openMastheadDatabase(databasePath);
    migrateDatabase(bootstrap);
    for (let index = 0; index < 105; index += 1) {
      seedEligibleArtifact(bootstrap, `session:backfill-drain-${index}`);
    }
    bootstrap.prepare("DELETE FROM masthead_pages_artifact_eligibility").run();
    bootstrap.close();

    const daemon = await createMastheadDaemon(config);
    daemons.push(daemon);
    expect(Number(daemon.database.prepare(
      "SELECT COUNT(*) AS count FROM masthead_pages_artifact_eligibility"
    ).get()?.count)).toBe(0);
    await waitForCondition(() =>
      Number(daemon.database.prepare("SELECT COUNT(*) AS count FROM masthead_pages_artifact_eligibility").get()?.count) === 105
    );

    await expect(daemon.close()).resolves.toBeUndefined();
  });

  test("marks unsupported kind and schema as ineligible", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:runbook",
      title: "Runbook"
    });
    const applied = applySessionArtifact(db, {
      artifactKind: "runbook",
      content: { title: "Runbook" },
      contentFingerprint: "fp-runbook",
      createdBy: "test",
      evidenceRefs: [],
      schemaVersion: "runbook-v1",
      sessionId: "session:runbook",
      title: "Runbook",
      validation: { ok: true }
    });
    publishSessionArtifact(db, applied.artifactId);

    const result = routeMastheadPagesRequest(
      { db },
      {
        method: "POST",
        url: new URL("http://127.0.0.1/masthead-pages/reviews/prepare"),
        body: { artifactIds: [applied.artifactId] }
      }
    );

    expect(result?.status).toBe(200);
    expect(result?.body).toMatchObject({
      ok: true,
      items: [{ artifactId: applied.artifactId, eligibility: "ineligible", ineligibilityReason: "unsupported_kind" }]
    });
  });

  test("rejects more than 500 artifact ids", async () => {
    const db = await testDb();
    const ids = Array.from({ length: MASTHEAD_PAGES_MAX_ARTIFACT_IDS + 1 }, (_, i) => `artifact:${i}`);
    const result = routeMastheadPagesRequest(
      { db },
      {
        method: "POST",
        url: new URL("http://127.0.0.1/masthead-pages/reviews/prepare"),
        body: { artifactIds: ids }
      }
    );
    expect(result?.status).toBe(400);
    expect(result?.body).toMatchObject({ error: { code: "too_many_artifact_ids" } });
  });

  test("rejects unknown selected evidence ids and prebuilt envelopes", async () => {
    const db = await testDb();
    const artifactId = seedEligibleArtifact(db, "session:finalize");

    const unknownEvidence = routeMastheadPagesRequest(
      { db },
      {
        method: "POST",
        url: new URL("http://127.0.0.1/masthead-pages/reviews/finalize"),
        body: {
          items: [
            {
              artifactId,
              publicLogbookId: "6d54c5ab-b8f4-4f01-a3af-e71a5576c8d7",
              pagesAccountId: "account-1",
              slug: "alpha-page",
              license: "all-rights-reserved",
              evidenceSelections: [
                { ref: "message:does-not-exist", kind: "excerpt", label: "Missing", supports: ["outcome"] }
              ]
            }
          ]
        }
      }
    );
    expect(unknownEvidence?.status).toBe(400);
    expect(unknownEvidence?.body).toMatchObject({ error: { code: "unknown_evidence_reference" } });

    const envelope = routeMastheadPagesRequest(
      { db },
      {
        method: "POST",
        url: new URL("http://127.0.0.1/masthead-pages/reviews/finalize"),
        body: {
          items: [
            {
              artifactId,
              publicLogbookId: "6d54c5ab-b8f4-4f01-a3af-e71a5576c8d7",
              pagesAccountId: "account-1",
              slug: "alpha-page",
              license: "all-rights-reserved",
              request: { protocolVersion: "masthead-pages-publish-v1" }
            }
          ]
        }
      }
    );
    expect(envelope?.status).toBe(400);
    expect(envelope?.body).toMatchObject({ error: { code: "renderer_envelope_rejected" } });
  });

  test("finalizes and stages atomically with stable request digests", async () => {
    const { baseUrl, artifactId, db } = await startWithEligibleArtifact("session:stage");
    const body = {
      items: [
        {
          artifactId,
          publicLogbookId: "6d54c5ab-b8f4-4f01-a3af-e71a5576c8d7",
          pagesAccountId: "account-1",
          slug: "review-masthead-pages-egress",
          license: "all-rights-reserved",
          idempotencyKey: "b4d8a1f1-5e76-4cc0-a3a8-4dcfbcce9d31",
          evidenceSelections: []
        }
      ]
    };

    const first = await postJson(baseUrl, "/masthead-pages/reviews/finalize", body);
    const second = await postJson(baseUrl, "/masthead-pages/reviews/finalize", body);

    expect(first.items[0].decision).toBe("ready");
    expect(first.items[0].staged).toBe(true);
    expect(first.items[0].requestDigest).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(second.items[0].requestDigest).toBe(first.items[0].requestDigest);

    const pending = getPendingMastheadPagesOperation(db, artifactId);
    expect(pending).toMatchObject({
      operationKind: "publish",
      requestDigest: first.items[0].requestDigest,
      idempotencyKey: "b4d8a1f1-5e76-4cc0-a3a8-4dcfbcce9d31"
    });
    expect(JSON.parse(pending!.requestJson)).toMatchObject({
      protocolVersion: "masthead-pages-publish-v1",
      slug: "review-masthead-pages-egress"
    });
  });

  test("classifies mixed batch items and stages only ready reviews", async () => {
    const db = await testDb();
    const readyId = seedEligibleArtifact(db, "session:ready");
    const blockedId = seedEligibleArtifact(db, "session:blocked", {
      keyWork: ["Used sk-secret-value-1234567890."]
    });

    const result = routeMastheadPagesRequest(
      { db },
      {
        method: "POST",
        url: new URL("http://127.0.0.1/masthead-pages/reviews/finalize"),
        body: {
          items: [
            finalizeItem(readyId, "ready-page"),
            finalizeItem(blockedId, "blocked-page")
          ]
        }
      }
    );

    expect(result?.status).toBe(200);
    const body = result?.body as { items: Array<{ decision: string; staged: boolean }> };
    expect(body.items[0]).toMatchObject({ decision: "ready", staged: true });
    expect(body.items[1]).toMatchObject({ decision: "blocked", staged: false });
    expect(getPendingMastheadPagesOperation(db, blockedId)).toBeUndefined();
    expect(getPendingMastheadPagesOperation(db, readyId)?.operationKind).toBe("publish");
  });

  test("finalizes a revision with pageId and expectedParentObjectId from the private mapping", async () => {
    const db = await testDb();
    const artifactId = seedEligibleArtifact(db, "session:revision");
    recordMastheadPagesPublication(db, publicationReceipt(artifactId));

    const result = routeMastheadPagesRequest(
      { db },
      {
        method: "POST",
        url: new URL("http://127.0.0.1/masthead-pages/reviews/finalize"),
        body: {
          items: [finalizeItem(artifactId, "revision-page")]
        }
      }
    );

    expect(result?.status).toBe(200);
    const body = result?.body as {
      items: Array<{ decision: string; staged: boolean; request: Record<string, unknown> }>;
    };
    expect(body.items[0]?.decision).toBe("ready");
    expect(body.items[0]?.staged).toBe(true);
    expect(body.items[0]?.request).toMatchObject({
      pageId: "11111111-1111-4111-8111-111111111111",
      expectedParentObjectId: expect.stringMatching(/^sha256-/)
    });
    expect(getPendingMastheadPagesOperation(db, artifactId)?.operationKind).toBe("publish");
  });

  test("stages removal from local mapping only", async () => {
    const db = await testDb();
    const artifactId = seedEligibleArtifact(db, "session:remove");
    recordMastheadPagesPublication(db, publicationReceipt(artifactId));

    const staged = routeMastheadPagesRequest(
      { db },
      {
        method: "POST",
        url: new URL("http://127.0.0.1/masthead-pages/operations/removal/stage"),
        body: { artifactId }
      }
    );
    expect(staged?.status).toBe(200);
    const body = staged?.body as {
      requestDigest: string;
      operation: { operationKind: string; requestJson: string; requestDigest: string };
    };
    const removalRequest = JSON.parse(body.operation.requestJson) as RemovePageRequestV1;
    expect(body.operation.operationKind).toBe("remove");
    expect(removalRequest).toMatchObject({
      protocolVersion: "masthead-pages-remove-v1",
      pageId: "11111111-1111-4111-8111-111111111111"
    });
    expect(body.requestDigest).toBe(sha256CanonicalRequest(removalRequest));
    expect(body.operation.requestDigest).toBe(body.requestDigest);

    const legacyDigest = `sha256-${createHash("sha256").update(body.operation.requestJson, "utf8").digest("hex")}`;
    expect(legacyDigest).not.toBe(body.requestDigest);
    db.prepare(
      "UPDATE masthead_pages_release_mappings SET pending_request_digest = ? WHERE source_artifact_id = ?"
    ).run(legacyDigest, artifactId);
    expect(migrateLegacyPendingRemovalDigests(db)).toBe(1);
    expect(getPendingMastheadPagesOperation(db, artifactId)?.requestDigest).toBe(body.requestDigest);
    expect(migrateLegacyPendingRemovalDigests(db)).toBe(0);

    const rejected = routeMastheadPagesRequest(
      { db },
      {
        method: "POST",
        url: new URL("http://127.0.0.1/masthead-pages/operations/removal/stage"),
        body: {
          artifactId,
          request: { protocolVersion: "masthead-pages-remove-v1", pageId: "x", idempotencyKey: "y" }
        }
      }
    );
    expect(rejected?.status).toBe(400);
    expect(rejected?.body).toMatchObject({ error: { code: "renderer_envelope_rejected" } });
  });

  test("GET pending returns staged operation and 404 when absent", async () => {
    const { baseUrl, artifactId } = await startWithEligibleArtifact("session:pending");
    await postJson(baseUrl, "/masthead-pages/reviews/finalize", {
      items: [finalizeItem(artifactId, "pending-page")]
    });

    const pending = await getJson(baseUrl, `/masthead-pages/operations/pending/${encodeURIComponent(artifactId)}`);
    expect(pending.operation.operationKind).toBe("publish");

    const missing = await fetch(`${baseUrl}/masthead-pages/operations/pending/artifact%3Amissing`);
    expect(missing.status).toBe(404);
  });

  test("rejects GET prepare and oversized bodies", async () => {
    const { baseUrl } = await startWithEligibleArtifact("session:methods");
    const getResponse = await fetch(`${baseUrl}/masthead-pages/reviews/prepare`);
    expect(getResponse.status).toBe(405);

    const huge = "x".repeat(1_048_576 + 10);
    const oversized = await fetch(`${baseUrl}/masthead-pages/reviews/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ artifactIds: ["a"], pad: huge })
    });
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toMatchObject({ error: { code: "request_body_too_large" } });
  });
});

function finalizeItem(artifactId: string, slug: string) {
  return {
    artifactId,
    publicLogbookId: "6d54c5ab-b8f4-4f01-a3af-e71a5576c8d7",
    pagesAccountId: "account-1",
    slug,
    license: "all-rights-reserved" as const,
    evidenceSelections: []
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
      endedAt: "2026-08-11T18:45:00.000Z"
    },
    narrative: {
      objective: "Ship portable public projection",
      firstUserPrompt: "private",
      latestUserPrompt: "private",
      topics: ["pages"],
      technologies: ["typescript"],
      unresolved: []
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
        evidenceRefs: []
      },
      sessionSummary: {
        text: "Built the narrow session-dossier public projection allowlist.",
        state: "completed",
        confidence: "high",
        evidenceRefs: []
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
          evidenceRefs: []
        },
        continuation: {
          nextStep: "Resolve reviewed evidence",
          openQuestions: [],
          constraints: []
        },
        evidenceRefs: [],
        warnings: []
      }
    }
  } as unknown as PublishedSessionDossierV1;
}

function seedEligibleArtifact(
  db: MastheadDatabase,
  sessionId: string,
  overrides: { keyWork?: string[] } = {}
): string {
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId,
    title: "Pages session"
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
    validation: { ok: true }
  });
  publishSessionArtifact(db, applied.artifactId);
  return applied.artifactId;
}

function publicationReceipt(artifactId: string): MastheadPagesPublicationReceipt {
  return {
    artifactId,
    pageId: "11111111-1111-4111-8111-111111111111",
    objectId: "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    pagesAccountId: "account-1",
    publicLogbookId: "logbook-1",
    localContentFingerprint: "fp",
    egressFingerprint: "egress-1",
    friendlyUrl: "https://masthead.page/@demo/logbook/alpha-page",
    exactUrl:
      "https://masthead.page/@demo/logbook/alpha-page/revisions/sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    publishedAt: "2026-08-11T18:10:00.000Z"
  };
}

async function startWithEligibleArtifact(sessionId = "session:pages-api"): Promise<{
  baseUrl: string;
  artifactId: string;
  db: MastheadDatabase;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-pages-api-"));
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
    storePath
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

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-pages-api-db-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}

function listen(daemon: MastheadDaemon): Promise<string> {
  return new Promise((resolve) => {
    daemon.server.listen(0, "127.0.0.1", () => {
      const address = daemon.server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function waitForCondition(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`POST ${path} failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function getJson(baseUrl: string, path: string): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json" } });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
}
