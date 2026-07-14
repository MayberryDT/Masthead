import { access, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { seedSession } from "./sessionTestHelpers.ts";
import { migrateTestDatabaseThrough } from "./schemaTestHelpers.ts";
import { getSessionDossier } from "../sessionDossierRepository.ts";
import {
  applySessionArtifact,
  applySessionArtifactInTransaction,
  auditFailedV1Generation,
  FAILED_V1_DOSSIER_COUNT,
  invalidateFailedV1Generation,
  listSessionArtifacts,
  publishSessionArtifact,
  publishSessionArtifactInTransaction,
  searchPublishedArtifactCapsules,
  wipePublishedArtifactState
} from "../sessionArtifactRepository.ts";
import { getOrCreateDatabaseIdentity, migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import { createSingleConsistentBackup } from "../../databaseBackup.ts";
import { acquireDatabaseWriterLock, acquireLegacyDataDirectoryGuard } from "../../../core/daemonOwnership.ts";
import { fingerprintWorkbenchOutput } from "../../../workbench/applyArtifact.ts";
import {
  buildPublishedDossierSnapshot,
  dossierSnapshotFingerprint
} from "../../../workbench/authoring/dossierSnapshot.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("session artifact repository", () => {
  test("applies artifacts idempotently by fingerprint", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Artifact session" });

    const first = applySessionArtifact(db, artifactInput("fingerprint-1", "First dossier"));
    const second = applySessionArtifact(db, artifactInput("fingerprint-1", "First dossier"));

    expect(second.artifactId).toBe(first.artifactId);
    expect(listSessionArtifacts(db, { sessionId: "session:abc" })).toEqual([
      expect.objectContaining({ artifactId: first.artifactId, publicationStatus: "applied", status: "current", title: "First dossier" })
    ]);
  });

  test("lets a caller roll back apply and publish in one owned transaction", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:abc",
      title: "Atomic artifact"
    });

    db.exec("BEGIN IMMEDIATE;");
    const applied = applySessionArtifactInTransaction(db, artifactInput("atomic-fingerprint", "Atomic dossier"));
    publishSessionArtifactInTransaction(db, applied.artifactId);
    db.exec("ROLLBACK;");

    expect(listSessionArtifacts(db, { sessionId: "session:abc" })).toEqual([]);
  });

  test("normalizes signature keys at the repository persistence boundary", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:abc",
      title: "Signature normalization"
    });

    const signed = applySessionArtifact(db, {
      ...runbookInput("signature-normalized", "Normalized signature"),
      signatureKey: "  signature:cache-lock  "
    });
    const unsigned = applySessionArtifact(db, {
      ...runbookInput("signature-blank", "Blank signature"),
      signatureKey: " \t "
    });

    expect(signed.signatureKey).toBe("signature:cache-lock");
    expect(unsigned.signatureKey).toBeUndefined();
  });

  test("supersedes prior current artifact for the same session and kind", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Artifact session" });

    const first = applySessionArtifact(db, artifactInput("fingerprint-1", "First dossier"));
    const second = applySessionArtifact(db, artifactInput("fingerprint-2", "Second dossier"));

    expect(second.artifactId).not.toBe(first.artifactId);
    expect(listSessionArtifacts(db, { sessionId: "session:abc" })).toEqual([
      expect.objectContaining({ artifactId: second.artifactId, status: "current", title: "Second dossier" }),
      expect.objectContaining({ artifactId: first.artifactId, status: "superseded", title: "First dossier" })
    ]);
  });

  test("stores multi-session provenance and requires join rationale", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:a", title: "A" });
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:b", title: "B" });

    expect(() =>
      applySessionArtifact(db, {
        ...runbookInput("fp-multi", "Shared runbook", "session:a"),
        provenanceSessionIds: ["session:a", "session:b"]
      })
    ).toThrow(/joinRationale/i);

    const artifact = applySessionArtifact(db, {
      ...runbookInput("fp-multi", "Shared runbook", "session:a"),
      joinRationale: "shared error signature: ENOENT cache lock",
      provenanceSessionIds: ["session:a", "session:b"]
    });

    expect(artifact.provenanceSessionIds).toEqual(["session:a", "session:b"]);
    expect(artifact.joinRationale).toContain("ENOENT");
    expect(listSessionArtifacts(db, { sessionId: "session:b" })[0]?.artifactId).toBe(artifact.artifactId);
  });

  test("rejects multi-session provenance for session_dossier", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:a", title: "A" });
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:b", title: "B" });

    expect(() =>
      applySessionArtifact(db, {
        ...artifactInput("fp", "Dossier"),
        joinRationale: "nope",
        provenanceSessionIds: ["session:a", "session:b"]
      })
    ).toThrow(/exactly one session/i);
  });

  test("supersedes by signature key across sessions and preserves lineage", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:a", title: "A" });
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:b", title: "B" });

    const first = applySessionArtifact(db, {
      ...runbookInput("fp-1", "Runbook v1", "session:a"),
      signatureKey: "sig:cache-lock"
    });
    const second = applySessionArtifact(db, {
      ...runbookInput("fp-2", "Runbook v2", "session:b"),
      joinRationale: "same failure signature",
      provenanceSessionIds: ["session:a", "session:b"],
      signatureKey: "sig:cache-lock"
    });

    expect(second.lineageId).toBe(first.lineageId);
    expect(listSessionArtifacts(db, { artifactKind: "runbook" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifactId: second.artifactId, status: "current", title: "Runbook v2" }),
        expect.objectContaining({ artifactId: first.artifactId, status: "superseded", title: "Runbook v1" })
      ])
    );
  });

  test("publish makes artifact searchable in Logbook capsules only after publish", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Artifact session" });

    const applied = applySessionArtifact(db, {
      ...runbookInput("fp-pub", "Published runbook"),
      projectLabel: "Masthead",
      summary: "Fix cache lock races"
    });
    expect(searchPublishedArtifactCapsules(db).total).toBe(0);

    const published = publishSessionArtifact(db, applied.artifactId)!;
    expect(published.publicationStatus).toBe("published");
    expect(published.publishedAt).toBeTruthy();

    const search = searchPublishedArtifactCapsules(db, { kind: "runbook", q: "cache" });
    expect(search.total).toBe(1);
    expect(search.artifacts[0]).toMatchObject({
      artifactId: applied.artifactId,
      kind: "runbook",
      project: "Masthead",
      title: "Published runbook"
    });
  });

  test("finds a published artifact by a body-only phrase", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:abc",
      title: "Body search"
    });
    const artifact = applySessionArtifact(db, {
      ...runbookInput("fp-body-search", "Repair cache lock"),
      content: {
        fixSteps: ["Close the inherited descriptor before retrying."],
        rootCause: "orphaned flock descriptor after worker cancellation",
        title: "Repair cache lock"
      }
    });
    publishSessionArtifact(db, artifact.artifactId);

    expect(
      searchPublishedArtifactCapsules(db, { q: "orphaned flock descriptor" }).artifacts.map(
        (entry) => entry.artifactId
      )
    ).toEqual([artifact.artifactId]);
  });

  test.each([
    ["title", "Canonical OAuth repair"],
    ["narrative", "callback state mismatch"],
    ["topic", "redirect-security"],
    ["technology", "TypeScript"],
    ["file", "callback-router"],
    ["tool", "oauth_probe"],
    ["verification", "callback smoke test"],
    ["attention", "stale client secret"]
  ])("indexes canonical dossier %s text explicitly", async (_label, query) => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:canonical-search",
      title: "Canonical OAuth repair"
    });
    const canonical = getSessionDossier(db, "session:canonical-search")!;
    const snapshot = buildPublishedDossierSnapshot(canonical, "2026-07-12T18:00:00.000Z");
    snapshot.narrative.objective = "Repair the callback state mismatch in the OAuth return path.";
    snapshot.narrative.topics = ["redirect-security"];
    snapshot.narrative.technologies = ["TypeScript"];
    snapshot.files[0]!.displayPath = "src/auth/callback-router.ts";
    snapshot.files[0]!.basename = "callback-router.ts";
    snapshot.tools[0]!.toolName = "oauth_probe";
    snapshot.verification = {
      commands: [],
      status: "passed",
      summary: "Verification passed with the callback smoke test."
    };
    snapshot.attention = [
      {
        detail: "The OAuth client secret must be replaced before deployment.",
        kind: "high_risk_change",
        severity: "P1",
        sourceRefs: [],
        title: "Rotate the stale client secret"
      }
    ];
    const artifact = applySessionArtifact(db, {
      artifactKind: "session_dossier",
      content: snapshot,
      contentFingerprint: dossierSnapshotFingerprint(snapshot),
      createdBy: "workbench_authoring_v2:test",
      evidenceRefs: [],
      schemaVersion: snapshot.snapshotVersion,
      sessionId: snapshot.identity.sessionId,
      title: snapshot.identity.title,
      validation: { canonicalSnapshot: true }
    });
    publishSessionArtifact(db, artifact.artifactId);

    expect(searchPublishedArtifactCapsules(db, { q: query }).artifacts).toEqual([
      expect.objectContaining({ artifactId: artifact.artifactId })
    ]);
    db.close();
  });

  test("sanitizes FTS syntax and treats punctuation-only queries as unfiltered", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:abc",
      title: "Sanitized search"
    });
    const artifact = applySessionArtifact(db, {
      ...runbookInput("fp-sanitized-search", "Repair parser"),
      content: { rootCause: "worker cancellation broke the parser", title: "Repair parser" }
    });
    publishSessionArtifact(db, artifact.artifactId);

    expect(() => searchPublishedArtifactCapsules(db, { q: 'worker OR "unterminated' })).not.toThrow();
    expect(searchPublishedArtifactCapsules(db, { q: "worker*" }).artifacts).toEqual([
      expect.objectContaining({ artifactId: artifact.artifactId })
    ]);
    expect(searchPublishedArtifactCapsules(db, { q: "!!! (( ))" }).artifacts).toEqual([
      expect.objectContaining({ artifactId: artifact.artifactId })
    ]);
  });

  test("removes superseded artifacts from body search and indexes the published replacement", async () => {
    const db = await testDb();
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:abc",
      title: "Superseded search"
    });
    const first = applySessionArtifact(db, {
      ...runbookInput("fp-old-search", "Old runbook"),
      content: { rootCause: "legacy descriptor leak", title: "Old runbook" },
      signatureKey: "signature:descriptor-lock"
    });
    publishSessionArtifact(db, first.artifactId);
    expect(searchPublishedArtifactCapsules(db, { q: "legacy descriptor" }).total).toBe(1);

    const replacement = applySessionArtifact(db, {
      ...runbookInput("fp-new-search", "New runbook"),
      content: { rootCause: "replacement ownership race", title: "New runbook" },
      signatureKey: "signature:descriptor-lock"
    });

    expect(searchPublishedArtifactCapsules(db, { q: "legacy descriptor" }).total).toBe(0);
    expect(searchPublishedArtifactCapsules(db, { q: "replacement ownership" }).total).toBe(0);
    publishSessionArtifact(db, replacement.artifactId);
    expect(searchPublishedArtifactCapsules(db, { q: "replacement ownership" }).artifacts).toEqual([
      expect.objectContaining({ artifactId: replacement.artifactId })
    ]);
  });

  test.each([
    { label: "blank", signatureKey: " " },
    { label: "different", signatureKey: "signature:different" }
  ])(
    "reindexes the persisted signature scope when a published fingerprint is reactivated with a $label signature",
    async ({ signatureKey }) => {
      const db = await testDb();
      seedSession(db, {
        lifecycle: "ended",
        model: "gpt-5",
        project: "Masthead",
        sessionId: "session:a",
        title: "Original signature artifact"
      });
      seedSession(db, {
        lifecycle: "ended",
        model: "gpt-5",
        project: "Masthead",
        sessionId: "session:b",
        title: "Replacement signature artifact"
      });
      const originalInput = {
        ...runbookInput("fp-reactivated", "Original runbook", "session:a"),
        content: { rootCause: "legacy descriptor ownership", title: "Original runbook" },
        signatureKey: "signature:descriptor-ownership"
      };
      const original = applySessionArtifact(db, originalInput);
      publishSessionArtifact(db, original.artifactId);
      const replacement = applySessionArtifact(db, {
        ...runbookInput("fp-replacement", "Replacement runbook", "session:b"),
        content: { rootCause: "replacement descriptor ownership", title: "Replacement runbook" },
        signatureKey: "signature:descriptor-ownership"
      });
      publishSessionArtifact(db, replacement.artifactId);

      const reactivated = applySessionArtifact(db, { ...originalInput, signatureKey });

      expect(reactivated).toMatchObject({ artifactId: original.artifactId, status: "current" });
      expect(searchPublishedArtifactCapsules(db, { q: "legacy descriptor ownership" }).artifacts).toEqual([
        expect.objectContaining({ artifactId: original.artifactId })
      ]);
      expect(searchPublishedArtifactCapsules(db, { q: "replacement descriptor ownership" }).total).toBe(0);
      expect(
        db
          .prepare(
            `SELECT artifact_id AS artifactId
             FROM session_artifact_search
             WHERE artifact_id IN (?, ?)
             ORDER BY artifact_id`
          )
          .all(original.artifactId, replacement.artifactId)
      ).toEqual([{ artifactId: original.artifactId }]);
      expect(listSessionArtifacts(db, { artifactKind: "runbook" })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ artifactId: original.artifactId, status: "current" }),
          expect.objectContaining({ artifactId: replacement.artifactId, status: "superseded" })
        ])
      );
    }
  );

  test("filters published artifacts by published_at dateFrom/dateTo bounds", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Artifact session" });

    // Publish each before applying the next so applied drafts are not superseded.
    const early = applySessionArtifact(db, {
      ...runbookInput("fp-early", "Early runbook"),
      projectLabel: "Masthead"
    });
    publishSessionArtifact(db, early.artifactId);
    const mid = applySessionArtifact(db, {
      ...runbookInput("fp-mid", "Mid runbook"),
      projectLabel: "Masthead"
    });
    publishSessionArtifact(db, mid.artifactId);
    const late = applySessionArtifact(db, {
      ...runbookInput("fp-late", "Late runbook"),
      projectLabel: "Masthead"
    });
    publishSessionArtifact(db, late.artifactId);

    setPublishedAt(db, early.artifactId, "2026-06-01T12:00:00.000Z");
    setPublishedAt(db, mid.artifactId, "2026-06-15T12:00:00.000Z");
    setPublishedAt(db, late.artifactId, "2026-06-30T12:00:00.000Z");

    const fromOnly = searchPublishedArtifactCapsules(db, { dateFrom: "2026-06-15" });
    expect(fromOnly.total).toBe(2);
    expect(fromOnly.artifacts.map((a) => a.artifactId).sort()).toEqual([late.artifactId, mid.artifactId].sort());

    const toOnly = searchPublishedArtifactCapsules(db, { dateTo: "2026-06-15" });
    expect(toOnly.total).toBe(2);
    expect(toOnly.artifacts.map((a) => a.artifactId).sort()).toEqual([early.artifactId, mid.artifactId].sort());

    const range = searchPublishedArtifactCapsules(db, {
      dateFrom: "2026-06-10",
      dateTo: "2026-06-20"
    });
    expect(range.total).toBe(1);
    expect(range.artifacts[0]?.artifactId).toBe(mid.artifactId);

    const isoRange = searchPublishedArtifactCapsules(db, {
      dateFrom: "2026-06-15T00:00:00.000Z",
      dateTo: "2026-06-15T23:59:59.999Z"
    });
    expect(isoRange.total).toBe(1);
    expect(isoRange.artifacts[0]?.artifactId).toBe(mid.artifactId);
  });

  test("wipe removes artifacts and provenance for dogfood cutover", async () => {
    const db = await testDb();
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:abc", title: "Artifact session" });
    const artifact = applySessionArtifact(db, runbookInput("fp-wipe", "Wipe me"));
    publishSessionArtifact(db, artifact.artifactId);

    const result = wipePublishedArtifactState(db);
    expect(result.artifactsDeleted).toBeGreaterThan(0);
    expect(listSessionArtifacts(db)).toEqual([]);
    expect(searchPublishedArtifactCapsules(db).total).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_artifact_search").get()).toEqual({ count: 0 });
  });

  test("audits only the exact 1,283-dossier failed V1 generation without mutation", async () => {
    const db = await testDb();
    seedExactFailedV1Generation(db);
    const changesBefore = totalChanges(db);

    const audit = auditFailedV1Generation(db);

    expect(audit).toMatchObject({
      adrs: 0,
      contractVersion: "workbench-authoring-v1",
      dossiers: FAILED_V1_DOSSIER_COUNT,
      incidentTimelines: 0,
      runbooks: 0,
      totalArtifacts: FAILED_V1_DOSSIER_COUNT,
      totalRuns: 66,
      totalSessions: FAILED_V1_DOSSIER_COUNT
    });
    expect(audit.counts.byKind).toEqual({ session_dossier: FAILED_V1_DOSSIER_COUNT });
    expect(audit.counts.byStatus).toEqual({ "current/published": FAILED_V1_DOSSIER_COUNT });
    expect(audit.auditHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(totalChanges(db)).toBe(changesBefore);
  }, 60_000);

  test("audits the exact failed V1 generation from a schema 21 database", async () => {
    const db = await testDb(21);
    seedExactFailedV1Generation(db, { schema21: true });

    expect(auditFailedV1Generation(db)).toMatchObject({
      contractVersion: "workbench-authoring-v1",
      dossiers: FAILED_V1_DOSSIER_COUNT,
      totalArtifacts: FAILED_V1_DOSSIER_COUNT,
      totalRuns: 66,
      totalSessions: FAILED_V1_DOSSIER_COUNT
    });
  }, 60_000);

  test("refuses an otherwise exact 1,283-dossier and 66-run population with useful non-template dossiers", async () => {
    const db = await testDb();
    seedExactFailedV1Generation(db, { usefulDossiers: true });

    expect(() => auditFailedV1Generation(db)).toThrow("template_signature");
  }, 60_000);

  test("refuses mixed V1 populations and detects relevant state changes by audit hash", async () => {
    const db = await testDb();
    seedExactFailedV1Generation(db);
    const audit = auditFailedV1Generation(db);
    db.prepare(
      "UPDATE workbench_session_state SET adr_status = 'required' WHERE session_id = 'session:failed-v1:0000'"
    ).run();
    expect(() => invalidateFailedV1Generation(db, audit.auditHash)).toThrow("audit_hash_mismatch");

    db.prepare(
      `INSERT INTO session_artifacts (
         artifact_id, session_id, artifact_kind, status, content_fingerprint, created_at, updated_at,
         created_by, schema_version, title, content_json, evidence_refs_json, validation_json,
         publication_status, lineage_id, published_at
       ) VALUES (?, ?, 'runbook', 'current', ?, ?, ?, ?, 'runbook-v2', ?, ?, '[]', ?, 'published', ?, ?)`
    ).run(
      "artifact:mixed-v1",
      "session:failed-v1:0000",
      "mixed-fingerprint",
      FAILED_CREATED_AT,
      FAILED_PUBLISHED_AT,
      "workbench_authoring:failed-agent",
      "Mixed artifact",
      JSON.stringify({ title: "Mixed artifact" }),
      JSON.stringify({ contract: "workbench-authoring-v1", ok: true, schemaVersion: "runbook-v2" }),
      "artifact:mixed-v1",
      FAILED_PUBLISHED_AT
    );
    expect(() => auditFailedV1Generation(db)).toThrow("ambiguous_population");
  }, 60_000);

  test("invalidates exact failed output, preserves V1 audit history, resets N/A, and rolls back every boundary", async () => {
    const db = await testDb();
    seedExactFailedV1Generation(db);
    const audit = auditFailedV1Generation(db);
    const before = recoveryCounts(db);
    const boundaries = [
      "search_deleted",
      "provenance_deleted",
      "artifacts_deleted",
      "pipeline_reset",
      "claims_released",
      "activity_recorded"
    ] as const;
    for (const failedBoundary of boundaries) {
      expect(() => invalidateFailedV1Generation(db, audit.auditHash, {
        onMutationBoundary(boundary) {
          if (boundary === failedBoundary) throw new Error(`injected:${boundary}`);
        }
      })).toThrow(`injected:${failedBoundary}`);
      expect(recoveryCounts(db)).toEqual(before);
      expect(auditFailedV1Generation(db).auditHash).toBe(audit.auditHash);
    }

    const receipt = invalidateFailedV1Generation(db, audit.auditHash);

    expect(receipt).toMatchObject({
      artifactsInvalidated: FAILED_V1_DOSSIER_COUNT,
      auditHash: audit.auditHash,
      provenanceDeleted: FAILED_V1_DOSSIER_COUNT,
      searchRowsDeleted: FAILED_V1_DOSSIER_COUNT,
      sessionsReset: FAILED_V1_DOSSIER_COUNT
    });
    expect(recoveryCounts(db)).toMatchObject({
      activities: 1,
      artifacts: 0,
      provenance: 0,
      runs: before.runs,
      search: 0
    });
    expect(db.prepare(
      `SELECT publication_status AS publicationStatus, next_action AS nextAction,
              session_dossier_status AS sessionDossierStatus, session_package_status AS sessionPackageStatus,
              resolution_status AS resolutionStatus, runbook_status AS runbookStatus,
              adr_status AS adrStatus, incident_timeline_status AS incidentTimelineStatus
       FROM workbench_session_state WHERE session_id = 'session:failed-v1:0000'`
    ).get()).toEqual({
      adrStatus: "unknown",
      incidentTimelineStatus: "unknown",
      nextAction: "create_dossier",
      publicationStatus: "publish_path",
      resolutionStatus: "in_progress",
      runbookStatus: "unknown",
      sessionDossierStatus: "missing",
      sessionPackageStatus: "missing"
    });
    expect(db.prepare(
      "SELECT released_at AS releasedAt, release_reason AS releaseReason FROM workbench_claims WHERE claim_id = 'claim:failed-v1:0000'"
    ).get()).toMatchObject({ releaseReason: "failed_v1_generation_recovery", releasedAt: expect.any(String) });
    expect(db.prepare(
      "SELECT details_json AS detailsJson FROM workbench_activity WHERE event_type = 'failed_v1_generation_recovered'"
    ).get()).toMatchObject({ detailsJson: expect.stringContaining(audit.auditHash) });
    expect(db.prepare(
      "SELECT COUNT(*) AS count FROM workbench_authoring_runs WHERE status = 'completed' AND receipt_json IS NOT NULL"
    ).get()).toEqual({ count: before.runs });
  }, 60_000);

  test("online backup includes committed WAL state, keeps one snapshot, validates identity, and refuses a writer lease", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-recovery-backup-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "masthead.sqlite");
    const db = await openMastheadDatabase(databasePath);
    migrateDatabase(db);
    const databaseId = getOrCreateDatabaseIdentity(db);
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:wal-backup",
      title: "Committed WAL backup"
    });

    const first = await createSingleConsistentBackup(databasePath);
    seedSession(db, {
      lifecycle: "ended",
      model: "gpt-5",
      project: "Masthead",
      sessionId: "session:wal-backup-two",
      title: "Second committed WAL row"
    });
    const second = await createSingleConsistentBackup(databasePath);
    expect(second).toMatchObject({ databaseId, integrityResult: "ok", sizeBytes: expect.any(Number) });
    expect(second.backupPath).toBe(first.backupPath);
    expect((await readdir(tempDir)).filter((name) => name.startsWith("masthead.sqlite.backup-"))).toEqual([
      second.backupPath.split("/").at(-1)
    ]);
    const backupDb = new DatabaseSync(second.backupPath, { readOnly: true });
    expect(backupDb.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 2 });
    backupDb.close();

    const lease = await acquireDatabaseWriterLock(databasePath);
    try {
      await expect(createSingleConsistentBackup(databasePath)).rejects.toThrow("already leased");
    } finally {
      await lease.release();
      db.close();
    }
  });

  test("backup preserves the prior verified snapshot across every staged failure and releases both ownership layers", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-recovery-backup-failure-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "masthead.sqlite");
    const db = await openMastheadDatabase(databasePath);
    migrateDatabase(db);
    getOrCreateDatabaseIdentity(db);
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:old", title: "Old" });
    const prior = await createSingleConsistentBackup(databasePath);
    const priorBytes = await readFile(prior.backupPath);
    seedSession(db, { lifecycle: "ended", model: "gpt-5", project: "Masthead", sessionId: "session:new", title: "New" });

    for (const failedBoundary of ["backup", "normalize", "verify", "finalize"] as const) {
      await expect(createSingleConsistentBackup(databasePath, {
        onBoundary(boundary) {
          if (boundary === failedBoundary) throw new Error(`injected:${boundary}`);
        }
      })).rejects.toThrow(`injected:${failedBoundary}`);
      expect(await readFile(prior.backupPath)).toEqual(priorBytes);
      const entries = await readdir(tempDir);
      expect(entries.filter((name) => name.startsWith("masthead.sqlite.backup-"))).toEqual([
        prior.backupPath.split("/").at(-1)
      ]);
      expect(entries.some((name) => name.includes("recovery-stage"))).toBe(false);
    }

    const retry = await createSingleConsistentBackup(databasePath);
    const retryDb = new DatabaseSync(retry.backupPath, { readOnly: true });
    expect(retryDb.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 2 });
    retryDb.close();
    db.close();
  });

  test("backup mirrors full daemon ownership and rejects legacy guards, alternate writers, and outside symlink targets", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "masthead-recovery-ownership-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "masthead-recovery-outside-"));
    tempDirs.push(tempDir, outsideDir);
    const databasePath = join(tempDir, "masthead.sqlite");
    const db = await openMastheadDatabase(databasePath);
    migrateDatabase(db);
    getOrCreateDatabaseIdentity(db);
    db.close();

    const legacyGuard = await acquireLegacyDataDirectoryGuard(tempDir);
    try {
      await expect(createSingleConsistentBackup(databasePath)).rejects.toThrow("owns canonical data directory");
    } finally {
      await legacyGuard.release();
    }

    const alternatePath = join(tempDir, "alternate.sqlite");
    const alternateWriter = await acquireDatabaseWriterLock(alternatePath);
    const alternateGuard = await acquireLegacyDataDirectoryGuard(tempDir);
    try {
      await expect(createSingleConsistentBackup(databasePath)).rejects.toThrow("owns canonical data directory");
    } finally {
      await alternateGuard.release();
      await alternateWriter.release();
    }

    const outsidePath = join(outsideDir, "outside.sqlite");
    const outsideDb = await openMastheadDatabase(outsidePath);
    migrateDatabase(outsideDb);
    getOrCreateDatabaseIdentity(outsideDb);
    outsideDb.close();
    const aliasPath = join(tempDir, "alias.sqlite");
    await symlink(outsidePath, aliasPath, "file");
    await expect(createSingleConsistentBackup(aliasPath)).rejects.toThrow("outside");
    await expect(access(`${aliasPath}.lease.sqlite`)).rejects.toMatchObject({ code: "ENOENT" });

    const final = await createSingleConsistentBackup(databasePath);
    expect(final.integrityResult).toBe("ok");
  });
});

const FAILED_CREATED_AT = "2026-07-11T08:00:00.000Z";
const FAILED_PUBLISHED_AT = "2026-07-11T08:30:00.000Z";
const FAILED_COMPLETED_AT = "2026-07-11T09:00:00.000Z";

function seedExactFailedV1Generation(
  db: MastheadDatabase,
  options: { schema21?: boolean; usefulDossiers?: boolean } = {}
): void {
  db.prepare("INSERT OR IGNORE INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)").run(
    "host:failed-v1", "fixture", FAILED_CREATED_AT, FAILED_COMPLETED_AT
  );
  db.prepare("INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)").run(
    "runtime:failed-v1", "codex", "fixture", FAILED_CREATED_AT, FAILED_COMPLETED_AT
  );
  const insertSession = db.prepare(
    `INSERT INTO sessions (
       session_id, host_id, runtime_id, source_session_id, title, lifecycle, last_activity_at,
       source_confidence, created_at, updated_at
     ) VALUES (?, 'host:failed-v1', 'runtime:failed-v1', ?, ?, 'ended', ?, 'authoritative', ?, ?)`
  );
  const insertState = db.prepare(
    `INSERT INTO workbench_session_state (
       session_id, publication_status, next_action, transcript_status, quality_status,
       session_enrichment_status, session_dossier_status, bug_fix_trace_status,
       runbook_status, adr_status, incident_timeline_status, session_package_status,
       resolution_status, published_at, created_at, updated_at
     ) VALUES (?, 'published', 'none', 'available', 'passed', 'satisfied', 'satisfied',
       'not_applicable', 'not_applicable', 'not_applicable', 'not_applicable', 'published',
       'automatic_resolved', ?, ?, ?)`
  );
  const insertClaim = db.prepare(
    `INSERT INTO workbench_claims (
       claim_id, session_id, claimed_by, claimed_at, heartbeat_at, expires_at, released_at, release_reason
     ) VALUES (?, ?, 'failed-agent', ?, ?, ?, ?, ?)`
  );
  const insertArtifact = db.prepare(
    `INSERT INTO session_artifacts (
       artifact_id, session_id, artifact_kind, status, content_fingerprint, created_at, updated_at,
       created_by, schema_version, title, content_json, evidence_refs_json, validation_json,
       publication_status, lineage_id, published_at
     ) VALUES (?, ?, 'session_dossier', 'current', ?, ?, ?, 'workbench_authoring:failed-agent',
       'session_dossier-v2', ?, ?, '[]', ?, 'published', ?, ?)`
  );
  const insertProvenance = db.prepare(
    "INSERT INTO session_artifact_provenance (artifact_id, session_id) VALUES (?, ?)"
  );
  const insertSearch = db.prepare(
    "INSERT INTO session_artifact_search (artifact_id, title, summary, highlight, project, body) VALUES (?, ?, '', '', '', ?)"
  );
  const insertRun = db.prepare(options.schema21
    ? `INSERT INTO workbench_authoring_runs (
         run_id, actor_id, database_id, status, evidence_revision, bundle_json, findings_json,
         receipt_json, created_at, updated_at, completed_at
       ) VALUES (?, 'failed-agent', 'fixture-db', 'completed', ?, ?, '[]', ?, ?, ?, ?)`
    : `INSERT INTO workbench_authoring_runs (
         run_id, actor_id, database_id, status, evidence_revision, bundle_json, findings_json,
         receipt_json, created_at, updated_at, completed_at, contract_version, candidate_id
       ) VALUES (?, 'failed-agent', 'fixture-db', 'completed', ?, ?, '[]', ?, ?, ?, ?, 'workbench-authoring-v1', NULL)`
  );
  const insertRunSession = db.prepare(
    "INSERT INTO workbench_authoring_run_sessions (run_id, session_id, claim_id, ordinal) VALUES (?, ?, ?, ?)"
  );
  for (let runIndex = 0, ordinal = 0; ordinal < FAILED_V1_DOSSIER_COUNT; runIndex += 1) {
    const runId = `run:failed-v1:${String(runIndex).padStart(3, "0")}`;
    const packages: Array<Record<string, unknown>> = [];
    const publishedArtifactIds: string[] = [];
    const resolvedSessionIds: string[] = [];
    const notApplicable: Array<Record<string, unknown>> = [];
    const members: Array<{ claimId: string; sessionId: string }> = [];
    const remaining = FAILED_V1_DOSSIER_COUNT - ordinal;
    const batchSize = remaining === 3 ? 2 : Math.min(20, remaining);
    for (let runOrdinal = 0; runOrdinal < batchSize; runOrdinal += 1, ordinal += 1) {
      const suffix = String(ordinal).padStart(4, "0");
      const sessionId = `session:failed-v1:${suffix}`;
      const claimId = `claim:failed-v1:${suffix}`;
      const artifactId = `artifact:failed-v1:${suffix}`;
      const dossier = options.usefulDossiers ? usefulDossier(suffix) : failedTemplateDossier(suffix);
      insertSession.run(sessionId, sessionId, `Failed dossier ${suffix}`, FAILED_PUBLISHED_AT, FAILED_CREATED_AT, FAILED_PUBLISHED_AT);
      insertState.run(sessionId, FAILED_PUBLISHED_AT, FAILED_CREATED_AT, FAILED_PUBLISHED_AT);
      insertClaim.run(
        claimId,
        sessionId,
        FAILED_CREATED_AT,
        FAILED_CREATED_AT,
        FAILED_COMPLETED_AT,
        ordinal === 0 ? null : FAILED_COMPLETED_AT,
        ordinal === 0 ? null : "authoring_finished"
      );
      insertArtifact.run(
        artifactId,
        sessionId,
        fingerprintWorkbenchOutput(dossier),
        FAILED_CREATED_AT,
        FAILED_PUBLISHED_AT,
        dossier.title,
        JSON.stringify(dossier),
        JSON.stringify({ contract: "workbench-authoring-v1", ok: true, schemaVersion: "session_dossier-v2" }),
        artifactId,
        FAILED_PUBLISHED_AT
      );
      insertProvenance.run(artifactId, sessionId);
      insertSearch.run(artifactId, dossier.title, JSON.stringify(dossier));
      packages.push({ dossier, enrichment: { title: dossier.title }, sessionId });
      publishedArtifactIds.push(artifactId);
      resolvedSessionIds.push(sessionId);
      members.push({ claimId, sessionId });
      for (const kind of ["runbook", "adr", "incident_timeline"]) {
        notApplicable.push({ evidenceRefs: [`message:${sessionId}:fixture`], kind, reason: "No reusable output", sessionId });
      }
    }
    const bundle = {
      artifacts: [],
      bundleVersion: "workbench-authoring-v1",
      contributions: [],
      evidenceRevision: `revision:${runId}`,
      notApplicable,
      runId,
      sessionPackages: packages
    };
    const receipt = {
      completedAt: FAILED_COMPLETED_AT,
      contributions: [],
      notApplicable: notApplicable.map(({ kind, sessionId }) => ({ kind, sessionId })),
      publishedArtifactIds,
      resolvedSessionIds,
      runId
    };
    insertRun.run(
      runId,
      bundle.evidenceRevision,
      JSON.stringify(bundle),
      JSON.stringify(receipt),
      FAILED_CREATED_AT,
      FAILED_COMPLETED_AT,
      FAILED_COMPLETED_AT
    );
    members.forEach((member, index) => insertRunSession.run(runId, member.sessionId, member.claimId, index));
  }
}

function failedTemplateDossier(suffix: string): Record<string, unknown> & { title: string } {
  return {
    approach: ["Read every canonical evidence item through cursor pagination."],
    commandsAndTools: [{ label: "Workbench evidence reader", purpose: "Read canonical evidence", status: "completed" }],
    filesTouched: [{ label: "No file effects captured", role: "No file evidence" }],
    keyDecisions: ["Keep the package single provenance and avoid weak multi-session joins."],
    missingEvidence: ["Missing evidence prevented session-specific conclusions."],
    outcome: "Kept the package single provenance and avoided weak multi-session joins.",
    problemStatement: "Generic problem: review the selected session's canonical evidence.",
    title: `Failed dossier ${suffix}`
  };
}

function usefulDossier(suffix: string): Record<string, unknown> & { title: string } {
  return {
    approach: [`Traced OAuth callback ${suffix} through nonce validation and corrected its state comparison.`],
    commandsAndTools: [{ label: "npm test -- auth-callback", purpose: "Verify the concrete repair", status: "passed" }],
    filesTouched: [{ label: `src/auth/callback-${suffix}.ts`, role: "Corrected callback state validation" }],
    keyDecisions: [`Compare callback ${suffix} against the server-issued nonce before exchanging the code.`],
    missingEvidence: [],
    outcome: `OAuth callback ${suffix} now rejects mismatched state and passes its focused regression test.`,
    problemStatement: `OAuth callback ${suffix} accepted a mismatched state nonce.`,
    title: `Useful OAuth dossier ${suffix}`
  };
}

function recoveryCounts(db: MastheadDatabase) {
  const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
  return {
    activities: count("workbench_activity"),
    artifacts: count("session_artifacts"),
    provenance: count("session_artifact_provenance"),
    runs: count("workbench_authoring_runs"),
    search: count("session_artifact_search")
  };
}

function totalChanges(db: MastheadDatabase): number {
  return Number((db.prepare("SELECT total_changes() AS count").get() as { count: number }).count);
}

function artifactInput(contentFingerprint: string, title: string) {
  return {
    artifactKind: "session_dossier" as const,
    content: { title },
    contentFingerprint,
    createdBy: "workbench_cli",
    evidenceRefs: ["message:session:abc:message"],
    schemaVersion: "session_dossier-v1",
    sessionId: "session:abc",
    title,
    validation: { ok: true }
  };
}

function runbookInput(contentFingerprint: string, title: string, sessionId = "session:abc") {
  return {
    artifactKind: "runbook" as const,
    content: { title, problemSignature: { symptoms: ["lock busy"], errorStrings: ["EBUSY"], affectedScope: "cache" } },
    contentFingerprint,
    createdBy: "workbench_cli",
    evidenceRefs: [`message:${sessionId}:message`],
    schemaVersion: "runbook-v1",
    sessionId,
    title,
    validation: { ok: true }
  };
}

function setPublishedAt(db: MastheadDatabase, artifactId: string, publishedAt: string): void {
  db.prepare("UPDATE session_artifacts SET published_at = ?, updated_at = ? WHERE artifact_id = ?").run(
    publishedAt,
    publishedAt,
    artifactId
  );
}

async function testDb(throughVersion = 23): Promise<MastheadDatabase> {
  const tempDir = await mkdtemp(join(tmpdir(), "masthead-session-artifact-"));
  tempDirs.push(tempDir);
  const db = await openMastheadDatabase(join(tempDir, "masthead.sqlite"));
  if (throughVersion === 23) migrateDatabase(db);
  else migrateTestDatabaseThrough(db, throughVersion);
  return db;
}
