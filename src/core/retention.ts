import type { StoreRecord } from "./store";

export type RetentionPolicy = {
  cutoffAt?: string;
  keepLatest?: number;
  recordTypes?: StoreRecord["recordType"][];
  pinnedRecordIds?: string[];
  keepUnresolvedAttention?: boolean;
};

export type PruneLocalDataResult = {
  removedRecords: number;
  removedRecordIds: string[];
  removedByType: Record<StoreRecord["recordType"], number>;
  retainedRecords: number;
  touchedExternalState: false;
};

const retentionRecordTypes = new Set<StoreRecord["recordType"]>([
  "event",
  "git_snapshot",
  "attention_item",
  "conflict_card",
  "review_disposition"
]);

export function validateRetentionPolicy(value: unknown): RetentionPolicy {
  if (typeof value !== "object" || value === null) throw new Error("Retention policy is required.");
  const input = value as RetentionPolicy;
  const recordTypes = input.recordTypes;
  if (!Array.isArray(recordTypes) || recordTypes.length === 0) {
    throw new Error("Retention policy must explicitly select recordTypes.");
  }
  for (const recordType of recordTypes) {
    if (!retentionRecordTypes.has(recordType)) throw new Error(`Unsupported retention recordType: ${String(recordType)}`);
  }
  if (input.keepLatest !== undefined && (!Number.isInteger(input.keepLatest) || input.keepLatest < 1)) {
    throw new Error("Retention policy keepLatest must be a positive integer.");
  }
  if (input.cutoffAt !== undefined && (typeof input.cutoffAt !== "string" || Number.isNaN(Date.parse(input.cutoffAt)))) {
    throw new Error("Retention policy cutoffAt must be an ISO timestamp.");
  }
  if (input.pinnedRecordIds !== undefined && (!Array.isArray(input.pinnedRecordIds) || !input.pinnedRecordIds.every((id) => typeof id === "string"))) {
    throw new Error("Retention policy pinnedRecordIds must be strings.");
  }
  return {
    cutoffAt: input.cutoffAt,
    keepLatest: input.keepLatest,
    keepUnresolvedAttention: input.keepUnresolvedAttention === false ? false : true,
    pinnedRecordIds: input.pinnedRecordIds,
    recordTypes
  };
}

export function applyRetentionPolicy(
  records: StoreRecord[],
  policy: RetentionPolicy
): { retainedRecords: StoreRecord[]; removedRecords: StoreRecord[] } {
  policy = validateRetentionPolicy(policy);
  const selectedRecords = records.filter((record) => matchesRetentionRecordType(record, policy));
  const protectedRecordIds = new Set([
    ...latestRecordIds(selectedRecords, policy.keepLatest),
    ...(policy.pinnedRecordIds ?? []),
    ...unresolvedAttentionRecordIds(records, policy)
  ]);
  const removedRecords = records.filter((record) => shouldPruneRecord(record, policy, protectedRecordIds));
  const removedRecordIds = new Set(removedRecords.map((record) => record.recordId));
  return {
    retainedRecords: records.filter((record) => !removedRecordIds.has(record.recordId)),
    removedRecords
  };
}

export function retentionPruneResult(removedRecords: StoreRecord[], retainedRecords: number): PruneLocalDataResult {
  return {
    removedRecords: removedRecords.length,
    removedRecordIds: removedRecords.map((record) => record.recordId),
    removedByType: countRecordsByType(removedRecords),
    retainedRecords,
    touchedExternalState: false
  };
}

export function countRecordsByType(records: StoreRecord[]): Record<StoreRecord["recordType"], number> {
  const counts = {
    event: 0,
    git_snapshot: 0,
    attention_item: 0,
    conflict_card: 0,
    review_disposition: 0
  };
  for (const record of records) {
    counts[record.recordType] += 1;
  }
  return counts;
}

function shouldPruneRecord(record: StoreRecord, policy: RetentionPolicy, protectedRecordIds: Set<string>): boolean {
  if (protectedRecordIds.has(record.recordId)) return false;
  if (!matchesRetentionRecordType(record, policy)) return false;
  const olderThanCutoff = policy.cutoffAt ? record.observedAt < policy.cutoffAt : false;
  const beyondLatestCap = policy.keepLatest === undefined ? false : !protectedRecordIds.has(record.recordId);
  return olderThanCutoff || beyondLatestCap;
}

function matchesRetentionRecordType(record: StoreRecord, policy: RetentionPolicy): boolean {
  return !policy.recordTypes || policy.recordTypes.length === 0 || policy.recordTypes.includes(record.recordType);
}

function latestRecordIds(records: StoreRecord[], keepLatest: number | undefined): Set<string> {
  if (keepLatest === undefined) return new Set();
  return new Set(
    records
      .toSorted(
        (a, b) =>
          b.observedAt.localeCompare(a.observedAt) ||
          a.recordType.localeCompare(b.recordType) ||
          a.recordId.localeCompare(b.recordId)
      )
      .slice(0, Math.max(0, keepLatest))
      .map((record) => record.recordId)
  );
}

function unresolvedAttentionRecordIds(records: StoreRecord[], policy: RetentionPolicy): string[] {
  if (policy.keepUnresolvedAttention === false) return [];
  return records.flatMap((record) => {
    if (record.recordType !== "attention_item") return [];
    return record.value.resolvedAt || record.value.dismissedAt ? [] : [record.recordId];
  });
}
