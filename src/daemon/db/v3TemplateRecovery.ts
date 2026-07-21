import { createHash, randomUUID } from "node:crypto";
import { access, lstat, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { fingerprintWorkbenchOutput } from "../../workbench/applyArtifact.ts";
import { dossierSnapshotFingerprint } from "../../workbench/authoring/dossierSnapshot.ts";
import {
  createSingleConsistentBackupInsideExclusiveMaintenance,
  assertExclusiveDatabaseMaintenance,
  withExclusiveDatabaseMaintenance,
  type ExclusiveDatabaseMaintenance
} from "../databaseBackup.ts";
import { applyPendingMigrationsInTransaction } from "./schema.ts";
import type { MastheadDatabase } from "./sqlite.ts";
import { withDataRevisionOperation } from "./dataRevisionRepository.ts";
import { invalidatePublishedArtifactsForRecoveryInTransaction } from "./sessionArtifactRepository.ts";
import { resetFailedV3TemplateSessionsInTransaction } from "./workbenchPipelineRepository.ts";

const PREPARE_TTL_MS = 30 * 60 * 1_000;
const RECOVERY_VERSION = "failed-v3-template-generation-recovery-v1" as const;
const AUTHORING_CONTRACT = "workbench-authoring-v3" as const;
const PROMPT_VERSION = "session-capsule-v4";
const CLAIM_RELEASE_REASON = "failed_v3_template_generation_recovery";

export type FailedV3TemplateIncidentContract = {
  contractVersion: "failed-v3-template-generation-incident-v1";
  databaseId: string;
  authoringContractVersion: "workbench-authoring-v3";
  policyVersion: string;
  dossierSchemaVersion: string;
  summaryPrefix: string;
  runCount: 270;
  dossierCount: 3230;
  distinctSessionCount: 3230;
  optionalArtifactCount: 0;
  emptyDecisionCount: 3230;
  unknownVerificationCount: 3230;
  actorIds: string[];
  createdAt: { from: string; to: string };
  completedAt: { from: string; to: string };
  runIdsHash: string;
  artifactIdsHash: string;
  sessionIdsHash: string;
};

export type FailedV3TemplateAudit = {
  contractVersion: "workbench-authoring-v3";
  databaseId: string;
  incidentContractHash: string;
  auditHash: string;
  runCount: number;
  dossierCount: number;
  distinctSessionCount: number;
  optionalArtifactCount: number;
  allSummariesUseIncidentPrefix: boolean;
  allDecisionsEmpty: boolean;
  allVerificationUnknown: boolean;
  summaryPrefixCount: number;
  emptyDecisionCount: number;
  unknownVerificationCount: number;
  runIds: string[];
  artifactIds: string[];
  sessionIds: string[];
  bundleHashes: string[];
  receiptHashes: string[];
  bundleDerivedEnrichmentFingerprints: string[];
  actorIds: string[];
  schemaVersions: string[];
  policyVersions: string[];
  createdAt: { from: string; to: string };
  completedAt: { from: string; to: string };
};

export type FailedV3TemplatePreparedRecovery = {
  recoveryVersion: typeof RECOVERY_VERSION;
  preparedAt: string;
  expiresAt: string;
  databasePath: string;
  incidentContract: FailedV3TemplateIncidentContract;
  incidentContractHash: string;
  audit: FailedV3TemplateAudit;
  active: FileEvidence;
  backup: FileEvidence & { path: string; integrityResult: "ok" };
  receiptHash: string;
};

export type FailedV3TemplateInvalidationReceipt = {
  recoveryVersion: typeof RECOVERY_VERSION;
  action: "invalidate";
  databaseId: string;
  auditHash: string;
  incidentContractHash: string;
  invalidatedArtifacts: number;
  preservedRuns: number;
  resetSessions: number;
  enrichmentRowsRemoved: number;
  enrichmentRowsRestored: number;
  claimsReleased: number;
  artifactIds: string[];
  backup: FileEvidence & { path: string; integrityResult: "ok" };
  revisions: { before: { logbook: number; workbench: number }; after: { logbook: number; workbench: number } };
  completedAt: string;
  receiptHash: string;
};

export type FailedV3TemplateRestoreReceipt = {
  recoveryVersion: typeof RECOVERY_VERSION;
  action: "restore";
  databaseId: string;
  auditHash: string;
  backupPath: string;
  backupPreserved: true;
  integrityResult: "ok";
  restoredAt: string;
  receiptHash: string;
};

type FileEvidence = { sha256: string; sizeBytes: number };
type AuditRun = {
  actorId: string;
  artifactIds: string[];
  expectedArtifacts: Array<{ artifactId: string; enrichmentFingerprint: string; sessionId: string }>;
  bundleHash: string;
  completedAt: string;
  createdAt: string;
  enrichments: Array<{ fingerprint: string; model: string; sessionId: string }>;
  receiptHash: string;
  runId: string;
  sessionIds: string[];
};

export function auditFailedV3TemplateGeneration(
  db: MastheadDatabase,
  contract: FailedV3TemplateIncidentContract
): FailedV3TemplateAudit {
  assertIncidentContractShape(contract);
  const databaseId = readDatabaseId(db);
  if (databaseId !== contract.databaseId) throw new Error("v3_template_recovery_database_identity_mismatch");
  const rows = db.prepare(
    `SELECT run_id AS runId, actor_id AS actorId, database_id AS databaseId,
            status, contract_version AS contractVersion,
            bundle_json AS bundleJson, receipt_json AS receiptJson,
            created_at AS createdAt, completed_at AS completedAt
     FROM workbench_authoring_runs
     WHERE status = 'completed' AND contract_version = ? AND bundle_json IS NOT NULL AND receipt_json IS NOT NULL
     ORDER BY run_id`
  ).all(AUTHORING_CONTRACT) as Array<Record<string, unknown>>;
  const runs = rows.map((row) => auditRun(row, contract)).filter((run): run is AuditRun => Boolean(run));
  const runIds = runs.map((run) => run.runId).sort();
  const artifactIds = runs.flatMap((run) => run.artifactIds).sort();
  const sessionIds = [...new Set(runs.flatMap((run) => run.sessionIds))].sort();
  const actorIds = [...new Set(runs.map((run) => run.actorId))].sort();
  const enrichments = runs.flatMap((run) => run.enrichments);

  if (runs.length !== contract.runCount || artifactIds.length !== contract.dossierCount || sessionIds.length !== contract.distinctSessionCount) {
    throw new Error(`v3_template_recovery_population_not_exact:${runs.length}:${artifactIds.length}:${sessionIds.length}`);
  }
  assertHashList(runIds, contract.runIdsHash, "run_ids");
  assertHashList(artifactIds, contract.artifactIdsHash, "artifact_ids");
  assertHashList(sessionIds, contract.sessionIdsHash, "session_ids");
  if (!sameStrings(actorIds, [...contract.actorIds].sort())) throw new Error("v3_template_recovery_actor_mismatch");
  const createdAt = bounds(runs.map((run) => run.createdAt));
  const completedAt = bounds(runs.map((run) => run.completedAt));
  if (canonicalJson(createdAt) !== canonicalJson(contract.createdAt) || canonicalJson(completedAt) !== canonicalJson(contract.completedAt)) {
    throw new Error("v3_template_recovery_time_bounds_mismatch");
  }

  const artifacts = readIncidentArtifacts(db, runs.flatMap((run) => run.expectedArtifacts), contract);
  if (artifacts.length !== contract.dossierCount) throw new Error("v3_template_recovery_artifact_membership_mismatch");
  const optionalArtifactCount = artifacts.filter((artifact) => artifact.artifactKind !== "session_dossier").length;
  if (optionalArtifactCount !== contract.optionalArtifactCount) throw new Error("v3_template_recovery_optional_artifact_mismatch");
  verifyEnrichmentMembership(db, enrichments, runs);

  const incidentContractHash = hashCanonical(contract);
  const payload = {
    actorIds,
    artifactIds,
    bundleDerivedEnrichmentFingerprints: enrichments.map((entry) => entry.fingerprint).sort(),
    bundleHashes: runs.map((run) => run.bundleHash).sort(),
    completedAt,
    createdAt,
    databaseId,
    incidentContractHash,
    policyVersions: [contract.policyVersion],
    receiptHashes: runs.map((run) => run.receiptHash).sort(),
    runIds,
    schemaVersions: [contract.dossierSchemaVersion],
    sessionIds
  };
  const auditHash = hashCanonical(payload);
  return {
    contractVersion: AUTHORING_CONTRACT,
    databaseId,
    incidentContractHash,
    auditHash,
    runCount: runs.length,
    dossierCount: artifactIds.length,
    distinctSessionCount: sessionIds.length,
    optionalArtifactCount,
    allSummariesUseIncidentPrefix: true,
    allDecisionsEmpty: true,
    allVerificationUnknown: true,
    summaryPrefixCount: sessionIds.length,
    emptyDecisionCount: sessionIds.length,
    unknownVerificationCount: sessionIds.length,
    runIds,
    artifactIds,
    sessionIds,
    bundleHashes: payload.bundleHashes,
    receiptHashes: payload.receiptHashes,
    bundleDerivedEnrichmentFingerprints: payload.bundleDerivedEnrichmentFingerprints,
    actorIds,
    schemaVersions: payload.schemaVersions,
    policyVersions: payload.policyVersions,
    createdAt,
    completedAt
  };
}

export async function prepareFailedV3TemplateRecovery(
  databasePath: string,
  incidentContract: FailedV3TemplateIncidentContract
): Promise<FailedV3TemplatePreparedRecovery> {
  const activePath = resolve(databasePath);
  return withExclusiveDatabaseMaintenance(activePath, async (ownership) => {
    await assertStandaloneRegularDatabase(activePath, "v3_template_recovery_prepare");
    const activeDb = immutableDatabase(activePath);
    let audit: FailedV3TemplateAudit;
    try {
      verifyIntegrity(activeDb);
      audit = auditFailedV3TemplateGeneration(activeDb, incidentContract);
    } finally {
      activeDb.close();
    }
    const active = await fileEvidence(activePath);
    const created = await createSingleConsistentBackupInsideExclusiveMaintenance(activePath, ownership);
    const backup = await fileEvidence(created.backupPath);
    const backupDb = immutableDatabase(created.backupPath);
    try {
      verifyIntegrity(backupDb);
      const backupAudit = auditFailedV3TemplateGeneration(backupDb, incidentContract);
      if (backupAudit.auditHash !== audit.auditHash) throw new Error("v3_template_recovery_backup_audit_mismatch");
    } finally {
      backupDb.close();
    }
    // Opening a WAL-mode database for SQLite backup may materialize empty WAL
    // sidecars even under exclusive ownership. Remove those self-created files
    // so the prepared active image remains an exact standalone byte target.
    await removeSidecars(activePath);
    const unchanged = await fileEvidence(activePath);
    if (!sameFileEvidence(active, unchanged)) throw new Error("v3_template_recovery_active_changed_during_prepare");
    const preparedAt = new Date().toISOString();
    const unsigned = {
      recoveryVersion: RECOVERY_VERSION,
      preparedAt,
      expiresAt: new Date(Date.parse(preparedAt) + PREPARE_TTL_MS).toISOString(),
      databasePath: activePath,
      incidentContract,
      incidentContractHash: audit.incidentContractHash,
      audit,
      active,
      backup: { ...backup, path: created.backupPath, integrityResult: "ok" as const }
    };
    return { ...unsigned, receiptHash: hashCanonical(unsigned) };
  });
}

export async function invalidateFailedV3TemplateGenerationInsideExclusiveMaintenance(
  databasePath: string,
  prepared: FailedV3TemplatePreparedRecovery,
  ownership: ExclusiveDatabaseMaintenance,
  options: { onMutationBoundary?: (boundary: "after_migrations" | "after_artifacts" | "after_enrichments" | "after_pipeline" | "after_receipt") => void } = {}
): Promise<FailedV3TemplateInvalidationReceipt> {
  const activePath = resolve(databasePath);
  assertOwnership(activePath, ownership, "v3_template_recovery_invalidation_ownership_required");
  assertPreparedReceipt(prepared, activePath);
  await assertStandaloneRegularDatabase(activePath, "v3_template_recovery_invalidate");
  await verifyPreparedBackup(prepared);
  const repeatDb = immutableDatabase(activePath);
  try {
    const repeated = readStoredInvalidationReceipt(repeatDb, prepared, { requireExactPostState: true });
    if (repeated) return repeated;
  } finally {
    repeatDb.close();
  }
  const activeEvidence = await fileEvidence(activePath);
  if (!sameFileEvidence(activeEvidence, prepared.active)) throw new Error("v3_template_recovery_active_bytes_mismatch");
  if (Date.now() > Date.parse(prepared.expiresAt)) throw new Error("v3_template_recovery_prepare_expired");

  const db = new DatabaseSync(activePath);
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000; BEGIN IMMEDIATE;");
    try {
      applyPendingMigrationsInTransaction(db);
      options.onMutationBoundary?.("after_migrations");
      const currentAudit = auditFailedV3TemplateGeneration(db, prepared.incidentContract);
      if (currentAudit.auditHash !== prepared.audit.auditHash) throw new Error("v3_template_recovery_audit_mismatch");
      const before = readRevisions(db);
      const now = new Date().toISOString();
      const mutation = withDataRevisionOperation(db, () => {
        const artifactOutcome = invalidatePublishedArtifactsForRecoveryInTransaction(db, {
          artifactIds: prepared.audit.artifactIds,
          updatedAt: now
        });
        if (artifactOutcome.invalidatedArtifacts !== prepared.audit.artifactIds.length) throw new Error("v3_template_recovery_artifact_update_mismatch");
        if (artifactOutcome.searchRowsDeleted !== prepared.audit.artifactIds.length) throw new Error("v3_template_recovery_search_delete_mismatch");
        const enrichmentOutcome = invalidateIncidentEnrichments(db, prepared);
        const workbenchOutcome = resetFailedV3TemplateSessionsInTransaction(db, {
          releaseReason: CLAIM_RELEASE_REASON,
          sessionIds: prepared.audit.sessionIds,
          updatedAt: now
        });
        return { artifactOutcome, enrichmentOutcome, workbenchOutcome };
      });
      options.onMutationBoundary?.("after_artifacts");
      options.onMutationBoundary?.("after_enrichments");
      if (mutation.workbenchOutcome.resetSessions !== prepared.audit.sessionIds.length) throw new Error("v3_template_recovery_pipeline_reset_mismatch");
      options.onMutationBoundary?.("after_pipeline");
      const after = readRevisions(db);
      if (after.logbook !== before.logbook + 1 || after.workbench !== before.workbench + 1) {
        throw new Error("v3_template_recovery_revision_mismatch");
      }
      const unsigned = {
        recoveryVersion: RECOVERY_VERSION,
        action: "invalidate" as const,
        databaseId: prepared.audit.databaseId,
        auditHash: prepared.audit.auditHash,
        incidentContractHash: prepared.incidentContractHash,
        invalidatedArtifacts: mutation.artifactOutcome.invalidatedArtifacts,
        preservedRuns: prepared.audit.runCount,
        resetSessions: mutation.workbenchOutcome.resetSessions,
        enrichmentRowsRemoved: mutation.enrichmentOutcome.removed,
        enrichmentRowsRestored: mutation.enrichmentOutcome.restored,
        claimsReleased: mutation.workbenchOutcome.claimsReleased,
        artifactIds: prepared.audit.artifactIds,
        backup: prepared.backup,
        revisions: { before, after },
        completedAt: now
      };
      const receipt: FailedV3TemplateInvalidationReceipt = { ...unsigned, receiptHash: hashCanonical(unsigned) };
      db.prepare(
        `INSERT INTO workbench_activity (
           activity_id, session_id, event_type, event_at, actor_kind, actor_id, summary, details_json
         ) VALUES (?, ?, 'v3_template_generation_invalidated', ?, 'system', 'masthead_recovery', ?, ?)`
      ).run(
        recoveryActivityId(prepared.audit.auditHash),
        prepared.audit.sessionIds[0],
        now,
        "Failed V3 template generation invalidated",
        JSON.stringify({ auditHash: prepared.audit.auditHash, receipt })
      );
      options.onMutationBoundary?.("after_receipt");
      db.exec("COMMIT;");
      return receipt;
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK;");
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function restoreFailedV3TemplateRecoveryInsideExclusiveMaintenance(
  databasePath: string,
  prepared: FailedV3TemplatePreparedRecovery,
  ownership: ExclusiveDatabaseMaintenance,
  options: { onMutationBoundary?: (boundary: "after_stage" | "before_promotion") => void } = {}
): Promise<FailedV3TemplateRestoreReceipt> {
  const activePath = resolve(databasePath);
  assertOwnership(activePath, ownership, "v3_template_recovery_restore_ownership_required");
  assertPreparedReceipt(prepared, activePath);
  await assertStandaloneRegularDatabase(activePath, "v3_template_recovery_restore");
  await verifyPreparedBackup(prepared);
  const activeDb = immutableDatabase(activePath);
  try {
    if (readDatabaseId(activeDb) !== prepared.audit.databaseId) throw new Error("v3_template_recovery_restore_identity_mismatch");
    const stored = readStoredInvalidationReceipt(activeDb, prepared, { requireExactPostState: false });
    if (!stored) throw new Error("v3_template_recovery_restore_invalidation_receipt_missing");
  } finally {
    activeDb.close();
  }

  const stagePath = join(dirname(activePath), `.${basename(activePath)}.v3-restore-stage-${randomUUID()}`);
  try {
    const source = immutableDatabase(prepared.backup.path);
    try {
      await backup(source, stagePath);
    } finally {
      source.close();
    }
    const staged = immutableDatabase(stagePath);
    try {
      verifyIntegrity(staged);
      const audit = auditFailedV3TemplateGeneration(staged, prepared.incidentContract);
      if (audit.auditHash !== prepared.audit.auditHash) throw new Error("v3_template_recovery_restore_staged_audit_mismatch");
    } finally {
      staged.close();
    }
    options.onMutationBoundary?.("after_stage");
    await verifyPreparedBackup(prepared);
    options.onMutationBoundary?.("before_promotion");
    await removeSidecars(activePath);
    await rename(stagePath, activePath);
    const restored = immutableDatabase(activePath);
    try {
      verifyIntegrity(restored);
      const audit = auditFailedV3TemplateGeneration(restored, prepared.incidentContract);
      if (audit.auditHash !== prepared.audit.auditHash) throw new Error("v3_template_recovery_restore_active_audit_mismatch");
    } finally {
      restored.close();
    }
    const unsigned = {
      recoveryVersion: RECOVERY_VERSION,
      action: "restore" as const,
      databaseId: prepared.audit.databaseId,
      auditHash: prepared.audit.auditHash,
      backupPath: prepared.backup.path,
      backupPreserved: true as const,
      integrityResult: "ok" as const,
      restoredAt: new Date().toISOString()
    };
    return { ...unsigned, receiptHash: hashCanonical(unsigned) };
  } finally {
    await rm(stagePath, { force: true });
    await removeSidecars(stagePath);
  }
}

export async function readFailedV3TemplateIncidentContract(path: string): Promise<FailedV3TemplateIncidentContract> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as FailedV3TemplateIncidentContract;
  assertIncidentContractShape(parsed);
  return parsed;
}

function auditRun(row: Record<string, unknown>, contract: FailedV3TemplateIncidentContract): AuditRun | undefined {
  const bundle = parseObject(row.bundleJson, "bundle");
  const receipt = parseObject(row.receiptJson, "receipt");
  if (bundle.bundleVersion !== AUTHORING_CONTRACT || receipt.contractVersion !== AUTHORING_CONTRACT) return undefined;
  const runId = stringValue(row.runId);
  if (row.databaseId !== contract.databaseId) return undefined;
  if (receipt.runId !== runId || bundle.runId !== runId) return undefined;
  const drafts = arrayValue(bundle.sessionEnrichments);
  if (drafts.length === 0) return undefined;
  const optionalDrafts = arrayValue(bundle.artifacts);
  const optionalReceipt = arrayValue(receipt.optionalArtifacts);
  const contributions = arrayValue(receipt.contributions);
  if (optionalDrafts.length || optionalReceipt.length || contributions.length) return undefined;
  const sessionIds = drafts.map((entry) => stringValue(objectValue(entry).sessionId)).sort();
  const resolvedSessionIdsInReceipt = stringArray(receipt.resolvedSessionIds);
  const artifactIdsInReceipt = stringArray(receipt.dossierArtifactIds);
  const publishedArtifactIds = stringArray(receipt.publishedArtifactIds).sort();
  const resolvedSessionIds = [...resolvedSessionIdsInReceipt].sort();
  const artifactIds = [...artifactIdsInReceipt].sort();
  if (!sameStrings(sessionIds, resolvedSessionIds) || !sameStrings(artifactIds, publishedArtifactIds)) return undefined;
  const enrichments = drafts.map((entry) => {
    const draft = objectValue(entry);
    const enrichment = objectValue(draft.enrichment);
    const summary = objectValue(enrichment.sessionSummary);
    const dossier = objectValue(enrichment.sessionDossier);
    const verification = objectValue(dossier.verification);
    if (!stringValue(summary.text).startsWith(contract.summaryPrefix)) return undefined;
    if (arrayValue(dossier.decisions).length !== 0 || verification.status !== "unknown") return undefined;
    if (enrichment.promptVersion !== contract.policyVersion) return undefined;
    return {
      fingerprint: fingerprintWorkbenchOutput(enrichment),
      model: typeof enrichment.model === "string" && enrichment.model ? enrichment.model : "external_agent",
      sessionId: stringValue(draft.sessionId)
    };
  });
  if (enrichments.some((entry) => !entry)) return undefined;
  const enrichmentFingerprintBySession = new Map(
    (enrichments as AuditRun["enrichments"]).map((entry) => [entry.sessionId, entry.fingerprint] as const)
  );
  if (
    artifactIdsInReceipt.length !== resolvedSessionIdsInReceipt.length ||
    enrichmentFingerprintBySession.size !== resolvedSessionIdsInReceipt.length
  ) return undefined;
  const expectedArtifacts = artifactIdsInReceipt.map((artifactId, index) => {
    const sessionId = resolvedSessionIdsInReceipt[index]!;
    const enrichmentFingerprint = enrichmentFingerprintBySession.get(sessionId);
    return enrichmentFingerprint ? { artifactId, enrichmentFingerprint, sessionId } : undefined;
  });
  if (expectedArtifacts.some((entry) => !entry)) return undefined;
  return {
    actorId: stringValue(row.actorId),
    artifactIds,
    expectedArtifacts: expectedArtifacts as AuditRun["expectedArtifacts"],
    bundleHash: sha256(stringValue(row.bundleJson)),
    completedAt: stringValue(row.completedAt),
    createdAt: stringValue(row.createdAt),
    enrichments: enrichments as AuditRun["enrichments"],
    receiptHash: sha256(stringValue(row.receiptJson)),
    runId,
    sessionIds
  };
}

function readIncidentArtifacts(
  db: MastheadDatabase,
  expectedArtifacts: AuditRun["expectedArtifacts"],
  contract: FailedV3TemplateIncidentContract
): Array<Record<string, unknown>> {
  const artifactIds = expectedArtifacts.map(({ artifactId }) => artifactId);
  const expectedByArtifactId = new Map(expectedArtifacts.map((entry) => [entry.artifactId, entry] as const));
  const rows = db.prepare(
    `SELECT artifacts.artifact_id AS artifactId, artifacts.session_id AS sessionId,
            artifacts.artifact_kind AS artifactKind, artifacts.content_fingerprint AS contentFingerprint,
            artifacts.content_json AS contentJson, artifacts.schema_version AS schemaVersion, artifacts.status,
            artifacts.publication_status AS publicationStatus, artifacts.summary,
            artifacts.validation_json AS validationJson,
            COUNT(provenance.session_id) AS provenanceCount,
            MIN(provenance.session_id) AS provenanceSessionId
     FROM session_artifacts AS artifacts
     LEFT JOIN session_artifact_provenance AS provenance ON provenance.artifact_id = artifacts.artifact_id
     WHERE artifacts.artifact_id IN (${placeholdersFor(artifactIds)})
     GROUP BY artifacts.artifact_id ORDER BY artifacts.artifact_id`
  ).all(...artifactIds) as Array<Record<string, unknown>>;
  if (new Set(rows.map((row) => stringValue(row.artifactId))).size !== artifactIds.length) return [];
  for (const row of rows) {
    const expected = expectedByArtifactId.get(stringValue(row.artifactId));
    const validation = parseObject(row.validationJson, "artifact_validation");
    const content = parseObject(row.contentJson, "artifact_content");
    const durableEnrichment = parseObject(content.durableEnrichment, "artifact_durable_enrichment");
    if (
      !expected || row.artifactKind !== "session_dossier" || row.sessionId !== expected.sessionId ||
      row.contentFingerprint !== dossierSnapshotFingerprint(content as never) ||
      fingerprintWorkbenchOutput(durableEnrichment) !== expected.enrichmentFingerprint ||
      row.schemaVersion !== contract.dossierSchemaVersion || row.status !== "current" ||
      row.publicationStatus !== "published" || row.provenanceCount !== 1 ||
      row.provenanceSessionId !== row.sessionId ||
      validation.contract !== AUTHORING_CONTRACT ||
      (typeof row.summary !== "string" || !row.summary.startsWith(contract.summaryPrefix))
    ) throw new Error("v3_template_recovery_artifact_shape_mismatch");
  }
  const searchCount = db.prepare(
    `SELECT COUNT(DISTINCT artifact_id) AS count FROM session_artifact_search WHERE artifact_id IN (${placeholdersFor(artifactIds)})`
  ).get(...artifactIds) as { count: number };
  if (searchCount.count !== artifactIds.length) throw new Error("v3_template_recovery_search_membership_mismatch");
  return rows;
}

function verifyEnrichmentMembership(db: MastheadDatabase, enrichments: AuditRun["enrichments"], runs: AuditRun[]): void {
  const windowBySession = new Map(runs.flatMap((run) => run.sessionIds.map((sessionId) => [sessionId, run] as const)));
  for (const expected of enrichments) {
    for (const kind of ["session_capsule", "live_summary", "search_projection"]) {
      const rows = db.prepare(
        `SELECT enrichment_id AS enrichmentId, provider, model, generated_at AS generatedAt
         FROM session_enrichments
         WHERE session_id = ? AND enrichment_kind = ? AND prompt_version = ?
           AND content_fingerprint = ? AND status = 'current'`
      ).all(expected.sessionId, kind, PROMPT_VERSION, expected.fingerprint) as Array<Record<string, unknown>>;
      const run = windowBySession.get(expected.sessionId)!;
      if (rows.length !== 1) throw new Error("v3_template_recovery_enrichment_ambiguous");
      const row = rows[0]!;
      const generatedAt = stringValue(row.generatedAt);
      if (row.provider !== "workbench_authoring_v3" || row.model !== expected.model || generatedAt < run.createdAt || generatedAt > run.completedAt) {
        throw new Error("v3_template_recovery_enrichment_metadata_mismatch");
      }
      const predecessors = db.prepare(
        `SELECT enrichment_id FROM session_enrichments
         WHERE session_id = ? AND enrichment_kind = ? AND prompt_version = ?
           AND status = 'stale' AND content_fingerprint <> ?
           AND COALESCE(generated_at, '') <= ?`
      ).all(expected.sessionId, kind, PROMPT_VERSION, expected.fingerprint, generatedAt);
      if (predecessors.length > 1) throw new Error("v3_template_recovery_enrichment_ambiguous");
    }
  }
}

function invalidateIncidentEnrichments(
  db: MastheadDatabase,
  prepared: FailedV3TemplatePreparedRecovery
): { removed: number; restored: number } {
  const runRows = db.prepare(
    `SELECT bundle_json AS bundleJson FROM workbench_authoring_runs
     WHERE run_id IN (${placeholdersFor(prepared.audit.runIds)}) ORDER BY run_id`
  ).all(...prepared.audit.runIds) as Array<{ bundleJson: string }>;
  const expected = runRows.flatMap(({ bundleJson }) => arrayValue(parseObject(bundleJson, "bundle").sessionEnrichments).map((entry) => {
    const draft = objectValue(entry);
    return { fingerprint: fingerprintWorkbenchOutput(objectValue(draft.enrichment)), sessionId: stringValue(draft.sessionId) };
  }));
  let removed = 0;
  let restored = 0;
  for (const item of expected) {
    for (const kind of ["session_capsule", "live_summary", "search_projection"]) {
      const incidentRows = db.prepare(
        `SELECT enrichment_id AS enrichmentId, generated_at AS generatedAt FROM session_enrichments
         WHERE session_id = ? AND enrichment_kind = ? AND prompt_version = ? AND content_fingerprint = ?`
      ).all(item.sessionId, kind, PROMPT_VERSION, item.fingerprint) as Array<{ enrichmentId: string; generatedAt: string | null }>;
      if (incidentRows.length !== 1) throw new Error("v3_template_recovery_enrichment_ambiguous");
      const incident = incidentRows[0]!;
      const predecessors = db.prepare(
        `SELECT enrichment_id AS enrichmentId FROM session_enrichments
         WHERE session_id = ? AND enrichment_kind = ? AND prompt_version = ?
           AND status = 'stale' AND content_fingerprint <> ?
           AND enrichment_id <> ? AND COALESCE(generated_at, '') <= COALESCE(?, '')
         ORDER BY COALESCE(generated_at, '') DESC, enrichment_id DESC`
      ).all(
        item.sessionId,
        kind,
        PROMPT_VERSION,
        item.fingerprint,
        incident.enrichmentId,
        incident.generatedAt
      ) as Array<{ enrichmentId: string }>;
      if (predecessors.length > 1) throw new Error("v3_template_recovery_enrichment_ambiguous");
      db.prepare("DELETE FROM session_enrichments WHERE enrichment_id = ?").run(incident.enrichmentId);
      removed += 1;
      if (predecessors.length === 1) {
        const changed = db.prepare("UPDATE session_enrichments SET status = 'current' WHERE enrichment_id = ? AND status = 'stale'")
          .run(predecessors[0]!.enrichmentId).changes;
        if (changed !== 1) throw new Error("v3_template_recovery_enrichment_restore_mismatch");
        restored += 1;
      }
    }
  }
  return { removed, restored };
}

function readStoredInvalidationReceipt(
  db: MastheadDatabase,
  prepared: FailedV3TemplatePreparedRecovery,
  options: { requireExactPostState: boolean }
): FailedV3TemplateInvalidationReceipt | undefined {
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(({ name }) => name));
  if (!tables.has("workbench_activity") || !tables.has("masthead_data_revisions")) return undefined;
  const row = db.prepare("SELECT details_json AS detailsJson FROM workbench_activity WHERE activity_id = ?")
    .get(recoveryActivityId(prepared.audit.auditHash)) as { detailsJson: string } | undefined;
  if (!row) return undefined;
  const details = parseObject(row.detailsJson, "recovery_activity");
  const receipt = objectValue(details.receipt) as FailedV3TemplateInvalidationReceipt;
  const { receiptHash, ...unsigned } = receipt;
  if (
    hashCanonical(unsigned) !== receiptHash || receipt.databaseId !== prepared.audit.databaseId ||
    receipt.auditHash !== prepared.audit.auditHash || receipt.incidentContractHash !== prepared.incidentContractHash ||
    !sameStrings(receipt.artifactIds, prepared.audit.artifactIds) ||
    canonicalJson(receipt.backup) !== canonicalJson(prepared.backup)
  ) throw new Error("v3_template_recovery_stored_receipt_mismatch");
  if (options.requireExactPostState) {
    const revisions = readRevisions(db);
    if (revisions.logbook !== receipt.revisions.after.logbook || revisions.workbench !== receipt.revisions.after.workbench) {
      throw new Error("v3_template_recovery_stored_receipt_revision_mismatch");
    }
    const invalidated = db.prepare(
      `SELECT COUNT(*) AS count FROM session_artifacts WHERE artifact_id IN (${placeholdersFor(prepared.audit.artifactIds)})
         AND status = 'superseded' AND publication_status = 'invalidated'`
    ).get(...prepared.audit.artifactIds) as { count: number };
    if (invalidated.count !== prepared.audit.artifactIds.length) throw new Error("v3_template_recovery_stored_receipt_artifact_mismatch");
  }
  return receipt;
}

function assertIncidentContractShape(contract: FailedV3TemplateIncidentContract): void {
  if (!contract || contract.contractVersion !== "failed-v3-template-generation-incident-v1" ||
    contract.authoringContractVersion !== AUTHORING_CONTRACT || contract.runCount !== 270 ||
    contract.dossierCount !== 3230 || contract.distinctSessionCount !== 3230 || contract.optionalArtifactCount !== 0 ||
    contract.emptyDecisionCount !== 3230 || contract.unknownVerificationCount !== 3230 ||
    !contract.databaseId || !contract.summaryPrefix || contract.policyVersion !== PROMPT_VERSION || !contract.dossierSchemaVersion ||
    !Array.isArray(contract.actorIds) || contract.actorIds.length === 0) {
    throw new Error("v3_template_recovery_incident_contract_invalid");
  }
  for (const hash of [contract.runIdsHash, contract.artifactIdsHash, contract.sessionIdsHash]) {
    if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error("v3_template_recovery_incident_contract_invalid");
  }
  for (const value of [contract.createdAt?.from, contract.createdAt?.to, contract.completedAt?.from, contract.completedAt?.to]) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("v3_template_recovery_incident_contract_invalid");
  }
}

function assertPreparedReceipt(prepared: FailedV3TemplatePreparedRecovery, databasePath: string): void {
  if (prepared.recoveryVersion !== RECOVERY_VERSION || prepared.databasePath !== databasePath ||
    prepared.incidentContractHash !== hashCanonical(prepared.incidentContract)) {
    throw new Error("v3_template_recovery_prepared_receipt_invalid");
  }
  const { receiptHash, ...unsigned } = prepared;
  if (hashCanonical(unsigned) !== receiptHash) throw new Error("v3_template_recovery_prepared_receipt_hash_mismatch");
  if (prepared.audit.incidentContractHash !== prepared.incidentContractHash) throw new Error("v3_template_recovery_audit_mismatch");
}

async function verifyPreparedBackup(prepared: FailedV3TemplatePreparedRecovery): Promise<void> {
  const expectedPath = join(dirname(prepared.databasePath), `${basename(prepared.databasePath)}.backup-current`);
  if (resolve(prepared.backup.path) !== expectedPath) throw new Error("v3_template_recovery_backup_path_mismatch");
  await assertRegularNonSymlink(prepared.backup.path, "v3_template_recovery_backup_invalid");
  await assertNoSidecars(prepared.backup.path, "v3_template_recovery_backup_sidecar_present");
  const evidence = await fileEvidence(prepared.backup.path);
  if (!sameFileEvidence(evidence, prepared.backup)) throw new Error("v3_template_recovery_backup_hash_mismatch");
  const db = immutableDatabase(prepared.backup.path);
  try {
    verifyIntegrity(db);
    const audit = auditFailedV3TemplateGeneration(db, prepared.incidentContract);
    if (audit.auditHash !== prepared.audit.auditHash) throw new Error("v3_template_recovery_backup_audit_mismatch");
  } finally {
    db.close();
  }
}

async function assertStandaloneRegularDatabase(path: string, prefix: string): Promise<void> {
  await assertRegularNonSymlink(path, `${prefix}_path_invalid`);
  await assertNoSidecars(path, `${prefix}_sidecar_present`);
}

async function assertRegularNonSymlink(path: string, code: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(code);
}

async function assertNoSidecars(path: string, code: string): Promise<void> {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      await access(`${path}${suffix}`);
      throw new Error(`${code}:${suffix.slice(1)}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`${code}:`)) throw error;
    }
  }
}

async function removeSidecars(path: string): Promise<void> {
  await Promise.all(["-wal", "-shm", "-journal"].map((suffix) => rm(`${path}${suffix}`, { force: true })));
}

function immutableDatabase(path: string): DatabaseSync {
  const url = pathToFileURL(resolve(path));
  url.searchParams.set("immutable", "1");
  return new DatabaseSync(url, { readOnly: true });
}

function verifyIntegrity(db: MastheadDatabase): void {
  const results = db.prepare("PRAGMA integrity_check").all().flatMap((row) => Object.values(row));
  if (results.length !== 1 || results[0] !== "ok") throw new Error("v3_template_recovery_integrity_check_failed");
}

function readDatabaseId(db: MastheadDatabase): string {
  const row = db.prepare("SELECT setting_json AS value FROM app_settings WHERE setting_key = 'database_identity'").get() as { value: string } | undefined;
  if (!row) throw new Error("v3_template_recovery_database_identity_missing");
  const parsed = JSON.parse(row.value) as unknown;
  if (typeof parsed === "string" && parsed) return parsed;
  if (parsed && typeof parsed === "object" && "databaseId" in parsed && typeof parsed.databaseId === "string") return parsed.databaseId;
  throw new Error("v3_template_recovery_database_identity_invalid");
}

function readRevisions(db: MastheadDatabase): { logbook: number; workbench: number } {
  const rows = db.prepare("SELECT scope, revision FROM masthead_data_revisions ORDER BY scope").all() as Array<{ revision: number; scope: string }>;
  const logbook = rows.find((row) => row.scope === "logbook")?.revision;
  const workbench = rows.find((row) => row.scope === "workbench")?.revision;
  if (!Number.isInteger(logbook) || !Number.isInteger(workbench)) throw new Error("v3_template_recovery_revision_missing");
  return { logbook: logbook!, workbench: workbench! };
}

async function fileEvidence(path: string): Promise<FileEvidence> {
  const info = await stat(path);
  const bytes = await readFile(path);
  return { sha256: sha256(bytes), sizeBytes: info.size };
}

function bounds(values: string[]): { from: string; to: string } {
  if (values.length === 0 || values.some((value) => !Number.isFinite(Date.parse(value)))) throw new Error("v3_template_recovery_time_bounds_invalid");
  const sorted = [...values].sort();
  return { from: sorted[0]!, to: sorted.at(-1)! };
}

function assertHashList(values: string[], expected: string, label: string): void {
  if (hashCanonical(values) !== expected) throw new Error(`v3_template_recovery_${label}_hash_mismatch`);
}

function assertOwnership(path: string, ownership: ExclusiveDatabaseMaintenance, code: string): void {
  assertExclusiveDatabaseMaintenance(path, ownership, code);
}

function recoveryActivityId(auditHash: string): string {
  return `v3_template_recovery:${auditHash}`;
}

function placeholdersFor(values: unknown[]): string {
  if (values.length === 0) throw new Error("v3_template_recovery_empty_target");
  return values.map(() => "?").join(",");
}

function parseObject(value: unknown, label: string): Record<string, unknown> {
  try {
    return objectValue(typeof value === "string" ? JSON.parse(value) : value);
  } catch (error) {
    throw new Error(`v3_template_recovery_invalid_json:${label}`, { cause: error });
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("v3_template_recovery_invalid_shape");
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("v3_template_recovery_invalid_shape");
  return value;
}

function stringValue(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("v3_template_recovery_invalid_shape");
  return value;
}

function stringArray(value: unknown): string[] {
  return arrayValue(value).map(stringValue);
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameFileEvidence(left: FileEvidence, right: FileEvidence): boolean {
  return left.sha256 === right.sha256 && left.sizeBytes === right.sizeBytes;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashCanonical(value: unknown): string {
  return sha256(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
