import { resolve } from "node:path";
import { createFileBackedStore, type StoreRecord } from "../core/store.ts";
import type { NormalizedEvent } from "../core/types.ts";
import type { MastheadDatabase } from "./db/sqlite.ts";
import { legacyDataMigrationCompleted, markLegacyDataMigrationCompleted } from "./legacyDataMigration.ts";

export const LEGACY_JOURNAL_MIGRATION_KEY = "legacy-events-ndjson-v1";

export type LegacyJournalMigrationResult = {
  importedRecords: number;
  reason: "completed" | "already_completed" | "empty" | "sqlite_copied";
  sources: string[];
  totalRecords: number;
};

export type LegacyJournalMigrationOptions = {
  appendStoreRecord: (record: StoreRecord) => void;
  batchSize?: number;
  database: MastheadDatabase;
  indexSession: (sessionId: string) => void;
  legacyStorePath?: string;
  onTouchedSessions?: (sessionIds: Iterable<string>) => void;
  shouldStop?: () => boolean;
  sqliteCopied?: boolean;
  storePath: string;
  targetDatabaseId?: string;
  upsertLiveEvent: (event: NormalizedEvent) => string | undefined;
  yieldToEventLoop?: () => Promise<void>;
};

type RawRecordKeyRow = {
  sourceRecordKey: string;
};

export async function migrateLegacyJournalOnce(options: LegacyJournalMigrationOptions): Promise<LegacyJournalMigrationResult> {
  const sources = legacyJournalSources(options.storePath, options.legacyStorePath);
  if (options.sqliteCopied) {
    return { importedRecords: 0, reason: "sqlite_copied", sources, totalRecords: 0 };
  }

  if (legacyDataMigrationCompleted(options.database, LEGACY_JOURNAL_MIGRATION_KEY)) {
    return { importedRecords: 0, reason: "already_completed", sources, totalRecords: 0 };
  }

  const primarySource = sources[0];
  const primaryRecords = await readUniqueStoreRecords(primarySource);
  const primaryMissing = missingStoreRecords(options.database, primaryRecords);
  await hydrateMissingRecords(options, primaryMissing);

  const markerSource = sources[1] ?? primarySource;
  const markerRecords = sources[1] ? await readUniqueStoreRecords(sources[1]) : primaryRecords;
  const markerMissing = sources[1] ? missingStoreRecords(options.database, markerRecords) : primaryMissing;
  await hydrateMissingRecords(options, markerMissing);

  const totalRecords = sources[1] ? markerRecords.length : primaryRecords.length;
  if (totalRecords === 0) {
    markLegacyDataMigrationCompleted(options.database, LEGACY_JOURNAL_MIGRATION_KEY, {
      completedAt: new Date().toISOString(),
      copiedRecords: 0,
      importedRecords: 0,
      migrationKey: LEGACY_JOURNAL_MIGRATION_KEY,
      reason: "empty",
      skippedRecords: 0,
      source: markerSource,
      sources,
      targetDatabaseId: options.targetDatabaseId,
      totalRecords: 0
    });
    return { importedRecords: 0, reason: "empty", sources, totalRecords: 0 };
  }

  const totalInputRecords = primaryRecords.length + (sources[1] ? markerRecords.length : 0);
  const importedRecords = primaryMissing.length + (sources[1] ? markerMissing.length : 0);
  const skippedRecords = Math.max(0, totalInputRecords - importedRecords);
  markLegacyDataMigrationCompleted(options.database, LEGACY_JOURNAL_MIGRATION_KEY, {
    completedAt: new Date().toISOString(),
    copiedRecords: 0,
    importedRecords,
    migrationKey: LEGACY_JOURNAL_MIGRATION_KEY,
    reason: "completed",
    skippedRecords,
    source: markerSource,
    sources,
    targetDatabaseId: options.targetDatabaseId,
    totalRecords
  });

  return {
    importedRecords,
    reason: "completed",
    sources,
    totalRecords: totalInputRecords
  };
}

function legacyJournalSources(storePath: string, legacyStorePath: string | undefined): string[] {
  const sources = [resolve(storePath)];
  if (legacyStorePath && resolve(legacyStorePath) !== sources[0]) sources.push(resolve(legacyStorePath));
  return sources;
}

async function readUniqueStoreRecords(source: string): Promise<StoreRecord[]> {
  const records: StoreRecord[] = [];
  const seenRecordIds = new Set<string>();
  // Legacy NDJSON is migration/compatibility input only. New product records belong in SQLite.
  for (const record of (await createFileBackedStore(source)).readAll()) {
    if (seenRecordIds.has(record.recordId)) continue;
    seenRecordIds.add(record.recordId);
    records.push(record);
  }
  return records;
}

function missingStoreRecords(database: MastheadDatabase, records: StoreRecord[]): StoreRecord[] {
  if (records.length === 0) return [];
  const rows = database.prepare("SELECT source_record_key AS sourceRecordKey FROM raw_events").all() as RawRecordKeyRow[];
  const existing = new Set(rows.map((row) => row.sourceRecordKey));
  return records.filter((record) => !existing.has(record.recordId));
}

async function hydrateMissingRecords(options: LegacyJournalMigrationOptions, records: StoreRecord[]): Promise<void> {
  const batchSize = options.batchSize ?? 100;
  for (let index = 0; index < records.length && !options.shouldStop?.(); index += batchSize) {
    const batch = records.slice(index, index + batchSize);
    const touchedSessionIds = new Set<string>();
    options.database.exec("BEGIN IMMEDIATE;");
    try {
      for (const record of batch) {
        options.appendStoreRecord(record);
        if (record.recordType !== "event") continue;
        const sessionId = options.upsertLiveEvent(record.value);
        if (!sessionId) continue;
        options.indexSession(sessionId);
        touchedSessionIds.add(sessionId);
      }
      options.database.exec("COMMIT;");
    } catch (error) {
      options.database.exec("ROLLBACK;");
      throw error;
    }
    options.onTouchedSessions?.(touchedSessionIds);
    await options.yieldToEventLoop?.();
  }
}
