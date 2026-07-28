import { access, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchDatabasePath } from "./dbPath.ts";
import { errorResult, jsonResult, type CliResult } from "./output.ts";
import {
  auditFailedV1Generation,
  wipePublishedArtifactState
} from "../daemon/db/sessionArtifactRepository.ts";
import {
  createSingleConsistentBackupInsideExclusiveMaintenance,
  invalidateFailedV1GenerationInsideExclusiveMaintenance,
  restoreFailedV1RecoveryBackupInsideExclusiveMaintenance,
  withExclusiveDatabaseMaintenance
} from "../daemon/databaseBackup.ts";
import { migrateDatabase } from "../daemon/db/schema.ts";
import { openMastheadDatabase } from "../daemon/db/sqlite.ts";
import {
  auditFailedV3TemplateGeneration,
  invalidateFailedV3TemplateGenerationInsideExclusiveMaintenance,
  prepareFailedV3TemplateRecovery,
  readFailedV3TemplateIncidentContract,
  restoreFailedV3TemplateRecoveryInsideExclusiveMaintenance,
  type FailedV3TemplatePreparedRecovery
} from "../daemon/db/v3TemplateRecovery.ts";
import {
  auditV5QualityCorpus,
  invalidateV5QualityCorpusRecovery,
  prepareV5QualityCorpusRecovery,
  type V5QualityCorpusPreparedRecovery
} from "../daemon/db/v5QualityCorpusRecovery.ts";

export async function runAgeStaleQualityReviewsMaintenance(
  args: string[],
  options: { env?: NodeJS.ProcessEnv },
  json: boolean
): Promise<CliResult> {
  const dryRun = args.includes("--dry-run");
  if (!dryRun && !args.includes("--confirm")) {
    return errorResult(
      "missing_argument",
      "Pass --confirm to age stale quality reviews, or --dry-run to inspect eligibility only",
      json
    );
  }
  const databasePath = resolveWorkbenchDatabasePath({ args, env: options.env });
  const limitRaw = optionValue(args, "--limit");
  const maxAgeDaysRaw = optionValue(args, "--max-age-days");
  let limit: number | undefined;
  let maxAgeMs: number | undefined;
  if (limitRaw !== undefined) {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return errorResult("invalid_argument", "--limit must be a positive integer", json);
    }
    limit = parsed;
  }
  if (maxAgeDaysRaw !== undefined) {
    const parsed = Number(maxAgeDaysRaw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return errorResult("invalid_argument", "--max-age-days must be a non-negative number", json);
    }
    maxAgeMs = Math.trunc(parsed * 24 * 60 * 60 * 1000);
  }
  const { ageStaleQualityReviews, QUALITY_REVIEW_STALE_AGE_MS } = await import(
    "../workbench/qualityReviewAging.ts"
  );
  const db = await openMastheadDatabase(databasePath);
  try {
    migrateDatabase(db);
    const result = ageStaleQualityReviews(db, {
      dryRun,
      limit,
      maxAgeMs: maxAgeMs ?? QUALITY_REVIEW_STALE_AGE_MS
    });
    return jsonResult({ databasePath, ok: true, ...result });
  } finally {
    db.close();
  }
}

export async function runWipePublishedMaintenance(
  args: string[],
  options: { env?: NodeJS.ProcessEnv },
  json: boolean
): Promise<CliResult> {
  if (!args.includes("--confirm")) {
    return errorResult("missing_argument", "Pass --confirm to wipe published Logbook/artifact state", json);
  }
  const databasePath = resolveWorkbenchDatabasePath({ args, env: options.env });
  const db = await openMastheadDatabase(databasePath);
  try {
    migrateDatabase(db);
    return jsonResult({ databasePath, ok: true, ...wipePublishedArtifactState(db) });
  } finally {
    db.close();
  }
}

export async function runFailedV1RecoveryMaintenance(
  command: "audit-v1-generation" | "prepare-v1-recovery" | "invalidate-v1-generation" | "restore-v1-recovery",
  args: string[],
  options: { env?: NodeJS.ProcessEnv },
  json: boolean
): Promise<CliResult> {
  const explicitPath = optionValue(args, "--db");
  if (!explicitPath) return errorResult("missing_argument", "Missing required option: --db", json);
  const databasePath = resolveWorkbenchDatabasePath({ args, env: options.env });
  try {
    await access(databasePath);
    if (command === "audit-v1-generation") {
      await assertSelfContainedDatabase(databasePath, "v1");
      const databaseUrl = pathToFileURL(databasePath);
      databaseUrl.searchParams.set("immutable", "1");
      const db = new DatabaseSync(databaseUrl.href, { readOnly: true });
      try {
        return jsonResult({ databasePath, ok: true, audit: auditFailedV1Generation(db) });
      } finally {
        db.close();
      }
    }

    if (command === "prepare-v1-recovery") {
      return await withExclusiveDatabaseMaintenance(databasePath, async (ownership) => {
        const sourceDb = new DatabaseSync(databasePath, { readOnly: true });
        let sourceAudit;
        try {
          sourceAudit = auditFailedV1Generation(sourceDb);
        } finally {
          sourceDb.close();
        }
        const backup = await createSingleConsistentBackupInsideExclusiveMaintenance(databasePath, ownership);
        const backupDb = new DatabaseSync(backup.backupPath, { readOnly: true });
        try {
          const backupAudit = auditFailedV1Generation(backupDb);
          if (backupAudit.auditHash !== sourceAudit.auditHash) {
            throw new Error("failed_v1_generation_changed_during_prepare");
          }
          return jsonResult({ databasePath, ok: true, audit: backupAudit, backup });
        } finally {
          backupDb.close();
        }
      });
    }

    if (command === "restore-v1-recovery") {
      const backupPath = optionValue(args, "--backup");
      if (!backupPath) return errorResult("missing_argument", "Missing required option: --backup", json);
      const expectedAuditHash = optionValue(args, "--audit-hash");
      if (!expectedAuditHash) return errorResult("missing_argument", "Missing required option: --audit-hash", json);
      if (!args.includes("--confirm")) {
        return errorResult("missing_argument", "Pass --confirm to restore the exact audited failed V1 generation", json);
      }
      return await withExclusiveDatabaseMaintenance(databasePath, async (ownership) =>
        jsonResult({
          databasePath,
          ok: true,
          receipt: await restoreFailedV1RecoveryBackupInsideExclusiveMaintenance(
            databasePath,
            backupPath,
            expectedAuditHash,
            ownership
          )
        })
      );
    }

    const expectedAuditHash = optionValue(args, "--audit-hash");
    if (!expectedAuditHash) return errorResult("missing_argument", "Missing required option: --audit-hash", json);
    if (!args.includes("--confirm")) {
      return errorResult(
        "missing_argument",
        "Pass --confirm to invalidate the exact audited failed V1 generation",
        json
      );
    }
    return await withExclusiveDatabaseMaintenance(databasePath, async (ownership) => jsonResult({
      databasePath,
      ok: true,
      receipt: await invalidateFailedV1GenerationInsideExclusiveMaintenance(
        databasePath,
        expectedAuditHash,
        ownership
      )
    }));
  } catch (error) {
    return errorResult(
      "v1_recovery_refused",
      error instanceof Error ? error.message : String(error),
      json
    );
  }
}

export async function runFailedV3TemplateRecoveryMaintenance(
  command: "audit-v3-template-generation" | "prepare-v3-template-recovery" |
    "invalidate-v3-template-generation" | "restore-v3-template-recovery",
  args: string[],
  options: { env?: NodeJS.ProcessEnv },
  json: boolean
): Promise<CliResult> {
  const explicitPath = optionValue(args, "--db");
  if (!explicitPath) return errorResult("missing_argument", "Missing required option: --db", json);
  const databasePath = resolveWorkbenchDatabasePath({ args, env: options.env });
  const contractPath = optionValue(args, "--incident-contract");
  const preparedPath = optionValue(args, "--prepared-receipt");
  const receiptPath = optionValue(args, "--receipt");
  if ((command === "audit-v3-template-generation" || command === "prepare-v3-template-recovery") && !contractPath) {
    return errorResult("missing_argument", "Missing required option: --incident-contract", json);
  }
  if (command === "prepare-v3-template-recovery" && !receiptPath) {
    return errorResult("missing_argument", "Missing required option: --receipt", json);
  }
  if ((command === "invalidate-v3-template-generation" || command === "restore-v3-template-recovery") && !preparedPath) {
    return errorResult("missing_argument", "Missing required option: --prepared-receipt", json);
  }
  if ((command === "invalidate-v3-template-generation" || command === "restore-v3-template-recovery") && !args.includes("--confirm")) {
    return errorResult("missing_argument", `Pass --confirm to ${command.startsWith("restore") ? "restore" : "invalidate"} the exact audited failed V3 template generation`, json);
  }
  try {
    await access(databasePath);
    if (command === "audit-v3-template-generation" || command === "prepare-v3-template-recovery") {
      const incidentContract = await readFailedV3TemplateIncidentContract(contractPath!);
      if (command === "audit-v3-template-generation") {
        await assertSelfContainedDatabase(databasePath, "v3_template");
        const databaseUrl = pathToFileURL(databasePath);
        databaseUrl.searchParams.set("immutable", "1");
        const db = new DatabaseSync(databaseUrl, { readOnly: true });
        try {
          return jsonResult({ databasePath, ok: true, audit: auditFailedV3TemplateGeneration(db, incidentContract) });
        } finally {
          db.close();
        }
      }
      const prepared = await prepareFailedV3TemplateRecovery(databasePath, incidentContract);
      await writeFile(receiptPath!, `${JSON.stringify(prepared, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      return jsonResult({ databasePath, ok: true, prepared, receiptPath });
    }
    const prepared = JSON.parse(await readFile(preparedPath!, "utf8")) as FailedV3TemplatePreparedRecovery;
    return await withExclusiveDatabaseMaintenance(databasePath, async (ownership) => jsonResult({
      databasePath,
      ok: true,
      receipt: command === "invalidate-v3-template-generation"
        ? await invalidateFailedV3TemplateGenerationInsideExclusiveMaintenance(databasePath, prepared, ownership)
        : await restoreFailedV3TemplateRecoveryInsideExclusiveMaintenance(databasePath, prepared, ownership)
    }));
  } catch (error) {
    return errorResult("v3_template_recovery_refused", error instanceof Error ? error.message : String(error), json);
  }
}

export async function runV5QualityCorpusMaintenance(
  command: "audit-v5-quality-corpus" | "prepare-v5-quality-corpus" | "invalidate-v5-quality-corpus",
  args: string[],
  options: { env?: NodeJS.ProcessEnv },
  json: boolean
): Promise<CliResult> {
  const explicitPath = optionValue(args, "--db");
  if (!explicitPath) return errorResult("missing_argument", "Missing required option: --db", json);
  const databasePath = resolveWorkbenchDatabasePath({ args, env: options.env });
  const retainCreatedBy = optionValues(args, "--retain-created-by");
  const receiptPath = optionValue(args, "--receipt");
  const preparedPath = optionValue(args, "--prepared-receipt");
  const expectedAuditHash = optionValue(args, "--audit-hash");
  if ((command === "audit-v5-quality-corpus" || command === "prepare-v5-quality-corpus") && retainCreatedBy.length === 0) {
    return errorResult("missing_argument", "Pass at least one --retain-created-by value", json);
  }
  if (command === "prepare-v5-quality-corpus" && !receiptPath) {
    return errorResult("missing_argument", "Missing required option: --receipt", json);
  }
  if (command === "invalidate-v5-quality-corpus" && (!preparedPath || !expectedAuditHash)) {
    return errorResult("missing_argument", "Missing required --prepared-receipt or --audit-hash", json);
  }
  if (command === "invalidate-v5-quality-corpus" && !args.includes("--confirm")) {
    return errorResult("missing_argument", "Pass --confirm to invalidate the exact audited V5 quality corpus", json);
  }
  try {
    await access(databasePath);
    if (command === "audit-v5-quality-corpus") {
      const db = new DatabaseSync(databasePath, { readOnly: true });
      try {
        return jsonResult({ databasePath, ok: true, audit: auditV5QualityCorpus(db, { retainCreatedBy }) });
      } finally {
        db.close();
      }
    }
    if (command === "prepare-v5-quality-corpus") {
      const prepared = await prepareV5QualityCorpusRecovery(databasePath, retainCreatedBy);
      await writeFile(receiptPath!, `${JSON.stringify(prepared, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      return jsonResult({ databasePath, ok: true, prepared, receiptPath });
    }
    const prepared = JSON.parse(await readFile(preparedPath!, "utf8")) as V5QualityCorpusPreparedRecovery;
    const receipt = await invalidateV5QualityCorpusRecovery(databasePath, prepared, expectedAuditHash!);
    return jsonResult({ databasePath, ok: true, receipt });
  } catch (error) {
    return errorResult("v5_quality_corpus_recovery_refused", error instanceof Error ? error.message : String(error), json);
  }
}

async function assertSelfContainedDatabase(databasePath: string, recovery: "v1" | "v3_template"): Promise<void> {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      await access(`${databasePath}${suffix}`);
      throw new Error(`${recovery}_recovery_audit_database_not_self_contained:${suffix.slice(1)}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function optionValues(args: string[], option: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === option) {
      const value = args[index + 1];
      if (value && !value.startsWith("--") && value.trim()) values.push(value.trim());
    } else if (argument.startsWith(`${option}=`)) {
      const value = argument.slice(option.length + 1).trim();
      if (value) values.push(value);
    }
  }
  return values;
}

function optionValue(args: string[], option: string): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === option) {
      const value = args[index + 1];
      return value && !value.startsWith("--") ? value.trim() || undefined : undefined;
    }
    if (argument.startsWith(`${option}=`)) return argument.slice(option.length + 1).trim() || undefined;
  }
  return undefined;
}
