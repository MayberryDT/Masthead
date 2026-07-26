import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedSession } from "./sessionTestHelpers.ts";
import { getOrCreateDatabaseIdentity, migrateDatabase } from "../schema.ts";
import { openMastheadDatabase } from "../sqlite.ts";
import {
  applySessionArtifact,
  publishSessionArtifact,
  searchPublishedArtifactCapsules,
} from "../sessionArtifactRepository.ts";
import {
  auditV5QualityCorpus,
  invalidateV5QualityCorpusInTransaction,
  invalidateV5QualityCorpusRecovery,
  prepareV5QualityCorpusRecovery,
} from "../v5QualityCorpusRecovery.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("V5 quality corpus recovery", () => {
  test("hash-locks and invalidates only artifacts outside the retained author cohorts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "masthead-v5-quality-corpus-"));
    tempDirs.push(directory);
    const db = await openMastheadDatabase(join(directory, "masthead.sqlite"));
    migrateDatabase(db);
    const databaseId = getOrCreateDatabaseIdentity(db);

    for (const [index, createdBy] of ["quality:strict", "quality:validator", "quality:bad"] .entries()) {
      const sessionId = `session:${index}`;
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: `Session ${index}` });
      const artifact = applySessionArtifact(db, {
        sessionId,
        artifactKind: "runbook",
        contentFingerprint: `fingerprint-${index}`,
        createdBy,
        schemaVersion: "runbook-v1",
        title: `Artifact ${index}`,
        summary: `Specific summary ${index}`,
        content: { index },
        evidenceRefs: [],
        validation: { status: "passed" },
      });
      publishSessionArtifact(db, artifact.artifactId);
    }

    const retainCreatedBy = ["quality:strict", "quality:validator"];
    const audit = auditV5QualityCorpus(db, { retainCreatedBy });
    expect(audit).toMatchObject({
      contractVersion: "v5-quality-corpus-recovery-v1",
      databaseId,
      totalCurrentPublished: 3,
      retainedArtifacts: 2,
      invalidationArtifacts: 1,
      countsByCreatedBy: {
        "quality:bad": 1,
        "quality:strict": 1,
        "quality:validator": 1,
      },
      auditHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      invalidationArtifactIdsHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });

    db.exec("BEGIN IMMEDIATE;");
    const receipt = invalidateV5QualityCorpusInTransaction(db, {
      audit,
      expectedAuditHash: audit.auditHash,
      updatedAt: "2026-07-26T00:00:00.000Z",
    });
    db.exec("COMMIT;");

    expect(receipt).toMatchObject({ invalidatedArtifacts: 1, searchRowsDeleted: 1, retainedArtifacts: 2 });
    expect(searchPublishedArtifactCapsules(db, { q: "Artifact", limit: 10 }).artifacts.map((entry) => entry.title).sort()).toEqual([
      "Artifact 0",
      "Artifact 1",
    ]);
    expect(db.prepare("SELECT created_by AS createdBy, status, publication_status AS publicationStatus FROM session_artifacts ORDER BY created_by").all()).toEqual([
      { createdBy: "quality:bad", status: "superseded", publicationStatus: "invalidated" },
      { createdBy: "quality:strict", status: "current", publicationStatus: "published" },
      { createdBy: "quality:validator", status: "current", publicationStatus: "published" },
    ]);
    db.close();
  });

  test("refuses an audit hash that no longer matches the exact current corpus", async () => {
    const directory = await mkdtemp(join(tmpdir(), "masthead-v5-quality-drift-"));
    tempDirs.push(directory);
    const db = await openMastheadDatabase(join(directory, "masthead.sqlite"));
    migrateDatabase(db);
    getOrCreateDatabaseIdentity(db);
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:bad", title: "Bad" });
    const artifact = applySessionArtifact(db, {
      sessionId: "session:bad",
      artifactKind: "runbook",
      contentFingerprint: "bad-fingerprint",
      createdBy: "quality:bad",
      schemaVersion: "runbook-v1",
      title: "Bad artifact",
      summary: "Bad summary",
      content: {},
      evidenceRefs: [],
      validation: {},
    });
    publishSessionArtifact(db, artifact.artifactId);
    const audit = auditV5QualityCorpus(db, { retainCreatedBy: ["quality:strict"] });

    db.exec("BEGIN IMMEDIATE;");
    expect(() => invalidateV5QualityCorpusInTransaction(db, {
      audit,
      expectedAuditHash: "0".repeat(64),
      updatedAt: "2026-07-26T00:00:00.000Z",
    })).toThrow("v5_quality_corpus_audit_hash_mismatch");
    db.exec("ROLLBACK;");
    db.close();
  });

  test("prepares one verified backup before applying the exact offline recovery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "masthead-v5-quality-offline-"));
    tempDirs.push(directory);
    const databasePath = join(directory, "masthead.sqlite");
    const db = await openMastheadDatabase(databasePath);
    migrateDatabase(db);
    getOrCreateDatabaseIdentity(db);
    for (const [index, createdBy] of ["quality:strict", "quality:bad"].entries()) {
      const sessionId = `session:offline:${index}`;
      seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId, title: `Offline ${index}` });
      const artifact = applySessionArtifact(db, {
        sessionId,
        artifactKind: "runbook",
        contentFingerprint: `offline-${index}`,
        createdBy,
        schemaVersion: "runbook-v1",
        title: `Offline artifact ${index}`,
        summary: `Offline summary ${index}`,
        content: { index },
        evidenceRefs: [],
        validation: {},
      });
      publishSessionArtifact(db, artifact.artifactId);
    }
    db.close();

    const prepared = await prepareV5QualityCorpusRecovery(databasePath, ["quality:strict"]);
    expect(prepared).toMatchObject({
      recoveryVersion: "v5-quality-corpus-recovery-v1",
      databasePath,
      audit: { retainedArtifacts: 1, invalidationArtifacts: 1 },
      backup: {
        backupPath: expect.stringContaining("backup-current"),
        integrityResult: "ok",
        verificationMode: "identity_and_corpus_audit",
      },
    });

    const receipt = await invalidateV5QualityCorpusRecovery(databasePath, prepared, prepared.audit.auditHash);
    expect(receipt).toMatchObject({ invalidatedArtifacts: 1, retainedArtifacts: 1 });
    const reopened = await openMastheadDatabase(databasePath);
    expect(reopened.prepare("SELECT COUNT(*) AS count FROM session_artifacts WHERE status = 'current' AND publication_status = 'published'").get()).toEqual({ count: 1 });
    expect(reopened.prepare("SELECT COUNT(*) AS count FROM session_artifact_search").get()).toEqual({ count: 1 });
    reopened.close();
  });
});
