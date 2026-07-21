import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { fingerprintWorkbenchOutput } from "../../../workbench/applyArtifact.ts";
import { dossierSnapshotFingerprint } from "../../../workbench/authoring/dossierSnapshot.ts";
import { runFailedV3TemplateRecoveryMaintenance } from "../../../cli/workbenchMaintenance.ts";
import { withExclusiveDatabaseMaintenance, type ExclusiveDatabaseMaintenance } from "../../databaseBackup.ts";
import { migrateTestDatabaseThrough } from "./schemaTestHelpers.ts";
import { migrateDatabase } from "../schema.ts";
import { openMastheadDatabase, type MastheadDatabase } from "../sqlite.ts";
import {
  auditFailedV3TemplateGeneration,
  invalidateFailedV3TemplateGenerationInsideExclusiveMaintenance,
  prepareFailedV3TemplateRecovery,
  restoreFailedV3TemplateRecoveryInsideExclusiveMaintenance,
  type FailedV3TemplateIncidentContract
} from "../v3TemplateRecovery.ts";

const tempDirs: string[] = [];
const DATABASE_ID = "fixture-v3-template-database";
const CREATED_AT = "2026-07-19T08:00:00.000Z";
const COMPLETED_AT = "2026-07-19T09:00:00.000Z";
const SUMMARY_PREFIX = "Canonical evidence records this request:";

afterEach(async () => {
  await Promise.all(tempDirs.map((path) => rm(path, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("failed V3 template recovery", () => {
  test("audits only the reviewed V3 incident, invalidates atomically, and restores its verified backup", async () => {
    const fixture = await incidentFixture(34, true);
    seedAuditedPredecessorWithDistractors(fixture.db, "0000");
    fixture.db.prepare(
      "UPDATE workbench_claims SET released_at = NULL, release_reason = NULL WHERE claim_id = 'claim:failed-v3:0000'"
    ).run();
    const audit = auditFailedV3TemplateGeneration(fixture.db, fixture.contract);
    expect(audit).toMatchObject({
      contractVersion: "workbench-authoring-v3",
      runCount: 270,
      dossierCount: 3230,
      optionalArtifactCount: 0,
      allSummariesUseIncidentPrefix: true,
      allDecisionsEmpty: true,
      allVerificationUnknown: true
    });
    expect(audit.runIds).not.toContain("run:good");
    const beforeRun = fixture.db.prepare(
      "SELECT bundle_json AS bundleJson, receipt_json AS receiptJson FROM workbench_authoring_runs WHERE run_id = 'run:failed-v3:000'"
    ).get();
    const beforeArtifact = fixture.db.prepare(
      "SELECT content_json AS contentJson FROM session_artifacts WHERE artifact_id = 'artifact:failed-v3:0000'"
    ).get();
    const before = recoveryCounts(fixture.db);
    fixture.db.close();

    await writeFile(join(dirnameOf(fixture.databasePath), "masthead.sqlite.backup-obsolete"), "obsolete");
    const prepared = await prepareFailedV3TemplateRecovery(fixture.databasePath, fixture.contract);
    expect((await readdir(dirnameOf(fixture.databasePath))).filter((name) => name.startsWith("masthead.sqlite.backup-")))
      .toEqual(["masthead.sqlite.backup-current"]);
    await expect(invalidateFailedV3TemplateGenerationInsideExclusiveMaintenance(
      fixture.databasePath,
      prepared,
      { databasePath: fixture.databasePath } as ExclusiveDatabaseMaintenance
    )).rejects.toThrow("v3_template_recovery_invalidation_ownership_required");
    const invalidated = await withExclusiveDatabaseMaintenance(fixture.databasePath, (ownership) =>
      invalidateFailedV3TemplateGenerationInsideExclusiveMaintenance(fixture.databasePath, prepared, ownership)
    );
    expect(invalidated).toMatchObject({
      claimsReleased: 1,
      enrichmentRowsRemoved: 9690,
      enrichmentRowsRestored: 3,
      invalidatedArtifacts: 3230,
      preservedRuns: 270,
      resetSessions: 3230
    });
    const repeated = await withExclusiveDatabaseMaintenance(fixture.databasePath, (ownership) =>
      invalidateFailedV3TemplateGenerationInsideExclusiveMaintenance(fixture.databasePath, prepared, ownership)
    );
    expect(repeated).toEqual(invalidated);

    let changed = await openMastheadDatabase(fixture.databasePath);
    expect(recoveryCounts(changed)).toMatchObject({ currentIncidentDossiers: 0, completedV3Runs: 271, publishPathSessions: 3230 });
    expect(changed.prepare(
      "SELECT status, publication_status AS publicationStatus, content_json AS contentJson FROM session_artifacts WHERE artifact_id = 'artifact:failed-v3:0000'"
    ).get()).toEqual({ ...beforeArtifact, publicationStatus: "invalidated", status: "superseded" });
    expect(changed.prepare(
      "SELECT COUNT(*) AS count FROM session_artifact_provenance WHERE artifact_id = 'artifact:failed-v3:0000'"
    ).get()).toEqual({ count: 1 });
    expect(changed.prepare(
      "SELECT COUNT(*) AS count FROM session_artifact_search WHERE artifact_id = 'artifact:failed-v3:0000'"
    ).get()).toEqual({ count: 0 });
    expect(changed.prepare(
      "SELECT bundle_json AS bundleJson, receipt_json AS receiptJson FROM workbench_authoring_runs WHERE run_id = 'run:failed-v3:000'"
    ).get()).toEqual(beforeRun);
    expect(changed.prepare(
      "SELECT released_at IS NOT NULL AS released, release_reason AS releaseReason FROM workbench_claims WHERE claim_id = 'claim:failed-v3:0000'"
    ).get()).toEqual({ released: 1, releaseReason: "failed_v3_template_generation_recovery" });
    expect(changed.prepare(
      "SELECT enrichment_id AS enrichmentId, status FROM session_enrichments WHERE session_id = 'session:failed-v3:0000' AND enrichment_id LIKE 'enrichment:predecessor:%' ORDER BY enrichment_id"
    ).all()).toEqual([
      { enrichmentId: "enrichment:predecessor:live_summary", status: "current" },
      { enrichmentId: "enrichment:predecessor:search_projection", status: "current" },
      { enrichmentId: "enrichment:predecessor:session_capsule", status: "current" },
      { enrichmentId: "enrichment:predecessor:wrong-policy", status: "stale" }
    ]);
    expect(changed.prepare(
      "SELECT event_type AS eventType, actor_id AS actorId, details_json AS detailsJson FROM workbench_activity WHERE activity_id = ?"
    ).get(`v3_template_recovery:${prepared.audit.auditHash}`)).toMatchObject({
      actorId: "masthead_recovery",
      eventType: "v3_template_generation_invalidated",
      detailsJson: expect.stringContaining(invalidated.receiptHash)
    });

    // A rejected or otherwise advanced canary may legitimately bump either
    // visible scope. Those changes must not revoke the immutable rollback
    // authorization established by the invalidation receipt.
    changed.prepare("UPDATE masthead_data_revisions SET revision = revision + 7 WHERE scope IN ('logbook', 'workbench')").run();
    changed.close();

    const backupBytes = await readFile(prepared.backup.path);
    await writeFile(prepared.backup.path, Buffer.concat([backupBytes, Buffer.from("tamper")]));
    await expect(withExclusiveDatabaseMaintenance(fixture.databasePath, (ownership) =>
      restoreFailedV3TemplateRecoveryInsideExclusiveMaintenance(fixture.databasePath, prepared, ownership)
    )).rejects.toThrow("v3_template_recovery_backup_hash_mismatch");
    await writeFile(prepared.backup.path, backupBytes);

    await expect(withExclusiveDatabaseMaintenance(fixture.databasePath, (ownership) =>
      restoreFailedV3TemplateRecoveryInsideExclusiveMaintenance(fixture.databasePath, prepared, ownership, {
        onMutationBoundary(boundary) {
          if (boundary === "before_promotion") throw new Error("injected_restore_prepromotion_failure");
        }
      })
    )).rejects.toThrow("injected_restore_prepromotion_failure");
    changed = await openMastheadDatabase(fixture.databasePath);
    expect(recoveryCounts(changed)).toMatchObject({ currentIncidentDossiers: 0, completedV3Runs: 271, publishPathSessions: 3230 });
    changed.close();

    const restored = await withExclusiveDatabaseMaintenance(fixture.databasePath, (ownership) =>
      restoreFailedV3TemplateRecoveryInsideExclusiveMaintenance(fixture.databasePath, prepared, ownership)
    );
    expect(restored.auditHash).toBe(prepared.audit.auditHash);
    changed = await openMastheadDatabase(fixture.databasePath);
    expect(recoveryCounts(changed)).toEqual(before);
    expect(changed.prepare(
      "SELECT bundle_json AS bundleJson, receipt_json AS receiptJson FROM workbench_authoring_runs WHERE run_id = 'run:failed-v3:000'"
    ).get()).toEqual(beforeRun);
    changed.prepare("UPDATE session_artifacts SET artifact_kind = 'runbook' WHERE artifact_id = 'artifact:failed-v3:0000'").run();
    expect(() => auditFailedV3TemplateGeneration(changed, fixture.contract)).toThrow("v3_template_recovery_artifact_shape_mismatch");
    changed.prepare("UPDATE session_artifacts SET artifact_kind = 'session_dossier' WHERE artifact_id = 'artifact:failed-v3:0000'").run();
    changed.prepare("UPDATE session_artifacts SET content_fingerprint = 'drifted' WHERE artifact_id = 'artifact:failed-v3:0000'").run();
    expect(() => auditFailedV3TemplateGeneration(changed, fixture.contract)).toThrow("v3_template_recovery_artifact_shape_mismatch");
    const originalFingerprint = dossierSnapshotFingerprint(JSON.parse((beforeArtifact as { contentJson: string }).contentJson));
    changed.prepare("UPDATE session_artifacts SET content_fingerprint = ? WHERE artifact_id = 'artifact:failed-v3:0000'")
      .run(originalFingerprint);
    changed.prepare("UPDATE session_artifacts SET session_id = 'session:failed-v3:0001' WHERE artifact_id = 'artifact:failed-v3:0000'").run();
    changed.prepare("UPDATE session_artifact_provenance SET session_id = 'session:failed-v3:0001' WHERE artifact_id = 'artifact:failed-v3:0000'").run();
    expect(() => auditFailedV3TemplateGeneration(changed, fixture.contract)).toThrow("v3_template_recovery_artifact_shape_mismatch");
    changed.prepare("UPDATE session_artifacts SET session_id = 'session:failed-v3:0000', content_fingerprint = ? WHERE artifact_id = 'artifact:failed-v3:0000'")
      .run(originalFingerprint);
    changed.prepare("UPDATE session_artifact_provenance SET session_id = 'session:failed-v3:0000' WHERE artifact_id = 'artifact:failed-v3:0000'").run();
    changed.prepare("UPDATE workbench_authoring_runs SET database_id = 'wrong-database' WHERE run_id = 'run:failed-v3:000'").run();
    expect(() => auditFailedV3TemplateGeneration(changed, fixture.contract)).toThrow("v3_template_recovery_population_not_exact");
    changed.prepare("UPDATE workbench_authoring_runs SET database_id = ? WHERE run_id = 'run:failed-v3:000'").run(DATABASE_ID);
    const bundleRow = changed.prepare("SELECT bundle_json AS bundleJson FROM workbench_authoring_runs WHERE run_id = 'run:failed-v3:000'").get() as { bundleJson: string };
    const bundle = JSON.parse(bundleRow.bundleJson) as { sessionEnrichments: Array<{ enrichment: { promptVersion?: string } }> };
    bundle.sessionEnrichments[0]!.enrichment.promptVersion = "session-capsule-v3";
    changed.prepare("UPDATE workbench_authoring_runs SET bundle_json = ? WHERE run_id = 'run:failed-v3:000'").run(JSON.stringify(bundle));
    expect(() => auditFailedV3TemplateGeneration(changed, fixture.contract)).toThrow("v3_template_recovery_population_not_exact");
    changed.close();
  }, 120_000);

  test("rolls pending migrations and every incident row back at each mutation phase", async () => {
    const fixture = await incidentFixture(30, false);
    const before = recoveryCounts(fixture.db);
    fixture.db.close();
    const prepared = await prepareFailedV3TemplateRecovery(fixture.databasePath, fixture.contract);
    for (const failedBoundary of [
      "after_migrations", "after_artifacts", "after_enrichments", "after_pipeline", "after_receipt"
    ] as const) {
      await expect(withExclusiveDatabaseMaintenance(fixture.databasePath, (ownership) =>
        invalidateFailedV3TemplateGenerationInsideExclusiveMaintenance(fixture.databasePath, prepared, ownership, {
          onMutationBoundary(boundary) {
            if (boundary === failedBoundary) throw new Error(`injected:${boundary}`);
          }
        })
      )).rejects.toThrow(`injected:${failedBoundary}`);
      const reopened = await openMastheadDatabase(fixture.databasePath);
      expect(recoveryCounts(reopened)).toEqual(before);
      expect(reopened.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 30 });
      expect(reopened.prepare(
        "SELECT COUNT(*) AS count FROM workbench_activity WHERE event_type = 'v3_template_generation_invalidated'"
      ).get()).toEqual({ count: 0 });
      reopened.close();
    }
  }, 120_000);

  test("refuses expired authorization, prepared audit drift, and active or backup byte drift", async () => {
    const fixture = await incidentFixture(34, false);
    fixture.db.close();
    await writeFile(`${fixture.databasePath}-wal`, "ambiguous");
    await expect(prepareFailedV3TemplateRecovery(fixture.databasePath, fixture.contract))
      .rejects.toThrow("v3_template_recovery_prepare_sidecar_present:wal");
    await rm(`${fixture.databasePath}-wal`);
    const aliasPath = join(dirnameOf(fixture.databasePath), "alias.sqlite");
    await symlink(fixture.databasePath, aliasPath, "file");
    await expect(prepareFailedV3TemplateRecovery(aliasPath, fixture.contract))
      .rejects.toThrow("v3_template_recovery_prepare_path_invalid");
    await rm(aliasPath);
    const prepared = await prepareFailedV3TemplateRecovery(fixture.databasePath, fixture.contract);
    const activeBytes = await readFile(fixture.databasePath);
    const backupBytes = await readFile(prepared.backup.path);

    const expired = resignPrepared({ ...prepared, expiresAt: "2000-01-01T00:00:00.000Z" });
    await expect(withExclusiveDatabaseMaintenance(fixture.databasePath, (ownership) =>
      invalidateFailedV3TemplateGenerationInsideExclusiveMaintenance(fixture.databasePath, expired, ownership)
    )).rejects.toThrow("v3_template_recovery_prepare_expired");

    const alteredAudit = resignPrepared({
      ...prepared,
      audit: { ...prepared.audit, auditHash: "f".repeat(64) }
    });
    await expect(withExclusiveDatabaseMaintenance(fixture.databasePath, (ownership) =>
      invalidateFailedV3TemplateGenerationInsideExclusiveMaintenance(fixture.databasePath, alteredAudit, ownership)
    )).rejects.toThrow("v3_template_recovery_backup_audit_mismatch");

    await writeFile(prepared.backup.path, Buffer.concat([backupBytes, Buffer.from("drift")]));
    await expect(withExclusiveDatabaseMaintenance(fixture.databasePath, (ownership) =>
      invalidateFailedV3TemplateGenerationInsideExclusiveMaintenance(fixture.databasePath, prepared, ownership)
    )).rejects.toThrow("v3_template_recovery_backup_hash_mismatch");
    await writeFile(prepared.backup.path, backupBytes);
    await writeFile(`${prepared.backup.path}-wal`, "ambiguous");
    await expect(withExclusiveDatabaseMaintenance(fixture.databasePath, (ownership) =>
      invalidateFailedV3TemplateGenerationInsideExclusiveMaintenance(fixture.databasePath, prepared, ownership)
    )).rejects.toThrow("v3_template_recovery_backup_sidecar_present:wal");
    await rm(`${prepared.backup.path}-wal`);

    await writeFile(fixture.databasePath, Buffer.concat([activeBytes, Buffer.from("drift")]));
    await expect(withExclusiveDatabaseMaintenance(fixture.databasePath, (ownership) =>
      invalidateFailedV3TemplateGenerationInsideExclusiveMaintenance(fixture.databasePath, prepared, ownership)
    )).rejects.toThrow("v3_template_recovery_active_bytes_mismatch");
    await writeFile(fixture.databasePath, activeBytes);
  }, 120_000);

  test("runs the hash-locked CLI flow and writes the prepared receipt with owner-only permissions", async () => {
    const fixture = await incidentFixture(34, false);
    fixture.db.close();
    const directory = dirnameOf(fixture.databasePath);
    const contractPath = join(directory, "incident-contract.json");
    const preparedPath = join(directory, "prepared-receipt.json");
    await writeFile(contractPath, JSON.stringify(fixture.contract));

    await writeFile(`${fixture.databasePath}-wal`, "ambiguous");
    const sidecarResult = await runFailedV3TemplateRecoveryMaintenance(
      "audit-v3-template-generation",
      ["--db", fixture.databasePath, "--incident-contract", contractPath],
      { env: {} },
      true
    );
    expect(sidecarResult.exitCode).toBe(1);
    expect(sidecarResult.stderr).toContain("v3_template_recovery_audit_database_not_self_contained:wal");
    await rm(`${fixture.databasePath}-wal`);

    const auditResult = await runFailedV3TemplateRecoveryMaintenance(
      "audit-v3-template-generation",
      ["--db", fixture.databasePath, "--incident-contract", contractPath],
      { env: {} },
      true
    );
    expect(auditResult.exitCode).toBe(0);
    expect(JSON.parse(auditResult.stdout)).toMatchObject({ ok: true, audit: { runCount: 270, dossierCount: 3230 } });

    const prepareResult = await runFailedV3TemplateRecoveryMaintenance(
      "prepare-v3-template-recovery",
      ["--db", fixture.databasePath, "--incident-contract", contractPath, "--receipt", preparedPath],
      { env: {} },
      true
    );
    expect(prepareResult.exitCode).toBe(0);
    expect((await stat(preparedPath)).mode & 0o777).toBe(0o600);
    const prepared = JSON.parse(await readFile(preparedPath, "utf8")) as { receiptHash: string };
    expect(resignPrepared(prepared).receiptHash).toBe(prepared.receiptHash);

    const missingConfirm = await runFailedV3TemplateRecoveryMaintenance(
      "invalidate-v3-template-generation",
      ["--db", fixture.databasePath, "--prepared-receipt", preparedPath],
      { env: {} },
      true
    );
    expect(missingConfirm.exitCode).toBe(1);

    const invalidateResult = await runFailedV3TemplateRecoveryMaintenance(
      "invalidate-v3-template-generation",
      ["--db", fixture.databasePath, "--prepared-receipt", preparedPath, "--confirm"],
      { env: {} },
      true
    );
    expect(invalidateResult.exitCode).toBe(0);
    const invalidationReceipt = JSON.parse(invalidateResult.stdout).receipt as { receiptHash: string };
    expect(resignPrepared(invalidationReceipt).receiptHash).toBe(invalidationReceipt.receiptHash);

    const restoreResult = await runFailedV3TemplateRecoveryMaintenance(
      "restore-v3-template-recovery",
      ["--db", fixture.databasePath, "--prepared-receipt", preparedPath, "--confirm"],
      { env: {} },
      true
    );
    expect(restoreResult.exitCode).toBe(0);
    const restoreReceipt = JSON.parse(restoreResult.stdout).receipt as { receiptHash: string };
    expect(resignPrepared(restoreReceipt).receiptHash).toBe(restoreReceipt.receiptHash);
  }, 120_000);

  test("fails closed when a stale predecessor cannot be selected uniquely", async () => {
    const fixture = await incidentFixture(34, false);
    for (const suffix of ["a", "b"]) {
      fixture.db.prepare(
        `INSERT INTO session_enrichments (
           enrichment_id, session_id, enrichment_kind, status, content_fingerprint,
           prompt_version, provider, model, generated_at, content_json, source_refs_json
         ) VALUES (?, 'session:failed-v3:0000', 'session_capsule', 'stale', ?,
           'session-capsule-v4', 'openai', 'gpt-5', ?, '{}', '[]')`
      ).run(`enrichment:predecessor:${suffix}`, `predecessor:${suffix}`, CREATED_AT);
    }
    fixture.db.close();
    await expect(prepareFailedV3TemplateRecovery(fixture.databasePath, fixture.contract))
      .rejects.toThrow("v3_template_recovery_enrichment_ambiguous");
  }, 120_000);
});

function dirnameOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function resignPrepared<T extends { receiptHash: string }>(prepared: T): T {
  const { receiptHash: _receiptHash, ...unsigned } = prepared;
  return { ...unsigned, receiptHash: hashCanonical(unsigned) } as T;
}

function seedAuditedPredecessorWithDistractors(db: MastheadDatabase, suffix: string): void {
  const sessionId = `session:failed-v3:${suffix}`;
  const insert = db.prepare(
    `INSERT INTO session_enrichments (
       enrichment_id, session_id, enrichment_kind, status, content_fingerprint,
       prompt_version, provider, model, generated_at, content_json, source_refs_json
     ) VALUES (?, ?, ?, 'stale', ?, ?, 'openai', 'gpt-5', ?, '{}', '[]')`
  );
  for (const kind of ["session_capsule", "live_summary", "search_projection"]) {
    insert.run(`enrichment:predecessor:${kind}`, sessionId, kind, `predecessor:${kind}`, "session-capsule-v4", CREATED_AT);
  }
  insert.run("enrichment:predecessor:wrong-policy", sessionId, "session_capsule", "wrong-policy", "session-capsule-v3", CREATED_AT);
}

async function incidentFixture(schemaVersion: 30 | 34, includeGoodRun: boolean): Promise<{
  contract: FailedV3TemplateIncidentContract;
  databasePath: string;
  db: MastheadDatabase;
}> {
  const directory = await mkdtemp(join(tmpdir(), "masthead-v3-template-recovery-"));
  tempDirs.push(directory);
  const databasePath = join(directory, "masthead.sqlite");
  const db = await openMastheadDatabase(databasePath);
  if (schemaVersion === 34) migrateDatabase(db);
  else migrateTestDatabaseThrough(db, schemaVersion);
  db.prepare(
    `INSERT INTO app_settings(setting_key, setting_json, updated_at) VALUES ('database_identity', ?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET setting_json = excluded.setting_json, updated_at = excluded.updated_at`
  ).run(JSON.stringify({ databaseId: DATABASE_ID, createdAt: CREATED_AT }), CREATED_AT);
  const fixture = seedFailedGeneration(db);
  if (includeGoodRun) seedGoodRun(db);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  return {
    databasePath,
    db,
    contract: {
      contractVersion: "failed-v3-template-generation-incident-v1",
      databaseId: DATABASE_ID,
      authoringContractVersion: "workbench-authoring-v3",
      policyVersion: "session-capsule-v4",
      dossierSchemaVersion: "canonical-session-dossier-v1",
      summaryPrefix: SUMMARY_PREFIX,
      runCount: 270,
      dossierCount: 3230,
      distinctSessionCount: 3230,
      optionalArtifactCount: 0,
      emptyDecisionCount: 3230,
      unknownVerificationCount: 3230,
      actorIds: ["failed-v3-agent"],
      createdAt: { from: CREATED_AT, to: CREATED_AT },
      completedAt: { from: COMPLETED_AT, to: COMPLETED_AT },
      runIdsHash: hashCanonical(fixture.runIds.sort()),
      artifactIdsHash: hashCanonical(fixture.artifactIds.sort()),
      sessionIdsHash: hashCanonical(fixture.sessionIds.sort())
    }
  };
}

function seedFailedGeneration(db: MastheadDatabase): { artifactIds: string[]; runIds: string[]; sessionIds: string[] } {
  db.prepare("INSERT OR IGNORE INTO hosts (host_id, hostname, first_seen_at, last_seen_at) VALUES ('host:v3', 'fixture', ?, ?)")
    .run(CREATED_AT, COMPLETED_AT);
  db.prepare("INSERT OR IGNORE INTO runtimes (runtime_id, runtime_kind, runtime_version, first_seen_at, last_seen_at) VALUES ('runtime:v3', 'codex', 'fixture', ?, ?)")
    .run(CREATED_AT, COMPLETED_AT);
  const insertSession = db.prepare(
    `INSERT INTO sessions (session_id, host_id, runtime_id, source_session_id, title, lifecycle, last_activity_at,
       source_confidence, created_at, updated_at)
     VALUES (?, 'host:v3', 'runtime:v3', ?, ?, 'ended', ?, 'authoritative', ?, ?)`
  );
  const insertState = db.prepare(
    `INSERT INTO workbench_session_state (
       session_id, publication_status, next_action, transcript_status, quality_status,
       session_enrichment_status, session_dossier_status, bug_fix_trace_status,
       runbook_status, adr_status, incident_timeline_status, session_package_status,
       resolution_status, published_at, created_at, updated_at
     ) VALUES (?, 'published', 'none', 'available', 'passed', 'satisfied', 'satisfied',
       'unknown', 'unknown', 'unknown', 'unknown', 'published', 'automatic_resolved', ?, ?, ?)`
  );
  const insertClaim = db.prepare(
    `INSERT INTO workbench_claims (claim_id, session_id, claimed_by, claimed_at, heartbeat_at, expires_at, released_at, release_reason)
     VALUES (?, ?, 'failed-v3-agent', ?, ?, ?, ?, ?)`
  );
  const insertArtifact = db.prepare(
    `INSERT INTO session_artifacts (
       artifact_id, session_id, artifact_kind, status, content_fingerprint, created_at, updated_at,
       created_by, schema_version, title, summary, content_json, evidence_refs_json, validation_json,
       publication_status, lineage_id, published_at)
     VALUES (?, ?, 'session_dossier', 'current', ?, ?, ?, 'workbench_authoring_v3:failed-v3-agent',
       'canonical-session-dossier-v1', ?, ?, ?, '[]', ?, 'published', ?, ?)`
  );
  const insertProvenance = db.prepare("INSERT INTO session_artifact_provenance(artifact_id, session_id) VALUES (?, ?)");
  const insertSearch = db.prepare(
    "INSERT INTO session_artifact_search(artifact_id, title, summary, highlight, project, body) VALUES (?, ?, ?, '', '', ?)"
  );
  const insertEnrichment = db.prepare(
    `INSERT INTO session_enrichments (
       enrichment_id, session_id, enrichment_kind, status, content_fingerprint, prompt_version,
       provider, model, generated_at, content_json, source_refs_json)
     VALUES (?, ?, ?, 'current', ?, 'session-capsule-v4', 'workbench_authoring_v3', 'external_agent', ?, '{}', '[]')`
  );
  const insertRun = db.prepare(
    `INSERT INTO workbench_authoring_runs (
       run_id, actor_id, database_id, status, evidence_revision, bundle_json, findings_json,
       receipt_json, created_at, updated_at, completed_at, contract_version, candidate_id)
     VALUES (?, 'failed-v3-agent', ?, 'completed', ?, ?, '[]', ?, ?, ?, ?, 'workbench-authoring-v3', NULL)`
  );
  const insertMembership = db.prepare(
    "INSERT INTO workbench_authoring_run_sessions(run_id, session_id, claim_id, ordinal) VALUES (?, ?, ?, ?)"
  );
  const artifactIds: string[] = [];
  const runIds: string[] = [];
  const sessionIds: string[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    let global = 0;
    for (let runIndex = 0; runIndex < 270; runIndex += 1) {
      const runId = `run:failed-v3:${String(runIndex).padStart(3, "0")}`;
      const batchSize = runIndex === 269 ? 2 : 12;
      const drafts: Array<Record<string, unknown>> = [];
      const runSessionIds: string[] = [];
      const runArtifactIds: string[] = [];
      const memberships: Array<{ claimId: string; ordinal: number; sessionId: string }> = [];
      for (let ordinal = 0; ordinal < batchSize; ordinal += 1, global += 1) {
        const suffix = String(global).padStart(4, "0");
        const sessionId = `session:failed-v3:${suffix}`;
        const artifactId = `artifact:failed-v3:${suffix}`;
        const claimId = `claim:failed-v3:${suffix}`;
        const enrichment = failedEnrichment(suffix);
        const fingerprint = fingerprintWorkbenchOutput(enrichment);
        insertSession.run(sessionId, `source:${suffix}`, `Failed V3 ${suffix}`, COMPLETED_AT, CREATED_AT, COMPLETED_AT);
        insertState.run(sessionId, COMPLETED_AT, CREATED_AT, COMPLETED_AT);
        insertClaim.run(claimId, sessionId, CREATED_AT, CREATED_AT, COMPLETED_AT, COMPLETED_AT, "authoring_finished");
        const body = { durableEnrichment: enrichment, snapshotVersion: "canonical-session-dossier-v1" };
        const artifactFingerprint = dossierSnapshotFingerprint(body as never);
        insertArtifact.run(
          artifactId, sessionId, artifactFingerprint, CREATED_AT, COMPLETED_AT, `Failed V3 ${suffix}`,
          enrichment.sessionSummary.text, JSON.stringify(body),
          JSON.stringify({ canonicalSnapshot: true, contract: "workbench-authoring-v3", ok: true }),
          artifactId, COMPLETED_AT
        );
        insertProvenance.run(artifactId, sessionId);
        insertSearch.run(artifactId, `Failed V3 ${suffix}`, enrichment.sessionSummary.text, JSON.stringify(body));
        for (const kind of ["session_capsule", "live_summary", "search_projection"]) {
          insertEnrichment.run(`enrichment:failed-v3:${suffix}:${kind}`, sessionId, kind, fingerprint, COMPLETED_AT);
        }
        drafts.push({ enrichment, sessionId });
        runSessionIds.push(sessionId);
        runArtifactIds.push(artifactId);
        sessionIds.push(sessionId);
        artifactIds.push(artifactId);
        memberships.push({ claimId, ordinal, sessionId });
      }
      const bundle = {
        artifacts: [], bundleVersion: "workbench-authoring-v3", evidenceRevision: `revision:${runId}`,
        runId, sessionEnrichments: drafts
      };
      const receipt = {
        completedAt: COMPLETED_AT, contractVersion: "workbench-authoring-v3", contributions: [],
        dossierArtifactIds: runArtifactIds, optionalArtifacts: [], publishedArtifactIds: runArtifactIds,
        resolvedSessionIds: runSessionIds, runId
      };
      insertRun.run(runId, DATABASE_ID, bundle.evidenceRevision, JSON.stringify(bundle), JSON.stringify(receipt), CREATED_AT, COMPLETED_AT, COMPLETED_AT);
      for (const membership of memberships) {
        insertMembership.run(runId, membership.sessionId, membership.claimId, membership.ordinal);
      }
      runIds.push(runId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { artifactIds, runIds, sessionIds };
}

function seedGoodRun(db: MastheadDatabase): void {
  db.prepare(
    `INSERT INTO workbench_authoring_runs (
       run_id, actor_id, database_id, status, evidence_revision, bundle_json, findings_json,
       receipt_json, created_at, updated_at, completed_at, contract_version, candidate_id)
     VALUES ('run:good', 'good-agent', ?, 'completed', 'revision:good', ?, '[]', ?, ?, ?, ?, 'workbench-authoring-v3', NULL)`
  ).run(
    DATABASE_ID,
    JSON.stringify({ artifacts: [], bundleVersion: "workbench-authoring-v3", evidenceRevision: "revision:good", runId: "run:good", sessionEnrichments: [] }),
    JSON.stringify({ completedAt: COMPLETED_AT, contractVersion: "workbench-authoring-v3", contributions: [], dossierArtifactIds: [], optionalArtifacts: [], publishedArtifactIds: [], resolvedSessionIds: [], runId: "run:good" }),
    CREATED_AT, COMPLETED_AT, COMPLETED_AT
  );
}

function failedEnrichment(suffix: string) {
  const evidenceRefs = [{ id: `message:${suffix}`, kind: "event", observedAt: CREATED_AT, source: "fixture" }];
  return {
    version: "session-capsule-v4",
    source: "deterministic",
    promptVersion: "session-capsule-v4",
    sessionTitle: { text: `Failed V3 ${suffix}`, basis: "first_prompt", confidence: "high", evidenceRefs },
    sessionSummary: { text: `${SUMMARY_PREFIX} canonical evidence was reviewed.`, state: "completed", confidence: "high", evidenceRefs },
    sessionDossier: {
      purpose: "Canonical evidence records reviewed request.", outcome: "Canonical evidence records reviewed session.",
      keyWork: ["Canonical evidence records reviewed selected session."], decisions: [], blockers: [],
      verification: { status: "unknown", summary: "Verification status was unavailable.", commands: [], failures: [], evidenceRefs },
      continuation: { openQuestions: [], constraints: [] }, evidenceRefs, warnings: []
    }
  };
}

function recoveryCounts(db: MastheadDatabase) {
  const count = (sql: string) => (db.prepare(sql).get() as { count: number }).count;
  return {
    completedV3Runs: count("SELECT COUNT(*) AS count FROM workbench_authoring_runs WHERE status = 'completed' AND contract_version = 'workbench-authoring-v3'"),
    currentIncidentDossiers: count("SELECT COUNT(*) AS count FROM session_artifacts WHERE created_by = 'workbench_authoring_v3:failed-v3-agent' AND status = 'current' AND publication_status = 'published'"),
    enrichments: count("SELECT COUNT(*) AS count FROM session_enrichments WHERE provider = 'workbench_authoring_v3'"),
    publishPathSessions: count("SELECT COUNT(*) AS count FROM workbench_session_state WHERE publication_status = 'publish_path'")
  };
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
