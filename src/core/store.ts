import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { applyRetentionPolicy, retentionPruneResult } from "./retention.ts";
import type { PruneLocalDataResult, RetentionPolicy } from "./retention";
import type { AttentionItem, ConflictCard, GitSnapshot, NormalizedEvent } from "./types";

export type { PruneLocalDataResult, RetentionPolicy } from "./retention";

export type ReviewDisposition = {
  dispositionId: string;
  subjectId: string;
  subjectType: "session" | "attention_item" | "conflict_card";
  status: "reviewed" | "expected" | "dismissed" | "snoozed" | "false_positive";
  recordedAt: string;
  snoozedUntil?: string;
  reviewer?: string;
  reason?: string;
};

type BaseStoreRecord<TRecordType extends string, TValue> = {
  recordId: string;
  recordType: TRecordType;
  observedAt: string;
  value: TValue;
};

type StoreRecordValueMap = {
  event: NormalizedEvent;
  git_snapshot: GitSnapshot;
  attention_item: AttentionItem;
  conflict_card: ConflictCard;
  review_disposition: ReviewDisposition;
};

export type StoreRecord = {
  [TRecordType in keyof StoreRecordValueMap]: BaseStoreRecord<TRecordType, StoreRecordValueMap[TRecordType]>;
}[keyof StoreRecordValueMap];

export type LocalStoreSnapshot = {
  records: StoreRecord[];
  events: NormalizedEvent[];
  gitSnapshots: GitSnapshot[];
  attentionItems: AttentionItem[];
  unresolvedAttentionItems: AttentionItem[];
  conflicts: ConflictCard[];
  reviewDispositions: ReviewDisposition[];
};

export type StoreExport = {
  exportedAt: string;
  records: StoreRecord[];
};

export type ClearLocalDataResult = {
  removedRecords: number;
  touchedExternalState: false;
};

export type AppendOnlyStore = {
  append(record: StoreRecord): Promise<void>;
  appendMany(records: StoreRecord[]): Promise<void>;
  clearLocalData(): Promise<ClearLocalDataResult>;
  deleteRecords(predicate: (record: StoreRecord) => boolean): Promise<PruneLocalDataResult>;
  pruneLocalData(policy: RetentionPolicy): Promise<PruneLocalDataResult>;
  exportRecords(): StoreExport;
  readAll(): StoreRecord[];
  readEvents(): NormalizedEvent[];
  readGitSnapshots(): GitSnapshot[];
  readAttentionItems(): AttentionItem[];
  readConflicts(): ConflictCard[];
  readReviewDispositions(): ReviewDisposition[];
  snapshot(): LocalStoreSnapshot;
};

export function createInMemoryStore(initialRecords: StoreRecord[] = []): AppendOnlyStore {
  const records = [...initialRecords];

  return {
    async append(record) {
      records.push(record);
    },
    async appendMany(nextRecords) {
      records.push(...nextRecords);
    },
    async clearLocalData() {
      const removedRecords = records.length;
      records.length = 0;
      return { removedRecords, touchedExternalState: false };
    },
    async deleteRecords(predicate) {
      const removedRecords = records.filter(predicate);
      const removedRecordIds = new Set(removedRecords.map((record) => record.recordId));
      const retainedRecords = records.filter((record) => !removedRecordIds.has(record.recordId));
      records.length = 0;
      records.push(...retainedRecords);
      return retentionPruneResult(removedRecords, retainedRecords.length);
    },
    async pruneLocalData(policy) {
      const { retainedRecords, removedRecords } = applyRetentionPolicy(records, policy);
      records.length = 0;
      records.push(...retainedRecords);
      return retentionPruneResult(removedRecords, retainedRecords.length);
    },
    exportRecords() {
      return {
        exportedAt: new Date().toISOString(),
        records: [...records]
      };
    },
    readAll() {
      return [...records];
    },
    readEvents() {
      return valuesFor(records, "event");
    },
    readGitSnapshots() {
      return valuesFor(records, "git_snapshot");
    },
    readAttentionItems() {
      return valuesFor(records, "attention_item");
    },
    readConflicts() {
      return valuesFor(records, "conflict_card");
    },
    readReviewDispositions() {
      return valuesFor(records, "review_disposition");
    },
    snapshot() {
      return snapshotFrom(records);
    }
  };
}

export async function createFileBackedStore(filePath: string): Promise<AppendOnlyStore> {
  const records = await readExistingRecords(filePath);
  const memory = createInMemoryStore(records);
  const appendRecord = async (record: StoreRecord): Promise<void> => {
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
    await memory.append(record);
  };

  return {
    async append(record) {
      await appendRecord(record);
    },
    async appendMany(nextRecords) {
      for (const record of nextRecords) {
        await appendRecord(record);
      }
    },
    async clearLocalData() {
      const removedRecords = memory.readAll().length;
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, "", "utf8");
      await memory.clearLocalData();
      return { removedRecords, touchedExternalState: false };
    },
    async deleteRecords(predicate) {
      const records = memory.readAll();
      const removedRecords = records.filter(predicate);
      const removedRecordIds = new Set(removedRecords.map((record) => record.recordId));
      const retainedRecords = records.filter((record) => !removedRecordIds.has(record.recordId));
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(
        filePath,
        retainedRecords.length > 0 ? `${retainedRecords.map((record) => JSON.stringify(record)).join("\n")}\n` : "",
        "utf8"
      );
      await memory.clearLocalData();
      await memory.appendMany(retainedRecords);
      return retentionPruneResult(removedRecords, retainedRecords.length);
    },
    async pruneLocalData(policy) {
      const { retainedRecords, removedRecords } = applyRetentionPolicy(memory.readAll(), policy);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(
        filePath,
        retainedRecords.length > 0 ? `${retainedRecords.map((record) => JSON.stringify(record)).join("\n")}\n` : "",
        "utf8"
      );
      await memory.clearLocalData();
      await memory.appendMany(retainedRecords);
      const result = retentionPruneResult(removedRecords, retainedRecords.length);
      return result;
    },
    exportRecords: memory.exportRecords,
    readAll: memory.readAll,
    readEvents: memory.readEvents,
    readGitSnapshots: memory.readGitSnapshots,
    readAttentionItems: memory.readAttentionItems,
    readConflicts: memory.readConflicts,
    readReviewDispositions: memory.readReviewDispositions,
    snapshot: memory.snapshot
  };
}

async function readExistingRecords(filePath: string): Promise<StoreRecord[]> {
  try {
    const contents = await readFile(filePath, "utf8");
    return contents
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StoreRecord);
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

function valuesFor<T extends keyof StoreRecordValueMap>(
  records: StoreRecord[],
  recordType: T
): Array<StoreRecordValueMap[T]> {
  const values: Array<StoreRecordValueMap[T]> = [];
  for (const record of records) {
    if (record.recordType === recordType) {
      values.push(record.value as StoreRecordValueMap[T]);
    }
  }
  return values;
}

function snapshotFrom(records: StoreRecord[]): LocalStoreSnapshot {
  const attentionItems = valuesFor(records, "attention_item");

  return {
    records: [...records],
    events: valuesFor(records, "event"),
    gitSnapshots: valuesFor(records, "git_snapshot"),
    attentionItems,
    unresolvedAttentionItems: attentionItems.filter((item) => !item.resolvedAt && !item.dismissedAt),
    conflicts: valuesFor(records, "conflict_card"),
    reviewDispositions: valuesFor(records, "review_disposition")
  };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
