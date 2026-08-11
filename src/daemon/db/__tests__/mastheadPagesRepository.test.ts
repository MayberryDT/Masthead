import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { seedSession } from "./sessionTestHelpers.ts";
import {
  getMastheadPagesMapping,
  getPendingMastheadPagesOperation,
  markMastheadPagesRemoved,
  recordMastheadPagesFailure,
  recordMastheadPagesPublication,
  stageMastheadPagesPublication,
  stageMastheadPagesRemoval,
  type MastheadPagesPublicationReceipt
} from "../mastheadPagesRepository.ts";
import {
  applySessionArtifact,
  getSessionArtifact,
  publishSessionArtifact
} from "../sessionArtifactRepository.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("masthead pages release mappings", () => {
  test("stores the private chain without changing the local artifact", async () => {
    const db = await testDb();
    const artifactId = seedPublishedArtifact(db, "fingerprint-live");
    const before = getSessionArtifact(db, artifactId);
    const receipt = publicationReceipt(artifactId, "fingerprint-live");

    recordMastheadPagesPublication(db, receipt);

    expect(getSessionArtifact(db, artifactId)).toEqual(before);
    expect(getMastheadPagesMapping(db, artifactId)).toMatchObject({
      pageId: receipt.pageId,
      objectId: receipt.objectId,
      status: "live"
    });
  });

  test("stages publication request bytes before network transfer and survives reopen", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-pages-mapping-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "masthead.sqlite");
    const db = await openMastheadDatabase(databasePath);
    migrateDatabase(db);
    const artifactId = seedPublishedArtifact(db, "fingerprint-stage");
    const requestJson = JSON.stringify({
      protocolVersion: "masthead-pages-publish-v1",
      publicLogbookId: "logbook-1",
      slug: "alpha-page",
      idempotencyKey: "idem-publish-1",
      objectId: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      object: { title: "Alpha" }
    });
    const stagedAt = "2026-08-11T18:00:00.000Z";

    stageMastheadPagesPublication(db, {
      artifactId,
      pagesAccountId: "account-1",
      publicLogbookId: "logbook-1",
      localContentFingerprint: "fingerprint-stage",
      egressFingerprint: "egress-stage",
      requestJson,
      requestDigest: "sha256:request-digest-1",
      idempotencyKey: "idem-publish-1",
      stagedAt
    });

    expect(getPendingMastheadPagesOperation(db, artifactId)).toEqual({
      lineageId: expect.any(String),
      sourceArtifactId: artifactId,
      operationKind: "publish",
      requestJson,
      requestDigest: "sha256:request-digest-1",
      idempotencyKey: "idem-publish-1",
      stagedAt
    });
    expect(getMastheadPagesMapping(db, artifactId)).toMatchObject({
      status: "none",
      pendingOperationKind: "publish",
      pendingRequestJson: requestJson,
      pendingRequestDigest: "sha256:request-digest-1",
      pendingIdempotencyKey: "idem-publish-1",
      pendingStagedAt: stagedAt
    });

    db.close();
    const reopened = await openMastheadDatabase(databasePath);
    const pending = getPendingMastheadPagesOperation(reopened, artifactId);
    expect(pending?.requestJson).toBe(requestJson);
    expect(Buffer.from(pending!.requestJson, "utf8").equals(Buffer.from(requestJson, "utf8"))).toBe(true);
    reopened.close();
  });

  test("success clears pending data and a retryable failure retains it", async () => {
    const db = await testDb();
    const artifactId = seedPublishedArtifact(db, "fingerprint-retry");
    const requestJson = '{"kind":"publish","n":1}';

    stageMastheadPagesPublication(db, {
      artifactId,
      pagesAccountId: "account-1",
      publicLogbookId: "logbook-1",
      localContentFingerprint: "fingerprint-retry",
      egressFingerprint: "egress-retry",
      requestJson,
      requestDigest: "digest-retry",
      idempotencyKey: "idem-retry",
      stagedAt: "2026-08-11T18:05:00.000Z"
    });

    recordMastheadPagesFailure(db, artifactId, {
      errorClass: "temporarily-unavailable",
      message: "hosted timeout",
      retryable: true,
      recordedAt: "2026-08-11T18:06:00.000Z"
    });

    expect(getPendingMastheadPagesOperation(db, artifactId)).toMatchObject({
      operationKind: "publish",
      requestJson,
      requestDigest: "digest-retry",
      idempotencyKey: "idem-retry"
    });
    expect(getMastheadPagesMapping(db, artifactId)).toMatchObject({
      status: "none",
      lastErrorClass: "temporarily-unavailable",
      lastErrorMessage: "hosted timeout",
      pendingRequestJson: requestJson
    });

    const receipt = publicationReceipt(artifactId, "fingerprint-retry");
    recordMastheadPagesPublication(db, receipt);

    expect(getPendingMastheadPagesOperation(db, artifactId)).toBeUndefined();
    const live = getMastheadPagesMapping(db, artifactId);
    expect(live).toMatchObject({
      pageId: receipt.pageId,
      objectId: receipt.objectId,
      status: "live"
    });
    expect(live).not.toHaveProperty("lastErrorClass");
    expect(live).not.toHaveProperty("pendingOperationKind");
    expect(live).not.toHaveProperty("pendingRequestJson");
  });

  test("non-retryable failure clears pending data and marks failed", async () => {
    const db = await testDb();
    const artifactId = seedPublishedArtifact(db, "fingerprint-fail");

    stageMastheadPagesPublication(db, {
      artifactId,
      pagesAccountId: "account-1",
      publicLogbookId: "logbook-1",
      localContentFingerprint: "fingerprint-fail",
      egressFingerprint: "egress-fail",
      requestJson: '{"kind":"publish"}',
      requestDigest: "digest-fail",
      idempotencyKey: "idem-fail"
    });

    recordMastheadPagesFailure(db, artifactId, {
      errorClass: "content-blocked",
      message: "blocked by policy",
      retryable: false
    });

    expect(getPendingMastheadPagesOperation(db, artifactId)).toBeUndefined();
    expect(getMastheadPagesMapping(db, artifactId)).toMatchObject({
      status: "failed",
      lastErrorClass: "content-blocked",
      lastErrorMessage: "blocked by policy"
    });
  });

  test("resolves mappings by lineage across local artifact revisions", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:pages",
      title: "Pages session"
    });
    const first = applySessionArtifact(db, {
      artifactKind: "runbook",
      content: { title: "First runbook" },
      contentFingerprint: "fingerprint-v1",
      createdBy: "workbench_cli",
      evidenceRefs: ["message:session:pages:message"],
      schemaVersion: "runbook-v1",
      sessionId: "session:pages",
      signatureKey: "signature:shared-lineage",
      title: "First runbook",
      validation: { ok: true }
    });
    publishSessionArtifact(db, first.artifactId);
    const receipt = publicationReceipt(first.artifactId, "fingerprint-v1");
    recordMastheadPagesPublication(db, receipt);

    const second = applySessionArtifact(db, {
      artifactKind: "runbook",
      content: { title: "Second runbook" },
      contentFingerprint: "fingerprint-v2",
      createdBy: "workbench_cli",
      evidenceRefs: ["message:session:pages:message"],
      schemaVersion: "runbook-v1",
      sessionId: "session:pages",
      signatureKey: "signature:shared-lineage",
      title: "Second runbook",
      validation: { ok: true }
    });
    publishSessionArtifact(db, second.artifactId);

    const secondRecord = getSessionArtifact(db, second.artifactId)!;
    expect(secondRecord.lineageId).toBe(first.lineageId);
    expect(getMastheadPagesMapping(db, second.artifactId)).toMatchObject({
      lineageId: first.lineageId,
      pageId: receipt.pageId,
      objectId: receipt.objectId,
      sourceArtifactId: first.artifactId,
      status: "live"
    });
  });

  test("stages removal, marks removed, and leaves the local artifact untouched", async () => {
    const db = await testDb();
    const artifactId = seedPublishedArtifact(db, "fingerprint-remove");
    recordMastheadPagesPublication(db, publicationReceipt(artifactId, "fingerprint-remove"));
    const before = getSessionArtifact(db, artifactId);
    const removalJson = JSON.stringify({
      protocolVersion: "masthead-pages-remove-v1",
      pageId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "idem-remove-1"
    });

    stageMastheadPagesRemoval(db, {
      artifactId,
      requestJson: removalJson,
      requestDigest: "digest-remove",
      idempotencyKey: "idem-remove-1",
      stagedAt: "2026-08-11T19:00:00.000Z"
    });

    expect(getPendingMastheadPagesOperation(db, artifactId)).toMatchObject({
      operationKind: "remove",
      requestJson: removalJson,
      requestDigest: "digest-remove",
      idempotencyKey: "idem-remove-1"
    });

    markMastheadPagesRemoved(db, artifactId, "2026-08-11T19:01:00.000Z");

    expect(getSessionArtifact(db, artifactId)).toEqual(before);
    expect(getPendingMastheadPagesOperation(db, artifactId)).toBeUndefined();
    expect(getMastheadPagesMapping(db, artifactId)).toMatchObject({
      status: "removed",
      removedAt: "2026-08-11T19:01:00.000Z",
      pageId: "11111111-1111-4111-8111-111111111111"
    });
  });

  test("enforces one mapping row per lineage", async () => {
    const db = await testDb();
    const artifactId = seedPublishedArtifact(db, "fingerprint-unique");
    const receipt = publicationReceipt(artifactId, "fingerprint-unique");
    recordMastheadPagesPublication(db, receipt);

    expect(() => {
      db.prepare(
        `INSERT INTO masthead_pages_release_mappings (
          lineage_id, source_artifact_id, local_content_fingerprint, pages_account_id,
          public_logbook_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'none', ?, ?)`
      ).run(
        getSessionArtifact(db, artifactId)!.lineageId,
        "artifact:duplicate",
        "other",
        "account-2",
        "logbook-2",
        "2026-08-11T20:00:00.000Z",
        "2026-08-11T20:00:00.000Z"
      );
    }).toThrow(/UNIQUE/i);
  });
});

function seedPublishedArtifact(db: MastheadDatabase, contentFingerprint: string, title = "Pages dossier"): string {
  seedSession(db, {
    lifecycle: "ended",
    model: "gpt-5",
    project: "Masthead",
    sessionId: "session:pages",
    title: "Pages session"
  });
  const applied = applySessionArtifact(db, {
    artifactKind: "session_dossier",
    content: { title },
    contentFingerprint,
    createdBy: "workbench_cli",
    evidenceRefs: ["message:session:pages:message"],
    schemaVersion: "session_dossier-v1",
    sessionId: "session:pages",
    title,
    validation: { ok: true }
  });
  publishSessionArtifact(db, applied.artifactId);
  return applied.artifactId;
}

function publicationReceipt(artifactId: string, localContentFingerprint: string): MastheadPagesPublicationReceipt {
  return {
    artifactId,
    pageId: "11111111-1111-4111-8111-111111111111",
    objectId: "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    parentObjectId: "sha256-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    pagesAccountId: "account-1",
    publicLogbookId: "logbook-1",
    localContentFingerprint,
    egressFingerprint: "egress-1",
    friendlyUrl: "https://masthead.page/@demo/logbook/alpha-page",
    exactUrl:
      "https://masthead.page/@demo/logbook/alpha-page/revisions/sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    publishedAt: "2026-08-11T18:10:00.000Z"
  };
}

async function testDb(): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-pages-mapping-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  migrateDatabase(db);
  return db;
}
