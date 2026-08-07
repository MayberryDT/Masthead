import { createHash } from "node:crypto";
import { access, lstat, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createSingleConsistentBackupInsideExclusiveMaintenance,
  withExclusiveDatabaseMaintenance,
} from "../databaseBackup.ts";
import type { MastheadDatabase } from "./sqlite.ts";
import { openMastheadDatabase, withImmediateTransaction } from "./sqlite.ts";
import { invalidatePublishedArtifactsForRecoveryInTransaction } from "./sessionArtifactRepository.ts";

const CONTRACT_VERSION = "v5-quality-corpus-recovery-v1" as const;

export type V5QualityCorpusAudit = {
  contractVersion: typeof CONTRACT_VERSION;
  databaseId: string;
  retainCreatedBy: string[];
  totalCurrentPublished: number;
  retainedArtifacts: number;
  invalidationArtifacts: number;
  countsByCreatedBy: Record<string, number>;
  currentArtifactIdsHash: string;
  retainedArtifactIdsHash: string;
  invalidationArtifactIdsHash: string;
  auditHash: string;
};

export type V5QualityCorpusInvalidationReceipt = {
  contractVersion: typeof CONTRACT_VERSION;
  databaseId: string;
  auditHash: string;
  invalidatedArtifacts: number;
  searchRowsDeleted: number;
  retainedArtifacts: number;
  completedAt: string;
};

export type V5QualityCorpusPreparedRecovery = {
  recoveryVersion: typeof CONTRACT_VERSION;
  preparedAt: string;
  databasePath: string;
  audit: V5QualityCorpusAudit;
  backup: {
    backupPath: string;
    databaseId: string;
    integrityResult: "ok";
    sizeBytes: number;
    verificationMode: "identity_and_corpus_audit";
  };
};

type CurrentArtifactRow = {
  artifactId: string;
  createdBy: string;
};

export function auditV5QualityCorpus(
  db: MastheadDatabase,
  input: { retainCreatedBy: string[] }
): V5QualityCorpusAudit {
  return auditV5QualityCorpusSelection(db, input).audit;
}

function auditV5QualityCorpusSelection(
  db: MastheadDatabase,
  input: { retainCreatedBy: string[] }
): { audit: V5QualityCorpusAudit; invalidationArtifactIds: string[] } {
  const retainCreatedBy = normalizeCreators(input.retainCreatedBy);
  if (retainCreatedBy.length === 0) throw new Error("v5_quality_corpus_empty_retained_creators");
  const databaseId = readDatabaseId(db);
  const rows = db.prepare(
    `SELECT artifact_id AS artifactId, created_by AS createdBy
     FROM session_artifacts
     WHERE status = 'current' AND publication_status = 'published'
     ORDER BY artifact_id`
  ).all() as CurrentArtifactRow[];
  const retainedSet = new Set(retainCreatedBy);
  const retainedArtifactIds = rows.filter((row) => retainedSet.has(row.createdBy)).map((row) => row.artifactId);
  const invalidationArtifactIds = rows.filter((row) => !retainedSet.has(row.createdBy)).map((row) => row.artifactId);
  const countsByCreatedBy = Object.fromEntries(
    [...new Set(rows.map((row) => row.createdBy))]
      .sort()
      .map((createdBy) => [createdBy, rows.filter((row) => row.createdBy === createdBy).length])
  );
  const unsigned = {
    contractVersion: CONTRACT_VERSION,
    databaseId,
    retainCreatedBy,
    totalCurrentPublished: rows.length,
    retainedArtifacts: retainedArtifactIds.length,
    invalidationArtifacts: invalidationArtifactIds.length,
    countsByCreatedBy,
    currentArtifactIdsHash: hashStrings(rows.map((row) => row.artifactId)),
    retainedArtifactIdsHash: hashStrings(retainedArtifactIds),
    invalidationArtifactIdsHash: hashStrings(invalidationArtifactIds),
  };
  return {
    audit: {
      ...unsigned,
      auditHash: hashCanonical(unsigned),
    },
    invalidationArtifactIds,
  };
}

export function invalidateV5QualityCorpusInTransaction(
  db: MastheadDatabase,
  input: { audit: V5QualityCorpusAudit; expectedAuditHash: string; updatedAt: string }
): V5QualityCorpusInvalidationReceipt {
  if (!db.isTransaction) throw new Error("v5_quality_corpus_transaction_required");
  if (input.expectedAuditHash !== input.audit.auditHash) throw new Error("v5_quality_corpus_audit_hash_mismatch");
  const current = auditV5QualityCorpusSelection(db, { retainCreatedBy: input.audit.retainCreatedBy });
  const currentAudit = current.audit;
  if (currentAudit.auditHash !== input.audit.auditHash) throw new Error("v5_quality_corpus_changed_since_audit");
  if (current.invalidationArtifactIds.length === 0) throw new Error("v5_quality_corpus_empty_invalidation_target");
  const result = invalidatePublishedArtifactsForRecoveryInTransaction(db, {
    artifactIds: current.invalidationArtifactIds,
    updatedAt: input.updatedAt,
  });
  if (result.invalidatedArtifacts !== currentAudit.invalidationArtifacts || result.searchRowsDeleted !== currentAudit.invalidationArtifacts) {
    throw new Error(`v5_quality_corpus_invalidation_mismatch:${result.invalidatedArtifacts}:${result.searchRowsDeleted}`);
  }
  return {
    contractVersion: CONTRACT_VERSION,
    databaseId: currentAudit.databaseId,
    auditHash: currentAudit.auditHash,
    invalidatedArtifacts: result.invalidatedArtifacts,
    searchRowsDeleted: result.searchRowsDeleted,
    retainedArtifacts: currentAudit.retainedArtifacts,
    completedAt: input.updatedAt,
  };
}

export async function prepareV5QualityCorpusRecovery(
  databasePath: string,
  retainCreatedBy: string[]
): Promise<V5QualityCorpusPreparedRecovery> {
  const activePath = resolve(databasePath);
  return withExclusiveDatabaseMaintenance(activePath, async (ownership) => {
    const activeDb = new DatabaseSync(activePath, { readOnly: true }) as unknown as MastheadDatabase;
    let audit: V5QualityCorpusAudit;
    try {
      audit = auditV5QualityCorpus(activeDb, { retainCreatedBy });
    } finally {
      activeDb.close();
    }
    const backup = await createSingleConsistentBackupInsideExclusiveMaintenance(activePath, ownership, {
      verificationMode: "identity_only",
    });
    const backupDb = new DatabaseSync(backup.backupPath, { readOnly: true }) as unknown as MastheadDatabase;
    try {
      const backupAudit = auditV5QualityCorpus(backupDb, { retainCreatedBy });
      if (backupAudit.auditHash !== audit.auditHash) throw new Error("v5_quality_corpus_backup_audit_mismatch");
    } finally {
      backupDb.close();
    }
    return {
      recoveryVersion: CONTRACT_VERSION,
      preparedAt: new Date().toISOString(),
      databasePath: activePath,
      audit,
      backup: {
        backupPath: backup.backupPath,
        databaseId: backup.databaseId,
        integrityResult: backup.integrityResult,
        sizeBytes: backup.sizeBytes,
        verificationMode: "identity_and_corpus_audit",
      },
    };
  });
}

export async function invalidateV5QualityCorpusRecovery(
  databasePath: string,
  prepared: V5QualityCorpusPreparedRecovery,
  expectedAuditHash: string
): Promise<V5QualityCorpusInvalidationReceipt> {
  const activePath = resolve(databasePath);
  if (prepared.recoveryVersion !== CONTRACT_VERSION || resolve(prepared.databasePath) !== activePath) {
    throw new Error("v5_quality_corpus_prepared_receipt_mismatch");
  }
  if (expectedAuditHash !== prepared.audit.auditHash) throw new Error("v5_quality_corpus_audit_hash_mismatch");
  await verifyPreparedV5Backup(prepared);
  return withExclusiveDatabaseMaintenance(activePath, async () => {
    await verifyPreparedV5Backup(prepared);
    const db = await openMastheadDatabase(activePath);
    try {
      const currentAudit = auditV5QualityCorpus(db, { retainCreatedBy: prepared.audit.retainCreatedBy });
      if (currentAudit.auditHash !== prepared.audit.auditHash) throw new Error("v5_quality_corpus_changed_since_prepare");
      return withImmediateTransaction(db, () => invalidateV5QualityCorpusInTransaction(db, {
        audit: prepared.audit,
        expectedAuditHash,
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      db.close();
    }
  });
}


async function verifyPreparedV5Backup(prepared: V5QualityCorpusPreparedRecovery): Promise<void> {
  const expectedPath = join(dirname(prepared.databasePath), `${basename(prepared.databasePath)}.backup-current`);
  const backupPath = resolve(prepared.backup.backupPath);
  if (backupPath !== expectedPath) throw new Error("v5_quality_corpus_backup_path_mismatch");
  const info = await lstat(backupPath);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("v5_quality_corpus_backup_invalid");
  const size = (await stat(backupPath)).size;
  if (size !== prepared.backup.sizeBytes) throw new Error("v5_quality_corpus_backup_size_mismatch");
  for (const suffix of ["-wal", "-shm", "-journal"] as const) {
    try {
      await access(`${backupPath}${suffix}`);
      throw new Error(`v5_quality_corpus_backup_sidecar_present:${suffix.slice(1)}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("v5_quality_corpus_backup_sidecar_present:")) throw error;
    }
  }
  const backupDb = new DatabaseSync(backupPath, { readOnly: true }) as unknown as MastheadDatabase;
  try {
    const backupAudit = auditV5QualityCorpus(backupDb, { retainCreatedBy: prepared.audit.retainCreatedBy });
    if (backupAudit.auditHash !== prepared.audit.auditHash) throw new Error("v5_quality_corpus_backup_audit_mismatch");
    if (backupAudit.databaseId !== prepared.backup.databaseId) throw new Error("v5_quality_corpus_backup_identity_mismatch");
  } finally {
    backupDb.close();
  }
}

function readDatabaseId(db: MastheadDatabase): string {
  const row = db.prepare("SELECT setting_json AS value FROM app_settings WHERE setting_key = 'database_identity'").get() as
    | { value: string }
    | undefined;
  if (!row) throw new Error("v5_quality_corpus_database_identity_missing");
  const parsed = JSON.parse(row.value) as { databaseId?: unknown };
  if (typeof parsed.databaseId !== "string" || !parsed.databaseId) throw new Error("v5_quality_corpus_database_identity_invalid");
  return parsed.databaseId;
}

function normalizeCreators(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function hashStrings(values: string[]): string {
  return hashCanonical([...values].sort());
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
