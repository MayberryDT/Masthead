import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { MastheadDatabase } from "./db/sqlite.ts";

export type LegacyDataCandidate = {
  kind: "sqlite" | "ndjson";
  path: string;
};

export type LegacySqliteCopyResult = {
  copied: boolean;
  reason: "copied" | "same_path" | "legacy_missing" | "target_exists";
  legacyPath?: string;
};

export function defaultLegacyCandidates(cwd = process.cwd()): LegacyDataCandidate[] {
  return legacyCandidatesFromDirectory(resolve(cwd, ".masthead"));
}

export function legacyCandidatesFromDirectory(directory: string): LegacyDataCandidate[] {
  return [
    { kind: "sqlite", path: resolve(directory, "masthead.sqlite") },
    { kind: "ndjson", path: resolve(directory, "events.ndjson") }
  ];
}

export function legacyDataMigrationCompleted(db: MastheadDatabase, migrationKey: string): boolean {
  const row = db.prepare("SELECT 1 FROM legacy_migrations WHERE migration_key = ?").get(migrationKey);
  return Boolean(row);
}

export function markLegacyDataMigrationCompleted(db: MastheadDatabase, migrationKey: string, details: unknown): void {
  db.prepare(
    `INSERT INTO legacy_migrations (migration_key, completed_at, details_json)
     VALUES (?, ?, ?)
     ON CONFLICT(migration_key) DO NOTHING`
  ).run(migrationKey, new Date().toISOString(), JSON.stringify(details));
}

export async function maybeCopyLegacySqliteBeforeOpen(options: {
  targetDatabasePath: string;
  legacyDatabasePath: string;
}): Promise<LegacySqliteCopyResult> {
  const legacyPath = resolve(options.legacyDatabasePath);
  if (resolve(options.targetDatabasePath) === legacyPath) {
    return { copied: false, reason: "same_path", legacyPath };
  }

  if (!(await exists(legacyPath))) {
    return { copied: false, reason: "legacy_missing", legacyPath };
  }

  if (await exists(options.targetDatabasePath)) {
    return { copied: false, reason: "target_exists", legacyPath };
  }

  await mkdir(dirname(options.targetDatabasePath), { recursive: true });
  await copyFile(legacyPath, options.targetDatabasePath);
  return { copied: true, reason: "copied", legacyPath };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
