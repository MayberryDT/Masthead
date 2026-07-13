import { access } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchDatabasePath } from "./dbPath.ts";
import { errorResult, jsonResult, type CliResult } from "./output.ts";
import {
  auditFailedV1Generation,
  invalidateFailedV1Generation,
  wipePublishedArtifactState
} from "../daemon/db/sessionArtifactRepository.ts";
import {
  createSingleConsistentBackupInsideExclusiveMaintenance,
  withExclusiveDatabaseMaintenance
} from "../daemon/databaseBackup.ts";
import { migrateDatabase } from "../daemon/db/schema.ts";
import { openMastheadDatabase } from "../daemon/db/sqlite.ts";

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
  command: "audit-v1-generation" | "prepare-v1-recovery" | "invalidate-v1-generation",
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
      const db = new DatabaseSync(databasePath, { readOnly: true });
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

    const expectedAuditHash = optionValue(args, "--audit-hash");
    if (!expectedAuditHash) return errorResult("missing_argument", "Missing required option: --audit-hash", json);
    if (!args.includes("--confirm")) {
      return errorResult(
        "missing_argument",
        "Pass --confirm to invalidate the exact audited failed V1 generation",
        json
      );
    }
    return await withExclusiveDatabaseMaintenance(databasePath, () => {
      const db = new DatabaseSync(databasePath);
      try {
        db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
        return jsonResult({
          databasePath,
          ok: true,
          receipt: invalidateFailedV1Generation(db, expectedAuditHash)
        });
      } finally {
        db.close();
      }
    });
  } catch (error) {
    return errorResult(
      "v1_recovery_refused",
      error instanceof Error ? error.message : String(error),
      json
    );
  }
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
